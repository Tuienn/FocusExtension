(() => {
  'use strict';

  const SENTINEL = '__focusGuardContentV1';
  if (window[SENTINEL]) return;
  window[SENTINEL] = true;
  window.__focusGuardInjected = true;
  // @font-face inside a ShadowRoot is not registered by Chrome. Register the
  // local original face with this document's font set instead.
  const pixelFace = new FontFace('FGPixel', `url("${chrome.runtime.getURL('assets/pixel.woff')}") format("woff")`);
  document.fonts.add(pixelFace);
  pixelFace.load().catch(() => {});

  const HOST_ID = 'focus-guard-host';
  let host;
  let shadow;
  let current = null;
  let draft = '';
  let busy = false;
  let countdownTimer = 0;
  let refreshTimer = 0;
  let savedFocus = null;
  let lastCountdownRefresh = 0;
  let renderedSignature = '';

  const escapeHandler = (event) => {
    if (!host || !host.isConnected || !shadow) return;
    // Default textarea editing still works; website keyboard shortcuts cannot
    // receive keystrokes while the gate covers the page.
    event.stopImmediatePropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = [...shadow.querySelectorAll('button:not([disabled]), textarea:not([disabled]), a[href]')]
      .filter((item) => item.getClientRects().length);
    if (!items.length) {
      event.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && (shadow.activeElement === first || !shadow.activeElement)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && shadow.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  window.addEventListener('keydown', escapeHandler, true);
  for (const type of ['keyup', 'keypress']) window.addEventListener(type, event => {
    if (host?.isConnected) event.stopImmediatePropagation();
  }, true);

  function ensureHost() {
    const root = document.documentElement;
    if (!root) return false;
    if (host && host.isConnected) return true;
    host = document.getElementById(HOST_ID);
    if (!host) {
      host = document.createElement('div');
      host.id = HOST_ID;
      host.setAttribute('aria-label', 'Focus Guard');
    }
    if (!host.shadowRoot) shadow = host.attachShadow({ mode: 'open' });
    else shadow = host.shadowRoot;
    if (!shadow.querySelector('[data-fg-style]')) installStyles();
    if (!shadow.querySelector('[data-fg-app]')) {
      const app = document.createElement('main');
      app.dataset.fgApp = '';
      app.setAttribute('role', 'dialog');
      app.setAttribute('aria-modal', 'true');
      app.setAttribute('aria-label', 'Focus Guard');
      shadow.append(app);
      app.addEventListener('click', onClick);
      app.addEventListener('input', onInput);
      host.addEventListener('keydown', (event) => event.stopPropagation());
      host.addEventListener('keyup', (event) => event.stopPropagation());
      host.addEventListener('keypress', (event) => event.stopPropagation());
    }
    if (host.parentNode !== root) root.append(host);
    return true;
  }

  function installStyles() {
    const style = document.createElement('style');
    style.dataset.fgStyle = '';
    const fontUrl = (() => {
      try { return chrome.runtime.getURL('assets/pixel.woff'); }
      catch (_) { return ''; }
    })();
    style.textContent = `
      ${fontUrl ? `@font-face{font-family:FGPixel;src:url("${fontUrl}") format("woff");font-display:swap}` : ''}
      :host{all:initial;display:block!important;position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;z-index:2147483647!important;visibility:visible!important;opacity:1!important;pointer-events:auto!important;color:#142d4e;font-family:FGPixel,"Courier New",monospace;font-size:16px;line-height:1.5;}
      *,*::before,*::after{box-sizing:border-box}
      main{all:initial;position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(12,30,55,.94);color:#142d4e;font-family:FGPixel,"Courier New",monospace;font-size:16px;line-height:1.5;visibility:visible;pointer-events:auto;overflow:auto}
      .card{width:min(690px,100%);max-height:calc(100vh - 48px);overflow:auto;background:#f8f5e9;border:5px solid #142d4e;box-shadow:10px 10px 0 #e3b84a;padding:clamp(18px,3vw,28px)}
      .brand{display:flex;align-items:center;gap:12px;margin-bottom:22px;color:#28644c;font-size:13px;letter-spacing:.12em;text-transform:uppercase}
      .brand-mark{display:grid;place-items:center;width:30px;height:30px;background:#28644c;color:#f8f5e9;border:3px solid #142d4e;font-size:18px}
      h1{margin:0 0 12px;font-size:clamp(24px,5vw,36px);line-height:1.2;color:#142d4e;text-transform:uppercase}
      h2{margin:0 0 12px;font-size:18px;line-height:1.4;color:#142d4e}
      p{margin:0 0 16px}
      .muted{color:#53667b;font-size:14px}
      .site{color:#a64438;overflow-wrap:anywhere}
      .goals{margin:22px 0;padding:16px 18px;border:2px solid #c8d3d4;background:#fffdf5}
      .goal-heading{display:flex;justify-content:space-between;gap:12px;margin-bottom:10px;font-size:13px;color:#53667b;text-transform:uppercase}
      .goal-list{list-style:none;padding:0;margin:0;display:grid;gap:8px}
      .goal-list,.quote,textarea{font-family:"Courier New",monospace}
      .goal{display:flex;align-items:flex-start;gap:10px;overflow-wrap:anywhere}
      .check{flex:none;color:#28644c;font-weight:bold}
      .goal.pending .check{color:#b17b19}
      .stats{display:flex;flex-wrap:wrap;gap:8px 20px;margin:12px 0 22px;color:#53667b;font-size:13px}
      label{display:block;margin:20px 0 8px;font-size:14px}
      textarea{display:block;width:100%;min-height:108px;resize:vertical;padding:12px;border:3px solid #142d4e;border-radius:0;background:#fffdf5;color:#142d4e;font-family:"Courier New",monospace;font-size:inherit;line-height:1.5}
      textarea:focus,button:focus-visible{outline:4px solid #e3b84a;outline-offset:3px}
      .error{margin:10px 0 0;color:#a12f2a;font-size:13px}
      .actions{display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin-top:22px}
      button{min-height:48px;padding:10px 18px;border:3px solid #142d4e;border-radius:0;background:#28644c;color:white;font:inherit;cursor:pointer}
      button:hover{background:#1e503d}
      button:active{box-shadow:4px 4px 0 #142d4e;transform:translate(2px,2px)}
      button:disabled{opacity:.65;cursor:wait}
      button.secondary{border-color:transparent;background:transparent;color:#28644c;text-decoration:underline;padding-left:4px;padding-right:4px}
      button.secondary:hover{background:#e8eedf}
      button.open{background:#e3b84a;color:#142d4e}
      button.open:hover{background:#d6a934}
      .quote{padding:15px 18px;border-left:5px solid #e3b84a;background:#fffdf5;overflow-wrap:anywhere}
      .count{display:inline-grid;place-items:center;width:74px;height:74px;margin:8px 0 18px;border:4px solid #28644c;color:#28644c;font-size:30px}
      .brand{margin-bottom:16px}.goals{margin:16px 0}p{margin-bottom:12px}
      .quote{clear:both}.count{float:right;width:90px;height:90px;font-size:46px;margin:-50px 0 12px 14px}
      .actions{position:sticky;bottom:0;background:#f8f5e9;padding:12px 0 4px;margin-top:12px}
      @media(max-width:520px){main{padding:12px}.card{max-height:calc(100vh - 24px);padding:22px 18px}.actions{align-items:stretch}.actions button{width:100%}}
    `;
    shadow.append(style);
  }

  function app() { return shadow && shadow.querySelector('[data-fg-app]'); }
  function escText(value) { return String(value == null ? '' : value); }
  function escHTML(value) {
    return escText(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  }
  function formatTime(ms) {
    const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    return `${Math.floor(total / 60)} min`;
  }
  function doneCount(goals) { return goals.filter((goal) => goal && goal.done).length; }
  function goalSection(day) {
    const goals = Array.isArray(day && day.goals) ? day.goals : [];
    const completed = doneCount(goals);
    const visible = goals.filter((goal) => !goal || !goal.done);
    const rows = visible.map((goal) => `<li class="goal ${goal && goal.done ? '' : 'pending'}"><span class="check" aria-hidden="true">${goal && goal.done ? '✓' : '□'}</span><span></span></li>`).join('');
    return `<section class="goals"><div class="goal-heading"><span>Today's goals</span><span>${completed}/${goals.length} done</span></div>${goals.length ? `<ul class="goal-list">${rows || '<li class="muted">Everything is complete.</li>'}</ul>` : '<p class="muted">What matters today? Open Focus Guard to set your goals.</p>'}</section>`;
  }
  function stats(day) {
    const blocks = Math.floor(Math.max(0, Number(day && day.focusMs) || 0) / 600000);
    return `<div class="stats"><span data-stat="focus">Focus ${blocks} blocks · ${formatTime(day && day.focusMs)}</span><span data-stat="distraction">Distraction ${formatTime(day && day.distractionMs)}</span></div>`;
  }
  function updateStats() {
    const node = app();
    if (!node) return;
    const day = current && current.day || {};
    const focus = node.querySelector('[data-stat="focus"]');
    const distraction = node.querySelector('[data-stat="distraction"]');
    if (focus) focus.textContent = `Focus ${Math.floor(Math.max(0, Number(day.focusMs) || 0) / 600000)} blocks · ${formatTime(day.focusMs)}`;
    if (distraction) distraction.textContent = `Distraction ${formatTime(day.distractionMs)}`;
  }
  function signature(response) {
    const guard = response.guard || {};
    const goals = Array.isArray(response.day && response.day.goals) ? response.day.goals : [];
    return JSON.stringify([
      guard.stage,
      guard.site && guard.site.domain,
      guard.site && guard.site.label,
      guard.reason,
      guard.deadline,
      goals.map((goal) => goal && [goal.id, goal.text, Boolean(goal.done)])
    ]);
  }
  function base(content) {
    const node = app();
    if (!node) return;
    const active = shadow.activeElement;
    const focusedAction = active && active.dataset && active.dataset.action;
    const focusedTextarea = active && active.id === 'fg-reason';
    const selection = focusedTextarea ? [active.selectionStart, active.selectionEnd, active.selectionDirection] : null;
    node.innerHTML = `<section class="card"><div class="brand"><span class="brand-mark" aria-hidden="true">F</span><span>Focus Guard</span></div>${content}</section>`;
    node.dataset.stage = current.guard.stage;
    for (const [index, goal] of [...node.querySelectorAll('.goal span:last-child')].entries()) {
      const model = (Array.isArray(current && current.day && current.day.goals) ? current.day.goals : []).filter((item) => !item || !item.done)[index];
      goal.textContent = escText(model && model.text);
    }
    return { focusedTextarea, focusedAction, selection };
  }

  function render(errorText) {
    if (!current || !current.guard) return;
    ensureHost();
    const guard = current.guard;
    const siteName = escText(guard.site && (guard.site.label || guard.site.domain) || 'this site');
    const stage = guard.stage;
    const isReason = stage === 'reason';
    const isCountdown = stage === 'countdown';
    const isReady = stage === 'ready';
    const safeSiteName = escHTML(siteName);
    const title = isReason ? 'NOT YET' : isCountdown ? 'THINK FIRST' : isReady ? 'READY' : 'FOCUS GUARD';
    let content = `<h1>${title}</h1>`;
    if (isReason) {
      content += '<p>You still have things to do.</p>';
      content += goalSection(current.day || {});
      content += stats(current.day || {});
      content += `<h2>Why do you want to open <span class="site"></span>?</h2><label for="fg-reason">Write a quick reason</label><textarea id="fg-reason" placeholder="What is the purpose of this visit?" autocomplete="off"></textarea>`;
      if (errorText) content += `<p class="error" role="alert"></p>`;
      content += `<div class="actions"><button data-action="back" ${busy ? 'disabled' : ''}>Back to focus</button><button class="secondary" data-action="continue" ${busy ? 'disabled' : ''}>${busy ? 'Saving…' : 'Continue anyway'}</button></div>`;
    } else if (isCountdown || isReady) {
      const remaining = Math.max(0, Math.ceil(((Number(guard.deadline) || Date.now()) - Date.now()) / 1000));
      if (isCountdown) content += `<div class="count" aria-label="${remaining} seconds remaining">${remaining}</div><p>You're about to open <span class="site"></span>.</p><p>You said:</p><p class="quote"></p>`;
      else content += `<p>You said:</p><p class="quote"></p><p>You can continue now. Your visit will be counted as distraction time.</p>`;
      content += goalSection(current.day || {});
      if (errorText) content += `<p class="error" role="alert"></p>`;
      content += `<div class="actions"><button data-action="back" ${busy ? 'disabled' : ''}>Back to focus</button>${isReady ? `<button class="open" data-action="open" ${busy ? 'disabled' : ''}>${busy ? 'Opening…' : `Open ${safeSiteName}`}</button>` : ''}</div>`;
    } else {
      content += '<p>Focus Guard could not load the current guard state.</p>';
      if (errorText) content += '<p class="error" role="alert"></p>';
      content += '<div class="actions"><button data-action="retry" ' + (busy ? 'disabled' : '') + '>Retry</button><button class="secondary" data-action="back">Back to focus</button></div>';
    }
    const previousFocus = base(content);
    const node = app();
    const site = node.querySelector('.site');
    if (site) site.textContent = siteName;
    const quote = node.querySelector('.quote');
    if (quote) quote.textContent = escText(guard.reason);
    const textarea = node.querySelector('textarea');
    if (textarea) {
      textarea.value = draft;
      if (errorText) {
        const error = node.querySelector('[role="alert"]');
        if (error) error.textContent = errorText;
      }
      if (previousFocus.focusedTextarea) {
        textarea.focus({ preventScroll: true });
        textarea.setSelectionRange(previousFocus.selection[0], previousFocus.selection[1], previousFocus.selection[2]);
      }
    } else if (errorText) {
      const error = node.querySelector('[role="alert"]');
      if (error) error.textContent = errorText;
    }
    renderedSignature = current ? signature(current) : '';
    if (previousFocus.focusedAction) {
      const replacement = node.querySelector(`[data-action="${previousFocus.focusedAction}"]`);
      if (replacement) replacement.focus({ preventScroll: true });
      else if (isReason && textarea && !shadow.activeElement) textarea.focus({ preventScroll: true });
    } else if (isReason && textarea && !shadow.activeElement) textarea.focus({ preventScroll: true });
    else if ((isCountdown || isReady) && !shadow.activeElement) {
      const button = node.querySelector('button');
      if (button) button.focus({ preventScroll: true });
    }
    syncCountdown();
  }

  function send(message) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          const runtimeError = chrome.runtime.lastError;
          if (runtimeError) reject(new Error(runtimeError.message || 'Extension connection failed.'));
          else resolve(response);
        });
      } catch (error) { reject(error); }
    });
  }
  function setLocked(locked) {
    const root = document.documentElement;
    if (!root) return;
    if (locked) {
      if (!root.hasAttribute('data-fg-unlocked')) {
        const active = document.activeElement;
        if (active && active !== host && !host?.contains(active)) savedFocus = active;
      }
      root.removeAttribute('data-fg-unlocked');
      ensureHost();
    } else {
      root.setAttribute('data-fg-unlocked', '');
      if (host && host.isConnected) host.remove();
      current = null;
      window.setTimeout(() => {
        if (savedFocus && savedFocus.isConnected && typeof savedFocus.focus === 'function') savedFocus.focus();
        savedFocus = null;
      }, 0);
    }
  }

  async function refresh(preserveDraft = true) {
    const priorDraft = draft;
    try {
      const response = await send({ type: 'GUARD_STATE' });
      if (!response || response.ok !== true) throw new Error(response && response.error || 'Unable to read Focus Guard state.');
      if (!response.guard || response.guard.stage === 'allow' || !response.guard.site) {
        setLocked(false);
        renderedSignature = '';
        return;
      }
      if (response.guard.stage === 'open') {
        setLocked(false);
        renderedSignature = '';
        return;
      }
      const previousStage = current && current.guard && current.guard.stage;
      const previousReason = current && current.guard && current.guard.reason;
      if (!preserveDraft || previousStage !== response.guard.stage || previousReason !== response.guard.reason) {
        draft = response.guard.stage === 'reason' && previousStage === 'reason' ? priorDraft : '';
      }
      current = response;
      setLocked(true);
      const nextSignature = signature(response);
      if (nextSignature !== renderedSignature) render();
      else {
        updateStats();
        syncCountdown();
      }
    } catch (error) {
      if (!current) current = { day: {}, guard: { stage: 'error', site: null } };
      setLocked(true);
      render(error && error.message || 'Unable to connect to Focus Guard.');
    }
  }

  async function act(type, extra) {
    if (busy) return;
    busy = true;
    let actionError = '';
    render();
    try {
      const response = await send({ type, ...(extra || {}) });
      if (!response || response.ok !== true) {
        actionError = response && response.error || 'That action could not be completed.';
        return;
      }
      if (type === 'GUARD_OPEN') {
        if (response.guard && (response.guard.stage === 'open' || response.guard.stage === 'allow' || !response.guard.site)) {
          setLocked(false);
          renderedSignature = '';
        } else {
          await refresh(true);
          actionError = 'Focus Guard has not opened this site yet.';
        }
        return;
      }
      if (type === 'GUARD_BACK') {
        return;
      }
      await refresh(true);
    } catch (error) {
      actionError = error && error.message || 'Unable to connect to Focus Guard.';
    } finally {
      busy = false;
      if (current) render(actionError);
    }
  }

  function onInput(event) {
    if (event.target && event.target.id === 'fg-reason') draft = event.target.value;
  }
  function onClick(event) {
    const button = event.target.closest && event.target.closest('button[data-action]');
    if (!button) return;
    const action = button.dataset.action;
    if (action === 'continue') {
      const reason = draft.trim();
      if (!reason) {
        render('Tell yourself why you want to open this site.');
        const textarea = app().querySelector('textarea');
        if (textarea) textarea.focus();
        return;
      }
      act('GUARD_REASON', { reason });
    } else if (action === 'back') act('GUARD_BACK');
    else if (action === 'open') act('GUARD_OPEN');
    else if (action === 'retry') refresh(true);
  }

  function syncCountdown() {
    if (countdownTimer) window.clearInterval(countdownTimer);
    countdownTimer = 0;
    if (!current || !current.guard || current.guard.stage !== 'countdown') return;
    countdownTimer = window.setInterval(() => {
      if (!current || !current.guard || current.guard.stage !== 'countdown') return;
      const remaining = Math.max(0, Math.ceil(((Number(current.guard.deadline) || Date.now()) - Date.now()) / 1000));
      const count = shadow.querySelector('.count');
      if (count) {
        count.textContent = String(remaining);
        count.setAttribute('aria-label', `${remaining} seconds remaining`);
      }
      if (remaining === 0 && Date.now() - lastCountdownRefresh > 800) {
        lastCountdownRefresh = Date.now();
        refresh(true);
      }
    }, 250);
  }

  function start() {
    const mountObserver = new MutationObserver(() => {
      if (current && current.guard && current.guard.stage !== 'allow') ensureHost();
    });
    mountObserver.observe(document.documentElement, { childList: true });
    ensureHost();
    refresh(false);
    chrome.runtime.onMessage.addListener((message) => {
      if (message && message.type === 'GUARD_CHANGED') refresh(true);
    });
    window.addEventListener('pageshow', () => refresh(true));
    window.addEventListener('focus', () => refresh(true));
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(true); });
    refreshTimer = window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh(true);
    }, 2000);
  }

  if (document.documentElement) start();
  else {
    const rootObserver = new MutationObserver(() => {
      if (!document.documentElement) return;
      rootObserver.disconnect();
      start();
    });
    rootObserver.observe(document, { childList: true, subtree: true });
  }
})();
