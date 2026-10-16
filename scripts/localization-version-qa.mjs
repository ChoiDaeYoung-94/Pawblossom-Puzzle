import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';

// 실제 dist를 격리 Chrome에서 실행합니다. 관찰용 Game 참조만 응답에 노출합니다.
// 열린 모달의 언어 변경은 숨겨진 select의 기존 onchange를 호출한 오류/회귀 주입입니다.
const modulePath=process.env.PAWBLOSSOM_PLAYWRIGHT_MODULE;
const {chromium}=await import(modulePath?pathToFileURL(path.resolve(modulePath)).href:'playwright');
const root=path.resolve('dist'),flags=JSON.parse(await fs.readFile(path.join(root,'build-info.json'),'utf8'));
const version=JSON.parse(await fs.readFile('package.json','utf8')).version;
assert.deepEqual(Object.keys(flags).sort(),['androidTestAds','androidTestBilling','testTools']);
const variant=flags.testTools?'testing':'production';
const browser=await chromium.launch({headless:true,channel:'chrome'});
const hashes=async()=>Object.fromEntries(await Promise.all(['src/main.ts','src/i18n.ts','src/appVersion.ts','vite.config.ts','package.json','scripts/localization-version-qa.mjs'].map(async file=>[file,createHash('sha256').update(await fs.readFile(file)).digest('hex')])));
if(process.argv.includes('--development')){
  const {createServer}=await import('vite');
  const server=await createServer({server:{host:'127.0.0.1',port:0}});
  try{
    await server.listen();const context=await browser.newContext({viewport:{width:360,height:640}}),page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await context.addInitScript(()=>localStorage.setItem('pawblossom.save.v1',JSON.stringify({version:1,language:'ko',highestLevel:1,completed:[],stars:0,coins:0,garden:0,music:false,sfx:false,tutorialSeen:true})));
    await page.goto(server.resolvedUrls.local[0]);await page.locator('#settings-button').click();
    assert.equal(await page.locator('.version').textContent(),`Pawblossom Puzzle · v${version}`);
    await page.locator('#language').focus();await page.locator('#language').selectOption('en');
    assert.equal(await page.evaluate(()=>document.activeElement.id),'language');assert.equal(await page.locator('.version').textContent(),`Pawblossom Puzzle · v${version}`);
    assert.equal(await page.locator('#test-level-button').count(),1);assert.deepEqual(errors,[]);
    const defines=server.config.define;
    assert.equal(defines.__APP_VERSION__,JSON.stringify(version));assert.equal(defines.__TEST_TOOLS_ENABLED__,'true');assert.equal(defines.__ANDROID_TEST_ADS_ENABLED__,'false');assert.equal(defines.__ANDROID_TEST_BILLING_ENABLED__,'false');
    await fs.writeFile('docs/performance/issue-68-localization-development-20261016.json',JSON.stringify({issue:68,dateKst:'2026-10-16',variant:'development',version,browser:browser.version(),viewport:{width:360,height:640},defines,settingsVersion:true,languageFocusPreserved:true,pageerrors:errors,hashes:await hashes()},null,2)+'\n');
    console.log(JSON.stringify({variant:'development',version,errors}));await context.close();
  }finally{await browser.close();await server.close();}
  process.exit(0);
}
const report={issue:68,dateKst:'2026-10-16',variant,version,flags,browser:browser.version(),environment:'격리 headless Chrome·실제 dist. 헤더/설정은 실제 UI, 모달 내부 변경은 기존 onchange 관찰 호출. 결과 판정은 실제 Scene onMove를 통한 주입. Android·TalkBack·청취·출시 검증 아님.',cases:[],pageerrors:[]};
const opposite=language=>language==='ko'?'en':'ko';
const expected={ko:{meadow:'꽃잎 초원',friends:'포블로섬 친구들',pip:'정원사 토끼 핍',nav:'주 메뉴',music:'배경음',board:'매치3 보드.',retry:'다시 도전',lose:'다시 시작해 볼까요?',win:'풍성한 수확이에요!',complete:'초원을 완성했어요!',warning:'복구 사본을 쓰지 못해'},en:{meadow:'Blossom Meadow',friends:'Pawblossom Friends',pip:'Pip the gardener',nav:'Main navigation',music:'Music',board:'Match-3 board.',retry:'Try again',lose:'A fresh start awaits.',win:'Lovely little harvest!',complete:'Meadow complete!',warning:'recovery copy could not be written'}};
const saved=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('pawblossom.save.v1')));
const withoutLanguage=save=>{const {language,...rest}=save;return rest;};
async function checkLabels(page,language){
  const value=await page.evaluate(()=>({lang:document.documentElement.lang,art:document.querySelector('.art-label').textContent.trim(),pip:document.querySelector('.meadow-art .pip').alt,friend:document.querySelector('#journal-view .eyebrow').textContent,friendPip:document.querySelector('.journal-card>img').alt,friendMeadow:document.querySelector('.friend-tag').textContent.trim(),village:document.querySelector('#village-view .eyebrow').textContent,nav:document.querySelector('.bottom-nav').getAttribute('aria-label'),music:document.querySelector('#music-toggle').getAttribute('aria-label'),board:document.querySelector('#game-canvas').getAttribute('aria-label'),version:document.querySelector('.version').textContent}));
  const e=expected[language];assert.equal(value.lang,language);assert.equal(value.art,e.meadow);assert.equal(value.pip,e.pip);assert.equal(value.friend,e.friends);assert.equal(value.friendPip,e.pip);assert.equal(value.friendMeadow,e.meadow);assert.equal(value.village,e.meadow);assert.equal(value.nav,e.nav);assert.equal(value.music,e.music);assert.ok(value.board.startsWith(e.board));assert.equal(value.version,`Pawblossom Puzzle · v${version}`);return value;
}
async function layout(page,selector){
  const value=await page.locator(selector).evaluate(element=>{
    const rect=element.getBoundingClientRect();return {x:rect.x,y:rect.y,width:rect.width,height:rect.height,scrollWidth:element.scrollWidth,clientWidth:element.clientWidth,pageWidth:document.documentElement.scrollWidth,viewportWidth:innerWidth};
  });
  assert.ok(value.pageWidth<=value.viewportWidth+1,JSON.stringify(value));assert.ok(value.scrollWidth<=value.clientWidth+1,JSON.stringify(value));return value;
}
const invokeLanguage=(page,language)=>page.evaluate(language=>document.querySelector('#language').onchange({target:{value:language}}),language);
const ready=page=>page.waitForFunction(()=>window.__l10nGame?.scene.isActive('Board')&&__l10nGame.scene.getScene('Board').keyboardState().available);
async function finish(page,won){
  await page.evaluate(won=>{const scene=__l10nGame.scene.getScene('Board');if(won)scene.hooks.onMove([99,99,99,99,99,99],220,1,999);else for(let i=0;i<50;i++)scene.hooks.onMove([0,0,0,0,0,0],0,1,0);},won);
}
try{
  for(const language of ['ko','en'])for(const viewport of [{width:320,height:568},{width:360,height:640},{width:640,height:360}]){
    console.log(`${variant} ${language} ${viewport.width}`);
    const context=await browser.newContext({viewport,reducedMotion:'reduce'}),page=await context.newPage(),requests=[];
    let release;const gate=new Promise(resolve=>{release=resolve;});
    page.on('pageerror',error=>report.pageerrors.push(error.message));page.setDefaultTimeout(10000);
    await context.addInitScript(language=>{
      if(!localStorage.getItem('pawblossom.save.v1'))localStorage.setItem('pawblossom.save.v1',JSON.stringify({version:1,language,highestLevel:30,completed:[1],stars:2,coins:40,garden:0,music:false,sfx:false,tutorialSeen:true}));
      const set=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(window.__failSave&&key.startsWith('pawblossom.save.'))throw new Error('QA storage failure');return set.call(this,key,value);};
    },language);
    await page.route('http://localization.pawblossom.invalid/**',async route=>{
      const url=new URL(route.request().url()),file=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));assert.ok(file.startsWith(root+path.sep));
      if(/pip-(win|retry)-v1\.webp$/.test(file)){requests.push(url.pathname);await gate;}
      if(file.endsWith('.js')){
        let source=await fs.readFile(file,'utf8');const calls=source.match(/new [\w$.]+\.Game\(\{type:/g)??[];
        if(calls.length){assert.equal(calls.length,1);source=source.replace(calls[0],'window.__l10nGame='+calls[0]);}
        await route.fulfill({body:source,contentType:'text/javascript'});
      }else await route.fulfill({path:file});
    });
    const entry={language,viewport,labels:[],layouts:[],results:[]};
    try{
      await page.goto('http://localization.pawblossom.invalid');await ready(page);await page.waitForLoadState('networkidle');
      await page.locator('#shuffle').click();const original=await saved(page);
      const move=await page.evaluate(()=>__l10nGame.scene.getScene('Board').engine.legalMoves()[0]),canvas=await page.locator('canvas').boundingBox();
      for(const pos of [move.a,move.b])await page.mouse.click(canvas.x+(16+pos.col*56+28)/480*canvas.width,canvas.y+(16+pos.row*56+28)/480*canvas.height);
      await page.waitForFunction(()=>__l10nGame.scene.getScene('Board').keyboardState().busy);
      await page.locator('#language-toggle').click();assert.deepEqual((await saved(page)).inProgress,original.inProgress);
      await ready(page);const played=await saved(page);assert.equal(played.inProgress.moves,original.inProgress.moves-1);assert.ok(played.inProgress.score>original.inProgress.score);assert.equal(played.inProgress.shuffles,0);
      await page.locator('#language-toggle').click();entry.playedProgress={moves:played.inProgress.moves,score:played.inProgress.score,shuffles:played.inProgress.shuffles,swapVia:'실제 canvas 두 칸 click',inFlightLanguageVia:'실제 header click',settledCheckpointPreserved:true};
      const before=withoutLanguage(await saved(page));await page.evaluate(()=>window.__originalScene=__l10nGame.scene.getScene('Board'));
      entry.labels.push(await checkLabels(page,language));entry.layouts.push(await layout(page,'#puzzle-view'));
      await page.locator('#language-toggle').click();entry.labels.push(await checkLabels(page,opposite(language)));
      assert.equal(await page.evaluate(()=>document.activeElement.id),'language-toggle');assert.deepEqual(withoutLanguage(await saved(page)),before);
      assert.ok(await page.evaluate(()=>__originalScene===__l10nGame.scene.getScene('Board')));
      await page.locator('#language-toggle').click();
      for(const view of ['village','journal']){
        await page.locator(`[data-route="${view}"]`).click();await page.locator('#language-toggle').click();await checkLabels(page,opposite(language));await page.locator('#language-toggle').click();
        entry.layouts.push(await layout(page,`#${view}-view`));
        if(language==='ko'&&viewport.width===320||language==='en'&&viewport.width===640)await page.screenshot({path:`docs/screenshots/issue-68-${variant}-${language}-${viewport.width}-${view}.png`});
      }
      await page.locator('#settings-button').click();await page.locator('#language').focus();await page.locator('#language').selectOption(opposite(language));
      assert.equal(await page.evaluate(()=>document.activeElement.id),'language');await checkLabels(page,opposite(language));
      await page.evaluate(()=>window.__failSave=true);await page.locator('#language').selectOption(language);
      assert.ok((await page.locator('#save-status').textContent()).includes(expected[language].warning));assert.ok((await page.locator('#settings-button').getAttribute('aria-label')).includes(language==='ko'?'저장 상태':'save status'));
      assert.equal(await page.evaluate(()=>document.activeElement.id),'language');assert.deepEqual(withoutLanguage(await saved(page)),before);
      await page.evaluate(()=>window.__failSave=false);await page.locator('#save-retry').click();assert.equal((await saved(page)).language,language);
      entry.layouts.push(await layout(page,'#settings-view'));
      if(language==='ko'&&viewport.width===320||language==='en'&&viewport.width===640){await page.locator('.version').scrollIntoViewIfNeeded();await page.screenshot({path:`docs/screenshots/issue-68-${variant}-${language}-${viewport.width}-settings.png`});}
      await page.locator('#tutorial-help').click();
      for(let i=0;i<3;i++)await page.locator('#guide-next').click();await page.locator('#practice-cell-0-2').click();
      await invokeLanguage(page,opposite(language));assert.equal(await page.evaluate(()=>document.activeElement.id),'practice-cell-0-2');assert.equal(await page.locator('#practice-cell-0-2').getAttribute('aria-pressed'),'true');
      assert.ok((await page.locator('#practice-feedback').textContent()).includes(opposite(language)==='ko'?'하나를 골랐어요':'One tile selected'));
      await invokeLanguage(page,language);await page.locator('#practice-cell-1-2').click();assert.equal(await page.evaluate(()=>document.activeElement.id),'guide-next');
      await invokeLanguage(page,opposite(language));assert.equal(await page.evaluate(()=>document.activeElement.id),'guide-next');assert.ok((await page.locator('#tutorial-description').textContent()).includes(opposite(language)==='ko'?'잘했어요':'Lovely!'));
      await page.locator('#guide-next').click();await page.locator('#language-toggle').click();await page.locator('[data-route="puzzle"]').click();await ready(page);
      if(flags.testTools){
        await page.locator('#test-level-button').click();await page.locator('#test-chapter-3').click();await page.locator('#test-stage-30').focus();await invokeLanguage(page,opposite(language));
        assert.equal(await page.evaluate(()=>document.activeElement.id),'test-stage-30');assert.equal(await page.locator('#test-chapter-3').getAttribute('aria-selected'),'true');
        await invokeLanguage(page,language);await page.locator('#test-close').click();assert.deepEqual(withoutLanguage(await saved(page)),before);
      }else assert.equal(await page.locator('#test-level-button').count(),0);
      // 최초 완료·재완료·실패·최종 완료와 시험 결과의 버튼/문구/저장 회귀입니다.
      for(const kind of flags.testTools?['win','replay','retry','complete','test-win','test-retry']:['win','replay','retry','complete']){
        const testing=kind.startsWith('test'),won=!kind.includes('retry'),id=kind==='complete'?30:kind==='replay'?1:2;
        if(testing){await page.locator('#test-level-button').click();await page.locator('#test-chapter-1').click();await page.locator(`#test-stage-${id}`).click();}
        else{await page.locator('[data-route="village"]').click();await page.locator(`#chapter-${id===30?3:1}`).click();await page.locator(`[data-level="${id}"]`).click();}
        await ready(page);const prior=await saved(page);await finish(page,won);
        const pending=await page.evaluate(()=>!document.querySelector('#result-dialog').open);assert.ok(pending,'실제 300ms 결과 대기');
        const settled=await saved(page);await invokeLanguage(page,opposite(language));assert.deepEqual(withoutLanguage(await saved(page)),withoutLanguage(settled));
        await page.locator('#result-dialog[open]').waitFor();assert.equal(await page.locator('#result-title').textContent(),expected[opposite(language)][kind==='complete'?'complete':won?'win':'lose']);
        const resultBefore=await saved(page),artRequests=requests.length;
        await page.evaluate(()=>window.__resultNodes={next:document.querySelector('#result-next'),home:document.querySelector('#result-home'),art:document.querySelector('.result-pip'),handler:document.querySelector('#result-next').onclick});
        await invokeLanguage(page,language);
        assert.ok(await page.evaluate(()=>__resultNodes.next===document.querySelector('#result-next')&&__resultNodes.home===document.querySelector('#result-home')&&__resultNodes.art===document.querySelector('.result-pip')&&__resultNodes.handler===document.querySelector('#result-next').onclick));
        assert.equal(await page.evaluate(()=>document.activeElement.id),'result-next');assert.deepEqual(withoutLanguage(await saved(page)),withoutLanguage(resultBefore));assert.equal(requests.length,artRequests);
        if(kind==='win'){
          assert.equal(await page.locator('.result-pip').getAttribute('src'),'/assets/pip.png');release();await page.waitForFunction(()=>document.querySelector('.result-pip').getAttribute('src').endsWith('-v1.webp')&&document.querySelector('.result-pip').naturalWidth>0);
        }
        await page.locator('#result-home').focus();await invokeLanguage(page,opposite(language));assert.equal(await page.evaluate(()=>document.activeElement.id),'result-home');await invokeLanguage(page,language);
        const rewards=await page.locator('.result-rewards').count(),shouldReward=won&&!testing&&kind!=='replay';assert.equal(rewards,shouldReward?1:0);
        if(testing)assert.deepEqual(withoutLanguage(await saved(page)),withoutLanguage(prior));else{assert.equal((await saved(page)).coins,prior.coins+(shouldReward?40:0));assert.equal((await saved(page)).inProgress,undefined);}
        const resultLayout=await layout(page,'#result-dialog');assert.ok(resultLayout.y>=0&&resultLayout.y+resultLayout.height<=viewport.height+1);assert.ok(await page.evaluate(()=>__l10nGame.scene.isPaused('Board')));
        if(kind==='complete')assert.ok((await page.locator('#result-description').textContent()).includes('30'));
        if(kind==='win'&&(language==='ko'&&viewport.width===320||language==='en'&&viewport.width===640))await page.screenshot({path:`docs/screenshots/issue-68-${variant}-${language}-${viewport.width}-result.png`});
        // 실제 modal 바깥 헤더 클릭은 차단되며 Tab 초점은 창 안에 유지됩니다.
        const header=await page.locator('#language-toggle').boundingBox();await page.mouse.click(header.x+header.width/2,header.y+header.height/2);assert.equal(await page.locator('html').getAttribute('lang'),language);assert.ok(await page.locator('#result-dialog').evaluate(dialog=>dialog.open));
        await page.locator('#result-next').focus();await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),testing?'result-test':'result-home');
        if(testing){await page.locator('#result-test').click();await invokeLanguage(page,opposite(language));await page.locator('#test-close').click();assert.equal(await page.locator('#result-title').textContent(),won?expected[opposite(language)].win:opposite(language)==='ko'?'다시 시작해 볼까요?':'A fresh start awaits.');await invokeLanguage(page,language);}
        const stable=await saved(page);await page.locator('#result-next').click();await ready(page);assert.equal((await saved(page)).coins,stable.coins);assert.equal((await saved(page)).stars,stable.stars);
        entry.results.push({kind,rewards,requests:requests.slice(),layout:resultLayout,pendingLanguagePreserved:true,focusAndNodesPreserved:true,modalHeaderBlocked:true,coinsBefore:prior.coins,coinsAfter:stable.coins});
      }
      // 정상 UI 전환 뒤 재실행도 같은 안정 회차를 복원합니다.
      const resume=await saved(page);await page.reload();await ready(page);assert.deepEqual(await saved(page),resume);
      entry.progressPreserved=true;report.cases.push(entry);
    }finally{release();await context.close();}
  }
  assert.deepEqual(report.pageerrors,[]);
  report.hashes=await hashes();
  await fs.writeFile(`docs/performance/issue-68-localization-${variant}-20261016.json`,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({variant,cases:report.cases.length,results:report.cases.reduce((sum,item)=>sum+item.results.length,0),pageerrors:report.pageerrors}));
}finally{await browser.close();}
