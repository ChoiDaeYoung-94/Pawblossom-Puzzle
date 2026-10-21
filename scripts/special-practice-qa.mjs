import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';

// 제품 응답을 수정하지 않는 실제 dist·격리 Chrome 검사입니다. Git 문서는 쓰지 않습니다.
const output=process.argv.find(arg=>arg.startsWith('--output='))?.slice(9);
const modulePath=process.argv.find(arg=>arg.startsWith('--playwright='))?.slice(13)??process.env.PAWBLOSSOM_PLAYWRIGHT_MODULE;
assert(output&&modulePath,'--output=새 QA 폴더와 --playwright=모듈 경로가 필요합니다.');
await fs.mkdir(output,{recursive:false});
const root=path.resolve('dist'),flags=JSON.parse(await fs.readFile(path.join(root,'build-info.json'),'utf8'));
const {chromium}=await import(pathToFileURL(modulePath).href);
const browser=await chromium.launch({headless:true,channel:'chrome'});
const report={dateKst:'2026-10-21',variant:flags.testTools?'testing':'production',flags,browser:browser.version(),
  scope:'실제 dist 응답 그대로·자체 route·격리 headless Chrome. 기존 사용자 창/서버/계정 사용 없음. 합성 초기 저장 외 실제 DOM·Phaser·pointer·키보드. Android/청취/이해도 측정 아님.',samples:[],pageerrors:[]};
const stored=page=>page.evaluate(()=>Object.fromEntries(Object.entries(localStorage)));
const open=async page=>{
  await page.locator('#tutorial-help').click();
  for(let i=0;i<3;i++)await page.locator('#guide-next').click();
};
const match=async (page,touch=false)=>{
  await page.evaluate(()=>{window.qaMatchEvents=[];for(const type of ['pointerdown','pointerup','mousedown','mouseup','click','focusin'])document.addEventListener(type,event=>window.qaMatchEvents.push({type,target:event.target.id,active:document.activeElement?.id}),true);});
  if(touch){await page.locator('#practice-cell-0-2').tap();await page.locator('#practice-cell-1-2').tap();}
  else{
    await page.locator('#practice-cell-0-2').focus();await page.keyboard.press('Enter');
    await page.locator('#practice-cell-1-2').focus();await page.keyboard.press('Space');
  }
  assert.equal(await page.locator('#guide-next').isEnabled(),true);
};
async function screen(page,label){await page.screenshot({path:path.join(output,label+'.png')});}
async function accessible(page){
  const result=await page.evaluate(()=>({
    outerOverflow:document.documentElement.scrollWidth>innerWidth||document.documentElement.scrollHeight>innerHeight,
    horizontalOverflow:document.querySelector('#tutorial-dialog').scrollWidth>document.querySelector('#tutorial-dialog').clientWidth,
    controls:[...document.querySelectorAll('#tutorial-dialog button:not(:disabled)')].map(button=>({id:button.id,width:button.getBoundingClientRect().width,height:button.getBoundingClientRect().height})),
    boardHeight:document.querySelector('#practice-board').getBoundingClientRect().height,
  }));
  assert.equal(result.outerOverflow,false);assert.equal(result.horizontalOverflow,false);
  assert(result.controls.every(button=>button.width>=44&&button.height>=44),JSON.stringify(result.controls));
  for(const id of ['guide-next','guide-back','guide-skip']){
    const button=page.locator('#'+id);await button.scrollIntoViewIfNeeded();
    assert.equal(await button.evaluate(button=>{const r=button.getBoundingClientRect(),d=button.closest('dialog').getBoundingClientRect();return r.top>=Math.max(0,d.top)&&r.bottom<=Math.min(innerHeight,d.bottom);}),true,id+' 모달 스크롤 접근');
  }
  return result;
}
try{
  for(const language of ['ko','en'])for(const viewport of [{width:320,height:568},{width:390,height:844},{width:640,height:360}])for(const reducedMotion of ['reduce','no-preference']){
    const label=`${language}-${viewport.width}-${reducedMotion}`,context=await browser.newContext({viewport,hasTouch:true,reducedMotion});
    try{
      const page=await context.newPage();page.on('pageerror',error=>report.pageerrors.push(error.message));
      await page.addInitScript(language=>{
        localStorage.setItem('qa.unrelated','보존');
        localStorage.setItem('pawblossom.save.v1',JSON.stringify({version:1,language,highestLevel:2,completed:[1],stars:1,coins:40,garden:0,music:false,sfx:false,tutorialSeen:true}));
      },language);
      await page.route('http://special.pawblossom.invalid/**',route=>{
        const url=new URL(route.request().url()),file=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));
        assert(file.startsWith(root+path.sep));return route.fulfill({path:file});
      });
      await page.goto('http://special.pawblossom.invalid');
      await page.waitForFunction(()=>document.querySelector('#game-canvas')?.tabIndex===0&&JSON.parse(localStorage.getItem('pawblossom.save.v1')).inProgress);
      assert.equal(await page.locator('#tutorial-dialog').evaluate(d=>d.open),false,'기존 tutorialSeen 호환');
      assert.equal(await page.locator('#test-level-button').count(),flags.testTools?1:0);
      const bootStored=await stored(page);
      await page.locator('#settings-button').click();
      // 첫 checkpoint 이전 backup이 남은 fixture를 기존 닫기/persist 경로로 정상 회전합니다.
      await page.locator('#tutorial-help').click();await page.locator('#guide-skip').click();
      const baseline=await stored(page);
      assert.deepEqual(baseline,{...bootStored,'pawblossom.save.v1.backup':bootStored['pawblossom.save.v1']});
      await open(page);
      const initialHeight=await page.locator('.guide-content').evaluate(el=>el.getBoundingClientRect().height);
      const initialGridHeight=await page.locator('#practice-board').evaluate(el=>el.getBoundingClientRect().height);
      assert.equal(await page.locator('#practice-special').count(),0);
      await match(page,reducedMotion==='reduce');
      if(!await page.locator('#tutorial-dialog').evaluate(d=>d.open)){
        await fs.writeFile(path.join(output,label+'-match-events.json'),JSON.stringify(await page.evaluate(()=>window.qaMatchEvents),null,2));
        assert.fail('실제 touch 매치 뒤 안내가 닫혔습니다.');
      }
      await accessible(page);await screen(page,label+'-choice');
      const choiceHeight=await page.locator('.guide-content').evaluate(el=>el.getBoundingClientRect().height);
      const choiceGridHeight=await page.locator('#practice-board').evaluate(el=>el.getBoundingClientRect().height);
      await page.locator('#practice-special').click();
      assert.equal(await page.locator('#practice-cell-1-1').evaluate(el=>el===document.activeElement),true);
      assert.equal(await page.locator('#guide-next').isEnabled(),true);
      assert.equal(await page.locator('.guide-dots i').count(),4);
      assert.equal(await page.locator('#practice-board button:enabled').count(),1);
      assert.equal(await page.locator('#practice-cell-1-1').getAttribute('class').then(value=>value.includes('special-0')),true);
      // 기존 CSS에서 활성/비활성 테두리 두께가 달라 완료 화면보다 최대 4px 달라집니다.
      // 원래 교환 실습의 활성 화면과 비교해 격자·전체 콘텐츠가 늘지 않는지 확인합니다.
      const layout=await accessible(page);assert(layout.boardHeight<=initialGridHeight);
      layout.heights={initialContent:initialHeight,choiceContent:choiceHeight,specialContent:await page.locator('.guide-content').evaluate(el=>el.getBoundingClientRect().height),initialGrid:initialGridHeight,choiceGrid:choiceGridHeight,specialGrid:layout.boardHeight};
      layout.heights.choiceToSpecialContentDelta=layout.heights.specialContent-choiceHeight;
      layout.heights.choiceToSpecialGridDelta=layout.boardHeight-choiceGridHeight;
      assert(await page.locator('.guide-content').evaluate(el=>el.getBoundingClientRect().height)<=initialHeight+2,'기존 실습보다 세로 콘텐츠 증가 없음');
      await page.locator('#tutorial-title').scrollIntoViewIfNeeded();await screen(page,label+'-special-top');
      await page.locator('#practice-cell-1-1').scrollIntoViewIfNeeded();await screen(page,label+'-special');
      const center=await page.locator('#practice-cell-1-1').boundingBox(),point={x:center.x+center.width/2,y:center.y+center.height/2};
      const cdp=await context.newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...point,id:1}]});
      await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
      await page.locator('#practice-cell-1-1').dispatchEvent('click',{detail:1,button:0});
      assert.equal(await page.locator('.practice-cleared').count(),0);
      for(const end of [{x:point.x+40,y:point.y},{x:point.x,y:point.y+40}]){
        await page.mouse.move(point.x,point.y);await page.mouse.down();await page.mouse.move(end.x,end.y);await page.mouse.up();
      }
      await page.locator('#practice-cell-0-0').dispatchEvent('click',{detail:0,button:0});
      assert.equal(await page.locator('.practice-cleared').count(),0);
      assert.deepEqual(await stored(page),baseline);
      await page.evaluate(()=>{window.qaEvents=[];for(const type of ['focusin','focusout','pointerdown','pointerup','mousedown','mouseup','click','touchend'])document.addEventListener(type,event=>window.qaEvents.push({type,target:event.target.id,active:document.activeElement?.id}),true);});
      if(reducedMotion==='reduce')await page.touchscreen.tap(point.x,point.y);
      else{await page.locator('#practice-cell-1-1').focus();await page.keyboard.press(language==='ko'?'Enter':'Space');}
      assert.equal(await page.locator('.practice-cleared').count(),3);
      await fs.writeFile(path.join(output,label+'-input-events.json'),JSON.stringify(await page.evaluate(()=>({active:document.activeElement?.outerHTML,events:window.qaEvents})),null,2));
      assert.equal(await page.locator('#guide-next').evaluate(el=>el===document.activeElement),true);
      const completed=await page.locator('#practice-board').innerHTML();
      await page.locator('#practice-cell-1-1').dispatchEvent('click',{detail:0,button:0});
      assert.equal(await page.locator('#practice-board').innerHTML(),completed);
      assert.deepEqual(await stored(page),baseline);await accessible(page);await screen(page,label+'-done');
      await page.locator('#guide-back').click();await page.locator('#guide-next').click();
      assert.equal(await page.locator('#guide-next').isDisabled(),true);assert.equal(await page.locator('#practice-special').count(),0);
      await match(page);await page.locator('#guide-next').click(); // 선택 실습 없이 즉시 시작
      assert.equal(await page.locator('#tutorial-dialog').evaluate(d=>d.open),false);
      assert.deepEqual(await stored(page),baseline);
      for(const exit of ['start','escape','skip']){
        await open(page);await match(page);await page.locator('#practice-special').click();
        if(exit==='escape')await page.keyboard.press('Escape');else await page.locator(exit==='start'?'#guide-next':'#guide-skip').click();
        assert.equal(await page.locator('#tutorial-dialog').evaluate(d=>d.open),false);assert.deepEqual(await stored(page),baseline);
      }
      await page.locator('[data-route="puzzle"]').click();
      await page.locator('#game-canvas').focus();await page.keyboard.press('Enter');await page.keyboard.press('Escape');
      assert.deepEqual(await stored(page),baseline,'복귀한 실제 본판에서 선택·취소는 저장 무변경');
      await cdp.detach();report.samples.push({language,viewport,reducedMotion,layout,storageSha256:createHash('sha256').update(JSON.stringify(baseline)).digest('hex'),checks:['KOEN 4페이지·선택 진입·중앙 초점','44px·외부 overflow 없음·모달 스크롤 접근·세로 콘텐츠 유지','실제 touchcancel·가로/세로 swipe·다른칸·중복 무변경','실제 tap 또는 Enter/Space·가로 3칸·시작 초점','이전/재진입 초기화·선택 실습 생략·미완료 start/skip/Escape','전체 localStorage·일반 회차 보존·본판 선택/취소 복귀']});
    }finally{await context.close();await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');}
  }
  assert.deepEqual(report.pageerrors,[]);assert.equal(report.samples.length,12);
  console.log(JSON.stringify({variant:report.variant,samples:report.samples.length,pageerrors:report.pageerrors}));
}finally{await browser.close();}
