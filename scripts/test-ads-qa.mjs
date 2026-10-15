import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';

// 격리 headless Chrome 전용입니다. native 모드는 SDK가 아닌 IPC 시험 대역입니다.
const built=process.argv.includes('--dist');
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
const origin=built?`http://127.0.0.1:${server.address().port}`:'http://127.0.0.1:5173';
const browser=await chromium.launch({headless:true,channel:'chrome'});
const report={dateKst:'2026-10-15',mode:built?`dist ${fs.readFileSync('dist/build-info.json','utf8').trim()}`:'testing 소스 + Android IPC 대역',browser:browser.version(),checks:[],layouts:[],errors:[],external:[]};
async function open(native=false,language='ko'){
  const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();
  page.on('pageerror',e=>report.errors.push(e.message));
  page.on('request',request=>{if(!request.url().startsWith(origin)&&!request.url().startsWith('data:')&&!request.url().startsWith('blob:'))report.external.push(request.url());});
  await page.addInitScript(({native,language})=>{
    localStorage.setItem('pawblossom.save.v1',JSON.stringify({version:1,language,highestLevel:1,completed:[],stars:0,coins:0,garden:0,music:true,sfx:true,tutorialSeen:true}));
    window.__adCalls=[];window.__adListeners=new Map();window.__adFailCancel=false;window.__adState={available:true,state:'idle',revision:0,error:'',privacyRequired:false};
    window.__adEmit=patch=>{window.__adState={...window.__adState,...patch,revision:window.__adState.revision+1};for(const {plugin,event,callback} of window.__adListeners.values())if(plugin==='PawblossomTestAds'&&event==='stateChange')callback({...window.__adState});return {...window.__adState};};
    if(!native)return;
    window.androidBridge={};let callbackId=0;
    const headers=(name,methods)=>({name,methods:[...methods.map(name=>({name,rtype:'promise'})),{name:'addListener',rtype:'callback'},{name:'removeListener',rtype:'promise'}]});
    window.Capacitor={PluginHeaders:[headers('App',['getState','minimizeApp']),headers('PawblossomTestAds',['getStatus','prepare','show','cancel','privacyOptions'])],
      nativeCallback(plugin,method,options,callback){const id=String(++callbackId);window.__adListeners.set(id,{plugin,event:options.eventName,callback});return Promise.resolve(id);},
      async nativePromise(plugin,method,options){
        if(method==='removeListener'){window.__adListeners.delete(options.callbackId);return;}
        if(plugin==='App')return {isActive:true};
        window.__adCalls.push(method);
        if(method==='getStatus')return {...window.__adState};
        if(method==='cancel'&&window.__adFailCancel)throw Error('QA cancel IPC failure');
        return window.__adEmit({state:{prepare:'consent',show:'presenting',cancel:'cancelled',privacyOptions:'privacy'}[method],error:''});
      },
    };
  },{native,language});
  if(!built){
    await page.routeWebSocket('**',socket=>socket.close());
    await page.route('**/src/main.ts*',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text())+'\nwindow.__qa={get scene(){return scene},get game(){return game},get audio(){return audio},syncActivity,switchView,closeAdDialog};'});});
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
  if(!built){
    const {context,page}=await open(true);
    await page.locator('#settings-button').click();assert.deepEqual(await page.evaluate(()=>__adCalls),[]);
    await page.locator('#test-ad-button').click();await page.waitForFunction(()=>__adCalls.includes('getStatus'));
    assert.deepEqual(await page.evaluate(()=>__adCalls),['getStatus']);
    const before=await page.evaluate(()=>localStorage.getItem('pawblossom.save.v1'));
    for(const viewport of [{width:320,height:568},{width:360,height:640},{width:640,height:360}])for(const language of ['ko','en']){
      await page.setViewportSize(viewport);await page.evaluate(language=>{document.querySelector('#test-ad-close').click();document.querySelector('#language').value=language;document.querySelector('#language').dispatchEvent(new Event('change'));document.querySelector('#test-ad-button').click();},language);
      for(const state of ['idle','consent','loading','ready','showing','closed','failed']){
        await page.evaluate(state=>__adEmit({state,error:state==='failed'?'consent-blocked':''}),state);
        const layout=await page.locator('#test-ad-dialog').evaluate(dialog=>{
          const r=dialog.getBoundingClientRect();const controls=[...dialog.querySelectorAll('button')].filter(b=>b.checkVisibility()).map(b=>({id:b.id,w:b.getBoundingClientRect().width,h:b.getBoundingClientRect().height}));
          return {fits:r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth,scroll:dialog.scrollHeight>dialog.clientHeight+1,controls};
        });assert.equal(layout.fits,true);assert.equal(layout.scroll,false,`${viewport.width} ${language} ${state} scroll`);assert.ok(layout.controls.every(b=>b.w>=43.9&&b.h>=43.9));
        report.layouts.push({viewport,language,state,...layout});
      }
      if(viewport.width===320&&language==='ko')await page.screenshot({path:'docs/screenshots/test-ad-error-ko.png'});
      if(viewport.width===640&&language==='en')await page.screenshot({path:'docs/screenshots/test-ad-error-landscape-en.png'});
    }
    await page.evaluate(()=>__adEmit({state:'idle',error:''}));
    await page.locator('#test-ad-load').dblclick();assert.equal(await page.evaluate(()=>__adCalls.filter(x=>x==='prepare').length),1);
    await page.evaluate(()=>__adEmit({state:'ready'}));assert.equal(await page.evaluate(()=>__adCalls.includes('show')),false);
    await page.evaluate(()=>{__adFailCancel=true;});await page.locator('#test-ad-close').click();assert.equal(await page.locator('#test-ad-dialog').evaluate(d=>d.open),true);
    await page.evaluate(()=>{__adFailCancel=false;});await page.locator('#test-ad-close').click();assert.equal(await page.locator('#test-ad-dialog').evaluate(d=>d.open),false);
    await page.locator('#test-ad-button').click();await page.locator('#test-ad-load').click();await page.evaluate(()=>__adEmit({state:'ready'}));await page.locator('#test-ad-show').dblclick();
    assert.equal(await page.evaluate(()=>__adCalls.filter(x=>x==='show').length),1);
    await page.evaluate(()=>{__adEmit({state:'showing'});__qa.switchView('puzzle');});assert.equal(await page.evaluate(()=>__qa.game.scene.isPaused('Board')),true);
    await page.evaluate(()=>__adEmit({state:'closed'}));assert.equal(await page.evaluate(()=>__qa.game.scene.isPaused('Board')),true);
    await page.locator('#test-ad-close').click();await page.waitForFunction(()=>__qa.game.scene.isActive('Board'));
    const after=await page.evaluate(()=>JSON.parse(localStorage.getItem('pawblossom.save.v1'))),prior=JSON.parse(before);
    for(const key of ['stars','coins','completed','highestLevel','inProgress','music','sfx'])assert.deepEqual(after[key],prior[key]);
    assert.equal(await page.evaluate(()=>[...__adListeners.values()].filter(x=>x.plugin==='PawblossomTestAds').length),1);
    report.checks.push('Android IPC 대역: 초기 요청 0회·명시적 load/show·중복 탭 각 1회·취소 실패 모달 유지·재시도 성공·닫힘 후 보드 복귀·게임 저장/음량 보존·리스너 1개','3개 비율×KO/EN×7개 상태: dialog 스크롤 없음·44px 버튼·화면 안 배치');
    await context.close();
  }
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.external,[]);
}finally{
  fs.writeFileSync(`docs/performance/test-ads-${built?(buildInfo.androidTestAds?'testing-web':'production'):'ipc'}-20261015.json`,JSON.stringify(report,null,2)+'\n');
  await browser.close();if(server)await new Promise(resolve=>server.close(resolve));
}
console.log(JSON.stringify({mode:report.mode,checks:report.checks,layouts:report.layouts.length,errors:report.errors,external:report.external}));
