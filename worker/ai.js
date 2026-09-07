/**
 * AI 助手「花傩」（docs/AI助手方案.md）
 *
 *  - POST /api/ai/chat   问答主接口：限流 → 知识库关键词检索 Top-3 + 站内实时数据注入
 *                        → 最近 6 条多轮历史 → Workers AI binding（模型后台可切）→
 *                        JSON {text, action}（action 白名单校验后落成 open_page）→ 用量日志
 *  - GET  /api/ai/config 前端配置（公开）：{enabled, greeting, quick}，不含提示词/模型名
 *
 * 设计取舍：
 *  - 非流式 + 前端打字机（与旧站一致，SSE 流式列 M2）
 *  - 推理默认走 AI binding（零密钥），配置 AI_API_BASE/AI_API_KEY secret 后自动获得
 *    OpenAI 兼容 REST 兜底；AI_PROVIDER=rest 直走 REST（本地联调用，.dev.vars 配置）
 *  - 设置/知识库 60s 隔离内存缓存：后台改动最迟 1 分钟生效，换取每次问答少两次 D1 读
 *  - 模型名只认白名单，设置被改坏也兜底回默认模型
 */

const RATE_WINDOW_MS = 5 * 60 * 1000;
const RATE_MAX = 10;                     // 每 IP 5 分钟 10 问，隔离内存近似
const QUESTION_MAX = 200;
const HISTORY_TURNS = 6;                 // 带给模型的最近轮数（含 user/assistant）
const HISTORY_ITEM_MAX = 500;
const AI_TIMEOUT_MS = 30_000;
const CACHE_TTL_MS = 60_000;

const MODEL_ALLOW = new Set([
  '@cf/qwen/qwen3-30b-a3b-fp8',          // 默认：MoE 快、中文强、便宜（≈22 neuron/轮）
  '@cf/qwen/qwen3.8-27b',
  // 2026-09 实测淘汰：DeepSeek-V4-Flash（Free 套餐 403）、GLM-4.7-Flash（单答 15~30s 撞 AI_TIMEOUT_MS）
]);
const MODEL_DEFAULT = '@cf/qwen/qwen3-30b-a3b-fp8';

/** open_page 白名单：仅站内真实路由（含既有静态子页与动态板块） */
const PAGE_ROUTE_RE = new RegExp(
  '^(?:/|(?:/(?:about|cuisine|heritage|industry|spots|tourism|pay|merchants|library|music|attractions|tv)' +
  '(?:/[a-z0-9-]+)*/?))$'
);

const SETTINGS_DEFAULTS = {
  enabled: '1',
  model: MODEL_DEFAULT,
  system_prompt: '',
  greeting: '',
  quick_questions: '[]',
};

/** 用户当前路径 → 板块语境（system 注入用，帮助手理解「这里/本页」指代） */
const PAGE_LABELS = [
  ['/tv', '万载TV 视频频道'], ['/library', '焰境文库'], ['/music', '万载音乐'],
  ['/attractions', '旅游景点'], ['/merchants', '商户名录'], ['/spots', '烟花观赏点专题'],
  ['/cuisine', '美食专题'], ['/heritage', '非遗文化专题'], ['/industry', '花炮产业专题'],
  ['/tourism', '旅游线路专题'], ['/about', '关于本站'], ['/pay', '付费合作'],
];
function pathLabel(pathname) {
  const p = String(pathname || '');
  if (!p.startsWith('/') || p.length > 100) return '';
  for (const [prefix, label] of PAGE_LABELS) {
    if (p === prefix || p.startsWith(prefix + '/')) return label;
  }
  return '';
}

/* ---------------- 入口 ---------------- */

export async function handleAiChat(request, env, ctx) {
  const ip = request.headers.get('cf-connecting-ip') || '';

  if (ip && aiRateLimited(ip)) {
    return aiJson({ ok: false, error: 'rate_limited', text: '问题有点多啦，请休息几分钟再问。' }, 429);
  }

  const body = await request.json().catch(() => null);
  const question = String(body?.question ?? '').trim().slice(0, QUESTION_MAX);
  if (!question) return aiJson({ ok: false, error: 'invalid_fields', text: '请输入你的问题。' }, 400);

  const s = await loadAiSettings(env);
  if (s.enabled !== '1') {
    return aiJson({ ok: false, error: 'disabled', text: '问答助手正在维护中，请稍后再来。' }, 503);
  }

  const t0 = Date.now();
  try {
    const [knowledge, live] = await Promise.all([
      loadKnowledge(env),
      loadLiveData(env),
    ]);
    const matched = retrieveKnowledge(question, knowledge);
    const sources = [...new Set(matched.map((k) => k.category))];

    const messages = [
      { role: 'system', content: buildSystem(s.system_prompt, matched, live, pathLabel(body?.path)) },
      ...sanitizeHistory(body?.history),
      { role: 'user', content: question },
    ];

    const raw = await runModel(env, s.model, messages);
    const parsed = extractJson(raw);

    let text = parsed?.text?.trim() || raw.trim() || '花傩一时没能作答，请换个问法试试。';
    const action = await resolveAction(parsed?.action, env);

    const out = { ok: true, text };
    if (action) out.action = action;
    if (sources.length) out.sources = sources;

    ctx.waitUntil(logChat(env, {
      question, answerLen: text.length, actionType: action ? 'open_page' : null,
      sources: sources.length ? JSON.stringify(sources) : null,
      durationMs: Date.now() - t0, ip,
      vid: readCookie(request.headers.get('cookie') || '', 'vid'),
    }));
    return aiJson(out);
  } catch (err) {
    console.error('ai chat failed:', err);
    // 用量照记：便于从日志观察失败率
    ctx.waitUntil(logChat(env, {
      question, answerLen: 0, actionType: null, sources: null,
      durationMs: Date.now() - t0, ip,
      vid: readCookie(request.headers.get('cookie') || '', 'vid'),
    }).catch(() => {}));
    const timeout = String(err?.message || '').includes('timeout');
    return aiJson({
      ok: false, error: 'ai_error',
      text: timeout ? '花傩想得有点久，请稍后再问一次。' : '花傩暂时不在，请稍后再试。',
    });
  }
}

/** 前端配置：公开端点只暴露招呼语与快捷问题，设置缓存复用 */
export async function handleAiConfig(env) {
  const s = await loadAiSettings(env);
  let quick = [];
  try { quick = JSON.parse(s.quick_questions || '[]'); } catch { /* 后台配坏则给空 */ }
  return aiJson({
    ok: true,
    enabled: s.enabled === '1',
    greeting: String(s.greeting || '').slice(0, 100),
    quick: quick.filter((q) => typeof q === 'string').map((q) => q.slice(0, 60)).slice(0, 6),
  });
}

/* ---------------- 生成链路 ---------------- */

/**
 * 推理通道：默认走 Workers AI binding（账号内推理，零密钥）；
 * binding 失败/超时且配置了 AI_API_BASE + AI_API_KEY（OpenAI 兼容 REST，secret）时自动兜底；
 * AI_PROVIDER=rest（如本地联调 binding 代理不可用）则直走 REST。
 */
async function runModel(env, model, messages) {
  const name = MODEL_ALLOW.has(model) ? model : MODEL_DEFAULT;
  const opts = { messages, max_tokens: 1200, temperature: 0.6 };
  // qwen3 系是推理模型：关掉思考直出答案（快 ~10 倍且不烧 token，本地 REST 实测有效；
  // 仅对 qwen 注入，其他模型不支持该参数）
  if (name.startsWith('@cf/qwen/')) opts.chat_template_kwargs = { enable_thinking: false };

  const callBinding = () => env.AI.run(name, opts);
  const callRest = () => openaiCompat(env, name, opts);

  let result;
  if (env.AI_PROVIDER === 'rest') {
    result = await withTimeout(callRest());
  } else {
    try {
      result = await withTimeout(callBinding());
    } catch (err) {
      console.error('AI binding failed, fallback to REST:', err?.message || err);
      if (!env.AI_API_BASE || !env.AI_API_KEY) throw err;
      result = await withTimeout(callRest());
    }
  }

  // 绑定对 messages 输入返回 {response}；兜底 OpenAI 形状——关思考的 qwen3 答案
  // 会落在 reasoning 字段（REST 实测），一并兜住；最后剥 <think> 块
  let raw = String(
    result?.response ??
    result?.choices?.[0]?.message?.content ??
    result?.choices?.[0]?.message?.reasoning_content ??
    result?.choices?.[0]?.message?.reasoning ?? ''
  );
  raw = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  return raw;
}

function withTimeout(p) {
  return Promise.race([
    p,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), AI_TIMEOUT_MS)),
  ]);
}

/** OpenAI 兼容 REST 兜底（AI_API_BASE 形如 https://api.cloudflare.com/client/v4/accounts/<id>/ai/v1） */
async function openaiCompat(env, model, opts) {
  const res = await fetch(`${env.AI_API_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${env.AI_API_KEY}` },
    body: JSON.stringify({ model, ...opts }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`upstream ${res.status}: ${body.slice(0, 120)}`);
  }
  const data = await res.json();
  return data; // 提取逻辑与 binding 同路（choices[0].message）
}

function buildSystem(systemPrompt, matched, live, hereLabel) {
  const parts = [systemPrompt || '你是「花傩」，焰境·万载（whizzzest.com）的智能问答助手。'];

  if (hereLabel) parts.push(`[当前语境]\n用户正在浏览「${hereLabel}」页面，问题中的「这里/本页」即指该板块。`);

  if (matched.length) {
    parts.push('[参考知识]\n' + matched.map((k) => `[${k.category}]\n${k.content}`).join('\n\n'));
  }
  if (live) parts.push(live);

  parts.push(
    '回答要求：有参考知识/站内数据时严格依据其作答；' +
    '【防编造硬性要求】列举类问题（美食/景点/线路/特产等）只允许列出参考知识与站内数据中出现过的具体名称，' +
    '两者均未覆盖时绝不编造，改为说明资料暂未覆盖，并引导用户浏览对应栏目页或发邮件到 contact@whizzzest.com 咨询。' +
    '始终以 JSON 返回：{"text": "回复正文"}，需要引导跳转时附带 "action"' +
    '（{"type":"open_page","payload":{"route":"/路径"}} 或' +
    ' {"type":"open_merchant","payload":{"name":"商户名"}} 或' +
    ' {"type":"open_attraction","payload":{"name":"景点名"}}，名称须与站内数据完全一致）。' +
    'action 不要画蛇添足：仅当问题明确指向某个页面/商户/景点详情时才附带，一般的列举回答省略。'
  );
  return parts.join('\n\n');
}

/** 站内实时数据块：景点/商户/板块计数，每次问答现查（量小、保实时） */
async function loadLiveData(env) {
  try {
    const [attractions, merchants, counts] = await Promise.all([
      env.DB.prepare(
        `SELECT name, summary FROM attractions WHERE status='published' ORDER BY sort, id DESC LIMIT 8`
      ).all(),
      env.DB.prepare(
        `SELECT name, category, intro FROM merchants WHERE status='approved' ORDER BY sort_weight DESC, id DESC LIMIT 8`
      ).all(),
      env.DB.prepare(
        `SELECT
           (SELECT COUNT(*) FROM music_tracks WHERE status='published') AS music,
           (SELECT COUNT(*) FROM videos WHERE status='published') AS tv,
           (SELECT COUNT(*) FROM books WHERE status='approved') AS books`
      ).first(),
    ]);

    const lines = [];
    if (attractions.results?.length) {
      lines.push('上线景点：' + attractions.results.map((a) => `${a.name}（${a.summary}）`).join('；'));
    }
    if (merchants.results?.length) {
      lines.push('商户名录：' + merchants.results.map((m) => `${m.name}[${m.category}] ${m.intro}`.trim()).join('；'));
    }
    if (counts) {
      lines.push(`站内板块：万载音乐 ${counts.music} 首、万载TV ${counts.tv} 条视频、焰境文库 ${counts.books} 部作品（/music/ /tv/ /library/）`);
    }
    return lines.length ? '[站内实时数据]\n' + lines.join('\n') : '';
  } catch (err) {
    console.error('ai live data failed:', err);
    return ''; // 实时数据是增强项，失败不挡问答
  }
}

/* ---------------- 知识库检索（关键词命中计分 Top-3） ---------------- */

async function loadKnowledge(env) {
  const cache = ((globalThis.__aiCache ??= {}).__knowledge ??= { at: 0, rows: [] });
  if (Date.now() - cache.at < CACHE_TTL_MS) return cache.rows;
  const { results } = await env.DB.prepare(
    `SELECT id, category, content, keywords FROM ai_knowledge WHERE status='published' ORDER BY sort, id`
  ).all();
  cache.rows = (results || []).map((r) => ({
    id: r.id, category: r.category, content: r.content, keywords: r.keywords.split(','),
  }));
  cache.at = Date.now();
  return cache.rows;
}

function retrieveKnowledge(question, rows) {
  const q = question.toLowerCase();
  return rows
    .map((k) => {
      let score = k.keywords.reduce((n, kw) => n + (kw && q.includes(kw.toLowerCase()) ? 1 : 0), 0);
      // 中文无分词：类目名按两字滑窗切词（美食特产 → 美食/食特/特产）命中小问 +2，
      // 让「必吃美食」这类泛问命中对应类目（种子关键词同步做了泛词补充）
      for (let i = 0; i + 2 <= k.category.length; i++) {
        if (q.includes(k.category.slice(i, i + 2).toLowerCase())) { score += 2; break; }
      }
      return { k, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((x) => x.k);
}

/* ---------------- 设置（60s 缓存） ---------------- */

async function loadAiSettings(env) {
  const cache = ((globalThis.__aiCache ??= {}).__settings ??= { at: 0, map: null });
  if (cache.map && Date.now() - cache.at < CACHE_TTL_MS) return cache.map;
  const { results } = await env.DB.prepare('SELECT key, value FROM ai_settings').all();
  const map = { ...SETTINGS_DEFAULTS };
  for (const row of results || []) map[row.key] = row.value;
  cache.map = map;
  cache.at = Date.now();
  return map;
}

/* ---------------- Action 白名单落地 ---------------- */

/**
 * 模型产出的 action 一律服务端校验并归一成 open_page：
 *  - open_page：route 必须命中站内路由白名单
 *  - open_merchant / open_attraction：名称查 D1 拿 slug，拼详情页路径
 * 校验不过返回 null（降级为纯文本回答），前端只见到 open_page 一种。
 */
async function resolveAction(action, env) {
  if (!action || typeof action !== 'object') return null;
  const type = action.type;
  const payload = action.payload && typeof action.payload === 'object' ? action.payload : {};

  if (type === 'open_page') {
    const route = String(payload.route || '');
    return PAGE_ROUTE_RE.test(route) ? { type: 'open_page', payload: { route } } : null;
  }

  if (type === 'open_merchant' || type === 'open_attraction') {
    const name = String(payload.name || '').trim().slice(0, 50);
    if (!name || /[\\%_]/.test(name)) return null; // 防 LIKE 通配注入
    const table = type === 'open_merchant' ? 'merchants' : 'attractions';
    const statusCol = type === 'open_merchant' ? 'approved' : 'published';
    try {
      const row = await env.DB.prepare(
        `SELECT slug FROM ${table} WHERE status='${statusCol}' AND name = ?1 LIMIT 1`
      ).bind(name).first()
        ?? await env.DB.prepare(
          `SELECT slug FROM ${table} WHERE status='${statusCol}' AND name LIKE '%' || ?1 || '%' LIMIT 1`
        ).bind(name).first();
      if (!row?.slug) return null;
      const base = type === 'open_merchant' ? '/merchants/' : '/attractions/';
      return { type: 'open_page', payload: { route: base + row.slug } };
    } catch (err) {
      console.error('ai action resolve failed:', err);
      return null;
    }
  }
  return null;
}

/* ---------------- 杂项 ---------------- */

/** 多轮历史：仅收 user/assistant 纯文本，截断防提示词膨胀 */
function sanitizeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-HISTORY_TURNS)
    .map((m) => ({ role: m.role, content: m.content.trim().slice(0, HISTORY_ITEM_MAX) }));
}

/** 剥 ```json 围栏后解析 {text, action}；text 里再嵌一层 JSON 时解一层；解析不出返回 null */
function extractJson(raw) {
  if (!raw) return null;
  const fence = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  let p = tryParse(fence ? fence[1].trim() : raw.trim());
  // 模型偶尔把 {"text":"{\"text\":...}"} 双层嵌套——剥一层
  if (p && typeof p.text === 'string' && p.text.trimStart().startsWith('{')) {
    const inner = tryParse(p.text.trim());
    if (inner && typeof inner.text === 'string') p = inner;
  }
  return p && typeof p.text === 'string' ? p : null;
}

function tryParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

/** 同 isolate 滑动窗口限流（与 index.js contact 同思路，独立计数） */
const recentAsk = new Map();
function aiRateLimited(ip) {
  const now = Date.now();
  const hits = (recentAsk.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  hits.push(now);
  recentAsk.set(ip, hits);
  if (recentAsk.size > 5000) recentAsk.clear();
  return hits.length > RATE_MAX;
}

function readCookie(cookieHeader, name) {
  return (cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([A-Za-z0-9-]{8,64})`)) || [])[1] || '';
}

async function logChat(env, row) {
  try {
    await env.DB.prepare(
      `INSERT INTO ai_chats (question, answer_len, action, sources, duration_ms, ip, vid)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
    ).bind(row.question, row.answerLen, row.actionType, row.sources, row.durationMs, row.ip, row.vid).run();
  } catch (err) {
    console.error('ai chat log failed:', err);
  }
}

function aiJson(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
