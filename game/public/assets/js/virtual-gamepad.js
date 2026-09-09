/**
 * 焰境游戏 — 虚拟手柄（docs/游戏方案.md §4，阶段一命门件）
 *
 * 思路：手柄按键不直接对接游戏 API，而是**合成标准 KeyboardEvent**（按 keymap 映射到
 * 方向键/空格等标准键位）——游戏照常写 addEventListener('keydown')，键盘与触屏两路输入
 * 天然统一，阶段二模拟器内核（EmulatorJS 同样吃键盘事件）也零适配成本。
 *
 * 能力：
 *  - 十字键（四向 + 角向判定）、A/B 动作键、可选 L/R 肩键与 START/SELECT；
 *  - Pointer Events 多点触控（每指独立跟踪，斜走不丢键）、按压视觉态、navigator.vibrate 触感；
 *  - touch-action:none + 长按不弹菜单，游戏画面滚动/缩放零干扰；
 *  - 布局可配置，键盘向游戏可整体隐藏。
 *
 * 本模块不依赖运行页壳，可独立用于任意容器。
 */

const DEFAULT_KEYMAP = {
  up: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  down: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  left: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  right: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  a: { key: ' ', code: 'Space', keyCode: 32 },
  b: { key: 'z', code: 'KeyZ', keyCode: 90 },
  l: { key: 'a', code: 'KeyA', keyCode: 65 },
  r: { key: 's', code: 'KeyS', keyCode: 83 },
  start: { key: 'Enter', code: 'Enter', keyCode: 13 },
  select: { key: 'Shift', code: 'ShiftLeft', keyCode: 16 },
};

/** 默认布局：十字 + AB + L/R + START/SELECT（模拟器全键位；按 meta.gamepad 配置裁剪） */
export const FULL_LAYOUT = {
  dpad: true,
  face: ['b', 'a'],
  shoulders: ['l', 'r'],
  system: ['select', 'start'],
};

const LABELS = { a: 'A', b: 'B', l: 'L', r: 'R', start: 'START', select: 'SELECT' };

function synthKey(type, name, keymap) {
  const k = keymap[name] || DEFAULT_KEYMAP[name];
  if (!k) return;
  // 合成事件 isTrusted=false，但对 addEventListener 完全可达；游戏侧无需区分来源
  const ev = new KeyboardEvent(type, {
    key: k.key,
    code: k.code,
    keyCode: k.keyCode,
    which: k.keyCode,
    bubbles: true,
    cancelable: true,
  });
  (document.activeElement || window).dispatchEvent(ev);
}

function fire(type, name, keymap) {
  synthKey(type, name, keymap);
  if (type === 'keydown' && navigator.vibrate) {
    try { navigator.vibrate(8); } catch { /* 桌面无视 */ }
  }
}

export function mountGamepad(container, opts = {}) {
  const layout = opts.layout || FULL_LAYOUT;
  const keymap = opts.keymap || DEFAULT_KEYMAP;
  const pointers = new Map(); // pointerId -> button name（每指独立跟踪）

  const root = document.createElement('div');
  root.className = 'gp';
  root.setAttribute('aria-hidden', 'true'); // 纯触屏增强件，键盘用户不进 tab 序

  const press = (name, el) => {
    if (el.dataset.held) return;
    el.dataset.held = '1';
    el.classList.add('gp-on');
    fire('keydown', name, keymap);
  };
  const release = (name, el) => {
    if (!el.dataset.held) return;
    delete el.dataset.held;
    el.classList.remove('gp-on');
    fire('keyup', name, keymap);
  };
  const bindBtn = (el, name) => {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { name, el });
      press(name, el);
    });
    const up = (e) => {
      const held = pointers.get(e.pointerId);
      if (!held) return;
      pointers.delete(e.pointerId);
      release(held.name, held.el);
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('contextmenu', (e) => e.preventDefault()); // 长按不弹菜单
  };

  if (layout.shoulders && layout.shoulders.length) {
    const shoulders = document.createElement('div');
    shoulders.className = 'gp-shoulders';
    for (const name of layout.shoulders) {
      const b = document.createElement('button');
      b.className = 'gp-btn gp-shoulder';
      b.textContent = LABELS[name] || name;
      bindBtn(b, name);
      shoulders.appendChild(b);
    }
    root.appendChild(shoulders);
  }

  const mainRow = document.createElement('div');
  mainRow.className = 'gp-main';

  if (layout.dpad) {
    const dpad = document.createElement('div');
    dpad.className = 'gp-dpad';
    // 中心枢轴 + 四向臂：pointer 命中即判定，手指滑到另一臂时自动换向（走位不抬手）
    dpad.innerHTML =
      '<span class="gp-arm gp-up" data-dir="up"></span>' +
      '<span class="gp-arm gp-down" data-dir="down"></span>' +
      '<span class="gp-arm gp-left" data-dir="left"></span>' +
      '<span class="gp-arm gp-right" data-dir="right"></span>' +
      '<span class="gp-pivot"></span>';
    const arms = [...dpad.querySelectorAll('.gp-arm')];
    dpad.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      dpad.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { name: null, el: null, dpad: true });
      steer(e);
    });
    const steer = (e) => {
      const held = pointers.get(e.pointerId);
      if (!held || !held.dpad) return;
      const r = dpad.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      const want =
        Math.abs(dx) > Math.abs(dy) * 1.2 ? (dx > 0 ? 'right' : 'left')
        : Math.abs(dy) > Math.abs(dx) * 1.2 ? (dy > 0 ? 'down' : 'up')
        : null;
      for (const arm of arms) {
        const dir = arm.dataset.dir;
        if (dir === want) {
          press(dir, arm);
        } else {
          release(dir, arm);
        }
      }
    };
    dpad.addEventListener('pointermove', (e) => {
      e.preventDefault();
      steer(e);
    });
    const lift = (e) => {
      const held = pointers.get(e.pointerId);
      if (!held || !held.dpad) return;
      pointers.delete(e.pointerId);
      for (const arm of arms) release(arm.dataset.dir, arm);
    };
    dpad.addEventListener('pointerup', lift);
    dpad.addEventListener('pointercancel', lift);
    dpad.addEventListener('contextmenu', (e) => e.preventDefault());
    mainRow.appendChild(dpad);
  }

  if (layout.face && layout.face.length) {
    const face = document.createElement('div');
    face.className = 'gp-face';
    for (const name of layout.face) {
      const b = document.createElement('button');
      b.className = `gp-btn gp-${name}`;
      b.textContent = LABELS[name] || name;
      bindBtn(b, name);
      face.appendChild(b);
    }
    mainRow.appendChild(face);
  }
  root.appendChild(mainRow);

  if (layout.system && layout.system.length) {
    const sys = document.createElement('div');
    sys.className = 'gp-system';
    for (const name of layout.system) {
      const b = document.createElement('button');
      b.className = 'gp-btn gp-sys';
      b.textContent = LABELS[name] || name;
      bindBtn(b, name);
      sys.appendChild(b);
    }
    root.appendChild(sys);
  }

  container.appendChild(root);

  return {
    el: root,
    setVisible(v) { root.classList.toggle('gp-hidden', !v); },
    /** 供切换前后台时兜底：清掉所有按住的键（防「键卡死」） */
    releaseAll() {
      for (const { name, el } of pointers.values()) release(name, el);
      pointers.clear();
    },
  };
}
