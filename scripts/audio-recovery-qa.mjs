import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
// 선택적 QA: 기존 Vite 개발 서버 + 별도 headless Chrome만 사용합니다.
const modulePath=process.env.PAWBLOSSOM_PLAYWRIGHT_MODULE;
const {chromium}=await import(modulePath?pathToFileURL(path.resolve(modulePath)).href:'playwright');
const origin=process.env.PAWBLOSSOM_QA_ORIGIN??'http://127.0.0.1:5173';
const production=process.argv.includes('--production');
const output=`docs/audio/recovery-${production?'production':'browser'}-qa-20261016.json`;
const report={dateKst:'2026-10-16',base:'2632d6e6342fa1ef142e596c0a4e87252d015303',
  environment:'격리 headless Chrome 실제 AudioContext/오실레이터. 생성/연결/속성 실패는 QA 주입. visibility는 document.hidden+이벤트 주입, 앱 pause는 앱의 nativeActive gate 호출. OS/전화/Bluetooth/Android 오디오 포커스 재현 아님.',
  sourceSha256:createHash('sha256').update(fs.readFileSync('src/audio/AudioManager.ts')).digest('hex'),checks:[],samples:[],layouts:[],pageerrors:[]};
const browser=await chromium.launch({headless:true,channel:'chrome',args:['--autoplay-policy=document-user-activation-required']});
report.browser=browser.version();
report.build=production?'production dist':'Vite development';
report.autoplayPolicy='document-user-activation-required';

function instrument(){
  const Native=window.AudioContext;globalThis.__contexts=[];globalThis.__failure=null;
  window.AudioContext=function(options){
    const ctx=new Native(options),record={ctx,nodes:[],closeCalls:0,resumeCalls:0,resumeCompletions:0};__contexts.push(record);
    const resume=ctx.resume.bind(ctx);ctx.resume=()=>{record.resumeCalls++;return resume().then(()=>{record.resumeCompletions++;});};
    for(const method of ['createGain','createDynamicsCompressor','createWaveShaper','createOscillator']){
      const create=ctx[method].bind(ctx);
      ctx[method]=(...args)=>{
        if(__failure===record.nodes.length+1){__failure=null;throw Error('QA create');}
        const node=create(...args),entry={node,disconnected:false,stops:0};record.nodes.push(entry);
        const disconnect=node.disconnect.bind(node);node.disconnect=(...args)=>{entry.disconnected=true;return disconnect(...args);};
        const connect=node.connect.bind(node);node.connect=(...args)=>{if(__failure==='connect'){__failure=null;throw Error('QA connect');}return connect(...args);};
        if(method==='createWaveShaper'){
          const descriptor=Object.getOwnPropertyDescriptor(WaveShaperNode.prototype,'curve');
          Object.defineProperty(node,'curve',{get(){return descriptor.get.call(node);},set(value){if(__failure==='curve'){__failure=null;throw Error('QA curve');}descriptor.set.call(node,value);}});
        }
        if(method==='createOscillator'){const stop=node.stop.bind(node);node.stop=(...args)=>{entry.stops++;return stop(...args);};}
        return node;
      };
    }
    const close=ctx.close.bind(ctx);ctx.close=()=>{record.closeCalls++;return close();};return ctx;
  };
}
const observe=page=>page.on('pageerror',e=>report.pageerrors.push(e.stack??e.message));
const snapshot=page=>page.evaluate(()=>({state:a.context?.state??null,voices:a.voices.size,musicVoices:[...a.voices].filter(v=>v.bus==='music').length,sfxVoices:[...a.voices].filter(v=>v.bus==='sfx').length,timer:a.timer!==undefined,contexts:__contexts.map(r=>({state:r.ctx.state,nodes:r.nodes.length,disconnected:r.nodes.filter(n=>n.disconnected).length,closeCalls:r.closeCalls,resumeCalls:r.resumeCalls,resumeCompletions:r.resumeCompletions}))}));
const settled=page=>page.waitForFunction(()=>globalThis.__done===true);
async function unlock(page){
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Runtime.evaluate',{expression:'globalThis.__done=false;',userGesture:false});await cdp.detach();
  await page.locator('#unlock').click();await settled(page);
}
async function blank(){
  const context=await browser.newContext();const page=await context.newPage();observe(page);
  await page.addInitScript(instrument);
  await page.route(origin+'/audio-qa',route=>route.fulfill({contentType:'text/html',body:'<button id="unlock">Unlock</button>'}));
  await page.goto(origin+'/audio-qa');
  const install=async()=>{
    const {AudioManager}=await import('/src/audio/AudioManager.ts');globalThis.AudioManager=AudioManager;globalThis.a=new AudioManager();
    document.querySelector('#unlock').onclick=()=>{void a.unlock().then(()=>{globalThis.__done=true;});};
    globalThis.hide=value=>{Object.defineProperty(document,'hidden',{configurable:true,value});document.dispatchEvent(new Event('visibilitychange'));};
  };
  const cdp=await context.newCDPSession(page);
  await cdp.send('Runtime.evaluate',{expression:`(${install.toString()})()`,awaitPromise:true,userGesture:false});
  await cdp.detach();return {context,page};
}
try{
  if(production){
    const context=await browser.newContext(),page=await context.newPage();observe(page);await page.addInitScript(instrument);
    await page.goto(origin);const flags=await (await page.request.get(origin+'/build-info.json')).json();
    assert.deepEqual(flags,{testTools:false,androidTestAds:false,androidTestBilling:false});report.flags=flags;
    await page.locator('#guide-skip').click();await page.waitForFunction(()=>__contexts[0]?.ctx.state==='running');
    assert.equal(await page.locator('#test-level-button').count(),0);
    await page.locator('#settings-button').click();await page.locator('#music-toggle').click();await page.locator('#sfx-toggle').click();await page.reload();
    await page.locator('#settings-button').click();assert.equal(await page.locator('#music-toggle').getAttribute('aria-checked'),'false');assert.equal(await page.locator('#sfx-toggle').getAttribute('aria-checked'),'false');
    await page.locator('#music-toggle').click();await page.locator('#sfx-toggle').click();await page.locator('#settings-button').click();
    await page.waitForFunction(()=>__contexts.at(-1)?.ctx.state==='running');
    await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
    await page.waitForFunction(()=>__contexts.at(-1).ctx.state==='suspended');
    await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});await page.waitForFunction(()=>__contexts.at(-1).ctx.state==='running');
    for(const language of ['ko','en'])for(const viewport of [{width:320,height:568},{width:640,height:360}]){
      await page.setViewportSize(viewport);await page.locator('#settings-button').click();await page.locator('#language').selectOption(language);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      report.layouts.push({language,viewport});await page.locator('#settings-button').click();
    }
    report.checks.push('production 3 flags false·시험 선택 UI 없음','실제 gesture unlock·설정 OFF 저장/복원·visibility 주입 복귀','KO/EN 320×568·640×360 설정 4개 표본');
    await context.close();assert.deepEqual(report.pageerrors,[]);report.checks.push('pageerror 0');
  }else{
  // CDP userGesture:false is essential: Playwright evaluate may itself enable activation.
  const pending=await blank();const cdp=await pending.context.newCDPSession(pending.page);
  await cdp.send('Runtime.evaluate',{expression:'a.suspend();a.unlock().then(()=>a.resume());',userGesture:false});
  // Initialize while paused, then automatic resume without browser user activation.
  await pending.page.waitForTimeout(150);
  const blocked=await cdp.send('Runtime.evaluate',{expression:'JSON.stringify({state:a.context.state,done:__contexts[0].resumeCompletions>0,resumeCalls:__contexts[0].resumeCalls,hasBeenActive:navigator.userActivation.hasBeenActive})',returnByValue:true,userGesture:false});
  assert.deepEqual(JSON.parse(blocked.result.value),{state:'suspended',done:false,resumeCalls:1,hasBeenActive:false});
  await unlock(pending.page);await pending.page.waitForFunction(()=>a.context.state==='running'&&a.timer!==undefined);
  assert.equal((await snapshot(pending.page)).contexts[0].resumeCalls,2);
  report.samples.push({label:'autoplay pending → 실제 click unlock',before:JSON.parse(blocked.result.value),after:await snapshot(pending.page)});
  await pending.page.evaluate(()=>a.destroy());await cdp.detach();await pending.context.close();report.checks.push('CDP userGesture:false의 실제 pending resume 뒤 click unlock 복구');

  const {page,context}=await blank();assert.equal((await snapshot(page)).contexts.length,0);await unlock(page);
  await page.evaluate(()=>{a.play('special');const ctx=a.context;globalThis.analyser=ctx.createAnalyser();a.outputNodes.at(-1).connect(analyser);});
  await page.waitForTimeout(160);
  const signal=await page.evaluate(()=>{const data=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(data);return Math.sqrt(data.reduce((n,x)=>n+x*x,0)/data.length);});
  assert(signal>0);report.samples.push({label:'첫 실제 click·실시간 출력',rms:signal,...await snapshot(page)});report.checks.push('첫 gesture 지연 생성·실제 Web Audio 신호');
  await page.evaluate(()=>{a.setMusicEnabled(false);a.setSfxEnabled(false);});await page.waitForTimeout(120);
  const silent=await page.evaluate(()=>{const data=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(data);return Math.max(...data.map(Math.abs));});
  assert.equal(silent,0);assert.equal((await snapshot(page)).voices,0);report.checks.push('음악/SFX OFF의 실시간 출력 0·자연 종료 노드 해제');
  await page.evaluate(()=>{analyser.disconnect();a.setMusicEnabled(true);a.setSfxEnabled(true);a.play('win');hide(true);a.suspend();hide(false);});
  await page.waitForFunction(()=>a.context.state==='suspended');assert.equal((await snapshot(page)).voices,0);assert.equal((await snapshot(page)).timer,false);
  await page.evaluate(()=>{hide(true);a.resume();});assert.equal((await snapshot(page)).state,'suspended');
  await page.evaluate(()=>hide(false));await page.waitForFunction(()=>a.context.state==='running'&&a.timer!==undefined);
  assert.equal((await snapshot(page)).sfxVoices,0);report.checks.push('visibility 주입+explicit pause 중첩·과거 SFX 재생 0');
  await page.evaluate(async()=>{globalThis.old=a.context;globalThis.stale=old.onstatechange;a.setMusicEnabled(false);a.setSfxEnabled(false);await old.close();a.resume();});
  assert.equal((await snapshot(page)).contexts.length,1);await unlock(page);const recovered=await snapshot(page);
  assert.equal(recovered.contexts.length,2);assert.equal(recovered.timer,false);assert.equal(recovered.voices,0);
  assert.equal(await page.evaluate(()=>a.musicEnabled||a.sfxEnabled),false);
  await page.evaluate(()=>{a.setMusicEnabled(true);a.setSfxEnabled(true);stale();});assert.equal((await snapshot(page)).timer,true);
  report.samples.push({label:'closed → 명시적 unlock, OFF 보존',...recovered});report.checks.push('외부 close는 자동 재생성하지 않음·다음 click 재생성·OFF 보존·이전 이벤트 무시');
  await page.evaluate(()=>{a.suspend();});await page.waitForFunction(()=>a.context.state==='suspended');
  let stopped=await snapshot(page);assert.equal(stopped.voices,0);assert.equal(stopped.timer,false);report.samples.push({label:'중단 자원 정리',...stopped});
  await page.evaluate(()=>{a.destroy();a.destroy();a.resume();stale();});await page.waitForFunction(()=>__contexts.every(r=>r.ctx.state==='closed'));
  const destroyed=await snapshot(page);assert.equal(destroyed.timer,false);assert.equal(destroyed.voices,0);
  assert(destroyed.contexts.every(r=>r.nodes===r.disconnected));report.samples.push({label:'destroy 자원 정리',...destroyed});report.checks.push('중단 음성/타이머 정리·destroy 전체 노드 disconnect와 모든 context closed');await context.close();

  for(const failure of [1,2,3,4,5,6,7,'curve','connect']){
    const qa=await blank();await qa.page.evaluate(failure=>{__failure=failure;},failure);await unlock(qa.page);
    await qa.page.waitForFunction(()=>__contexts.every(r=>r.ctx.state==='closed'));
    const failed=await snapshot(qa.page);assert.equal(failed.state,null);assert.equal(failed.timer,false);assert(failed.contexts.every(r=>r.disconnected===r.nodes));
    await unlock(qa.page);assert.equal((await snapshot(qa.page)).state,'running');
    report.samples.push({label:`부분 init 실패 ${failure}`,failed,retried:await snapshot(qa.page)});
    await qa.page.evaluate(()=>a.destroy());await qa.page.waitForFunction(()=>__contexts.every(r=>r.ctx.state==='closed'));await qa.context.close();
  }report.checks.push('실제 생성 7단계·curve setter·connect 오류 주입: 정리/close 및 다음 click 복구 9개');

  // Real AudioContext operations with delayed promise delivery, distinct from OS interruption.
  for(const operation of ['resume','suspend','close']){
    const qa=await blank();await unlock(qa.page);
    await qa.page.evaluate(async operation=>{
      const ctx=a.context;globalThis.stale=ctx.onstatechange;
      if(operation==='resume')await ctx.suspend();
      const native=ctx[operation].bind(ctx);globalThis.delivered=false;
      ctx[operation]=()=>{const work=native();return work.then(()=>new Promise(resolve=>{globalThis.release=()=>{delivered=true;resolve();};}));};
      if(operation==='resume')a.resume();else if(operation==='suspend')a.suspend();
      if(operation==='close')a.destroy();
    },operation);
    await qa.page.waitForFunction(()=>typeof release==='function');await qa.page.evaluate(()=>{a.destroy();release();stale();a.resume();});
    await qa.page.waitForTimeout(60);const result=await snapshot(qa.page);assert.equal(result.timer,false);assert.equal(result.voices,0);assert(result.contexts.every(r=>r.nodes===r.disconnected));
    report.samples.push({label:`destroy 뒤 실제 ${operation}의 Promise 완료 지연`,...result});await qa.context.close();
  }report.checks.push('실제 resume/suspend/close의 Promise 전달 지연: destroy 뒤 부활 없음');

  const app=await browser.newContext({viewport:{width:320,height:568}}),p=await app.newPage();observe(p);
  await p.addInitScript(instrument);
  await p.route('**/src/main.ts*',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text())+'\nwindow.__qa={audio,get scene(){return scene},setActive(value){nativeActive=value;syncActivity()}};'});});
  await p.goto(origin);await p.locator('#guide-skip').click();await p.waitForFunction(()=>__qa.scene.sys.isActive());
  await p.locator('#settings-button').click();await p.locator('#music-toggle').click();await p.locator('#sfx-toggle').click();
  let save=await p.evaluate(()=>JSON.parse(localStorage.getItem('pawblossom.save.v1')));assert.equal(save.music,false);assert.equal(save.sfx,false);
  await p.evaluate(()=>{__qa.setActive(false);__qa.setActive(true);});assert.equal(await p.evaluate(()=>__qa.scene.sys.isPaused()),true);
  await p.reload();await p.locator('#settings-button').click();assert.equal(await p.locator('#music-toggle').getAttribute('aria-checked'),'false');assert.equal(await p.locator('#sfx-toggle').getAttribute('aria-checked'),'false');
  await p.locator('#music-toggle').click();await p.locator('#sfx-toggle').click();await p.locator('#settings-button').click();await p.locator('#restart').click();
  await p.waitForFunction(()=>__qa.audio.context?.state==='running');
  await p.evaluate(()=>__qa.setActive(false));await p.waitForFunction(()=>__qa.audio.context.state==='suspended');
  assert.equal(await p.evaluate(()=>__qa.audio.voices.size),0);await p.evaluate(()=>__qa.setActive(true));await p.waitForFunction(()=>__qa.audio.context.state==='running');
  report.checks.push('실제 앱 설정 OFF 저장/새로고침 복원·설정 화면 pause gate·nativeActive false/true 연결');
  for(const language of ['ko','en'])for(const viewport of [{width:320,height:568},{width:640,height:360}]){
    await p.setViewportSize(viewport);await p.locator('#settings-button').click();await p.locator('#language').selectOption(language);
    const layout=await p.evaluate(()=>({language:document.documentElement.lang,bodyOverflow:document.documentElement.scrollWidth>innerWidth,
      controls:['music-toggle','sfx-toggle','language','settings-button'].map(id=>{const e=document.getElementById(id),r=e.getBoundingClientRect();return {id,width:r.width,height:r.height,left:r.left,right:r.right};})}));
    assert.equal(layout.language,language);assert.equal(layout.bodyOverflow,false);assert(layout.controls.every(r=>r.width>=44&&r.height>=44&&r.left>=0&&r.right<=viewport.width));
    const image=`docs/audio/recovery-${language}-${viewport.width}x${viewport.height}-20261016.png`;await p.screenshot({path:image});
    report.layouts.push({viewport,...layout,image});await p.locator('#settings-button').click();
  }report.checks.push('KO/EN 320×568·640×360 설정 토글/언어·가로 overflow·44px 조작 4개 표본');
  await app.close();assert.deepEqual(report.pageerrors,[]);report.checks.push('pageerror 0');
  }
}catch(error){report.failure=String(error.stack??error);throw error;}
finally{fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');await browser.close();console.log(JSON.stringify({output,checks:report.checks,failure:report.failure},null,2));}
