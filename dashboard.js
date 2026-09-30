(() => {
  const $ = (s) => document.querySelector(s);
  const message = $('#dash-message'), settingsStatus = $('#settings-status');
  let latest = null, settingsBusy = false;
  const signatures = {};
  const send = (type, extra = {}) => new Promise((resolve) => chrome.runtime.sendMessage({ type, ...extra }, (response) => {
    if (chrome.runtime.lastError) return resolve({ ok: false, error: chrome.runtime.lastError.message }); resolve(response || { ok: false, error: 'No response from the focus service.' });
  }));
  const safe = (n) => Math.max(0, Number(n) || 0), hours = (ms) => (safe(ms) / 3600000).toFixed(2);
  const dateTime = (ms) => new Date(ms).toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' });
  const durationText = (ms) => `${hours(ms)} h`;
  const setMessage = (text) => { message.textContent = text; message.hidden = !text; };
  function showSection() {
    const hash = location.hash.replace(/^#/, ''), selected = ['summary', 'history', 'settings'].includes(hash) ? hash : 'summary';
    document.querySelectorAll('.dash-section').forEach((section) => { section.hidden = section.id !== selected; });
    document.querySelectorAll('.dash-nav a').forEach((a) => { if (a.hash === `#${selected}`) a.setAttribute('aria-current', 'location'); else a.removeAttribute('aria-current'); });
    document.title = `Focus Guard — ${selected[0].toUpperCase()}${selected.slice(1)}`;
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  }
  function renderWeek(week = []) {
    const sig = JSON.stringify(week.map((day) => [day.key, day.label, day.focusMs, day.distractionMs])); if (sig === signatures.week) return; signatures.week = sig;
    const container = $('#week-list'); container.replaceChildren();
    week.forEach((day) => {
      const row = document.createElement('div'); row.className = 'week-row';
      const name = document.createElement('span'); name.className = 'week-day'; name.textContent = day.label || new Date(`${day.key}T12:00:00`).toLocaleDateString('en', { weekday: 'short' });
      const focus = document.createElement('span'); focus.className = 'week-value focus-hours'; focus.textContent = `${hours(day.focusMs)} h`;
      const distraction = document.createElement('span'); distraction.className = 'week-value distraction-hours'; distraction.textContent = `${hours(day.distractionMs)} h`;
      row.append(name, focus, distraction); container.append(row);
    });
    if (!week.length) { const empty = document.createElement('p'); empty.className = 'empty-note'; empty.textContent = 'Your week will take shape as you focus.'; container.append(empty); }
  }
  function renderHistory(day) {
    const visits = (day?.visits || []).slice().sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
    const sig = JSON.stringify(visits.map((v) => [v.id, v.site, v.reason, v.startedAt, v.endedAt, v.durationMs]));
    if (sig === signatures.history) return; signatures.history = sig;
    const container = $('#history-list'); container.replaceChildren();
    if (!visits.length) { const empty = document.createElement('div'); empty.className = 'history-empty'; const star = document.createElement('span'); star.setAttribute('aria-hidden', 'true'); star.textContent = '✦'; const title = document.createElement('p'); title.textContent = 'No distraction visits recorded today.'; const hint = document.createElement('small'); hint.textContent = 'Your log appears here when a guarded site is opened.'; empty.append(star, title, hint); container.append(empty); return; }
    visits.forEach((visit) => {
      const row = document.createElement('article'); row.className = 'visit-row';
      const marker = document.createElement('span'); marker.className = 'visit-marker'; marker.setAttribute('aria-hidden', 'true'); marker.textContent = '■';
      const body = document.createElement('div'); body.className = 'visit-main';
      const site = document.createElement('strong'); site.textContent = visit.site || 'Unknown site';
      const reason = document.createElement('span'); reason.textContent = visit.reason || 'Goals completed';
      const meta = document.createElement('span'); meta.className = 'visit-time'; meta.textContent = `${dateTime(visit.startedAt || 0)}${visit.endedAt ? ` – ${dateTime(visit.endedAt)}` : ''}`;
      const duration = document.createElement('span'); duration.className = 'visit-duration'; duration.textContent = durationText(visit.durationMs);
      body.append(site, reason, meta); row.append(marker, body, duration); container.append(row);
    });
  }
  function renderSummary(day) {
    const goals = day.goals || [], sig = JSON.stringify(goals.map((goal) => [goal.id, goal.text, goal.done]));
    if (sig !== signatures.goals) {
      signatures.goals = sig; const list = $('#summary-goals-list'); list.replaceChildren();
      goals.forEach((goal) => { const row = document.createElement('div'); row.className = `summary-goal${goal.done ? ' is-done' : ''}`; const state = document.createElement('span'); state.className = 'summary-check'; state.setAttribute('aria-hidden', 'true'); state.textContent = goal.done ? '✓' : '□'; const text = document.createElement('span'); text.textContent = goal.text; row.append(state, text); list.append(row); });
      if (!goals.length) { const empty = document.createElement('p'); empty.className = 'empty-note'; empty.textContent = 'No goals saved for today.'; list.append(empty); }
    }
    $('#goals-total').textContent = `${goals.filter((g) => g.done).length} / ${goals.length}`;
    $('#focus-total').textContent = `${hours(day.focusMs)} h`;
    $('#distraction-total').textContent = `${hours(day.distractionMs)} h`;
  }
  function renderSites(settings, force = false) {
    const sig = JSON.stringify(settings || {}); if (!force && sig === signatures.settings) return; signatures.settings = sig;
    const list = $('#site-list'); list.replaceChildren();
    (settings?.sites || []).forEach((site, index) => {
      const li = document.createElement('li'); li.className = 'site-item';
      const label = document.createElement('span'); label.textContent = site.label || site.domain;
      const domain = document.createElement('small'); domain.textContent = site.domain;
      const details = document.createElement('span'); details.className = 'site-details'; details.append(label, domain);
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'remove-button'; remove.textContent = 'Remove'; remove.setAttribute('aria-label', `Remove ${site.domain}`);
      remove.disabled = settingsBusy; remove.addEventListener('click', () => updateSettings({ sites: settings.sites.filter((_, i) => i !== index) })); li.append(details, remove); list.append(li);
    });
    const selected = settings?.afterGoals === 'guard' ? 'guard' : 'allow'; const radio = document.querySelector(`input[name="after-goals"][value="${selected}"]`); if (radio) radio.checked = true;
    document.querySelectorAll('#site-form input,#site-form button,input[name="after-goals"]').forEach((el) => { el.disabled = settingsBusy; });
  }
  async function updateSettings(changes) {
    if (!latest?.settings || settingsBusy) return;
    settingsBusy = true; const next = { ...latest.settings, ...changes }; renderSites(next, true); settingsStatus.textContent = 'Saving…';
    const r = await send('SET_SETTINGS', { sites: next.sites, afterGoals: next.afterGoals }); settingsBusy = false;
    if (!r?.ok) { settingsStatus.textContent = r?.error || 'Settings could not be saved.'; renderSites(latest.settings, true); return; }
    latest.settings = r.settings || next; settingsStatus.textContent = 'Settings saved.'; signatures.settings = ''; renderSites(latest.settings, true); await refresh(); return true;
  }
  async function refresh() {
    const state = await send('GET_STATE');
    if (!state?.ok) { if (message.hidden) setMessage(state?.error || 'Could not load your summary. Try reloading this page.'); return; }
    setMessage(''); latest = state; const day = state.day || {};
    $('#dash-date').textContent = new Date().toLocaleDateString('en', { weekday: 'long', month: 'long', day: 'numeric' });
    renderSummary(day); renderWeek(state.week || []); renderHistory(day);
    const stopped = safe(day.stopped);
    $('#stopped-count').textContent = `Focus Guard stopped you ${stopped} ${stopped === 1 ? 'time' : 'times'}`;
    if (!settingsBusy) renderSites(state.settings || { sites: [], afterGoals: 'allow' });
  }
  function normalizeDomain(raw) {
    const value = raw.trim().toLowerCase(); let url;
    try { url = new URL(value.includes('://') ? value : `https://${value}`); } catch { return null; }
    const domain = url.hostname.replace(/^www\./, '').replace(/\.$/, '');
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(domain)) return null;
    return domain;
  }
  $('#site-form').addEventListener('submit', async (event) => {
    event.preventDefault(); if (settingsBusy) return;
    const input = $('#site-domain'), domain = normalizeDomain(input.value);
    if (!domain) { settingsStatus.textContent = 'Enter a domain such as youtube.com.'; input.focus(); return; }
    const sites = latest?.settings?.sites || []; if (sites.some((site) => site.domain.toLowerCase() === domain)) { settingsStatus.textContent = 'That site is already on your list.'; input.focus(); return; }
    if (await updateSettings({ sites: [...sites, { domain, label: domain }] })) input.value = '';
  });
  document.querySelectorAll('input[name="after-goals"]').forEach((radio) => radio.addEventListener('change', () => updateSettings({ afterGoals: radio.value })));
  window.addEventListener('hashchange', showSection); showSection(); refresh(); window.setInterval(refresh, 5000);
})();
