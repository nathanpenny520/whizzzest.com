/**
 * ai-chat.js — AI 助手「花傩」全站悬浮入口（docs/AI助手方案.md）
 * 原生 JS 零依赖；DOM 全由本脚本构建，无 JS 时页面零侵入。
 * 交互：左下角悬浮球 → 面板问答（快捷问题 / 打字机 / 知识来源 / 站内跳转按钮）。
 * 会话管理（2026-09-07）：多会话历史存 localStorage（置顶/重命名/删除/切换），
 *   请求带当前会话最近 6 条做上下文；v1.0 单会话历史自动迁移。
 * 招呼气泡已移除：欢迎态在面板内，用户点开即见。
 */
'use strict';

(function () {
  var SESSIONS_KEY = 'hn_chat_sessions';
  var CURRENT_KEY = 'hn_chat_current';
  var LEGACY_KEY = 'hn_chat_history';  // v1.0 单会话扁平历史：迁移进会话后即删
  var SESSIONS_MAX = 30;               // 会话总数上限（超出按 置顶>最近更新 淘汰）
  var HISTORY_MAX = 20;                // 每会话消息条数上限
  var HISTORY_SEND = 6;                // 请求携带的上下文条数
  var TYPE_SPEED = 25;          // 打字机 tick（ms）
  var TYPE_THRESHOLD = 40;      // 超过此长度才启用打字机

  /* 焰形图标（与站点 favicon 同源意象；2026-09-07 起图标改用下方 NUO 娃娃，此常量留作备用） */
  var FLAME = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2c.3 3.1-1 4.9-2.9 6.6C7 10.5 5 12.4 5 15.5 5 19.1 8.1 22 12 22s7-2.9 7-6.5c0-2.6-1.3-4.4-2.7-6-.5 1-1.2 1.8-2.1 2.3.4-3.5-.4-7.3-2.2-9.8zm.3 11c1.4 1.5 2.2 2.7 2.2 4.3 0 1.6-1.1 2.7-2.5 2.7s-2.5-1.1-2.5-2.7c0-1.8 1.4-2.9 2.8-4.3z"/></svg>';
  /* 花傩娃娃（2026-09-07 由旧站 HuaNuoCharacter 纯 CSS 移植）：静态 idle 单一形态，
     无 Live2D、无状态机；样式见 ai-chat.css，尺寸随容器 .hn-nuo 的 --s 变量缩放 */
  var NUO =
    '<span class="hn-nuo" aria-hidden="true">' +
      '<span class="hn-nuo-body">' +
        '<span class="hn-nuo-hair-back"></span>' +
        '<span class="hn-nuo-hair-front"></span>' +
        '<span class="hn-nuo-face">' +
          '<span class="hn-nuo-mask">' +
            '<span class="hn-nuo-orn hn-nuo-orn-l"></span>' +
            '<span class="hn-nuo-orn hn-nuo-orn-r"></span>' +
          '</span>' +
          '<span class="hn-nuo-eyes">' +
            '<span class="hn-nuo-eye"><span class="hn-nuo-pupil"></span></span>' +
            '<span class="hn-nuo-eye"><span class="hn-nuo-pupil"></span></span>' +
          '</span>' +
          '<span class="hn-nuo-mouth"></span>' +
        '</span>' +
        '<span class="hn-nuo-ear hn-nuo-ear-l"></span>' +
        '<span class="hn-nuo-ear hn-nuo-ear-r"></span>' +
        '<span class="hn-nuo-shoulder"></span>' +
      '</span>' +
    '</span>';
  var ICON_CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  var ICON_TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m-9 0l1 13h8l1-13"/></svg>';
  var ICON_SEND = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5m0 0l-6 6m6-6l6 6"/></svg>';
  var ICON_ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14m0 0l-6-6m6 6l-6 6"/></svg>';
  var ICON_HISTORY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
  var ICON_PIN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1z"/></svg>';
  var ICON_EDIT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>';
  var ICON_PLUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';

  /* open_page 路径 → 跳转按钮文案（per-locale 名称表在 strings.json js.ai.routes） */
  var ROUTES = ['/tv', '/library', '/music', '/attractions', '/merchants', '/spots',
    '/cuisine', '/heritage', '/industry', '/tourism', '/digital-fireworks', '/about', '/pay'];

  var config = { enabled: true, quick: [] };
  /* 多语言（docs/英文版方案.md Phase 1）：build.js 注入 window.__I18N（静态页）；
     Worker 动态页无注入 → 全部走代码内 zh 兜底。 */
  var I18N = window.__I18N || {};
  var LOCALE = I18N.locale || (document.documentElement.lang || 'zh-CN').slice(0, 2).toLowerCase();
  var IS_EN = LOCALE === 'en';
  function t(path, fallback) {
    var v = path.split('.').reduce(function (node, key) { return node == null ? undefined : node[key]; }, I18N);
    return v == null ? fallback : v;
  }
  var sessions = loadSessions();
  var currentId = restoreCurrent();
  var listing = false;          // 面板是否处于历史列表视图
  var busy = false;
  var fab;
  var els = {};

  /* ---------------- 初始化 ---------------- */

  init();

  function init() {
    // EN 页请求英文招呼语/快捷问题（zh 不带参数，保持请求形态不变）
    fetch(IS_EN ? '/api/ai/config?lang=en' : '/api/ai/config').then(function (r) { return r.ok ? r.json() : null; }).then(function (c) {
      if (c && c.ok) config = { enabled: !!c.enabled, quick: c.quick || [], greeting: c.greeting || '' };
      if (!config.enabled) return;          // 后台停用 → 不渲染任何入口
      buildFab();
      buildPanel();
    }).catch(function () {
      buildFab(); buildPanel();             // 配置接口异常按可用处理，问题不大
    });
  }

  /* ---------------- DOM 构建 ---------------- */

  function buildFab() {
    fab = document.createElement('button');
    fab.className = 'hn-fab';
    fab.type = 'button';
    fab.setAttribute('aria-label', t('ai.fabAria', '打开花傩智能问答'));
    fab.setAttribute('aria-expanded', 'false');
    fab.innerHTML = NUO;
    fab.addEventListener('click', togglePanel);
    document.body.appendChild(fab);
  }

  function buildPanel() {
    var p = document.createElement('div');
    p.className = 'hn-panel';
    p.id = 'hn-panel';
    p.setAttribute('role', 'dialog');
    p.setAttribute('aria-label', t('ai.panelAria', '花傩智能问答'));
    p.hidden = true;
    p.innerHTML =
      '<div class="hn-head">' +
        '<span class="hn-head-flame">' + NUO + '</span>' +
        '<span class="hn-head-title">' + t('ai.panelTitle', '花傩 · 万载智能问答') + '</span>' +
        '<button type="button" class="hn-head-btn" data-hn="list" aria-label="' + t('ai.historyAria', '历史对话') + '" title="' + t('ai.historyAria', '历史对话') + '">' + ICON_HISTORY + '</button>' +
        '<button type="button" class="hn-head-btn" data-hn="clear" aria-label="' + t('ai.clearAria', '清空当前对话') + '" title="' + t('ai.clearAria', '清空当前对话') + '">' + ICON_TRASH + '</button>' +
        '<button type="button" class="hn-head-btn" data-hn="close" aria-label="' + t('ai.closeAria', '关闭') + '" title="' + t('ai.closeAria', '关闭') + '">' + ICON_CLOSE + '</button>' +
      '</div>' +
      '<div class="hn-body"></div>' +
      '<div class="hn-history" hidden></div>' +
      '<div class="hn-input">' +
        '<textarea rows="1" maxlength="200" placeholder="' + t('ai.inputPlaceholder', '问点什么…（Enter 发送）') + '" aria-label="' + t('ai.inputPlaceholder', '输入问题') + '"></textarea>' +
        '<button type="button" class="hn-send" aria-label="' + t('ai.sendAria', '发送') + '" disabled>' + ICON_SEND + '</button>' +
      '</div>';
    document.body.appendChild(p);

    els.panel = p;
    els.body = p.querySelector('.hn-body');
    els.history = p.querySelector('.hn-history');
    els.inputWrap = p.querySelector('.hn-input');
    els.input = p.querySelector('textarea');
    els.send = p.querySelector('.hn-send');
    els.listBtn = p.querySelector('[data-hn="list"]');

    p.querySelector('[data-hn="close"]').addEventListener('click', closePanel);
    p.querySelector('[data-hn="clear"]').addEventListener('click', clearCurrentSession);
    els.listBtn.addEventListener('click', function () { setListing(!listing); });
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

  /* ---------------- 面板开关与视图切换 ---------------- */

  function togglePanel() { els.panel.hidden ? openPanel() : closePanel(); }

  function openPanel() {
    els.panel.hidden = false;
    fab.setAttribute('aria-expanded', 'true');
    if (window.innerWidth <= 640) document.body.classList.add('hn-lock');
    setListing(false);
    els.input.focus();
    scrollBottom();
  }

  function closePanel() {
    els.panel.hidden = true;
    fab.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('hn-lock');
    fab.focus();
  }

  /** 消息区 ⇆ 历史列表视图；列表视图收起输入区 */
  function setListing(on) {
    listing = on;
    els.body.hidden = on;
    els.history.hidden = !on;
    els.inputWrap.hidden = on;
    els.listBtn.classList.toggle('on', on);
    if (on) renderHistory();
  }

  /* ---------------- 会话存储 ---------------- */

  function newSession() {
    return {
      id: 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      title: '',
      pinned: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
    };
  }

  function loadSessions() {
    try {
      var raw = JSON.parse(localStorage.getItem(SESSIONS_KEY) || '[]');
      if (Array.isArray(raw) && raw.length) {
        return raw.map(sanitizeSession).filter(Boolean).slice(0, SESSIONS_MAX);
      }
    } catch (e) { /* 损坏则走迁移兜底 */ }
    // v1.0 迁移：旧扁平历史 → 单个会话
    try {
      var legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || '[]');
      if (Array.isArray(legacy) && legacy.length) {
        var s = newSession();
        s.messages = legacy.filter(isMsg).slice(-HISTORY_MAX);
        s.title = deriveTitle(s.messages);
        localStorage.removeItem(LEGACY_KEY);
        try { localStorage.setItem(SESSIONS_KEY, JSON.stringify([s])); } catch (e2) { /* 立即落盘，防中途关页丢迁移 */ }
        return [s];
      }
    } catch (e) { /* ignore */ }
    return [];
  }

  function sanitizeSession(s) {
    if (!s || typeof s !== 'object' || !s.id || !Array.isArray(s.messages)) return null;
    var msgs = s.messages.filter(isMsg).slice(-HISTORY_MAX).map(function (m) {
      var out = { role: m.role === 'user' ? 'user' : 'assistant', content: String(m.content || '') };
      if (m.extra && (m.extra.sources || m.extra.route)) out.extra = m.extra;
      return out;
    });
    return {
      id: String(s.id),
      title: typeof s.title === 'string' ? s.title : '',
      pinned: !!s.pinned,
      createdAt: Number(s.createdAt) || Date.now(),
      updatedAt: Number(s.updatedAt) || Number(s.createdAt) || Date.now(),
      messages: msgs,
    };
  }

  function isMsg(m) {
    return m && typeof m === 'object' && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string';
  }

  function restoreCurrent() {
    try {
      var id = localStorage.getItem(CURRENT_KEY);
      if (id && sessions.some(function (s) { return s.id === id; })) return id;
    } catch (e) { /* ignore */ }
    var latest = sessions.slice().sort(byUpdated)[0];
    return latest ? latest.id : null;
  }

  function byUpdated(a, b) { return b.updatedAt - a.updatedAt; }
  function byPinnedUpdated(a, b) { return (Number(b.pinned) - Number(a.pinned)) || (b.updatedAt - a.updatedAt); }

  function cur() {
    for (var i = 0; i < sessions.length; i++) if (sessions[i].id === currentId) return sessions[i];
    return null;
  }

  function ensureCurrent() {
    var s = cur();
    if (s) return s;
    s = newSession();
    sessions.push(s);
    currentId = s.id;
    saveSessions();
    return s;
  }

  function saveSessions() {
    try {
      // 超上限淘汰：置顶优先保留，其余按最近更新
      sessions = sessions.slice().sort(byPinnedUpdated).slice(0, SESSIONS_MAX);
      localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
      localStorage.setItem(CURRENT_KEY, currentId || '');
    } catch (e) { /* 配额满等，忽略 */ }
  }

  function deriveTitle(messages) {
    for (var i = 0; i < messages.length; i++) {
      if (messages[i].role === 'user') return messages[i].content.trim().slice(0, 16);
    }
    return '';
  }

  function fmtMeta(s) {
    var d = new Date(s.updatedAt);
    var p = function (n) { return String(n).padStart(2, '0'); };
    var now = new Date();
    var datePart;
    if (IS_EN) {
      datePart = d.getFullYear() === now.getFullYear()
        ? (d.getMonth() + 1) + '/' + d.getDate()
        : d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate();
    } else {
      datePart = d.getFullYear() === now.getFullYear()
        ? (d.getMonth() + 1) + '月' + d.getDate() + '日'
        : d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
    }
    var msgs = s.messages.length ? s.messages.length + ' ' + t('ai.msgsUnit', '条') + ' · ' : '';
    return msgs + datePart + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  /* ---------------- 历史列表视图 ---------------- */

  function renderHistory() {
    var h = els.history;
    h.innerHTML = '';

    var newBtn = document.createElement('button');
    newBtn.className = 'hn-sess-new';
    newBtn.type = 'button';
    newBtn.innerHTML = ICON_PLUS + '<span>' + t('ai.newChat', '新对话') + '</span>';
    newBtn.addEventListener('click', startNewSession);
    h.appendChild(newBtn);

    var list = sessions.slice().sort(byPinnedUpdated);
    if (!list.length) {
      var empty = document.createElement('p');
      empty.className = 'hn-sess-empty';
      empty.textContent = t('ai.emptyHistory', '还没有历史对话');
      h.appendChild(empty);
      return;
    }
    list.forEach(function (s) { h.appendChild(sessionRow(s)); });
  }

  function sessionRow(s) {
    var row = document.createElement('div');
    row.className = 'hn-sess' + (s.id === currentId ? ' on' : '');

    var main = document.createElement('button');
    main.type = 'button';
    main.className = 'hn-sess-main';
    main.addEventListener('click', function () {
      currentId = s.id;
      saveSessions();
      setListing(false);
      renderMessages();
    });
    var b = document.createElement('b');
    b.textContent = s.title || t('ai.newChat', '新对话');
    var i = document.createElement('i');
    i.textContent = fmtMeta(s);
    main.appendChild(b);
    main.appendChild(i);
    row.appendChild(main);

    var acts = document.createElement('span');
    acts.className = 'hn-sess-acts';
    acts.appendChild(sessBtn(ICON_PIN, s.pinned ? t('ai.unpin', '取消置顶') : t('ai.pin', '置顶'), function () {
      s.pinned = !s.pinned;
      saveSessions();
      renderHistory();
    }, s.pinned));
    acts.appendChild(sessBtn(ICON_EDIT, t('ai.rename', '重命名'), function () {
      var title = window.prompt(t('ai.renamePrompt', '重命名对话（留空取消）：'), s.title || '');
      if (title === null) return;
      title = title.trim();
      if (!title) return;
      s.title = title.slice(0, 30);
      saveSessions();
      renderHistory();
    }, false));
    acts.appendChild(sessBtn(ICON_TRASH, t('ai.delete', '删除'), function () {
      var name = s.title || t('ai.newChat', '新对话');
      if (!window.confirm(t('ai.deleteConfirm', '删除「{name}」？删除后不可恢复。').replace('{name}', name))) return;
      sessions = sessions.filter(function (x) { return x.id !== s.id; });
      if (currentId === s.id) {
        var latest = sessions.slice().sort(byUpdated)[0];
        currentId = latest ? latest.id : null;
      }
      saveSessions();
      renderHistory();
    }, false));
    row.appendChild(acts);
    return row;
  }

  function sessBtn(icon, label, fn, on) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'hn-sess-btn' + (on ? ' on' : '');
    btn.setAttribute('aria-label', label);
    btn.title = label;
    btn.innerHTML = icon;
    btn.addEventListener('click', function (e) { e.stopPropagation(); fn(); });
    return btn;
  }

  function startNewSession() {
    var s = cur();
    if (s && !s.messages.length) {   // 当前已是空会话：直接回到对话
      setListing(false);
      els.input.focus();
      return;
    }
    s = newSession();
    sessions.push(s);
    currentId = s.id;
    saveSessions();
    setListing(false);
    renderMessages();
    els.input.focus();
  }

  function clearCurrentSession() {
    var s = cur();
    if (!s) return;
    if (s.messages.length && !window.confirm(t('ai.clearConfirm', '确定清空当前对话记录？'))) return;
    s.messages = [];
    s.title = '';
    s.updatedAt = Date.now();
    saveSessions();
    if (listing) renderHistory();
    else renderMessages();
  }

  /* ---------------- 消息渲染 ---------------- */

  function renderMessages() {
    els.body.innerHTML = '';
    var messages = cur() ? cur().messages : [];
    if (!messages.length) {
      var w = document.createElement('div');
      w.className = 'hn-welcome';
      // 欢迎副文案：zh 用后台配置的招呼语（config.greeting），en 用 strings 文案
      var desc = IS_EN ? t('ai.welcomeDesc', '万载文旅智能问答助手，烟花、非遗、美食、行程都可以问我。')
        : (config.greeting || t('ai.welcomeDesc', '万载文旅智能问答助手，烟花、非遗、美食、行程都可以问我。'));
      w.innerHTML =
        '<span class="hn-welcome-flame">' + NUO + '</span>' +
        '<div class="hn-welcome-title">' + t('ai.welcomeTitle', '你好，我是花傩') + '</div>' +
        '<div class="hn-welcome-desc">' + desc + '</div>';
      var q = document.createElement('div');
      q.className = 'hn-quick';
      (config.quick.length ? config.quick : (IS_EN ? DEFAULT_QUICK_EN : DEFAULT_QUICK)).forEach(function (qt) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = qt;
        btn.addEventListener('click', function () { submit(qt); });
        q.appendChild(btn);
      });
      w.appendChild(q);
      els.body.appendChild(w);
      return;
    }
    messages.forEach(function (m) { appendBubble(m.role, m.content, m.extra, false); });
    scrollBottom();
  }

  var DEFAULT_QUICK = [
    '万载古城烟花秀什么时候看？', '有哪些必吃的万载美食？', '推荐一条一日游线路', '万载有哪些非物质文化遗产？',
  ];
  var DEFAULT_QUICK_EN = [
    'When is the fireworks show at Wanzai Ancient City?',
    'What must-eat local foods do you recommend?',
    'Suggest a one-day itinerary',
    'What intangible cultural heritage does Wanzai have?',
  ];

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
      src.textContent = t('ai.sources', '知识来源：') + extra.sources.join(' · ');
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
    if (route.indexOf('/music/?t=') === 0) return t('ai.playSong', '▶ 播放这首歌');
    var names = (I18N.ai && I18N.ai.routes) || {};
    for (var i = 0; i < ROUTES.length; i++) {
      if (route === ROUTES[i] || route.indexOf(ROUTES[i] + '/') === 0) {
        if (names[ROUTES[i]]) return t('ai.goto', '前往') + names[ROUTES[i]];
      }
    }
    return t('ai.openPage', '打开页面');
  }

  /* ---------------- 发送 ---------------- */

  function submit(raw) {
    var text = String(raw || '').trim();
    if (!text || busy) return;
    if (!navigator.onLine) {
      // 离线不发请求、不清空输入框，方便联网后原样重发（docs/PWA应用方案.md §3.5）
      appendBubble('ai', t('ai.offline', '当前离线，花傩需要联网才能回答，请恢复网络后再问。'), null, false);
      return;
    }
    els.input.value = '';
    autosize();

    var s = ensureCurrent();
    var wasEmpty = s.messages.length === 0;
    s.messages.push({ role: 'user', content: text });
    if (wasEmpty) s.title = text.slice(0, 16);   // 首问作默认标题
    s.updatedAt = Date.now();
    saveSessions();
    if (wasEmpty) renderMessages();   // 欢迎态让位消息列表
    else appendBubble('user', text);

    busy = true;
    els.send.disabled = true;
    var typingRow = appendBubble('ai', '', null, false);
    var bubble = typingRow.firstChild;
    bubble.innerHTML = '<span class="hn-typing"><i></i><i></i><i></i></span>';

    var done = function (reply, extra) {
      s.messages.push({ role: 'assistant', content: reply, extra: extra });
      s.updatedAt = Date.now();
      saveSessions();
      // 打字机在原气泡上接续；短回复直接出渲染态
      if (reply.length > TYPE_THRESHOLD) typewrite(bubble, reply, extra);
      else fillBubble(bubble, reply, extra);
    };

    fetch('/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: text,
        history: s.messages.slice(-HISTORY_SEND - 1, -1).map(function (m) {
          return { role: m.role, content: m.content };
        }),
        path: location.pathname,
      }),
    }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (j) { return { status: r.status, json: j }; });
    }).then(function (res) {
      var j = res.json || {};
      var reply = j.text || (res.status === 429 ? t('ai.rateLimited', '问题有点多啦，请休息几分钟再问。') : t('ai.unavailable', '花傩暂时不在，请稍后再试。'));
      var extra = {};
      if (j.sources && j.sources.length) extra.sources = j.sources;
      if (j.action && j.action.type === 'open_page' && j.action.payload && j.action.payload.route) {
        extra.route = j.action.payload.route;
      }
      done(reply, extra);
    }).catch(function () {
      done(navigator.onLine ? t('ai.network', '网络异常，请稍后再试。') : t('ai.offlineShort', '网络已断开，请恢复网络后再问。'), {});
    }).finally(function () {
      busy = false;
      els.send.disabled = !els.input.value.trim();
      scrollBottom();
    });
  }

  /* ---------------- 工具 ---------------- */

  function autosize() {
    var t = els.input;
    t.style.height = 'auto';
    t.style.height = Math.min(96, t.scrollHeight) + 'px';
    els.send.disabled = busy || !t.value.trim();
  }

  function scrollBottom() {
    els.body.scrollTop = els.body.scrollHeight;
  }

  /** Markdown 白名单渲染：全文先转义，仅放行粗体/斜体/行内代码/无序列表/链接 */
  function mdLite(src) {
    function esc(s) {
      return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    /* 链接白名单：站内相对路径 + 本域 https；其余外链降级为纯文本（防注入导流钓鱼站） */
    function safeSite(href) {
      var m = href.match(/^https?:\/\/([^/\s]+)/);
      if (!m) return false;
      var h = m[1].toLowerCase();
      return h === 'whizzzest.com' || h.slice(-14) === '.whizzzest.com';
    }
    function inline(s) {
      return s
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (m, t, href) {
          if (/^\//.test(href)) return '<a href="' + href + '">' + t + '</a>';
          if (/^https?:\/\//.test(href) && safeSite(href)) {
            return '<a href="' + href + '" target="_blank" rel="noopener noreferrer">' + t + '</a>';
          }
          return t;
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
