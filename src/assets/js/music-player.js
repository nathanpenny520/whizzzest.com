/**
 * music-player.js — 焰境仙曲播放器（/music/，Worker SSR 出曲目 data-*；单 <audio> 复用 + MediaSession 锁屏控制）
 * 2026-09-10 结构精简 A3 自 main.js 拆出：仅 /music/ 页壳（worker/music.js）加载。
 * 原生 ES Module，无依赖；I18N/t 与 main.js 同款实现（Worker 动态页由 music.js 注入 window.__I18N）。
 */
"use strict";

const I18N = window.__I18N || {};
const t = (path, fallback) => {
  const v = path.split(".").reduce((node, key) => (node == null ? undefined : node[key]), I18N);
  return v == null ? fallback : v;
};

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
