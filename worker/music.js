/**
 * /music/* 万载音乐（2026-09-06）
 *  - GET /music/                    播放器页（正在播放面板 + 曲目列表 + 底部固定播放条，焰棕深色影院风）
 *  - POST /api/music/play/<id>      播放计数（前端开始播放一首时回报一次，非阻塞 UPDATE）
 *
 * 内容以 D1 为权威（music_tracks，admin「音乐」Tab 直传 MP3）：后台发布即时生效，对标 /tv/*。
 * 音频/封面存 R2 whizzzest-media（music/ 前缀），经主站 /media/* 代理公开读取——
 * 代理已支持 Range，<audio> 拖进度条 seek 直接可用。
 * 页面只出列表与数据（data-* 属性），播放器交互逻辑在 main.js（单 <audio> 复用 + MediaSession）。
 */

const SITE_URL = 'https://whizzzest.com';

const PUB_WHERE = "status = 'published'";

export async function handleMusic(request, env, url, ctx) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(null, { status: 405, headers: { allow: 'GET' } });
  }
  if (url.pathname.replace(/\/+$/, '') === '/music') return musicHome(env, url, ctx);
  return notFound(env, url);
}

/** 播放计数：POST /api/music/play/<id>（页面加载后每首开始播放时回报一次） */
export async function handleMusicPlay(request, env, url) {
  if (request.method !== 'POST') {
    return new Response(null, { status: 405, headers: { allow: 'POST' } });
  }
  const m = url.pathname.match(/^\/api\/music\/play\/(\d+)$/);
  if (!m) return new Response(null, { status: 404 });
  try {
    await env.DB.prepare(`UPDATE music_tracks SET plays = plays + 1 WHERE id = ?1 AND ${PUB_WHERE}`)
      .bind(Number(m[1]))
      .run();
  } catch { /* 计数失败不影响播放 */ }
  return new Response(null, { status: 204 });
}

/* ---------------- 数据 ---------------- */

const mCover = (c) => (c ? (c.startsWith('/') ? c : '/media/' + c) : '');
const mAudio = (k) => '/media/' + k;

/** 秒 → "3:24" / "1:02:33"；无时长返回空串 */
function fmtDur(sec) {
  sec = Number(sec) || 0;
  if (sec <= 0) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const p = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`;
}

/** 秒 → ISO8601（MusicPlaylist JSON-LD 用） */
function isoDur(sec) {
  sec = Number(sec) || 0;
  if (sec <= 0) return undefined;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return 'PT' + (m ? m + 'M' : '') + s + 'S';
}

/* ---------------- 播放器页 ---------------- */

async function musicHome(env, url, ctx) {
  const chrome = await getChrome(env);
  const { results } = await env.DB
    .prepare(`SELECT * FROM music_tracks WHERE ${PUB_WHERE} ORDER BY sort, id`)
    .all();
  const tracks = results || [];

  const totalDur = tracks.reduce((acc, t) => acc + (Number(t.duration) || 0), 0);
  const totalPlays = tracks.reduce((acc, t) => acc + (Number(t.plays) || 0), 0);

  const items = tracks
    .map((t, i) => {
      const cover = mCover(t.cover);
      const dur = fmtDur(t.duration);
      return `<li class="music-item" data-id="${t.id}" data-src="${esc(mAudio(t.file_key))}" data-title="${esc(t.title)}" data-artist="${esc(t.artist || '')}" data-cover="${esc(cover)}">
        <button class="music-no" type="button" aria-label="播放：${esc(t.title)}"><span class="music-idx">${String(i + 1).padStart(2, '0')}</span><span class="music-eq" aria-hidden="true"><i></i><i></i><i></i></span></button>
        <span class="music-thumb">${cover ? `<img src="${esc(cover)}" alt="" loading="lazy" decoding="async">` : '<span class="tv-ph" aria-hidden="true">焰</span>'}</span>
        <span class="music-item-body"><b>${esc(t.title)}</b><i>${esc(t.artist || '佚名')}</i></span>
        <span class="music-item-dur">${dur || '--:--'}</span>
      </li>`;
    })
    .join('');

  const listHtml = tracks.length
    ? `<ol class="music-list" id="music-list">${items}</ol>`
    : `<div class="music-empty"><p>曲目录入中，敬请期待。</p><p class="sub">得胜鼓、纸棚山歌、开口傩……万载的声音正在路上。</p></div>`;

  const first = tracks[0];
  const nowCover = first ? mCover(first.cover) : '';
  const body = `
    <div class="music-page">
    <section class="music-hero">
      <div class="container-wide">
        <p class="music-kicker">万载音乐 · WANZHAI MUSIC</p>
        <h1>听万载 · 山歌鼓乐入焰来</h1>
        <p class="music-sub">${tracks.length ? `${tracks.length} 首曲目${totalDur ? ' · 约 ' + Math.max(1, Math.round(totalDur / 60)) + ' 分钟' : ''}${totalPlays ? ' · 已播放 ' + totalPlays.toLocaleString('zh-CN') + ' 次' : ''}` : '万载的声音，正在路上'}</p>
      </div>
    </section>
    <section class="music-main"><div class="container-wide">
      <div class="music-layout">
        <aside class="music-now">
          <div class="music-cover" id="music-cover">${nowCover ? `<img src="${esc(nowCover)}" alt="" loading="eager" fetchpriority="high">` : '<span class="tv-ph" aria-hidden="true">焰</span>'}</div>
          <div class="music-now-info">
            <h2 id="music-now-title">${esc(first ? first.title : '万载音乐')}</h2>
            <p id="music-now-artist">${esc(first ? first.artist || '佚名' : '等待第一首曲目')}</p>
            <p class="music-now-meta" id="music-now-meta">点击曲目开始播放</p>
          </div>
        </aside>
        <div class="music-list-wrap">${listHtml}</div>
      </div>
    </div></section>
    <div class="music-bar" id="music-bar" ${tracks.length ? '' : 'hidden'}>
      <div class="music-bar-inner">
        <audio id="music-audio" preload="metadata"></audio>
        <span class="music-bar-cover" id="music-bar-cover" aria-hidden="true">${nowCover ? `<img src="${esc(nowCover)}" alt="">` : '<span class="tv-ph">焰</span>'}</span>
        <button class="music-ctl" id="music-prev" type="button" aria-label="上一首"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 6h2v12H7zM18 6v12l-8.5-6z"/></svg></button>
        <button class="music-ctl music-toggle" id="music-toggle" type="button" aria-label="播放"><svg class="i-play" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg><svg class="i-pause" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg></button>
        <button class="music-ctl" id="music-next" type="button" aria-label="下一首"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6h2v12h-2zM6 6l8.5 6L6 18z"/></svg></button>
        <span class="music-time" id="music-tcur">0:00</span>
        <input class="music-seek" id="music-seek" type="range" min="0" max="1000" value="0" step="1" aria-label="播放进度">
        <span class="music-time" id="music-tend">${first ? fmtDur(first.duration) || '0:00' : '0:00'}</span>
        <button class="music-ctl music-loop" id="music-loop" type="button" aria-label="列表循环（开）" aria-pressed="true"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/></svg></button>
        <input class="music-vol" id="music-vol" type="range" min="0" max="100" value="100" aria-label="音量">
      </div>
    </div>
    </div>`;

  const jsonLd = tracks.length
    ? {
        '@context': 'https://schema.org',
        '@type': 'MusicPlaylist',
        name: '万载音乐',
        url: `${SITE_URL}/music/`,
        numTracks: tracks.length,
        track: tracks.slice(0, 30).map((t) => ({
          '@type': 'MusicRecording',
          name: t.title,
          ...(t.artist ? { byArtist: { '@type': 'Person', name: t.artist } } : {}),
          ...(Number(t.duration) > 0 ? { duration: isoDur(t.duration) } : {}),
        })),
      }
    : null;

  return htmlResponse(
    pageShell(chrome, {
      title: '万载音乐 — 得胜鼓 / 纸棚山歌 / 开口傩 在线收听 | 焰境·万载',
      description:
        '万载音乐在线收听：得胜鼓、纸棚山歌、开口傩等万载民间音乐——山歌鼓乐入焰来，一朝相逢，便是万载。',
      url: `${SITE_URL}/music/`,
      jsonLd,
      body,
    })
  );
}

/* ---------------- 页面骨架（对标 tv.js；body 加 music-body 类给固定播放条留白） ---------------- */

async function getChrome(env) {
  if (getChrome.c) return getChrome.c;
  const asset = (p) => env.ASSETS.fetch(new Request('https://assets.whizzzest.local' + p));
  const [header, footer, meta] = await Promise.all([
    asset('/partials/header.html').then((r) => r.text()),
    asset('/partials/footer.html').then((r) => r.text()),
    asset('/build-meta.json').then((r) => r.json()),
  ]);
  getChrome.c = { header, footer, meta };
  return getChrome.c;
}

function pageShell(chrome, { title, description, url, body, jsonLd }) {
  const cssV = chrome.meta['/assets/css/style.css'] || '';
  const jsV = chrome.meta['/assets/js/main.js'] || '';
  const ogImage = '/assets/img/longhu_yanhuowanhui.jpeg';
  const ld = jsonLd
    ? `  <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>\n`
    : '';
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <link rel="canonical" href="${esc(url)}">
  <meta name="theme-color" content="#2b1208">
  <meta property="og:site_name" content="焰境·万载">
  <meta property="og:type" content="music.playlist">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${esc(url)}">
  <meta property="og:image" content="${SITE_URL}${ogImage}">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link rel="stylesheet" href="/assets/css/style.css?v=${esc(cssV)}">
${ld}</head>
<body class="music-body">
  ${chrome.header}
  <main id="main">
${body}
  </main>
  ${chrome.footer}
  <script type="module" src="/assets/js/main.js?v=${esc(jsV)}"></script>
</body>
</html>`;
}

async function notFound(env, url) {
  const r = await env.ASSETS.fetch(new Request(new URL('/404.html', url.origin)));
  return new Response(r.body, { status: 404, headers: r.headers });
}

/** HTML 响应；逐次计访客（index.js 统一处理），不做边缘缓存（后台发布即时生效） */
function htmlResponse(html) {
  return new Response(html, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' },
  });
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
