import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';

// 빌드된 dist를 임시 로컬 서버와 격리 Chrome으로 검사합니다. APK/사용자 브라우저는 조작하지 않습니다.
const modulePath=process.env.PAWBLOSSOM_PLAYWRIGHT_MODULE;
const {chromium}=await import(modulePath?pathToFileURL(path.resolve(modulePath)).href:'playwright');
const before=process.argv.includes('--before');
const output=process.argv.find(arg=>arg.startsWith('--output='))?.slice(9);
const root=path.resolve('dist');
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.woff':'font/woff','.txt':'text/plain'};
const missing=[],errors=[],cases=[];
let phase='setup',pipDelay=0;
let observedModules=0;
const responses=[];
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  const target=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));
  if(!target.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  try{
    let bytes=await fs.readFile(target);const capturedPhase=phase;
    // minify된 빌드의 Game 참조만 격리 응답에 노출합니다. 파일이나 출시 번들은 수정하지 않습니다.
    if(target.endsWith('.js')){
      const source=bytes.toString(),gameCalls=source.match(/new [\w$.]+\.Game\(\{type:/g)??[];
      if(gameCalls.length){
        assert.equal(gameCalls.length,1);observedModules++;
        bytes=Buffer.from(source.replace(gameCalls[0],'window.__loadingGame='+gameCalls[0]));
      }
    }
    res.setHeader('Content-Type',mime[path.extname(target)]??'application/octet-stream');
    res.setHeader('Cache-Control',target.endsWith('index.html')?'no-store':'public, max-age=3600');
    res.setHeader('Content-Length',bytes.length);
    if(url.pathname==='/assets/pip.png'&&pipDelay)await new Promise(resolve=>setTimeout(resolve,pipDelay));
    if(!res.destroyed){responses.push({phase:capturedPhase,url:url.pathname,bytes:bytes.length});res.end(bytes);}
  }catch{missing.push(url.pathname);res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
const pngResponses=label=>responses.filter(item=>item.phase===label&&item.url.endsWith('.png'));
const visibleReady=page=>page.waitForFunction(()=>Array.from(document.images).every(img=>{
  const rect=img.getBoundingClientRect();
  const visible=rect.width>0&&rect.height>0&&rect.bottom>0&&rect.top<innerHeight&&rect.right>0&&rect.left<innerWidth;
  return !visible||(img.complete&&img.naturalWidth>0);
}));
try{
  browser=await chromium.launch({headless:true,channel:'chrome'});
  for(const viewport of [{width:320,height:568},{width:360,height:640},{width:390,height:844},{width:640,height:360},{width:1440,height:900},{width:360,height:640,pipDelay:1000}]){
    pipDelay=viewport.pipDelay??0;
    const id=`${viewport.width}x${viewport.height}-${pipDelay}`;
    phase=id+'-initial';
    const context=await browser.newContext({viewport:{width:viewport.width,height:viewport.height}});
    try{
      await context.addInitScript(()=>localStorage.setItem('pawblossom.save.v1',JSON.stringify({version:1,language:'ko',highestLevel:1,completed:[],stars:0,coins:0,garden:0,music:false,sfx:false,tutorialSeen:true})));
      const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.waitForFunction(()=>window.__loadingGame?.scene?.isActive('Board'));
      await page.waitForLoadState('networkidle');await visibleReady(page);
      const initial=pngResponses(phase),storyVisible=await page.locator('.story-panel').isVisible();
      const meadowInitial=initial.some(item=>item.url==='/assets/meadow.png');
      assert.equal(meadowInitial,before||storyVisible);
      assert(initial.some(item=>item.url==='/assets/pip.png'),'첫 결과 핍을 초기 준비합니다.');
      if(!before)assert.equal(await page.locator('.environment').getAttribute('loading'),'lazy');
      // QA에서만 기존 Scene의 완료 콜백으로 결과 화면을 준비합니다. 출시 코드에 관찰자를 추가하지 않습니다.
      phase=id+'-result';
      await page.evaluate(()=>window.__loadingGame.scene.getScene('Board').hooks.onMove([12,10,0,0,0,0],300,1,0));
      await page.locator('#result-dialog[open]').waitFor();
      const pipReady=await page.locator('.result-pip').evaluate(img=>img.complete&&img.naturalWidth>0);
      assert(pipReady,'첫 결과를 열 때 핍이 이미 준비되어야 합니다.');
      assert.equal(pngResponses(phase).length,0);
      await page.locator('#result-home').click();await page.locator('[data-route="journal"]').click();await visibleReady(page);
      assert(await page.locator('.journal-card>img').evaluate(img=>img.complete&&img.naturalWidth>0));
      phase=id+'-resize';
      await page.setViewportSize({width:390,height:844});await page.waitForLoadState('networkidle');await visibleReady(page);
      assert(await page.locator('.environment').evaluate(img=>img.complete&&img.naturalWidth>0));
      const resized=pngResponses(phase);
      if(!meadowInitial)assert(resized.some(item=>item.url==='/assets/meadow.png'));
      phase=id+'-reload';
      await page.reload();await page.waitForLoadState('networkidle');await visibleReady(page);
      const reloaded=pngResponses(phase);assert.equal(reloaded.length,0,'현재 임시 HTTP 캐시 조건에서 PNG 재수신이 없습니다.');
      cases.push({viewport,pipDelay,storyVisible,initialPng:initial,initialPngBodyBytes:initial.reduce((sum,item)=>sum+item.bytes,0),firstResultPipReady:pipReady,resizePng:resized,reloadPng:reloaded});
    }finally{await context.close();}
  }
  assert.deepEqual(missing,[]);assert.deepEqual(errors,[]);
  for(const name of ['Nunito','Fraunces'])assert((await fs.readFile(path.join(root,'licenses',name+'-OFL.txt'))).equals(await fs.readFile(path.join('public/licenses',name+'-OFL.txt'))));
  const assets=[];
  for(const file of ['meadow.png','pip.png']){const bytes=await fs.readFile(path.join(root,'assets',file));assets.push({file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}
  assert(observedModules>0);
  const report={dateKst:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),mode:before?'before':'after',browser:browser.version(),environment:'production dist·격리 headless Chrome·임시 HTTP 서버. JS 응답에서 Game 참조 관찰자만 주입하며 파일은 수정하지 않습니다. 각 조건은 새 browser context, 정적 파일 max-age=3600. PNG 응답 본문을 측정하며 APK/LCP/FPS/Android 검증과 구분합니다.',assets,cases,missing,pageerrors:errors,licenses:'dist와 public의 OFL 원문 일치'};
  if(output)await fs.writeFile(output,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({mode:report.mode,cases:cases.map(item=>({viewport:item.viewport,bytes:item.initialPngBodyBytes,firstResultPipReady:item.firstResultPipReady})),missing,pageerrors:errors}));
}finally{
  if(browser)await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
