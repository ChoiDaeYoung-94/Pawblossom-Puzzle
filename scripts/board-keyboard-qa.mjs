import path from 'node:path';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
// 격리 Chrome에서만 관찰자를 주입합니다. 실제 키 입력은 Playwright keyboard로 보냅니다.
const modulePath=process.env.PAWBLOSSOM_PLAYWRIGHT_MODULE;
const {chromium}=await import(modulePath?pathToFileURL(path.resolve(modulePath)).href:'playwright');
const browser=await chromium.launch({headless:true,channel:'chrome'});
const checks=[],errors=[],samples=[];
try{
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true});
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/src/main.ts*',async route=>{
    const response=await route.fetch();await route.fulfill({response,body:(await response.text())+'\nwindow.__qa={get scene(){return scene},get game(){return game},get moves(){return moves},get score(){return score},audio,startLevel,syncActivity,setActive(value){nativeActive=value;syncActivity()}};'});
  });
  const ready=()=>page.waitForFunction(()=>window.__qa?.scene.sys.isActive()&&window.__qa.game.scene.getScene('Board')===window.__qa.scene&&!window.__qa.scene.busy);
  const stored=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('pawblossom.save.v1')));
  const state=()=>page.evaluate(()=>window.__qa.scene.keyboardState());
  const focus=async()=>{await page.locator('#restart').focus();await page.keyboard.press('Tab');assert.equal(await page.locator('#game-canvas').evaluate(el=>document.activeElement===el),true);};
  const go=async(row,col)=>{const s=await state();assert.ok(s.cursor);for(const [key,count] of [['ArrowDown',row-s.cursor.row],['ArrowRight',col-s.cursor.col]])for(let i=0;i<Math.abs(count);i++)await page.keyboard.press(count<0?(key==='ArrowDown'?'ArrowUp':'ArrowLeft'):key);};
  const seed=async(mode='normal')=>{
    await page.evaluate(async mode=>{
      const {BoardEngine,seededRng}=await import('/src/core/index.ts');const {levels,levelSignature}=await import('/src/state.ts');
      const level=levels[(mode==='win'?1:6)-1],e=new BoardEngine(8,8,seededRng(42));e.setLeaves(level.leaves??[]);
      e.board=Array.from({length:8},(_,r)=>Array.from({length:8},(_,c)=>({kind:(r*2+c)%6})));
      for(const [r,c,k] of [[3,0,5],[3,1,5],[3,2,1],[4,2,5]])e.board[r][c]={kind:k};
      e.board[2][2]={kind:0,special:mode==='win'?'rainbow':'row'};
      const save={version:1,language:'ko',highestLevel:6,completed:[],stars:0,coins:0,garden:0,music:true,sfx:true,tutorialSeen:true,
        inProgress:{schema:1,levelId:level.id,levelSignature:levelSignature(level),board:e.board,leaves:e.leaves,moves:mode==='lose'?1:level.moves,score:0,collected:mode==='win'?[11,10,0,0,0,0]:Array(6).fill(0),shuffles:1,clearedLeaves:0}};
      localStorage.setItem('pawblossom.save.v1',JSON.stringify(save));
    },mode);await page.reload();await ready();
  };
  await page.goto('http://127.0.0.1:5173');
  await page.waitForFunction(()=>window.__qa?.scene.sys.isPaused());
  assert.equal(await page.locator('#tutorial-dialog').evaluate(el=>el.open),true);assert.equal(await page.locator('#game-canvas').getAttribute('tabindex'),'-1');
  const first=await stored();await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');assert.deepEqual((await stored()).inProgress,first.inProgress);
  await page.keyboard.press('Escape');await ready();checks.push('첫 안내/늦은 Board 준비는 일시정지·Tab 제외, 안내 키가 회차를 소비하지 않음');
  await seed();const before=await stored();
  const point=async(row,col)=>{const box=await page.locator('canvas').boundingBox();return {x:box.x+(44+col*56)/480*box.width,y:box.y+(44+row*56)/480*box.height};};
  const p0=await point(0,0),p1=await point(0,1);
  await page.mouse.click(p0.x,p0.y);assert.equal((await state()).cursor,undefined);assert.deepEqual((await state()).selected,{row:0,col:0});
  assert.ok(await page.locator('#board-hint-text').isVisible());assert.equal(await page.locator('#board-keyboard-help').isVisible(),false);
  await page.touchscreen.tap(p1.x,p1.y);await ready();assert.deepEqual(await stored(),before);assert.equal((await state()).cursor,undefined);
  await focus();await page.keyboard.press('Enter');await page.touchscreen.tap(p0.x,p0.y);assert.equal((await state()).cursor,undefined);assert.ok(await page.locator('#board-hint-text').isVisible());
  const from=await point(3,2),to=await point(4,2);await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:4});await page.mouse.up();await ready();assert.equal(await page.evaluate(()=>window.__qa.moves),before.inProgress.moves-1);
  await seed();checks.push('마우스/터치 첫 탭·키보드→포인터 전환은 일반 힌트 유지, 포인터 swipe 제스처 보존·Tab 재진입');
  await focus();assert.deepEqual((await state()).cursor,{row:0,col:0});
  assert.match(await page.locator('#board-keyboard-status').textContent(),/1행 1열.*딸기.*일반 블록.*낙엽 남은 겹: 0.*선택한 칸 없음/);
  assert.notEqual(await page.locator('#game-canvas').evaluate(el=>getComputedStyle(el).outlineStyle),'none');
  assert.ok(await page.locator('#board-keyboard-help').isVisible());
  await page.keyboard.press('ArrowUp');await page.keyboard.press('ArrowLeft');assert.deepEqual((await state()).cursor,{row:0,col:0});
  await go(7,7);await page.keyboard.press('ArrowDown');await page.keyboard.press('ArrowRight');assert.deepEqual((await state()).cursor,{row:7,col:7});
  await page.keyboard.press('Enter');assert.deepEqual((await state()).selected,{row:7,col:7});await page.keyboard.press('Escape');assert.equal((await state()).selected,undefined);
  assert.deepEqual(await stored(),before);assert.equal(await page.evaluate(()=>window.__qa.audio.unlocked),true);checks.push('실제 Tab/경계/Enter/Escape·선택 표시·Web Audio unlock, 저장/이동/보상 미소비');
  await go(0,0);await page.keyboard.press('Enter');await page.keyboard.press('ArrowRight');await page.keyboard.press('Space');await ready();assert.deepEqual(await stored(),before);
  checks.push('실제 Enter+Space 무효 교환은 보드·이동·저장 유지');
  await go(3,2);await page.keyboard.press('Enter');await page.keyboard.press('ArrowDown');await page.keyboard.press('Space');await page.waitForFunction(()=>window.__qa.scene.busy);
  const busyCursor=(await state()).cursor;const busySave=await stored();assert.deepEqual(busySave,before);
  await page.keyboard.down('Enter');await page.keyboard.down('Enter');await page.keyboard.press('ArrowRight');await page.keyboard.press('Space');await page.keyboard.up('Enter');
  assert.deepEqual((await state()).cursor,busyCursor);await ready();assert.equal(await page.evaluate(()=>window.__qa.moves),before.inProgress.moves-1);
  const played=await stored();assert.ok(played.inProgress.score>0);checks.push('실제 방향키 유효 교환·연쇄 중 반복키 차단·이동 1회·완료 checkpoint');
  await seed();await focus();await go(2,2);assert.match(await page.locator('#board-keyboard-status').textContent(),/가로 제거 특수.*낙엽 남은 겹: 2/);
  await page.keyboard.press('Enter');await ready();assert.equal(await page.evaluate(()=>window.__qa.moves),before.inProgress.moves-1);
  const special=await stored();assert.ok(special.inProgress.clearedLeaves>0);await page.reload();await ready();assert.deepEqual(await stored(),special);
  checks.push('실제 Enter 특수 사용·낙엽·저장 복원');
  await page.locator('#language-toggle').click();await focus();await go(2,2);assert.match(await page.locator('#board-keyboard-status').textContent(),/Row 3, column 3.*Leaf layers remaining/);
  assert.match(await page.locator('#board-keyboard-help').textContent(),/Enter\/Space/);
  for(const language of ['en','ko']){
    if(language==='ko')await page.locator('#language-toggle').click();await focus();await go(2,2);
    const original=await page.evaluate(()=>({tile:{...window.__qa.scene.engine.board[2][2]},layers:window.__qa.scene.engine.leaves[2][2]}));
    for(const [kind,ko,en] of [['row','가로 제거 특수','Row clear power-up'],['column','세로 제거 특수','Column clear power-up'],['bomb','주변 폭발 특수','Bomb power-up'],['rainbow','같은 색 제거 특수','Color clear power-up']]){
      await page.evaluate(kind=>{const s=window.__qa.scene;s.engine.board[2][2].special=kind;s.engine.leaves[2][2]=1;s.focusKeyboard();},kind);
      const description=await page.locator('#board-keyboard-status').textContent();assert.ok(description.includes(language==='ko'?ko:en));assert.ok(description.includes(language==='ko'?'낙엽 남은 겹: 1':'Leaf layers remaining: 1'));
    }
    await page.evaluate(original=>{const s=window.__qa.scene;s.engine.board[2][2]=original.tile;s.engine.leaves[2][2]=original.layers;s.focusKeyboard();},original);
  }
  checks.push('KO/EN 현재 칸·특수·낙엽·선택·사용법 안내');
  await focus();await page.keyboard.press('Enter');await page.keyboard.press('Tab');assert.equal((await state()).cursor,undefined);assert.equal((await state()).selected,undefined);
  await page.locator('#settings-button').click();const settings=await stored();await page.locator('#language').focus();await page.keyboard.press('ArrowDown');assert.equal((await state()).cursor,undefined);
  assert.deepEqual((await stored()).inProgress,settings.inProgress);await page.locator('#tutorial-help').click();await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>window.__qa.scene.sys.isPaused()),true);
  await page.locator('#settings-button').click();await ready();await focus();await page.keyboard.press('Enter');await page.locator('#test-level-button').click();const modal=await stored();
  assert.equal((await state()).cursor,undefined);assert.equal((await state()).selected,undefined);await page.keyboard.press('ArrowRight');await page.keyboard.press('Escape');await ready();assert.deepEqual(await stored(),modal);
  checks.push('blur/설정 select/안내/테스트 모달은 커서·선택 정리, UI 키·정상 회차 유지');
  await focus();const c=(await state()).cursor;for(const combo of ['Control+ArrowRight','Alt+ArrowDown','Meta+ArrowLeft'])await page.keyboard.press(combo);assert.deepEqual((await state()).cursor,c);
  await page.keyboard.press('Enter');await page.evaluate(()=>window.dispatchEvent(new Event('blur')));assert.equal((await state()).cursor,undefined);assert.equal((await state()).selected,undefined);
  await page.keyboard.press('ArrowRight');await page.evaluate(()=>window.__qa.setActive(false));assert.equal((await state()).cursor,undefined);await page.keyboard.press('Enter');await page.evaluate(()=>window.__qa.setActive(true));await ready();
  checks.push('Alt/Ctrl/Meta 조합 통과·window blur·PAUSE/RESUME 정리');
  const listenerSample=async label=>{
    const cdp=await context.newCDPSession(page);try{
      const {result}=await cdp.send('Runtime.evaluate',{expression:'document.querySelector("#game-canvas")'});
      const {listeners}=await cdp.send('DOMDebugger.getEventListeners',{objectId:result.objectId});await cdp.send('Runtime.releaseObject',{objectId:result.objectId});
      const counts={};for(const l of listeners)counts[l.type]=(counts[l.type]??0)+1;
      const globalKeys={};for(const scope of ['document','window']){
        const {result:target}=await cdp.send('Runtime.evaluate',{expression:scope});const {listeners:globalListeners}=await cdp.send('DOMDebugger.getEventListeners',{objectId:target.objectId});await cdp.send('Runtime.releaseObject',{objectId:target.objectId});
        globalKeys[scope]=globalListeners.filter(l=>['keydown','keyup','blur'].includes(l.type)).map(l=>l.type).sort();
      }
      samples.push({label,listeners:counts,globalKeys,...await page.evaluate(()=>({canvases:document.querySelectorAll('canvas').length,scenes:window.__qa.game.scene.scenes.length}))});
    }finally{await cdp.detach();}
  };
  await listenerSample('시작');const normal=await stored();
  for(let i=1;i<=100;i++){
    await focus();await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');assert.ok((await state()).selected);
    await page.evaluate(i=>{window.__oldBoard=window.__qa.scene;window.__qa.startLevel(i%2?6:30,true);},i);await ready();
    assert.deepEqual(await page.evaluate(()=>({cursor:window.__oldBoard.keyboardState().cursor,selected:window.__oldBoard.keyboardState().selected,finished:window.__oldBoard.keyboardState().finished})),{cursor:undefined,selected:undefined,finished:true});
    if([30,60,100].includes(i))await listenerSample(`${i}회 전환`);
  }
  for(const sample of samples){assert.deepEqual(sample.listeners,samples[0].listeners);assert.deepEqual(sample.globalKeys,samples[0].globalKeys);assert.equal(sample.listeners.keydown,1);assert.equal(sample.canvases,1);assert.equal(sample.scenes,1);}
  assert.deepEqual(await stored(),normal);await focus();await go(2,2);await page.evaluate(()=>{const s=window.__qa.scene;s.engine.board[2][2].special='row';s.paint(s.engine.board);});await page.keyboard.press('Space');await ready();assert.deepEqual(await stored(),normal);
  checks.push('100회 Scene 교체: DOM keydown 1개 유지·canvas/Scene 1개·이전 커서/선택 제거·시험 특수 무보상/정상 저장 보존');
  for(const viewport of [{width:390,height:844},{width:640,height:360}]){
    await page.setViewportSize(viewport);await focus();await go(7,7);
    assert.deepEqual(await page.evaluate(()=>({x:document.body.scrollWidth>innerWidth,y:document.body.scrollHeight>innerHeight})),{x:false,y:false});
    const mark=await page.evaluate(()=>{const s=window.__qa.scene;return {depth:s.cursorMark.depth,visible:s.cursorMark.visible,selected:s.keyboardState().selected};});assert.equal(mark.depth,20);assert.equal(mark.visible,true);assert.equal(mark.selected,undefined);
    await page.screenshot({path:`docs/screenshots/keyboard-${viewport.width>viewport.height?'landscape':'portrait'}.png`});
  }
  checks.push('portrait/landscape gameplay body scroll 없음·이중 테두리/모서리 커서 화면 보존');
  await seed('win');await focus();await go(2,2);await page.keyboard.press('Space');await page.waitForFunction(()=>JSON.parse(localStorage.getItem('pawblossom.save.v1')).completed.includes(1),{},{polling:10});
  assert.equal(await page.locator('#result-dialog').evaluate(d=>d.open),false);const won=await stored();assert.equal(won.stars,1);assert.equal(won.coins,40);assert.equal(won.inProgress,undefined);await page.reload();await ready();assert.deepEqual(await stored().then(s=>({stars:s.stars,coins:s.coins,completed:s.completed})),{stars:1,coins:40,completed:[1]});
  await seed('lose');await focus();await go(2,2);await page.keyboard.press('Enter');await page.waitForFunction(()=>!window.__qa.scene.busy&&window.__qa.scene.finished);
  const lost=await stored();assert.equal(lost.inProgress,undefined);assert.equal(lost.stars,0);assert.equal(lost.coins,0);await page.waitForFunction(()=>document.querySelector('#result-dialog').open);
  assert.equal(await page.evaluate(()=>document.activeElement.id),'result-next');await page.keyboard.press('Enter');await ready();assert.equal((await state()).cursor,undefined);
  await page.locator('#restart').focus();await page.keyboard.press('Enter');await ready();assert.equal(await page.evaluate(()=>document.activeElement.id),'restart');assert.equal((await state()).cursor,undefined);
  checks.push('키보드 승리/실패 즉시 settle·결과창 전 보상 저장·중복 보상 없음·재시도 자동 초점 탈취 없음');
  assert.deepEqual(errors,[]);
  const report={dateKst:'2026-10-15',browser:browser.version(),environment:'격리 headless Chrome, Vite testing, 실제 Phaser/키 입력. 실제 TalkBack/Android 외부 키보드 미검증.',checks,samples,pageerrors:errors};
  fs.writeFileSync('docs/performance/board-keyboard-20261015.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}catch(error){console.error(JSON.stringify({completed:checks,errors,samples},null,2));throw error;}finally{await browser.close();}
