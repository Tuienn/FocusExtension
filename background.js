import {
  createData, getDay, findSite, normalizeSites, settle,
  buildSnapshot, setGoals, toggleGoal,
} from './core.js';

const DATA_KEY = 'data';
const RUNTIME_KEY = 'runtime';
const SCRIPT_ID = 'fg-sites';
const NEW_TAB_URL = chrome.runtime.getURL('').startsWith('moz-extension:')
  ? 'about:newtab' : 'chrome://newtab/';
const queue = (() => {
  let tail = Promise.resolve();
  return (work) => {
    const next = tail.then(work, work);
    tail = next.catch(() => {});
    return next;
  };
})();

let data;
let runtime;
let ready;

function freshRuntime(now = Date.now()) {
  return {
    lastAt: now, mode: { focus: false, visit: null }, tabs: {}, safeUrls: {},
    idle: 'active', activeTabId: null, foregroundWindowId: null,
  };
}

function storageGet(area, keys) {
  return new Promise((resolve, reject) => area.get(keys, (value) => {
    const error = chrome.runtime.lastError;
    if (error) reject(new Error(error.message)); else resolve(value);
  }));
}
function storageSet(area, values) {
  return new Promise((resolve, reject) => area.set(values, () => {
    const error = chrome.runtime.lastError;
    if (error) reject(new Error(error.message)); else resolve();
  }));
}
function sendTab(tabId, message) {
  return new Promise((resolve) => chrome.tabs.sendMessage(tabId, message, () => {
    void chrome.runtime.lastError;
    resolve();
  }));
}
function tabQuery(query) {
  return new Promise((resolve) => chrome.tabs.query(query, (tabs) => {
    void chrome.runtime.lastError;
    resolve(tabs || []);
  }));
}
function getTab(tabId) {
  return new Promise((resolve) => chrome.tabs.get(tabId, (tab) => {
    const error = chrome.runtime.lastError;
    resolve(error ? null : tab);
  }));
}
function getWindow(windowId) {
  return new Promise((resolve) => chrome.windows.get(windowId, (win) => {
    const error = chrome.runtime.lastError;
    resolve(error ? null : win);
  }));
}
function focusedWindow() {
  return new Promise((resolve) => chrome.windows.getAll({ populate: true }, (windows) => {
    const error = chrome.runtime.lastError;
    resolve(error ? null : (windows || []).find((win) => win.focused) || null);
  }));
}
function queryIdle() {
  return new Promise((resolve) => chrome.idle.queryState(60, (state) => {
    void chrome.runtime.lastError;
    resolve(state || 'active');
  }));
}

function persist() {
  // Local totals and their cutoff are written atomically in the same item.
  // If the worker stops between local/session writes, never credit them twice.
  data.checkpointAt = runtime.lastAt;
  return storageSet(chrome.storage.local, { [DATA_KEY]: data })
    .then(() => storageSet(chrome.storage.session, { [RUNTIME_KEY]: runtime }));
}

function domainFor(url) {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    return findSite(url, data.settings.sites)?.domain || null;
  } catch { return null; }
}

function snapshot(now = Date.now()) {
  return buildSnapshot(data, runtime, now);
}

function guardReply(tabId) {
  const state = runtime.tabs[String(tabId)];
  if (!state) return null;
  const site = data.settings.sites.find((entry) => entry.domain === state.site)
    || { domain: state.site, label: state.site };
  const stage = state.stage === 'countdown' && Date.now() >= state.deadline
    ? 'ready' : state.stage;
  const visitMs = state.visitId ? Object.values(data.days).reduce((total, day) =>
    total + (day.visits.find(visit => visit.id === state.visitId)?.durationMs || 0), 0) : 0;
  return { stage, site, reason: state.reason || '', deadline: state.deadline || 0,
    visitId: state.visitId, visitMs, tracking: runtime.mode?.visit?.id === state.visitId && Boolean(state.visitId),
    reminderCount: Math.floor(visitMs / 300_000), reminderShown: state.reminderShown || 0 };
}

function replyError(error) {
  return { ok: false, error: error instanceof Error ? error.message : String(error) };
}

function goalBypass() {
  const day = getDay(data, new Date());
  return Boolean(day.initialized && day.goals.length > 0 && day.goals.every((goal) => goal.done)
    && data.settings.afterGoals === 'allow');
}

function patternFor(domain) {
  return [`http://${domain}/*`, `https://${domain}/*`, `http://*.${domain}/*`, `https://*.${domain}/*`];
}

async function configureContentScripts() {
  const sites = data.settings.sites || [];
  const matches = sites.flatMap((site) => patternFor(site.domain));
  const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
  if (matches.length) {
    const definition = {
      id: SCRIPT_ID, matches, js: ['content.js'], css: ['gate.css'],
      runAt: 'document_start', allFrames: false, persistAcrossSessions: true,
    };
    if (registered.length) await chrome.scripting.updateContentScripts([definition]);
    else await chrome.scripting.registerContentScripts([definition]);
  } else if (registered.length) {
    await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
  }
  await reconcileTabs(true);
}

function init() {
  if (ready) return ready;
  ready = queue(async () => {
    const [stored, session] = await Promise.all([
      storageGet(chrome.storage.local, DATA_KEY),
      storageGet(chrome.storage.session, RUNTIME_KEY),
    ]);
    data = stored[DATA_KEY] || createData();
    runtime = session[RUNTIME_KEY] || freshRuntime();
    const now = Date.now();
    if (!session[RUNTIME_KEY]) {
      data.focusRunning = false;
      data.sessionFocusMs = 0;
      runtime.mode = { focus: false, visit: null };
      for (const day of Object.values(data.days)) {
        for (const visit of day.visits) if (!visit.endedAt) visit.endedAt = data.checkpointAt || now;
      }
      for (const state of Object.values(runtime.tabs)) {
        if (state.stage === 'open') Object.assign(state, makeTabState(state.site, 'reason'));
      }
    } else {
      runtime.lastAt = Math.max(runtime.lastAt || now, data.checkpointAt || 0);
      settle(data, runtime, now);
    }
    runtime.idle = await queryIdle();
    await persist();
    chrome.idle.setDetectionInterval(60);
    chrome.alarms.create('fg-heartbeat', { periodInMinutes: 0.5 });
    await configureContentScripts();
    await refreshForegroundIdentity();
    await reevaluateGuards(true);
    await syncForeground();
    await persist();
  });
  return ready;
}

async function safeUrl(tab) {
  if (!tab || !tab.url) return;
  if (!domainFor(tab.url)) runtime.safeUrls[String(tab.id)] = tab.url;
}

function makeTabState(site, stage = 'reason') {
  return { site, stage, reason: '', deadline: 0, visitId: null, startedAt: 0, reminderShown: 0 };
}

async function reconcileTabs(inject = false) {
  const tabs = await tabQuery({});
  const extant = new Set(tabs.map((tab) => String(tab.id)));
  for (const key of Object.keys(runtime.tabs)) {
    if (!extant.has(key)) delete runtime.tabs[key];
  }
  for (const tab of tabs) {
    const key = String(tab.id);
    const site = domainFor(tab.url);
    if (!site) {
      await safeUrl(tab);
      if (runtime.tabs[key]) {
        await closeStoredVisit(tab.id, Date.now(), false, false);
        delete runtime.tabs[key];
        if (inject) await sendTab(tab.id, { type: 'GUARD_CHANGED' });
      }
      continue;
    }
    const prior = runtime.tabs[key];
    if (!prior || prior.site !== site) {
      if (prior?.site !== site) await closeStoredVisit(tab.id, Date.now(), false, false);
      runtime.tabs[key] = makeTabState(site, goalBypass() ? 'allow' : 'reason');
    } else if (prior.stage === 'allow' && !goalBypass()) {
      await closeStoredVisit(tab.id, Date.now(), false, false);
      runtime.tabs[key] = makeTabState(site, 'reason');
      if (inject) await sendTab(tab.id, { type: 'GUARD_CHANGED' });
    }
    if (inject) {
      try {
        const [probe] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            if (window.__focusGuardContentV1 || window.__focusGuardBootstrapping) return false;
            window.__focusGuardBootstrapping = true;
            return true;
          },
        });
        if (probe?.result) {
          await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['gate.css'] });
          await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
        }
      }
      catch { /* Restricted pages and tabs that are closing cannot be injected. */ }
      await sendTab(tab.id, { type: 'GUARD_CHANGED' });
    }
  }
}

async function closeVisit(now = Date.now(), markStopped = false, preserve = false, notify = true) {
  const active = runtime.mode?.visit;
  if (!active) return;
  const key = String(active.tabId);
  const tabState = runtime.tabs[key];
  if (tabState?.visitId === active.id) {
    if (!preserve) {
      tabState.stage = goalBypass() ? 'allow' : 'reason';
      tabState.visitId = null;
      tabState.startedAt = 0;
      tabState.reason = '';
      tabState.deadline = 0;
      tabState.reminderShown = 0;
    }
  }
  for (const visitDay of Object.values(data.days)) {
    const row = visitDay.visits.find((visit) => visit.id === active.id);
    if (!row) continue;
    if (!preserve) row.endedAt ??= now;
    if (markStopped && !row.stopped && !active.stoppedMarked) {
      row.stopped = true;
      visitDay.stopped += 1;
      active.stoppedMarked = true;
    }
  }
  runtime.mode.visit = null;
  if (!preserve && notify) await sendTab(active.tabId, { type: 'GUARD_CHANGED' });
}

async function closeStoredVisit(tabId, now = Date.now(), markStopped = false, notify = true) {
  const state = runtime.tabs[String(tabId)];
  if (!state?.visitId) return;
  if (runtime.mode?.visit?.id === state.visitId) {
    await closeVisit(now, markStopped, false, notify);
    return;
  }
  let countedStop = false;
  for (const visitDay of Object.values(data.days)) {
    const row = visitDay.visits.find((visit) => visit.id === state.visitId);
    if (!row) continue;
    row.endedAt ??= now;
    if (markStopped && !row.stopped && !countedStop) {
      row.stopped = true;
      visitDay.stopped += 1;
      countedStop = true;
    }
  }
  Object.assign(state, makeTabState(state.site, goalBypass() ? 'allow' : 'reason'));
  if (notify) await sendTab(tabId, { type: 'GUARD_CHANGED' });
}

async function refreshForegroundIdentity() {
  const win = await focusedWindow();
  // The lock screen can report no foreground browser window. Keep the tab
  // identity so locking pauses an existing visit instead of ending it.
  if (!win && runtime.idle === 'locked') return;
  runtime.foregroundWindowId = win?.id ?? null;
  runtime.activeTabId = win?.tabs?.find((tab) => tab.active)?.id ?? null;
}

async function syncForeground() {
  const now = Date.now();
  await refreshForegroundIdentity();
  const tab = runtime.activeTabId == null ? null : await getTab(runtime.activeTabId);
  const win = runtime.foregroundWindowId == null ? null : await getWindow(runtime.foregroundWindowId);
  const activeAndVisible = Boolean(tab && win?.focused && tab.active && runtime.idle === 'active');
  const tabId = tab?.id == null ? null : String(tab.id);
  const site = activeAndVisible ? domainFor(tab.url) : null;
  const state = tabId ? runtime.tabs[tabId] : null;
  const authorized = Boolean(state && ['open', 'allow'].includes(state.stage));
  // Idle pauses can have a stored open visit without an active accounting mode.
  // Losing foreground must close those visits too before the user returns.
  for (const [id, stored] of Object.entries(runtime.tabs)) {
    const lockedPause = runtime.idle === 'locked' && Number(id) === tab?.id && tab.active && domainFor(tab.url) === stored.site;
    if (stored.visitId && !lockedPause && (Number(id) !== tab?.id || !tab?.active || !win?.focused || !domainFor(tab?.url))) {
      await closeStoredVisit(Number(id), now);
    }
  }
  if (runtime.mode?.visit && (!activeAndVisible || !site || !authorized || runtime.mode.visit.tabId !== tab.id)) {
    const idlePause = runtime.idle !== 'active' && runtime.mode.visit.tabId === tab?.id;
    await closeVisit(now, false, idlePause);
  }
  if (activeAndVisible && !site) await safeUrl(tab);
  if (activeAndVisible && site && ['open', 'allow'].includes(state?.stage) && state.visitId && !runtime.mode?.visit) {
    runtime.mode.visit = {
      id: state.visitId, site, reason: state.reason || '',
      startedAt: state.startedAt || now, tabId: tab.id,
    };
    const row = getDay(data, now).visits.find((visit) => visit.id === state.visitId);
    if (row) row.endedAt = null;
  }
  if (activeAndVisible && site && state?.stage === 'allow' && !runtime.mode?.visit) {
    const id = crypto.randomUUID();
    const day = getDay(data, new Date(now));
    day.visits.push({ id, site, reason: '', startedAt: now, endedAt: null, durationMs: 0 });
    state.visitId = id;
    state.startedAt = now;
    state.reminderShown = 0;
    runtime.mode.visit = { id, site, reason: '', startedAt: now, tabId: tab.id };
  }
  runtime.mode = {
    focus: Boolean(data.focusRunning && runtime.idle === 'active' && !site),
    visit: runtime.mode?.visit || null,
  };
  await persist();
}

async function settleNow(now = Date.now()) {
  settle(data, runtime, now);
}

function response(extra = {}) {
  return { ok: true, ...snapshot(), ...extra };
}

async function handleUi(message) {
  const now = Date.now();
  await settleNow(now);
  if (message.type === 'GET_STATE') {
    await persist();
    return response();
  }
  switch (message.type) {
    case 'SET_GOALS':
      setGoals(data, Array.isArray(message.texts) ? message.texts : [], new Date(now));
      await reevaluateGuards(true);
      break;
    case 'TOGGLE_GOAL':
      toggleGoal(data, message.id, new Date(now));
      await reevaluateGuards(true);
      break;
    case 'START_FOCUS':
      if (!data.focusRunning) data.sessionFocusMs = 0;
      data.focusRunning = true;
      break;
    case 'STOP_FOCUS':
      data.focusRunning = false;
      break;
    case 'SET_SETTINGS': {
      const oldSettings = data.settings;
      data.settings = {
        sites: normalizeSites(message.sites),
        afterGoals: message.afterGoals === 'allow' ? 'allow' : 'guard',
      };
      try { await configureContentScripts(); }
      catch (error) {
        data.settings = oldSettings;
        try { await configureContentScripts(); } catch { /* Keep the original settings error for the UI. */ }
        throw error;
      }
      await reevaluateGuards(true);
      break;
    }
    default:
      return replyError('Unknown message type');
  }
  await syncForeground();
  await persist();
  return response();
}

async function reevaluateGuards(notify = false) {
  const tabs = await tabQuery({});
  const bypass = goalBypass();
  for (const tab of tabs) {
    const key = String(tab.id);
    const site = domainFor(tab.url);
    if (!site) continue;
    const state = runtime.tabs[key];
    const before = JSON.stringify(state || null);
    if (!state || state.site !== site) runtime.tabs[key] = makeTabState(site, bypass ? 'allow' : 'reason');
    else if (bypass && ['reason', 'countdown', 'ready'].includes(state.stage)) {
      Object.assign(state, makeTabState(site, 'allow'));
    } else if (!bypass && state.stage === 'allow') {
      await closeStoredVisit(tab.id, Date.now(), false, notify);
      runtime.tabs[key] = makeTabState(site, 'reason');
    }
    if (notify && before !== JSON.stringify(runtime.tabs[key])) await sendTab(tab.id, { type: 'GUARD_CHANGED' });
  }
}

function trustedGuardTab(sender) {
  const tab = sender?.tab;
  if (!tab || tab.id == null || !tab.url || sender.frameId !== 0) return null;
  const site = domainFor(tab.url);
  return { tab, site, key: String(tab.id) };
}

async function handleGuard(message, sender) {
  const trusted = trustedGuardTab(sender);
  if (!trusted) return replyError('Guard messages must come from the top frame of a site tab');
  const { tab, site, key } = trusted;
  const actualTab = await getTab(tab.id);
  if (!actualTab || domainFor(actualTab.url) !== site) {
    return message.type === 'GUARD_STATE' ? response({ guard: null }) : replyError('This visit is no longer available.');
  }
  if (!site) return response({ guard: null });
  const now = Date.now();
  await settleNow(now);
  await reevaluateGuards();
  let state = runtime.tabs[key];
  if (!state || state.site !== site) {
    state = runtime.tabs[key] = makeTabState(site, goalBypass() ? 'allow' : 'reason');
  }
  switch (message.type) {
    case 'GUARD_STATE':
      await persist();
      return response({ guard: guardReply(tab.id) });
    case 'GUARD_CLOSE': {
      if (!['open', 'allow'].includes(state.stage) || !state.visitId || message.visitId !== state.visitId) {
        return replyError('This visit is no longer available.');
      }
      // Close only the sender's verified distraction tab, never an arbitrary ID.
      await chrome.tabs.remove(tab.id);
      await closeStoredVisit(tab.id, now, true, false);
      delete runtime.tabs[key];
      await persist();
      return response({ guard: null });
    }
    case 'GUARD_REMINDER_ACK': {
      const guard = guardReply(tab.id);
      if (message.visitId === state.visitId && Number.isInteger(message.count) &&
          message.count > (state.reminderShown || 0) && message.count <= guard.reminderCount) {
        state.reminderShown = message.count;
      }
      await persist();
      return response({ guard: guardReply(tab.id) });
    }
    case 'GUARD_REASON': {
      if (state.stage !== 'reason') return response({ guard: guardReply(tab.id) });
      if (typeof message.reason !== 'string') return replyError('Enter a reason before continuing');
      const reason = message.reason.trim();
      if (!reason) return replyError('Enter a reason before continuing');
      state.reason = reason;
      state.stage = 'countdown';
      state.deadline = now + 30_000;
      break;
    }
    case 'GUARD_OPEN': {
      const freshTab = await getTab(tab.id);
      const win = freshTab?.windowId == null ? null : await getWindow(freshTab.windowId);
      await refreshForegroundIdentity();
      const isForeground = Boolean(freshTab?.active && win?.focused && runtime.idle === 'active'
        && runtime.activeTabId === tab.id && runtime.foregroundWindowId === freshTab.windowId);
      if (state.stage !== 'countdown' || now < state.deadline) return replyError('The countdown has not finished');
      if (!isForeground) return replyError('Return to this tab to open the site');
      const id = crypto.randomUUID();
      const day = getDay(data, new Date(now));
      const visit = { id, site, reason: state.reason || '', startedAt: now, endedAt: null, durationMs: 0 };
      day.visits.push(visit);
      state.stage = 'open';
      state.visitId = id;
      state.startedAt = now;
      state.reminderShown = 0;
      runtime.mode.visit = { id, site, reason: state.reason || '', startedAt: now, tabId: tab.id };
      runtime.mode.focus = false;
      break;
    }
    case 'GUARD_BACK': {
      if (state.stage === 'back') return response({ guard: null });
      if (!['reason', 'countdown', 'ready', 'open'].includes(state.stage)) {
        return response({ guard: guardReply(tab.id) });
      }
      if (state.stage !== 'open') getDay(data, now).stopped += 1;
      if (state.stage === 'open' && state.visitId && runtime.mode.visit?.id === state.visitId) {
        await closeVisit(now, true, false, false);
      } else if (state.stage === 'open' && state.visitId) {
        let countedStop = false;
        for (const visitDay of Object.values(data.days)) {
          const row = visitDay.visits.find((visit) => visit.id === state.visitId);
          if (row) {
            row.endedAt = now;
            if (!row.stopped && !countedStop) {
              row.stopped = true;
              visitDay.stopped += 1;
              countedStop = true;
            }
          }
        }
        state.visitId = null;
        state.startedAt = 0;
      }
      state.stage = 'back';
      const backUrl = runtime.safeUrls[key] || NEW_TAB_URL;
      await persist();
      await sendTab(tab.id, { type: 'GUARD_CHANGED' });
      try { await chrome.tabs.update(tab.id, { url: backUrl }); }
      catch { /* The tab may have closed after the content message. */ }
      return response({ guard: null });
    }
    default:
      return replyError('Unknown guard message type');
  }
  await persist();
  if (message.type !== 'GUARD_STATE') await sendTab(tab.id, { type: 'GUARD_CHANGED' });
  return response({ guard: guardReply(tab.id) });
}

chrome.runtime.onInstalled.addListener(() => {
  void init();
});

chrome.runtime.onStartup.addListener(() => {
  void init();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  init().then(() => queue(async () => {
    if (message?.type?.startsWith('GUARD_')) return handleGuard(message, sender);
    const extensionPrefix = chrome.runtime.getURL('');
    if (typeof sender.url !== 'string' || !sender.url.startsWith(extensionPrefix)) {
      return replyError('UI messages must come from Focus Guard');
    }
    return handleUi(message || {});
  })).then(sendResponse, (error) => sendResponse(replyError(error)));
  return true;
});

chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  void init().then(() => queue(async () => {
    await settleNow();
    await syncForeground();
    await persist();
  }));
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo.url && changeInfo.status !== 'complete') return;
  void init().then(() => queue(async () => {
    await settleNow();
    const key = String(tabId);
    const site = domainFor(tab.url);
    if (!site) {
      const hadGuard = Boolean(runtime.tabs[key]);
      await closeStoredVisit(tabId, Date.now(), false, false);
      delete runtime.tabs[key];
      await safeUrl(tab);
      if (hadGuard) await sendTab(tabId, { type: 'GUARD_CHANGED' });
    } else if (!runtime.tabs[key] || runtime.tabs[key].site !== site) {
      await closeStoredVisit(tabId, Date.now(), false, false);
      runtime.tabs[key] = makeTabState(site, goalBypass() ? 'allow' : 'reason');
      await sendTab(tabId, { type: 'GUARD_CHANGED' });
    }
    await syncForeground();
    await persist();
  }));
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void init().then(() => queue(async () => {
    await settleNow();
    await closeStoredVisit(tabId);
    delete runtime.tabs[String(tabId)];
    delete runtime.safeUrls[String(tabId)];
    if (runtime.activeTabId === tabId) runtime.activeTabId = null;
    await syncForeground();
    await persist();
  }));
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  void init().then(() => queue(async () => {
    await settleNow();
    runtime.idle = await queryIdle();
    await syncForeground();
    await persist();
  }));
});

chrome.idle.onStateChanged.addListener((state) => {
  void init().then(() => queue(async () => {
    await settleNow();
    runtime.idle = state;
    await syncForeground();
    await persist();
  }));
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== 'fg-heartbeat') return;
  void init().then(() => queue(async () => {
    const now = Date.now();
    await settleNow(now);
    runtime.idle = await queryIdle();
    await reevaluateGuards(true);
    await syncForeground();
    await persist();
  }));
});

void init();
