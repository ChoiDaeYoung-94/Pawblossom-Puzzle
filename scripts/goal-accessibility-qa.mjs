import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';

// 실제 dist·Chrome AX·키보드 검증입니다. 저장/목표 경계 준비만 합성 fixture입니다.
const output=process.argv.find(arg=>arg.startsWith('--output='))?.slice(9);
const modulePath=process.argv.find(arg=>arg.startsWith('--playwright='))?.slice(13)??process.env.PAWBLOSSOM_PLAYWRIGHT_MODULE;
assert(output&&modulePath,'--output=새 결과 폴더와 --playwright=모듈 경로가 필요합니다.');
await fs.mkdir(output,{recursive:false});
const root=path.resolve('dist'),flags=JSON.parse(await fs.readFile(path.join(root,'build-info.json'),'utf8'));
async function sourceModule(file,requires={}){
  const exports={};vm.runInNewContext(ts.transpileModule(await fs.readFile(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{exports,require:name=>{assert(name in requires);return requires[name];}});return exports;
}
const core=await sourceModule('src/core/BoardEngine.ts'),levels=await sourceModule('src/levels.ts');
const state=await sourceModule('src/state.ts',{'./core':core,'./levels':levels});
function fixture(language){
  const level=levels.levels[5],engine=new core.BoardEngine(8,8,core.seededRng(42));engine.setLeaves(level.leaves);
  return {version:1,language,highestLevel:6,completed:[],stars:0,coins:0,garden:0,music:false,sfx:false,tutorialSeen:true,
    inProgress:{schema:1,levelId:6,levelSignature:state.levelSignature(level),board:engine.board,leaves:engine.leaves,moves:28,score:0,collected:[0,0,0,0,0,0],shuffles:1,clearedLeaves:0}};
}
const {chromium}=await import(pathToFileURL(modulePath).href),browser=await chromium.launch({headless:true,channel:'chrome'});
const report={dateKst:'2026-10-18',variant:flags.testTools?'testing':'production',flags,browser:browser.version(),
  scope:'격리 합성 origin/새 Chrome context와 실제 dist. Game 참조 관찰만 응답에 추가. seed42 저장 복원과 목표/낙엽/실패 준비는 fixture이며 실제 키보드·상태 콜백·Phaser 연쇄·Chrome AX와 구분. Android/폰/TalkBack 검증 아님.',cases:[],pageerrors:[]};
const ready=page=>page.waitForFunction(()=>window.__goalGame?.scene.getScene('Board')?.keyboardState().available);
const text=page=>page.locator('#board-keyboard-status').textContent();
async function accessTree(page,label,expected){
  const cdp=await page.context().newCDPSession(page);
  try{
    const {root}=await cdp.send('DOM.getDocument'),{nodeId}=await cdp.send('DOM.querySelector',{nodeId:root.nodeId,selector:'#goals'});
    const {node}=await cdp.send('DOM.describeNode',{nodeId}),{nodes}=await cdp.send('Accessibility.getFullAXTree');
    const byId=new Map(nodes.map(node=>[node.nodeId,node])),start=nodes.find(n=>n.backendDOMNodeId===node.backendNodeId);assert(start,'목표 AX 루트');
    const subtree=[];function visit(n){if(!n)return;subtree.push(n);for(const id of n.childIds??[])visit(byId.get(id));}visit(start);
    const visible=subtree.filter(n=>!n.ignored),sentences=visible.filter(n=>n.role?.value==='StaticText').map(n=>n.name?.value);
    assert.deepEqual(sentences,expected);assert.equal(visible.filter(n=>['image','img'].includes(n.role?.value)).length,0);
    const dom=await page.locator('#goals .goal-item').evaluateAll(items=>items.map(item=>({sentences:item.querySelectorAll('.sr-only').length,alt:item.querySelector('img').getAttribute('alt'),hidden:item.querySelector('strong').getAttribute('aria-hidden')})));
    assert(dom.every(item=>item.sentences===1&&item.alt===''&&item.hidden==='true'));
    await fs.writeFile(path.join(output,label+'-ax.json'),JSON.stringify({expected,sentences,dom,nodes:subtree},null,2)+'\n');
    return {label,sentences,decorativeImages:0};
  }finally{await cdp.detach();}
}
async function screen(page,label){
  await page.locator('#game-canvas').scrollIntoViewIfNeeded();
  const evidence=await page.locator('canvas').evaluate(canvas=>{
    const b=canvas.getBoundingClientRect(),x=b.x+b.width/2,y=b.y+b.height/2;
    return {viewport:{width:innerWidth,height:innerHeight},canvas:{x:b.x,y:b.y,width:b.width,height:b.height},canvasInViewport:b.x>=0&&b.y>=0&&b.right<=innerWidth&&b.bottom<=innerHeight,centerIsCanvas:document.elementFromPoint(x,y)===canvas,horizontalOverflow:document.documentElement.scrollWidth-innerWidth,
      goals:[...document.querySelectorAll('#goals .goal-item')].map(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,inViewport:r.x>=0&&r.y>=0&&r.right<=innerWidth&&r.bottom<=innerHeight};})};
  });
  assert(evidence.canvasInViewport&&evidence.centerIsCanvas);assert.equal(evidence.horizontalOverflow,0);assert(evidence.goals.every(goal=>goal.inViewport));
  await page.screenshot({path:path.join(output,label+'.png')});return evidence;
}
async function go(page,row,col){
  const cursor=await page.evaluate(()=>__goalGame.scene.getScene('Board').keyboardState().cursor);assert(cursor);
  for(const [key,count] of [['ArrowDown',row-cursor.row],['ArrowRight',col-cursor.col]])for(let i=0;i<Math.abs(count);i++)await page.keyboard.press(count<0?(key==='ArrowDown'?'ArrowUp':'ArrowLeft'):key);
}
try{
  for(const language of ['ko','en'])for(const viewport of [{width:320,height:568},{width:640,height:360}]){
    const label=`${language}-${viewport.width}x${viewport.height}`,item={label,checks:[],ax:[],screens:[],statusWrites:[]};report.cases.push(item);
    const context=await browser.newContext({viewport,reducedMotion:'reduce'}),page=await context.newPage();page.setDefaultTimeout(10000);
    page.on('pageerror',error=>report.pageerrors.push({label,message:error.message}));
    try{
      await context.addInitScript(save=>{if(!localStorage.getItem('pawblossom.save.v1'))localStorage.setItem('pawblossom.save.v1',JSON.stringify(save));},fixture(language));
      await page.route('http://goals.pawblossom.invalid/**',async route=>{
        const url=new URL(route.request().url()),file=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));assert(file.startsWith(root+path.sep));
        if(file.endsWith('.js')){let source=await fs.readFile(file,'utf8');const calls=source.match(/new [\w$.]+\.Game\(\{type:/g)??[];if(calls.length){assert.equal(calls.length,1);source=source.replace(calls[0],'window.__goalGame='+calls[0]);}await route.fulfill({body:source,contentType:'text/javascript'});}
        else await route.fulfill({path:file});
      });
      await page.goto('http://goals.pawblossom.invalid');await ready(page);
      const initial=language==='ko'?['꽃 16개 남음.','딸기 12개 남음.','낙엽 더미 4개 남음.']:['Flower: 16 remaining.','Strawberry: 12 remaining.','Leaf pile: 4 remaining.'];
      item.ax.push(await accessTree(page,label+'-initial',initial));assert((await text(page)).includes(language==='ko'?'남은 이동 28회.':'Moves remaining: 28.'));
      await page.locator('#restart').focus();await page.keyboard.press('Tab');assert(await page.locator('#game-canvas').evaluate(el=>document.activeElement===el));
      await page.keyboard.press('Enter');assert(await page.evaluate(()=>Boolean(__goalGame.scene.getScene('Board').keyboardState().selected)));await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(()=>__goalGame.scene.getScene('Board').keyboardState().selected),undefined);
      item.screens.push({label:label+'-initial',...await screen(page,label+'-initial')});item.checks.push('저장6스테이지 복원·초기 목표 AX·실제 Tab/Enter/Escape·viewport');
      await page.evaluate(()=>{const s=__goalGame.scene.getScene('Board');s.engine.leaves[2][2]=1;s.paintLeaves(s.engine.leaves);s.hooks.onMove([0,0,0,0,0,0],0,1,0);s.changed();});
      await go(page,2,2);assert((await text(page)).includes(language==='ko'?'낙엽 남은 겹: 1.':'Leaf layers remaining: 1.'));assert((await text(page)).includes(initial[2]));
      item.ax.push(await accessTree(page,label+'-one-layer',initial));item.checks.push('fixture 두겹→한겹은 더미4 유지·실제 키보드 칸의 겹1');
      await page.evaluate(()=>{const s=__goalGame.scene.getScene('Board');s.engine.leaves[2][2]=0;s.paintLeaves(s.engine.leaves);s.hooks.onMove([12,0,0,0,0,0],120,1,1);s.changed();});
      const partial=language==='ko'?['꽃 16개 남음.','딸기 목표 완료.','낙엽 더미 3개 남음.']:['Flower: 16 remaining.','Strawberry: complete.','Leaf pile: 3 remaining.'];
      item.ax.push(await accessTree(page,label+'-partial',partial));item.screens.push({label:label+'-partial',...await screen(page,label+'-partial')});
      const checkpoint=await page.evaluate(()=>JSON.parse(localStorage.getItem('pawblossom.save.v1')).inProgress);
      await page.reload();await ready(page);assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('pawblossom.save.v1')).inProgress),checkpoint);
      item.ax.push(await accessTree(page,label+'-restored',partial));item.checks.push('일부완료·더미감소 AX·새로고침 checkpoint 보존');
      await page.locator('#language-toggle').click();assert((await text(page)).includes(language==='ko'?'Moves remaining: 26.':'남은 이동 26회.'));
      assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('pawblossom.save.v1')).inProgress),checkpoint);await page.locator('#language-toggle').click();await ready(page);
      // 실제 Phaser 이동 동안 live 상태와 입력 차단을 관찰합니다. 판정·콜백은 대체하지 않습니다.
      await page.evaluate(()=>{
        const el=document.querySelector('#board-keyboard-status');window.__statusWrites=[];new MutationObserver(()=>__statusWrites.push({text:el.textContent,busy:__goalGame.scene.getScene('Board').busy})).observe(el,{childList:true,characterData:true,subtree:true});
        window.__legalMove=__goalGame.scene.getScene('Board').engine.legalMoves()[0];
      });
      await page.locator('#restart').focus();await page.keyboard.press('Tab');const move=await page.evaluate(()=>__legalMove);assert(move);
      await go(page,move.a.row,move.a.col);await page.keyboard.press('Enter');await go(page,move.b.row,move.b.col);
      const beforeMove=await page.evaluate(()=>JSON.parse(localStorage.getItem('pawblossom.save.v1')).inProgress.moves);await page.keyboard.press('Space');
      await page.waitForFunction(()=>__goalGame.scene.getScene('Board').busy);const busyState=await page.evaluate(()=>__goalGame.scene.getScene('Board').keyboardState());
      assert.equal(await text(page),language==='ko'?'교환과 연쇄가 진행 중이에요. 잠시 기다려 주세요.':'Resolving the move. Please wait.');
      await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');assert.deepEqual(await page.evaluate(()=>__goalGame.scene.getScene('Board').keyboardState().cursor),busyState.cursor);
      await ready(page);const afterMove=await page.evaluate(()=>JSON.parse(localStorage.getItem('pawblossom.save.v1')).inProgress.moves);assert.equal(afterMove,beforeMove-1);
      item.statusWrites=await page.evaluate(()=>__statusWrites);assert(item.statusWrites.filter(entry=>entry.busy).every(entry=>entry.text===(language==='ko'?'교환과 연쇄가 진행 중이에요. 잠시 기다려 주세요.':'Resolving the move. Please wait.')));
      assert((await text(page)).includes(language==='ko'?`남은 이동 ${afterMove}회.`:`Moves remaining: ${afterMove}.`));
      const count=await page.evaluate(()=>__statusWrites.length);await page.evaluate(()=>{const s=__goalGame.scene.getScene('Board');s.changed();s.changed();});assert.equal(await page.evaluate(()=>__statusWrites.length),count);
      item.checks.push('언어 왕복·실제 합법 교환/연쇄·busy 요약배제/키 차단·최종1회이동·동일상태무쓰기');
      if(flags.testTools){
        await page.locator('#test-level-button').click();await page.locator('[data-test-level="6"]').click();await ready(page);
        // 실패 경계만 onMove fixture로 준비하며 이어하기는 실제 버튼 클릭입니다.
        await page.evaluate(()=>__goalGame.scene.getScene('Board').hooks.onMove([0,0,0,0,0,0],0,1,0));
        for(let i=0;i<27;i++)await page.evaluate(()=>__goalGame.scene.getScene('Board').hooks.onMove([0,0,0,0,0,0],0,1,0));
        await page.locator('#result-continue').waitFor({state:'visible'});assert(!(await text(page)).includes(language==='ko'?'남은 이동':'Moves remaining'));
        await page.locator('#result-continue').click();await ready(page);assert((await text(page)).includes(language==='ko'?'남은 이동 5회.':'Moves remaining: 5.'));
        item.screens.push({label:label+'-continue',...await screen(page,label+'-continue')});item.checks.push('시험실패 fixture→실제 이어하기 클릭·닫힘 뒤5회·종료요약배제');
      }
      await page.evaluate(()=>{const s=__goalGame.scene.getScene('Board'),remaining=s.engine.leaves.flat().filter(layers=>layers>0).length;s.engine.leaves.forEach(row=>row.fill(0));s.paintLeaves(s.engine.leaves);s.hooks.onMove([100,0,0,0,0,100],200,1,remaining);s.changed();});
      const complete=language==='ko'?['꽃 목표 완료.','딸기 목표 완료.','낙엽 더미 목표 완료.']:['Flower: complete.','Strawberry: complete.','Leaf pile: complete.'];
      item.ax.push(await accessTree(page,label+'-complete',complete));assert(!(await text(page)).includes(language==='ko'?'남은 이동':'Moves remaining'));item.checks.push('모든 목표 완료 AX·종료 시 짧은 상태');
      console.log(JSON.stringify({label,checks:item.checks.length,ax:item.ax.length,screens:item.screens.length}));
    }finally{await context.close();}
  }
  assert.equal(report.pageerrors.length,0);
}catch(error){report.failure=error.stack;throw error;}
finally{
  await browser.close();report.hashes={};for(const file of ['src/main.ts','src/i18n.ts','tests/ui-flow.test.ts','scripts/goal-accessibility-qa.mjs'])report.hashes[file]=createHash('sha256').update((await fs.readFile(file,'utf8')).replace(/\r\n/g,'\n')).digest('hex');
  await fs.writeFile(path.join(output,'summary.json'),JSON.stringify(report,null,2)+'\n');
}
