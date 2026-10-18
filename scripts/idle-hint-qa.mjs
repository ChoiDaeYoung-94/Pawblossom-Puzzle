import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';

// 새 Chrome context/합성 origin에서 실제 dist·입력·자연 시간을 검사합니다.
// Game 관찰 참조만 응답에 노출하며 타이머·판정·사용자 저장은 바꾸지 않습니다.
const output=process.argv.find(arg=>arg.startsWith('--output='))?.slice(9);
assert(output,'--output=새 결과 폴더가 필요합니다.');
await fs.mkdir(output,{recursive:false});
const root=path.resolve('dist'),flags=JSON.parse(await fs.readFile(path.join(root,'build-info.json'),'utf8'));
const {chromium}=await import(pathToFileURL(process.env.PAWBLOSSOM_PLAYWRIGHT_MODULE).href);
const browser=await chromium.launch({headless:true,channel:'chrome'});
const report={dateKst:'2026-10-18',variant:flags.testTools?'testing':'production',flags,browser:browser.version(),
  viewport:{width:390,height:844},scope:'격리 합성 저장/새 Chrome context, 실제 dist·키보드/설정 클릭·자연7.5초. Scene restart/remove와 보관한 이전 callback 재호출만 수명 경계 fixture. Android/폰/TalkBack 검증 아님.',cases:[],pageerrors:[]};
const state=page=>page.evaluate(()=>{
  const s=__hintGame.scene.getScene('Board');
  return {ready:s.ready,active:s.sys.isActive(),selected:s.keyboardState().selected,
    shown:s.hintPieces.length===2||Boolean(s.hintMark?.visible&&s.hintMark.commandBuffer.length),
    timer:Boolean(s.hintTimer),elapsed:s.hintTimer?.elapsed,delay:s.hintTimer?.delay};
});
const ready=page=>page.waitForFunction(()=>{const s=__hintGame?.scene.getScene('Board');return s?.ready&&s.keyboardState().available;});
const hint=page=>page.waitForFunction(()=>{const s=__hintGame.scene.getScene('Board');return s.hintPieces.length===2||Boolean(s.hintMark?.visible&&s.hintMark.commandBuffer.length);},{},{timeout:5000,polling:50});
async function visibleEvidence(page,name){
  const bounds=await page.locator('canvas').boundingBox();assert(bounds&&bounds.width>0&&bounds.height>0);
  const visible=await page.evaluate(bounds=>{
    const x=bounds.x+bounds.width/2,y=bounds.y+bounds.height/2;
    return {viewport:{width:innerWidth,height:innerHeight},canvas:bounds,canvasInViewport:bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=innerWidth&&bounds.y+bounds.height<=innerHeight,
      centerIsCanvas:document.elementFromPoint(x,y)?.tagName==='CANVAS',horizontalOverflow:document.documentElement.scrollWidth-innerWidth};
  },bounds);
  assert(visible.canvasInViewport&&visible.centerIsCanvas);assert.equal(visible.horizontalOverflow,0);
  await page.screenshot({path:path.join(output,name+'.png')});return visible;
}
try{
  for(const motion of ['no-preference','reduce']){
    const context=await browser.newContext({viewport:report.viewport,reducedMotion:motion}),page=await context.newPage();
    const item={motion,checks:[],timings:[],screens:[]};report.cases.push(item);
    page.on('pageerror',error=>report.pageerrors.push({motion,message:error.message}));
    page.setDefaultTimeout(10000);
    try{
      await context.addInitScript(()=>localStorage.setItem('pawblossom.save.v1',JSON.stringify({version:1,language:'ko',highestLevel:1,completed:[],stars:0,coins:0,garden:0,music:false,sfx:false,tutorialSeen:true})));
      await page.route('http://hint.pawblossom.invalid/**',async route=>{
        const url=new URL(route.request().url()),file=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));assert(file.startsWith(root+path.sep));
        if(file.endsWith('.js')){
          let source=await fs.readFile(file,'utf8');const calls=source.match(/new [\w$.]+\.Game\(\{type:/g)??[];
          if(calls.length){assert.equal(calls.length,1);source=source.replace(calls[0],'window.__hintGame='+calls[0]);}
          await route.fulfill({body:source,contentType:'text/javascript'});
        }else await route.fulfill({path:file});
      });
      await page.goto('http://hint.pawblossom.invalid');await ready(page);
      item.initialListeners=await page.evaluate(()=>{
        const s=__hintGame.scene.getScene('Board');return Object.fromEntries(['create','pause','resume','sleep','wake'].map(name=>[name,s.events.listenerCount(name)]));
      });
      const board=page.locator('#game-canvas');await board.focus();await page.keyboard.press('Enter');
      assert((await state(page)).selected);await page.waitForTimeout(7900);
      assert.equal((await state(page)).shown,false);assert.equal((await state(page)).timer,false);
      item.checks.push('선택 중 자연 만료: 선택 유지/힌트 없음/예약 소진');
      item.screens.push({name:'selected-expired',...await visibleEvidence(page,`${motion}-selected-expired`)});
      await page.keyboard.press('Escape');const escapeAt=Date.now();assert.equal((await state(page)).selected,undefined);
      await page.waitForTimeout(7000);assert.equal((await state(page)).shown,false);await hint(page);
      item.timings.push({case:'Escape 이후 자연 힌트',elapsedMs:Date.now()-escapeAt,state:await state(page)});
      item.checks.push('Escape 선택 해제 후 새7.5초 유휴 힌트');
      item.screens.push({name:'escape-hint',...await visibleEvidence(page,`${motion}-escape-hint`)});
      await board.focus();await page.keyboard.press('Enter');await page.waitForTimeout(7900);
      assert.equal((await state(page)).shown,false);assert.equal((await state(page)).timer,false);
      await page.locator('#settings-button').click();await page.waitForFunction(()=>__hintGame.scene.isPaused('Board'));
      assert.equal((await state(page)).timer,false);await page.waitForTimeout(1000);
      await page.locator('#settings-button').click();await ready(page);const returnAt=Date.now();
      assert.equal((await state(page)).selected,undefined);await page.waitForTimeout(7000);assert.equal((await state(page)).shown,false);await hint(page);
      item.timings.push({case:'설정 복귀 이후 자연 힌트',elapsedMs:Date.now()-returnAt,state:await state(page)});
      item.checks.push('선택 중 자연 만료→실제 설정 클릭 pause→복귀 후 새7.5초');
      item.screens.push({name:'settings-return-hint',...await visibleEvidence(page,`${motion}-settings-return-hint`)});
      await page.evaluate(()=>{
        const s=__hintGame.scene.getScene('Board');window.__oldHintCallback=s.hintTimer.callback;window.__oldPiece=s.pieces[0][0];s.scene.restart();
      });
      await page.waitForFunction(()=>{const s=__hintGame.scene.getScene('Board');return s.ready&&s.pieces[0]?.[0]!==__oldPiece;});
      const lifecycle=await page.evaluate(()=>{
        const s=__hintGame.scene.getScene('Board'),timer=s.hintTimer;__oldHintCallback();
        return {timerSame:s.hintTimer===timer,hintAbsent:s.hintPieces.length===0&&!s.hintMark?.commandBuffer.length,
          listeners:Object.fromEntries(['create','pause','resume','sleep','wake'].map(name=>[name,s.events.listenerCount(name)])),pointerdown:s.input.listenerCount('pointerdown')};
      });
      assert(lifecycle.timerSame&&lifecycle.hintAbsent);assert.equal(lifecycle.pointerdown,1);
      // 실제 InputPlugin도 pause/sleep을 구독하므로 최초 생성의 전체 수와 비교합니다.
      assert.deepEqual(lifecycle.listeners,item.initialListeners);
      await page.waitForTimeout(7000);assert.equal((await state(page)).shown,false);await hint(page);
      item.checks.push('실제 shutdown/restart→이전 callback 무효/현재 timer 유지/최초와 같은 리스너 수/새 자연 힌트');item.lifecycle=lifecycle;
      item.screens.push({name:'restart-hint',...await visibleEvidence(page,`${motion}-restart-hint`)});
      await page.evaluate(()=>{
        const s=__hintGame.scene.getScene('Board');window.__removedScene=s;window.__removedHintCallback=s.hintTimer.callback;__hintGame.scene.remove('Board');
      });
      await page.waitForFunction(()=>__removedScene.sys.settings.status===9);
      await page.evaluate(()=>{
        for(const prop of ['pieces','effects'])Object.defineProperty(__removedScene,prop,{get(){throw Error('destroy 이후 접근: '+prop);}});
        __removedHintCallback();
      });item.checks.push('실제 destroy 뒤 보관 callback은 effects/pieces 접근 없음');
      assert.equal(report.pageerrors.length,0);console.log(JSON.stringify({motion,checks:item.checks.length,timings:item.timings}));
    }finally{await context.close();}
  }
}catch(error){report.failure=error.stack;throw error;}
finally{await browser.close();await fs.writeFile(path.join(output,'summary.json'),JSON.stringify(report,null,2)+'\n');}
