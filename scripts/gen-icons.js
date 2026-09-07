#!/usr/bin/env node
/**
 * gen-icons.js — PWA 图标一次性生成（产物提交入库，无需每次构建重跑）
 *
 * favicon.svg（红黄火焰，透明底，viewBox 1024）→ public/icons/：
 *   icon-192.png / icon-512.png      常规图标（透明底原样）
 *   maskable-192.png / maskable-512.png  可掩码图标（浅底 #fbfbfd，火焰缩至 76% 安全区）
 *   apple-touch-icon.png             iOS 主屏图标 180px（不读 manifest 图标，需整幅实底）
 *
 * 运行：node scripts/gen-icons.js （依赖构建期 devDependency sharp）
 */
'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const SVG = path.join(ROOT, 'public', 'favicon.svg');
const OUT = path.join(ROOT, 'public', 'icons');
const BG = { r: 0xfb, g: 0xfb, b: 0xfd, alpha: 1 }; // 站点默认 themeColor #fbfbfd
const SAFE = 0.76; // maskable 安全区：内容占 76%，四周留白防圆形裁切

async function renderRegular(size, dest) {
  // SVG 内在尺寸 200px，按目标尺寸提升光栅化密度避免模糊
  await sharp(SVG, { density: 72 * (size / 200) * 1.02 })
    .resize(size, size)
    .png()
    .toFile(dest);
}

async function renderMaskable(size, dest) {
  const inner = Math.round(size * SAFE);
  const content = await sharp(SVG, { density: 72 * (inner / 200) * 1.02 })
    .resize(inner, inner)
    .png()
    .toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: BG } })
    .composite([{ input: content, gravity: 'centre' }])
    .png()
    .toFile(dest);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  await renderRegular(192, path.join(OUT, 'icon-192.png'));
  await renderRegular(512, path.join(OUT, 'icon-512.png'));
  await renderMaskable(192, path.join(OUT, 'maskable-192.png'));
  await renderMaskable(512, path.join(OUT, 'maskable-512.png'));
  await renderMaskable(180, path.join(OUT, 'apple-touch-icon.png'));
  console.log('✔ PWA 图标已生成 → public/icons/');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
