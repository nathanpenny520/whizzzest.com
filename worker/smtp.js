/**
 * worker/smtp.js — 极简 SMTP 客户端（Workers connect() 原生 TCP，零依赖）
 *
 * 仅支持 465 隐式 TLS（阿里云企业邮 smtp.qiye.aliyun.com:465）。
 * 发信失败向上抛错，由调用方决定降级策略（方案 §7：D1 为权威数据源，邮件尽力而为）。
 */
import { connect } from 'cloudflare:sockets';

const HOST = 'smtp.qiye.aliyun.com';
const PORT = 465;

/** 读取一行 SMTP 响应（以 \n 结尾），带总超时 */
function readLine(socket, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('SMTP read timeout'));
      socket.close().catch(() => {});
    }, timeoutMs);
    const dec = new TextDecoder();
    const buf = [];
    const reader = socket.readable.getReader();
    const pump = async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf.push(dec.decode(value, { stream: true }));
          const all = buf.join('');
          const idx = all.indexOf('\n');
          if (idx !== -1) {
            clearTimeout(timer);
            reader.releaseLock();
            resolve(all.slice(0, idx).replace(/\r$/, ''));
            return;
          }
        }
        clearTimeout(timer);
        reader.releaseLock();
        reject(new Error('SMTP connection closed unexpectedly'));
      } catch (err) {
        clearTimeout(timer);
        reader.releaseLock();
        reject(err);
      }
    };
    pump();
  });
}

/** 写命令并校验响应前缀（如 '250'），返回完整响应行 */
async function command(socket, writer, line, expect) {
  await writer.write(new TextEncoder().encode(line + '\r\n'));
  const resp = await readLine(socket);
  if (!resp.startsWith(expect)) {
    throw new Error(`SMTP ${expect} expected, got: ${resp}`);
  }
  return resp;
}

/**
 * 发送一封纯文本/HTML 邮件
 * @param {{user: string, pass: string, to: string, subject: string, html: string, fromName?: string}} opts
 */
export async function sendMail({ user, pass, to, subject, html, fromName = '焰境·万载官网' }) {
  const socket = connect({ hostname: HOST, port: PORT }, { secureTransport: 'on', allowHalfOpen: false });
  const writer = socket.writable.getWriter();
  const enc = new TextEncoder();

  try {
    const greeting = await readLine(socket);
    if (!greeting.startsWith('220')) throw new Error(`SMTP greeting failed: ${greeting}`);

    await command(socket, writer, 'EHLO whizzzest.com', '250');
    await command(socket, writer, 'AUTH LOGIN', '334');
    await command(socket, writer, btoa(user), '334');
    await command(socket, writer, btoa(pass), '235');
    await command(socket, writer, `MAIL FROM:<${user}>`, '250');
    await command(socket, writer, `RCPT TO:<${to}>`, '250');
    await command(socket, writer, 'DATA', '354');

    // Subject/From 显示名走 RFC 2047 Base64，支持中文
    const headers = [
      `From: =?UTF-8?B?${btoa(unescape(encodeURIComponent(fromName)))}?= <${user}>`,
      `To: <${to}>`,
      `Subject: =?UTF-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
    ];
    const body = btoa(unescape(encodeURIComponent(html)));
    // base64 按 76 字符折行（DATA 体不允许超长行）
    const wrapped = body.replace(/(.{76})/g, '$1\r\n');
    await writer.write(enc.encode(headers.join('\r\n') + '\r\n' + wrapped + '\r\n.\r\n'));
    const done = await readLine(socket);
    if (!done.startsWith('250')) throw new Error(`SMTP DATA rejected: ${done}`);

    await command(socket, writer, 'QUIT', '221').catch(() => {});
  } finally {
    writer.releaseLock();
    socket.close().catch(() => {});
  }
}
