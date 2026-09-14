/**
 * 焰境密语 — 常量与门户文案（im.whizzzest.com，docs/IM聊天方案.md）
 *
 * 拆分约定（业主 2026-09-13 拍板「一个文件不要什么功能都有」）：
 * index.js 只做薄入口（路由分发 + 安全头 + DO 导出），职责一律落 src/ 各模块；
 * 新功能 = 新模块，不再往单文件里攒。
 */

export const SITE = 'https://whizzzest.com';
export const IM_HOME = 'https://im.whizzzest.com';
export const CONTACT_EMAIL = 'contact@whizzzest.com';

/* 会话 Cookie（照 writer 门户模式） */
export const COOKIE_NAME = 'im_session';
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const SESSION_TTL_S = SESSION_TTL_MS / 1000;

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/* E2EE 密钥材料约束（方案 §3.1） */
export const KDF_ITERS_MIN = 100000;
export const KDF_ITERS_MAX = 1000000;
export const ENC_PRIV_KEY_MAX = 4096;   // base64 长度上限（iv 12B + 密文，私钥 JWK 实际 ~1.5KB）
export const ENVELOPE_MAX = 512;        // 信封 base64 上限（iv 12B + 临时公钥 65B + 密文 48B ≈ 168B）

/* 消息与成员约束（方案 §3.3/§4/§8） */
export const MSG_BODY_MAX = 2000;       // 密文 b64 存库上限（≈1471 明文字节；客户端按 1400 字节预检）
export const AVATAR_COLORS = 8;
export const FRIEND_REQ_MSG_MAX = 100;
export const WS_PER_UID_LIMIT = 5;      // 单 uid 并发 WS 连接上限

/* 群组（M3，方案 §3.2/§6/§11：上限 100 人、群主直接拉好友入群、单次拉人 ≤20） */
export const GROUP_MAX = 100;
export const GROUP_NAME_MAX = 30;
export const GROUP_ADD_MAX = 20;
export const GROUP_RATE = { windowMs: 60 * 60 * 1000, max: 60 };  // 群管理操作（建/拉/踢/退/散/名/重钥）合并限流

/* 限流（方案 §8） */
export const RATE_SEARCH = { windowMs: 60 * 60 * 1000, max: 30 };          // 用户搜索（uid+IP）
export const RATE_FRIEND_REQ = { dailyMax: 20, inboxMax: 50 };             // 好友申请：我 20 条/天，对方待收 ≤50

/* 认证页门户配置（与 writer/merchant 同构，文案为 IM） */
export const FAVICON_LINK = '<link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBzdGFuZGFsb25lPSJubyI/PjwhRE9DVFlQRSBzdmcgUFVCTElDICItLy9XM0MvL0RURCBTVkcgMS4xLy9FTiIgImh0dHA6Ly93d3cudzMub3JnL0dyYXBoaWNzL1NWRy8xLjEvRFREL3N2ZzExLmR0ZCI+PHN2ZyB0PSIxNzcwNjM5ODE2OTM3IiBjbGFzcz0iaWNvbiIgdmlld0JveD0iMCAwIDEwMjQgMTAyNCIgdmVyc2lvbj0iMS4xIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHAtaWQ9Ijg1MzgiIHhtbG5zOnhsaW5rPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hsaW5rIiB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCI+PHBhdGggZD0iTTUxMi44IDQyMC44Yy0xNTYuOCAyMzQuNC0xNDEuNiA1NzYuOC00OCA1NzguNCA5Ni44IDIuNC0xNC40LTM5NC40IDQ4LTU3OC40ek00ODAuOCAzOTUuMmMtMjI3LjIgNzQuNC0zOTIgMzExLjItMzI4LjggMzYxLjYgNjQuOCA1MiAxOTEuMi0yNzIgMzI4LjgtMzYxLjZ6TTQ4Ny4yIDM3NkMyOTAuNCAyODggMjQgMzMyIDMxLjIgMzk5LjJjNy4yIDY4LjggMzA3LjItNDkuNiA0NTYtMjMuMnpNNTEyLjggMzU0LjRjLTg5LjYtMTY5LjYtMzAwLTMwMC44LTMzMS4yLTI1Ni0zMiA0Ni40IDI0MS42IDE1MiAzMzEuMiAyNTZ6TTUzMS4yIDM1NC40QzYyNi40IDIyOCA2MzIgMzQuNCA1ODAuOCAyOS42Yy01Mi44LTQuOC03LjIgMjIzLjItNDkuNiAzMjQuOHpNNTQ4IDM2Ni40YzE0NC44IDMuMiAyOTUuMi05NC40IDI3Mi0xMzUuMi0yNC00MS42LTE3My42IDExMi0yNzIgMTM1LjJ6TTU2MS42IDM5OS4yYzE2MCAxMTkuMiA0MjAgMTYwLjggNDMxLjIgMTA5LjYgMTEuMi01Mi44LTI5OS4yLTQ4LjgtNDMxLjItMTA5LjZ6TTUzOS4yIDQyNi40YzI5LjYgMjE2IDIxMS4yIDQxNy42IDI2NC44IDM3NS4yIDU1LjItNDMuMi0yMDcuMi0yMzMuNi0yNjQuOC0zNzUuMnoiIGZpbGw9IiNFODM1MTgiIHAtaWQ9Ijg1MzkiPjwvcGF0aD48cGF0aCBkPSJNOTE5LjIgNjIyLjRsMTYgMzIuOCAzNiA0LjgtMjUuNiAyNS42IDUuNiAzNi0zMi0xNi44LTMyIDE2LjggNi40LTM2LTI2LjQtMjUuNiAzNi00Ljh6IiBmaWxsPSIjRjREMzFGIiBwLWlkPSI4NTQwIj48L3BhdGg+PHBhdGggZD0iTTUyMCAzMzkuMmwxNiAzMi44IDM2IDUuNi0yNS42IDI0LjggNS42IDM2LTMyLTE2LjgtMzIgMTYuOCA2LjQtMzYtMjYuNC0yNC44IDM2LTUuNnpNMjM5LjIgNzkyLjhsMTQuNCAzMC40IDM0LjQgNC44LTI0LjggMjQgNS42IDMzLjYtMjkuNi0xNi0zMC40IDE2IDUuNi0zMy42LTI0LjgtMjQgMzQuNC00Ljh6TTE1MS4yIDE4OGgtMzJ2LTMyYzAtMi40LTEuNi00LTQtNHMtNCAxLjYtNCA0djMyaC0zMmMtMi40IDAtNCAxLjYtNCA0czEuNiA0IDQgNGgzMnYzMmMwIDIuNCAxLjYgNCA0IDRzNC0xLjYgNC00di0zMmgzMmMyLjQgMCA0LTEuNiA0LTRzLTEuNi00LTQtNHoiIGZpbGw9IiNGNUUzMjgiIHAtaWQ9Ijg1NDEiPjwvcGF0aD48L3N2Zz4=">';
export const LOGO_URI = (FAVICON_LINK.match(/href="([^"]+)"/) || [])[1] || '';

export const PORTAL_UI = {
  brand: '焰境密语',
  area: '加密聊天',
  home: SITE + '/',
  logoUri: LOGO_URI,
  slogan: '说给对的人，密语不过夜',
  sideSlogan: '端到端加密 · 服务器只递信，不看信',
  highlights: [
    '好友私聊与百人群组',
    '端到端加密：密文进出，服务器不可读',
    '身份密钥本机生成，密码加密备份可换机恢复',
    '仅文字，轻量纯净',
  ],
};
