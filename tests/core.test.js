import test from 'node:test';
import assert from 'node:assert/strict';
import { createData, getDay, dayKey, setGoals, toggleGoal, findSite, normalizeSites,
  settle, buildSnapshot } from '../core.js';

const date = () => new Date(2026, 8, 30, 10).getTime();
function runtime(now, mode = { focus: true, visit: null }) { return { lastAt: now, mode }; }
function accrue(data, state, duration) {
  while (duration > 0) {
    const step = Math.min(30_000, duration);
    settle(data, state, state.lastAt + step);
    duration -= step;
  }
}

test('goals preserve Unicode, completion and edit rules; next day is empty', () => {
  const data = createData(), now = date();
  setGoals(data, ['  Học tiếng Việt  ', 'Ship Focus Guard', ''], now);
  const day = getDay(data, now);
  assert.equal(day.goals[0].text, 'Học tiếng Việt');
  toggleGoal(data, day.goals[0].id, now);
  setGoals(data, ['Học tiếng Việt', 'Read'], now);
  assert.equal(day.goals[0].done, true);
  assert.equal(day.goals[1].done, false);
  toggleGoal(data, day.goals[0].id, now);
  assert.equal(day.goals[0].done, false);
  assert.throws(() => setGoals(data, ['   '], now));
  assert.throws(() => setGoals(data, ['a','b','c','d'], now));
  assert.equal(getDay(data, now + 86_400_000).goals.length, 0);
});

test('focus carries leftover seconds between sessions with no rounding or duplication', () => {
  const data = createData(); data.focusRunning = true;
  const state = runtime(date());
  accrue(data, state, (34*60+21)*1000);
  state.mode.focus = false;
  accrue(data, state, 60_000);
  state.mode.focus = true;
  accrue(data, state, (5*60+39)*1000);
  settle(data, state, state.lastAt);
  assert.equal(getDay(data, date()).focusMs, 40*60*1000);
  assert.equal(data.sessionFocusMs, 40*60*1000);
});

test('distraction time accumulates across visits and pauses focus', () => {
  const data = createData(); data.focusRunning = true;
  const state = runtime(date());
  for (const [index, minutes] of [4,3,3].entries()) {
    state.mode = { focus: true, visit: { id:String(index), site:['youtube.com','reddit.com','facebook.com'][index],
      reason:'Tìm tài liệu', startedAt:state.lastAt, tabId:1 } };
    accrue(data, state, minutes*60_000);
  }
  const day = getDay(data, date());
  assert.equal(day.distractionMs, 600_000);
  assert.equal(day.focusMs, 0);
  assert.equal(day.visits.length, 3);
  assert.equal(day.visits.reduce((sum,v) => sum+v.durationMs, 0), day.distractionMs);
});

test('inactive intervals, long sleep gaps and clock reversal do not accrue', () => {
  const data = createData(); data.focusRunning = true;
  const state = runtime(date(), { focus:false, visit:null });
  accrue(data,state,300_000);
  state.mode.focus = true;
  settle(data,state,state.lastAt+120_000);
  settle(data,state,state.lastAt-10_000);
  assert.equal(getDay(data,date()).focusMs,0);
  accrue(data,state,30_000);
  assert.equal(getDay(data,date()).focusMs,30_000);
});

test('midnight splits both totals and visit rows at local boundaries', () => {
  const now = new Date(2026,8,30,23,59,50).getTime();
  const data = createData(); data.focusRunning = true;
  const state = runtime(now);
  settle(data,state,now+20_000);
  assert.equal(getDay(data,now).focusMs,10_000);
  assert.equal(getDay(data,now+20_000).focusMs,10_000);
  state.lastAt = now;
  state.mode = { focus:false, visit:{id:'cross-day',site:'x.com',reason:'News',startedAt:now,tabId:1} };
  settle(data,state,now+20_000);
  assert.equal(getDay(data,now).visits[0].durationMs,10_000);
  assert.equal(getDay(data,now).visits[0].endedAt,new Date(2026,9,1).getTime());
  assert.equal(getDay(data,now+20_000).visits[0].durationMs,10_000);
  assert.equal(getDay(data,now+20_000).goals.length,0);
});

test('domains match exact host/subdomain, ignore schemes and normalize inputs', () => {
  const sites = normalizeSites([' HTTPS://www.YouTube.com/watch?a=1 ', 'youtube.com', 'reddit.com']);
  assert.equal(sites.length,2);
  assert.equal(findSite('https://m.youtube.com/watch',sites).label,'YouTube');
  assert.equal(findSite('https://notyoutube.com',sites),null);
  assert.equal(findSite('https://youtube.com.evil.example',sites),null);
  assert.equal(findSite('chrome://youtube.com',sites),null);
  assert.equal(findSite('https://twitter.com/home',createData().settings.sites).domain,'x.com');
  for (const bad of ['javascript:alert(1)','https://user:password@youtube.com','*.youtube.com','bad address','localhost']) {
    assert.throws(() => normalizeSites([bad]));
  }
});

test('weekly snapshot uses Monday-Sunday with zero rows for absent dates', () => {
  const data = createData(), now = date();
  setGoals(data,['Build'],now);
  const snapshot = buildSnapshot(data,runtime(now),now);
  assert.equal(snapshot.week.length,7);
  const first = new Date(`${snapshot.week[0].key}T12:00:00`);
  assert.equal(first.getDay(),1);
  assert.equal(snapshot.dateKey,dayKey(now));
  assert.equal(snapshot.week[2].goals[0].text,'Build');
});
