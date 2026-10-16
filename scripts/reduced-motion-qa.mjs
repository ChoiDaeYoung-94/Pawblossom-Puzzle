import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';

// dist 응답에 Game 관찰 참조만 주입합니다. 보드 fixture/관찰 래퍼는 격리 브라우저 메모리에만 존재합니다.
const {chromium}=await import(pathToFileURL(process.env.PAWBLOSSOM_PLAYWRIGHT_MODULE).href);
const root=path.resolve('dist'),flags=JSON.parse(await fs.readFile(path.join(root,'build-info.json'),'utf8'));
const variant=flags.testTools?'testing':'production';
const recoveryOnly=process.argv.includes('--recovery-only');
const browser=await chromium.launch({headless:true,channel:'chrome'});
const report={issue:70,dateKst:'2026-10-16',variant,runType:recoveryOnly?'independent-recovery':'full',flags,browser:browser.version(),cases:[],pageerrors:[],
  scope:'격리 headless Chrome 실제 dist·실제 canvas touch/keyboard/CDP touchCancel. 자연 보드 유효 교환 후 메모리 fixture로 특수/콤보/겹낙엽 경계 검사. OS 설정은 Playwright emulateMedia. Android·감각 검수 아님.'};
const ready=page=>page.waitForFunction(()=>window.__motionGame?.scene.getScene('Board')?.keyboardState().available);
const observe=page=>page.evaluate(()=>{
  const s=window.__motionGame.scene.getScene('Board');window.__motionScene=s;
  window.__inputTrace=[];for(const name of ['pointerdown','pointerup','pointerupoutside'])s.input.on(name,p=>__inputTrace.push({name,x:p.x,y:p.y,cancel:p.wasCanceled,dom:p.event.type,touches:p.event.touches?.length}));
  if(!window.__scaleTrace){window.__scaleTrace=[];const scale=__motionGame.scale,refresh=scale.refresh.bind(scale);scale.refresh=(...args)=>{const before=scale.parent.getBoundingClientRect().toJSON();const cached={width:scale.parentSize.width,height:scale.parentSize.height};const value=refresh(...args);__scaleTrace.push({before,cached,parent:{width:scale.parentSize.width,height:scale.parentSize.height},display:{width:scale.displaySize.width,height:scale.displaySize.height},style:scale.canvas.style.cssText,stack:new Error().stack.split('\n').slice(2,5),bounds:{width:scale.canvasBounds.width,height:scale.canvasBounds.height},canvas:scale.canvas.getBoundingClientRect().toJSON()});return value;};}
  window.__motionLog={tweens:[],waits:[],results:[],drops:[],leaves:[]};
  const log=window.__motionLog,add=s.tweens.add.bind(s.tweens);
  s.tweens.add=config=>{log.tweens.push(Object.fromEntries(['x','y','scale','scaleX','scaleY','angle','displayWidth','displayHeight','alpha','duration','repeat'].filter(k=>config[k]!==undefined).map(k=>[k,config[k]])));return add(config);};
  const wait=s.wait.bind(s);s.wait=ms=>{log.waits.push(ms);return wait(ms);};
  for(const method of ['swap','activate']){const original=s.engine[method].bind(s.engine);s.engine[method]=(...args)=>{const result=original(...args);log.results.push({...JSON.parse(JSON.stringify(result)),method});return result;};}
  const paint=s.paintLeaves.bind(s);s.paintLeaves=leaves=>{log.leaves.push(leaves.map(r=>r.slice()));return paint(leaves);};
  const drop=s.drop.bind(s);s.drop=step=>{const old=s.pieces.map(r=>r.slice());drop(step);let preserved=true;
    for(let col=0;col<8;col++){const survivors=old.map((row,r)=>({item:row[col],row:r})).filter(p=>!step.removed.some(q=>q.row===p.row&&q.col===col));
      survivors.forEach((p,i)=>{if(!step.created?.some(q=>q.row===p.row&&q.col===col))preserved&&=s.pieces[8-survivors.length+i][col]===p.item;});}
    log.drops.push({preserved,positioned:s.pieces.every((r,row)=>r.every((p,col)=>p.x===44+col*56&&p.y===44+row*56))});};
});
const state=page=>page.evaluate(()=>{
  const s=__motionGame.scene.getScene('Board'),mark=m=>(m?.commandBuffer.length??0)>0;
  return {...s.keyboardState(),selectionMark:mark(s.selectionMark),hintMark:mark(s.hintMark),cursorMark:mark(s.cursorMark),effects:s.effects.activeCount,
    pieces:s.pieces.flat().map(p=>({x:p.x,y:p.y,scale:p.scaleX,alpha:p.alpha})),leaves:s.engine.leaves,log:window.__motionLog};
});
const point=async(page,p)=>{await page.locator('canvas').scrollIntoViewIfNeeded();const b=await page.locator('canvas').boundingBox();return {x:b.x+(44+p.col*56)/480*b.width,y:b.y+(44+p.row*56)/480*b.height};};
const tap=async(page,p)=>{const q=await point(page,p);await page.touchscreen.tap(q.x,q.y);};
const spatial=t=>['x','y','scale','scaleX','scaleY','angle','displayWidth','displayHeight'].some(k=>t[k]!==undefined);
const fixture=page=>page.evaluate(()=>{
  const s=__motionGame.scene.getScene('Board');s.cancelInput();s.engine.board=Array.from({length:8},(_,r)=>Array.from({length:8},(_,c)=>({kind:(r*2+c)%6})));
  for(const [r,c,k] of [[3,0,5],[3,1,5],[3,2,1],[4,2,5]])s.engine.board[r][c]={kind:k};
  s.engine.setLeaves([{row:2,col:4,layers:2},{row:3,col:1,layers:2}]);s.paint(s.engine.board);s.paintLeaves(s.engine.leaves);s.resetHint();
  window.__motionLog.tweens=[];window.__motionLog.waits=[];window.__motionLog.results=[];window.__motionLog.drops=[];window.__motionLog.leaves=[];
});
try{
  for(const reducedMotion of ['reduce','no-preference'])for(const language of ['ko','en'])for(const viewport of [{width:320,height:568},{width:640,height:360}]){
    console.log(`${variant} ${reducedMotion} ${language} ${viewport.width}`);
    const context=await browser.newContext({viewport,hasTouch:true,reducedMotion}),page=await context.newPage();
    page.on('pageerror',e=>report.pageerrors.push(e.message));page.setDefaultTimeout(15000);
    await context.addInitScript(language=>localStorage.setItem('pawblossom.save.v1',JSON.stringify({version:1,language,highestLevel:30,completed:[],stars:0,coins:0,garden:0,music:false,sfx:false,tutorialSeen:true})),language);
    await page.route('http://motion.pawblossom.invalid/**',async route=>{
      const url=new URL(route.request().url()),file=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));assert.ok(file.startsWith(root+path.sep));
      if(file.endsWith('.js')){let body=await fs.readFile(file,'utf8');const calls=body.match(/new [\w$.]+\.Game\(\{type:/g)??[];
        if(calls.length){assert.equal(calls.length,1);body=body.replace(calls[0],'window.__motionGame='+calls[0]);}await route.fulfill({body,contentType:'text/javascript'});
      }else await route.fulfill({path:file});
    });
    const entry={reducedMotion,language,viewport,checks:[]},reduced=reducedMotion==='reduce';
    try{
      await page.goto('http://motion.pawblossom.invalid');await ready(page);await observe(page);
      if(recoveryOnly){
        const samples=[];
        for(let i=0;i<10;i++){
          await tap(page,{row:0,col:0});await page.locator('#settings-button').click();
          if(i%2===0){await page.locator('#tutorial-help').click();await page.keyboard.press('Escape');}
          await page.locator('#settings-button').click();await ready(page);await tap(page,{row:0,col:0});
          const s=await state(page);assert.deepEqual(s.selected,{row:0,col:0});assert.equal(s.selectionMark,reduced);
          const scale=await page.evaluate(()=>({width:__motionGame.scale.canvasBounds.width,height:__motionGame.scale.canvasBounds.height,x:__motionGame.scale.displayScale.x,y:__motionGame.scale.displayScale.y}));
          assert.ok(scale.width>0&&scale.height>0&&Number.isFinite(scale.x)&&Number.isFinite(scale.y));samples.push(scale);
        }
        entry.checks.push('새 격리 문맥에서 고정 대기 없이 설정 왕복 10회·그중 안내 모달 5회·매회 실제 canvas 터치 선택·bounds/배율 유효');entry.samples=samples;report.cases.push(entry);continue;
      }
      const natural=await page.evaluate(()=>({move:__motionScene.engine.legalMoves()[0],save:JSON.parse(localStorage.getItem('pawblossom.save.v1'))}));
      await tap(page,natural.move.a);const selected=await state(page);assert.deepEqual(selected.selected,natural.move.a);
      assert.equal(selected.selectionMark,reduced);if(reduced)assert.ok(selected.pieces.every(p=>p.scale===1));
      await page.screenshot({path:`docs/screenshots/issue-70-${variant}-${reducedMotion}-${language}-${viewport.width}-selection.png`});
      await tap(page,natural.move.b);await ready(page);
      const played=await state(page),saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('pawblossom.save.v1')));
      assert.equal(played.log.results[0].valid,true);assert.equal(saved.inProgress.moves,natural.save.inProgress.moves-1);assert.ok(saved.inProgress.score>natural.save.inProgress.score);
      assert.ok(played.log.drops.every(d=>d.preserved));if(reduced){assert.ok(played.log.tweens.every(t=>!spatial(t)));assert.ok(played.log.drops.every(d=>d.positioned));}
      entry.checks.push('자연 보드 실제 두 칸 터치·엔진 유효 판정·이동 1회·점수/저장·생존 객체 보존');
      await fixture(page);const hintDelay=await page.evaluate(()=>__motionScene.hintTimer.delay);assert.equal(hintDelay,7500);
      await page.waitForTimeout(7700);const hinted=await state(page);assert.equal(hinted.hintMark,reduced);
      if(reduced)assert.ok(hinted.log.tweens.every(t=>!spatial(t)));else assert.ok(hinted.log.tweens.some(t=>t.scale===1.1));
      if(language==='ko'&&viewport.width===320)await page.screenshot({path:`docs/screenshots/issue-70-${variant}-${reducedMotion}-hint.png`});
      await tap(page,{row:0,col:0});assert.equal((await state(page)).hintMark,false);
      const cdp=await context.newCDPSession(page),q=await point(page,{row:0,col:1});
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:5,x:q.x,y:q.y}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
      assert.equal(await page.evaluate(()=>__motionScene.down===undefined),true);assert.equal((await state(page)).log.results.length,0);
      assert.deepEqual((await state(page)).selected,{row:0,col:0});assert.equal((await state(page)).selectionMark,reduced);
      // 기존 선택을 유지하는 취소와, 제스처가 canvas 밖에서 끝날 때의 전체 취소는 구분합니다.
      const outside=await point(page,{row:0,col:1});await page.mouse.move(outside.x,outside.y);await page.mouse.down();await page.mouse.move(1,1);await page.mouse.up();
      assert.equal((await state(page)).selected,undefined);assert.equal((await state(page)).selectionMark,false);await cdp.detach();
      await tap(page,{row:0,col:0});
      await page.locator('#settings-button').click();assert.equal((await state(page)).selected,undefined);assert.equal((await state(page)).selectionMark,false);assert.equal((await state(page)).hintMark,false);
      await page.locator('#tutorial-help').click();assert.equal(await page.locator('#tutorial-dialog').evaluate(e=>e.open),true);await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(()=>__motionScene.sys.isPaused()),true);await page.locator('#settings-button').click();await ready(page);
      entry.checks.push('실제 7.5초 힌트·조작 가능·다음 탭 정리·CDP touchCancel은 기존 선택 유지·pointerupoutside 전체 취소·설정/안내 pause/resume');
      await fixture(page);await tap(page,{row:0,col:0});await tap(page,{row:0,col:1});await ready(page);
      const invalid=await state(page);assert.equal(invalid.log.results[0]?.valid,false,JSON.stringify(await page.evaluate(()=>({trace:__inputTrace.slice(-8),scale:__scaleTrace.slice(-10),canvas:document.querySelector('canvas').getBoundingClientRect().toJSON(),bounds:__motionGame.scale.canvasBounds,dialogs:[...document.querySelectorAll('dialog[open]')].map(e=>e.id),input:__motionScene.input.enabled,route:document.querySelector('#puzzle-view').className}))));assert.deepEqual(invalid.log.waits,[140,150]);
      assert.ok(invalid.pieces.every((p,i)=>p.x===44+i%8*56&&p.y===44+Math.floor(i/8)*56&&p.scale===1));
      if(reduced)assert.ok(invalid.log.tweens.every(t=>!spatial(t)));
      await fixture(page);await tap(page,{row:3,col:2});await tap(page,{row:4,col:2});await ready(page);const matched=await state(page);
      assert.equal(matched.log.results[0].valid,true);assert.ok(matched.log.leaves.some(l=>l[3][1]===2));assert.ok(matched.log.leaves.some(l=>l[3][1]===1));
      if(reduced)assert.ok(matched.log.tweens.every(t=>!spatial(t)));
      await fixture(page);await page.evaluate(()=>{const s=__motionScene;s.engine.board[2][2].special='row';s.paint(s.engine.board);});
      await tap(page,{row:2,col:2});await ready(page);const single=await state(page);assert.equal(single.log.results[0].valid,true);
      assert.equal(single.log.results[0].method,'activate');
      assert.ok(single.log.leaves.some(l=>l[2][4]===2));assert.ok(single.log.leaves.some(l=>l[2][4]===0));assert.ok(single.log.drops.every(d=>d.preserved));
      if(reduced)assert.ok(single.log.tweens.every(t=>!spatial(t)));
      await fixture(page);await page.evaluate(()=>{const s=__motionScene;s.engine.board[2][2].special='row';s.engine.board[2][3].special='column';s.paint(s.engine.board);});
      const comboCdp=await context.newCDPSession(page),from=await point(page,{row:2,col:2}),to=await point(page,{row:2,col:3});
      await comboCdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:7,...from}]});await comboCdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:7,...to}]});await comboCdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await comboCdp.detach();
      await page.waitForFunction(()=>__motionScene.children.list.some(p=>p.depth===10&&p.commandBuffer?.length&&p.alpha>0));
      if(language==='ko'&&viewport.width===320)await page.screenshot({path:`docs/screenshots/issue-70-${variant}-${reducedMotion}-combo.png`});
      await ready(page);await page.waitForTimeout(600);const combo=await state(page);assert.ok(combo.log.results[0].steps[0].effects.length>=2);
      assert.equal(combo.log.results[0].method,'swap');
      assert.ok(combo.log.leaves.some(l=>l[2][4]===0));assert.equal(combo.effects,0);assert.ok(combo.log.drops.every(d=>d.preserved));
      if(reduced)assert.ok(combo.log.tweens.every(t=>!spatial(t)));
      entry.checks.push('fixture 실제 터치 무효 원복·특수 즉시 탭·콤보 교환·2→1/0 낙엽 단계·표시/엔진 제거 범위·effects 정리');
      await fixture(page);await tap(page,{row:0,col:0});await page.emulateMedia({reducedMotion:reduced?'no-preference':'reduce'});
      await page.locator('#game-canvas').focus();await page.keyboard.press('ArrowRight');const switched=await state(page);
      assert.equal(switched.selectionMark,!reduced);assert.equal(switched.cursorMark,true);assert.equal(switched.pieces[0].scale,reduced?1.12:1);
      await page.keyboard.press('Escape');assert.equal((await state(page)).selectionMark,false);
      await page.emulateMedia({reducedMotion});await fixture(page);await page.evaluate(()=>__motionScene.showHint());await page.emulateMedia({reducedMotion:reduced?'no-preference':'reduce'});
      await tap(page,{row:0,col:0});assert.equal((await state(page)).hintMark,false);await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
      assert.equal((await state(page)).selected,undefined);assert.ok((await state(page)).pieces.every(p=>p.scale===1));await page.emulateMedia({reducedMotion});
      await tap(page,{row:0,col:0});await page.locator('#shuffle').click();assert.equal((await state(page)).selected,undefined);assert.equal((await state(page)).selectionMark,false);
      const recovery=[];for(let i=0;i<5;i++){
        await page.locator('#settings-button').click();await page.locator('#settings-button').click();await ready(page);await fixture(page);await tap(page,{row:0,col:0});
        assert.deepEqual((await state(page)).selected,{row:0,col:0});recovery.push(await page.evaluate(()=>({width:__motionGame.scale.canvasBounds.width,scale:__motionGame.scale.displayScale.x})));
        await page.evaluate(()=>__motionScene.cancelInput());
      }
      for(let i=0;i<5;i++){await page.evaluate(()=>{window.__oldMotionScene=__motionScene;__motionScene.showHint();});await page.locator('#restart').click();await ready(page);
        assert.deepEqual(await page.evaluate(()=>({selected:__oldMotionScene.selected,hint:__oldMotionScene.hintMark,selection:__oldMotionScene.selectionMark,finished:__oldMotionScene.finished})),{selected:undefined,hint:undefined,selection:undefined,finished:true});await observe(page);}
      assert.equal(await page.locator('canvas').count(),1);assert.equal(await page.evaluate(()=>__motionGame.scene.scenes.length),1);
      const layout=await page.evaluate(()=>({viewport:innerWidth,width:document.documentElement.scrollWidth}));assert.ok(layout.width<=layout.viewport+1);
      entry.checks.push('현재 보드 설정 양방향 전환·키보드 커서/선택 구분·Escape/blur/shuffle·5회 숨김/복귀 실제 터치·5회 Scene 교체·canvas/Scene 1개·가로 넘침 없음');
      entry.samples={natural:{moves:saved.inProgress.moves,score:saved.inProgress.score},hintDelay,invalidWaits:invalid.log.waits,matchLeafTransitions:matched.log.leaves.map(l=>l[3][1]),singleLeafTransitions:single.log.leaves.map(l=>l[2][4]),singleMethod:single.log.results[0].method,comboLeafTransitions:combo.log.leaves.map(l=>l[2][4]),comboMethod:combo.log.results[0].method,comboOverlayObserved:true,comboEffects:combo.effects,dropCount:combo.log.drops.length,recovery,switched:{selection:switched.selectionMark,cursor:switched.cursorMark,scale:switched.pieces[0].scale}};
      report.cases.push(entry);
    }finally{await context.close();}
  }
  assert.deepEqual(report.pageerrors,[]);
  report.hashes=Object.fromEntries(await Promise.all(['src/main.ts','src/style.css','src/BoardScene.ts','src/BoardEffects.ts','src/reducedMotion.ts','tests/board-animation.test.ts','tests/ui-flow.test.ts','scripts/reduced-motion-qa.mjs'].map(async file=>[file,createHash('sha256').update(await fs.readFile(file)).digest('hex')])));
  const distFiles=['build-info.json','index.html',...(await fs.readdir(path.join(root,'assets'))).filter(file=>/\.(js|css)$/.test(file)).map(file=>'assets/'+file)];
  report.distHashes=Object.fromEntries(await Promise.all(distFiles.map(async file=>[file,createHash('sha256').update(await fs.readFile(path.join(root,file))).digest('hex')])));
  await fs.writeFile(`docs/performance/issue-70-${recoveryOnly?'scale-recovery':'reduced-motion'}-${variant}-20261016.json`,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({variant,cases:report.cases.length,pageerrors:report.pageerrors}));
}finally{await browser.close();}
