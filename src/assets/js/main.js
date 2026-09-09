/**
 * main.js — 全站交互（导航 / 滚动浮现 / 年份）
 * 原生 ES Module，无依赖。
 */
'use strict';

/* JS 可用标记：滚动浮现等增强样式仅在 .js 下生效（无 JS 时内容直接可见） */
document.documentElement.classList.add('js');

/* 多语言（docs/英文版方案.md Phase 1）：build.js 按 locale 注入 window.__I18N（静态页）；
   Worker 动态页无注入 → 全部走代码内 zh 兜底。t('a.b', '兜底') 取串。 */
const I18N = window.__I18N || {};
const t = (path, fallback) => {
  const v = path.split('.').reduce((node, key) => (node == null ? undefined : node[key]), I18N);
  return v == null ? fallback : v;
};

/* 语言切换 href 运行时重写：Worker 动态页的页头来自构建期编译 partial（无当前页上下文），
   构建期只写对应语言首页的兜底 href；此处按「前缀 + 当前路径」重写为逐页互指
   （静态页构建期 href 与重写结果一致，重写幂等）。 */
const langIsZh = (document.documentElement.lang || 'zh-CN').toLowerCase().startsWith('zh');
for (const a of document.querySelectorAll('a[data-locale-switch]')) {
  const here = location.pathname + location.search;
  a.href = langIsZh
    ? (here === '/' ? '/en/' : `/en${here}`)
    : here.replace(/^\/en(?=\/|$)/, '') || '/';
}

/* 导航：汉堡菜单开合（抽屉在 header 外层，见 header.html 注释） */
const burger = document.querySelector('.nav-burger');
const drawer = document.getElementById('nav-drawer');

function setMenu(open) {
  if (!burger || !drawer) return;
  burger.setAttribute('aria-expanded', String(open));
  burger.setAttribute('aria-label', open ? t('a11y.closeMenu', '关闭菜单') : t('a11y.openMenu', '打开菜单'));
  drawer.classList.toggle('open', open);
}

burger?.addEventListener('click', () => {
  setMenu(burger.getAttribute('aria-expanded') !== 'true');
});

/* 点击菜单项 / Escape / 放大窗口时关闭 */
drawer?.addEventListener('click', (e) => {
  if (e.target instanceof Element && e.target.closest('a')) setMenu(false);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') setMenu(false);
});
window.addEventListener('resize', () => {
  if (window.innerWidth > 833) setMenu(false);
});

/* 当前页导航高亮（导航改版 v2.6：子页归属主题；带查询串的快捷链接不参与归属） */
const here = location.pathname.replace(/\/index\.html$/, '/');
const navThemeItems = [...document.querySelectorAll('.nav-item.has-menu')];

function hereMatches(href, strictPath) {
  try {
    const u = new URL(href || '', location.origin);
    if (u.origin !== location.origin) return false; // 外链（如 game.whizzzest.com）不参与当前页归属——其 pathname 可能恰为 /
    if (strictPath && u.search) return false;
    return u.pathname.replace(/\/index\.html$/, '/') === here;
  } catch {
    return false;
  }
}

for (const link of document.querySelectorAll('.nav-link')) {
  if (hereMatches(link.getAttribute('href'), false)) {
    link.setAttribute('aria-current', 'page');
  }
}
for (const item of navThemeItems) {
  const main = item.querySelector(':scope > .nav-link');
  if (!main || main.getAttribute('aria-current') === 'page') continue;
  const subs = [...item.querySelectorAll('.nav-panel-link')];
  if (subs.some((s) => hereMatches(s.getAttribute('href'), true))) {
    main.setAttribute('aria-current', 'page');
  }
}

/* 桌面下拉（Apple 式全宽面板）：hover 意图 + 键盘可达；触屏首击展开 */
const navHeader = document.querySelector('.nav');
const canHover = matchMedia('(hover: hover) and (pointer: fine)').matches;
let navCloseTimer = null;

function closeAllMenus() {
  clearTimeout(navCloseTimer);
  for (const item of navThemeItems) {
    item.classList.remove('open');
    item.querySelector(':scope > .nav-link')?.setAttribute('aria-expanded', 'false');
  }
}

function openNavItem(item) {
  if (item.classList.contains('open')) return;
  closeAllMenus();
  item.classList.add('open');
  item.querySelector(':scope > .nav-link')?.setAttribute('aria-expanded', 'true');
}

if (navHeader && navThemeItems.length) {
  const desktopMenu = () => canHover && window.innerWidth > 833;
  for (const item of navThemeItems) {
    item.addEventListener('mouseenter', () => {
      if (!desktopMenu()) return;
      clearTimeout(navCloseTimer);
      openNavItem(item);
    });
    item.addEventListener('mouseleave', () => {
      if (!desktopMenu()) return;
      clearTimeout(navCloseTimer);
      navCloseTimer = setTimeout(closeAllMenus, 140);
    });
    item.addEventListener('focusin', () => openNavItem(item));
    item.addEventListener('focusout', (e) => {
      if (e.relatedTarget instanceof Node && item.contains(e.relatedTarget)) return;
      navCloseTimer = setTimeout(closeAllMenus, 10);
    });
    // 触屏宽屏（无 hover）：首击展开面板，再击进主题主页；窄屏走抽屉链接正常跳转
    item.querySelector(':scope > .nav-link')?.addEventListener('click', (e) => {
      if (desktopMenu() && !item.classList.contains('open')) {
        e.preventDefault();
        openNavItem(item);
      }
    });
  }
  document.addEventListener('click', (e) => {
    if (e.target instanceof Element && !navHeader.contains(e.target)) closeAllMenus();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAllMenus();
  });
}

/* 移动抽屉手风琴（主题项点击展开子项） */
for (const btn of document.querySelectorAll('.nav-drawer-toggle')) {
  btn.addEventListener('click', () => {
    const li = btn.closest('.nav-drawer-item');
    if (!li) return;
    const open = btn.getAttribute('aria-expanded') === 'true';
    btn.setAttribute('aria-expanded', String(!open));
    li.classList.toggle('open', !open);
  });
}

/* 滚动浮现（尊重 prefers-reduced-motion） */
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const targets = document.querySelectorAll('.reveal');
if (reduceMotion || !('IntersectionObserver' in window)) {
  targets.forEach((el) => el.classList.add('in'));
} else {
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('in');
          io.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.12, rootMargin: '0px 0px -8% 0px' }
  );
  targets.forEach((el) => io.observe(el));
}

/* 页脚年份 */
for (const el of document.querySelectorAll('.js-year')) {
  el.textContent = String(new Date().getFullYear());
}

/* 二维码灯箱：页内 [data-qr] 单码直开；[data-qr-list] 分享二维码组，点击按权重随机展示一张（docs/分享二维码方案.md） */
const lightbox = document.getElementById('lightbox');
if (lightbox) {
  const lbImg = lightbox.querySelector('img');
  const lbCap = lightbox.querySelector('.lightbox-cap');
  const lbShare = lightbox.querySelector('.lightbox-share');
  const lbShareDl = lightbox.querySelector('#lb-share-dl');
  const lbShareShuffle = lightbox.querySelector('#lb-share-shuffle');
  let lastFocus = null;
  let shareList = null; // 非 null = 分享模式（操作区可见）
  let shareIdx = -1;
  let shareCap = '';

  // 优先取 WebP 变体（build.js 生成 <name>-800.webp）；没有该档（源图 <800px）时回退原图
  const setLbImg = (src, caption) => {
    const m = src.match(/^(\/assets\/img\/.+?)\.(jpe?g|png)$/i);
    if (m) {
      lbImg.onerror = () => {
        lbImg.onerror = null;
        lbImg.src = src;
      };
      lbImg.src = `${m[1]}-800.webp`;
    } else {
      lbImg.src = src;
    }
    lbImg.alt = caption || t('qr.defaultAlt', '二维码');
  };

  const showLb = () => {
    lastFocus = document.activeElement;
    lightbox.classList.add('open');
    document.body.style.overflow = 'hidden';
    lightbox.querySelector('.lightbox-close')?.focus();
  };

  const openLb = (src, caption) => {
    shareList = null;
    if (lbShare) lbShare.hidden = true;
    setLbImg(src, caption);
    lbCap.textContent = caption || '';
    showLb();
  };

  // 按 item.w 加权随机（缺省 1）；excludeIdx 供「换一张」避开当前图
  const pickShare = (excludeIdx) => {
    const total = shareList.reduce((sum, it, i) => (i === excludeIdx ? sum : sum + (it.w || 1)), 0);
    let r = Math.random() * total;
    for (let i = 0; i < shareList.length; i++) {
      if (i === excludeIdx) continue;
      r -= shareList[i].w || 1;
      if (r < 0) return i;
    }
    for (let i = 0; i < shareList.length; i++) if (i !== excludeIdx) return i; // 浮点兜底
    return 0;
  };

  const applyShare = (idx) => {
    shareIdx = idx;
    const item = shareList[idx];
    setLbImg(item.src, shareCap);
    // 下载恒指 JPG 原图（非 WebP 变体，通用格式）；文件名重命名在模板 download 属性
    lbShareDl.href = item.src;
  };

  const openShare = (list, caption) => {
    if (!lbShare || !lbShareDl || !Array.isArray(list) || list.length === 0) return;
    shareList = list;
    shareCap = caption;
    lbShare.hidden = false;
    applyShare(pickShare(-1));
    lbCap.textContent = caption || '';
    showLb();
  };

  const closeLb = () => {
    lightbox.classList.remove('open');
    document.body.style.overflow = '';
    shareList = null;
    shareIdx = -1;
    if (lbShare) lbShare.hidden = true;
    if (lbShareDl) lbShareDl.removeAttribute('href');
    lastFocus?.focus?.();
  };

  document.addEventListener('click', (e) => {
    const trigger = e.target instanceof Element ? e.target.closest('[data-qr],[data-qr-list]') : null;
    if (!trigger) return;
    if (trigger.dataset.qrList) {
      try {
        openShare(JSON.parse(trigger.dataset.qrList), trigger.dataset.cap || '');
      } catch {
        /* qrList 数据异常不弹窗（构建期已校验非空，此处运行时兜底） */
      }
    } else if (trigger.dataset.qr) {
      openLb(trigger.dataset.qr, trigger.dataset.cap || '');
    }
  });
  lbShareShuffle?.addEventListener('click', () => {
    if (shareList) applyShare(pickShare(shareIdx));
  });
  lightbox.addEventListener('click', (e) => {
    if (!(e.target instanceof Element) || !e.target.closest('.lightbox-body')) closeLb();
  });
  lightbox.querySelector('.lightbox-close')?.addEventListener('click', closeLb);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && lightbox.classList.contains('open')) closeLb();
  });
}

/* 首页 Hero 轮播（交叉淡入；无 JS / reduced-motion 时静止第一张） */
const carousel = document.getElementById('hero-carousel');
if (carousel && !reduceMotion) {
  const slides = [...carousel.querySelectorAll('.hero-slide')];
  const dots = [...document.querySelectorAll('.hero-dot')];
  let current = 0;
  let timer = null;

  // 非首屏轮播图按需加载：切到某张才赋 src（含 WebP srcset/sizes），首帧只拉第一张
  const activate = (i) => {
    const img = slides[((i % slides.length) + slides.length) % slides.length]?.querySelector('img');
    if (!img || !img.dataset.src) return;
    img.src = img.dataset.src;
    if (img.dataset.srcset) img.srcset = img.dataset.srcset;
    if (img.dataset.sizes) img.sizes = img.dataset.sizes;
    delete img.dataset.src;
  };

  const show = (i) => {
    current = (i + slides.length) % slides.length;
    activate(current);
    // 稍候预取下一张，不与当前张抢带宽
    setTimeout(() => activate(current + 1), 1500);
    slides.forEach((s, k) => s.classList.toggle('active', k === current));
    dots.forEach((d, k) => d.classList.toggle('active', k === current));
  };

  const play = () => {
    if (slides.length < 2) return;
    stop();
    timer = setInterval(() => show(current + 1), 5000);
  };
  const stop = () => timer && (clearInterval(timer), (timer = null));

  document.querySelector('.hero-arrow-prev')?.addEventListener('click', () => (show(current - 1), play()));
  document.querySelector('.hero-arrow-next')?.addEventListener('click', () => (show(current + 1), play()));
  dots.forEach((d, k) => d.addEventListener('click', () => (show(k), play())));
  carousel.closest('.hero')?.addEventListener('mouseenter', stop);
  carousel.closest('.hero')?.addEventListener('mouseleave', play);
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : play()));

  show(0);
  play();
} else {
  // 无轮播逻辑时保证第一张可见（.hero-slide:not(:first-child) 已隐藏其余）
  carousel?.querySelector('.hero-slide')?.classList.add('active');
}

/* 首页媒体条（焰境影像 / 景点精选 / 焰境仙曲）共用工具与拉取：
   失败或空数据回调 null，整块保持 hidden 不占位 */
const escT = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const stripDur = (sec) => {
  sec = Number(sec) || 0;
  if (sec <= 0) return '';
  const m = Math.floor(sec / 60);
  const s = String(sec % 60).padStart(2, '0');
  return `${m}:${s}`;
};
const stripFetch = (url) =>
  fetch(url)
    .then((r) => r.json())
    .then((d) => (d && d.ok && d.items && d.items.length ? d.items : null))
    .catch(() => null);

/* 首页「焰境影像」条：拉 /api/tv/latest 渲染最新视频 */
const tvStrip = document.getElementById('tv-strip');
if (tvStrip) {
  stripFetch('/api/tv/latest').then((items) => {
    if (!items) return;
    document.getElementById('tv-strip-row').innerHTML = items
      .map(
        (v) => `
        <a class="tv-card" href="/tv/${Number(v.id)}/">
          <div class="tv-media">${
            v.cover
              ? `<img src="${escT(v.cover)}" alt="${escT(v.title)}" loading="lazy" decoding="async">`
              : '<span class="tv-ph" aria-hidden="true">焰</span>'
          }${v.dur ? `<span class="tv-dur">${stripDur(v.dur)}</span>` : ''}</div>
          <h3>${escT(v.title)}</h3>
          <p class="tv-meta">${escT(v.cat)}</p>
        </a>`
      )
      .join('');
    tvStrip.hidden = false;
  });
}

/* 首页「景点精选」条：拉 /api/attractions/latest（编辑 sort 排序前 6） */
const attractStrip = document.getElementById('attract-strip');
if (attractStrip) {
  stripFetch('/api/attractions/latest').then((items) => {
    if (!items) return;
    document.getElementById('attract-strip-row').innerHTML = items
      .map(
        (a) => `
        <a class="home-at-card" href="/attractions/${escT(a.slug)}/">
          <div class="home-at-media">${
            a.cover
              ? `<img src="${escT(a.cover)}" alt="${escT(a.name)}" loading="lazy" decoding="async">`
              : '<span class="tv-ph" aria-hidden="true">游</span>'
          }</div>
          <div class="home-at-body"><h3>${escT(a.name)}</h3><p>${escT(a.tag)}</p></div>
        </a>`
      )
      .join('');
    attractStrip.hidden = false;
  });
}

/* 首页「焰境仙曲」条：拉 /api/music/latest（编辑 sort 排序前 6），点击深链 /music/?t= 直达播放 */
const musicStrip = document.getElementById('music-strip');
if (musicStrip) {
  stripFetch('/api/music/latest').then((items) => {
    if (!items) return;
    document.getElementById('music-strip-row').innerHTML = items
      .map(
        (t) => `
        <a class="home-mu-card" href="/music/?t=${Number(t.id)}">
          <div class="home-mu-media">${
            t.cover
              ? `<img src="${escT(t.cover)}" alt="${escT(t.title)}" loading="lazy" decoding="async">`
              : '<span class="tv-ph" aria-hidden="true">焰</span>'
          }${t.dur ? `<span class="tv-dur">${stripDur(t.dur)}</span>` : ''}</div>
          <div class="home-mu-body"><h3>${escT(t.title)}</h3><p>${escT(t.artist)}</p></div>
        </a>`
      )
      .join('');
    musicStrip.hidden = false;
  });
}

/* 关于页「平台一览」数字条：静态项（非遗）保持构建期值；动态项拉 /api/stats 填充，
   进视口后计数动画（接口失败保持占位符「–」，无 JS 时不显示误导性的 0） */
const statsRow = document.querySelector('.stats-row');
if (statsRow) {
  const statEls = [...statsRow.querySelectorAll('.stat-v[data-stat]')];
  const pending = new Map();
  const setNum = (el, to) => {
    if (reduceMotion) {
      el.textContent = String(to);
      return;
    }
    const t0 = performance.now();
    const tick = (t) => {
      const p = Math.min(1, (t - t0) / 700);
      el.textContent = String(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  const statIo = 'IntersectionObserver' in window
    ? new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            statIo.unobserve(entry.target);
            const to = pending.get(entry.target);
            if (to != null) {
              pending.delete(entry.target);
              setNum(entry.target, to);
            }
          }
        },
        { threshold: 0.4 }
      )
    : null;

  fetch('/api/stats')
    .then((r) => r.json())
    .then((d) => {
      const stats = d && d.ok ? d.stats : null;
      if (!stats) return;
      for (const el of statEls) {
        const to = stats[el.dataset.stat];
        if (to == null) continue; // 静态项（如非遗）或接口缺项 → 保持原值
        if (!statIo) {
          setNum(el, Number(to));
          continue;
        }
        pending.set(el, Number(to));
        statIo.observe(el);
      }
    })
    .catch(() => {});
}

/* 焰境仙曲播放器（/music/，Worker SSR 出曲目 data-*；单 <audio> 复用 + MediaSession 锁屏控制） */
const musicPage = document.querySelector('.music-page');
if (musicPage) {
  const audio = document.getElementById('music-audio');
  const rows = [...musicPage.querySelectorAll('.music-item')];
  const toggleBtn = document.getElementById('music-toggle');
  const prevBtn = document.getElementById('music-prev');
  const nextBtn = document.getElementById('music-next');
  const seek = document.getElementById('music-seek');
  const vol = document.getElementById('music-vol');
  const tCur = document.getElementById('music-tcur');
  const tEnd = document.getElementById('music-tend');
  const loopBtn = document.getElementById('music-loop');
  const nowTitle = document.getElementById('music-now-title');
  const nowArtist = document.getElementById('music-now-artist');
  const nowMeta = document.getElementById('music-now-meta');
  const nowCover = document.getElementById('music-cover');
  const barCover = document.getElementById('music-bar-cover');

  if (audio && rows.length && toggleBtn) {
    let current = -1;
    let seeking = false;
    // 循环三态：all 列表循环 / one 单曲循环 / off 顺序播放（播完即停）
    const LOOP_LABEL = {
      all: t('music.loopAll', '列表循环'),
      one: t('music.loopOne', '单曲循环'),
      off: t('music.loopOff', '顺序播放'),
    };
    let loopMode = 'all';
    const counted = new Set(); // 每首每次进页面只计一次播放（真正开始播放时回报）

    // 轻提示（分享复制等反馈）
    let toastEl = null;
    let toastTimer = 0;
    const toast = (msg) => {
      if (!toastEl) {
        toastEl = document.createElement('div');
        toastEl.className = 'music-toast';
        toastEl.setAttribute('role', 'status');
        document.body.appendChild(toastEl);
      }
      toastEl.textContent = msg;
      toastEl.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2000);
    };

    const fmt = (s) => {
      s = Math.max(0, Math.floor(Number(s) || 0));
      return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    };

    // range 滑杆焰色进度底
    const paintFill = (input) => {
      const p = ((input.value - input.min) / (input.max - input.min)) * 100;
      input.style.background = `linear-gradient(90deg, #f2a03d ${p}%, rgba(255, 255, 255, 0.18) ${p}%)`;
    };
    paintFill(seek);
    paintFill(vol);

    const setCover = (box, url) => {
      box.textContent = '';
      if (url) {
        const img = new Image();
        img.src = url;
        img.alt = '';
        box.appendChild(img);
      } else {
        const ph = document.createElement('span');
        ph.className = 'tv-ph';
        ph.textContent = '焰';
        box.appendChild(ph);
      }
    };

    const setNow = (tr) => {
      nowTitle.textContent = tr.dataset.title;
      nowArtist.textContent = tr.dataset.artist || t('music.unnamed', '佚名');
      setCover(nowCover, tr.dataset.cover);
      setCover(barCover, tr.dataset.cover);
    };

    // 播放计数：开始播放一首时回报一次（不阻塞，失败静默）
    const count = (id) => {
      if (!id || counted.has(id)) return;
      counted.add(id);
      fetch(`/api/music/play/${encodeURIComponent(id)}`, { method: 'POST' }).catch(() => {});
    };

    const load = (i) => {
      const tr = rows[i];
      if (!tr) return;
      current = i;
      rows.forEach((r, k) => {
        r.classList.toggle('on', k === i);
        r.classList.toggle('paused', k === i); // 未真正播放前按暂停态显示均衡条
      });
      audio.src = tr.dataset.src;
      setNow(tr);
      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: tr.dataset.title,
          artist: tr.dataset.artist || t('music.title', '焰境仙曲'),
          album: t('music.album', '焰境仙曲 · 焰境万载'),
          artwork: tr.dataset.cover ? [{ src: tr.dataset.cover, sizes: '512x512', type: 'image/jpeg' }] : [],
        });
      }
      // 地址栏带上当前曲目，复制链接即分享单首（replaceState 不产生历史记录）
      try {
        const u = new URL(location.href);
        u.searchParams.set('t', tr.dataset.id);
        history.replaceState(null, '', u);
      } catch { /* 沙箱环境等忽略 */ }
    };

    const step = (d) => {
      if (!rows.length) return;
      let i = current + d;
      if (i < 0) i = rows.length - 1;
      if (i >= rows.length) i = 0;
      load(i);
      audio.play();
    };

    const toggle = () => {
      if (current < 0) {
        load(0);
        audio.play();
        return;
      }
      if (audio.paused) audio.play();
      else audio.pause();
    };

    const selectRow = (i) => {
      if (current === i) toggle();
      else {
        load(i);
        audio.play();
      }
    };

    rows.forEach((r, i) =>
      r.addEventListener('click', (e) => {
        if (e.target.closest('.music-act')) return; // 下载/分享按钮不触发播放
        selectRow(i);
      })
    );
    prevBtn?.addEventListener('click', () => step(-1));
    nextBtn?.addEventListener('click', () => step(1));
    toggleBtn.addEventListener('click', toggle);

    const setLoopMode = (mode) => {
      loopMode = mode;
      loopBtn.classList.toggle('on', mode !== 'off');
      loopBtn.classList.toggle('one', mode === 'one');
      loopBtn.setAttribute('aria-pressed', String(mode !== 'off'));
      loopBtn.setAttribute('aria-label', `${t('music.loopMode', '循环模式：')}${LOOP_LABEL[mode]}`);
    };
    if (loopBtn) {
      setLoopMode('all'); // 与服务端渲染的初始高亮对齐
      loopBtn.addEventListener('click', () => {
        setLoopMode(loopMode === 'all' ? 'one' : loopMode === 'one' ? 'off' : 'all');
        toast(LOOP_LABEL[loopMode]);
      });
    }

    // 分享单曲：系统分享 → 复制链接 → prompt 兜底（微信内置浏览器等）
    musicPage.addEventListener('click', async (e) => {
      const btn = e.target.closest('.music-share');
      if (!btn) return;
      const tr = btn.closest('.music-item');
      if (!tr) return;
      let shareUrl = `${location.origin}/music/?t=${encodeURIComponent(tr.dataset.id)}`;
      try {
        shareUrl = new URL(`/music/?t=${encodeURIComponent(tr.dataset.id)}`, location.origin).href;
      } catch { /* 忽略，用拼接值 */ }
      if (navigator.share) {
        try {
          await navigator.share({
            title: t('music.shareTitle', '{title} — 焰境仙曲 · 焰境万载').replace('{title}', tr.dataset.title),
            url: shareUrl,
          });
          return;
        } catch (err) {
          if (err && err.name === 'AbortError') return; // 用户取消分享
        }
      }
      try {
        await navigator.clipboard.writeText(shareUrl);
        toast(t('music.copied', '链接已复制，去分享给朋友吧'));
      } catch {
        prompt(t('music.copyPrompt', '长按/全选复制链接：'), shareUrl);
      }
    });

    seek.addEventListener('input', () => {
      seeking = true;
      paintFill(seek);
      if (audio.duration) tCur.textContent = fmt((seek.value / 1000) * audio.duration);
    });
    seek.addEventListener('change', () => {
      if (audio.duration) audio.currentTime = (seek.value / 1000) * audio.duration;
      seeking = false;
    });
    vol.addEventListener('input', () => {
      audio.volume = vol.value / 100;
      paintFill(vol);
    });

    audio.addEventListener('play', () => {
      count(rows[current]?.dataset.id);
      toggleBtn.classList.add('playing');
      toggleBtn.setAttribute('aria-label', t('a11y.pause', '暂停'));
      rows[current]?.classList.remove('paused');
      nowMeta.textContent = t('music.nowPlaying', '正在播放');
    });
    audio.addEventListener('pause', () => {
      toggleBtn.classList.remove('playing');
      toggleBtn.setAttribute('aria-label', t('a11y.play', '播放'));
      rows[current]?.classList.add('paused');
      nowMeta.textContent = t('music.paused', '已暂停');
    });
    audio.addEventListener('ended', () => {
      if (loopMode === 'one') {
        audio.currentTime = 0;
        audio.play();
        return;
      }
      if (loopMode === 'all' || current < rows.length - 1) step(1);
    });
    audio.addEventListener('loadedmetadata', () => {
      tEnd.textContent = fmt(audio.duration);
    });
    audio.addEventListener('timeupdate', () => {
      if (seeking) return;
      if (audio.duration) {
        seek.value = Math.round((audio.currentTime / audio.duration) * 1000);
        paintFill(seek);
      }
      tCur.textContent = fmt(audio.currentTime);
    });

    // 深链：/music/?t=<id> 直达单曲（不自动播放：受浏览器策略限制，也不虚增播放数）
    const wantId = new URLSearchParams(location.search).get('t');
    const wantIdx = rows.findIndex((r) => r.dataset.id === wantId);
    if (wantIdx >= 0) {
      load(wantIdx);
      rows[wantIdx].scrollIntoView({ block: 'center' });
    }

    if ('mediaSession' in navigator) {
      navigator.mediaSession.setActionHandler('previoustrack', () => step(-1));
      navigator.mediaSession.setActionHandler('nexttrack', () => step(1));
    }
  }
}

/* 联系表单：fetch 提交 /api/contact，Honeypot 字段一并带上 */
const form = document.getElementById('contact-form');
form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const status = form.querySelector('.form-status');
  const btn = form.querySelector('button[type="submit"]');
  const data = Object.fromEntries(new FormData(form).entries());

  if (!data.name?.trim() || !data.message?.trim()) {
    status.textContent = t('form.needName', '请填写姓名和留言内容。');
    status.className = 'form-status err';
    return;
  }

  btn.disabled = true;
  status.textContent = t('form.sending', '发送中……');
  status.className = 'form-status';
  try {
    const res = await fetch('/api/contact', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(data),
    });
    const out = await res.json().catch(() => ({}));
    if (res.ok && out.ok) {
      status.textContent = t('form.sent', '已收到，谢谢您的留言！');
      status.className = 'form-status ok';
      form.reset();
    } else if (out.error === 'rate_limited') {
      status.textContent = t('form.rateLimited', '发送太频繁，请稍后再试。');
      status.className = 'form-status err';
    } else {
      status.textContent = t('form.failed', '发送失败，请稍后重试或直接邮件联系。');
      status.className = 'form-status err';
    }
  } catch {
    status.textContent = t('form.network', '网络异常，请稍后重试。');
    status.className = 'form-status err';
  } finally {
    btn.disabled = false;
  }
});

/* ---------------- PWA（docs/PWA应用方案.md §3.4-3.5）：SW 注册 ----------------
 * 全站统一脚本：静态页与 Worker 渲染页（/music /attractions /tv /library /merchants）都加载本文件。 */

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

/* 安装提示一律不弹（2026-09-07 用户反馈：主动弹窗讨嫌）；离线提示胶囊同样不做（同日反馈）。
 * 仅静默 preventDefault，压掉 Chrome Android 的自动安装横幅；安装走浏览器原生入口：
 * 桌面 Chrome/Edge 地址栏安装图标、Android 三点菜单「安装应用」、iOS Safari 分享 → 添加到主屏幕。 */
window.addEventListener('beforeinstallprompt', (e) => e.preventDefault());
