/**
 * AI 助手「花傩」（docs/AI助手方案.md）
 *
 *  - POST /api/ai/chat   问答主接口：限流 → 知识库混合检索（关键词 + Vectorize 语义 + 实体名）
 *                        + 站内实时数据注入 → 最近 6 条多轮历史 → Workers AI binding（模型后台可切）→
 *                        JSON {text, action}（action 白名单校验后落成 open_page）→ 用量日志
 *  - GET  /api/ai/config 前端配置（公开）：{enabled, greeting, quick}，不含提示词/模型名
 *
 * 设计取舍：
 *  - 非流式 + 前端打字机（与旧站一致，SSE 流式列 M2）
 *  - 推理默认走 AI binding（零密钥），配置 AI_API_BASE/AI_API_KEY secret 后自动获得
 *    OpenAI 兼容 REST 兜底；AI_PROVIDER=rest 直走 REST（本地联调用，.dev.vars 配置）
 *  - 检索 v2（2026-09-08）：关键词计分（keywords + 类目滑窗 + 正问滑窗互证）∪ 向量语义
 *    （@cf/qwen/qwen3-embedding-0.6b → Vectorize whizzzest-ai-knowledge）∪ 实体名直配
 *    （全部上线景点/认证商户，修实时数据只注入 Top8 的盲区）；语义通道失败自动退纯关键词
 *  - 向量懒同步：每问后台比对 describe().vectorCount 与 D1 published 数（60s 缓存），
 *    不一致或 admin 置 vec_dirty 脏标记时全量重嵌入（admin 增删改知识时也即时维护单条）
 *  - 日额度熔断：当日 ai_chats 超过 AI_DAILY_CAP（默认 500，免费额度 ≈450 问）后降级
 *    纯检索模式——直接返回命中的知识库原文，不再调模型，功能不断、成本归零
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

/* 语义检索（v1.2）：向量维度 1024 必须与索引 whizzzest-ai-knowledge 一致（建后不可改） */
const EMBED_MODEL = '@cf/qwen/qwen3-embedding-0.6b';
const EMBED_BATCH = 32;                  // 每次嵌入文本条数上限（Workers AI 批量限制内）
const EMBED_TEXT_MAX = 400;              // 入向量文本截断
const VEC_TOPK = 5;
const SEM_FLOOR = 0.42;                  // 余弦地板：线上实测相关 ≥0.45、噪声 ≤0.40，卡中间（2026-09-08 校准）
const SEM_WEIGHT = 12;                   // 语义 0.57 ≈ 1.8 分、0.67 ≈ 3 分、0.79 ≈ 4.4 分
const ENTITY_SCORE = 4;                  // 实体名直配得分（高于一般关键词命中，保证进 Top-3）
const DAILY_CAP = 500;                   // 当日问答上限（免费额度 ≈450 问），AI_DAILY_CAP 可覆盖

/** open_page 白名单：仅站内真实路由（含既有静态子页与动态板块） */
export const PAGE_ROUTE_RE = new RegExp(
  '^(?:/|(?:/(?:about|cuisine|heritage|industry|spots|tourism|pay|merchants|library|music|attractions|tv|digital-fireworks)' +
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
  ['/tourism', '旅游线路专题'], ['/digital-fireworks', '数字烟花模拟器'],
  ['/about', '关于本站'], ['/pay', '付费合作'],
];
function pathLabel(pathname) {
  const p = String(pathname || '');
  if (!p.startsWith('/') || p.length > 100) return '';
  for (const [prefix, label] of PAGE_LABELS) {
    if (p === prefix || p.startsWith(prefix + '/')) return label;
  }
  return '';
}

/** 泛词映射：口语问法 → 知识库关键词域（检索用，不进提示词；命中即把右值拼到检索串末尾） */
const SYNONYMS = {
  好吃: '美食', 吃: '美食', 小吃: '美食', 早餐: '美食', 夜宵: '美食',
  好玩: '景点 游玩', 玩: '景点 游玩', 去哪: '景点 线路', 打卡: '景点',
  门票: '票价 收费 开放', 多少钱: '价格 收费',
  带娃: '亲子 家庭', 带孩子: '亲子 家庭',
  烟花秀: '烟花 表演', 放烟花: '烟花',
  怎么去: '交通 到达', 坐车: '交通 到达', 停车: '交通 停车场',
  住: '住宿 酒店', 历史: '历史文化', 由来: '历史 起源',
};

/** 正问滑窗互证的停用窗：避免「什么/怎么」这类虚词给所有条目均匀加分 */
const CONTENT_STOP = new Set([
  '什么', '怎么', '哪里', '哪些', '可以', '有没有', '多少', '推荐', '介绍', '请问',
  '你们', '我们', '这个', '那个', '还是', '以及', '还有', '时候', '现在', '今天', '是不是', '一下',
]);

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
    const capped = await overDailyCap(env);
    const [knowledge, live] = await Promise.all([
      loadKnowledge(env),
      capped ? Promise.resolve(null) : loadLiveData(env),
    ]);

    // 语义通道：失败不挡问答（退纯关键词）；熔断时跳过省嵌入开销
    let semHits = [];
    if (!capped && env.VEC) {
      try { semHits = await semanticHits(env, question); }
      catch (err) { console.error('ai semantic query failed:', err?.message || err); }
    }

    const matched = retrieveKnowledge(question, knowledge, semHits, live ? live.entities : null);
    const sources = [...new Set(matched.map((k) => k.category))];

    // 日额度熔断：降级纯检索模式，直接回知识库原文，不再调模型
    if (capped) {
      const text = matched.length
        ? '今日问答额度已用完，花傩奉上知识库中最相关的内容供参考：\n\n' +
          matched.slice(0, 2).map((k) => `[${k.category}] ${k.content}`).join('\n\n')
        : '花傩今日问答额度已用完，请明天再来，或发邮件到 contact@whizzzest.com 咨询。';
      ctx.waitUntil(logChat(env, {
        question, answerLen: text.length, actionType: 'capped',
        sources: sources.length ? JSON.stringify(sources) : null,
        durationMs: Date.now() - t0, ip,
        vid: readCookie(request.headers.get('cookie') || '', 'vid'),
      }));
      const out = { ok: true, text };
      if (sources.length) out.sources = sources;
      return aiJson(out);
    }

    const messages = [
      { role: 'system', content: buildSystem(s.system_prompt, matched, live ? live.block : '', pathLabel(body?.path)) },
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

    ctx.waitUntil(syncVectors(env));
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

function buildSystem(systemPrompt, matched, liveBlock, hereLabel) {
  const parts = [systemPrompt || '你是「花傩」，焰境·万载（whizzzest.com）的智能问答助手。'];

  if (hereLabel) parts.push(`[当前语境]\n用户正在浏览「${hereLabel}」页面，问题中的「这里/本页」即指该板块。`);

  if (matched.length) {
    parts.push('[参考知识]\n' + matched.map((k) => `[${k.category}]\n${k.content}`).join('\n\n'));
  }
  if (liveBlock) parts.push(liveBlock);

  parts.push(
    '回答要求：有参考知识/站内数据时严格依据其作答；' +
    '【防编造硬性要求】列举类问题（美食/景点/线路/特产等）只允许列出参考知识与站内数据中出现过的具体名称，' +
    '两者均未覆盖时绝不编造，改为说明资料暂未覆盖，并引导用户浏览对应栏目页或发邮件到 contact@whizzzest.com 咨询。' +
    '始终以 JSON 返回：{"text": "回复正文"}，需要引导跳转时附带 "action"' +
    '（{"type":"open_page","payload":{"route":"/路径"}} 或' +
    ' {"type":"open_merchant","payload":{"name":"商户名"}} 或' +
    ' {"type":"open_attraction","payload":{"name":"景点名"}} 或' +
    ' {"type":"open_music","payload":{"name":"歌曲名"}}（仅当用户明确想听某首歌）或' +
    ' {"type":"open_firework","payload":{}}（用户想看烟花效果/放个烟花时），' +
    '名称须与站内数据完全一致）。' +
    'action 不要画蛇添足：仅当问题明确指向某个页面/商户/景点/歌曲时才附带，一般的列举回答省略。'
  );
  return parts.join('\n\n');
}

/* ---------------- 嵌入与向量同步（检索 v2） ---------------- */

/** 文本批量嵌入：binding 优先，REST 兜底；统一返回浮点数组（每个文本一条 1024 维向量） */
async function embedTexts(env, texts) {
  const callBinding = () => env.AI.run(EMBED_MODEL, { text: texts });
  const callRest = async () => {
    const res = await fetch(`${env.AI_API_BASE}/embeddings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.AI_API_KEY}` },
      body: JSON.stringify({ model: EMBED_MODEL, input: texts }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`embed upstream ${res.status}: ${body.slice(0, 120)}`);
    }
    return res.json();
  };

  let result;
  if (env.AI_PROVIDER === 'rest') {
    result = await withTimeout(callRest());
  } else {
    try {
      result = await withTimeout(callBinding());
    } catch (err) {
      if (!env.AI_API_BASE || !env.AI_API_KEY) throw err;
      result = await withTimeout(callRest());
    }
  }
  // binding 形状 {data:[[...]]}；REST 形状 {data:[{embedding:[...]}]}
  if (Array.isArray(result?.data) && Array.isArray(result.data[0])) return result.data;
  if (Array.isArray(result?.data) && Array.isArray(result.data[0]?.embedding)) {
    return result.data.map((d) => d.embedding);
  }
  throw new Error('embedding shape unexpected');
}

/** 知识条目 → 入向量文本（类目前置给语义信号，截断控成本） */
function embedInput(row) {
  return `${row.category}\n${row.content}`.slice(0, EMBED_TEXT_MAX);
}

/** 问题 → Vectorize Top-K：命中向量 id 形如 k<知识id>，映射回数字 id 交混合归并 */
async function semanticHits(env, question) {
  const [vec] = await embedTexts(env, [question]);
  const res = await env.VEC.query(vec, {
    topK: VEC_TOPK,
    returnMetadata: 'none',
    filter: { status: 'published' },
  });
  return (res?.matches || [])
    .map((m) => ({ id: Number(String(m.id).slice(1)), score: Number(m.score) || 0 }))
    .filter((m) => m.id > 0);
}

/**
 * 向量懒同步：describe 计数与 D1 published 数一致且无脏标记则跳过（60s 缓存）；
 * 否则全量重嵌入上架（停用条目同时下架向量）。admin 侧单条增删改即时维护，
 * 这里兜底首注与漂移；失败不缓存、下一问重试，失败期间问答自动退纯关键词。
 */
async function syncVectors(env) {
  if (!env.VEC || !env.AI) return;
  const cache = ((globalThis.__aiCache ??= {}).__vec ??= { at: 0 });
  if (Date.now() - cache.at < CACHE_TTL_MS) return;
  cache.at = Date.now();
  try {
    const info = await env.VEC.describe();
    const { n, dirty } = await env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM ai_knowledge WHERE status='published') AS n,
         (SELECT COUNT(*) FROM ai_settings WHERE key='vec_dirty' AND value='1') AS dirty`
    ).first();
    if (info?.vectorCount === n && !dirty) return;

    const { results: rows } = await env.DB.prepare(
      `SELECT id, category, content FROM ai_knowledge WHERE status='published' ORDER BY id`
    ).all();
    const { results: hidden } = await env.DB.prepare(
      `SELECT id FROM ai_knowledge WHERE status='hidden'`
    ).all();
    for (let i = 0; i < (hidden || []).length; i += 500) {
      await env.VEC.deleteByIds(hidden.slice(i, i + 500).map((r) => 'k' + r.id));
    }
    for (let i = 0; i < (rows || []).length; i += EMBED_BATCH) {
      const chunk = rows.slice(i, i + EMBED_BATCH);
      const embs = await embedTexts(env, chunk.map(embedInput));
      const vectors = chunk.map((r, j) => ({
        id: 'k' + r.id, values: embs[j], metadata: { status: 'published', kid: r.id },
      }));
      for (let v = 0; v < vectors.length; v += 100) {
        await env.VEC.upsert(vectors.slice(v, v + 100));
      }
    }
    if (dirty) {
      await env.DB.prepare(`DELETE FROM ai_settings WHERE key='vec_dirty'`).run();
    }
  } catch (err) {
    cache.at = 0; // 不缓存失败态，下一问重试
    console.error('ai vector sync failed:', err?.message || err);
  }
}

/* ---------------- 检索 v2：关键词 ∪ 语义 ∪ 实体名（纯函数，Node 可测） ---------------- */

/** 泛词扩展：口语问法把映射词拼到检索串，召回不进提示词 */
export function expandQuery(q) {
  let extra = '';
  for (const term in SYNONYMS) {
    if (q.includes(term)) extra += ' ' + SYNONYMS[term];
  }
  return extra ? q + extra : q;
}

/**
 * 关键词计分：keywords 命中 +1（对扩展串）；类目名两字滑窗 +2；
 * 正问两字滑窗（滤虚词）与正文互证 +1（独立计，不依赖 keywords 命中）——
 * keywords 挑漏的条目仍可凭正文捞回
 */
export function scoreKnowledge(q, rows) {
  const qe = expandQuery(q);
  const out = [];
  for (const k of rows || []) {
    let score = (k.keywords || []).reduce(
      (n, kw) => n + (kw && qe.includes(String(kw).toLowerCase()) ? 1 : 0), 0
    );
    for (let i = 0; i + 2 <= k.category.length; i++) {
      if (qe.includes(k.category.slice(i, i + 2).toLowerCase())) { score += 2; break; }
    }
    const body = String(k.content || '').toLowerCase();
    for (let i = 0; i + 2 <= q.length; i++) {
      const w = q.slice(i, i + 2);
      if (!CONTENT_STOP.has(w) && body.includes(w)) { score += 1; break; }
    }
    if (score > 0) out.push({ k, score });
  }
  return out.sort((a, b) => b.score - a.score);
}

/**
 * 混合归并 Top-3：关键词分 ∪ 语义分（余弦过 SEM_FLOOR 地板后放大）∪ 实体名直配。
 * 实体（景点/商户）按名称字面命中注入合成条目，修实时数据只注入 Top8 的盲区。
 */
export function retrieveKnowledge(question, rows, semHits = [], entities = null) {
  const q = String(question || '').toLowerCase();
  const byId = new Map();
  for (const { k, score } of scoreKnowledge(q, rows)) byId.set(k.id, { k, score });
  for (const h of semHits || []) {
    const k = (rows || []).find((r) => r.id === h.id);
    if (!k) continue;
    const s = Math.max(0, (h.score - SEM_FLOOR) * SEM_WEIGHT);
    if (s <= 0) continue;
    const cur = byId.get(k.id);
    if (cur) cur.score += s;
    else byId.set(k.id, { k, score: s });
  }
  for (const e of entities || []) {
    const name = String(e.name || '');
    if (name.length < 2 || !q.includes(name.toLowerCase())) continue;
    byId.set('e' + name, {
      k: {
        id: 'e' + name,
        category: e.kind === 'merchant' ? '商户' : '景点',
        content: name + (e.info ? `（${e.info}）` : ''),
        keywords: [],
      },
      score: ENTITY_SCORE,
    });
  }
  return [...byId.values()].sort((a, b) => b.score - a.score).slice(0, 3).map((x) => x.k);
}

/* ---------------- 站内实时数据 + 实体池 ---------------- */

/**
 * 站内实时数据块：景点/商户/板块计数，每次问答现查（量小、保实时）。
 * v1.2 起取全量（上限 100）：Top8 带简介注入提示词，全部名称拼一行兜列举类问题，
 * 同时产出实体池（name+info）供检索直配——问第 9 个之后的景点也能命中。
 */
async function loadLiveData(env) {
  try {
    const [attractions, merchants, counts] = await Promise.all([
      env.DB.prepare(
        `SELECT name, summary FROM attractions WHERE status='published' ORDER BY sort, id DESC LIMIT 100`
      ).all(),
      env.DB.prepare(
        `SELECT name, category, intro FROM merchants WHERE status='approved' ORDER BY sort_weight DESC, id DESC LIMIT 100`
      ).all(),
      env.DB.prepare(
        `SELECT
           (SELECT COUNT(*) FROM music_tracks WHERE status='published') AS music,
           (SELECT COUNT(*) FROM videos WHERE status='published') AS tv,
           (SELECT COUNT(*) FROM books WHERE status='approved') AS books`
      ).first(),
    ]);

    const aRows = attractions.results || [];
    const mRows = merchants.results || [];
    const lines = [];
    if (aRows.length) {
      const top = aRows.slice(0, 8).map((a) => `${a.name}（${a.summary}）`).join('；');
      lines.push('上线景点：' + top);
      if (aRows.length > 8) {
        lines.push('全部上线景点（共 ' + aRows.length + ' 处）：' + aRows.map((a) => a.name).join('、'));
      }
    }
    if (mRows.length) {
      const top = mRows.slice(0, 8).map((m) => `${m.name}[${m.category}] ${m.intro}`.trim()).join('；');
      lines.push('商户名录：' + top);
      if (mRows.length > 8) {
        lines.push('全部认证商户（共 ' + mRows.length + ' 家）：' + mRows.map((m) => m.name).join('、'));
      }
    }
    if (counts) {
      lines.push(`站内板块：万载音乐 ${counts.music} 首、万载TV ${counts.tv} 条视频、焰境文库 ${counts.books} 部作品（/music/ /tv/ /library/）`);
    }

    const entities = [
      ...aRows.map((a) => ({ kind: 'attraction', name: a.name, info: String(a.summary || '').slice(0, 60) })),
      ...mRows.map((m) => ({
        kind: 'merchant',
        name: m.name,
        info: (m.category ? `[${m.category}] ` : '') + String(m.intro || '').slice(0, 60),
      })),
    ].filter((e) => e.name && e.name.length >= 2);

    return {
      block: lines.length ? '[站内实时数据]\n' + lines.join('\n') : '',
      entities,
    };
  } catch (err) {
    console.error('ai live data failed:', err);
    return { block: '', entities: [] }; // 实时数据是增强项，失败不挡问答
  }
}

/* ---------------- 知识库加载（60s 缓存） ---------------- */

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

/* ---------------- 日额度熔断（60s 缓存） ---------------- */

async function overDailyCap(env) {
  const cap = Number(env.AI_DAILY_CAP) > 0 ? Number(env.AI_DAILY_CAP) : DAILY_CAP;
  const cache = ((globalThis.__aiCache ??= {}).__cap ??= { at: 0, hit: false });
  if (Date.now() - cache.at < CACHE_TTL_MS) return cache.hit;
  cache.at = Date.now();
  try {
    // UTC 日界，与北京时间差 8 小时——额度用途足够近似
    const { n } = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM ai_chats WHERE created_at >= datetime('now', 'start of day')`
    ).first();
    cache.hit = (n || 0) >= cap;
  } catch (err) {
    cache.hit = false; // 统计失败不拦问答
  }
  return cache.hit;
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
 *  - open_music：歌曲名查 D1 拿 id，拼 /music/?t=<id> 深链（音乐页自动播放）
 *  - open_firework：固定跳数字烟花模拟器
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

  if (type === 'open_firework') {
    return { type: 'open_page', payload: { route: '/digital-fireworks/' } };
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

  if (type === 'open_music') {
    const name = String(payload.name || '').trim().slice(0, 50);
    if (!name || /[\\%_]/.test(name)) return null;
    try {
      const row = await env.DB.prepare(
        `SELECT id FROM music_tracks WHERE status='published' AND title = ?1 LIMIT 1`
      ).bind(name).first()
        ?? await env.DB.prepare(
          `SELECT id FROM music_tracks WHERE status='published' AND title LIKE '%' || ?1 || '%' LIMIT 1`
        ).bind(name).first();
      return row?.id ? { type: 'open_page', payload: { route: '/music/?t=' + row.id } } : null;
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
