/**
 * 焰境游戏 · 接烟花 —— 阶段一验收 Demo（虚拟手柄路线）
 *
 * 验收点：虚拟手柄合成键盘事件驱动（方向键移动 + 空格开始/重来）、Canvas 渲染
 * （DPR 自适应）、拖动触屏输入、自动档（最高分落盘）、serialize/deserialize 适配器。
 * 玩法：接住落下的烟花，漏三颗散场；越接越快。
 */
export default {
  version: 1,

  async mount(ctx) {
    this.ctx = ctx;
    this.font = getComputedStyle(document.body).fontFamily;
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'width:100%;height:100%;display:block;touch-action:none;';
    ctx.stage.appendChild(this.canvas);
    this.g = this.canvas.getContext('2d');

    this.best = 0;
    this.reset();
    this.bindInput();

    this.resize = () => {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      this.w = this.canvas.clientWidth;
      this.h = this.canvas.clientHeight;
      this.canvas.width = this.w * dpr;
      this.canvas.height = this.h * dpr;
      this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.stars = Array.from({ length: 60 }, () => [Math.random() * this.w, Math.random() * this.h * 0.7, Math.random() * 1.2 + 0.3]);
    };
    new ResizeObserver(this.resize).observe(this.canvas);
    this.resize();

    let last = performance.now();
    this.loop = (t) => {
      const dt = Math.min((t - last) / 1000, 0.05);
      last = t;
      this.step(dt);
      this.draw();
      this.raf = requestAnimationFrame(this.loop);
    };
    this.raf = requestAnimationFrame(this.loop);
    this.ctx.toast('方向键 / 拖动移动 · 空格开始', 'warn');
  },

  reset() {
    this.mode = 'idle';           // idle | playing | over
    this.score = 0;
    this.lives = 3;
    this.bx = 0.5;                // 碗位置（0..1 比例坐标）
    this.items = [];              // {x,y,vy,hue,r}
    this.sparks = [];             // {x,y,vx,vy,life,hue}
    this.spawnEvery = 1.1;
    this.spawnT = 0.4;
    this.speedT = 0;              // 计时：随时间加速
  },

  /* ---------- 主循环 ---------- */

  step(dt) {
    // 移动输入（键盘按住 = 持续移动；虚拟手柄合成同样的 keydown/keyup）
    const v = 0.9;
    if (this.held.left) this.bx = Math.max(0.06, this.bx - v * dt);
    if (this.held.right) this.bx = Math.min(0.94, this.bx + v * dt);

    if (this.mode !== 'playing') return;

    this.speedT += dt;
    const speedUp = 1 + Math.min(this.speedT / 30, 1.4); // 30 秒后到顶 2.4x

    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = this.spawnEvery / speedUp;
      this.items.push({
        x: 0.06 + Math.random() * 0.88,
        y: -0.05,
        vy: (0.28 + Math.random() * 0.12) * speedUp,
        hue: Math.random() * 60 - 15 + (Math.random() < 0.3 ? 180 : 0), // 焰红橙为主，偶发青金
        r: 9 + Math.random() * 7,
      });
    }

    for (const it of this.items) it.y += it.vy * dt;
    const basketY = 0.86;
    for (const it of this.items) {
      if (it.y > basketY - 0.035 && it.y < basketY + 0.06 && Math.abs(it.x - this.bx) < 0.075) {
        it.dead = true;
        this.score++;
        if (this.score > this.best) {
          this.best = this.score;
          this.ctx.autosave(this.serialize()); // 破纪录即落盘
        }
        for (let i = 0; i < 14; i++) {
          const a = Math.random() * Math.PI * 2;
          this.sparks.push({ x: it.x, y: basketY - 0.03, vx: Math.cos(a) * 0.25, vy: Math.sin(a) * 0.35 - 0.15, life: 0.5 + Math.random() * 0.3, hue: it.hue });
        }
      } else if (it.y > 1.06) {
        it.dead = true;
        this.lives--;
        if (this.lives <= 0) {
          this.mode = 'over';
          this.ctx.autosave(this.serialize());
        }
      }
    }
    this.items = this.items.filter((i) => !i.dead);
    for (const s of this.sparks) { s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 1.1 * dt; s.life -= dt; }
    this.sparks = this.sparks.filter((s) => s.life > 0);
  },

  draw() {
    const g = this.g, w = this.w, h = this.h;
    if (!w) return;
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#1c0d06');
    grad.addColorStop(1, '#150a05');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);

    g.fillStyle = 'rgba(244,209,31,0.5)';
    for (const [x, y, r] of this.stars || []) g.fillRect(x, y, r, r);

    // 落下的烟花
    for (const it of this.items) {
      g.beginPath();
      g.arc(it.x * w, it.y * h, it.r, 0, Math.PI * 2);
      g.fillStyle = `hsl(${it.hue} 95% 62%)`;
      g.shadowColor = `hsl(${it.hue} 95% 55%)`;
      g.shadowBlur = 16;
      g.fill();
      g.shadowBlur = 0;
    }
    // 接住的火花
    for (const s of this.sparks) {
      g.fillStyle = `hsla(${s.hue} 95% 65%, ${s.life})`;
      g.fillRect(s.x * w - 2, s.y * h - 2, 4, 4);
    }
    // 碗
    const bx = this.bx * w, by = 0.86 * h, bw = w * 0.09;
    g.beginPath();
    g.arc(bx, by, bw, 0, Math.PI);
    g.fillStyle = '#d64524';
    g.shadowColor = '#f0572f';
    g.shadowBlur = 22;
    g.fill();
    g.shadowBlur = 0;

    // 记分 / 状态
    g.fillStyle = '#f4f1ec';
    g.font = `600 16px ${this.font}`;
    g.fillText(`得分 ${this.score}  最佳 ${this.best}`, 16, 30);
    g.fillText('🧨'.repeat(Math.max(this.lives, 0)), w - 16 - this.lives * 22, 30);

    g.textAlign = 'center';
    if (this.mode === 'idle') {
      g.font = `700 22px ${this.font}`;
      g.fillText('夜空开始掉烟花了', w / 2, h * 0.42);
      g.fillStyle = '#b9b0a6';
      g.font = `14px ${this.font}`;
      g.fillText('接住它们！漏三颗就散场', w / 2, h * 0.42 + 30);
      g.fillStyle = '#f4d31f';
      g.fillText('点击画面 或 按 空格 开始', w / 2, h * 0.42 + 62);
    } else if (this.mode === 'over') {
      g.font = `700 24px ${this.font}`;
      g.fillText('散场！', w / 2, h * 0.42);
      g.fillStyle = '#b9b0a6';
      g.font = `15px ${this.font}`;
      g.fillText(`本次 ${this.score} · 最佳 ${this.best}`, w / 2, h * 0.42 + 32);
      g.fillStyle = '#f4d31f';
      g.fillText('点击画面 或 按 空格 再来', w / 2, h * 0.42 + 64);
    }
    g.textAlign = 'left';
  },

  start() {
    this.reset();
    this.mode = 'playing';
  },

  /* ---------- 输入：键盘（虚拟手柄合成同样事件）+ 触屏拖动 ---------- */

  bindInput() {
    this.held = { left: false, right: false };
    this.onKey = (e, down) => {
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') { this.held.left = down; e.preventDefault(); }
      if (e.code === 'ArrowRight' || e.code === 'KeyD') { this.held.right = down; e.preventDefault(); }
      if (e.code === 'Space' && down) {
        if (this.mode !== 'playing') this.start();
        e.preventDefault();
      }
    };
    this.kd = (e) => this.onKey(e, true);
    this.ku = (e) => this.onKey(e, false);
    window.addEventListener('keydown', this.kd);
    window.addEventListener('keyup', this.ku);

    const drag = (e) => {
      const r = this.canvas.getBoundingClientRect();
      this.bx = Math.min(0.94, Math.max(0.06, (e.clientX - r.left) / r.width));
    };
    this.canvas.addEventListener('pointerdown', (e) => {
      if (this.mode !== 'playing') this.start();
      this.canvas.setPointerCapture(e.pointerId);
      drag(e);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (e.buttons || e.pointerType === 'touch') drag(e);
    });
  },

  /* ---------- 存档适配器（方案 §2）：本作存「最佳成绩」 ---------- */

  serialize() {
    return { best: this.best };
  },

  deserialize(data) {
    this.best = Math.max(data.best || 0, this.best);
  },
};
