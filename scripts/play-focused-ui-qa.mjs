import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';

// 사용자 저장/기존 창/서버를 사용하지 않는 실제 dist 브라우저 QA입니다.
const arg=name=>process.argv.find(value=>value.startsWith(`--${name}=`))?.slice(name.length+3);
const output=arg('output'),root=path.resolve(arg('root')??'dist'),baseline=process.argv.includes('--baseline');
const resumeOnly=process.argv.includes('--resume-only');
const settingsOnly=process.argv.includes('--settings-only');
const transientOnly=process.argv.includes('--transient-only');
const transientReduced=process.argv.includes('--transient-reduced');
assert(output&&process.env.PAWBLOSSOM_PLAYWRIGHT_MODULE,'--output와 PAWBLOSSOM_PLAYWRIGHT_MODULE이 필요합니다.');
await fs.mkdir(output,{recursive:false});
const {chromium}=await import(pathToFileURL(process.env.PAWBLOSSOM_PLAYWRIGHT_MODULE).href);
const browser=await chromium.launch({headless:true,channel:'chrome'});
const report={dateKst:'2026-10-20',baseline,resumeOnly,settingsOnly,transientOnly,transientReduced,root,flags:JSON.parse(await fs.readFile(path.join(root,'build-info.json'),'utf8')),browser:browser.version(),
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
async function resumeEvidence(page){
  return page.evaluate(()=>{
    const rect=el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
    const note=document.querySelector('#round-resumed-notice')??document.querySelector('#toast'),bounds=rect(note);
    const overlaps=el=>{const r=rect(el);return bounds.x<r.right&&bounds.right>r.x&&bounds.y<r.bottom&&bounds.bottom>r.y;};
    const text=document.querySelector('.tool-note [data-t]').firstChild,lines=[];
    for(let i=0;i<text.length;i++){const range=document.createRange();range.setStart(text,i);range.setEnd(text,i+1);const r=range.getBoundingClientRect();if(!r.width)continue;let line=lines.find(line=>Math.abs(line.y-r.y)<1);if(!line){line={y:r.y,text:''};lines.push(line);}line.text+=text.textContent[i];}
    return {note:{id:note.id,text:note.textContent,bounds},hint:rect(document.querySelector('.board-hint')),canvas:rect(document.querySelector('canvas')),
      overlapsNav:overlaps(document.querySelector('.bottom-nav')),overlapsCanvas:overlaps(document.querySelector('canvas')),overlapsTools:overlaps(document.querySelector('.tools')),
      focus:document.activeElement.id,toolLines:lines.map(line=>line.text),overflowX:document.documentElement.scrollWidth-innerWidth,overflowY:document.documentElement.scrollHeight-innerHeight};
  });
}
async function retryFocusSpacing(page){
  const evidence=await page.locator('#save-retry').evaluate(button=>{
    const r=button.getBoundingClientRect(),style=getComputedStyle(button),outside=parseFloat(style.outlineWidth)+parseFloat(style.outlineOffset),range=document.createRange();
    range.selectNodeContents(document.querySelector('#save-status'));
    const text=[...range.getClientRects()].map(r=>({x:r.x,y:r.y,right:r.right,bottom:r.bottom})),ring={x:r.x-outside,y:r.y-outside,right:r.right+outside,bottom:r.bottom+outside};
    return {focusVisible:button.matches(':focus-visible'),text,ring,gap:ring.y-Math.max(...text.map(r=>r.bottom)),overlap:text.some(r=>r.x<ring.right&&r.right>ring.x&&r.y<ring.bottom&&r.bottom>ring.y)};
  });
  assert(evidence.focusVisible);assert(!evidence.overlap);assert(evidence.gap>=0);return evidence;
}
try{
  for(const language of ['ko','en'])for(const viewport of (transientOnly?[{width:320,height:568},{width:640,height:360}]:[{width:320,height:568},{width:390,height:844},{width:640,height:360},{width:1280,height:720}])){
    const item={label:`${language}-${viewport.width}x${viewport.height}`,screens:[],checks:[]};report.cases.push(item);
    const context=await browser.newContext({viewport,reducedMotion:transientOnly&&!transientReduced?'no-preference':'reduce'}),page=await context.newPage();page.setDefaultTimeout(10000);
    page.on('pageerror',error=>report.pageerrors.push({label:item.label,message:error.message}));
    try{
      await context.addInitScript(language=>{if(!localStorage.getItem('pawblossom.save.v1'))localStorage.setItem('pawblossom.save.v1',JSON.stringify({version:1,language,highestLevel:6,completed:[1,2,3,4,5],stars:4,coins:200,garden:0,music:false,sfx:false,tutorialSeen:true}));},language);
      if(settingsOnly)await context.addInitScript(()=>{
        const get=Storage.prototype.getItem,set=Storage.prototype.setItem,remove=Storage.prototype.removeItem;
        window.__settingsFault={read:'',write:''};
        window.__settingsDisk=()=>['pawblossom.save.v1','pawblossom.save.v1.backup','pawblossom.save.v1.reset'].map(key=>[key,get.call(localStorage,key)]);
        window.__settingsPut=(key,value)=>value===null?remove.call(localStorage,key):set.call(localStorage,key,value);
        Storage.prototype.getItem=function(key){if(this===localStorage&&__settingsFault.read===key)throw new DOMException('QA read','SecurityError');return get.call(this,key);};
        Storage.prototype.setItem=function(key,value){if(this===localStorage&&__settingsFault.write===key)throw new DOMException('QA quota','QuotaExceededError');return set.call(this,key,value);};
      });
      await page.route('http://ui.pawblossom.invalid/**',async route=>{
        const url=new URL(route.request().url()),file=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));assert(file.startsWith(root+path.sep));
        if(file.endsWith('.js')){let source=await fs.readFile(file,'utf8');const calls=source.match(/new [\w$.]+\.Game\(\{type:/g)??[];if(calls.length){assert.equal(calls.length,1);source=source.replace(calls[0],'window.__uiGame='+calls[0]);}await route.fulfill({body:source,contentType:'text/javascript'});}
        else await route.fulfill({path:file});
      });
      await page.goto('http://ui.pawblossom.invalid');await ready(page);await screen(page,item,'puzzle');
      if(transientOnly){
        const board=page.locator('#board-notice'),toast=page.locator('#toast');
        const spoken=nodes=>nodes.filter(node=>!node.ignored&&node.role?.value==='StaticText').map(node=>node.name.value);
        const empty=async(selector)=>{assert.equal(await page.locator(selector).textContent(),'');const nodes=await ax(page,selector);assert.deepEqual(spoken(nodes),[]);return nodes;};
        const show=key=>page.evaluate(key=>__uiGame.scene.getScene('Board').hooks.onNotice(key),key);
        // 안내 콜백에만 fixture를 공급하며 엔진/자연 플레이 성공으로 간주하지 않습니다.
        item.transient={fixture:'onNotice 안내·onMove 결과 수량 fixture. 토스트는 실제 꽃 심기 UI.',events:[]};
        await page.evaluate(()=>{const el=document.querySelector('#board-notice');window.__noticeEvents=[];el.addEventListener('animationstart',e=>__noticeEvents.push({type:e.type,time:performance.now(),isTrusted:e.isTrusted}));el.addEventListener('animationend',e=>__noticeEvents.push({type:e.type,time:performance.now(),elapsed:e.elapsedTime,isTrusted:e.isTrusted}));});
        if(transientReduced){
          item.transient.motion='reduce: 기존 CSS .01ms; 1300ms 노출 검증과 구분';
          const active=await page.evaluate(()=>{const scene=__uiGame.scene.getScene('Board');scene.hooks.onNotice('chain');document.querySelector('#language-toggle').click();return document.querySelector('#board-notice').textContent;});
          assert.equal(active,language==='ko'?'Keep it going!':'또 맞았어요!');await page.locator('#language-toggle').click();
          await page.waitForFunction(()=>document.querySelector('#board-notice').textContent==='');item.transient.expiredBoardAX=await empty('#board-notice');
          await page.evaluate(()=>{const scene=__uiGame.scene.getScene('Board');scene.hooks.onNotice('chain');scene.hooks.onNotice('matched');document.querySelector('#restart').click();scene.hooks.onNotice('chain');});
          await ready(page);await empty('#board-notice');
          await page.locator('[data-route="village"]').click();await page.locator('#grow').click();await page.locator('#language-toggle').click();
          assert.equal(await toast.textContent(),language==='ko'?'A new patch is blooming!':'새 꽃밭이 피어났어요!');await page.locator('#language-toggle').click();
          await page.waitForFunction(()=>!document.querySelector('#grow').disabled);await page.locator('#grow').click();const started=Date.now();
          await page.waitForFunction(()=>document.querySelector('#toast').textContent==='');item.transient.toastExpiryObservedMs=Date.now()-started;assert(item.transient.toastExpiryObservedMs>=3000);
          item.transient.expiredToastAX=await empty('#toast');item.transient.events=await page.evaluate(()=>__noticeEvents);
          assert(item.transient.events.some(event=>event.isTrusted&&event.type==='animationend'&&Math.abs(event.elapsed-0.00001)<0.000001));
          await page.locator('#language-toggle').click();await page.locator('#language-toggle').click();await empty('#toast');
          await page.locator('[data-route="puzzle"]').click();await ready(page);await empty('#board-notice');
          item.checks.push('reduce 기존 .01ms 실제 trusted 종료·동일 task 활성 번역·연속/새 회차 정리·toast 연속/활성 번역/3200ms만료·빈 Chrome AX');
          await screen(page,item,'reduced-expired');continue;
        }
        await show('chain');assert.equal(await board.textContent(),language==='ko'?'또 맞았어요!':'Keep it going!');
        item.transient.activeBoardAX=await ax(page,'#board-notice');assert(spoken(item.transient.activeBoardAX).includes(await board.textContent()));
        await page.locator('#language-toggle').click();assert.equal(await board.textContent(),language==='ko'?'Keep it going!':'또 맞았어요!');
        await page.locator('#language-toggle').click();await screen(page,item,'board-active');
        await page.waitForFunction(()=>document.querySelector('#board-notice').textContent==='');assert.equal(await board.evaluate(el=>el.classList.contains('pop')),false);
        item.transient.expiredBoardAX=await empty('#board-notice');
        await page.locator('#language-toggle').click();await page.locator('#language-toggle').click();await empty('#board-notice');
        await show('chain');await page.waitForTimeout(250);await show('matched');
        await page.evaluate(()=>document.querySelector('#board-notice').dispatchEvent(new AnimationEvent('animationend',{animationName:'notice',elapsedTime:1.3})));
        assert((await board.textContent()).length>0);assert(await board.evaluate(el=>el.classList.contains('pop')));
        await page.waitForFunction(()=>document.querySelector('#board-notice').textContent==='');await empty('#board-notice');
        await show('matched');await page.locator('#settings-button').click();
        assert.equal(await board.textContent(),'');assert.equal(await board.evaluate(el=>el.classList.contains('pop')),false);
        await page.waitForTimeout(1500);await page.locator('#settings-button').click();await ready(page);
        item.transient.returnedBoardAX=await empty('#board-notice');assert.equal(await board.evaluate(el=>el.getAnimations().length),0);
        await show('chain');await page.evaluate(()=>{window.__previousNoticeScene=__uiGame.scene.getScene('Board');});await page.locator('#restart').click();await ready(page);await empty('#board-notice');
        await show('matched');const current=await board.textContent();await page.evaluate(()=>__previousNoticeScene.hooks.onNotice('chain'));assert.equal(await board.textContent(),current);
        await page.waitForFunction(()=>document.querySelector('#board-notice').textContent==='');await empty('#board-notice');
        await show('matched');await page.evaluate(()=>__uiGame.scene.getScene('Board').hooks.onMove([999,999,999,999,999,999],1000,1,64));
        await page.locator('#result-dialog').waitFor({state:'visible'});await page.locator('#result-next').click();await ready(page);await empty('#board-notice');
        await page.locator('[data-route="village"]').click();await page.locator('#grow').click();
        assert(await toast.evaluate(el=>el.classList.contains('visible')));item.transient.activeToastAX=await ax(page,'#toast');assert(spoken(item.transient.activeToastAX).includes(await toast.textContent()));
        await page.locator('#language-toggle').click();assert.equal(await toast.textContent(),language==='ko'?'A new patch is blooming!':'새 꽃밭이 피어났어요!');await page.locator('#language-toggle').click();
        await page.waitForFunction(()=>!document.querySelector('#grow').disabled);await page.locator('#grow').click();
        const toastStarted=Date.now();await screen(page,item,'toast-active');
        await page.waitForFunction(()=>document.querySelector('#toast').textContent==='');assert.equal(await toast.evaluate(el=>el.classList.contains('visible')),false);
        item.transient.toastExpiryObservedMs=Date.now()-toastStarted;assert(item.transient.toastExpiryObservedMs>=3000&&item.transient.toastExpiryObservedMs<4500);
        item.transient.expiredToastAX=await empty('#toast');await page.locator('#language-toggle').click();await page.locator('#language-toggle').click();await empty('#toast');
        item.transient.events=await page.evaluate(()=>__noticeEvents);assert(item.transient.events.some(event=>event.isTrusted&&event.type==='animationend'&&event.elapsed===1.3));
        item.checks.push('자연1300ms 보드 만료/3200ms 토스트 만료·활성 KOEN 전환·만료 DOM/Chrome AX 정리',
          '연속 보드/토스트·늦은 animationend·이전 회차 콜백 보호·설정이탈/1500ms뒤복귀·restart/결과→다음회차 정리');
        await screen(page,item,'transient-expired');continue;
      }
      if(settingsOnly){
        await page.locator('#settings-button').click();await screen(page,item,'settings-normal');
        item.settings=await page.locator('#settings-view').evaluate(el=>({clientHeight:el.clientHeight,scrollHeight:el.scrollHeight,cardVisible:!!document.querySelector('.storage-card').getClientRects().length,offline:document.querySelector('.save-note').textContent}));
        item.checks.push('정상 설정 실제 내부 높이·저장 카드·설명·PNG');
        if(!baseline){
          const card=page.locator('#storage-card'),retry=page.locator('#save-retry'),reload=page.locator('#save-reload');
          const disk=()=>page.evaluate(()=>__settingsDisk()),key='pawblossom.save.v1',backup=key+'.backup';
          const warning=async()=>{assert(await card.isVisible());assert(await page.locator('#settings-button').evaluate(el=>el.classList.contains('save-attention')));assert((await page.locator('#storage-announcement').textContent()).length>0);};
          assert.equal(await card.isVisible(),false);assert.equal(await retry.isVisible(),false);assert.equal(await reload.isVisible(),false);
          const saved=await disk();await page.locator('#language').focus();await page.locator('#language').selectOption(language==='ko'?'en':'ko');await page.locator('#language').selectOption(language);
          assert.equal(await page.evaluate(()=>document.activeElement.id),'language');assert.deepEqual(await disk().then(rows=>JSON.parse(rows[0][1])),JSON.parse(saved[0][1]));
          const email=page.locator('#support-email');assert.equal(await email.textContent(),'doeud1410@gmail.com');assert.equal(await page.locator('a[href^="mailto:"]').count(),0);
          item.settings.email=await email.evaluate(el=>{const r=document.createRange();r.selectNodeContents(el);const selection=getSelection();selection.removeAllRanges();selection.addRange(r);const selected=selection.toString();selection.removeAllRanges();return {selected,userSelect:getComputedStyle(el).userSelect,width:el.getBoundingClientRect().width,scrollWidth:el.scrollWidth};});
          assert.equal(item.settings.email.selected,'doeud1410@gmail.com');assert.equal(item.settings.email.userSelect,'text');assert(item.settings.email.scrollWidth<=item.settings.email.width+1);
          await email.scrollIntoViewIfNeeded();await screen(page,item,'settings-support');
          const before=await disk();await page.evaluate(backup=>{__settingsFault.write=backup;},backup);await page.locator('#music-toggle').click();await warning();assert(await retry.isVisible());assert.deepEqual(await disk(),before);
          await retry.scrollIntoViewIfNeeded();await screen(page,item,'settings-write-failed');
          await retry.focus();await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>document.activeElement.id),'save-retry');
          item.settings.warningFocus=await retryFocusSpacing(page);
          await page.evaluate(()=>{__settingsFault.write='';});await page.keyboard.press('Space');
          assert(await card.isVisible());assert(await retry.isVisible());assert.equal(await page.evaluate(()=>document.activeElement.id),'save-retry');
          assert.equal(await page.locator('#settings-button').evaluate(el=>el.classList.contains('save-attention')),false);
          assert.equal(JSON.parse((await disk())[0][1]).music,!JSON.parse(before[0][1]).music);
          await page.locator('#language').selectOption(language==='ko'?'en':'ko');assert.equal(await page.evaluate(()=>document.activeElement.id),'save-retry');assert(await card.isVisible());assert(await retry.isVisible());
          await page.locator('#language').selectOption(language);assert.equal(await page.evaluate(()=>document.activeElement.id),'save-retry');item.settings.savedFocus=await retryFocusSpacing(page);await screen(page,item,'settings-retry-focus');
          await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'reset');assert.equal(await card.isVisible(),false);await screen(page,item,'settings-retry-blur');
          await page.evaluate(({key,backup})=>{__settingsPut(backup,__settingsDisk()[0][1]);__settingsPut(key,'{');},{key,backup});
          await page.reload();await ready(page);await page.locator('#settings-button').click();await warning();assert.equal(await retry.isVisible(),false);await card.scrollIntoViewIfNeeded();await screen(page,item,'settings-recovery-copy');
          await page.evaluate(key=>{const value=JSON.parse(__settingsDisk()[0][1]);value.coins+=40;__settingsPut(key,JSON.stringify(value));},key);
          const conflict=await disk();await page.locator('#music-toggle').click();await warning();assert(await reload.isVisible());assert(await retry.isVisible());assert.deepEqual(await disk(),conflict);
          page.once('dialog',dialog=>dialog.dismiss());await reload.click();assert.deepEqual(await disk(),conflict);await retry.click();assert.deepEqual(await disk(),conflict);await reload.scrollIntoViewIfNeeded();await screen(page,item,'settings-conflict');
          for(const [name,raw] of [['corrupt','{'],['unsupported','{"version":2}']]){
            await page.evaluate(({key,backup,raw})=>{__settingsPut(key,raw);__settingsPut(backup,null);},{key,backup,raw});
            await page.reload();await page.locator('canvas').waitFor();if(await page.locator('#tutorial-dialog').evaluate(el=>el.open))await page.locator('#guide-skip').click();await ready(page);
            await page.locator('#settings-button').click();await page.locator('#language').selectOption(language);await warning();assert(await retry.isVisible());assert.equal(await reload.isVisible(),false);
            assert.equal((await disk())[0][1],raw);await card.scrollIntoViewIfNeeded();await screen(page,item,`settings-${name}`);
          }
          await page.locator('#settings-button').click();await ready(page);const puzzle=await page.locator('#puzzle-view').evaluate(el=>({scrollHeight:el.scrollHeight,clientHeight:el.clientHeight}));assert(puzzle.scrollHeight<=puzzle.clientHeight+1);
          item.checks.push('정상 중복 축소·KOEN 언어 왕복·이메일 일반텍스트 선택/줄바꿈·실제 backup쓰기실패/복구·재시도 Enter/Space·회복/언어 DOM교체 후 초점/blur 접기',
            '실제 손상 primary→정상 backup복구·외부저장충돌/reload취소·손상/미지원 원문보존·경고/live/설정배지/복구조작·퍼즐무스크롤');
        }
        continue;
      }
      if(resumeOnly){
        await page.reload();await ready(page);
        await page.waitForFunction(baseline=>baseline?getComputedStyle(document.querySelector('#toast')).opacity==='1':!document.querySelector('#round-resumed-notice').hidden,baseline);
        item.resume=await resumeEvidence(page);await screen(page,item,'resume-active');
        item.checks.push('최신 dist 저장 회차 재로드·활성 복원 안내 PNG/실제 bounds·도구 글자별 줄바꿈');
        if(!baseline){
          const note=page.locator('#round-resumed-notice'),stored=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('pawblossom.save.v1'))),saved=await stored();
          const sameGeometry=(a,b)=>{for(const name of ['canvas','hint'])for(const key of ['x','y','width','height'])assert(Math.abs(a[name][key]-b[name][key])<1,`${item.label} ${name}.${key}`);};
          assert(!item.resume.overlapsNav&&!item.resume.overlapsCanvas&&!item.resume.overlapsTools);
          assert(item.resume.note.bounds.y>=item.resume.hint.y&&item.resume.note.bounds.bottom<=item.resume.hint.bottom);
          assert.equal(item.resume.overflowX,0);assert.equal(item.resume.overflowY,0);assert.equal(item.resume.focus,'');
          assert.equal(await page.locator('#toast').evaluate(el=>el.classList.contains('visible')),false);
          item.resumeAX=await ax(page,'#round-resumed-notice');
          assert(item.resumeAX.some(node=>!node.ignored&&node.role?.value==='StaticText'&&node.name.value===item.resume.note.text));
          const started=Date.now();
          await page.locator('#language-toggle').click();assert.equal(await note.textContent(),language==='ko'?'Your saved round has resumed.':'저장된 회차를 이어서 시작했어요.');
          await page.locator('#language-toggle').click();assert.deepEqual(await stored(),saved);
          await page.waitForFunction(()=>document.querySelector('#round-resumed-notice').hidden);
          item.expiry={observedMs:Date.now()-started,geometry:await resumeEvidence(page)};sameGeometry(item.resume,item.expiry.geometry);
          assert.equal(await note.textContent(),'');await screen(page,item,'resume-expired');
          await page.locator('#language-toggle').click();await page.locator('#language-toggle').click();assert.equal(await note.textContent(),'');
          await page.reload();await ready(page);assert(await note.isVisible());
          await page.locator('#restart').focus();await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'game-canvas');
          assert(await page.locator('#board-keyboard-help').isVisible());assert.equal(await note.isVisible(),false);assert.equal(await note.evaluate(el=>el.hidden),false);
          await screen(page,item,'resume-keyboard');await page.keyboard.press('ArrowRight');assert.equal(await note.evaluate(el=>el.hidden),true);assert.deepEqual(await stored(),saved);
          await page.keyboard.press('Enter');assert(await page.evaluate(()=>Boolean(__uiGame.scene.getScene('Board').keyboardState().selected)));await page.keyboard.press('Escape');
          await page.reload();await ready(page);assert(await note.isVisible());
          const canvas=await page.locator('canvas').boundingBox();await page.mouse.click(canvas.x+canvas.width/16,canvas.y+canvas.height/16);
          assert.equal(await note.evaluate(el=>el.hidden),true);assert(await page.evaluate(()=>Boolean(__uiGame.scene.getScene('Board').keyboardState().selected)));assert.deepEqual(await stored(),saved);
          await page.reload();await ready(page);await page.locator('#restart').click();await ready(page);assert.equal(await note.evaluate(el=>el.hidden),true);
          await page.reload();await ready(page);assert(await note.isVisible());await page.locator('#settings-button').click();assert.equal(await note.evaluate(el=>el.hidden),true);
          item.checks.push('복원 안내/menu-board-tools 비겹침·Chrome AX·초점불변·언어 왕복/자연3200ms만료·만료전후canvas/hint높이불변',
            '실제 Tab 도움말 우선·Arrow 입력정리·Enter선택/Escape·마우스첫선택/저장불변·restart회차/설정이탈 정리');
        }
        continue;
      }
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
