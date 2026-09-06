/**
 * main.js — 全站交互（导航 / 滚动浮现 / 年份）
 * 原生 ES Module，无依赖。
 */
'use strict';

/* JS 可用标记：滚动浮现等增强样式仅在 .js 下生效（无 JS 时内容直接可见） */
document.documentElement.classList.add('js');

/* 导航：汉堡菜单开合（抽屉在 header 外层，见 header.html 注释） */
const burger = document.querySelector('.nav-burger');
const drawer = document.getElementById('nav-drawer');

function setMenu(open) {
  if (!burger || !drawer) return;
  burger.setAttribute('aria-expanded', String(open));
  burger.setAttribute('aria-label', open ? '关闭菜单' : '打开菜单');
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

/* 当前页导航高亮 */
const here = location.pathname.replace(/\/index\.html$/, '/');
for (const link of document.querySelectorAll('.nav-link')) {
  const href = link.getAttribute('href');
  if (href === here || (href === '/' && here === '/')) {
    link.setAttribute('aria-current', 'page');
  }
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

/* 二维码灯箱：页内 [data-qr] 元素点击弹出大图（合作伙伴公众号等） */
const lightbox = document.getElementById('lightbox');
if (lightbox) {
  const lbImg = lightbox.querySelector('img');
  const lbCap = lightbox.querySelector('.lightbox-cap');
  let lastFocus = null;

  const openLb = (src, caption) => {
    lbImg.src = src;
    lbImg.alt = caption || '二维码';
    lbCap.textContent = caption || '';
    lastFocus = document.activeElement;
    lightbox.classList.add('open');
    document.body.style.overflow = 'hidden';
    lightbox.querySelector('.lightbox-close')?.focus();
  };

  const closeLb = () => {
    lightbox.classList.remove('open');
    document.body.style.overflow = '';
    lastFocus?.focus?.();
  };

  document.addEventListener('click', (e) => {
    const trigger = e.target instanceof Element ? e.target.closest('[data-qr]') : null;
    if (trigger) openLb(trigger.dataset.qr, trigger.dataset.cap || '');
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

  const show = (i) => {
    current = (i + slides.length) % slides.length;
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
