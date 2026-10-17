import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

// 격리 headless Chrome 전용입니다. native 모드는 SDK가 아닌 IPC 시험 대역입니다.
const built=process.argv.includes('--dist');
const output=process.argv.find(arg=>arg.startsWith('--output='))?.slice(9);
if(output){assert(!fs.existsSync(output),'기존 결과는 덮어쓰지 않습니다.');fs.mkdirSync(output,{recursive:true});}
const artifact=name=>output?path.join(output,name):`docs/screenshots/${name}`;
const buildInfo=built?JSON.parse(fs.readFileSync('dist/build-info.json','utf8')):null;
const {chromium}=await import(pathToFileURL(process.env.PAWBLOSSOM_PLAYWRIGHT_MODULE).href);
let server;
if(built){
  server=http.createServer((request,response)=>{
    const url=new URL(request.url,'http://localhost');const file=path.resolve('dist','.'+(url.pathname==='/'?'/index.html':url.pathname));
    if(!file.startsWith(path.resolve('dist')+path.sep)||!fs.existsSync(file)){response.writeHead(404).end();return;}
    const types={'.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.woff':'font/woff','.woff2':'font/woff2','.html':'text/html'};
    response.setHeader('Content-Type',types[path.extname(file)]??'application/octet-stream');fs.createReadStream(file).pipe(response);
  });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
}
const origin=built?`http://127.0.0.1:${server.address().port}`:(process.env.PAWBLOSSOM_QA_ORIGIN??'http://127.0.0.1:5173');
const browser=await chromium.launch({headless:true,channel:'chrome'});
const report={dateKst:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul'}).format(new Date()),scope:'격리 Chrome의 IPC 대역. 네이티브 SDK/UMP/OS/Play 실제 검증이 아닙니다.',mode:built?`dist ${fs.readFileSync('dist/build-info.json','utf8').trim()}`:'testing 소스 + Android IPC 대역',browser:browser.version(),checks:[],layouts:[],errors:[],external:[],hashes:Object.fromEntries(['src/testAds.ts','src/main.ts','src/style.css','scripts/test-ads-qa.mjs','android/app/src/debug/java/com/choidaeyoung/pawblossompuzzle/TestAdsPlugin.java','android/app/src/debug/java/com/choidaeyoung/pawblossompuzzle/RewardLedger.java',...(built?['dist/build-info.json',...fs.readdirSync('dist/assets').filter(f=>/\.(js|css)$/.test(f)).map(f=>'dist/assets/'+f)]:[])].map(file=>[file,createHash('sha256').update(fs.readFileSync(file)).digest('hex')]))};
async function open(native=false,language='ko'){
  const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();
  page.on('pageerror',e=>report.errors.push(e.message));
  page.on('request',request=>{if(!request.url().startsWith(origin)&&!request.url().startsWith('data:')&&!request.url().startsWith('blob:'))report.external.push(request.url());});
  await page.addInitScript(({native,language})=>{
    const Audio=window.AudioContext;window.__contexts=[];
    window.AudioContext=function(options){const context=new Audio(options);window.__contexts.push(context);return context;};
    localStorage.setItem('pawblossom.save.v1',JSON.stringify({version:1,language,highestLevel:1,completed:[],stars:0,coins:0,garden:0,music:true,sfx:true,tutorialSeen:true}));
    window.__adCalls=[];window.__adListeners=new Map();window.__adFailCancel=false;window.__adState={bridgeVersion:3,receipt:null,format:'interstitial',rewardEvents:0,available:true,state:'idle',revision:0,error:'',privacyRequired:false};
    window.__billing={available:true,configured:true,state:'idle',entitlement:'not-owned',revision:0,error:'',price:'',overlay:false,adsBlocked:false,preparingPurchase:false};
    window.__billingEmit=patch=>{window.__billing={...window.__billing,...patch,revision:window.__billing.revision+1};for(const {plugin,event,callback} of __adListeners.values())if(plugin==='PawblossomTestBilling'&&event==='stateChange')callback({...__billing});};
    window.__app=active=>{for(const {plugin,event,callback} of __adListeners.values())if(plugin==='App'&&event==='appStateChange')callback({isActive:active});};
    window.__adEmit=patch=>{window.__adState={...window.__adState,...patch,revision:window.__adState.revision+1};for(const {plugin,event,callback} of window.__adListeners.values())if(plugin==='PawblossomTestAds'&&event==='stateChange')callback({...window.__adState});return {...window.__adState};};
    if(!native)return;
    window.androidBridge={};let callbackId=0;
    const headers=(name,methods)=>({name,methods:[...methods.map(name=>({name,rtype:'promise'})),{name:'addListener',rtype:'callback'},{name:'removeListener',rtype:'promise'}]});
    window.Capacitor={PluginHeaders:[headers('App',['getState','minimizeApp']),headers('PawblossomTestBilling',['getStatus','queryProduct','purchase','restore']),headers('PawblossomTestAds',['getStatus','prepare','show','cancel','privacyOptions','selectFormat'])],
      nativeCallback(plugin,method,options,callback){const id=String(++callbackId);window.__adListeners.set(id,{plugin,event:options.eventName,callback});return Promise.resolve(id);},
      async nativePromise(plugin,method,options){
        if(method==='removeListener'){window.__adListeners.delete(options.callbackId);return;}
        if(plugin==='App')return {isActive:true};
        if(plugin==='PawblossomTestBilling')return {...window.__billing};
        window.__adCalls.push(method);
        if(method==='getStatus')return {...window.__adState};
        if(method==='cancel'&&window.__adFailCancel)throw Error('QA cancel IPC failure');
        if(method==='selectFormat')return window.__adEmit({state:'idle',format:options.format});
        return window.__adEmit({state:{prepare:'consent',show:'presenting',cancel:'cancelled',privacyOptions:'privacy'}[method],error:''});
      },
    };
  },{native,language});
  if(!built){
    await page.routeWebSocket('**',socket=>socket.close());
    await page.route('**/src/main.ts*',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text())+'\nwindow.__qa={get scene(){return scene},get game(){return game},get audio(){return audio},get ads(){return testAds},syncActivity,switchView,closeAdDialog};'});});
  }
  await page.goto(origin);await page.waitForSelector('canvas');
  await page.waitForTimeout(150);
  return {context,page};
}
try{
  for(const native of built&&!buildInfo.androidTestAds?[false,true]:[false]){
    const {context,page}=await open(native);await page.locator('#settings-button').click();
    assert.equal(await page.locator('#test-ad-button').count(),0);assert.deepEqual(await page.evaluate(()=>__adCalls),[]);
    report.checks.push(`${native?'Android IPC 대역':'실제 웹 플랫폼'}: 설정 광고 진입 없음·광고 IPC 0회`);await context.close();
  }
  if(!built||buildInfo.androidTestAds){
    const {context,page}=await open(true);
    await page.locator('#settings-button').click();assert.deepEqual(await page.evaluate(()=>__adCalls),[]);
    await page.locator('#test-ad-button').click();await page.waitForFunction(()=>__adCalls.includes('getStatus'));
    assert.deepEqual(await page.evaluate(()=>__adCalls),['getStatus']);
    const before=await page.evaluate(()=>localStorage.getItem('pawblossom.save.v1'));
    for(const viewport of [{width:320,height:568},{width:360,height:640},{width:640,height:360}])for(const language of ['ko','en'])for(const format of ['interstitial','rewarded']){
      await page.setViewportSize(viewport);await page.evaluate(language=>{document.querySelector('#test-ad-close').click();document.querySelector('#language').value=language;document.querySelector('#language').dispatchEvent(new Event('change'));document.querySelector('#test-ad-button').click();},language);
      await page.locator('#test-ad-format').selectOption(format);
      for(const state of ['idle','consent','privacy','loading','ready','presenting','showing','closed','failed','cancelled']){
        await page.evaluate(state=>__adEmit({state,error:state==='failed'?'consent-blocked':'',privacyRequired:true}),state);
        const layout=await page.locator('#test-ad-dialog').evaluate(dialog=>{
          const r=dialog.getBoundingClientRect();const controls=[...dialog.querySelectorAll('button,select')].filter(b=>b.checkVisibility()).map(b=>({id:b.id,w:b.getBoundingClientRect().width,h:b.getBoundingClientRect().height}));
          return {fits:r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth,scroll:dialog.scrollHeight>dialog.clientHeight+1,controls};
        });assert.equal(layout.fits,true);assert.ok(layout.controls.every(b=>b.w>=43.9&&b.h>=43.9));
        await page.locator('#test-ad-close').scrollIntoViewIfNeeded();
        assert.equal(await page.locator('#test-ad-close').evaluate(b=>{const r=b.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;}),true);
        assert.equal(await page.locator('#test-ad-format').isDisabled(),['consent','privacy','loading','ready','presenting','showing'].includes(state));
        report.layouts.push({viewport,language,format,state,...layout});
      }
      if(viewport.width===320&&language==='ko')await page.screenshot({path:artifact(`test-ad-${format}-ko.png`)});
      if(viewport.width===640&&language==='en')await page.screenshot({path:artifact(`test-ad-${format}-landscape-en.png`)});
    }
    await page.evaluate(()=>__adEmit({state:'idle',error:''}));
    await page.locator('#test-ad-load').dblclick();assert.equal(await page.evaluate(()=>__adCalls.filter(x=>x==='prepare').length),1);
    await page.evaluate(()=>__adEmit({state:'ready'}));assert.equal(await page.evaluate(()=>__adCalls.includes('show')),false);
    await page.evaluate(()=>{__adFailCancel=true;});await page.locator('#test-ad-close').click();assert.equal(await page.locator('#test-ad-dialog').evaluate(d=>d.open),true);
    await page.evaluate(()=>{__adFailCancel=false;});await page.locator('#test-ad-close').click();assert.equal(await page.locator('#test-ad-dialog').evaluate(d=>d.open),false);
    await page.locator('#test-ad-button').click();await page.locator('#test-ad-load').click();await page.evaluate(()=>__adEmit({state:'ready'}));await page.locator('#test-ad-show').dblclick();
    assert.equal(await page.evaluate(()=>__adCalls.filter(x=>x==='show').length),1);
    await page.evaluate(()=>__adEmit({state:'showing'}));assert.equal(await page.locator('#game-canvas').getAttribute('tabindex'),'-1');
    await page.waitForFunction(()=>__contexts.at(-1)?.state==='suspended');
    await page.evaluate(()=>__adEmit({state:'closed'}));assert.equal(await page.locator('#game-canvas').getAttribute('tabindex'),'-1');
    await page.locator('#test-ad-close').click();await page.locator('#settings-button').click();await page.waitForFunction(()=>document.querySelector('#game-canvas').tabIndex===0);
    const after=await page.evaluate(()=>JSON.parse(localStorage.getItem('pawblossom.save.v1'))),prior=JSON.parse(before);
    for(const key of ['stars','coins','completed','highestLevel','inProgress','music','sfx'])assert.deepEqual(after[key],prior[key]);
    assert.equal(await page.evaluate(()=>[...__adListeners.values()].filter(x=>x.plugin==='PawblossomTestAds').length),1);
    for(const format of ['interstitial','rewarded']){
      await page.locator('#settings-button').click();await page.locator('#test-ad-button').click();
      await page.locator('#test-ad-format').selectOption(format);
      assert.equal(await page.locator('#test-ad-format').inputValue(),format);
      await page.locator('#test-ad-format').focus();assert.equal(await page.locator('#test-ad-format').evaluate(el=>document.activeElement===el),true);
      assert.ok((await page.locator('#test-ad-format').getAttribute('id'))==='test-ad-format');
      const baseline=await page.evaluate(()=>localStorage.getItem('pawblossom.save.v1'));
      const count=await page.evaluate(()=>__adState.rewardEvents);
      for(const patch of [{state:'failed',error:'consent-blocked'},{state:'failed',error:'load:2'},{state:'failed',error:'timeout'},{state:'cancelled',error:''}]){
        await page.locator('#test-ad-load').click();await page.evaluate(patch=>__adEmit(patch),patch);
        assert.equal(await page.evaluate(()=>__adState.rewardEvents),count);assert.equal(await page.locator('#test-ad-show').isDisabled(),true);
      }
      // 이전 revision의 준비/보상 숫자를 주입합니다. 이는 네이티브 SDK 콜백 재현이 아닙니다.
      await page.evaluate(()=>{const old={...__adState,state:'ready',rewardEvents:__adState.rewardEvents+50,revision:__adState.revision-1};for(const {plugin,callback} of __adListeners.values())if(plugin==='PawblossomTestAds')callback(old);});
      assert.match(await page.locator('#test-ad-events').textContent(),new RegExp(`: ${count} ·`));
      await page.locator('#test-ad-load').click();await page.locator('#test-ad-cancel').click();
      await page.locator('#test-ad-load').click();await page.evaluate(()=>__adEmit({state:'ready',error:''}));
      for(const entitlement of ['unknown','pending','owned']){
        await page.evaluate(entitlement=>__billingEmit({entitlement,adsBlocked:true}),entitlement);
        assert.equal(await page.locator('#test-ad-load').isDisabled(),true);assert.equal(await page.locator('#test-ad-show').isDisabled(),true);
      }
      await page.evaluate(()=>__billingEmit({entitlement:'not-owned',adsBlocked:false}));
      await page.evaluate(()=>__app(false));assert.equal(await page.locator('#test-ad-show').isDisabled(),true);
      await page.evaluate(()=>__app(true));await page.locator('#test-ad-show').click();
      await page.evaluate(()=>__adEmit({state:'showing'}));
      await page.keyboard.press('Escape');await page.evaluate(()=>{for(const {plugin,event,callback} of __adListeners.values())if(plugin==='App'&&event==='backButton')callback({});});
      assert.equal(await page.locator('#test-ad-dialog').evaluate(d=>d.open),true);assert.equal(await page.locator('#test-ad-close').isDisabled(),true);
      assert.equal(await page.locator('#test-ad-format').isDisabled(),true);await page.waitForFunction(()=>__contexts.at(-1).state==='suspended');
      if(format==='rewarded'){
        await page.evaluate(()=>__adEmit({rewardEvents:__adState.rewardEvents+1}));
        await page.evaluate(()=>{for(const {plugin,callback} of __adListeners.values())if(plugin==='PawblossomTestAds')callback({...__adState});});
      }
      const expected=count+(format==='rewarded'?1:0);
      assert.match(await page.locator('#test-ad-events').textContent(),new RegExp(`: ${expected} ·`));
      await page.evaluate(()=>{__app(false);__adEmit({state:'closed'});});await page.locator('#test-ad-close').click();
      await page.waitForFunction(()=>__contexts.at(-1).state==='suspended');await page.evaluate(()=>__app(true));
      await page.locator('#settings-button').click();await page.waitForFunction(()=>__contexts.at(-1).state==='running');
      await page.waitForFunction(()=>document.querySelector('#game-canvas').tabIndex===0);
      assert.equal(await page.evaluate(()=>localStorage.getItem('pawblossom.save.v1')),baseline);
      report.checks.push(`${format}: 실패/동의거부/timeout/취소 snapshot·역순보상무시·billing unknown/pending/owned 차단·비활성 show 차단·Escape/back overlay 보존·중복 snapshot·SDK callback수 표시 대역·AudioContext suspend/resume·보드복귀·광고구간 저장 byte 불변`);
    }
    await page.locator('#settings-button').click();await page.locator('#test-ad-button').click();
    const count=await page.evaluate(()=>__adState.rewardEvents);
    await page.evaluate(()=>{for(const {plugin,callback} of __adListeners.values())if(plugin==='PawblossomTestAds')callback({...__adState,bridgeVersion:1,revision:__adState.revision+1,rewardEvents:99});});
    assert.equal(await page.locator('#test-ad-load').isDisabled(),true);assert.match(await page.locator('#test-ad-events').textContent(),new RegExp(`: ${count} ·`));
    await page.evaluate(()=>{__app(false);__app(true);});assert.equal(await page.locator('#test-ad-load').isDisabled(),false);
    await page.locator('#test-ad-close').click();await page.reload();await page.locator('#settings-button').click();await page.locator('#test-ad-button').click();
    assert.match(await page.locator('#test-ad-events').textContent(),/: 0 ·/);assert.equal(await page.locator('#test-ad-format').inputValue(),'interstitial');
    report.checks.push('구형 snapshot 차단·return getStatus 복구·새 브리지 실행 수0/기본전면·비영속');
    report.checks.push('Android IPC 대역: 초기 요청 0회·명시적 load/show·중복 탭 각 1회·취소 실패 모달 유지·재시도 성공·닫힘 후 보드 복귀·게임 저장/음량 보존·리스너 1개','3개 비율×KO/EN×2형식×10상태: dialog 화면 내 배치·44px 버튼/select');
    await context.close();
  }
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.external,[]);
}finally{
  fs.writeFileSync(output?path.join(output,'report.json'):`docs/performance/test-ads-${built?(buildInfo.androidTestAds?'testing-web':'production'):'ipc'}-20261015.json`,JSON.stringify(report,null,2)+'\n');
  await browser.close();if(server)await new Promise(resolve=>server.close(resolve));
}
console.log(JSON.stringify({mode:report.mode,checks:report.checks,layouts:report.layouts.length,errors:report.errors,external:report.external}));
