// EmberQuest 收录清洗脚本（一次性，字节级精确替换 + 次数断言 + 对账）
// 依据 docs/游戏整合方案.md 决策⑨ / 决策⑦；运行: node clean-emberquest.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const F = 'game/r2-assets/g/emberquest/index.html';
let src = readFileSync(F, 'utf8');
const origBytes = Buffer.byteLength(src);
const origLines = src.split('\n').length;
let ok = 0;
const ops = [];

function rep(name, from, to, expect = 1) {
  const parts = src.split(from);
  if (parts.length - 1 !== expect) {
    console.error(`FAIL ${name}: matched ${parts.length - 1}, expected ${expect}`);
    process.exit(1);
  }
  src = parts.join(to);
  ok += expect;
  ops.push(`${name} ×${expect}`);
}

function rex(name, pattern, to, expect = 1) {
  const re = new RegExp(pattern, 'g');
  let n = 0;
  src = src.replace(re, (...a) => { n++; return typeof to === 'function' ? to(...a) : to; });
  if (n !== expect) {
    console.error(`FAIL ${name}: matched ${n}, expected ${expect}`);
    process.exit(1);
  }
  ok += n;
  ops.push(`${name} ×${n}`);
}

// ── 1. 头部三件套 ──
rep('tabler-css', 'href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@2.44.0/tabler-icons.min.css"', 'href="tabler/tabler-icons.min.css"');
rep('supabase-script', '\n  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>', '');
rep('pako-script', 'src="https://cdn.jsdelivr.net/npm/pako@2.1.0/dist/pako.min.js"', 'src="pako.min.js"');

// ── 2. supabase 常量与用户可见文案 ──
rep('supa-url', "const SUPA_URL = 'https://vikrewfgxxkiyeqwpgio.supabase.co';", "const SUPA_URL = '';");
rex('supa-anon', "const SUPA_ANON = '[^']+';", "const SUPA_ANON = '';");
rep('chat-help', 'Uses your Supabase login. Messages are stored in the <code>chat_messages</code> table. Click a name to locally mute/unmute that sender.', 'Cloud chat is not available in this offline release.');
rep('chat-empty', 'Log in with Supabase cloud saves to use chat.', 'Cloud chat is not available in this offline release.');

// ── 3. Discord 社区面板 → 本地空态 ──
rep('panel-h3', '>💬 EmberQuest Discord</h3>', '>💬 Community</h3>');
rep('panel-desc', 'Join the community for patch notes, feedback, bug reports, balance talk, and player help. This panel intentionally avoids the full Discord iframe and only fetches lightweight count data when Discord allows it.', 'Offline release: community features are not bundled.');
rep('panel-card-title', '<strong>Community server</strong><br>', '<strong>Offline release</strong><br>');
rep('panel-card-sub', '<span>Hop in for updates, bug reports, balance talk, and feature ideas.</span>', '<span>Community features are not bundled in this offline release.</span>');
rep('panel-status', '>Counts load when this panel opens.</div>', '>Community features are not available in this offline release.</div>');
rep('panel-actions', `<a class="btn active" href="https://discord.gg/vj3W9eqjv3" target="_blank" rel="noopener noreferrer">Join Discord</a>
              <button class="btn" onclick="renderCommunityTab(true)">Refresh Counts</button>
              <button class="btn" onclick="openPopup('about')">About EmberQuest</button>`, `<button class="btn" onclick="openPopup('about')">About EmberQuest</button>`);
rep('panel-note', "Counts come from Discord's public invite/widget endpoints. If Discord blocks the request or the server disables public data, the join link still works.", '');

rex('discord-urls', "const DISCORD_(INVITE_URL|INVITE_API|WIDGET_API)_V1520 = '[^']+';", "const DISCORD_$1_V1520 = '';", 3);
rex('render-community', `async function renderCommunityTab\\(forceReload = false\\) \\{[\\s\\S]*?\\n    \\}\\n\\n    function openPopup`,
`async function renderCommunityTab(forceReload = false) {
      // 收录版：社区面板为本地空态，不发起任何外部请求
      setDiscordStatusV1520('Community features are not available in this offline release.');
    }

    function openPopup`);
rep('tabbtn', `id="tabbtn-community" onclick="openPopup('community')">💬 Discord</div>`, `id="tabbtn-community" onclick="openPopup('community')">💬 Community</div>`);
rep('popup-btn', "popupButton('community', '💬 Discord')", "popupButton('community', '💬 Community')");
rep('popup-title', "community: '💬 EmberQuest Discord',", "community: '💬 Community',");

// ── 4. About 页社区/致谢/仓库链接（决策⑦） ──
rep('about-community', `Need help, want to report a bug, or want to follow updates? Open the <button class="btn" style="font-size:11px;padding:3px 8px" onclick="openPopup('community')">Discord Community</button> panel for live counts and a direct join link.`, `Looking for what's new? Open the <button class="btn" style="font-size:11px;padding:3px 8px" onclick="openPopup('about')">About EmberQuest</button> panel.`);
rep('changelog-discord-li', `<li><strong>Discord Community.</strong> The About/desktop tabs/Mobile v2 More menu now expose a lightweight member-count card and direct join link instead of the oversized widget.</li>\n`, '');
rex('credits-block', `<h4 style="margin:14px 0 6px">Credits &amp; License</h4>[\\s\\S]*?<h4 style="margin:14px 0 6px">⚔ Hardcore Hall of Fame</h4>`,
  `<h4 style="margin:14px 0 6px">⚔ Hardcore Hall of Fame</h4>`);

// ── 对账与残留扫描 ──
writeFileSync(F, src);
const bad = [...src.matchAll(/https?:\/\/(?!www\.w3\.org)[^\s"'`<>)]+/gi)].map(m => m[0]);
const uniqBad = [...new Set(bad)];
const leak = ['supabase.co', 'discord.gg', 'discord.com', 'github.com', 'tabler-icons.io', 'jsdelivr', 'TheDroidYourLookingFor', 'thedroidyourlookingfor', 'GNU General Public License', 'vikrewfgxxkiyeqwpgio']
  .filter(s => src.includes(s));
console.log(`替换 ${ok} 处 →`, ops.join(' | '));
console.log(`行数 ${origLines} → ${src.split('\n').length}，字节 ${origBytes} → ${Buffer.byteLength(src)}（${Buffer.byteLength(src) - origBytes >= 0 ? '+' : ''}${Buffer.byteLength(src) - origBytes}）`);
console.log('残留外链(非w3.org):', uniqBad.length ? uniqBad : '0 ✅');
console.log('敏感串残留:', leak.length ? leak : '0 ✅');
if (uniqBad.length || leak.length) process.exit(1);
