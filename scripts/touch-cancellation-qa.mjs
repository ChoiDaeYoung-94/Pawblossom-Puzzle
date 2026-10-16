import path from 'node:path';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';

// 실제 DOM → 설치된 Phaser TouchManager/InputManager/InputPlugin 경로. scene.input.emit는 사용하지 않습니다.
const modulePath=process.env.PAWBLOSSOM_PLAYWRIGHT_MODULE;
const {chromium}=await import(modulePath?pathToFileURL(path.resolve(modulePath)).href:'playwright');
const browser=await chromium.launch({headless:true,channel:'chrome'});
const report={dateKst:'2026-10-16',browser:browser.version(),environment:'격리 headless Chrome, Vite testing, CDP 실제 터치와 DOM TouchEvent/PointerEvent 오류 주입. 실제 Android OS 제스처/회전/홈 복귀는 미검증.',checks:[],events:[],samples:[],practiceEvents:[],pageerrors:[]};
try{
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true});
  const page=await context.newPage();page.on('pageerror',e=>report.pageerrors.push(e.message));
  await page.route('**/src/main.ts*',async route=>{
    const response=await route.fetch();await route.fulfill({response,body:(await response.text())+'\nwindow.__qa={get scene(){return scene},get game(){return game},get moves(){return moves},get score(){return score},get practice(){return practice},startLevel,syncActivity,setActive(value){nativeActive=value;syncActivity()}};'});
  });
  const cdp=await context.newCDPSession(page);
  const ready=()=>page.waitForFunction(()=>window.__qa?.scene.sys.isActive()&&window.__qa.game.scene.getScene('Board')===window.__qa.scene&&!window.__qa.scene.busy);
  const data=()=>page.evaluate(()=>({moves:__qa.moves,score:__qa.score,board:{board:__qa.scene.engine.board,leaves:__qa.scene.engine.leaves},storage:Object.fromEntries(Object.entries(localStorage).filter(([key])=>key.startsWith('pawblossom.')))}));
  const selection=()=>page.evaluate(()=>__qa.scene.keyboardState().selected);
  const trace=async()=>page.evaluate(()=>{
    window.__touchEvents=[];
    for(const type of ['pointerdown','pointerup','pointerupoutside','gameout'])__qa.scene.input.on(type,p=>__touchEvents.push({type,id:p?.id,x:p?.x,y:p?.y,wasCanceled:p?.wasCanceled,wasTouch:p?.wasTouch,trusted:p?.event?.isTrusted,dom:p?.event?.type,downTime:p?.downTime}));
  });
  const collect=async label=>report.events.push({label,events:await page.evaluate(()=>__touchEvents)});
  const point=async(row,col)=>{
    const box=await page.locator('canvas').boundingBox();assert.ok(box);
    return {x:box.x+(44+col*56)*box.width/480,y:box.y+(44+row*56)*box.height/480};
  };
  const touch=async(type,points=[])=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points.map((p,i)=>({...p,id:p.id??i+1,radiusX:1,radiusY:1}))});
  const swipe=async(a,b,cancel=false)=>{await touch('touchStart',[a]);await touch('touchMove',[b]);await touch(cancel?'touchCancel':'touchEnd');};
  const domTouch=async(type,active,changed)=>page.evaluate(({type,active,changed})=>{
    const canvas=document.querySelector('canvas');
    const make=p=>new Touch({identifier:p.id,target:canvas,clientX:p.x,clientY:p.y,pageX:p.x+scrollX,pageY:p.y+scrollY,screenX:p.x,screenY:p.y});
    canvas.dispatchEvent(new TouchEvent(type,{bubbles:true,cancelable:true,touches:active.map(make),targetTouches:active.map(make),changedTouches:changed.map(make)}));
  },{type,active,changed});
  const seed=async(horizontal=false)=>{
    await page.evaluate(async horizontal=>{
      const {BoardEngine,seededRng}=await import('/src/core/index.ts');const {levels,levelSignature}=await import('/src/state.ts');
      const e=new BoardEngine(8,8,seededRng(42)),level=levels[5];e.setLeaves(level.leaves??[]);
      e.board=Array.from({length:8},(_,r)=>Array.from({length:8},(_,c)=>({kind:(r*2+c)%6})));
      for(const [r,c,k] of [[3,0,5],[3,1,5],[3,2,1],[4,2,5]])e.board[r][c]={kind:k};
      if(horizontal)e.board=e.board[0].map((_,c)=>e.board.map(row=>row[c]));
      e.board[2][2]={kind:0,special:'row'};
      localStorage.clear();localStorage.setItem('pawblossom.save.v1',JSON.stringify({version:1,language:'ko',highestLevel:6,completed:[],stars:0,coins:0,garden:0,music:false,sfx:false,tutorialSeen:true,inProgress:{schema:1,levelId:6,levelSignature:levelSignature(level),board:e.board,leaves:e.leaves,moves:level.moves,score:0,collected:Array(6).fill(0),shuffles:1,clearedLeaves:0}}));
    },horizontal);await page.reload();await ready();await trace();
  };
  await page.goto('http://127.0.0.1:5173');await page.locator('#guide-skip').click();await ready();
  for(const [label,row,col,move] of [['일반 탭',0,0,false],['특수 탭',2,2,false],['유효 교환',3,2,true]]){
    await seed();const before=await data(),a=await point(row,col),b=move?await point(4,2):a;
    await swipe(a,b,true);assert.deepEqual(await data(),before);assert.equal(await selection(),undefined);
    const events=await page.evaluate(()=>__touchEvents);assert.ok(events.some(e=>e.type==='pointerup'&&e.wasCanceled&&e.dom==='touchcancel'&&e.trusted));
    assert.equal(await page.evaluate(()=>__qa.scene.down),undefined);await collect(`CDP 취소 ${label}`);
    if(move)await swipe(a,b);else await page.touchscreen.tap(a.x,a.y);await ready();
    if(row===0)assert.deepEqual(await selection(),{row,col});else{const after=await data();assert.equal(after.moves,before.moves-1);assert.ok(after.score>before.score);}
  }
  report.checks.push('CDP touchcancel 일반/특수 탭·유효 swipe: 실제 wasCanceled pointerup 수신, 보드/선택/이동/점수/모든 저장 불변·다음 정상 입력 회복');

  for(const [label,horizontal,reverse] of [['아래',false,false],['위',false,true],['오른쪽',true,false],['왼쪽',true,true]]){
    await seed(horizontal);const before=await data(),a=await point(horizontal?2:3,horizontal?3:2),b=await point(horizontal?2:4,horizontal?4:2);
    await swipe(reverse?b:a,reverse?a:b);await ready();const after=await data();assert.equal(after.moves,before.moves-1);assert.ok(after.score>before.score);await collect(`CDP 정상 ${label}`);
  }
  report.checks.push('실제 CDP 네 방향 정상 swipe는 점수·checkpoint·이동 1회 반영');
  await seed();let before=await data();let a=await point(0,0),b=await point(0,1);
  await page.touchscreen.tap(a.x,a.y);await page.touchscreen.tap(b.x,b.y);await ready();assert.deepEqual(await data(),before);assert.equal(await selection(),undefined);
  report.checks.push('실제 두 칸 tap 무효 교환은 이동·점수·보드·저장 불변');
  await seed();before=await data();a=await point(2,1);b=await point(2,2);
  await page.touchscreen.tap(a.x,a.y);await page.touchscreen.tap(b.x,b.y);await ready();assert.equal((await data()).moves,before.moves-1);assert.ok((await data()).score>0);
  report.checks.push('실제 일반 칸→인접 특수 두 칸 tap 교환·완료 저장');

  await seed();before=await data();a={...await point(3,2),id:11};b={...await point(2,2),id:22};
  await domTouch('touchstart',[a],[a]);await domTouch('touchstart',[a,b],[b]);await domTouch('touchcancel',[a],[b]);
  assert.ok(await page.evaluate(()=>__qa.scene.down));assert.deepEqual(await data(),before);
  const end={...await point(4,2),id:11};await domTouch('touchmove',[end],[end]);await domTouch('touchend',[],[end]);await ready();assert.equal((await data()).moves,before.moves-1);await collect('다중 TouchEvent 보조 취소→주체 정상 교환');
  await seed();before=await data();a={...await point(2,2),id:31};b={...await point(0,0),id:32};
  await domTouch('touchstart',[a],[a]);await domTouch('touchstart',[a,b],[b]);await domTouch('touchcancel',[b],[a]);await domTouch('touchend',[],[b]);assert.deepEqual(await data(),before);
  const third={...await point(2,2),id:33};await domTouch('touchstart',[a,b],[a,b]);await domTouch('touchstart',[a,b,third],[third]);await domTouch('touchend',[],[a,b,third]);assert.deepEqual(await data(),before);
  await page.touchscreen.tap(a.x,a.y);await ready();assert.equal((await data()).moves,before.moves-1);await collect('주체 취소·동시 시작/추가 손가락 거부와 정상 회복');
  report.checks.push('실제 Phaser DOM TouchEvent 다중 입력: 보조 취소는 주체 유지·주체 취소 후 보조 up 무실행·동시 시작/추가 손가락 거부');

  await seed();before=await data();a=await point(2,2);
  await touch('touchStart',[a]);await touch('touchMove',[{x:a.x,y:0}]);await touch('touchEnd');assert.deepEqual(await data(),before);assert.equal(await selection(),undefined);
  await page.mouse.click(a.x,a.y,{button:'right'});await page.mouse.click(a.x,a.y,{button:'middle'});assert.deepEqual(await data(),before);
  await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.up({button:'right'});assert.ok(await page.evaluate(()=>__qa.scene.down));await page.mouse.move(1,1);await page.mouse.up();assert.deepEqual(await data(),before);
  const mouseEvents=await page.evaluate(()=>__touchEvents);assert.ok(mouseEvents.some(e=>e.type==='gameout'));assert.ok(mouseEvents.some(e=>e.type==='pointerupoutside'));await collect('보드 밖 touch·canvas 밖 mouse·보조 마우스');
  await page.touchscreen.tap(a.x,a.y);await ready();assert.equal((await data()).moves,before.moves-1);
  report.checks.push('보드 밖 터치 종료·gameout/pointerupoutside·마우스 보조 버튼 무실행과 회복');

  for(const mode of ['활동 중단','설정 전환','sleep/wake','회전','Scene 교체']){
    await seed();before=await data();a=await point(2,2);await touch('touchStart',[a]);
    if(mode==='활동 중단')await page.evaluate(()=>{__qa.setActive(false);__qa.setActive(true);});
    if(mode==='설정 전환'){await page.locator('#settings-button').click();await page.locator('#settings-button').click();}
    if(mode==='sleep/wake')await page.evaluate(()=>{__qa.game.scene.sleep('Board');__qa.game.scene.wake('Board');});
    if(mode==='회전')await page.setViewportSize({width:640,height:360});
    if(mode==='Scene 교체')await page.evaluate(()=>{window.__oldScene=__qa.scene;__qa.startLevel(6,false,JSON.parse(localStorage.getItem('pawblossom.save.v1')).inProgress);});
    await ready();await touch('touchEnd');await ready();assert.deepEqual(await data(),before);assert.equal(await page.evaluate(()=>__qa.scene.down),undefined);
    if(mode==='Scene 교체')assert.deepEqual(await page.evaluate(()=>({finished:__oldScene.finished,down:__oldScene.down,resize:__qa.game.scale.listeners('resize').filter(fn=>fn.toString().includes('cancelInput')).length})),{finished:true,down:undefined,resize:1});
    a=await point(2,2);await page.touchscreen.tap(a.x,a.y);await ready();assert.equal((await data()).moves,before.moves-1);await collect(`${mode} 후 늦은 종료·회복`);
    await page.setViewportSize({width:390,height:844});
  }
  report.checks.push('CDP down 중 활동 PAUSE/RESUME·설정·SLEEP/WAKE·세로/가로 resize·Scene 교체: 지연 종료 무변경, 다음 특수 정상');
  const sample=async label=>{
    report.samples.push({label,...await page.evaluate(()=>({canvases:document.querySelectorAll('canvas').length,scenes:__qa.game.scene.scenes.length,resize:__qa.game.scale.listeners('resize').filter(fn=>fn.toString().includes('cancelInput')).length,up:__qa.scene.input.listenerCount('pointerup'),pause:__qa.scene.events.listenerCount('pause'),sleep:__qa.scene.events.listenerCount('sleep')}))});
  };
  await seed();before=await data();await sample('교체 전');
  for(let i=1;i<=100;i++){
    a=await point(2,2);await touch('touchStart',[a]);await page.evaluate(()=>{window.__oldScene=__qa.scene;__qa.startLevel(6,true);});await ready();await touch('touchEnd');
    assert.deepEqual(await page.evaluate(()=>({down:__oldScene.down,selected:__oldScene.keyboardState().selected,finished:__oldScene.finished})),{down:undefined,selected:undefined,finished:true});
    if([30,60,100].includes(i))await sample(`${i}회 Scene 교체`);
  }
  for(const s of report.samples){assert.equal(s.canvases,1);assert.equal(s.scenes,1);assert.equal(s.resize,1);assert.equal(s.pause,report.samples[0].pause);assert.equal(s.sleep,report.samples[0].sleep);assert.equal(s.up,s.label==='교체 전'?2:1);}
  assert.deepEqual((await data()).storage,before.storage);
  report.checks.push('실제 touch down 중 100회 Scene 교체: 오래된 up 무실행·이전 상태 정리·canvas/Scene/resize/pause/sleep listener 일정·일반 저장 보존');

  await seed();a=await point(2,2);await touch('touchStart',[a]);await page.locator('#shuffle').click();
  const shuffled=await data();assert.equal(await page.evaluate(()=>__qa.scene.down),undefined);await touch('touchEnd');assert.deepEqual(await data(),shuffled);assert.equal(await selection(),undefined);
  a=await point(0,0);await page.touchscreen.tap(a.x,a.y);assert.deepEqual(await selection(),{row:0,col:0});
  await seed();a=await point(2,2);await page.locator('#game-canvas').focus();await page.keyboard.press('ArrowRight');
  await touch('touchStart',[a]);await page.keyboard.press('ArrowDown');const keys=await data();assert.equal(await page.evaluate(()=>__qa.scene.down),undefined);await touch('touchEnd');assert.deepEqual(await data(),keys);assert.equal(await selection(),undefined);
  report.checks.push('실제 캔버스 touchStart→DOM 무료 섞기/키보드 조작→이전 touchEnd 무실행·새 입력 회복');

  await seed();before=await data();
  const practice=()=>page.evaluate(()=>({completed:__qa.practice.completed,selected:__qa.practice.selected,board:__qa.practice.board}));
  const openPractice=async()=>{await page.locator('#settings-button').click();await page.locator('#tutorial-help').click();for(let i=0;i<3;i++)await page.locator('#guide-next').click();};
  const resetPractice=async()=>{await page.locator('#guide-back').click();await page.locator('#guide-next').click();};
  const buttonPoint=async row=>{const box=await page.locator(`#practice-cell-${row}-2`).boundingBox();return {x:box.x+box.width/2,y:box.y+box.height/2};};
  const pointerEvent=async(type,row=0,extra={})=>page.evaluate(({type,row,extra})=>{
    const button=document.querySelector(`#practice-cell-${row}-2`),rect=button.getBoundingClientRect();
    button.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:77,isPrimary:true,button:0,clientX:rect.x+rect.width/2,clientY:rect.y+rect.height/2,...extra}));
  },{type,row,extra});
  const fakeClick=async(row=0,extra={})=>pointerEvent('click',row,{detail:1,...extra});
  await openPractice();await page.evaluate(()=>{window.__practiceEvents=[];for(const type of ['pointerdown','pointerup','pointercancel','lostpointercapture','click'])document.addEventListener(type,e=>{if(e.target.closest?.('#practice-board'))__practiceEvents.push({type,id:e.pointerId,button:e.button,primary:e.isPrimary,detail:e.detail,x:e.clientX,y:e.clientY,target:e.target.id,trusted:e.isTrusted});},true);});
  let initial=await practice();a=await buttonPoint(0);b=await buttonPoint(1);
  await swipe(a,b,true);await fakeClick();assert.deepEqual(await practice(),initial);
  await page.mouse.click(a.x,a.y);assert.deepEqual((await practice()).selected,{row:0,col:2});await page.mouse.click(b.x,b.y);assert.equal((await practice()).completed,true);
  report.checks.push('실습 실제 CDP touchcancel→합성 click 무실행·실제 mouse tap/자동 lostcapture는 정상 두 칸 교환');

  await resetPractice();initial=await practice();a=await buttonPoint(0);b=await buttonPoint(1);
  await touch('touchStart',[a]);await page.evaluate(()=>{const button=document.querySelector('#practice-cell-0-2');window.__practicePointer=null;button.addEventListener('pointermove',e=>window.__practicePointer=e.pointerId,{once:true});});
  await touch('touchMove',[{x:a.x,y:a.y+3}]);await page.evaluate(()=>document.querySelector('#practice-cell-0-2').releasePointerCapture(window.__practicePointer));
  await touch('touchMove',[b]);await touch('touchEnd');await fakeClick();assert.deepEqual(await practice(),initial);
  await page.locator('#practice-cell-0-2').focus();await page.keyboard.press('Enter');await page.locator('#practice-cell-1-2').focus();await page.keyboard.press('Space');assert.equal((await practice()).completed,true);
  report.checks.push('실습 실제 capture release/lostpointercapture→늦은 up·click 무실행, Enter/Space 접근성 유지');

  await resetPractice();initial=await practice();a=await buttonPoint(0);
  const bounds=await page.locator('#practice-board').boundingBox();await swipe(a,{x:a.x,y:bounds.y+bounds.height+25});await fakeClick();assert.deepEqual(await practice(),initial);
  await pointerEvent('pointerdown',0,{button:2});await pointerEvent('pointerup',0,{button:2});await fakeClick(0,{button:2});assert.deepEqual(await practice(),initial);
  // 실제 capture를 유지한 상태에서 다른 ID 취소를 주입합니다.
  await touch('touchStart',[a]);await pointerEvent('pointercancel',0,{pointerId:88});await pointerEvent('pointerup',0,{pointerId:88});await fakeClick(0,{pointerId:88});
  b=await buttonPoint(1);await touch('touchMove',[b]);await touch('touchEnd');assert.equal((await practice()).completed,true);
  report.practiceEvents=await page.evaluate(()=>__practiceEvents);
  report.checks.push('실습 보드 밖 긴 swipe·보조 버튼/다른 ID up·click은 무실행, 다른 ID cancel은 주체 정상 swipe 유지');

  await resetPractice();a=await buttonPoint(0);await page.touchscreen.tap(a.x,a.y);
  await page.waitForFunction(()=>__qa.practice.selected?.row===0&&__qa.practice.selected?.col===2,{},{timeout:3000});
  b=await buttonPoint(1);await page.touchscreen.tap(b.x,b.y);await page.waitForFunction(()=>__qa.practice.completed);
  report.checks.push('연속 취소/스와이프 뒤 실습 실제 CDP 일반 tap 두 번은 정상 pointerup으로 첫 교환 완료 (native click 생략에도 회복)');

  await resetPractice();initial=await practice();await page.evaluate(()=>{const button=document.querySelector('#practice-cell-0-2');button.setPointerCapture=()=>{throw Error('QA capture 실패');};});
  a=await buttonPoint(0);await page.mouse.click(a.x,a.y);assert.deepEqual(await practice(),initial);
  await resetPractice();initial=await practice();a=await buttonPoint(0);await touch('touchStart',[a]);await page.locator('#guide-back').click();await page.locator('#guide-next').click();await touch('touchEnd');await fakeClick();assert.deepEqual(await practice(),initial);
  a=await buttonPoint(0);b=await buttonPoint(1);await swipe(a,b);assert.equal((await practice()).completed,true);assert.deepEqual(await data(),before);
  report.checks.push('실습 capture 예외·DOM 교체 뒤 지연 종료는 무실행, 새 실제 swipe 정상·본 게임 저장/보상/이동 불변');
  await page.screenshot({path:'docs/screenshots/touch-practice-20261016.png'});await page.locator('#guide-skip').click();await page.locator('#settings-button').click();await ready();
  await page.screenshot({path:'docs/screenshots/touch-board-20261016.png'});
  report.practiceEvents=await page.evaluate(()=>__practiceEvents);
  assert.deepEqual(report.pageerrors,[]);fs.writeFileSync('docs/performance/touch-cancellation-20261016.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}catch(error){console.error(JSON.stringify(report,null,2));throw error;}finally{await browser.close();}
