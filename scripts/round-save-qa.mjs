import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
// 선택적 로컬 QA. 기존 Vite 개발 서버와 설치된 Playwright/Chrome을 사용합니다.
// QA 컨텍스트에서만 관찰용 접근자를 추가하며 사용자 Chrome과 출시 코드는 변경하지 않습니다.
const modulePath=process.env.PAWBLOSSOM_PLAYWRIGHT_MODULE;
const {chromium}=await import(modulePath?pathToFileURL(path.resolve(modulePath)).href:'playwright');
const browser=await chromium.launch({headless:true,channel:'chrome'});
const checks=[];const errors=[];
try {
  const context=await browser.newContext({viewport:{width:390,height:844}});
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/src/main.ts',async route=>{
    const response=await route.fetch();
    await route.fulfill({response,body:(await response.text())+'\nwindow.__qa={get scene(){return scene},get game(){return game},get moves(){return moves},get testing(){return testingLevel},get score(){return score},get cleared(){return clearedLeaves},setActive(value){nativeActive=value;syncActivity()}};'});
  });
  const ready=async()=>{await page.waitForFunction(()=>window.__qa?.scene?.sys?.isActive()&&document.querySelector('canvas'));};
  const stored=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('pawblossom.save.v1')));
  const reload=async()=>{await page.reload();await ready();};
  const seed=async(id,mode='normal')=>{
    await page.evaluate(async({id,mode})=>{
      const {BoardEngine,seededRng}=await import('/src/core/index.ts');
      const {levels,levelSignature}=await import('/src/state.ts');const level=levels[id-1];
      const engine=new BoardEngine(8,8,seededRng(42));engine.setLeaves(level.leaves??[]);
      engine.board[2][2].special=mode==='win'?'rainbow':'row';
      if(mode==='win')engine.board[2][2].kind=0;
      const checkpoint={schema:1,levelId:id,levelSignature:levelSignature(level),board:engine.board,leaves:engine.leaves,
        moves:mode==='lose'?1:level.moves,score:0,collected:mode==='win'?[11,10,0,0,0,0]:[0,0,0,0,0,0],shuffles:1,clearedLeaves:0};
      const save={version:1,language:'ko',highestLevel:id,completed:Array.from({length:id-1},(_,i)=>i+1),stars:id-1,coins:(id-1)*40,garden:1,music:false,sfx:false,tutorialSeen:true,inProgress:checkpoint};
      localStorage.setItem('pawblossom.save.v1',JSON.stringify(save));
    },{id,mode});await reload();
  };
  await page.goto('http://127.0.0.1:5173');
  await page.locator('#guide-skip').click();await ready();
  await seed(6);
  const original=await stored();
  // 실제 캔버스의 특수 타일을 탭합니다.
  const box=await page.locator('canvas').boundingBox();
  await page.mouse.click(box.x+156/480*box.width,box.y+156/480*box.height);
  await page.waitForFunction(()=>window.__qa.scene.busy);
  assert.deepEqual((await stored()).inProgress,original.inProgress);
  await page.evaluate(()=>window.__qa.setActive(false));
  await page.waitForTimeout(650);assert.deepEqual((await stored()).inProgress,original.inProgress);
  await reload();assert.deepEqual((await stored()).inProgress,original.inProgress);
  checks.push('연쇄·앱 숨김 중 직전 안정 상태를 보존하고 새로고침 복원');
  await page.evaluate(()=>void window.__qa.scene.attempt({row:2,col:2}));
  await page.waitForFunction(()=>!window.__qa.scene.busy&&window.__qa.moves===27);
  const played=await stored();assert.ok(played.inProgress.clearedLeaves>=2);assert.ok(played.inProgress.score>0);
  await reload();assert.deepEqual(await stored(),played);
  assert.deepEqual(await page.evaluate(()=>({board:window.__qa.scene.engine.board,leaves:window.__qa.scene.engine.leaves})),{board:played.inProgress.board,leaves:played.inProgress.leaves});
  await page.screenshot({path:'docs/screenshots/round-save-recovery-mobile.png',fullPage:true});
  checks.push('특수 발동·낙엽 두 겹 제거·이동·수집·점수 실제 복원');
  await page.locator('#shuffle').click();const shuffled=await stored();assert.equal(shuffled.inProgress.shuffles,0);
  await reload();assert.deepEqual(await stored(),shuffled);assert.ok(await page.locator('#shuffle').isDisabled());checks.push('무료 섞기 보드·사용 횟수 복원');
  await page.locator('#test-level-button').click();await page.locator('#test-chapter-3').click();await page.locator('[data-test-level="30"]').click();await ready();
  await page.evaluate(()=>{const {a,b}=window.__qa.scene.engine.legalMoves()[0];void window.__qa.scene.attempt(a,b);});
  await page.waitForFunction(()=>!window.__qa.scene.busy&&window.__qa.moves===33);assert.deepEqual(await stored(),shuffled);
  await page.locator('#test-level-button').click();await page.locator('#test-normal').click();await ready();assert.deepEqual(await stored(),shuffled);
  await page.locator('#test-level-button').click();await page.locator('[data-test-level="6"]').click();await ready();await reload();assert.equal(await page.evaluate(()=>window.__qa.testing),false);assert.deepEqual(await stored(),shuffled);
  checks.push('시험 이동·일반 복귀·시험 중 재실행은 정상 회차 유지');
  await page.evaluate(()=>{const save=JSON.parse(localStorage.getItem('pawblossom.save.v1'));save.inProgress.board[0][0].kind=99;localStorage.setItem('pawblossom.save.v1',JSON.stringify(save));});
  await reload();const repaired=await stored();assert.equal(repaired.coins,200);assert.equal(repaired.stars,5);assert.equal(repaired.garden,1);assert.equal(repaired.inProgress.score,0);checks.push('손상 회차만 폐기하고 영구 기록 유지');
  await page.locator('#language-toggle').click();await page.locator('#settings-button').click();assert.match(await page.locator('.save-note').textContent(),/Cloud and other-device/);await page.locator('#settings-button').click();
  const preFailure=await stored();await page.evaluate(()=>{Storage.prototype.setItem=()=>{throw Error('QA 저장 실패');};});await page.locator('#shuffle').click();assert.match(await page.locator('#toast').textContent(),/Storage is unavailable/);assert.deepEqual(await stored(),preFailure);await reload();checks.push('영문 안내·저장 실패 시 이전 디스크 상태 유지');
  await seed(1,'win');await page.evaluate(()=>void window.__qa.scene.attempt({row:2,col:2}));
  await page.waitForFunction(()=>{const saved=JSON.parse(localStorage.getItem('pawblossom.save.v1'));return saved.completed.includes(1)&&!saved.inProgress;},{},{polling:10});
  assert.equal(await page.locator('#result-dialog').evaluate(d=>d.open),false);await reload();const won=await stored();assert.equal(won.coins,40);assert.equal(won.stars,1);assert.equal(won.highestLevel,2);checks.push('결과창 300ms 전 종료 후 완료 보상 유지·중복 지급 없음');
  await seed(6,'lose');await page.evaluate(()=>void window.__qa.scene.attempt({row:2,col:2}));await page.waitForFunction(()=>!JSON.parse(localStorage.getItem('pawblossom.save.v1')).inProgress,{},{polling:10});await reload();assert.equal((await stored()).inProgress.moves,28);assert.equal((await stored()).coins,200);checks.push('실패 결과창 전 종료 후 종료된 회차 복원 방지');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({checks:checks.length,details:checks,pageerrors:errors},null,2));
} finally {await browser.close();}
