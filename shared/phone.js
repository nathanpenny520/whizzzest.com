/**
 * 焰境·万载 — 手机号归一化 / 全量国家清单 / 掩码（docs/手机号国际化方案.md）
 *
 * 定位：手机号 = 登录账号，只做编号计划级格式核验（号段/长度/仅手机类型），
 * 不发送短信、不验证归属；归属核验的唯一渠道是邮箱验证码（worker/smtp.js）。
 *
 * libphonenumber-js/mobile 元数据仅含手机号规则：CN 自动收紧为真实号段（1[3-9]），
 * 各国按各自编号计划校验；两门户 Worker 共用（wrangler 打包，对标 shared/portal-ui.js）。
 */
import { parsePhoneNumberFromString, getCountries, getCountryCallingCode } from 'libphonenumber-js/mobile';

const ISO_SET = new Set(getCountries());

// 门户选择器置顶的常用国家/地区（CN 首位带中文名；其余按 ISO 码字母序排全量组）
const PREFERRED_ZH = {
  CN: '中国大陆', HK: '中国香港', MO: '中国澳门', TW: '中国台湾', JP: '日本', KR: '韩国',
  SG: '新加坡', MY: '马来西亚', TH: '泰国', US: '美国', GB: '英国', AU: '澳大利亚',
};
const PREFERRED = Object.keys(PREFERRED_ZH);

/** ISO 国家码 → 国旗 emoji（区域指示符） */
function flag(iso) {
  return iso.replace(/[A-Z]/g, (c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65));
}

/**
 * 归一化：raw 为用户输入（可含空格/点/括号/连字符），country 为 ISO 码
 * （缺省/未知 → CN，兼容旧版裸 11 位输入；输入自带 + 国家码时 libphonenumber 以其为准）。
 * → { ok:true, e164, country } ｜ { ok:false }（座机/假号段/长度不符一律不通过）
 */
export function normalizePhone(raw, country) {
  const text = String(raw || '').replace(/[\s().\-]/g, '');
  if (!text) return { ok: false };
  const iso = ISO_SET.has(country) ? country : 'CN';
  const parsed = parsePhoneNumberFromString(text, iso);
  if (!parsed || !parsed.isValid()) return { ok: false };
  return { ok: true, e164: parsed.number, country: parsed.country || iso };
}

/** 全量国家清单（常用置顶）：[{ iso, dial, flag }] */
export function phoneCountryOptions() {
  const rest = getCountries().filter((iso) => !PREFERRED.includes(iso));
  return [...PREFERRED, ...rest].map((iso) => ({ iso, dial: '+' + getCountryCallingCode(iso), flag: flag(iso) }));
}

/** 门户表单的 <option> 列表（服务端渲染，客户端零数据）：常用组带中文名，缺省选中 CN */
export function phoneCountryOptionsHtml(selectedIso) {
  return phoneCountryOptions()
    .map(({ iso, dial, flag: f }) => {
      const zh = PREFERRED_ZH[iso];
      return `<option value="${iso}"${iso === (selectedIso || 'CN') ? ' selected' : ''}>${zh ? `${f} ${dial} ${zh}` : `${f} ${dial}`}</option>`;
    })
    .join('');
}

/** 掩码展示（门户 webauthn userName 用）：保留国家码/前几位与后 4 位，中间打码 */
export function maskPhone(p) {
  return String(p || '').replace(/^(\+?\d{2,3})\d+(\d{4})$/, (m, head, tail) => head + '****' + tail);
}
