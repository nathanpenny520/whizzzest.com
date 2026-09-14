/**
 * 焰境密语 — DO RateLimiter（每 IP 一个纯协调对象，照 workers-chat-demo）
 * 无持久化：只关心最近请求节奏，重启丢失无碍。POST 一动作 5 秒 + 20s 宽限（允许 4-5 连发再限）。
 */

export class RateLimiter {
  constructor(state, env) {
    this.nextAllowedTime = 0;
  }
  async fetch(request) {
    const now = Date.now() / 1000;
    this.nextAllowedTime = Math.max(now, this.nextAllowedTime);
    if (request.method === 'POST') this.nextAllowedTime += 5;
    const cooldown = Math.max(0, this.nextAllowedTime - now - 20);
    return new Response(String(cooldown));
  }
}

/** 客户端侧限流调用（IMRoom 发消息用；照 workers-chat-demo RateLimiterClient） */
export class RateLimiterClient {
  constructor(getLimiterStub, reportError) {
    this.getLimiterStub = getLimiterStub;
    this.reportError = reportError;
    this.limiter = getLimiterStub();
    this.inCooldown = false;
  }
  checkLimit() {
    if (this.inCooldown) return false;
    this.inCooldown = true;
    this.callLimiter();
    return true;
  }
  async callLimiter() {
    try {
      let response;
      try {
        response = await this.limiter.fetch('https://rate-limiter', { method: 'POST' });
      } catch {
        this.limiter = this.getLimiterStub();
        response = await this.limiter.fetch('https://rate-limiter', { method: 'POST' });
      }
      const cooldown = +(await response.text());
      if (cooldown > 0) await new Promise((resolve) => setTimeout(resolve, cooldown * 1000));
      this.inCooldown = false;
    } catch (err) {
      this.reportError(err);
      this.inCooldown = false; // 限流器故障兜底：fail-open，不因它永久卡死发消息（每会话 10条/10s 仍在）
    }
  }
}
