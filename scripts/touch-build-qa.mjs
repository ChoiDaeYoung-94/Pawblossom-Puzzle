import path from 'node:path';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';

// dist를 가상 origin에 그대로 제공합니다. 제품 JS와 Phaser는 수정/대역 처리하지 않습니다.
const modulePath=process.env.PAWBLOSSOM_PLAYWRIGHT_MODULE;
const {chromium}=await import(modulePath?pathToFileURL(path.resolve(modulePath)).href:'playwright');
const browser=await chromium.launch({headless:true,channel:'chrome'});
const flags=JSON.parse(fs.readFileSync('dist/build-info.json','utf8'));
const variant=flags.testTools?'testing':'production';
const report={dateKst:'2026-10-16',variant,flags,browser:browser.version(),environment:'최종 웹 dist, 격리 headless Chrome/CDP 실제 터치, 가상 route. 실제 Android 단말 검증은 아님.',samples:[],pageerrors:[]};
try{
  for(const language of ['ko','en'])for(const viewport of [{width:390,height:844},{width:640,height:360}]){
    const context=await browser.newContext({viewport,hasTouch:true}),page=await context.newPage();page.on('pageerror',e=>report.pageerrors.push(e.message));
    await page.addInitScript(language=>{if(!localStorage.getItem('pawblossom.save.v1'))localStorage.setItem('pawblossom.save.v1',JSON.stringify({version:1,language,highestLevel:1,completed:[],stars:0,coins:0,garden:0,music:false,sfx:false,tutorialSeen:true}));},language);
    await page.route('http://built.pawblossom.invalid/**',route=>{
      const url=new URL(route.request().url()),file=path.resolve('dist','.'+(url.pathname==='/'?'/index.html':url.pathname));
      assert.ok(file.startsWith(path.resolve('dist')+path.sep));return route.fulfill({path:file});
    });
    await page.goto('http://built.pawblossom.invalid');await page.waitForFunction(()=>document.querySelector('canvas')&&JSON.parse(localStorage.getItem('pawblossom.save.v1')).inProgress);
    await page.evaluate(()=>{
      const save=JSON.parse(localStorage.getItem('pawblossom.save.v1'));save.inProgress.board=Array.from({length:8},(_,r)=>Array.from({length:8},(_,c)=>({kind:(r*2+c)%6})));save.inProgress.board[3][3].special='row';
      localStorage.clear();localStorage.setItem('pawblossom.save.v1',JSON.stringify(save));
    });
    await page.reload();await page.waitForFunction(()=>document.querySelector('#game-canvas').tabIndex===0);
    assert.equal(await page.locator('#test-level-button').count(),flags.testTools?1:0);
    const allStored=()=>page.evaluate(()=>Object.fromEntries(Object.entries(localStorage)));
    const before=await allStored();const box=await page.locator('canvas').boundingBox();
    const point={x:box.x+(44+3*56)*box.width/480,y:box.y+(44+3*56)*box.height/480};
    const cdp=await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...point,id:1}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
    assert.deepEqual(await allStored(),before);
    await page.touchscreen.tap(point.x,point.y);
    await page.waitForFunction(moves=>JSON.parse(localStorage.getItem('pawblossom.save.v1')).inProgress?.moves===moves-1,JSON.parse(before['pawblossom.save.v1']).inProgress.moves);
    const after=await allStored();assert.ok(JSON.parse(after['pawblossom.save.v1']).inProgress.score>0);
    await page.reload();await page.waitForFunction(()=>document.querySelector('#game-canvas').tabIndex===0);
    const reloaded=await allStored();assert.equal(reloaded['pawblossom.save.v1'],after['pawblossom.save.v1']);
    // 복원 시 정상 저장을 재기록하므로 #58의 backup은 최신 정상 회차로 회전합니다.
    assert.equal(reloaded['pawblossom.save.v1.backup'],reloaded['pawblossom.save.v1']);
    await page.locator('#settings-button').click();await page.locator('#tutorial-help').click();for(let i=0;i<3;i++)await page.locator('#guide-next').click();
    const first=page.locator('#practice-cell-0-2'),second=page.locator('#practice-cell-1-2');const rect=await first.boundingBox();
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:rect.x+rect.width/2,y:rect.y+rect.height/2,id:1}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
    await first.dispatchEvent('click',{detail:1,button:0});assert.equal(await first.getAttribute('aria-pressed'),'false');assert.equal(await page.locator('#guide-next').isDisabled(),true);
    await first.focus();await page.keyboard.press('Enter');await second.focus();await page.keyboard.press('Space');assert.equal(await page.locator('#guide-next').isDisabled(),false);
    assert.deepEqual(await allStored(),reloaded);
    report.samples.push({language,viewport,checks:['실제 특수 touchcancel은 모든 저장 불변','다음 실제 특수 tap 이동 1회·점수·새로고침 복원','실습 cancel→합성 click 무실행·Enter/Space 정상·본 게임 불변','testing/production 시험 진입 구분']});
    await context.close();
  }
  assert.deepEqual(report.pageerrors,[]);fs.writeFileSync(`docs/performance/touch-${variant}-20261016.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
