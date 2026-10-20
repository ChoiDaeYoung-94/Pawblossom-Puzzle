import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';

// 사용자 저장/기존 창/서버를 사용하지 않는 실제 dist 브라우저 QA입니다.
const arg=name=>process.argv.find(value=>value.startsWith(`--${name}=`))?.slice(name.length+3);
const output=arg('output'),root=path.resolve(arg('root')??'dist'),baseline=process.argv.includes('--baseline');
assert(output&&process.env.PAWBLOSSOM_PLAYWRIGHT_MODULE,'--output와 PAWBLOSSOM_PLAYWRIGHT_MODULE이 필요합니다.');
await fs.mkdir(output,{recursive:false});
const {chromium}=await import(pathToFileURL(process.env.PAWBLOSSOM_PLAYWRIGHT_MODULE).href);
const browser=await chromium.launch({headless:true,channel:'chrome'});
const report={dateKst:'2026-10-20',baseline,root,flags:JSON.parse(await fs.readFile(path.join(root,'build-info.json'),'utf8')),browser:browser.version(),
  scope:'KO/EN 합성 저장·새 headless context. 실제 dist/DOM/키보드/Chrome AX. Game 참조만 응답에 노출. 결과는 실제 onMove 콜백에 완료 수량을 공급한 fixture. Android/실서비스 검증 아님.',cases:[],pageerrors:[]};
const ready=page=>page.waitForFunction(()=>window.__uiGame?.scene.getScene('Board')?.keyboardState().available);
async function screen(page,item,name){
  await page.evaluate(()=>document.fonts.ready);
  const evidence=await page.evaluate(()=>{
    const rect=el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,inViewport:r.x>=-1&&r.y>=-1&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1};};
    const view=document.querySelector('.view:not([hidden])'),canvas=document.querySelector('canvas'),nav=document.querySelector('.bottom-nav');
    const buttons=[...document.querySelectorAll('button,a.brand,select')].filter(el=>el.getClientRects().length&&(!document.querySelector('dialog[open]')||el.closest('dialog[open]'))).map(el=>{
      const r=el.getBoundingClientRect(),clip=el.closest('.view,dialog')?.getBoundingClientRect(),visible=r.y>=0&&r.bottom<=innerHeight&&r.x>=0&&r.right<=innerWidth&&(!clip||(r.y>=clip.y&&r.bottom<=clip.bottom));
      const hit=visible&&el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));
      return {id:el.id||el.dataset.route||el.dataset.level||el.className,width:r.width,height:r.height,visible,hit,disabled:el.disabled};
    });
    return {viewport:{width:innerWidth,height:innerHeight},overflowX:document.documentElement.scrollWidth-innerWidth,overflowY:document.documentElement.scrollHeight-innerHeight,
      view:{id:view.id,scrollTop:view.scrollTop,clientHeight:view.clientHeight,scrollHeight:view.scrollHeight},canvas:canvas?.getClientRects().length?rect(canvas):null,nav:rect(nav),buttons,
      wallet:{stars:document.querySelector('#star-count').textContent,coins:document.querySelector('#coin-count').textContent},focus:document.activeElement?.id};
  });
  assert.equal(evidence.overflowX,0);assert.equal(evidence.overflowY,0);assert(evidence.nav.inViewport);
  if(name==='puzzle'){assert(evidence.canvas?.inViewport);assert(evidence.canvas.width>140);assert(evidence.view.scrollHeight<=evidence.view.clientHeight+1);}
  for(const button of evidence.buttons.filter(b=>b.visible&&!b.disabled)){assert(button.hit,`${name}: ${button.id} hit`);assert(button.height>=43.9,`${name}: ${button.id} height ${button.height}`);}
  const png=path.join(output,`${item.label}-${name}.png`);await page.screenshot({path:png});item.screens.push({name,png,...evidence});
}
async function ax(page,selector){
  const cdp=await page.context().newCDPSession(page);
  try{const {root}=await cdp.send('DOM.getDocument'),{nodeId}=await cdp.send('DOM.querySelector',{nodeId:root.nodeId,selector});
    const {node:{backendNodeId}}=await cdp.send('DOM.describeNode',{nodeId}),{nodes}=await cdp.send('Accessibility.getFullAXTree');
    const start=nodes.find(node=>node.backendDOMNodeId===backendNodeId);assert(start);
    const result=[],visit=node=>{result.push(node);for(const id of node.childIds??[]){const child=nodes.find(item=>item.nodeId===id);if(child)visit(child);}};visit(start);return result;
  }finally{await cdp.detach();}
}
try{
  for(const language of ['ko','en'])for(const viewport of [{width:320,height:568},{width:390,height:844},{width:640,height:360},{width:1280,height:720}]){
    const item={label:`${language}-${viewport.width}x${viewport.height}`,screens:[],checks:[]};report.cases.push(item);
    const context=await browser.newContext({viewport,reducedMotion:'reduce'}),page=await context.newPage();page.setDefaultTimeout(10000);
    page.on('pageerror',error=>report.pageerrors.push({label:item.label,message:error.message}));
    try{
      await context.addInitScript(language=>{if(!localStorage.getItem('pawblossom.save.v1'))localStorage.setItem('pawblossom.save.v1',JSON.stringify({version:1,language,highestLevel:6,completed:[1,2,3,4,5],stars:4,coins:200,garden:0,music:false,sfx:false,tutorialSeen:true}));},language);
      await page.route('http://ui.pawblossom.invalid/**',async route=>{
        const url=new URL(route.request().url()),file=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));assert(file.startsWith(root+path.sep));
        if(file.endsWith('.js')){let source=await fs.readFile(file,'utf8');const calls=source.match(/new [\w$.]+\.Game\(\{type:/g)??[];if(calls.length){assert.equal(calls.length,1);source=source.replace(calls[0],'window.__uiGame='+calls[0]);}await route.fulfill({body:source,contentType:'text/javascript'});}
        else await route.fulfill({path:file});
      });
      await page.goto('http://ui.pawblossom.invalid');await ready(page);await screen(page,item,'puzzle');
      assert.equal(await page.locator('html').getAttribute('lang'),language);
      const round=await page.evaluate(()=>JSON.parse(localStorage.getItem('pawblossom.save.v1')).inProgress);
      await page.locator('[data-route="village"]').click();await screen(page,item,'garden');
      item.stageAX={completed:await ax(page,'[data-level="1"]'),locked:await ax(page,'[data-level="7"]')};
      if(!baseline){
        await page.locator('[data-level="1"]').getAttribute('aria-label').then(value=>assert(value.includes(language==='ko'?'완료':'Complete')));
        await page.locator('[data-level="7"]').getAttribute('aria-label').then(value=>assert(value.includes(language==='ko'?'잠김':'Locked')));
        assert.equal(item.stageAX.completed[0].name.value,language==='ko'?'스테이지 1 · 완료':'Level 1 · Complete');
        assert.equal(item.stageAX.locked[0].name.value,language==='ko'?'스테이지 7 · 잠김':'Level 7 · Locked');
        assert(item.stageAX.locked[0].properties.some(property=>property.name==='disabled'&&property.value.value===true));
      }
      assert(await page.locator('[data-level="7"]').isDisabled());
      await page.locator('#grow').focus();
      const before=await page.locator('#village-view').evaluate(el=>({scrollTop:el.scrollTop,focus:document.activeElement.id}));
      await page.keyboard.press('Enter');
      const after=await page.locator('#village-view').evaluate(el=>({scrollTop:el.scrollTop,focus:document.activeElement.id}));
      item.plant={before,after};
      if(!baseline){assert.equal(after.scrollTop,before.scrollTop);assert(['grow','garden-stage'].includes(after.focus));}
      await page.waitForFunction(()=>!document.querySelector('#grow').disabled);
      assert.equal(await page.locator('#star-count').textContent(),'2');assert.equal(await page.locator('#coin-count').textContent(),'200');
      await page.locator('#grow').focus();await page.keyboard.press('Space');
      await page.waitForFunction(()=>JSON.parse(localStorage.getItem('pawblossom.save.v1')).garden===2);
      assert.equal(await page.locator('#star-count').textContent(),'0');assert(await page.locator('#grow').isDisabled());
      item.plant.exhaustedFocus=await page.evaluate(()=>document.activeElement.id);if(!baseline)assert.equal(item.plant.exhaustedFocus,'garden-stage');
      await page.locator('[data-route="journal"]').click();await screen(page,item,'friends');
      await page.locator('#settings-button').click();await screen(page,item,'settings');
      const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('pawblossom.save.v1')));
      await page.locator('#language').focus();await page.locator('#language').selectOption(language==='ko'?'en':'ko');assert.equal(await page.locator('#language').evaluate(el=>document.activeElement.id),'language');
      await page.locator('#language').selectOption(language);assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('pawblossom.save.v1'))),stored);
      await page.locator('#tutorial-help').click();await screen(page,item,'tutorial');await page.locator('#guide-next').click();await page.locator('#guide-next').click();await page.locator('#guide-next').click();
      const targets=page.locator('.practice-target');await targets.nth(0).click();await targets.nth(1).click();await page.locator('#guide-next').click();
      await page.locator('[data-route="puzzle"]').click();await ready(page);
      assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('pawblossom.save.v1')).inProgress),round);
      await page.locator('#restart').focus();await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'game-canvas');await page.keyboard.press('Enter');await page.keyboard.press('Escape');
      await page.reload();await ready(page);assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('pawblossom.save.v1')).inProgress),round);
      assert.equal(await page.locator('#star-count').textContent(),'0');assert.equal(await page.locator('#coin-count').textContent(),'200');
      await page.evaluate(()=>{const scene=__uiGame.scene.getScene('Board'),level=JSON.parse(localStorage.getItem('pawblossom.save.v1')).inProgress;scene.hooks.onMove([999,999,999,999,999,999],1000,1,64);});
      await page.locator('#result-dialog').waitFor({state:'visible'});await screen(page,item,'result');item.rewardAX=await ax(page,'.result-rewards');
      if(!baseline){
        assert.match(await page.locator('.result-rewards').textContent(),language==='ko'?/별.*1.*코인.*40/:/Stars.*1.*Coins.*40/);
        const spoken=item.rewardAX.filter(node=>!node.ignored&&node.role?.value==='StaticText').map(node=>node.name.value).join(' ');
        assert.match(spoken,language==='ko'?/별.*1.*코인.*40/:/Stars.*1.*Coins.*40/);
      }
      await page.locator('#result-next').focus();await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'result-home');await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'result-next');
      item.motion=await page.locator('.result-character').evaluate(el=>getComputedStyle(el).animationName);assert.equal(item.motion,'none');
      item.checks.push('6화면·body overflow0·canvas/nav·가시 버튼44px/hit','완료/잠금 AX·심기 Enter/Space·별2회·코인 보존·포커스/scroll','언어 왕복/저장·튜토리얼 실습·보드 키보드·재로드·결과 AX/모션 감소');
    }finally{await context.close();}
  }
  assert.equal(report.pageerrors.length,0);
}catch(error){report.failure={message:error.message,stack:error.stack};throw error;}
finally{await fs.writeFile(path.join(output,'summary.json'),JSON.stringify(report,null,2)+'\n');await browser.close();}
console.log(JSON.stringify({cases:report.cases.length,screens:report.cases.reduce((n,item)=>n+item.screens.length,0),pageerrors:report.pageerrors.length}));
