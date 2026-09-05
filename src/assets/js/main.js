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
