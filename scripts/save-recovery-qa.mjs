import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
// 사용자 브라우저와 분리한 headless context에만 localStorage 실패와 관찰자를 주입합니다.
const {chromium}=await import(process.env.PAWBLOSSOM_PLAYWRIGHT_MODULE?pathToFileURL(path.resolve(process.env.PAWBLOSSOM_PLAYWRIGHT_MODULE)).href:'playwright');
const browser=await chromium.launch({headless:true,channel:'chrome'});
const key='pawblossom.save.v1',backup=key+'.backup',marker=key+'.reset';
const base={version:1,language:'ko',highestLevel:6,completed:[1,2,3,4,5],stars:3,coins:200,garden:1,music:false,sfx:true,tutorialSeen:true};
const checks=[],samples=[],errors=[];
async function setup({primary=JSON.stringify(base),copy=null,read='',write='',reset=null}={}){
  const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
  await context.addInitScript(({primary,copy,read,write,reset,key,backup,marker})=>{
    const get=Storage.prototype.getItem,set=Storage.prototype.setItem,remove=Storage.prototype.removeItem;
    if(!get.call(sessionStorage,'qa-seeded')){
      for(const [k,v] of [[key,primary],[backup,copy],[marker,reset]])if(v!==null)set.call(localStorage,k,v);
      set.call(sessionStorage,'qa-seeded','1');
    }
    window.__fault={read,write,remove:false};
    window.__disk=()=>[key,backup,marker].map(k=>[k,get.call(localStorage,k)]);
    Storage.prototype.getItem=function(k){if(this===localStorage&&(window.__fault.read===k||window.__fault.read==='*'))throw new DOMException('QA read','SecurityError');return get.call(this,k);};
    Storage.prototype.setItem=function(k,v){if(this===localStorage&&(window.__fault.write===k||window.__fault.write==='*'))throw new DOMException('QA quota','QuotaExceededError');return set.call(this,k,v);};
    Storage.prototype.removeItem=function(k){if(this===localStorage&&window.__fault.remove)throw new DOMException('QA remove','SecurityError');return remove.call(this,k);};
  },{primary,copy,read,write,reset,key,backup,marker});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.routeWebSocket('**',socket=>socket.close());
  await page.route('**/src/main.ts*',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text())+'\nwindow.__qa={get scene(){return scene},get save(){return save},get moves(){return moves},get status(){return saveStatus()},persist,finish,startLevel,closeTutorial,audio};'});});
  await page.goto('http://127.0.0.1:5173');await page.waitForFunction(()=>window.__qa?.scene?.engine&&document.querySelector('canvas'));
  if(await page.locator('#tutorial-dialog').evaluate(d=>d.open))await page.locator('#guide-skip').click();
  await page.waitForFunction(()=>window.__qa.scene.sys.isActive());
  return {context,page,disk:()=>page.evaluate(()=>window.__disk()),memory:()=>page.evaluate(()=>JSON.parse(JSON.stringify(window.__qa.save)))};
}
try{
  {
    const {context,page,disk,memory}=await setup({write:backup,primary:JSON.stringify({...base,music:true})});const before=await disk();
    await page.locator('#shuffle').click();assert.equal((await memory()).inProgress.shuffles,0);assert.deepEqual(await disk(),before);
    await page.waitForFunction(()=>window.__qa.audio.context?.state==='running'&&!window.__qa.audio.paused&&window.__qa.scene.sys.isActive());
    await page.evaluate(()=>{window.__changes=0;new MutationObserver(()=>window.__changes++).observe(document.querySelector('#storage-announcement'),{childList:true,subtree:true});window.__qa.persist();window.__qa.persist();});
    await page.waitForTimeout(20);assert.equal(await page.evaluate(()=>window.__changes),0);assert.equal(await page.locator('#toast').textContent(),'');
    await page.locator('#settings-button').click();assert.match(await page.locator('#save-status').textContent(),/復|복구 사본/);
    await page.locator('#language').selectOption('en');assert.match(await page.locator('#save-status').textContent(),/recovery copy could not/);
    await page.locator('#save-retry').focus();await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>document.activeElement.id),'save-retry');
    await page.evaluate(()=>{window.__fault.write='';});const latest=await memory();await page.keyboard.press('Space');
    assert.equal(await page.evaluate(()=>document.activeElement.id),'save-retry');assert.deepEqual(JSON.parse((await disk())[0][1]),latest);
    await page.reload();await page.waitForFunction(()=>window.__qa?.scene?.engine);assert.deepEqual(await memory(),latest);
    checks.push('backup 실패 시 디스크 보존·반복 알림/토스트 없음·메모리 섞기 유지·KO/EN·Enter/Space 재시도 포커스·재실행');await context.close();
  }
  {
    const {context,page,disk,memory}=await setup({write:key});const before=JSON.parse((await disk())[0][1]);
    await page.evaluate(()=>window.__qa.finish(true));const latest=await memory();assert.equal(latest.coins,240);assert.equal(latest.highestLevel,7);
    await page.evaluate(()=>{window.__fault.write='';window.__qa.persist();});assert.deepEqual(JSON.parse((await disk())[0][1]),latest);assert.deepEqual(JSON.parse((await disk())[1][1]),before);
    await page.evaluate(()=>window.__qa.finish(true));assert.equal((await memory()).coins,240);checks.push('primary 실패 중 첫 보상·완료·회차 삭제 보존과 재시도 후 중복 지급 없음');await context.close();
  }
  const original=await setup(),checkpointCopy=await original.memory();await original.context.close();
  for(const primary of ['{','{"version":1}']){
    const {context,page,disk,memory}=await setup({primary,copy:JSON.stringify(checkpointCopy)});assert.equal((await memory()).coins,200);assert.equal(await page.evaluate(()=>window.__qa.status.load),'recovered');
    assert.deepEqual((await memory()).inProgress,checkpointCopy.inProgress);assert.equal(await page.locator('#toast').textContent(),'');
    await page.reload();await page.waitForFunction(()=>window.__qa?.scene?.engine);assert.equal((await memory()).coins,200);assert.ok(JSON.parse((await disk())[0][1]).inProgress);
    checks.push(`정상 사본 복구·재실행 (${primary})`);await context.close();
  }
  for(const options of [{primary:'{'},{primary:'null'},{primary:'{',copy:'{"version":1}'},{primary:'{"version":2}',copy:JSON.stringify(base)},{copy:'{"version":2}'},{reset:'2'}]){
    const {context,page,disk}=await setup(options),before=await disk();await page.locator('#shuffle').click();await page.evaluate(()=>window.__qa.persist());assert.deepEqual(await disk(),before);
    await page.locator('#settings-button').click();assert.match(await page.locator('#save-status').textContent(),/자동 저장|지원하지/);
    checks.push(`손상·미지원 원본 보호 ${JSON.stringify(options)}`);await context.close();
  }
  {
    const {context,page,disk,memory}=await setup({read:backup}),before=await disk();assert.equal((await memory()).coins,200);
    await page.locator('#shuffle').click();const latest=await memory();assert.deepEqual(await disk(),before);
    await page.locator('#settings-button').click();await page.evaluate(()=>{window.__fault.read='';});await page.locator('#save-retry').click();
    assert.deepEqual(JSON.parse((await disk())[0][1]),latest);assert.equal(await page.evaluate(()=>window.__qa.status.write),'saved');
    checks.push('정상 primary·backup 읽기 예외는 자동 쓰기 차단·읽기 회복 뒤 최신 회차 재시도');await context.close();
  }
  {
    const {context,page,disk,memory}=await setup({read:key}),before=await disk();await page.locator('#shuffle').click();const latest=await memory();
    await page.evaluate(({backup})=>{window.__fault.read=backup;},{backup});await page.locator('#settings-button').click();await page.locator('#save-retry').click();
    assert.equal(await page.evaluate(()=>window.__qa.status.load),'read-error');assert.deepEqual(await disk(),before);
    await page.evaluate(()=>{window.__fault.read='';});await page.locator('#save-retry').click();
    assert.equal(await page.evaluate(()=>window.__qa.status.load),'conflict');assert.deepEqual(await memory(),latest);assert.deepEqual(await disk(),before);
    assert.ok(await page.locator('#save-reload').isVisible());page.once('dialog',dialog=>dialog.dismiss());await page.locator('#save-reload').click();assert.deepEqual(await memory(),latest);
    await page.locator('#save-retry').click();assert.deepEqual(await disk(),before);assert.deepEqual(await memory(),latest);
    await page.screenshot({path:'docs/screenshots/save-conflict-mobile.png'});checks.push('primary→backup 순차 읽기 실패→기존 기록 발견 충돌 보호·반복 재시도/명시 불러오기 취소 무변경');await context.close();
  }
  {
    const {context,page,disk,memory}=await setup({copy:JSON.stringify(base)});await page.locator('#settings-button').click();const before=await disk(),latest=await memory();
    page.once('dialog',d=>d.dismiss());await page.locator('#reset').click();assert.deepEqual(await disk(),before);assert.deepEqual(await memory(),latest);
    await page.evaluate(({marker})=>{window.__fault.write=marker;},{marker});page.once('dialog',d=>d.accept());await page.locator('#reset').click();assert.deepEqual(await disk(),before);assert.deepEqual(await memory(),latest);
    await page.evaluate(({key})=>{window.__fault.write=key;},{key});page.once('dialog',d=>d.accept());await page.locator('#reset').click();assert.equal((await memory()).coins,0);assert.equal((await disk())[2][1],'1');
    await page.reload();await page.waitForFunction(()=>window.__qa?.scene?.engine);assert.equal((await memory()).coins,0);
    await page.locator('#guide-skip').click();await page.evaluate(()=>{window.__fault.write='';window.__qa.persist();});assert.equal((await disk())[2][1],null);
    await page.evaluate(({key})=>localStorage.setItem(key,'{'),{key});await page.reload();await page.waitForFunction(()=>window.__qa?.scene?.engine);assert.equal((await memory()).coins,0);
    checks.push('초기화 취소/marker 실패 무변경·primary 실패 뒤 종료·정상 재시도·옛 사본 부활 방지');await context.close();
  }
  {
    const {context,page}=await setup({primary:'{'});await page.locator('#settings-button').click();
    for(const viewport of [{width:320,height:568},{width:360,height:640},{width:390,height:844},{width:640,height:360}])for(const language of ['ko','en']){
      await page.setViewportSize(viewport);await page.locator('#language').selectOption(language);
      await page.locator('#save-retry').scrollIntoViewIfNeeded();
      const sample=await page.evaluate(()=>{const b=document.querySelector('#save-retry').getBoundingClientRect(),body=document.scrollingElement;return {language:document.documentElement.lang,width:innerWidth,height:innerHeight,button:[b.width,b.height],body:[body.scrollWidth,body.clientWidth,body.scrollHeight,body.clientHeight],text:document.querySelector('#save-status').textContent};});
      assert.ok(sample.button.every(n=>n>=44));assert.equal(sample.body[0],sample.body[1]);assert.equal(sample.body[2],sample.body[3]);samples.push(sample);
      await page.locator('#save-retry').focus();await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>document.activeElement.id),'save-retry');
      await page.locator('#settings-button').click();assert.equal(await page.evaluate(()=>document.querySelector('#puzzle-view').scrollHeight>document.querySelector('#puzzle-view').clientHeight),false);
      await page.locator('#settings-button').click();
    }
    await page.setViewportSize({width:390,height:844});await page.locator('#language').selectOption('ko');await page.locator('#save-retry').scrollIntoViewIfNeeded();await page.screenshot({path:'docs/screenshots/save-error-settings-mobile.png'});
    checks.push('4개 화면 크기×KO/EN 오류 설정·44px·키보드 포커스·body/퍼즐 스크롤 없음');await context.close();
  }
  assert.deepEqual(errors,[]);
  const report={dateKst:'2026-10-16',browser:browser.version(),method:'격리 headless Chrome, 실제 Storage.prototype read/write/remove fault injection. 실제 Android 저장소 소진·강제 종료 미검증.',checks:checks.length,details:checks,samples,pageerrors:errors};fs.writeFileSync('docs/performance/save-recovery-20261016.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
