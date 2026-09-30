import test from 'node:test';
import assert from 'node:assert/strict';

class Event {
  listeners = [];
  addListener = listener => this.listeners.push(listener);
  emit(...args) { for (const fn of this.listeners) fn(...args); }
}
function area() {
  const values = {};
  return { values, get: (keys, callback) => callback(structuredClone(values)),
    set: (next, callback) => { Object.assign(values,structuredClone(next)); callback?.(); } };
}
const turn = () => new Promise(resolve => setImmediate(resolve));

test('worker integrates foreground, guard, persistence, idle, daily rollover and settings', async () => {
  const RealDate = globalThis.Date;
  let clock = new RealDate(2026,8,30,10).getTime();
  globalThis.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  };
  let idleState = 'active';
  let focusedWindow = 1;
  const tabs = new Map([
    [1,{id:1,windowId:1,active:true,url:'https://example.com/work'}],
    [2,{id:2,windowId:1,active:false,url:'https://www.youtube.com/watch?v=1'}],
    [3,{id:3,windowId:1,active:false,url:'https://reddit.com/r/test'}],
  ]);
  const notices = [];
  const scripts = [];
  const local = area(), session = area();
  const chrome = globalThis.chrome = {
    runtime: { onInstalled:new Event(),onStartup:new Event(),onMessage:new Event(),
      getURL:path => `chrome-extension://test/${path}`,lastError:undefined },
    storage:{local,session},
    tabs:{ onActivated:new Event(),onUpdated:new Event(),onRemoved:new Event(),
      query:(query, callback) => callback([...tabs.values()].filter(t => (!query.active || t.active) &&
        (query.windowId == null || query.windowId === t.windowId) && (!query.lastFocusedWindow || t.windowId === focusedWindow))),
      get:(id, callback) => callback(tabs.get(id)),
      sendMessage:(id,message,callback) => { notices.push({id,...message}); callback?.(); },
      update:async (id,changes) => { Object.assign(tabs.get(id),changes); chrome.tabs.onUpdated.emit(id,changes,tabs.get(id)); return tabs.get(id); },
      remove:async id => { tabs.delete(id); chrome.tabs.onRemoved.emit(id); },
    },
    windows:{WINDOW_ID_NONE:-1,onFocusChanged:new Event(),
      get:(id,callback) => callback({id,focused:id===focusedWindow}),
      getAll:(query,callback) => callback([{id:1,focused:focusedWindow===1,tabs:[...tabs.values()]}]),
      getLastFocused:(query,callback) => callback({id:1,focused:focusedWindow===1}) },
    idle:{onStateChanged:new Event(),setDetectionInterval:() => {}, queryState:(seconds,callback) => callback(idleState)},
    alarms:{onAlarm:new Event(),create:() => {}},
    scripting:{getRegisteredContentScripts:async () => scripts,
      unregisterContentScripts:async () => {scripts.length=0;},
      registerContentScripts:async values => scripts.push(...values),
      updateContentScripts:async values => {scripts.splice(0,scripts.length,...values);},
      executeScript:async () => [{result:false}],insertCSS:async () => {},removeCSS:async () => {}},
  };
  await import('../background.js?integration');
  const uiSender = {url:'chrome-extension://test/popup.html'};
  const send = (message, tabId = null) => new Promise(resolve => {
    const sender = tabId == null ? uiSender : {tab:{...tabs.get(tabId)},frameId:0,url:tabs.get(tabId).url};
    chrome.runtime.onMessage.listeners[0](message,sender,resolve);
  });
  const tick = async ms => { clock+=ms; chrome.alarms.onAlarm.emit({name:'fg-heartbeat'}); await turn(); await send({type:'GET_STATE'}); };
  const activate = async id => {
    for (const t of tabs.values()) t.active=t.id===id;
    chrome.tabs.onActivated.emit({tabId:id,windowId:1}); await turn();
  };
  const foreground = async id => { focusedWindow=id; chrome.windows.onFocusChanged.emit(id??-1); await turn(); };
  try {
    assert.equal((await send({type:'GET_STATE'})).ok,true);
    assert.equal(scripts[0].runAt,'document_start');
    await send({type:'SET_GOALS',texts:['Học tiếng Việt','Ship']});
    let state=await send({type:'START_FOCUS'});
    assert.equal(state.focusPaused,false,'initial foreground is discovered without an activation event');
    await tick(30_000);
    state=await send({type:'GET_STATE'});
    assert.equal(state.day.focusMs,30_000);
    assert.equal(local.values.data.days[state.dateKey].focusMs,30_000,'read settles and persists time');
    await activate(2);
    let guard=await send({type:'GUARD_STATE'},2);
    assert.equal(guard.guard.stage,'reason');
    assert.equal(guard.day.goals[0].text,'Học tiếng Việt');
    assert.equal((await send({type:'GUARD_REASON',reason:'  '},2)).ok,false);
    guard=await send({type:'GUARD_REASON',reason:'Tìm tài liệu'},2);
    assert.equal(guard.guard.deadline-clock,30_000);
    const deadline=guard.guard.deadline;
    const countBefore=notices.length;
    guard=await send({type:'GUARD_STATE'},2);
    assert.equal(guard.guard.deadline,deadline,'reload lookup preserves countdown');
    assert.equal(notices.length,countBefore,'read does not cause recursive guard notifications');
    assert.equal((await send({type:'GUARD_OPEN'},2)).ok,false);
    await tick(30_000);
    guard=await send({type:'GUARD_STATE'},2);
    assert.equal(guard.guard.stage,'ready');
    assert.equal((await send({type:'GET_STATE'})).day.distractionMs,0,'blocker wait is not distraction');
    guard=await send({type:'GUARD_OPEN'},2);
    assert.equal(guard.guard.stage,'open');
    await tick(30_000);
    state=await send({type:'GET_STATE'});
    assert.equal(state.day.distractionMs,30_000);
    assert.equal(state.day.focusMs,30_000);
    for (let i = 0; i < 9; i++) await tick(30_000);
    guard = await send({type:'GUARD_STATE'},2);
    assert.equal(guard.guard.visitMs,300_000);
    assert.equal(guard.guard.reminderCount,1,'first reminder is due after five active minutes');
    assert.equal(guard.guard.reminderShown,0);
    await send({type:'GUARD_REMINDER_ACK',visitId:'wrong',count:1},2);
    assert.equal((await send({type:'GUARD_STATE'},2)).guard.reminderShown,0);
    await send({type:'GUARD_REMINDER_ACK',visitId:guard.guard.visitId,count:2},2);
    assert.equal((await send({type:'GUARD_STATE'},2)).guard.reminderShown,0,'future reminders cannot be acknowledged');
    await send({type:'GUARD_REMINDER_ACK',visitId:guard.guard.visitId,count:1},2);
    assert.equal((await send({type:'GUARD_STATE'},2)).guard.reminderShown,1,'reload does not repeat an acknowledged reminder');
    idleState='idle'; chrome.idle.onStateChanged.emit('idle'); await turn();
    for (let i = 0; i < 10; i++) await tick(30_000);
    assert.equal((await send({type:'GUARD_STATE'},2)).guard.visitMs,300_000,'idle does not advance reminders');
    idleState='active'; chrome.idle.onStateChanged.emit('active'); await turn();
    for (let i = 0; i < 10; i++) await tick(30_000);
    assert.equal((await send({type:'GUARD_STATE'},2)).guard.reminderCount,2,'next reminder at ten active minutes');
    await activate(1);
    assert.equal((await send({type:'GUARD_STATE'},2)).guard.stage,'reason');
    assert.equal((await send({type:'GET_STATE'})).day.visits[0].endedAt,clock);
    assert(notices.some(n=>n.id===2 && n.type==='GUARD_CHANGED'));
    await tick(30_000);
    assert.equal((await send({type:'GET_STATE'})).day.focusMs,60_000);
    await foreground(null);
    await tick(30_000);
    assert.equal((await send({type:'GET_STATE'})).day.focusMs,90_000,'focus continues in another app');
    idleState='idle'; chrome.idle.onStateChanged.emit('idle'); await turn();
    await tick(30_000);
    assert.equal((await send({type:'GET_STATE'})).day.focusMs,90_000);
    idleState='active'; chrome.idle.onStateChanged.emit('active'); await turn();
    await foreground(1);
    await activate(2);
    guard=await send({type:'GUARD_REASON',reason:'One video'},2);
    await tick(30_000); await send({type:'GUARD_OPEN'},2);
    assert.equal((await send({type:'GUARD_STATE'},2)).guard.reminderShown,0,'new visit resets reminders');
    await foreground(null);
    await foreground(1);
    assert.equal((await send({type:'GUARD_STATE'},2)).guard.stage,'reason','returning from another app reblocks');
    await activate(1);
    state=await send({type:'GET_STATE'});
    for (const goal of state.day.goals) await send({type:'TOGGLE_GOAL',id:goal.id});
    await activate(2);
    assert.equal((await send({type:'GUARD_STATE'},2)).guard.stage,'allow');
    await tick(30_000);
    await send({type:'TOGGLE_GOAL',id:state.day.goals[0].id});
    assert.equal((await send({type:'GUARD_STATE'},2)).guard.stage,'reason');
    await send({type:'GUARD_BACK'},2); await turn();
    assert.equal((await send({type:'GET_STATE'})).day.stopped,1);
    assert.equal(tabs.get(2).url,'chrome://newtab/');
    await send({type:'STOP_FOCUS'});
    assert.equal((await send({type:'START_FOCUS'})).sessionFocusMs,0);
    await send({type:'SET_SETTINGS',sites:['reddit.com'],afterGoals:'guard'});
    // Existing content scripts on removed sites must be released.
    tabs.get(2).url='https://youtube.com';
    assert.equal((await send({type:'GUARD_STATE'},2)).guard,null);
    await activate(3);
    guard=await send({type:'GUARD_REASON',reason:'Research'},3);
    await tick(30_000); await send({type:'GUARD_OPEN'},3);
    idleState='idle'; chrome.idle.onStateChanged.emit('idle'); await turn();
    await tick(30_000);
    idleState='active'; chrome.idle.onStateChanged.emit('active'); await turn();
    assert.equal((await send({type:'GUARD_STATE'},3)).guard.stage,'open','idle pauses visit rather than ending it');
    idleState='locked'; focusedWindow=null;
    chrome.windows.onFocusChanged.emit(-1);
    chrome.idle.onStateChanged.emit('locked'); await turn();
    const beforeLock=(await send({type:'GET_STATE'})).day.distractionMs;
    await tick(30_000);
    assert.equal((await send({type:'GUARD_STATE'},3)).guard.stage,'open','lock screen preserves the open visit');
    assert.equal((await send({type:'GET_STATE'})).day.distractionMs,beforeLock);
    idleState='active'; focusedWindow=1;
    chrome.windows.onFocusChanged.emit(1); chrome.idle.onStateChanged.emit('active'); await turn();
    assert.equal((await send({type:'GUARD_STATE'},3)).guard.stage,'open','unlocking same tab resumes visit');
    idleState='idle'; chrome.idle.onStateChanged.emit('idle'); await turn();
    await activate(1);
    idleState='active'; chrome.idle.onStateChanged.emit('active'); await turn();
    await activate(3);
    assert.equal((await send({type:'GUARD_STATE'},3)).guard.stage,'reason','changing tabs while idle ends visit');
    clock=new RealDate(2026,9,1,0,0,10).getTime();
    await tick(0);
    state=await send({type:'GET_STATE'});
    assert.equal(state.day.goals.length,0);
    assert.equal(state.day.distractionMs,0,'long sleep gap is not credited');
    assert.equal((await send({type:'START_FOCUS'},3)).ok,false,'content cannot invoke UI mutations');
    await activate(1);
    await send({type:'START_FOCUS'});
    await tick(30_000);
    state=await send({type:'GET_STATE'});
    const beforeRestart=state.day.focusMs;
    clock+=5_000;
    const resetListeners=()=>{
      for(const namespace of Object.values(chrome)) {
        for(const value of Object.values(namespace)) if(value instanceof Event) value.listeners=[];
      }
    };
    resetListeners();
    await import('../background.js?worker-restart');
    state=await send({type:'GET_STATE'});
    assert.equal(state.focusRunning,true);
    assert.equal(state.day.focusMs,beforeRestart+5_000,'short worker restart restores only unsaved interval');
    // Simulate a crash after local totals were stored but before session cutoff.
    session.values.runtime.lastAt-=5_000;
    resetListeners();
    await import('../background.js?partial-checkpoint');
    state=await send({type:'GET_STATE'});
    assert.equal(state.day.focusMs,beforeRestart+5_000,'partial checkpoint cannot credit time twice');
    clock+=300_000;
    delete session.values.runtime;
    resetListeners();
    await import('../background.js?browser-restart');
    state=await send({type:'GET_STATE'});
    assert.equal(state.focusRunning,false);
    assert.equal(state.day.focusMs,beforeRestart+5_000,'browser closed time never counted');
    await activate(3);
    await send({type:'GUARD_REASON',reason:'One last look'},3);
    await tick(30_000);
    guard = await send({type:'GUARD_OPEN'},3);
    assert.equal((await send({type:'GUARD_CLOSE',visitId:'wrong'},3)).ok,false);
    assert.equal(tabs.has(3),true,'invalid visit cannot close a tab');
    const stoppedBefore = guard.day.stopped;
    assert.equal((await send({type:'GUARD_CLOSE',visitId:guard.guard.visitId},3)).ok,true);
    await turn();
    assert.equal(tabs.has(3),false,'Back to focus closes the sending distraction tab');
    assert.equal(tabs.has(1),true,'other tabs remain open');
    assert.equal((await send({type:'GET_STATE'})).day.stopped,stoppedBefore+1);
  } finally { globalThis.Date=RealDate; delete globalThis.chrome; }
});
