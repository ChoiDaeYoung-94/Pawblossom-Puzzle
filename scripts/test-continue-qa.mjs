import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';

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
  scope:'격리 Chrome 실제 dist. 합성 준비는 고정 seed42 엔진/보드와 기존 낙엽을 scene에 주입·paint한 뒤 onMove로 이동을1로 줄이거나 목표를 채움. 실제 앱 목표/판정은 변경하지 않음. 실패 직전/이어하기 후 플레이는 실제 canvas 마우스 입력. 광고/Android/실서비스 검증 아님.',
  cases:[],boundaries:[],pageerrors:[]};
async function open(language,viewport){
  const context=await browser.newContext({viewport,reducedMotion:'reduce'}),page=await context.newPage();
  page.setDefaultTimeout(10000);page.on('pageerror',e=>report.pageerrors.push(e.message));
  await context.addInitScript(language=>localStorage.setItem('pawblossom.save.v1',JSON.stringify({version:1,language,highestLevel:1,completed:[],stars:0,coins:0,garden:0,music:false,sfx:false,tutorialSeen:true})),language);
  await page.route('http://continue.pawblossom.invalid/**',async route=>{
    const url=new URL(route.request().url()),file=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));
    assert.ok(file.startsWith(root+path.sep));
    if(file.endsWith('.js')){
      let source=await fs.readFile(file,'utf8');const calls=source.match(/new [\w$.]+\.Game\(\{type:/g)??[];
      if(calls.length){assert.equal(calls.length,1);source=source.replace(calls[0],'window.__continueGame='+calls[0]);}
      await route.fulfill({body:source,contentType:'text/javascript'});
    }else await route.fulfill({path:file});
  });
  await page.goto('http://continue.pawblossom.invalid');
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
try{
  for(const language of ['ko','en'])for(const viewport of [{width:320,height:568},{width:360,height:640},{width:640,height:360}]){
    console.log(`${variant} ${language} ${viewport.width} 이어하기 검사`);
    const {page,context}=await open(language,viewport);
    try{
      if(!flags.testTools){
        assert.equal(await page.locator('#test-level-button').count(),0);await prepareLastMove(page);await play(page);await result(page);
        assert.equal(await page.locator('#result-continue').count(),0);report.cases.push({language,viewport,productionContinueAbsent:true,realFailureInput:true});continue;
      }
      await testLevel(page);const before=await disk(page);
      await prepareLastMove(page);await play(page);await result(page);
      assert.match(await page.locator('#result-continue-note').textContent(),language==='ko'?/광고 없이/:/without ads/);
      const layout=await checkLayout(page,viewport);await remember(page);
      await page.locator('#result-continue').scrollIntoViewIfNeeded();
      await page.screenshot({path:path.join(output,`continue-${language}-${viewport.width}.png`)});
      await page.locator('#result-continue').click();await ready(page);assert.equal(await page.locator('#moves').textContent(),'5');
      await assertPreserved(page);assert.deepEqual(await disk(page),before);
      // 이전 DOM callback 두 번을 직접 실행해도 추가 이동이 없습니다.
      await page.evaluate(()=>{__continueBefore.callback.call(__continueBefore.button);__continueBefore.callback.call(__continueBefore.button);});
      assert.equal(await page.locator('#moves').textContent(),'5');
      await play(page);assert.equal(await page.locator('#moves').textContent(),'4');assert.deepEqual(await disk(page),before);
      await prepareLastMove(page);await play(page);await result(page);assert.equal(await page.locator('#result-continue').count(),0);
      await page.evaluate(()=>__continueBefore.callback.call(__continueBefore.button));assert.equal(await page.locator('#moves').textContent(),'0');
      assert.deepEqual(await disk(page),before);
      // 재시작은 새 회차입니다. 이어하기 후 실제 입력이 동작하고 시험 성공도 원래 hooks로 처리합니다.
      await page.locator('#result-next').click();await ready(page);await seedScene(page);await prepareLastMove(page);await play(page);await result(page);await remember(page);
      await page.evaluate(()=>{const b=document.querySelector('#result-continue');b.click();b.click();});await ready(page);
      assert.equal(await page.locator('#moves').textContent(),'5');await play(page);
      await page.evaluate(()=>__continueGame.scene.getScene('Board').hooks.onMove([99,99,99,99,99,99],1000,1,64));await result(page);
      assert.equal(await page.locator('#result-continue').count(),0);assert.deepEqual(await disk(page),before);
      report.cases.push({language,viewport,layout,realInputMoves:5,identityPreserved:true,secondFailureBlocked:true,restartOneUse:true,rapidClicksBlocked:true,syntheticSuccessAfterRealPlay:true,storageBytesUnchanged:true});
    }finally{await context.close();}
  }
  if(flags.testTools){
    const {page,context}=await open('ko',{width:360,height:640});
    try{
      // development/testing 빌드의 일반 회차도 기능이 없습니다.
      await prepareLastMove(page);await play(page);await result(page);assert.equal(await page.locator('#result-continue').count(),0);
      await page.locator('#result-home').click();await page.locator('[data-route="puzzle"]').click();await testLevel(page);
      await prepareLastMove(page);await play(page);await result(page);await remember(page);
      // 열린 모달 뒤 언어 버튼은 사용자 입력에는 inert입니다. 아래 DOM click은 언어 갱신 경계 fixture입니다.
      const languageBoundary=await page.evaluate(()=>{
        window.__savedContinue=__continueBefore;const button=__savedContinue.button,callback=button.onclick;
        button.focus();document.querySelector('#language-toggle').click();
        const en=button.textContent,focus=document.activeElement===button;
        document.querySelector('#language-toggle').click();
        return {sameNode:button===document.querySelector('#result-continue'),sameCallback:callback===button.onclick,en,ko:button.textContent,focus};
      });
      assert.deepEqual(languageBoundary,{sameNode:true,sameCallback:true,en:'Test continue +5 moves',ko:'시험 이어하기 +5',focus:true});
      await page.locator('#result-home').click();
      await page.evaluate(()=>__savedContinue.callback.call(__savedContinue.button));assert.equal(await page.locator('#moves').textContent(),'0');
      await page.locator('[data-route="puzzle"]').click();await testLevel(page);await prepareLastMove(page);await play(page);await result(page);
      await page.evaluate(()=>__savedContinue.callback.call(__savedContinue.button));assert.equal(await page.locator('#moves').textContent(),'0');
      await page.locator('#result-continue').click();assert.equal(await page.locator('#moves').textContent(),'5');
      report.boundaries.push({normalRoundAbsent:true,homeStaleCallbackBlocked:true,newRoundStaleCallbackBlocked:true,languageRefreshDomClickFixture:languageBoundary});
    }finally{await context.close();}
  }
  assert.deepEqual(report.pageerrors,[]);
}finally{
  await browser.close();await fs.writeFile(path.join(output,'summary.json'),JSON.stringify(report,null,2)+'\n');
}
console.log(JSON.stringify({variant,cases:report.cases.length,boundaries:report.boundaries.length,pageerrors:report.pageerrors},null,2));
