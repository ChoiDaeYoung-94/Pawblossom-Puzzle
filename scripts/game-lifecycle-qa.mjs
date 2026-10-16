import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import ts from 'typescript';

// 실제 Phaser를 별도 headless Chrome에서 실행합니다. 서버·제품 코드·사용자 Chrome은 수정하지 않습니다.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const baseline=process.argv.includes('--baseline');
const modulePath=process.env.PAWBLOSSOM_PLAYWRIGHT_MODULE;
const {chromium}=await import(modulePath?pathToFileURL(path.resolve(modulePath)).href:'playwright');
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
const sources=Object.fromEntries(walk(path.join(root,'src')).filter(f=>f.endsWith('.ts')).map(f=>{
  const id=path.relative(root,f).replaceAll('\\','/');
  return [id,baseline?execFileSync('git',['show',`0445cab:${id}`],{cwd:root,encoding:'utf8'}):fs.readFileSync(f,'utf8')];
}));
const modules=Object.fromEntries(Object.entries(sources).map(([id,source])=>[id,ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText]));
modules['src/main.ts']+='\nglobalThis.__qa={scene:()=>scene,game:()=>game,audio,startLevel,syncActivity,moves:()=>moves,score:()=>score,round:()=>round,testing:()=>testingLevel,setActive(value){nativeActive=value;syncActivity()}};';
const report={dateKst:'2026-10-15',variant:baseline?'0445cab 수정 전':'작업 트리 수정 후',environment:'실제 Phaser 3.90.0, 격리 headless Chrome, 소스 메모리 변환과 로컬 에셋 가상 route. 서버/HMR 없음, Capacitor 웹 조건, 폰트 import 생략. 강제 GC는 실기기 메모리·FPS 측정이 아님.',sourceHashes:Object.fromEntries(Object.entries(sources).map(([k,v])=>[k,createHash('sha256').update(v).digest('hex')])),checks:[],samples:[],pageerrors:[],warnings:[]};
const output=path.join(root,'docs/performance',baseline?'game-lifecycle-before-20261015.json':'game-lifecycle-after-20261015.json');
const browser=await chromium.launch({headless:true,channel:'chrome'});
report.browser=browser.version();
const origin='http://qa.pawblossom.invalid';
const seedSave={version:1,language:'ko',highestLevel:30,completed:[],stars:0,coins:0,garden:0,music:false,sfx:false,tutorialSeen:true};

async function open({loadingGate,preboot=false,initial=seedSave,storageFails=false}={}){
  const context=await browser.newContext({viewport:{width:390,height:844}});
  const page=await context.newPage();
  page.on('pageerror',e=>report.pageerrors.push(e.stack??e.message));
  page.on('console',m=>{if(['error','warning'].includes(m.type()))report.warnings.push(m.text());});
  await page.addInitScript(({initial,storageFails})=>{
    if(!localStorage.getItem('pawblossom.save.v1'))localStorage.setItem('pawblossom.save.v1',JSON.stringify(initial));
    if(storageFails)Storage.prototype.setItem=()=>{throw Error('QA 저장 실패');};
  },{initial,storageFails});
  await page.route(origin+'/**',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/'){
      const html=fs.readFileSync(path.join(root,'index.html'),'utf8').replace(/<script[^>]*src="\/src\/main.ts"[^>]*><\/script>/,'<link rel="stylesheet" href="/qa.css"><script defer src="/phaser.js"></script><script defer src="/qa.js"></script>');
      return route.fulfill({contentType:'text/html',body:html});
    }
    if(url.pathname==='/qa.css')return route.fulfill({contentType:'text/css',body:fs.readFileSync(path.join(root,'src/style.css'),'utf8')});
    if(url.pathname==='/phaser.js')return route.fulfill({contentType:'application/javascript',body:fs.readFileSync(path.join(root,'node_modules/phaser/dist/phaser.min.js'),'utf8')});
    if(url.pathname==='/qa.js')return route.fulfill({contentType:'application/javascript',body:`(${install.toString()})(${JSON.stringify(modules)},${preboot});`});
    if(loadingGate&&url.pathname.endsWith('.svg'))await loadingGate;
    const file=path.resolve(root,'public','.'+url.pathname);
    assert.ok(file.startsWith(path.join(root,'public')+path.sep));
    return route.fulfill({path:file,contentType:file.endsWith('.svg')?'image/svg+xml':file.endsWith('.png')?'image/png':'application/octet-stream'});
  });
  await page.goto(origin,{waitUntil:'domcontentloaded'});
  return {page,context};
}

function install(modules,preboot){
  globalThis.__TEST_TOOLS_ENABLED__=true;
  const cache={};
  function load(id){
    if(id==='phaser')return Phaser;
    if(id==='@capacitor/app')return {App:{}};
    if(id==='@capacitor/core')return {Capacitor:{isNativePlatform:()=>false}};
    if(id.endsWith('.css'))return {};
    if(cache[id])return cache[id].exports;
    if(!modules[id])throw Error('Module not found '+id);
    const module={exports:{}};cache[id]=module;
    const require=target=>{
      if(target.endsWith('.css'))return {};
      if(!target.startsWith('.'))return load(target);
      const parts=id.split('/');parts.pop();
      for(const p of target.split('/')){if(p==='..')parts.pop();else if(p!=='.')parts.push(p);}
      let key=parts.join('/');key=modules[key+'.ts']?key+'.ts':key+'/index.ts';return load(key);
    };
    new Function('require','module','exports',modules[id])(require,module,module.exports);return module.exports;
  }
  globalThis.__qaModules=load;globalThis.__oldScenes=[];globalThis.__games=[];globalThis.__gameSet=new WeakSet();
  globalThis.__watchGame=()=>{const g=__qa.game();if(!__gameSet.has(g)){__gameSet.add(g);__games.push(new WeakRef(g));}};
  load('src/main.ts');__watchGame();
  if(preboot){
    globalThis.__wasBooted=__qa.game().scene.isBooted;
    __qa.startLevel(4,true);__qa.startLevel(6,true);__qa.startLevel(30,true);
  }
}
const ready=page=>page.waitForFunction(()=>__qa.scene().sys.isActive()&&__qa.game().scene.getScene('Board')===__qa.scene()&&document.querySelectorAll('#game-canvas canvas').length===1);
const stored=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('pawblossom.save.v1')));
async function sample(page,label){
  const cdp=await page.context().newCDPSession(page);
  try{
    await cdp.send('HeapProfiler.collectGarbage');
    const {result:doc}=await cdp.send('Runtime.evaluate',{expression:'document'});
    const {listeners}=await cdp.send('DOMDebugger.getEventListeners',{objectId:doc.objectId});
    await cdp.send('Runtime.releaseObject',{objectId:doc.objectId});
    const values=await page.evaluate(()=>{
      const s=__qa.scene(),g=__qa.game();
      return {gameCreations:__games.length,gamesAlive:__games.filter(r=>r.deref()).length,scenes:g.scene.scenes.length,canvases:document.querySelectorAll('#game-canvas canvas').length,oldScenesAlive:__oldScenes.filter(r=>r.deref()).length,hints:s.time._active.length+s.time._pendingInsertion.length,effects:s.effects.activeCount,tweens:s.tweens.getTweens().length,textures:g.textures.getTextureKeys().length,pendingAdds:g.scene._pending.length,queuedOperations:g.scene._queue.length};
    });
    const result={label,visibilityListeners:listeners.filter(l=>l.type==='visibilitychange').length,...values,heap:await cdp.send('Runtime.getHeapUsage')};
    report.samples.push(result);return result;
  }finally{await cdp.detach();}
}

try{
  const {page,context}=await open();await ready(page);await page.waitForTimeout(100);
  const initial=await sample(page,'시작');
  const count=baseline?30:100;
  for(let i=1;i<=count;i++){
    await page.evaluate(i=>{__oldScenes.push(new WeakRef(__qa.scene()));__qa.startLevel(i%2?6:30,true);__watchGame();},i);
    await ready(page);await page.waitForTimeout(25);
    if([30,60,100].includes(i)){const s=await sample(page,`${i}회 전환`);console.log(JSON.stringify(s));}
  }
  if(baseline){
    assert.equal(report.samples.at(-1).visibilityListeners,32);assert.equal(initial.visibilityListeners,2);
    report.checks.push('수정 전 30회 전환 visibilitychange 2→32 재현');
    const disk=await stored(page),failing=await open({initial:disk,storageFails:true});await ready(failing.page);
    report.restoreFailureToast=await failing.page.locator('#toast').textContent();
    assert.doesNotMatch(report.restoreFailureToast,/저장 공간/);assert.deepEqual(await stored(failing.page),disk);
    await failing.context.close();report.checks.push('수정 전 초기 복원 안내가 저장 실패 경고를 덮는 현상 재현');
  }else{
    for(const s of report.samples){
      assert.equal(s.visibilityListeners,2);assert.equal(s.gameCreations,1);assert.equal(s.gamesAlive,1);
      assert.equal(s.scenes,1);assert.equal(s.canvases,1);assert.equal(s.oldScenesAlive,0);
      assert.equal(s.hints,1);assert.equal(s.effects,0);assert.equal(s.tweens,0);assert.equal(s.textures,initial.textures);
      assert.equal(s.pendingAdds,0);assert.equal(s.queuedOperations,0);
    }
    report.checks.push('100회 전환: 리스너2·Game1·Scene1·canvas1·힌트1·효과/Tween0·이전 Scene GC0·텍스처20 유지');
    const earlyShuffle=await page.evaluate(()=>{
      __qa.startLevel(6,true);const before=JSON.stringify(__qa.scene().engine.board);
      document.querySelector('#shuffle').onclick();const direct=__qa.scene().shuffle();
      return {direct,unchanged:before===JSON.stringify(__qa.scene().engine.board),count:document.querySelector('#shuffle-count').textContent};
    });assert.deepEqual(earlyShuffle,{direct:false,unchanged:true,count:'1'});await ready(page);
    report.checks.push('같은 task의 startLevel 직후 버튼/Scene 직접 섞기 거부·보드/무료 횟수 유지');
    await page.evaluate(()=>{__qa.startLevel(4,true);__qa.startLevel(6,true);__qa.startLevel(30,true);});await ready(page);
    assert.equal(await page.locator('#level-number').textContent(),'30');report.checks.push('한 task 연속 선택은 최종 30번 Scene 표시');
    await page.evaluate(()=>{
      __qa.scene().events.once('update',()=>{
        globalThis.__duringProcessing=__qa.game().scene.isProcessing;
        __qa.startLevel(4,true);__qa.startLevel(10,true);__qa.startLevel(30,true);
      });
      globalThis.__oldRound=__qa.round();
    });
    await page.waitForFunction(()=>__qa.round()===__oldRound+3);await ready(page);
    assert.equal(await page.evaluate(()=>__duringProcessing),true);report.checks.push('실제 Scene UPDATE/isProcessing=true에서 연속 교체 후 중복 키·큐 충돌 없음');
    await page.evaluate(()=>{
      const s=__qa.scene();s.engine=new (__qaModules('src/core/BoardEngine.ts').BoardEngine)(8,8,__qaModules('src/core/BoardEngine.ts').seededRng(41));
      s.engine.board[3][3].special='row';s.paint(s.engine.board);
      s.showHint();s.effects.leafHit({row:3,col:3,before:2,after:0});
      globalThis.__cleanup={beforeEffects:s.effects.activeCount,beforeTweens:s.tweens.getTweens().length};
      s.events.once('shutdown',()=>{__cleanup.shutdown=true;__cleanup.effects=s.effects.activeCount;});
      s.events.once('destroy',()=>{__cleanup.destroy=true;});
      __oldScenes.push(new WeakRef(s));__qa.startLevel(6,true);
    });await ready(page);await page.waitForTimeout(100);
    const cleanup=await page.evaluate(()=>__cleanup);assert.ok(cleanup.beforeEffects>0);assert.ok(cleanup.beforeTweens>0);
    assert.equal(cleanup.shutdown,true);assert.equal(cleanup.destroy,true);assert.equal(cleanup.effects,0);
    report.cleanup=cleanup;const cleaned=await sample(page,'힌트·효과 있는 Scene 교체 뒤');assert.equal(cleaned.oldScenesAlive,0);assert.equal(cleaned.tweens,0);
    report.checks.push('실제 힌트 Tween·낙엽 효과를 만든 Scene의 SHUTDOWN/DESTROY 정리와 GC');
    await page.locator('#test-level-button').click();
    await page.evaluate(()=>{__qa.setActive(false);__qa.setActive(true);});assert.equal(await page.evaluate(()=>__qa.scene().sys.isPaused()),true);
    await page.locator('#test-close').click();await ready(page);
    await page.locator('#settings-button').click();await page.locator('#tutorial-help').click();
    await page.evaluate(()=>{__qa.setActive(false);__qa.setActive(true);});assert.equal(await page.evaluate(()=>__qa.scene().sys.isPaused()),true);
    await page.locator('#guide-skip').click();assert.equal(await page.evaluate(()=>__qa.scene().sys.isPaused()),true);
    await page.locator('#settings-button').click();await ready(page);report.checks.push('테스트·안내 모달 및 설정 화면에서 비활성/활성 복귀 gate 유지');
    await page.locator('#test-level-button').click();await page.locator('#test-normal').click();await ready(page);
    await page.evaluate(()=>{
      const s=__qa.scene(),core=__qaModules('src/core/BoardEngine.ts');s.engine=new core.BoardEngine(8,8,core.seededRng(41));
      s.configureLeaves(__qaModules('src/levels.ts').levels[29].leaves);s.engine.board[3][3].special='row';s.paint(s.engine.board);s.paintLeaves(s.engine.leaves);
    });
    const beforeMoves=await page.evaluate(()=>__qa.moves());
    await page.evaluate(()=>{void __qa.scene().attempt({row:3,col:3});});await page.waitForFunction(()=>__qa.scene().busy);
    await page.evaluate(()=>__qa.setActive(false));const frozen=await page.evaluate(()=>JSON.stringify({pieces:__qa.scene().pieces.map(row=>row.map(p=>[p.x,p.y,p.scaleX,p.alpha])),moves:__qa.moves()}));
    await page.waitForTimeout(250);assert.equal(await page.evaluate(()=>JSON.stringify({pieces:__qa.scene().pieces.map(row=>row.map(p=>[p.x,p.y,p.scaleX,p.alpha])),moves:__qa.moves()})),frozen);
    await page.evaluate(()=>__qa.setActive(true));await page.waitForFunction(()=>!__qa.scene().busy);assert.equal(await page.evaluate(()=>__qa.moves()),beforeMoves-1);
    const played=await stored(page);assert.ok(played.inProgress.score>0);
    await page.reload({waitUntil:'domcontentloaded'});await ready(page);
    assert.deepEqual(await stored(page),played);assert.deepEqual(await page.evaluate(()=>__qa.scene().engine.board),played.inProgress.board);
    report.checks.push('연쇄 비활성 중 타일·이동 불변, 복귀 후 이동 한 번 차감과 새로고침 checkpoint 복원');
    const failing=await open({initial:played,storageFails:true});await ready(failing.page);
    // #58부터 지속적인 저장 경고는 storage-announcement와 설정 카드에 표시합니다.
    assert.match(await failing.page.locator('#storage-announcement').textContent(),/복구 사본.*이전 저장.*유지/);assert.deepEqual(await stored(failing.page),played);
    assert.deepEqual(await failing.page.evaluate(()=>__qa.scene().engine.board),played.inProgress.board);await failing.context.close();
    report.checks.push('초기 복원 저장 실패 경고 유지·메모리 보드 복원·이전 디스크 저장 보존');
    await page.evaluate(()=>{
      const {startLevel}=__qa;startLevel(1);const s=__qa.scene();s.hooks.onMove([12,10,0,0,0,0],220,1,0);
    });await page.waitForFunction(()=>document.querySelector('#result-dialog').open);
    const rewarded=await stored(page);assert.equal(rewarded.coins,40);assert.equal(rewarded.stars,1);
    await page.locator('#result-next').click();await ready(page);assert.equal(await page.locator('#level-number').textContent(),'2');
    assert.equal((await stored(page)).coins,40);report.checks.push('정상 첫 완료 보상 확정·결과 표시·다음 레벨 교체');
    const preboot=await open({preboot:true});await ready(preboot.page);
    assert.equal(await preboot.page.evaluate(()=>__wasBooted),false);assert.equal(await preboot.page.locator('#level-number').textContent(),'30');
    assert.equal(await preboot.page.evaluate(()=>__qa.game().scene.scenes.length),1);await preboot.context.close();report.checks.push('실제 첫 부팅 전 빠른 선택은 최신 Board 1개만 시작');
    let release;const loadingGate=new Promise(resolve=>{release=resolve;});
    const loading=await open({loadingGate});
    await loading.page.waitForFunction(()=>__qa.scene().sys.settings.status===Phaser.Scenes.LOADING);
    await loading.page.evaluate(()=>{
      const s=__qa.scene();globalThis.__loadingStale=s.hooks;globalThis.__loadingDestroyed=false;
      s.events.once('destroy',()=>{__loadingDestroyed=true;});
      __qa.startLevel(4,true);__qa.startLevel(30,true);
      globalThis.__loadingRound=__qa.round();
    });
    await loading.page.waitForFunction(()=>__loadingDestroyed&&__qa.game().scene.getScene('Board')===__qa.scene());
    release();await ready(loading.page);
    await loading.page.evaluate(()=>{__loadingStale.onReady();__loadingStale.onNotice('chain');__loadingStale.onMove([99,99,99,99,99,99],999,1,99);});
    assert.equal(await loading.page.locator('#level-number').textContent(),'30');assert.equal(await loading.page.evaluate(()=>__qa.score()),0);
    await loading.page.waitForTimeout(300);await loading.context.close();report.checks.push('SVG 응답 지연 로딩 중 Scene 중단·제거·최신 선택, 이전 콜백 무시');
  }
  await context.close();
  assert.deepEqual(report.pageerrors,[]);report.checks.push('pageerror 0');
}catch(error){report.failure=String(error.stack??error);throw error;}
finally{
  fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
  await browser.close();console.log(output);console.log(JSON.stringify({checks:report.checks,pageerrors:report.pageerrors,failure:report.failure},null,2));
}
