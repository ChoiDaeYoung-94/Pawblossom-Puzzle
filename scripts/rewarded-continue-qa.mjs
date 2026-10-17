import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';

// 합성 실패 준비(onMove 이동 축소)와 실제 canvas 입력을 분리해 기록합니다.
// dist 응답에 Game 관찰 참조만 추가하며 사용자 Chrome/서버/출시 파일은 바꾸지 않습니다.
const output=process.argv.find(arg=>arg.startsWith('--output='))?.slice(9);
assert(output,'--output=새 결과 폴더가 필요합니다.');
await fs.mkdir(output,{recursive:false});
const root=path.resolve('dist'),flags=JSON.parse(await fs.readFile(path.join(root,'build-info.json'),'utf8'));
const variant=flags.testTools?'testing':'production';
const {chromium}=await import(pathToFileURL(process.env.PAWBLOSSOM_PLAYWRIGHT_MODULE).href);
const browser=await chromium.launch({headless:true,channel:'chrome'});
const report={dateKst:'2026-10-17',variant,flags,browser:browser.version(),
  scope:'Android SDK 검증이 아닌 격리 Chrome testing dist + 명시적 native IPC fixture. 실제 광고/UMP/OS overlay 없음. 합성 준비는 고정 seed42 엔진/보드와 기존 낙엽을 scene에 주입·paint한 뒤 onMove로 이동을1로 줄이거나 목표를 채움. 실제 앱 목표/판정은 변경하지 않음. 실패 직전/이어하기 후 플레이는 실제 canvas 마우스 입력. 광고/Android/실서비스 검증 아님.',
  cases:[],boundaries:[],pageerrors:[],hashes:{}};
for(const file of ['src/main.ts','src/testAds.ts','src/i18n.ts','src/style.css','android/app/src/debug/java/com/choidaeyoung/pawblossompuzzle/TestAdsPlugin.java','android/app/src/debug/java/com/choidaeyoung/pawblossompuzzle/RewardLedger.java','dist/build-info.json',...(await fs.readdir('dist/assets')).filter(f=>/\.(js|css)$/.test(f)).map(f=>'dist/assets/'+f)])report.hashes[file]=createHash('sha256').update(await fs.readFile(file)).digest('hex');
async function open(language,viewport){
  const context=await browser.newContext({viewport,reducedMotion:'reduce'}),page=await context.newPage();
  page.setDefaultTimeout(10000);page.on('pageerror',e=>report.pageerrors.push(e.message));
  await context.addInitScript(language=>{
    localStorage.setItem('pawblossom.save.v1',JSON.stringify({version:1,language,highestLevel:1,completed:[],stars:0,coins:0,garden:0,music:false,sfx:false,tutorialSeen:true}));
    window.androidBridge={};window.__listeners=new Map();window.__calls=[];
    window.__ad={bridgeVersion:3,available:true,state:'idle',revision:0,error:'',privacyRequired:false,format:'interstitial',rewardEvents:0,receipt:null};
    window.__billing={available:true,configured:true,state:'idle',entitlement:'not-owned',revision:0,error:'',price:'',overlay:false,adsBlocked:false,preparingPurchase:false};
    window.__active=true;window.__ipcFailure=false;window.__attempt=0;
    window.__emit=patch=>{window.__ad={...__ad,...patch,revision:__ad.revision+1};for(const {plugin,event,callback} of __listeners.values())if(plugin==='PawblossomTestAds'&&event==='stateChange')callback({...__ad});return {...__ad};};
    window.__app=active=>{__active=active;for(const {plugin,event,callback} of __listeners.values())if(plugin==='App'&&event==='appStateChange')callback({isActive:active});};
    window.__bill=patch=>{__billing={...__billing,...patch,revision:__billing.revision+1};for(const {plugin,event,callback} of __listeners.values())if(plugin==='PawblossomTestBilling'&&event==='stateChange')callback({...__billing});};
    let listener=0;
    const header=(name,methods)=>({name,methods:[...methods.map(name=>({name,rtype:'promise'})),{name:'addListener',rtype:'callback'},{name:'removeListener',rtype:'promise'}]});
    window.Capacitor={PluginHeaders:[header('App',['getState','minimizeApp']),header('PawblossomTestAds',['getStatus','selectFormat','prepare','show','cancel','privacyOptions']),header('PawblossomTestBilling',['getStatus','queryProduct','purchase','restore'])],
      nativeCallback(plugin,method,options,callback){const id=String(++listener);__listeners.set(id,{plugin,event:options.eventName,callback});return Promise.resolve(id);},
      async nativePromise(plugin,method,options){
        if(method==='removeListener'){__listeners.delete(options.callbackId);return;}
        if(plugin==='App')return {isActive:__active};if(plugin==='PawblossomTestBilling')return {...__billing};
        __calls.push({method,options});if(__ipcFailure)throw Error('QA IPC unavailable');
        if(method==='getStatus')return {...__ad};
        if(method==='selectFormat')return __emit({state:'idle',format:options.format,receipt:null});
        if(method==='show')return __emit({state:'presenting',receipt:{requestId:options.requestId,attemptId:String(++__attempt),earned:false,closed:false}});
        return __emit({state:{prepare:'loading',cancel:'cancelled',privacyOptions:'privacy'}[method],receipt:null,error:''});
      }
    };
  },language);
  await page.route('http://localhost:19795/**',async route=>{
    const url=new URL(route.request().url()),file=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));
    assert.ok(file.startsWith(root+path.sep));
    if(file.endsWith('.js')){
      let source=await fs.readFile(file,'utf8');const calls=source.match(/new [\w$.]+\.Game\(\{type:/g)??[];
      if(calls.length){assert.equal(calls.length,1);source=source.replace(calls[0],'window.__continueGame='+calls[0]);}
      await route.fulfill({body:source,contentType:'text/javascript'});
    }else await route.fulfill({path:file});
  });
  await page.goto('http://localhost:19795');
  await page.waitForFunction(()=>__continueGame?.scene.isActive('Board')&&document.querySelector('canvas'));
  await seedScene(page);
  return {page,context};
}
const disk=page=>page.evaluate(()=>Object.keys(localStorage).sort().map(key=>[key,localStorage.getItem(key)]));
const ready=page=>page.waitForFunction(()=>__continueGame.scene.getScene('Board')?.keyboardState().available);
async function seedScene(page){
  await page.evaluate(()=>{
    let state=42;
    const rng=()=>{state=(state+0x6d2b79f5)>>>0;let v=state;v=Math.imul(v^(v>>>15),v|1);v^=v+Math.imul(v^(v>>>7),v|61);return ((v^(v>>>14))>>>0)/4294967296;};
    const scene=__continueGame.scene.getScene('Board'),leaves=scene.engine.leaves.map(row=>row.slice());
    scene.engine=new scene.engine.constructor(8,8,rng);scene.engine.leaves=leaves;
    scene.paint(scene.engine.board);scene.paintLeaves(scene.engine.leaves);
  });
}
async function testLevel(page,id=6){
  await page.locator('#test-level-button').click();await page.locator(`[data-test-level="${id}"]`).click();await ready(page);await seedScene(page);
}
async function prepareLastMove(page){
  await page.evaluate(()=>{
    const scene=__continueGame.scene.getScene('Board'),moves=Number(document.querySelector('#moves').textContent);
    for(let i=0;i<moves-1;i++)scene.hooks.onMove([0,0,0,0,0,0],0,1,0);
  });
  assert.equal(await page.locator('#moves').textContent(),'1');
}
async function play(page){
  const move=await page.evaluate(()=>{
    const scene=__continueGame.scene.getScene('Board'),move=scene.engine.legalMoves()[0];
    return {...move,special:Boolean(scene.engine.board[move.a.row][move.a.col].special)};
  });assert.ok(move);
  const before=Number(await page.locator('#moves').textContent());
  const box=await page.locator('canvas').boundingBox();assert.ok(box&&box.width>0&&box.height>0);
  const click=async p=>page.mouse.click(box.x+(44+p.col*56)/480*box.width,box.y+(44+p.row*56)/480*box.height);
  await click(move.a);if(!move.special)await click(move.b);
  await page.waitForFunction(before=>Number(document.querySelector('#moves').textContent)===before-1,before);
  await page.waitForFunction(()=>!__continueGame.scene.getScene('Board').busy);
}
const result=page=>page.locator('#result-dialog[open]').waitFor();
async function inspect(page){
  return page.evaluate(()=>{
    const dialog=document.querySelector('#result-dialog'),rect=dialog.getBoundingClientRect();
    const buttons=[...dialog.querySelectorAll('button')].map(b=>{const r=b.getBoundingClientRect();return {id:b.id,x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right};});
    return {dialog:{x:rect.x,y:rect.y,right:rect.right,bottom:rect.bottom},client:dialog.clientHeight,height:dialog.scrollHeight,body:document.documentElement.scrollHeight,viewport:innerHeight,buttons};
  });
}
async function checkLayout(page,viewport){
  const data=await inspect(page);assert.ok(data.dialog.x>=0&&data.dialog.y>=0&&data.dialog.right<=viewport.width+1&&data.dialog.bottom<=viewport.height+1);
  assert.ok(data.body<=viewport.height,'body 스크롤 없음');
  assert.equal(await page.evaluate(()=>scrollX===0&&scrollY===0),true);
  for(let i=0;i<data.buttons.length;i++){
    const b=data.buttons[i];assert.ok(b.width>=44&&b.height>=44&&b.x>=data.dialog.x&&b.right<=data.dialog.right);
    if(i)assert.ok(data.buttons[i-1].bottom<=b.y+.5,'버튼 겹침 없음');
    await page.locator('#'+b.id).scrollIntoViewIfNeeded();
    const r=await page.locator('#'+b.id).boundingBox(),d=await page.locator('#result-dialog').boundingBox();
    assert.ok(r.y>=d.y&&r.y+r.height<=d.y+d.height+1,'모든 버튼은 모달 내부 스크롤로 접근 가능');
  }
  assert.equal(await page.evaluate(()=>scrollX===0&&scrollY===0),true);return data;
}
async function remember(page){
  await page.evaluate(()=>{
    const scene=__continueGame.scene.getScene('Board');window.__continueBefore={scene,engine:scene.engine,pieces:scene.pieces,items:scene.pieces.flat(),leaves:scene.leafObjects,
      snapshot:JSON.stringify({board:scene.engine.board,leaves:scene.engine.leaves,score:document.querySelector('#score').textContent,goals:document.querySelector('#goals').innerHTML,shuffles:document.querySelector('#shuffle-count').textContent}),
      button:document.querySelector('#result-continue'),callback:document.querySelector('#result-continue').onclick};
  });
}
async function assertPreserved(page){
  assert.equal(await page.evaluate(()=>{
    const b=__continueBefore,s=__continueGame.scene.getScene('Board');
    return s===b.scene&&s.engine===b.engine&&s.pieces===b.pieces&&s.leafObjects===b.leaves&&s.pieces.flat().every((p,i)=>p===b.items[i])
      &&JSON.stringify({board:s.engine.board,leaves:s.engine.leaves,score:document.querySelector('#score').textContent,goals:document.querySelector('#goals').innerHTML,shuffles:document.querySelector('#shuffle-count').textContent})===b.snapshot;
  }),true,'scene/engine/container/보드/낙엽/진척 identity 보존');
}
async function failed(page){await testLevel(page);await prepareLastMove(page);await play(page);await result(page);}
async function load(page){
  const count=await page.evaluate(()=>__calls.filter(c=>c.method==='show').length);
  await page.locator('#result-ad-load').click();await page.waitForFunction(()=>__ad.state==='loading');
  await page.evaluate(()=>__emit({state:'ready'}));
  assert.equal(await page.evaluate(()=>__calls.filter(c=>c.method==='show').length),count,'준비만으로 표시 없음');
}
async function show(page){await load(page);await page.locator('#result-ad-show').click();await page.waitForFunction(()=>__ad.state==='presenting');}
const earn=page=>page.evaluate(()=>__emit({state:'showing',rewardEvents:__ad.rewardEvents+1,receipt:{...__ad.receipt,earned:true}}));
const close=(page,earned=true)=>page.evaluate(earned=>__emit({state:'closed',receipt:{...__ad.receipt,earned,closed:true}}),earned);
try{
  for(const language of ['ko','en'])for(const viewport of [{width:320,height:568},{width:360,height:640},{width:640,height:360}]){
    console.log(`${variant} ${language} ${viewport.width} 보상형 이어하기 fixture`);
    const {page,context}=await open(language,viewport);
    try{
      if(!flags.testTools){
        assert.equal(await page.locator('#test-level-button').count(),0);await prepareLastMove(page);await play(page);await result(page);
        assert.equal(await page.locator('#result-ad-load').count(),0);assert.equal(await page.locator('#result-continue').count(),0);
        assert.equal(await page.evaluate(()=>__calls.length),0);report.cases.push({language,viewport,productionAbsent:true,realFailureInput:true});continue;
      }
      await failed(page);await page.waitForFunction(()=>!document.querySelector('#result-ad-load').disabled);
      const before=await disk(page);await remember(page);const layout=await checkLayout(page,viewport);
      assert.match(await page.locator('#result-ad-note').textContent(),language==='ko'?/완료 후 닫으면.*이동 \+5/:/Complete it, then close it.*\+5 moves/);
      assert.equal(await page.evaluate(()=>__calls.some(c=>['prepare','show'].includes(c.method))),false);
      await page.screenshot({path:path.join(output,`reward-controls-${language}-${viewport.width}.png`)});
      await page.locator('#result-dialog').evaluate(d=>{d.scrollTop=0;});
      await page.screenshot({path:path.join(output,`reward-${language}-${viewport.width}.png`)});
      await show(page);assert.equal(await page.locator('#result-home').isDisabled(),true);
      await earn(page);assert.equal(await page.locator('#moves').textContent(),'0');assert.equal(await page.locator('#result-dialog').evaluate(d=>d.open),true);
      assert.equal(await page.locator('#game-canvas').getAttribute('tabindex'),'-1');await assertPreserved(page);assert.deepEqual(await disk(page),before);
      const receipt=await close(page);await ready(page);assert.equal(await page.locator('#moves').textContent(),'5');await assertPreserved(page);assert.deepEqual(await disk(page),before);
      await page.evaluate(receipt=>__emit(receipt),receipt);assert.equal(await page.locator('#moves').textContent(),'5');
      await play(page);assert.equal(await page.locator('#moves').textContent(),'4');assert.deepEqual(await disk(page),before);
      await prepareLastMove(page);await play(page);await result(page);assert.equal(await page.locator('#result-ad-load').count(),0);assert.equal(await page.locator('#result-continue').count(),0);
      report.cases.push({language,viewport,layout,explicitLoadAndShow:true,earnedAloneNoGrant:true,closedSameBoardPlus5:true,duplicateNoGrant:true,realCanvasInputAfterGrant:true,sharedOneUse:true,storageBytesUnchanged:true});
    }finally{await context.close();}
  }
  if(flags.testTools){
    for(const reason of ['cancel','load-fail','show-fail','no-reward','wrong-request','wrong-attempt','old-revision','contract','ipc','inactive','refresh-first','home','new-round','billing','normal']){
      console.log(`경계 ${reason}`);const {page,context}=await open('ko',{width:360,height:640});
      try{
        if(reason==='normal'){
          await prepareLastMove(page);await play(page);await result(page);assert.equal(await page.locator('#result-ad-load').count(),0);
          report.boundaries.push({reason,absent:true});continue;
        }
        await failed(page);await page.waitForFunction(()=>!document.querySelector('#result-ad-load').disabled);const before=await disk(page);
        if(reason==='cancel'||reason==='load-fail'){
          await load(page);if(reason==='cancel')await page.locator('#result-ad-cancel').click();else await page.evaluate(()=>__emit({state:'failed',receipt:null,error:'load:2'}));
        }else{
          await show(page);const active=await page.evaluate(()=>({...__ad}));
          if(reason==='show-fail')await page.evaluate(()=>__emit({state:'failed',receipt:null,error:'show:2'}));
          else if(reason==='no-reward')await close(page,false);
          else if(reason==='wrong-request'||reason==='wrong-attempt')await page.evaluate(reason=>__emit({state:'closed',rewardEvents:__ad.rewardEvents+1,receipt:{...__ad.receipt,earned:true,closed:true,...(reason==='wrong-request'?{requestId:'manual-request-0000001'}:{attemptId:'999'})}}),reason);
          else if(reason==='old-revision'){
            await page.evaluate(()=>{for(const {plugin,callback} of __listeners.values())if(plugin==='PawblossomTestAds')callback({...__ad,revision:__ad.revision-1,state:'closed',rewardEvents:__ad.rewardEvents+1,receipt:{...__ad.receipt,earned:true,closed:true}});});
            assert.equal(await page.locator('#moves').textContent(),'0');await close(page,false);
          }else if(reason==='contract'){
            await page.evaluate(()=>{for(const {plugin,callback} of __listeners.values())if(plugin==='PawblossomTestAds')callback({...__ad,revision:__ad.revision+1,bridgeVersion:2,state:'closed'});});
            assert.equal(await page.locator('#result-home').isDisabled(),true);await earn(page);await close(page);
          }else if(reason==='ipc'){
            await page.evaluate(()=>{__ipcFailure=true;__app(false);__app(true);});await page.waitForTimeout(40);
            assert.equal(await page.locator('#moves').textContent(),'0');assert.equal(await page.locator('#result-home').isDisabled(),true);
            await page.evaluate(()=>{__ipcFailure=false;});await close(page,false);
          }else if(reason==='inactive'){
            await earn(page);await page.evaluate(()=>__app(false));await close(page);
            assert.equal(await page.locator('#moves').textContent(),'0');assert.equal(await page.locator('#game-canvas').getAttribute('tabindex'),'-1');
            await page.evaluate(()=>__app(true));await ready(page);assert.equal(await page.locator('#moves').textContent(),'5');
          }else if(reason==='refresh-first'){
            // 이번 requestId의 native receipt를 조회에서 먼저 반환하고 늦은 stateChange를 뒤에 보냅니다.
            await page.evaluate(()=>{__ad={...__ad,revision:__ad.revision+2,state:'closed',rewardEvents:__ad.rewardEvents+1,receipt:{...__ad.receipt,earned:true,closed:true}};__app(false);__app(true);});
            await ready(page);assert.equal(await page.locator('#moves').textContent(),'5');await page.evaluate(()=>__emit({...__ad}));
          }else if(reason==='home'||reason==='new-round'){
            // 실제 overlay를 조기 종료하지 않습니다. 무보상 close 후 홈/재시작하고 이전 콜백을 재전달합니다.
            await close(page,false);await page.locator(reason==='home'?'#result-home':'#result-next').click();
            if(reason==='new-round')await ready(page);
            const moves=await page.locator('#moves').textContent();await page.evaluate(active=>__emit({...active,state:'closed',receipt:{...active.receipt,earned:true,closed:true}}),active);
            assert.equal(await page.locator('#moves').textContent(),moves);report.boundaries.push({reason,staleContextNoGrant:true});continue;
          }else if(reason==='billing'){
            await earn(page);await page.evaluate(()=>__bill({entitlement:'pending',adsBlocked:true,state:'idle'}));await close(page);
          }
        }
        const granted=['inactive','refresh-first'].includes(reason);assert.equal(await page.locator('#moves').textContent(),granted?'5':'0');assert.deepEqual(await disk(page),before);
        if(!granted&&reason!=='billing'){
          // 실패·취소·손상은 이번 회차를 소모하지 않습니다. 명시적 새 요청 성공만 지급합니다.
          await page.evaluate(()=>__emit({state:'cancelled',receipt:null}));await show(page);await earn(page);await close(page);await ready(page);
          assert.equal(await page.locator('#moves').textContent(),'5');assert.deepEqual(await disk(page),before);
        }
        report.boundaries.push({reason,initialGrant:granted?5:0,unusedEligibilityPreserved:!granted,storageBytesUnchanged:true});
      }finally{await context.close();}
    }
  }
  assert.deepEqual(report.pageerrors,[]);
}finally{await browser.close();await fs.writeFile(path.join(output,'summary.json'),JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({variant,cases:report.cases.length,boundaries:report.boundaries.length,pageerrors:report.pageerrors},null,2));
