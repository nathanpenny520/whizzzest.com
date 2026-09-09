/**
 * 焰境游戏 · 花炮合合（2048）—— 阶段一验收 Demo（触屏滑动路线）
 *
 * 验收点：滑动输入（触屏原生）、自动档存档（每步落盘）、刷新不丢档、
 * serialize/deserialize 适配器、游戏结束/通关提示。玩法即标准 2048，
 * 皮是花炮工坊：纸捻一路合到「焰火之吻」。
 */
const N = 4;
const LADDER = {
  2: '纸捻', 4: '火药', 8: '小鞭炮', 16: '大地红', 32: '双响', 64: '冲天炮',
  128: '加特林', 256: '孔雀开屏', 512: '锦冠', 1024: '千轮',
  2048: '焰火之吻', 4096: '焰火之吻+', 8192: '焰火之吻++',
};
const TONE = { // 数值 → 焰色梯度（低=火药棕，高=火花金）
  2: ['#3d2a1e', '#cdb49b'], 4: ['#4a2c18', '#e8c39a'], 8: ['#5a3013', '#f0a95c'],
  16: ['#6b3512', '#f5933c'], 32: ['#7c3a0f', '#f97e28'], 64: ['#8d3d0c', '#fa6a20'],
  128: ['#9c3a0a', '#ff5a24'], 256: ['#ab3a10', '#ff4a28'], 512: ['#b83a18', '#ff3d2e'],
  1024: ['#c33c20', '#ffcd3c'], 2048: ['#d64524', '#ffe08a'],
};

export default {
  version: 1,

  async mount(ctx) {
    this.ctx = ctx;
    const css = document.createElement('style');
    css.textContent = `
      .h-wrap { user-select:none; -webkit-user-select:none; touch-action:none; width:min(92vw,56vh,430px); }
      .h-head { display:flex; align-items:baseline; gap:10px; margin-bottom:10px; }
      .h-head b { font-size:20px; }
      .h-score { margin-left:auto; text-align:right; font-size:12px; color:#b9b0a6; line-height:1.5; }
      .h-score b { color:#f4d31f; font-size:16px; }
      .h-board { position:relative; aspect-ratio:1; border-radius:14px; background:rgba(255,244,230,.06);
                 border:1px solid rgba(255,244,230,.12); padding:8px; display:grid;
                 grid-template:repeat(4,1fr)/repeat(4,1fr); gap:8px; }
      .h-cell { border-radius:8px; background:rgba(255,244,230,.045); }
      .h-tiles { position:absolute; inset:8px; }
      .h-tile { position:absolute; left:0; top:0; width:calc((100% - 24px)/4); height:calc((100% - 24px)/4);
                border-radius:8px; display:grid; place-items:center; font-weight:800;
                transition:transform .12s cubic-bezier(.25,.1,.25,1); will-change:transform; }
      .h-tile span { display:block; font-size:clamp(11px,3.4vmin,20px); line-height:1.1; text-align:center; }
      .h-tile span small { display:block; font-size:.58em; font-weight:600; opacity:.75; }
      .h-pop { animation:h-pop .18s ease; } @keyframes h-pop { 50% { scale:1.14; } }
      .h-over { position:absolute; inset:0; border-radius:14px; background:rgba(21,10,5,.82);
                display:grid; place-items:center; gap:14px; align-content:center; text-align:center; }
      .h-over h3 { font-size:22px; } .h-over p { color:#b9b0a6; font-size:14px; }
      .h-restart { margin-top:4px; padding:9px 22px; border-radius:999px; border:0;
                   background:#d64524; color:#fff; font-size:14px; font-weight:600; }
    `;
    ctx.stage.appendChild(css);

    const wrap = document.createElement('div');
    wrap.className = 'h-wrap';
    wrap.innerHTML =
      '<div class="h-head"><b>花炮合合</b><div class="h-score">最高 <b class="h-best">0</b><br>得分 <span class="h-cur">0</span></div></div>' +
      '<div class="h-board"><div class="h-tiles"></div></div>';
    ctx.stage.appendChild(wrap);
    this.board = wrap.querySelector('.h-board');
    for (let i = 0; i < N * N; i++) {
      const cell = document.createElement('div');
      cell.className = 'h-cell';
      this.board.insertBefore(cell, this.board.querySelector('.h-tiles'));
    }
    this.tileLayer = wrap.querySelector('.h-tiles');
    this.elBest = wrap.querySelector('.h-best');
    this.elCur = wrap.querySelector('.h-cur');

    this.score = 0;
    this.best = 0;
    this.won = false;
    this.cells = Array.from({ length: N }, () => Array(N).fill(0));
    this.tiles = new Map();
    this.nextId = 1;

    this.bindInput(wrap);
    this.spawn(); this.spawn();
    this.render();
    this.ctx.autosave(this.serialize());
    this.ctx.toast('滑动 / 方向键 / 屏幕方向键（顶栏「手柄」）：合并相同方块，合出「焰火之吻」2048', 'warn');
  },

  /* ---------- 状态 ---------- */

  gridValues() {
    return this.cells.map((row) => row.map((id) => (id ? this.tiles.get(id).v : 0)));
  },

  addTile(r, c, v, pop) {
    const id = this.nextId++;
    const el = document.createElement('div');
    el.className = 'h-tile' + (pop ? ' h-pop' : '');
    const [bg, fg] = TONE[v] || ['#d64524', '#fff'];
    el.style.background = bg;
    el.style.color = fg;
    el.innerHTML = `<span>${v}<small>${LADDER[v] || '传说'}</small></span>`; // 数字全程显示——只显示名字看不出谁大谁小
    this.tileLayer.appendChild(el);
    this.tiles.set(id, { r, c, v, el });
    this.cells[r][c] = id;
    el.style.transform = `translate(calc(${c} * (100% + 8px)), calc(${r} * (100% + 8px)))`;
  },

  removeTile(r, c) {
    const id = this.cells[r][c];
    if (!id) return;
    const t = this.tiles.get(id);
    t.el.remove();
    this.tiles.delete(id);
    this.cells[r][c] = 0;
  },

  spawn() {
    const empty = [];
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (!this.cells[r][c]) empty.push([r, c]);
    if (!empty.length) return;
    const [r, c] = empty[(Math.random() * empty.length) | 0];
    this.addTile(r, c, Math.random() < 0.9 ? 2 : 4, true);
  },

  render() {
    this.elBest.textContent = this.best;
    this.elCur.textContent = this.score;
  },

  /* ---------- 玩法：按方向推紧 + 合并（dir：0左 1上 2右 3下） ---------- */

  move(dir) {
    const before = JSON.stringify(this.gridValues());
    // 每条线：外层 k 取垂直于移动方向的序号，深度 i 从「移动朝向的最前端」往后排
    let moved = false;
    for (let k = 0; k < N; k++) {
      const seq = [];
      for (let i = 0; i < N; i++) {
        if (dir === 0) seq.push([k, i]);             // 左：从最左列往后
        else if (dir === 2) seq.push([k, N - 1 - i]); // 右：从最右列往后
        else if (dir === 1) seq.push([i, k]);         // 上：从最上行往后
        else seq.push([N - 1 - i, k]);                // 下：从最下行往后
      }
      const vals = seq.map(([r, c]) => (this.cells[r][c] ? this.tiles.get(this.cells[r][c]).v : 0));
      // 压紧 + 相邻同值合并一次
      const stack = [];
      for (const v of vals) {
        if (!v) continue;
        const top = stack[stack.length - 1];
        if (top && top.v === v && !top.merged) { top.v *= 2; top.merged = true; }
        else stack.push({ v, merged: false });
      }
      // 与原序列比较：完全一致 = 这条线没动
      const same = stack.length === vals.filter(Boolean).length &&
        stack.every((s, i) => s.v === vals.filter(Boolean)[i]);
      if (same) continue;
      // 清线重建
      for (const [r, c] of seq) this.removeTile(r, c);
      stack.forEach((s, i) => {
        const [r, c] = seq[i];
        this.addTile(r, c, s.v, s.merged);
        if (s.merged) this.score += s.v;
      });
      moved = true;
    }
    if (!moved) return;

    if (this.score > this.best) this.best = this.score;
    this.spawn();
    this.render();

    if (!this.won && this.gridValues().flat().includes(2048)) {
      this.won = true;
      this.ctx.toast('合成「焰火之吻」！可以继续往上合 🔥', 'warn');
    }
    if (!this.canMove()) this.showOver();
    this.ctx.autosave(this.serialize());
  },

  canMove() {
    const g = this.gridValues();
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      if (!g[r][c]) return true;
      if (c < N - 1 && g[r][c] === g[r][c + 1]) return true;
      if (r < N - 1 && g[r][c] === g[r + 1][c]) return true;
    }
    return false;
  },

  showOver() {
    const over = document.createElement('div');
    over.className = 'h-over';
    over.innerHTML = `<h3>火药受潮，散场</h3><p>得分 ${this.score} · 最高 ${this.best}</p>`;
    const btn = document.createElement('button');
    btn.className = 'h-restart';
    btn.textContent = '再来一炉';
    btn.onclick = () => { over.remove(); this.restart(); };
    over.appendChild(btn);
    this.board.appendChild(over);
  },

  restart() {
    for (const t of [...this.tiles.values()]) {
      t.el.remove();
    }
    this.tiles.clear();
    this.cells = Array.from({ length: N }, () => Array(N).fill(0));
    this.score = 0;
    this.won = false;
    this.spawn(); this.spawn();
    this.render();
    this.ctx.autosave(this.serialize());
    this.ctx.toast('新的一炉，开合！');
  },

  /* ---------- 输入：方向键/WASD + 触屏滑动 ---------- */

  bindInput(wrap) {
    const KEYMAP = { ArrowLeft: 0, ArrowUp: 1, ArrowRight: 2, ArrowDown: 3, a: 0, w: 1, d: 2, s: 3, A: 0, W: 1, D: 2, S: 3 };
    this.onKey = (e) => {
      if (!(e.key in KEYMAP)) return;
      e.preventDefault();
      this.move(KEYMAP[e.key]);
    };
    window.addEventListener('keydown', this.onKey);

    let sx = 0, sy = 0, tracking = false;
    wrap.addEventListener('pointerdown', (e) => { sx = e.clientX; sy = e.clientY; tracking = true; });
    wrap.addEventListener('pointerup', (e) => {
      if (!tracking) return;
      tracking = false;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
      this.move(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 2 : 0) : dy > 0 ? 3 : 1);
    });
  },

  /* ---------- 存档适配器（方案 §2） ---------- */

  serialize() {
    return { grid: this.gridValues(), score: this.score, best: this.best, won: this.won };
  },

  deserialize(data) {
    if (!data || !Array.isArray(data.grid) || data.grid.length !== N) throw new Error('存档棋盘尺寸不符');
    for (const t of [...this.tiles.values()]) t.el.remove();
    this.tiles.clear();
    this.cells = Array.from({ length: N }, () => Array(N).fill(0));
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const v = data.grid[r][c];
      if (v) this.addTile(r, c, v, false);
    }
    this.score = data.score || 0;
    this.best = Math.max(data.best || 0, this.score);
    this.won = !!data.won;
    this.render();
    this.board.querySelector('.h-over')?.remove();
  },
};
