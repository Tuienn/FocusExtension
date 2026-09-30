(() => {
  const $ = (s) => document.querySelector(s);
  const onboarding = $('#onboarding'), home = $('#home'), message = $('#message');
  let currentDay = null, editing = false, editingDayKey = null, goalSignature = '';
  const send = (type, extra = {}) => new Promise((resolve) => chrome.runtime.sendMessage({ type, ...extra }, (response) => {
    if (chrome.runtime.lastError) return resolve({ ok: false, error: chrome.runtime.lastError.message });
    resolve(response || { ok: false, error: 'No response from the focus service.' });
  }));
  const showError = (text = '') => { message.textContent = text; message.hidden = !text; };
  const hours = (ms) => `${(Math.max(0, Number(ms) || 0) / 3600000).toFixed(2)} h`;
  const formatTime = (ms) => { const s = Math.floor(Math.max(0, ms) / 1000); return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
  const render = async () => {
    const state = await send('GET_STATE');
    if (!state?.ok) { if (message.hidden) showError(state?.error || 'Could not load today. Try reopening the popup.'); return; }
    currentDay = state.day || null;
    if (!currentDay?.initialized) { home.hidden = true; onboarding.hidden = false; return; }
    onboarding.hidden = true; home.hidden = false;
    if (editing && editingDayKey !== currentDay.key) {
      editing = false; $('#goal-list').hidden = false; $('#edit-form').hidden = true;
      showError('A new day started. Your unsaved goals were closed.');
    }
    $('#today-date').textContent = new Date().toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' });
    if (!editing) renderGoals(currentDay.goals || []);
    $('#focus-hours').textContent = hours(currentDay.focusMs);
    $('#distraction-hours').textContent = hours(currentDay.distractionMs);
    const goals = currentDay.goals || [], allDone = goals.length > 0 && goals.every((goal) => goal.done);
    $('#goals-complete').hidden = !allDone;
    const running = !!state.focusRunning, live = $('#focus-live'); live.hidden = !running;
    if (running) {
      const ms = Math.max(0, Number(state.sessionFocusMs) || 0);
      $('#focus-timer').textContent = formatTime(ms);
    }
    $('#focus-caption').textContent = state.focusPaused ? 'FOCUS PAUSED' : running ? 'FOCUS SESSION IN PROGRESS' : 'READY WHEN YOU ARE';
    const action = $('#focus-action'); action.innerHTML = running ? 'Stop <span aria-hidden="true">■</span>' : 'Start Focus <span aria-hidden="true">▶</span>';
  };
  function renderGoals(goals) {
    const signature = JSON.stringify(goals.map(({ id, text, done }) => [id, text, !!done]));
    if (signature === goalSignature) return;
    const list = $('#goal-list'), focused = list.contains(document.activeElement);
    if (focused) {
      for (const goal of goals) {
        const row = [...list.children].find((child) => child.dataset.id === String(goal.id));
        if (!row) continue;
        const check = row.querySelector('input'); check.checked = !!goal.done;
        row.classList.toggle('is-done', !!goal.done);
      }
      goalSignature = signature; return;
    }
    list.replaceChildren();
    goals.forEach((goal) => {
      const row = document.createElement('label'); row.className = `goal-row${goal.done ? ' is-done' : ''}`; row.dataset.id = String(goal.id);
      const check = document.createElement('input'); check.type = 'checkbox'; check.checked = !!goal.done; check.setAttribute('aria-label', `Mark ${goal.text} ${goal.done ? 'incomplete' : 'complete'}`);
      check.addEventListener('change', async () => { const r = await send('TOGGLE_GOAL', { id: goal.id }); if (!r?.ok) showError(r?.error || 'Could not update that goal.'); else showError(''); await render(); });
      const text = document.createElement('span'); text.textContent = goal.text; row.append(check, text); list.append(row);
    });
    if (!goals.length) { const empty = document.createElement('p'); empty.className = 'empty-note'; empty.textContent = 'No goals yet. Add a few to shape your day.'; list.append(empty); }
    goalSignature = signature;
  }
  function goalValues(form) { return [...form.querySelectorAll('input')].map((input) => input.value.trim()).filter(Boolean).slice(0, 3); }
  $('#goal-form').addEventListener('submit', async (event) => {
    event.preventDefault(); const form = event.currentTarget, texts = goalValues(form);
    if (!texts.length) { showError('Add at least one goal to start your day.'); $('#goal-1').focus(); return; }
    const r = await send('SET_GOALS', { texts }); if (!r?.ok) { showError(r?.error || 'Could not save your goals.'); return; }
    form.reset(); showError(''); goalSignature = ''; await render();
  });
  $('#edit-goals').addEventListener('click', () => {
    const fields = $('#edit-fields'); fields.replaceChildren();
    [0, 1, 2].forEach((i) => { const label = document.createElement('label'); label.className = 'field-label'; label.htmlFor = `edit-goal-${i}`; label.textContent = `Goal ${i + 1}`;
      const input = document.createElement('input'); input.id = label.htmlFor; input.maxLength = 200; input.value = currentDay?.goals?.[i]?.text || ''; input.placeholder = i === 0 ? 'A useful first step' : 'Optional goal'; fields.append(label, input); });
    editing = true; editingDayKey = currentDay?.key; $('#goal-list').hidden = true; $('#edit-form').hidden = false; $('#edit-fields input').focus();
  });
  $('#cancel-edit').addEventListener('click', () => { editing = false; $('#goal-list').hidden = false; $('#edit-form').hidden = true; });
  $('#edit-form').addEventListener('submit', async (event) => { event.preventDefault();
    if (editingDayKey !== currentDay?.key) { showError('A new day started. Reopen Edit to change today’s goals.'); return; }
    const texts = goalValues(event.currentTarget); if (!texts.length) { showError('Keep at least one goal for today.'); $('#edit-fields input').focus(); return; }
    const r = await send('SET_GOALS', { texts }); if (!r?.ok) { showError(r?.error || 'Could not save your goals.'); return; }
    editing = false; showError(''); goalSignature = ''; $('#goal-list').hidden = false; $('#edit-form').hidden = true; await render(); });
  $('#focus-action').addEventListener('click', async () => { const r = await send($('#focus-live').hidden ? 'START_FOCUS' : 'STOP_FOCUS'); if (!r?.ok) showError(r?.error || 'Could not update the focus session.'); else showError(''); await render(); });
  document.querySelectorAll('[data-page]').forEach((link) => link.addEventListener('click', (e) => { e.preventDefault(); chrome.tabs.create({ url: chrome.runtime.getURL(link.dataset.page) }); }));
  render(); window.setInterval(render, 1000);
})();
