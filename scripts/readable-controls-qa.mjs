import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
// 격리 Chrome에서만 관찰 함수를 추가합니다. 배경 표본은 글자 채움을 숨긴 PNG에서 읽습니다.
const {chromium}=await import(process.env.PAWBLOSSOM_PLAYWRIGHT_MODULE?pathToFileURL(path.resolve(process.env.PAWBLOSSOM_PLAYWRIGHT_MODULE)).href:'playwright');
const browser=await chromium.launch({headless:true,channel:'chrome'});
const rows=[],errors=[],checks=[];
try{
  const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  // 측정 중 HMR이 임시 배경 표본 스타일이나 페이지를 교체하지 않도록 격리합니다.
  await page.routeWebSocket('**',socket=>socket.close());
  await page.route('**/src/main.ts*',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text())+'\nwindow.__qa={get scene(){return scene},finish,startLevel};'});});
  const ready=()=>page.waitForFunction(()=>window.__qa?.scene?.sys?.isActive()&&document.querySelector('canvas'));
  await page.goto('http://127.0.0.1:5173');await page.locator('#guide-skip').click();await ready();
  const snapshot=async(language,viewport,screen)=>{
    await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(250);
    const data=await page.evaluate(()=>{
      const modal=document.querySelector('dialog[open]');const root=modal??document.querySelector('#app');
      const visible=el=>{const r=el.getBoundingClientRect();return el.checkVisibility({checkVisibilityCSS:true})&&r.width>1&&r.height>1&&r.bottom>0&&r.top<innerHeight;};
      const clipRect=el=>{const r=el.getBoundingClientRect(),clip={left:Math.max(0,r.left),top:Math.max(0,r.top),right:Math.min(innerWidth,r.right),bottom:Math.min(innerHeight,r.bottom)};for(let p=el.parentElement;p;p=p.parentElement){const s=getComputedStyle(p),b=p.getBoundingClientRect();if(/hidden|auto|scroll|clip/.test(s.overflowY)){clip.top=Math.max(clip.top,b.top);clip.bottom=Math.min(clip.bottom,b.bottom);}if(/hidden|auto|scroll|clip/.test(s.overflowX)){clip.left=Math.max(clip.left,b.left);clip.right=Math.min(clip.right,b.right);}}return clip;};
      const targets=[...root.querySelectorAll('button,select,a')].filter(visible).filter(el=>!el.disabled).map(el=>{const r=el.getBoundingClientRect();return {id:el.id||el.dataset.route||el.dataset.level||el.dataset.testLevel||el.className,x:r.x,y:r.y,w:r.width,h:r.height,visibleRect:clipRect(el)};}).filter(t=>t.visibleRect.right>t.visibleRect.left&&t.visibleRect.bottom>t.visibleRect.top);
      const overlaps=[];for(let i=0;i<targets.length;i++)for(let j=i+1;j<targets.length;j++){const a=targets[i].visibleRect,b=targets[j].visibleRect;if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>.5&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>.5)overlaps.push([targets[i].id,targets[j].id]);}
      const texts=[];const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
      while(walker.nextNode()){
        const node=walker.currentNode,el=node.parentElement;if(!node.textContent.trim()||!visible(el)||el.closest('svg,.sr-only,[aria-hidden="true"]'))continue;
        const style=getComputedStyle(el),range=document.createRange();range.selectNodeContents(node);
        for(const r of range.getClientRects()){
          if(r.width<2||r.height<2)continue;
          let clip={left:Math.max(0,r.left),top:Math.max(0,r.top),right:Math.min(innerWidth,r.right),bottom:Math.min(innerHeight,r.bottom)},opacity=1;
          for(let p=el;p;p=p.parentElement){const s=getComputedStyle(p),b=p.getBoundingClientRect();opacity*=Number(s.opacity);if(/hidden|auto|scroll|clip/.test(s.overflowY)){clip.top=Math.max(clip.top,b.top);clip.bottom=Math.min(clip.bottom,b.bottom);}if(/hidden|auto|scroll|clip/.test(s.overflowX)){clip.left=Math.max(clip.left,b.left);clip.right=Math.min(clip.right,b.right);}}
          if(clip.right-clip.left<4||clip.bottom-clip.top<4)continue;
          texts.push({text:node.textContent.trim(),color:style.color,opacity,disabled:!!el.closest(':disabled'),rect:clip});
        }
      }
      const view=document.querySelector('.view:not([hidden])');
      return {targets,overlaps,texts,bodyOverflow:document.body.scrollWidth>innerWidth||document.body.scrollHeight>innerHeight,viewOverflow:view?view.scrollHeight>view.clientHeight+1:false,canvas:document.querySelector('canvas').getBoundingClientRect().toJSON()};
    });
    const hide=await page.addStyleTag({content:'*{-webkit-text-fill-color:transparent!important;text-shadow:none!important}'});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const png=(await page.screenshot()).toString('base64');await hide.evaluate(el=>el.remove());
    const contrast=await page.evaluate(async({png,texts})=>{
      const bitmap=await createImageBitmap(await(await fetch('data:image/png;base64,'+png)).blob());const c=document.createElement('canvas');c.width=bitmap.width;c.height=bitmap.height;const ctx=c.getContext('2d');ctx.drawImage(bitmap,0,0);const pixels=ctx.getImageData(0,0,c.width,c.height).data;
      const luminance=rgb=>rgb.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
      return texts.map(t=>{const fg=t.color.match(/[\d.]+/g).map(Number);let min=Infinity,bgAtMin;
        for(let y=Math.ceil(t.rect.top+2);y<t.rect.bottom-2;y+=3)for(let x=Math.ceil(t.rect.left+2);x<t.rect.right-2;x+=3){const n=(y*c.width+x)*4,bg=[pixels[n],pixels[n+1],pixels[n+2]],alpha=(fg[3]??1)*t.opacity,composite=fg.slice(0,3).map((v,i)=>v*alpha+bg[i]*(1-alpha)),a=luminance(composite),b=luminance(bg),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);if(ratio<min){min=ratio;bgAtMin=bg;}}
        return {...t,ratio:min,background:bgAtMin};});
    },{png,texts:data.texts});
    const small=data.targets.filter(t=>t.w<43.9||t.h<43.9);const low=contrast.filter(t=>!t.disabled&&t.ratio<4.5);
    rows.push({language,viewport,screen,...data,texts:contrast,small,low});
    assert.equal(data.bodyOverflow,false,`${screen} body overflow`);assert.deepEqual(data.overlaps,[],`${screen} overlap`);assert.deepEqual(small,[],`${screen} target size`);
    if(screen==='puzzle')assert.equal(data.viewOverflow,false);
    const evidence=(viewport.width===320&&language==='ko'&&['puzzle','settings','menu-bottom','tutorial-practice-bottom','result-reward'].includes(screen))||(viewport.width===640&&language==='en'&&['puzzle','settings-bottom','test-picker','tutorial-practice-bottom','result-retry'].includes(screen));
    if(evidence)await page.screenshot({path:`docs/screenshots/readable-${viewport.width}-${language}-${screen}.png`});
  };
  for(const viewport of [{width:320,height:568},{width:360,height:640},{width:390,height:844},{width:640,height:360}]){
    await page.setViewportSize(viewport);
    for(const language of ['ko','en']){
      await page.evaluate(language=>{localStorage.setItem('pawblossom.save.v1',JSON.stringify({version:1,language,highestLevel:30,completed:[1],stars:1,coins:40,garden:1,music:false,sfx:false,tutorialSeen:true}));},language);await page.reload();await ready();
      await snapshot(language,viewport,'puzzle');
      await page.locator('#settings-button').click();await snapshot(language,viewport,'settings');
      for(const id of ['music-toggle','sfx-toggle']){await page.locator('#'+id).focus();const before=await page.locator('#'+id).getAttribute('aria-checked');await page.keyboard.press('Space');assert.equal(await page.evaluate(()=>document.activeElement.id),id);assert.notEqual(await page.locator('#'+id).getAttribute('aria-checked'),before);await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>document.activeElement.id),id);assert.equal(await page.locator('#'+id).getAttribute('aria-checked'),before);}
      await page.locator('#language').focus();await page.locator('#language').selectOption(language==='ko'?'en':'ko');assert.equal(await page.evaluate(()=>document.activeElement.id),'language');await page.locator('#language').selectOption(language);
      await page.locator('#tutorial-help').scrollIntoViewIfNeeded();await snapshot(language,viewport,'settings-bottom');
      if([320,640].includes(viewport.width)){
        await page.locator('#tutorial-help').click();await snapshot(language,viewport,'tutorial-first');await page.locator('#guide-skip').scrollIntoViewIfNeeded();await snapshot(language,viewport,'tutorial-first-bottom');
        for(let i=0;i<3;i++)await page.locator('#guide-next').click();await snapshot(language,viewport,'tutorial-practice');await page.locator('#guide-skip').scrollIntoViewIfNeeded();await snapshot(language,viewport,'tutorial-practice-bottom');await page.locator('#guide-skip').click();
      }
      await page.locator('[data-route="village"]').click();await snapshot(language,viewport,'menu');
      await page.locator('#village-view').evaluate(el=>{el.scrollTop=el.scrollHeight;});await snapshot(language,viewport,'menu-bottom');
      await page.locator('[data-route="journal"]').click();await snapshot(language,viewport,'journal');
      await page.locator('#journal-view').evaluate(el=>{el.scrollTop=el.scrollHeight;});await snapshot(language,viewport,'journal-bottom');
      await page.locator('[data-route="puzzle"]').click();await page.locator('#test-level-button').click();await snapshot(language,viewport,'test-picker');
      await page.locator('#test-chapter-1').focus();await page.keyboard.press('ArrowRight');assert.equal(await page.evaluate(()=>document.activeElement.id),'test-chapter-2');await page.keyboard.press('Home');await page.locator('[data-test-level="1"]').click();await ready();
      await page.evaluate(()=>window.__qa.finish(false));await snapshot(language,viewport,'result-retry');assert.equal(await page.evaluate(()=>document.activeElement.id),'result-next');await page.keyboard.press('Enter');await ready();
      await page.evaluate(()=>window.__qa.finish(true));await snapshot(language,viewport,'result-test-win');await page.locator('#result-home').click();
      await page.locator('[data-route="puzzle"]').click();await page.locator('#test-level-button').click();await page.locator('#test-normal').click();await ready();await page.evaluate(()=>window.__qa.finish(true));await snapshot(language,viewport,'result-reward');await page.locator('#result-home').click();
    }
  }
  checks.push('4개 화면 × KO/EN × 11개 화면: 실제 CSS 버튼 44px·겹침·body overflow 검사, 메뉴/설정/친구 하단 포함','320×568/640×360 KO/EN: 튜토리얼 처음/실습·각 하단·건너뛰기 닫기 접근','설정 토글 Space/Enter 및 언어 변경 후 포커스 유지','테스트 탭 ArrowRight/Home·결과 Enter 실행','일반 보상/테스트 승리/실패·비활성 버튼 스타일');
  const report={dateKst:'2026-10-15',browser:browser.version(),method:'CSS 전경색과 글자 채움만 숨긴 실제 화면 PNG의 3px 간격 배경 표본. 일반 텍스트 목표 4.5:1, 비활성·aria-hidden 장식 그림/기호·SVG·sr-only 제외. 안티앨리어싱 픽셀은 전경색으로 사용하지 않음. 실제 Android/TalkBack 미검증.',checks,errors,rows};
  fs.writeFileSync('docs/performance/readable-controls-20261015.json',JSON.stringify(report,null,2)+'\n');
  const low=rows.flatMap(r=>r.low.map(t=>({language:r.language,viewport:r.viewport,screen:r.screen,text:t.text,ratio:t.ratio,color:t.color,background:t.background})));
  console.log(JSON.stringify({screens:rows.length,minimum:Math.min(...rows.flatMap(r=>r.texts.filter(t=>!t.disabled).map(t=>t.ratio))),low,errors},null,2));assert.deepEqual(low,[]);assert.deepEqual(errors,[]);
}catch(error){console.error(JSON.stringify({completed:rows.length,errors},null,2));throw error;}finally{await browser.close();}
