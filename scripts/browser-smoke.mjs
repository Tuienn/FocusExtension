// Isolated real-Chromium smoke test; no packages and no production profile.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const profile = await mkdtemp(join(tmpdir(),'focus-guard-smoke-'));
const server = createServer((req,res) => {
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.end(`<!doctype html><html><head><title>Distraction fixture</title></head><body><h1>Test site</h1><button id="underlying" onclick="window.clicked=true">Underlying page</button><p>A page used only for local extension tests.</p></body></html>`);
});
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
const port = server.address().port;
const browser = spawn(process.env.CHROMIUM_PATH || '/usr/lib64/chromium-browser/chromium-browser',[
  '--headless','--disable-gpu',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check',
  '--remote-debugging-pipe',`--load-extension=${resolve('.')}`,`--disable-extensions-except=${resolve('.')}`,
  '--host-resolver-rules=MAP *.guard.test 127.0.0.1, MAP guard.test 127.0.0.1','--no-proxy-server',
  '--disable-background-networking','about:blank',
],{stdio:['ignore','ignore','pipe','pipe','pipe']});
let stderr=''; browser.stderr.on('data',b=>{stderr+=b;});
let nextId=0,buffer=Buffer.alloc(0);
const pending=new Map(), events=[];
browser.stdio[4].on('data',chunk=>{
  buffer=Buffer.concat([buffer,chunk]);
  let index;
  while ((index=buffer.indexOf(0))>=0) {
    const message=JSON.parse(buffer.subarray(0,index).toString()); buffer=buffer.subarray(index+1);
    if (message.id) {
      const call=pending.get(message.id); pending.delete(message.id);
      if (message.error) call?.reject(new Error(JSON.stringify(message.error))); else call?.resolve(message.result);
    } else events.push(message);
  }
});
const cdp=(method,params={},sessionId)=>new Promise((resolve,reject)=>{
  const id=++nextId;
  const timeout=setTimeout(()=>{pending.delete(id);reject(new Error(`Timeout ${method}\n${stderr.slice(-2000)}`));},15_000);
  pending.set(id,{resolve:r=>{clearTimeout(timeout);resolve(r);},reject:e=>{clearTimeout(timeout);reject(e);}});
  browser.stdio[3].write(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})})+'\0');
});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const until=async fn=>{for(let i=0;i<100;i++){const value=await fn();if(value)return value;await sleep(100);}throw new Error('Condition not reached');};
const attach=async targetId=>{
  const session=(await cdp('Target.attachToTarget',{targetId,flatten:true})).sessionId;
  await cdp('Runtime.enable',{},session);
  return session;
};
const evaluate=async(session,expression)=>{
  const result=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},session);
  if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
};
const screenshot=async(session,name)=>{
  const shot=await cdp('Page.captureScreenshot',{format:'png'},session);
  await writeFile(join(profile,name),Buffer.from(shot.data,'base64'));
};
try {
  await cdp('Target.setDiscoverTargets',{discover:true});
  const worker=await until(async()=>{
    const {targetInfos}=await cdp('Target.getTargets');
    return targetInfos.find(t=>t.type==='service_worker' && t.url.endsWith('/background.js'));
  });
  const extensionBase=worker.url.replace(/background\.js$/,'');
  const uiId=(await cdp('Target.createTarget',{url:extensionBase+'popup.html'})).targetId;
  const ui=await attach(uiId);
  await cdp('Page.enable',{},ui);
  await cdp('Emulation.setDeviceMetricsOverride',{width:150,height:600,deviceScaleFactor:1,mobile:false},ui);
  await until(()=>evaluate(ui,`document.documentElement.classList.contains('popup-root')`));
  assert.equal(await evaluate(ui,`document.documentElement.getBoundingClientRect().width`),400,'popup must not shrink with its initial viewport');
  await cdp('Emulation.setDeviceMetricsOverride',{width:400,height:600,deviceScaleFactor:1,mobile:false},ui);
  await until(()=>evaluate(ui,`document.querySelector('#onboarding')?.hidden === false`));
  assert.equal(await evaluate(ui,`document.querySelector('h2').textContent`),'What matters today?');
  await evaluate(ui,'document.fonts.ready');
  assert.equal(await evaluate(ui,`document.fonts.load('16px "Pixel UI"').then(f=>f.length)`),1,'original WOFF must decode');
  await screenshot(ui,'popup-onboarding.png');
  const send=async message=>evaluate(ui,`chrome.runtime.sendMessage(${JSON.stringify(message)})`);
  await evaluate(ui,`document.querySelector('#goal-1').value='Học tiếng Việt';document.querySelector('#goal-2').value='Ship Focus Guard';document.querySelector('#goal-form').requestSubmit()`);
  await until(()=>evaluate(ui,`document.querySelector('#home')?.hidden===false`));
  let state=await send({type:'GET_STATE'});
  assert.equal(state.ok,true);
  await send({type:'START_FOCUS'});
  await until(()=>evaluate(ui,`document.querySelector('#goal-list')?.textContent.includes('Học tiếng Việt')`));
  await until(()=>evaluate(ui,`document.querySelector('#focus-live')?.hidden===false`));
  assert.equal(await evaluate(ui,`document.documentElement.scrollWidth <= innerWidth`),true,'popup has no horizontal overflow');
  await screenshot(ui,'popup-home.png');
  state=await send({type:'SET_SETTINGS',sites:['guard.test'],afterGoals:'guard'});
  assert.equal(state.ok,true,JSON.stringify(state));
  const pageId=(await cdp('Target.createTarget',{url:`http://guard.test:${port}/one`})).targetId;
  const page=await attach(pageId);
  await cdp('Page.enable',{},page);
  await cdp('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false},page);
  await cdp('Page.bringToFront',{},page);
  await until(()=>evaluate(page,`document.getElementById('focus-guard-host')?.shadowRoot?.querySelector('h1')?.textContent==='NOT YET'`));
  assert.equal(await evaluate(page,`getComputedStyle(document.getElementById('underlying')).visibility`),'hidden');
  const shadow=`document.getElementById('focus-guard-host').shadowRoot`;
  await evaluate(page,`${shadow}.querySelector('[data-action="continue"]').click()`);
  assert.equal(await evaluate(page,`${shadow}.querySelector('[role="alert"]').textContent`),'Tell yourself why you want to open this site.');
  await evaluate(page,`(()=>{const el=${shadow}.querySelector('textarea');el.value='Tìm tài liệu';el.dispatchEvent(new Event('input',{bubbles:true}));${shadow}.querySelector('[data-action="continue"]').click()})()`);
  await until(()=>evaluate(page,`${shadow}.querySelector('h1').textContent==='THINK FIRST'`));
  const initialCount=await evaluate(page,`Number(${shadow}.querySelector('.count').textContent)`);
  assert(initialCount>=28 && initialCount<=30,`countdown ${initialCount}`);
  assert.equal(await evaluate(page,`${shadow}.querySelector('.goal').textContent.includes('Học tiếng Việt')`),true);
  await screenshot(page,'blocker-countdown.png');
  await cdp('Page.reload',{},page);
  await until(()=>evaluate(page,`document.getElementById('focus-guard-host')?.shadowRoot?.querySelector('h1')?.textContent==='THINK FIRST'`));
  const reloadedCount=await evaluate(page,`Number(${shadow}.querySelector('.count').textContent)`);
  assert(reloadedCount<=initialCount && reloadedCount>0,'reload preserves remaining countdown');
  await sleep(31_000);
  await until(()=>evaluate(page,`${shadow}.querySelector('h1').textContent==='READY'`));
  assert.equal(await evaluate(page,`document.documentElement.hasAttribute('data-fg-unlocked')`),false,'expiry never opens automatically');
  await screenshot(page,'blocker-ready.png');
  await evaluate(page,`${shadow}.querySelector('[data-action="open"]').click()`);
  await until(()=>evaluate(page,`document.documentElement.hasAttribute('data-fg-unlocked')`));
  assert.equal(await evaluate(page,`getComputedStyle(document.getElementById('underlying')).visibility`),'visible');
  await evaluate(page,`document.getElementById('underlying').click()`);
  assert.equal(await evaluate(page,`window.clicked`),true);
  const timer=`document.getElementById('focus-guard-timer')?.shadowRoot`;
  await until(()=>evaluate(page,`${timer}?.querySelector('strong')?.textContent.endsWith(' h')`));
  assert.equal(await evaluate(page,`getComputedStyle(document.getElementById('focus-guard-timer')).pointerEvents`),'none','timer does not intercept page input');
  // Advance only the isolated worker clock in safe accounting steps.
  const workerSession=await attach(worker.targetId);
  await evaluate(workerSession,`globalThis.smokeRealNow=Date.now;globalThis.smokeNow=Date.now();Date.now=()=>globalThis.smokeNow`);
  for(let i=0;i<10;i++) {
    await evaluate(workerSession,`globalThis.smokeNow+=30000`);
    await send({type:'GET_STATE'});
  }
  await until(()=>evaluate(page,`${timer}?.querySelector('.reminder')?.hidden===false`));
  assert.equal(await evaluate(page,`${timer}.querySelector('.reminder').textContent.includes('5 minutes')`),true);
  assert.equal(await evaluate(page,`getComputedStyle(${timer}.querySelector('.label')).color`),'rgb(17, 17, 17)');
  assert.equal(await evaluate(page,`getComputedStyle(${timer}.querySelector('.status')).color`),'rgb(17, 17, 17)');
  assert.equal(await evaluate(page,`getComputedStyle(${timer}.querySelector('.wasted')).color`),'rgb(184, 46, 48)');
  assert.equal(await evaluate(page,`getComputedStyle(${timer}.querySelector('.timer')).animationName`),'timer-float');
  await cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]},page);
  assert.equal(await evaluate(page,`getComputedStyle(${timer}.querySelector('.timer')).animationName`),'none');
  await cdp('Emulation.setEmulatedMedia',{features:[]},page);
  await sleep(350);
  await screenshot(page,'distraction-reminder.png');
  const clickReminderButton=async selector=>{
    const position=await evaluate(page,`(()=>{const r=${timer}.querySelector('${selector}').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await cdp('Input.dispatchMouseEvent',{type:'mousePressed',...position,button:'left',clickCount:1},page);
    await cdp('Input.dispatchMouseEvent',{type:'mouseReleased',...position,button:'left',clickCount:1},page);
  };
  await cdp('Page.reload',{},page);
  await until(()=>evaluate(page,`document.documentElement.hasAttribute('data-fg-unlocked') && Boolean(${timer})`));
  assert.equal(await evaluate(page,`${timer}.querySelector('.reminder').hidden`),true,'reload does not repeat reminder');
  for(let i=0;i<10;i++) {
    await evaluate(workerSession,`globalThis.smokeNow+=30000`);
    await send({type:'GET_STATE'});
  }
  await until(()=>evaluate(page,`${timer}?.querySelector('.reminder')?.hidden===false`));
  assert.equal(await evaluate(page,`${timer}.querySelector('.reminder').textContent.includes('10 minutes')`),true);
  await clickReminderButton('.dismiss');
  assert.equal(await evaluate(page,`${timer}.querySelector('.reminder').hidden`),true);
  for(let i=0;i<10;i++) {
    await evaluate(workerSession,`globalThis.smokeNow+=30000`);
    await send({type:'GET_STATE'});
  }
  await until(()=>evaluate(page,`${timer}?.querySelector('.reminder')?.hidden===false`));
  assert.equal(await evaluate(page,`${timer}.querySelector('.acknowledge').textContent`),'Back to focus');
  await clickReminderButton('.acknowledge');
  await until(async()=> !(await cdp('Target.getTargets')).targetInfos.some(t=>t.targetId===pageId));
  await evaluate(workerSession,`Date.now=globalThis.smokeRealNow`);
  state=await send({type:'GET_STATE'});
  assert.equal(state.day.stopped,1);
  assert.equal(state.day.visits[0].reason,'Tìm tài liệu');
  const dashId=(await cdp('Target.createTarget',{url:extensionBase+'dashboard.html#summary'})).targetId;
  const dash=await attach(dashId);
  await cdp('Page.enable',{},dash);
  await cdp('Emulation.setDeviceMetricsOverride',{width:1024,height:900,deviceScaleFactor:1,mobile:false},dash);
  await until(()=>evaluate(dash,`document.querySelector('#summary-goals-list')?.textContent.includes('Học tiếng Việt')`));
  assert.equal(await evaluate(dash,`document.querySelector('#focus-total').textContent.endsWith(' h')`),true);
  assert.equal(await evaluate(dash,`document.querySelector('.stopped-count').textContent.includes('1 time')`),true);
  await evaluate(dash,'document.fonts.ready');
  assert.equal(await evaluate(dash,'window.scrollY'),0,'view navigation keeps the header visible');
  await screenshot(dash,'summary.png');
  await cdp('Page.navigate',{url:extensionBase+'dashboard.html#settings'},dash);
  await until(()=>evaluate(dash,`document.querySelector('#settings')?.hidden===false`));
  await screenshot(dash,'settings.png');
  const errors=events.filter(e=>e.method==='Runtime.exceptionThrown');
  assert.equal(errors.length,0,JSON.stringify(errors));
  console.log(`PASS: installed MV3, original font, Unicode goals, popup, 30-second blocker, refresh, manual open, tab return, Back, log and summary/settings.\nScreenshots: ${profile}`);
} finally {
  browser.kill('SIGTERM');
  await new Promise(resolve=>server.close(resolve));
}
