/**
 * ai-chat.js — AI 助手「花傩」全站悬浮入口（docs/AI助手方案.md）
 * 原生 JS 零依赖；DOM 全由本脚本构建，无 JS 时页面零侵入。
 * 交互：左下角悬浮球 → 面板问答（快捷问题 / 打字机 / 知识来源 / 站内跳转按钮）；
 * 历史存 localStorage 最近 20 条，请求带最近 6 条做上下文。
 */
'use strict';

(function () {
  var HISTORY_KEY = 'hn_chat_history';
  var GREET_KEY = 'hn_greet_done';
  var HISTORY_MAX = 20;
  var HISTORY_SEND = 6;
  var TYPE_SPEED = 25;          // 打字机 tick（ms）
  var TYPE_THRESHOLD = 40;      // 超过此长度才启用打字机
  var GREET_DELAY = 8000;       // 招呼气泡延迟

  /* 焰形图标（与站点 favicon 同源意象） */
  var FLAME = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2c.3 3.1-1 4.9-2.9 6.6C7 10.5 5 12.4 5 15.5 5 19.1 8.1 22 12 22s7-2.9 7-6.5c0-2.6-1.3-4.4-2.7-6-.5 1-1.2 1.8-2.1 2.3.4-3.5-.4-7.3-2.2-9.8zm.3 11c1.4 1.5 2.2 2.7 2.2 4.3 0 1.6-1.1 2.7-2.5 2.7s-2.5-1.1-2.5-2.7c0-1.8 1.4-2.9 2.8-4.3z"/></svg>';
  var ICON_CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  var ICON_TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m-9 0l1 13h8l1-13"/></svg>';
  var ICON_SEND = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5m0 0l-6 6m6-6l6 6"/></svg>';
  var ICON_ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14m0 0l-6-6m6 6l-6 6"/></svg>';

  /* open_page 路径 → 跳转按钮文案 */
  var ROUTE_LABELS = [
    ['/tv', '万载TV'], ['/library', '焰境文库'], ['/music', '万载音乐'],
    ['/attractions', '旅游景点'], ['/merchants', '商户名录'], ['/spots', '观赏 spots'],
    ['/cuisine', '美食'], ['/heritage', '非遗文化'], ['/industry', '花炮产业'],
    ['/tourism', '旅游线路'], ['/about', '关于本站'], ['/pay', '付费合作'],
  ];

  var config = { enabled: true, greeting: '', quick: [] };
  var messages = loadHistory();
  var busy = false;
  var fab, greetTimer = null;
  var els = {};

  /* ---------------- 初始化 ---------------- */

  init();

  function init() {
    fetch('/api/ai/config').then(function (r) { return r.ok ? r.json() : null; }).then(function (c) {
      if (c && c.ok) config = { enabled: !!c.enabled, greeting: c.greeting || '', quick: c.quick || [] };
      if (!config.enabled) return;          // 后台停用 → 不渲染任何入口
      buildFab();
      buildPanel();
      scheduleGreeting();
    }).catch(function () {
      buildFab(); buildPanel();             // 配置接口异常按可用处理，问题不大
    });
  }

  function scheduleGreeting() {
    if (!config.greeting || sessionStorage.getItem(GREET_KEY)) return;
    greetTimer = setTimeout(function () {
      sessionStorage.setItem(GREET_KEY, '1');
      var b = document.createElement('div');
      b.className = 'hn-greet';
      b.setAttribute('role', 'button');
      b.textContent = config.greeting;
      b.addEventListener('click', function () { b.remove(); openPanel(); });
      document.body.appendChild(b);
      els.greet = b;
    }, GREET_DELAY);
  }

  /* ---------------- DOM 构建 ---------------- */

  function buildFab() {
    fab = document.createElement('button');
    fab.className = 'hn-fab';
    fab.type = 'button';
    fab.setAttribute('aria-label', '打开花傩智能问答');
    fab.setAttribute('aria-expanded', 'false');
    fab.innerHTML = FLAME;
    fab.addEventListener('click', togglePanel);
    document.body.appendChild(fab);
  }

  function buildPanel() {
    var p = document.createElement('div');
    p.className = 'hn-panel';
    p.id = 'hn-panel';
    p.setAttribute('role', 'dialog');
    p.setAttribute('aria-label', '花傩智能问答');
    p.hidden = true;
    p.innerHTML =
      '<div class="hn-head">' +
        '<span class="hn-head-flame">' + FLAME + '</span>' +
        '<span class="hn-head-title">花傩 · 万载智能问答</span>' +
        '<button type="button" class="hn-head-btn" data-hn="clear" aria-label="清空对话" title="清空对话">' + ICON_TRASH + '</button>' +
        '<button type="button" class="hn-head-btn" data-hn="close" aria-label="关闭" title="关闭">' + ICON_CLOSE + '</button>' +
      '</div>' +
      '<div class="hn-body"></div>' +
      '<div class="hn-input">' +
        '<textarea rows="1" maxlength="200" placeholder="问点什么…（Enter 发送）" aria-label="输入问题"></textarea>' +
        '<button type="button" class="hn-send" aria-label="发送" disabled>' + ICON_SEND + '</button>' +
      '</div>';
    document.body.appendChild(p);

    els.panel = p;
    els.body = p.querySelector('.hn-body');
    els.input = p.querySelector('textarea');
    els.send = p.querySelector('.hn-send');

    p.querySelector('[data-hn="close"]').addEventListener('click', closePanel);
    p.querySelector('[data-hn="clear"]').addEventListener('click', clearHistory);
    els.send.addEventListener('click', function () { submit(els.input.value); });
    els.input.addEventListener('input', autosize);
    els.input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submit(els.input.value);
      }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !els.panel.hidden) closePanel();
    });
    renderMessages();
  }

  /* ---------------- 面板开关 ---------------- */

  function togglePanel() { els.panel.hidden ? openPanel() : closePanel(); }

  function openPanel() {
    clearTimeout(greetTimer);
    if (els.greet) { els.greet.remove(); els.greet = null; }
    sessionStorage.setItem(GREET_KEY, '1');
    els.panel.hidden = false;
    fab.setAttribute('aria-expanded', 'true');
    if (window.innerWidth <= 640) document.body.classList.add('hn-lock');
    els.input.focus();
    scrollBottom();
  }

  function closePanel() {
    els.panel.hidden = true;
    fab.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('hn-lock');
    fab.focus();
  }

  /* ---------------- 消息渲染 ---------------- */

  function renderMessages() {
    els.body.innerHTML = '';
    if (!messages.length) {
      var w = document.createElement('div');
      w.className = 'hn-welcome';
      w.innerHTML =
        '<span class="hn-welcome-flame">' + FLAME + '</span>' +
        '<div class="hn-welcome-title">你好，我是花傩</div>' +
        '<div class="hn-welcome-desc">万载文旅智能问答助手，烟花、非遗、美食、行程都可以问我。</div>';
      var q = document.createElement('div');
      q.className = 'hn-quick';
      (config.quick.length ? config.quick : DEFAULT_QUICK).forEach(function (t) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = t;
        btn.addEventListener('click', function () { submit(t); });
        q.appendChild(btn);
      });
      w.appendChild(q);
      els.body.appendChild(w);
      return;
    }
    messages.forEach(function (m) { appendBubble(m.role, m.content, m.extra, false); });
    scrollBottom();
  }

  var DEFAULT_QUICK = ['万载古城烟花秀什么时候看？', '有哪些必吃的万载美食？', '推荐一条一日游线路', '万载有哪些非物质文化遗产？'];

  function appendBubble(role, text, extra, animate) {
    var row = document.createElement('div');
    row.className = 'hn-msg ' + (role === 'user' ? 'user' : 'ai');
    var bubble = document.createElement('div');
    bubble.className = 'hn-msg-bubble';
    row.appendChild(bubble);

    if (role === 'user') {
      bubble.textContent = text;
      els.body.appendChild(row);
      scrollBottom();
      return row;
    }

    if (animate && text.length > TYPE_THRESHOLD) {
      typewrite(bubble, text, extra);
    } else {
      fillBubble(bubble, text, extra);
    }
    els.body.appendChild(row);
    scrollBottom();
    return row;
  }

  /** 完整填充：Markdown 白名单渲染 + 知识来源 + 站内跳转按钮 */
  function fillBubble(bubble, text, extra) {
    bubble.innerHTML = mdLite(text);
    if (extra && extra.sources && extra.sources.length) {
      var src = document.createElement('div');
      src.className = 'hn-src';
      src.textContent = '知识来源：' + extra.sources.join(' · ');
      bubble.appendChild(src);
    }
    if (extra && extra.route) {
      var a = document.createElement('a');
      a.className = 'hn-act';
      a.href = extra.route;
      a.innerHTML = routeLabel(extra.route) + ' ' + ICON_ARROW;
      bubble.appendChild(a);
    }
  }

  /** 打字机：打字阶段纯文本，完成后一次性换白名单渲染的 HTML（半截标签不安全也不好看） */
  function typewrite(bubble, full, extra) {
    var pos = 0;
    var dot = document.createElement('div');
    dot.innerHTML = '<span class="hn-typing"><i></i><i></i><i></i></span>';
    bubble.innerHTML = '';
    bubble.appendChild(dot.firstChild);
    var timer = setInterval(function () {
      pos += 2 + Math.floor(Math.random() * 3);
      if (pos >= full.length) {
        clearInterval(timer);
        fillBubble(bubble, full, extra);
        scrollBottom();
      } else {
        bubble.textContent = full.slice(0, pos);
        scrollBottom();
      }
    }, TYPE_SPEED);
  }

  function routeLabel(route) {
    for (var i = 0; i < ROUTE_LABELS.length; i++) {
      if (route === ROUTE_LABELS[i][0] || route.indexOf(ROUTE_LABELS[i][0] + '/') === 0) {
        return '前往' + ROUTE_LABELS[i][1];
      }
    }
    return '打开页面';
  }

  /* ---------------- 发送 ---------------- */

  function submit(raw) {
    var text = String(raw || '').trim();
    if (!text || busy) return;
    els.input.value = '';
    autosize();

    var wasEmpty = messages.length === 0;
    messages.push({ role: 'user', content: text });
    saveHistory();
    if (wasEmpty) renderMessages();   // 首问：欢迎态让位消息列表
    else appendBubble('user', text);

    busy = true;
    els.send.disabled = true;
    var typingRow = appendBubble('ai', '', null, false);
    var bubble = typingRow.firstChild;
    bubble.innerHTML = '<span class="hn-typing"><i></i><i></i><i></i></span>';

    var done = function (reply, extra) {
      messages.push({ role: 'assistant', content: reply, extra: extra });
      saveHistory();
      // 打字机在原气泡上接续；短回复直接出渲染态
      if (reply.length > TYPE_THRESHOLD) typewrite(bubble, reply, extra);
      else fillBubble(bubble, reply, extra);
    };

    fetch('/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: text,
        history: messages.slice(-HISTORY_SEND - 1, -1).map(function (m) {
          return { role: m.role, content: m.content };
        }),
        path: location.pathname,
      }),
    }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (j) { return { status: r.status, json: j }; });
    }).then(function (res) {
      var j = res.json || {};
      var reply = j.text || (res.status === 429 ? '问题有点多啦，请休息几分钟再问。' : '花傩暂时不在，请稍后再试。');
      var extra = {};
      if (j.sources && j.sources.length) extra.sources = j.sources;
      if (j.action && j.action.type === 'open_page' && j.action.payload && j.action.payload.route) {
        extra.route = j.action.payload.route;
      }
      done(reply, extra);
    }).catch(function () {
      done('网络异常，请稍后再试。', {});
    }).finally(function () {
      busy = false;
      els.send.disabled = !els.input.value.trim();
      scrollBottom();
    });
  }

  function clearHistory() {
    if (messages.length && !window.confirm('确定清空全部对话记录？')) return;
    messages = [];
    try { localStorage.removeItem(HISTORY_KEY); } catch (e) { /* 隐私模式等，忽略 */ }
    renderMessages();
  }

  /* ---------------- 工具 ---------------- */

  function loadHistory() {
    try {
      var raw = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
      return Array.isArray(raw) ? raw.slice(-HISTORY_MAX) : [];
    } catch (e) { return []; }
  }

  function saveHistory() {
    try {
      // extra 不落盘历史渲染态：恢复时 sources/route 已随消息存档，直接留
      localStorage.setItem(HISTORY_KEY, JSON.stringify(messages.slice(-HISTORY_MAX)));
    } catch (e) { /* 配额满等，忽略 */ }
  }

  function autosize() {
    var t = els.input;
    t.style.height = 'auto';
    t.style.height = Math.min(96, t.scrollHeight) + 'px';
    els.send.disabled = busy || !t.value.trim();
  }

  function scrollBottom() {
    els.body.scrollTop = els.body.scrollHeight;
  }

  /** Markdown 白名单渲染：全文先转义，仅放行粗体/斜体/行内代码/无序列表/站内与 https 链接 */
  function mdLite(src) {
    function esc(s) {
      return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function inline(s) {
      return s
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (m, t, href) {
          if (/^https?:\/\//.test(href)) {
            return '<a href="' + href + '" target="_blank" rel="noopener noreferrer">' + t + '</a>';
          }
          if (/^\//.test(href)) return '<a href="' + href + '">' + t + '</a>';
          return m;
        });
    }
    var lines = esc(src).split(/\r?\n/);
    var html = '';
    var inList = false;
    for (var i = 0; i < lines.length; i++) {
      var li = lines[i].match(/^\s*[-*•]\s+(.*)$/);
      if (li) {
        if (!inList) { html += '<ul>'; inList = true; }
        html += '<li>' + inline(li[1]) + '</li>';
        continue;
      }
      if (inList) { html += '</ul>'; inList = false; }
      if (lines[i].trim() === '') continue;
      html += '<p>' + inline(lines[i]) + '</p>';
    }
    if (inList) html += '</ul>';
    return html;
  }
})();
