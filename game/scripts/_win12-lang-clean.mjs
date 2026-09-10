// win12 多语言包去来源化清洗（docs/游戏整合方案.md §7.6）
// 翻译词条与镜像已清洗的中文 DOM 对齐：删镜像中已不存在的键（缺失键经 i18nOrNull 兜底保持 DOM 原文），
// 替换指向上游仓库的词条为本站仓库（nathanpenny520/whizzzest.com）。每处替换断言命中恰 1 次。
import { readFileSync, writeFileSync } from 'node:fs';

const DIR = new URL('../r2-assets/g/win12/lang/lang/', import.meta.url);

// 与 data/window-templates.js 已清洗 DOM 逐字对齐的文案（properties 转义遵循原文件：\: \= \"）
const VALUES = {
  'lang_zh_CN': {
    'setting.psnl.theme-dt': '设置 Windows 的主题（本站镜像主题库）',
    'about.intro.intro.p2': '&emsp;&emsp;本站项目已发布至 GitHub，<a onclick=\\"window.open(\'https\\://github.com/nathanpenny520/whizzzest.com\',\'_blank\');\\" win12_title\\=\\"https\\://github.com/nathanpenny520/whizzzest.com\\" class\\=\\"jump\\">点击此处查看</a>。',
    'about.intro.intro.p3': '&emsp;&emsp;若您对于本站有任何意见或建议，请在 GitHub 上<a onclick=\\"window.open(\'https\\://github.com/nathanpenny520/whizzzest.com/issues\',\'_blank\');\\" win12_title\\=\\"https\\://github.com/nathanpenny520/whizzzest.com/issues\\" class\\=\\"jump\\">提交 issues</a>，您的问题会被尽可能快地解决。',
    'about.intro.star.p1': '&emsp;&emsp;感谢<a class=\\"jump\\" win12_title\\=\\"给个 Star 好不好？(即将跳转到\\:https\\://github.com/nathanpenny520/whizzzest.com/stargazers)\\" onclick=\\"window.open(\'https\\://github.com/nathanpenny520/whizzzest.com/stargazers\',\'_blank\')\\">所有支持我们的人</a>。',
    'camera.notice.txt': '&emsp;&emsp;在使用中，本应用将会获取访问您摄像头的权限（用于进行拍摄照片等操作）。本应用不会收集、上传或分享您的任何个人信息与拍摄内容，所有照片仅保存在您设备本地。<br />&emsp;&emsp;若您不同意上述协议，将无法使用本应用。',
  },
  'lang_zh_TW': {
    'setting.psnl.theme-dt': '設定 Windows 的主題（本站鏡像主題庫）',
    'about.intro.intro.p2': '&emsp;&emsp;本站專案已發布至 GitHub，<a onclick=\\"window.open(\'https\\://github.com/nathanpenny520/whizzzest.com\',\'_blank\');\\" win12_title\\=\\"https\\://github.com/nathanpenny520/whizzzest.com\\" class\\=\\"jump\\">點擊此處查看</a>。',
    'about.intro.intro.p3': '&emsp;&emsp;若您對於本站有任何意見或建議，請在 GitHub 上<a onclick=\\"window.open(\'https\\://github.com/nathanpenny520/whizzzest.com/issues\',\'_blank\');\\" win12_title\\=\\"https\\://github.com/nathanpenny520/whizzzest.com/issues\\" class\\=\\"jump\\">提交 issues</a>，您的問題會被盡可能快地解決。',
    'about.intro.star.p1': '&emsp;&emsp;感謝<a class=\\"jump\\" win12_title\\=\\"給個 Star 好不好？(即將跳轉到\\:https\\://github.com/nathanpenny520/whizzzest.com/stargazers)\\" onclick=\\"window.open(\'https\\://github.com/nathanpenny520/whizzzest.com/stargazers\',\'_blank\')\\">所有支持我們的人</a>。',
    'camera.notice.txt': '&emsp;&emsp;在使用中，本應用將會獲取存取您攝影機的權限（用於進行拍攝照片等操作）。本應用不會收集、上傳或分享您的任何個人資訊與拍攝內容，所有照片僅保存在您裝置本地。<br />&emsp;&emsp;若您不同意上述協議，將無法使用本應用。',
  },
  'lang_en': {
    'setting.psnl.theme-dt': 'Set the Windows theme (theme library mirrored on this site)',
    'about.intro.intro.p2': '&emsp;&emsp;This project is published on GitHub, <a onclick=\\"window.open(\'https\\://github.com/nathanpenny520/whizzzest.com\',\'_blank\');\\" win12_title\\=\\"https\\://github.com/nathanpenny520/whizzzest.com\\" class\\=\\"jump\\">click here to view</a>.',
    'about.intro.intro.p3': '&emsp;&emsp;If you have any comments or suggestions about this site, please <a onclick=\\"window.open(\'https\\://github.com/nathanpenny520/whizzzest.com/issues\',\'_blank\');\\" win12_title\\=\\"https\\://github.com/nathanpenny520/whizzzest.com/issues\\" class\\=\\"jump\\">submit issues on GitHub</a>, and your problem will be resolved as soon as possible.',
    'about.intro.star.p1': '&emsp;&emsp;Thanks to <a class=\\"jump\\" win12_title\\=\\"Give us a Star? (Redirecting to\\: https\\://github.com/nathanpenny520/whizzzest.com/stargazers)\\" onclick=\\"window.open(\'https\\://github.com/nathanpenny520/whizzzest.com/stargazers\',\'_blank\')\\">everyone who has supported us</a>.',
    'camera.notice.txt': '&emsp;&emsp;In use, this app will request access to your camera (for taking photos and similar operations). This app does not collect, upload, or share any of your personal information or captured content; all photos are saved only on your device.<br />&emsp;&emsp;If you do not agree to the above terms, you will not be able to use this app.',
  },
};

// 镜像 DOM 已删除这些元素，词条一并删除（缺失键 → i18nOrNull 兜底 null → DOM 不动）
const DROP_KEYS = ['desktop.vogithub', 'nts.feedback.github', 'about.intro.intro.p4', 'about.intro.others.p4'];

let failed = false;
for (const [name, values] of Object.entries(VALUES)) {
  const path = new URL(`./${name}.properties`, DIR);
  const lines = readFileSync(path, 'utf8').split('\n');
  for (const [key, val] of Object.entries(values)) {
    const i = lines.findIndex(l => l.startsWith(key + '='));
    if (i === -1) { console.error(`✗ ${name}: 键未找到 ${key}`); failed = true; continue; }
    lines[i] = `${key}=${val}`;
  }
  let out = lines.filter(l => {
    const k = l.split('=')[0];
    if (DROP_KEYS.includes(k)) { console.log(`  ${name}: 删键 ${k}`); return false; }
    return true;
  });
  writeFileSync(path, out.join('\n'));
  console.log(`✓ ${name}.properties 重写完成（${out.length} 行）`);
}
// 终检：三个文件不允许再有任何上游来源残留
const { execSync } = await import('node:child_process');
try {
  execSync('grep -rn -iE "win12-online|tjy-gitnub|win12\\.tech|freehk|tjy-gitnub\\.github" "' + new URL('.', DIR).pathname.replace(/^\/([A-Za-z]:)/, '$1') + '"', { stdio: 'pipe' });
  console.error('✗ 仍有上游来源残留'); failed = true;
} catch { console.log('✓ 终检通过：上游来源（win12-online/tjy-gitnub/win12.tech/freehk）零残留'); }
process.exit(failed ? 1 : 0);
