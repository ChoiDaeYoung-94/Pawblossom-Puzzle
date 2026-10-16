import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';

// 자연 보드 화면 smoke와, 별도로 표시한 메모리 fixture의 저장 거부 진단입니다.
const {chromium}=await import(pathToFileURL(process.env.PAWBLOSSOM_PLAYWRIGHT_MODULE).href);
const root=path.resolve('dist'),flags=JSON.parse(await fs.readFile(path.join(root,'build-info.json'),'utf8'));
assert.deepEqual(flags,{testTools:false,androidTestAds:false,androidTestBilling:false});
const browser=await chromium.launch({headless:true,channel:'chrome'});
const report={issue:70,dateKst:'2026-10-16',flags,browser:browser.version(),cases:[],pageerrors:[]};
try{
  for(const reducedMotion of ['reduce','no-preference'])for(const viewport of [{width:390,height:844},{width:1280,height:800}]){
    const language=viewport.width===390?'ko':'en',context=await browser.newContext({viewport,hasTouch:viewport.width===390,reducedMotion}),page=await context.newPage();
    page.on('pageerror',e=>report.pageerrors.push(e.message));
    await context.addInitScript(language=>localStorage.setItem('pawblossom.save.v1',JSON.stringify({version:1,language,highestLevel:30,completed:[],stars:0,coins:0,garden:0,music:false,sfx:false,tutorialSeen:true})),language);
    await page.route('http://motion-smoke.pawblossom.invalid/**',async route=>{
      const url=new URL(route.request().url()),file=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));assert.ok(file.startsWith(root+path.sep));
      if(file.endsWith('.js')){let body=await fs.readFile(file,'utf8');const calls=body.match(/new [\w$.]+\.Game\(\{type:/g)??[];
        if(calls.length){assert.equal(calls.length,1);body=body.replace(calls[0],'window.__smokeGame='+calls[0]);}await route.fulfill({body,contentType:'text/javascript'});
      }else await route.fulfill({path:file});
    });
    try{
      const ready=()=>page.waitForFunction(()=>window.__smokeGame?.scene.getScene('Board')?.keyboardState().available);
      await page.goto('http://motion-smoke.pawblossom.invalid');await ready();
      const original=await page.evaluate(()=>({move:__smokeGame.scene.getScene('Board').engine.legalMoves()[0],save:JSON.parse(localStorage.getItem('pawblossom.save.v1'))}));
      const box=await page.locator('canvas').boundingBox();assert.ok(Math.abs(box.width-box.height)<1);assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=viewport.width+1&&box.y+box.height<=viewport.height+1);
      const tap=async p=>{const x=box.x+(44+p.col*56)/480*box.width,y=box.y+(44+p.row*56)/480*box.height;if(viewport.width===390)await page.touchscreen.tap(x,y);else await page.mouse.click(x,y);};
      await tap(original.move.a);const selected=await page.evaluate(()=>__smokeGame.scene.getScene('Board').keyboardState().selected);assert.deepEqual(selected,original.move.a);
      await tap(original.move.b);await ready();const save=await page.evaluate(()=>JSON.parse(localStorage.getItem('pawblossom.save.v1')));
      assert.equal(save.inProgress.moves,original.save.inProgress.moves-1);assert.ok(save.inProgress.score>original.save.inProgress.score);
      const saveWarning=await page.locator('#settings-button').evaluate(e=>e.classList.contains('save-attention'));assert.equal(saveWarning,false);
      await page.screenshot({path:`docs/screenshots/issue-70-production-smoke-${reducedMotion}-${viewport.width}.png`});
      report.cases.push({viewport,language,reducedMotion,canvas:box,input:viewport.width===390?'touchscreen':'mouse',selected,validSwap:true,moves:save.inProgress.moves,score:save.inProgress.score,saveWarning});
      if(reducedMotion==='reduce'&&viewport.width===390){
        const stored=await page.evaluate(()=>localStorage.getItem('pawblossom.save.v1'));
        await page.evaluate(()=>{const s=__smokeGame.scene.getScene('Board');s.engine.board=Array.from({length:8},(_,r)=>Array.from({length:8},(_,c)=>({kind:(r*2+c)%6})));s.engine.board[2][2].special='row';s.engine.setLeaves([{row:0,col:0,layers:2}]);s.paint(s.engine.board);s.paintLeaves(s.engine.leaves);});
        await tap({row:2,col:2});await ready();
        const warning=await page.locator('#settings-button').evaluate(e=>e.classList.contains('save-attention'));
        assert.equal(warning,true);assert.equal(await page.evaluate(()=>localStorage.getItem('pawblossom.save.v1')),stored);
        report.fixtureSave={scope:'검사 메모리에만 주입한 레벨 30 외 낙엽 (0,0) 2겹, 실제 특수 탭 뒤 checkpoint 검증 거부',saveWarning:warning,previousNaturalCheckpointPreserved:true,normalSaveEvidence:false};
      }
    }finally{await context.close();}
  }
  assert.deepEqual(report.pageerrors,[]);
  const files=['build-info.json','index.html',...(await fs.readdir(path.join(root,'assets'))).filter(file=>/\.(js|css)$/.test(file)).map(file=>'assets/'+file)];
  report.distHashes=Object.fromEntries(await Promise.all(files.map(async file=>[file,createHash('sha256').update(await fs.readFile(path.join(root,file))).digest('hex')])));
  report.scriptHash=createHash('sha256').update(await fs.readFile('scripts/reduced-motion-layout-smoke.mjs')).digest('hex');
  await fs.writeFile('docs/performance/issue-70-layout-smoke-production-20261016.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({cases:report.cases.length,pageerrors:report.pageerrors}));
}finally{await browser.close();}
