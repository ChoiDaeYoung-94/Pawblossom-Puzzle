import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';

// 실제 dist를 격리 Chrome에 제공하며 JS 응답의 Game 참조만 관찰합니다.
// 파일/출시 코드와 Phaser 판정은 수정하지 않습니다. Android 검증과 구분합니다.
const modulePath=process.env.PAWBLOSSOM_PLAYWRIGHT_MODULE;
const {chromium}=await import(modulePath?pathToFileURL(path.resolve(modulePath)).href:'playwright');
const root=path.resolve('dist'),flags=JSON.parse(await fs.readFile(path.join(root,'build-info.json'),'utf8'));
const variant=flags.testTools?'testing':'production';
const report={dateKst:'2026-10-16',variant,flags,browser:'',environment:'격리 headless Chrome·실제 dist·Game 참조만 응답에 노출. 결과는 실제 Scene onMove 콜백으로 종료 판정/300ms 타이머를 통과. Android 단말·WebView·강제 종료·APK 미검증.',assets:[],cases:[],boundaries:[],pageerrors:[]};
const browser=await chromium.launch({headless:true,channel:'chrome'});report.browser=browser.version();
const outcomePath=won=>`/assets/pip-${won?'win':'retry'}-v1.webp`;
async function openCase({language='ko',viewport={width:320,height:568},replay=false,reducedMotion='reduce',failure,gateImages=true}={}){
  const context=await browser.newContext({viewport,reducedMotion}),page=await context.newPage(),requests=[];
  page.setDefaultTimeout(10000);
  let release;const gate=new Promise(resolve=>{release=resolve;});
  page.on('pageerror',error=>report.pageerrors.push(error.message));
  await context.addInitScript(({language,replay})=>localStorage.setItem('pawblossom.save.v1',JSON.stringify({version:1,language,highestLevel:1,completed:replay?[1]:[],stars:replay?1:0,coins:replay?40:0,garden:0,music:false,sfx:false,tutorialSeen:true})),{language,replay});
  await page.route('http://result.pawblossom.invalid/**',async route=>{
    const url=new URL(route.request().url()),file=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));
    assert.ok(file.startsWith(root+path.sep));
    if(/pip-(win|retry)-v1\.webp$/.test(file)){
      requests.push(url.pathname);if(gateImages)await gate;
      if(failure==='blocked'){await route.abort('failed');return;}
      if(failure==='404'){await route.fulfill({status:404,body:'missing'});return;}
      if(failure==='corrupt'){await route.fulfill({contentType:'image/webp',body:'not an image'});return;}
    }
    if(file.endsWith('.js')){
      let source=await fs.readFile(file,'utf8');const calls=source.match(/new [\w$.]+\.Game\(\{type:/g)??[];
      if(calls.length){assert.equal(calls.length,1);source=source.replace(calls[0],'window.__resultGame='+calls[0]);}
      await route.fulfill({body:source,contentType:'text/javascript'});
    }else await route.fulfill({path:file});
  });
  await page.goto('http://result.pawblossom.invalid');
  // startLevel의 저장은 POST_RENDER 교체보다 먼저입니다. 이전 active Scene을 새 보드로 오인하지 않습니다.
  const ready=()=>page.waitForFunction(()=>{
    const scene=window.__resultGame?.scene.getScene('Board'),saved=JSON.parse(localStorage.getItem('pawblossom.save.v1')).inProgress;
    return scene?.keyboardState().available&&saved&&JSON.stringify(scene.engine.board)===JSON.stringify(saved.board);
  });
  await ready();await page.waitForLoadState('networkidle');assert.deepEqual(requests,[],'첫 결과 전 전용 아트 요청 0');
  const saved=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('pawblossom.save.v1')));
  const finish=async won=>{
    await page.evaluate(won=>{
      const scene=__resultGame.scene.getScene('Board');
      if(won)scene.hooks.onMove([99,99,99,99,99,99],220,1,0);
      else for(let i=0;i<26;i++)scene.hooks.onMove([0,0,0,0,0,0],0,1,0);
    },won);
  };
  return {context,page,requests,release,ready,saved,finish};
}
const layout=page=>page.evaluate(()=>{
  const dialog=document.querySelector('#result-dialog'),stage=document.querySelector('.result-stage'),character=document.querySelector('.result-character');
  const rect=el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right};};
  return {dialog:rect(dialog),stage:rect(stage),character:{width:character.offsetWidth,height:character.offsetHeight},scroll:{client:dialog.clientHeight,height:dialog.scrollHeight,body:document.documentElement.scrollHeight,viewport:innerHeight},image:{src:document.querySelector('.result-pip').getAttribute('src'),decoded:document.querySelector('.result-pip').complete&&document.querySelector('.result-pip').naturalWidth>0},animation:getComputedStyle(character).animationName,focused:document.activeElement.id,buttons:[...dialog.querySelectorAll('button')].map(el=>({id:el.id,...rect(el)}))};
});
const assertLayout=(data,viewport)=>{
  assert.ok(data.dialog.x>=0&&data.dialog.y>=0&&data.dialog.right<=viewport.width+1&&data.dialog.bottom<=viewport.height+1);
  const testContinue=data.buttons.some(button=>button.id==='result-continue');
  if(!testContinue)assert.ok(data.scroll.height<=data.scroll.client+1,'일반/시험 성공 결과는 내부 스크롤 없는 한 화면');
  assert.ok(data.scroll.body<=viewport.height,'body 스크롤 없음');
  for(const b of data.buttons){assert.ok(b.width>=44&&b.height>=44,`${b.id} 44px`);assert.ok(b.x>=data.dialog.x&&b.right<=data.dialog.right);if(!testContinue)assert.ok(b.y>=data.dialog.y&&b.bottom<=data.dialog.bottom);}
  for(let i=1;i<data.buttons.length;i++)assert.ok(data.buttons[i-1].bottom<=data.buttons[i].y+.5,'버튼 겹침 없음');
};
try{
  for(const file of ['pip-win-v1.webp','pip-retry-v1.webp']){
    const bytes=await fs.readFile(path.join(root,'assets',file));report.assets.push({file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
  }
  for(const language of ['ko','en'])for(const viewport of [{width:320,height:568},{width:360,height:640},{width:640,height:360}])for(const kind of flags.testTools?['win','retry','replay','test-win','test-retry']:['win','retry','replay']){
    const won=kind.includes('win')||kind==='replay',testing=kind.startsWith('test'),replay=kind==='replay',reducedMotion=won&&!replay?'no-preference':'reduce';
    console.log(`${variant} ${language} ${viewport.width} ${kind}`);
    const h=await openCase({language,viewport,replay,reducedMotion});
    try{
      if(replay){await h.page.locator('[data-route="village"]').click();await h.page.locator('[data-level="1"]').click();await h.ready();}
      if(testing){await h.page.locator('#test-level-button').click();await h.page.locator('[data-test-level="1"]').click();await h.page.waitForFunction(()=>__resultGame.scene.getScene('Board')?.keyboardState().available);}
      const before=await h.saved();await h.finish(won);
      // 이미지 요청·표시보다 먼저 회차와 보상이 저장됩니다.
      assert.equal(await h.page.locator('#result-dialog').getAttribute('open'),null);assert.deepEqual(h.requests,[]);
      const settled=await h.saved();if(testing)assert.deepEqual(settled,before);else{assert.equal(settled.inProgress,undefined);assert.equal(settled.coins,before.coins+(won&&!replay?40:0));assert.equal(settled.stars,before.stars+(won&&!replay?1:0));}
      await h.page.locator('#result-dialog[open]').waitFor();await h.page.waitForFunction(()=>document.querySelector('.result-pip').complete);
      const loading=await layout(h.page);assert.equal(loading.image.src,'/assets/pip.png');assert.ok(loading.image.decoded);assert.equal(loading.focused,'result-next');assertLayout(loading,viewport);
      assert.deepEqual(h.requests,[outcomePath(won)],'첫 결과 종류만 요청');h.release();
      await h.page.waitForFunction(file=>document.querySelector('.result-pip').getAttribute('src')===file&&document.querySelector('.result-pip').naturalWidth>0,outcomePath(won));
      const loaded=await layout(h.page);assertLayout(loaded,viewport);assert.deepEqual(loaded.stage,loading.stage);assert.equal(loaded.character.width,loading.character.width);assert.equal(loaded.character.height,loading.character.height);
      if(reducedMotion==='reduce')assert.equal(loaded.animation,'none');
      const alpha=await h.page.locator('.result-pip').evaluate(img=>{const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);const data=ctx.getImageData(0,0,canvas.width,canvas.height).data;let transparent=0,opaque=0,partial=0;for(let i=3;i<data.length;i+=4){if(!data[i])transparent++;else if(data[i]===255)opaque++;else partial++;}return {width:canvas.width,height:canvas.height,transparent,opaque,partial};});
      assert.ok(alpha.transparent>0&&alpha.opaque>0&&alpha.partial>0,'실제 이미지 알파/해독');
      const rewards=await h.page.locator('.result-rewards').count();assert.equal(rewards,won&&!testing&&!replay?1:0);
      if(testing&&!won){await h.page.keyboard.press('Tab');assert.equal(await h.page.evaluate(()=>document.activeElement.id),'result-continue');}
      await h.page.keyboard.press('Tab');assert.equal(await h.page.evaluate(()=>document.activeElement.id),testing?'result-test':'result-home');
      await h.page.keyboard.press('Tab');
      // Chrome의 modal 끝 sentinel은 body를 잠시 선택할 수 있으며 다음 Tab은 modal로 순환합니다.
      if(!testing&&await h.page.evaluate(()=>document.activeElement===document.body))await h.page.keyboard.press('Tab');
      assert.equal(await h.page.evaluate(()=>document.activeElement.id),testing?'result-home':'result-next');
      assert.ok(await h.page.evaluate(()=>document.querySelector('#result-dialog').contains(document.activeElement)));
      if(testing){await h.page.locator('#result-test').click();await h.page.locator('#test-close').click();assert.equal(await h.page.locator('#result-dialog').getAttribute('open'),'');assert.deepEqual(await h.saved(),before);assert.deepEqual(h.requests,[outcomePath(won)]);}
      if(language==='ko'&&viewport.width===320&&['win','retry'].includes(kind)||language==='en'&&viewport.width===640&&testing){await h.page.screenshot({path:`docs/screenshots/result-art-${variant}-${language}-${viewport.width}-${kind}-20261016.png`,animations:'disabled'});}
      report.cases.push({language,viewport,kind,reducedMotion,requestsBeforeResult:0,requests:h.requests,loading,loaded,alpha,coinsBefore:before.coins,coinsAfter:settled.coins,rewards});
    }finally{h.release();await h.context.close();}
  }
  for(const failure of ['blocked','404','corrupt']){
    const h=await openCase({failure});
    try{
      await h.finish(true);await h.page.locator('#result-dialog[open]').waitFor();h.release();await h.page.waitForLoadState('networkidle');
      assert.equal((await layout(h.page)).image.src,'/assets/pip.png');assert.ok((await layout(h.page)).image.decoded);
      const settled=await h.saved();assert.equal(settled.coins,40);assert.equal(settled.inProgress,undefined);
      await h.page.locator('#result-home').click();await h.page.locator('[data-level="1"]').click();await h.ready();await h.finish(true);await h.page.locator('#result-dialog[open]').waitFor();await h.page.waitForLoadState('networkidle');
      assert.equal((await layout(h.page)).image.src,'/assets/pip.png');assert.deepEqual(h.requests,[outcomePath(true)],'실패한 결과를 다시 열어도 중복 요청 없음');
      report.boundaries.push({failure,requests:h.requests,fallbackReady:true,usable:true});
    }finally{h.release();await h.context.close();}
  }
  // 이미지가 계속 대기해도 버튼·시험 선택·저장은 기다리지 않고 오래된 해독은 새 결과를 덮지 않습니다.
  const h=await openCase();
  try{
    await h.finish(true);await h.page.locator('#result-dialog[open]').waitFor();assert.equal((await h.saved()).coins,40);
    await h.page.locator('#result-next').click();await h.ready();assert.equal(await h.page.locator('#result-dialog').getAttribute('open'),null);
    if(flags.testTools){await h.page.locator('#test-level-button').click();await h.page.locator('[data-test-level="1"]').click();await h.page.waitForFunction(()=>__resultGame.scene.getScene('Board')?.keyboardState().available);}
    // 일반 2번은 24이동입니다. 실패 콜백이 이동 상한을 넘어도 종료 보호를 적용합니다.
    await h.finish(false);await h.page.locator('#result-dialog[open]').waitFor();const current=await h.saved();
    if(flags.testTools){await h.page.locator('#result-test').click();await h.page.locator('#test-close').click();assert.deepEqual(await h.saved(),current);}
    h.release();await h.page.waitForFunction(file=>document.querySelector('.result-pip').getAttribute('src')===file,outcomePath(false));
    assert.deepEqual(h.requests,[outcomePath(true),outcomePath(false)]);assert.deepEqual(await h.saved(),current);assert.equal(current.coins,40);
    report.boundaries.push({failure:'held-until-next-result',requests:h.requests,oldImageDidNotReplaceRetry:true,buttonsAndPickerUsable:true,coins:current.coins});
  }finally{h.release();await h.context.close();}
  assert.deepEqual(report.pageerrors,[]);
  await fs.writeFile(`docs/performance/result-art-${variant}-20261016.json`,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({variant,cases:report.cases.length,boundaries:report.boundaries.length,pageerrors:report.pageerrors}));
}finally{await browser.close();}
