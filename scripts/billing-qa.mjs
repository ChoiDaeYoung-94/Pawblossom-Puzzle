import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';

// Android IPC 대역과 실제 웹 플랫폼을 구분합니다. Play 결제·서명 검증 시험이 아닙니다.
const built=process.argv.includes('--dist');
const info=built?JSON.parse(fs.readFileSync('dist/build-info.json','utf8')):null;
const {chromium}=await import(pathToFileURL(process.env.PAWBLOSSOM_PLAYWRIGHT_MODULE).href);
let server;
if(built){
  server=http.createServer((request,response)=>{
    const url=new URL(request.url,'http://localhost'),file=path.resolve('dist','.'+(url.pathname==='/'?'/index.html':url.pathname));
    if(!file.startsWith(path.resolve('dist')+path.sep)||!fs.existsSync(file)){response.writeHead(404).end();return;}
    const types={'.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.woff':'font/woff','.woff2':'font/woff2','.html':'text/html'};
    response.setHeader('Content-Type',types[path.extname(file)]??'application/octet-stream');fs.createReadStream(file).pipe(response);
  });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
}
const origin=built?`http://127.0.0.1:${server.address().port}`:'http://127.0.0.1:5173';
const browser=await chromium.launch({headless:true,channel:'chrome'});
const report={dateKst:'2026-10-15',mode:built?`dist ${JSON.stringify(info)}`:'testing 소스 + Android IPC 대역',browser:browser.version(),checks:[],layouts:[],errors:[],external:[]};
async function open(native=false,configured=false){
  const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();
  page.on('pageerror',error=>report.errors.push(error.message));
  page.on('request',request=>{if(!request.url().startsWith(origin)&&!request.url().startsWith('data:')&&!request.url().startsWith('blob:'))report.external.push(request.url());});
  await page.addInitScript(({native,configured})=>{
    localStorage.setItem('pawblossom.save.v1',JSON.stringify({version:1,language:'ko',highestLevel:1,completed:[],stars:0,coins:0,garden:0,music:true,sfx:true,tutorialSeen:true,removeAds:true}));
    window.__billingCalls=[];window.__adCalls=[];window.__listeners=new Map();
    window.__billing={available:true,configured,state:'idle',entitlement:'unknown',revision:0,error:configured?'':'unconfigured',price:'',overlay:false,adsBlocked:configured,preparingPurchase:false};
    window.__ads={available:true,state:'idle',revision:0,error:'',privacyRequired:false};
    window.__emitBilling=patch=>{window.__billing={...window.__billing,...patch,revision:window.__billing.revision+1};for(const {plugin,event,callback} of __listeners.values())if(plugin==='PawblossomTestBilling'&&event==='stateChange')callback({...__billing});return {...__billing};};
    window.__emitAd=patch=>{window.__ads={...window.__ads,...patch,revision:window.__ads.revision+1};for(const {plugin,event,callback} of __listeners.values())if(plugin==='PawblossomTestAds'&&event==='stateChange')callback({...__ads});return {...__ads};};
    window.__app=active=>{for(const {plugin,event,callback} of __listeners.values())if(plugin==='App'&&event==='appStateChange')callback({isActive:active});};
    if(!native)return;
    let id=0;window.androidBridge={};
    const header=(name,methods)=>({name,methods:[...methods.map(name=>({name,rtype:'promise'})),{name:'addListener',rtype:'callback'},{name:'removeListener',rtype:'promise'}]});
    window.Capacitor={PluginHeaders:[header('App',['getState','minimizeApp']),header('PawblossomTestBilling',['getStatus','queryProduct','purchase','restore']),header('PawblossomTestAds',['getStatus','prepare','show','cancel','privacyOptions'])],
      nativeCallback(plugin,method,options,callback){const key=String(++id);__listeners.set(key,{plugin,event:options.eventName,callback});return Promise.resolve(key);},
      async nativePromise(plugin,method,options){
        if(method==='removeListener'){__listeners.delete(options.callbackId);return;}
        if(plugin==='App')return {isActive:true};
        if(plugin==='PawblossomTestBilling'){
          __billingCalls.push(method);if(method==='getStatus')return {...__billing};
          if(!__billing.configured)throw Error('QA unconfigured');
          if(method==='queryProduct')return __emitBilling({price:'IPC price',state:'idle',error:''});
          if(method==='purchase')return __emitBilling({state:'purchasing',overlay:true});
          if(method==='restore')return __emitBilling({state:'querying'});
        }
        __adCalls.push(method);if(method==='getStatus')return {...__ads};
        return __emitAd({state:{prepare:'consent',show:'presenting',cancel:'cancelled',privacyOptions:'privacy'}[method]});
      },
    };
  },{native,configured});
  if(!built){
    await page.routeWebSocket('**',socket=>socket.close());
    await page.route('**/src/main.ts*',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text())+'\nwindow.__qa={get game(){return game},get audio(){return audio},get billing(){return testBilling},switchView,syncActivity,showAdDialog,showBillingDialog,closeBillingDialog};'});});
  }
  await page.goto(origin);await page.waitForSelector('canvas');await page.waitForTimeout(150);return {context,page};
}
try{
  for(const native of built&&!info.androidTestBilling?[false,true]:[false]){
    const {context,page}=await open(native);await page.locator('#settings-button').click();
    assert.equal(await page.locator('#test-billing-button').count(),0);assert.equal(await page.locator('#test-billing-dialog').count(),0);
    assert.deepEqual(await page.evaluate(()=>__billingCalls),[]);report.checks.push(`${native?'Android IPC 대역':'실제 웹 플랫폼'}: 결제 진입/모달 없음·Billing IPC 0회`);await context.close();
  }
  if(!built){
    {
      const {context,page}=await open(true,false);await page.waitForFunction(()=>__billingCalls.length===1);assert.deepEqual(await page.evaluate(()=>__billingCalls),['getStatus']);
      await page.locator('#settings-button').click();await page.locator('#test-billing-button').click();
      for(const id of ['buy','product','restore'])assert.equal(await page.locator('#test-billing-'+id).isDisabled(),true);
      assert.equal(await page.locator('#test-billing-buy').textContent(),'광고 제거 구매');
      assert.match(await page.locator('#test-billing-status').textContent(),/구성 미완료/);
      await page.screenshot({path:'docs/screenshots/billing-unconfigured-ko.png'});
      await page.locator('#test-billing-close').click();await page.locator('#test-ad-button').click();await page.locator('#test-ad-load').click();assert.ok((await page.evaluate(()=>__adCalls)).includes('prepare'));
      report.checks.push('Android IPC 미설정 대역: 상태 조회만 1회·가격/구매/복원 비활성·위조 localStorage 무효·기존 시험 광고 load 가능');await context.close();
    }
    const {context,page}=await open(true,true);await page.waitForFunction(()=>__qa.billing?.snapshot.revision===0);
    const before=await page.evaluate(()=>localStorage.getItem('pawblossom.save.v1'));
    await page.evaluate(()=>__emitBilling({state:'querying',adsBlocked:true}));
    assert.equal(await page.evaluate(()=>__qa.game.scene.isActive('Board')),true);
    await page.locator('#settings-button').click();await page.locator('#test-ad-button').click();assert.equal(await page.locator('#test-ad-load').isDisabled(),true);await page.locator('#test-ad-close').click();
    await page.locator('#test-billing-button').click();assert.equal(await page.locator('#test-billing-buy').isDisabled(),true);
    for(const state of ['connecting','products']){
      await page.evaluate(state=>__emitBilling({state,preparingPurchase:true}),state);assert.equal(await page.locator('#test-billing-close').isDisabled(),true);
      await page.keyboard.press('Escape');await page.evaluate(()=>{for(const {plugin,event,callback} of __listeners.values())if(plugin==='App'&&event==='backButton')callback({});});
      assert.equal(await page.locator('#test-billing-dialog').evaluate(d=>d.open),true);
    }
    await page.evaluate(()=>__emitBilling({state:'failed',preparingPurchase:false,error:'timeout'}));assert.equal(await page.locator('#test-billing-close').isDisabled(),false);
    await page.evaluate(()=>__emitBilling({state:'idle',entitlement:'not-owned',adsBlocked:false}));await page.locator('#test-billing-product').click();assert.match(await page.locator('#test-billing-buy').textContent(),/IPC price/);
    await page.locator('#test-billing-buy').dblclick();assert.equal(await page.evaluate(()=>__billingCalls.filter(x=>x==='purchase').length),1);assert.equal(await page.locator('#test-billing-close').isDisabled(),true);
    await page.evaluate(()=>{__app(false);__emitBilling({state:'idle',overlay:false,entitlement:'pending',adsBlocked:true});__app(true);});
    assert.equal(await page.locator('#test-billing-buy').isDisabled(),true);assert.equal(await page.evaluate(()=>__qa.game.scene.isPaused('Board')),true);
    await page.evaluate(()=>__emitBilling({entitlement:'owned',error:'ack:2'}));assert.match(await page.locator('#test-billing-error').textContent(),/구매 확인/);
    await page.locator('#test-billing-restore').click();await page.evaluate(()=>__emitBilling({state:'idle',entitlement:'owned',error:''}));
    await page.locator('#test-billing-close').click();await page.locator('#test-ad-button').click();assert.equal(await page.locator('#test-ad-load').isDisabled(),true);await page.locator('#test-ad-close').click();
    await page.evaluate(()=>__emitBilling({state:'failed',entitlement:'owned',error:'query:2',adsBlocked:true}));await page.locator('#test-ad-button').click();assert.equal(await page.locator('#test-ad-load').isDisabled(),true);await page.locator('#test-ad-close').click();
    await page.evaluate(()=>__emitBilling({state:'idle',entitlement:'not-owned',error:'',adsBlocked:false}));await page.locator('#test-ad-button').click();assert.equal(await page.locator('#test-ad-load').isDisabled(),false);await page.locator('#test-ad-close').click();
    for(const viewport of [{width:320,height:568},{width:360,height:640},{width:640,height:360}])for(const language of ['ko','en']){
      await page.setViewportSize(viewport);await page.locator('#language').selectOption(language);await page.locator('#test-billing-button').click();
      for(const patch of [{configured:false},{configured:true,state:'querying',entitlement:'unknown',error:''},{state:'idle',entitlement:'pending'},{entitlement:'owned',error:'ack-timeout'},{state:'failed',entitlement:'unknown',error:'verification'},{state:'cancelled',error:''}]){
        await page.evaluate(patch=>__emitBilling(patch),patch);
        const layout=await page.locator('#test-billing-dialog').evaluate(dialog=>{const r=dialog.getBoundingClientRect();return {fits:r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth,scroll:dialog.scrollHeight>dialog.clientHeight+1,controls:[...dialog.querySelectorAll('button')].map(b=>({w:b.getBoundingClientRect().width,h:b.getBoundingClientRect().height}))};});
        assert.equal(layout.fits,true);assert.equal(layout.scroll,false);assert.ok(layout.controls.every(b=>b.w>=43.9&&b.h>=43.9));report.layouts.push({viewport,language,...patch,...layout});
      }
      if(viewport.width===640&&language==='en')await page.screenshot({path:'docs/screenshots/billing-unknown-landscape-en.png'});
      await page.locator('#test-billing-close').click();
    }
    await page.evaluate(()=>{__qa.switchView('puzzle');__emitBilling({state:'failed',error:'timeout',overlay:false});});
    assert.equal(await page.evaluate(()=>__qa.game.scene.isActive('Board')),true);
    const after=await page.evaluate(()=>JSON.parse(localStorage.getItem('pawblossom.save.v1'))),prior=JSON.parse(before);
    for(const key of ['stars','coins','completed','highestLevel','inProgress','music','sfx'])assert.deepEqual(after[key],prior[key]);
    assert.equal(await page.evaluate(()=>[...__listeners.values()].filter(x=>x.plugin==='PawblossomTestBilling').length),1);
    report.checks.push('Android IPC 대역: background query 중 보드 활성·unknown/pending/owned 광고 차단·확인된 빈 query 뒤 광고 허용·Play 가격만·중복 구매 IPC 1회·구매 준비 connecting/products 중 닫기/Escape/Android back 차단·timeout 해제·구매창 종료 뒤 모달 유지·앱 복귀·승인 실패 복원·게임 저장/음량 보존·리스너 1개','3개 비율×KO/EN×6상태: 화면 안 배치·스크롤 없음·44px 버튼');await context.close();
  }
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.external,[]);
}finally{
  fs.writeFileSync(`docs/performance/billing-${built?(info.androidTestBilling?'testing-web':'production'):'ipc'}-20261015.json`,JSON.stringify(report,null,2)+'\n');
  await browser.close();if(server)await new Promise(resolve=>server.close(resolve));
}
console.log(JSON.stringify({mode:report.mode,checks:report.checks,layouts:report.layouts.length,errors:report.errors,external:report.external}));
