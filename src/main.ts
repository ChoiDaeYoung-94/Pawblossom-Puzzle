import Phaser from 'phaser';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import '@fontsource/nunito/latin-400.css';
import '@fontsource/nunito/latin-600.css';
import '@fontsource/nunito/latin-700.css';
import '@fontsource/nunito/latin-800.css';
import '@fontsource/fraunces/latin-600.css';
import './style.css';
import { BoardScene,tileNames } from './BoardScene';
import { AudioManager } from './audio/AudioManager';
import { loadSave,saveData,retrySave,saveStatus,clearSave,levels,LEVEL_COUNT,chapters,chapterForLevel,levelSignature,type RoundCheckpoint } from './state';
import { t,type TextKey } from './i18n';
import { icon } from './icons';
import { SwapPractice } from './SwapPractice';
import { bindPracticeBoard } from './bindPracticeInputs';
import { gardenArt } from './GardenArt';
import { showResultPip } from './ResultPip';
import { APP_VERSION } from './appVersion';
import { TEST_TOOLS_ENABLED } from './buildFlags';
import { ANDROID_TEST_ADS_ENABLED } from './buildFlags';
import { ANDROID_TEST_BILLING_ENABLED } from './buildFlags';
import { TestAdsController,nativeTestAds,adCopy,type AdFormat } from './testAds';
import { TestBillingController,nativeTestBilling,billingCopy } from './testBilling';

let save=loadSave(), currentLevel=save.highestLevel, moves=0, score=0, collected=Array(6).fill(0) as number[], shuffles=1;
let scene:BoardScene, game:Phaser.Game, route='puzzle', toastTimer:ReturnType<typeof setTimeout>;
let resultTimer:ReturnType<typeof setTimeout>|undefined;
let round=0;
let boardPending=false;
let roundEnded=false, resultShown=false, firstReward=false;
let resultWon:boolean|undefined;
let noticeKey:TextKey|undefined, boardNoticeKey:TextKey|undefined;
let tutorialPage=0;
let practice:SwapPractice|undefined;
let practiceInputs:ReturnType<typeof bindPracticeBoard>|undefined;
let growing=false;
let clearedLeaves=0;
let testingLevel=false;
let testContinueUsed=false;
let pickerReturnToResult=false;
let selectedChapter=chapterForLevel(save.highestLevel).id;
let selectedTestChapter=chapterForLevel(currentLevel).id;
let nativeActive=!Capacitor.isNativePlatform();
let nativeRevision=0;
let audioActive:boolean|undefined;
const androidAdEntry=typeof ANDROID_TEST_ADS_ENABLED!=='undefined'&&ANDROID_TEST_ADS_ENABLED&&Capacitor.isNativePlatform()&&Capacitor.getPlatform()==='android'&&Capacitor.isPluginAvailable('PawblossomTestAds');
let testAds:TestAdsController|undefined;
let rewardedContinue:{round:number;scene:BoardScene;button:HTMLButtonElement;requestId?:string;preparing:boolean}|undefined;
const androidBillingEntry=typeof ANDROID_TEST_BILLING_ENABLED!=='undefined'&&ANDROID_TEST_BILLING_ENABLED&&Capacitor.isNativePlatform()&&Capacitor.getPlatform()==='android'&&Capacitor.isPluginAvailable('PawblossomTestBilling');
let testBilling:TestBillingController|undefined;
const audio=new AudioManager(false);audio.setMusicEnabled(save.music);audio.setSfxEnabled(save.sfx);
const text=(key:TextKey)=>t(save.language,key);
const label=(key:TextKey)=>`<span data-t="${key}">${text(key)}</span>`;
const $=<T extends HTMLElement=HTMLElement>(selector:string)=>document.querySelector<T>(selector)!;
function persist(){const stored=saveData(save);updateSaveStatus();return stored;}
let announcedSave='';
function updateSaveStatus(){
  const status=saveStatus();
  const problem=status.write==='reset-failed'||status.write==='blocked'||status.write==='failed'||status.write==='backup-failed'||status.resetPending||['corrupt','unsupported','read-error','conflict'].includes(status.load);
  const key:TextKey=status.write==='reset-failed'?'saveResetFailed':status.load==='conflict'?'saveConflict':status.resetPending?'saveResetPending':status.load==='unsupported'?'saveUnsupported':status.load==='read-error'?'saveReadError':status.load==='corrupt'?'saveCorrupt':status.write==='backup-failed'?'saveBackupFailed':status.write==='failed'?'saveFailed':status.load==='recovered'?'saveRecovered':status.write==='saved'?'saveSaved':'saveNew';
  const message=text(key), detail=document.querySelector('#save-status');
  if(detail)detail.textContent=message;
  const retry=document.querySelector<HTMLButtonElement>('#save-retry');
  if(retry){retry.textContent=text('saveRetry');retry.hidden=!problem&&document.activeElement!==retry;}
  const reload=document.querySelector<HTMLButtonElement>('#save-reload');if(reload){reload.textContent=text('saveReload');reload.hidden=status.load!=='conflict';}
  const settings=$('#settings-button');settings.classList.toggle('save-attention',problem||status.load==='recovered');settings.setAttribute('aria-label',text('settings')+(problem?' · '+text('saveAttention'):''));
  const signature=key+':'+save.language;
  if(signature!==announcedSave){announcedSave=signature;$('#storage-announcement').textContent=problem||status.load==='recovered'?message:'';}
}

$('#app').innerHTML=`
  <header class="topbar">
    <a class="brand" href="#puzzle" aria-label="Pawblossom Puzzle"><span class="brand-mark">${icon('paw',26)}</span><span>Pawblossom<small>PUZZLE</small></span></a>
    <div class="header-right"><div class="wallet stars">${icon('star',18)}<strong id="star-count">0</strong><span class="sr-only">${text('stars')}</span></div><div class="wallet coins">${icon('coin',18)}<strong id="coin-count">0</strong><span class="sr-only">${text('coins')}</span></div><button id="language-toggle" class="language-button" aria-label="${text('switchLanguage')}">${save.language==='en'?'한국어':'EN'}</button><button id="settings-button" class="icon-button" aria-label="${text('settings')}">${icon('settings',21)}</button></div>
  </header>
  <main class="workspace">
    <section class="story-panel">
      <div class="eyebrow"><span class="tiny-leaf">${icon('leaf',15)}</span><span id="story-chapter-name"></span></div>
      <h1>${label('greeting')}</h1><p class="story-copy">${label('story')}</p>
      <div class="meadow-art"><img class="environment" src="/assets/meadow.png" loading="lazy" decoding="async" alt=""/><img class="pip" src="/assets/pip.png" alt="${text('pip')}" data-alt="pip"/></div>
      <div class="friend-message"><span class="friend-avatar"><img src="/assets/pip.png" alt=""/></span><div><strong>${label('pip')}</strong><p>${label('request')}</p></div><span class="message-flower">${icon('flower',25)}</span></div>
      <div class="garden-status"><div><span>${icon('leaf',16)} ${label('garden')}</span><strong id="garden-count">0 / 5</strong></div><div class="garden-track"><i id="garden-fill"></i></div></div>
    </section>
    <section class="game-panel">
      <div id="puzzle-view" class="view">
        <div class="level-top"><div><div class="eyebrow"><span id="chapter-name"></span></div><h2><span data-t="level">${text('level')}</span> <span id="level-number">1</span><span class="level-flower">${icon('flower',21)}</span></h2></div><div class="level-actions">${TEST_TOOLS_ENABLED?`<button id="test-level-button" class="test-level-button">${label('testPick')}</button>`:''}<button id="restart" class="icon-button" aria-label="${text('restart')}">${icon('restart',20)}</button></div></div>
        <div class="mission-bar"><div class="moves-box"><strong id="moves">22</strong>${label('moves')}</div><div class="goal-box"><div class="goal-heading">${label('goal')}<span class="score-label">${label('score')} <span id="score">0</span></span></div><div id="goals"></div></div></div>
        <div class="board-wrap"><div id="game-canvas" tabindex="-1" aria-label="${text('boardLabel')}" aria-describedby="board-keyboard-help board-keyboard-status" role="application"></div><div id="board-notice" aria-live="polite"></div></div>
        <p class="board-hint">${icon('leaf',15)} <span id="board-hint-text">${text('hint')}</span><span id="board-keyboard-help">${text('boardKeyboardHelp')}</span></p>
        <div id="board-keyboard-status" class="sr-only" role="status" aria-live="polite" aria-atomic="true"></div>
        <div class="tools"><button id="shuffle" class="shuffle-button">${icon('shuffle',20)}${label('shuffle')}<span id="shuffle-count">1</span></button><span class="tool-note">${label('shuffleHelp')}</span></div>
      </div>
      <div id="village-view" class="view" hidden></div><div id="journal-view" class="view" hidden></div><div id="settings-view" class="view" hidden></div>
      <nav class="bottom-nav" aria-label="${text('navLabel')}">${(['puzzle','village','journal'] as const).map((name,i)=>`<button data-route="${name}" class="${i===0?'active':''}" ${i===0?'aria-current="page"':''}>${icon(['puzzle','home','paw'][i],21)}${label(name)}</button>`).join('')}</nav>
    </section>
  </main>
  <footer class="page-footer"><span>${label('tagline')}</span><span>${label('prototype')}</span></footer>
  <div id="storage-announcement" class="sr-only" role="status" aria-live="polite" aria-atomic="true"></div>
  <div id="toast" role="status"></div><dialog id="result-dialog" aria-labelledby="result-title" aria-describedby="result-description"></dialog><dialog id="tutorial-dialog" aria-labelledby="tutorial-title" aria-describedby="tutorial-description"></dialog>${TEST_TOOLS_ENABLED?'<dialog id="test-level-dialog" aria-labelledby="test-level-title"></dialog>':''}
`;
if(androidAdEntry){
  const dialog=document.createElement('dialog');dialog.id='test-ad-dialog';dialog.setAttribute('aria-labelledby','test-ad-title');document.body.append(dialog);
}
if(androidBillingEntry){
  const dialog=document.createElement('dialog');dialog.id='test-billing-dialog';dialog.setAttribute('aria-labelledby','test-billing-title');document.body.append(dialog);
}
function billingModal(){return Boolean(androidBillingEntry&&$<HTMLDialogElement>('#test-billing-dialog').open);}

// 문서와 Android 상태 중 하나라도 비활성이면 오디오와 진행을 멈춥니다.
function syncActivity(){
  renderRewardContinue();
  const active=nativeActive&&!document.hidden&&!testAds?.pausesGame&&!testBilling?.pausesGame&&!billingModal();
  if(!active)practiceInputs?.cancel();
  if(audioActive!==active){audioActive=active;if(active)audio.resume();else audio.suspend();}
  if(!game)return;
  const modal=$<HTMLDialogElement>('#tutorial-dialog').open||$<HTMLDialogElement>('#result-dialog').open||(TEST_TOOLS_ENABLED&&$<HTMLDialogElement>('#test-level-dialog').open)||(androidAdEntry&&$<HTMLDialogElement>('#test-ad-dialog').open);
  const playing=active&&route==='puzzle'&&!modal;
  if(playing){if(game.scene.isPaused('Board'))game.scene.resume('Board');}
  else if(game.scene.isActive('Board'))game.scene.pause('Board');
  updateBoardAccess();
}
function updateBoardAccess(){
  const board=$('#game-canvas'),state=scene?.keyboardState();
  const modal=$<HTMLDialogElement>('#tutorial-dialog').open||$<HTMLDialogElement>('#result-dialog').open||(TEST_TOOLS_ENABLED&&$<HTMLDialogElement>('#test-level-dialog').open)||(androidAdEntry&&$<HTMLDialogElement>('#test-ad-dialog').open);
  const visible=nativeActive&&!document.hidden&&!testAds?.pausesGame&&!testBilling?.pausesGame&&!billingModal()&&route==='puzzle'&&!modal&&!boardPending;
  const available=visible&&Boolean(state?.available);
  board.tabIndex=visible&&(available||state?.busy)?0:-1;
  board.setAttribute('aria-disabled',String(!available));board.setAttribute('aria-busy',String(Boolean(state?.busy)));
  let description=text(state?.finished?'boardFinished':state?.busy?'boardBusy':'boardUnavailable');
  if(available&&state?.cursor&&state.tile){
    description=text('boardCell').replace('{row}',String(state.cursor.row+1)).replace('{col}',String(state.cursor.col+1))
      .replace('{tile}',text(tileNames[state.tile.kind] as TextKey)).replace('{special}',text(state.tile.special==='row'?'boardRow':state.tile.special==='column'?'boardColumn':state.tile.special==='bomb'?'boardBomb':state.tile.special==='rainbow'?'boardRainbow':'boardOrdinary'))
      .replace('{layers}',String(state.layers));
    description+=' '+(state.selected?text('boardSelected').replace('{row}',String(state.selected.row+1)).replace('{col}',String(state.selected.col+1)):text('boardUnselected'));
  }else if(available)description=text('boardKeyboardHelp');
  if(available)description+=' '+text('movesRemaining').replace('{count}',String(moves))+' '+goalDescriptions().join(' ');
  const status=$('#board-keyboard-status');if(status.textContent!==description)status.textContent=description;
}
// 목표 표시와 보드 안내는 같은 회차 집계에서 짧은 문장을 만듭니다.
function goalDescriptions(){
  const level=levels[currentLevel-1];
  const describe=(name:TextKey,remaining:number)=>text(remaining===0?'goalComplete':'goalRemaining').replace('{name}',text(name)).replace('{count}',String(remaining));
  const descriptions=level.goals.map(goal=>describe(tileNames[goal.kind] as TextKey,Math.max(0,goal.count-collected[goal.kind])));
  const total=level.leaves?.length??0;
  if(total)descriptions.push(describe('leafPile',Math.max(0,total-clearedLeaves)));
  return descriptions;
}
function updateWallet(){
  $('.wallet.stars .sr-only').textContent=text('stars');$('.wallet.coins .sr-only').textContent=text('coins');
  $('#star-count').textContent=String(save.stars);$('#coin-count').textContent=String(save.coins);$('#garden-count').textContent=`${save.garden} / 5`;$('#garden-fill').style.width=`${save.garden*20}%`;
}
function updateGoals(){
  $('#game-canvas').setAttribute('aria-label',text('boardLabel'));
  $('#board-keyboard-help').textContent=text('boardKeyboardHelp');
  $('.bottom-nav').setAttribute('aria-label',text('navLabel'));
  const level=levels[currentLevel-1];
  const descriptions=goalDescriptions();
  const chapter=chapterForLevel(currentLevel);
  for(const id of ['#story-chapter-name','#chapter-name'])$(id).textContent=`${text(chapter.title)} · ${chapter.first}–${chapter.last}`;
  $('#level-number').textContent=String(currentLevel);$('#moves').textContent=String(moves);$('#score').textContent=score.toLocaleString(save.language==='ko'?'ko-KR':'en-US');
  $('#goals').innerHTML=level.goals.map((goal,index)=>{const remaining=Math.max(0,goal.count-collected[goal.kind]);return `<div class="goal-item ${remaining===0?'done':''}"><span class="sr-only">${descriptions[index]}</span><img src="/assets/tiles/${tileNames[goal.kind]}.svg" alt=""/><strong aria-hidden="true">${remaining===0?icon('check',18):remaining}</strong><span class="goal-progress" style="--progress:${Math.min(100,collected[goal.kind]/goal.count*100)}%"></span></div>`;}).join('');
  const total=level.leaves?.length??0,remaining=Math.max(0,total-clearedLeaves);
  $('#goals').classList.toggle('has-leaves',total>0);
  $('#goals').classList.toggle('has-many',level.goals.length+(total?1:0)>2);
  if(total)$('#goals').innerHTML+=`<div class="goal-item ${remaining===0?'done':''}"><span class="sr-only">${descriptions[level.goals.length]}</span><img src="/assets/obstacles/leaf-pile.svg" alt=""/><strong aria-hidden="true">${remaining===0?icon('check',18):remaining}</strong><span class="goal-progress" style="--progress:${Math.min(100,clearedLeaves/total*100)}%"></span></div>`;
  $('#board-hint-text').textContent=(testingLevel?text('testRound')+' · ':'')+text(total?(level.leaves!.some(p=>p.layers===2)?'leafHintDouble':'leafHint'):'hint');
  $('#shuffle-count').textContent=String(shuffles);$('#shuffle').toggleAttribute('disabled',shuffles<1);
}
function checkpoint(){
  if(testingLevel||roundEnded)return;
  save.inProgress={schema:1,levelId:currentLevel,levelSignature:levelSignature(levels[currentLevel-1]),
    board:scene.engine.board.map(row=>row.map(tile=>({...tile}))),leaves:scene.engine.leaves.map(row=>row.slice()),
    moves,score,collected:collected.slice(),shuffles,clearedLeaves};
  return persist();
}
function resumeNormal(){const saved=save.inProgress;return startLevel(saved?.levelId??save.highestLevel,false,saved);}
function replaceBoard(){
  // Phaser 3.90은 추가 큐를 제거 큐보다 먼저 처리합니다.
  // POST_RENDER는 SceneManager.render() 뒤라 같은 키를 동기적으로 교체할 수 있습니다.
  if(!boardPending||!game.scene.isBooted||game.scene.isProcessing)return;
  boardPending=false;
  if(game.scene.getScene('Board')){game.scene.stop('Board');game.scene.remove('Board');}
  game.scene.add('Board',scene,true);
}
function startLevel(id:number,testPlay=false,restored?:RoundCheckpoint){
  abandonRewardContinue();
  if(!Number.isInteger(id)||id<1||id>levels.length)return;
  clearTimeout(resultTimer);resultTimer=undefined;round++;
  roundEnded=false;resultShown=false;firstReward=false;resultWon=undefined;boardNoticeKey=undefined;testContinueUsed=false;
  const activeRound=round;
  testingLevel=TEST_TOOLS_ENABLED&&testPlay;
  pickerReturnToResult=false;
  $<HTMLDialogElement>('#result-dialog').close();
  currentLevel=id;moves=levels[id-1].moves;score=0;collected=Array(6).fill(0);shuffles=1;clearedLeaves=0;
  if(restored&&!testingLevel){moves=restored.moves;score=restored.score;collected=restored.collected.slice();shuffles=restored.shuffles;clearedLeaves=restored.clearedLeaves;}
  scene?.stopPlaying();
  scene=new BoardScene({audio,onBoardState:()=>{if(activeRound===round)updateBoardAccess();},onReady:()=>{if(activeRound===round)syncActivity();},onStart:()=>{if(activeRound===round)void audio.unlock().catch(()=>{});},onNotice:key=>{
    if(activeRound!==round)return;
    boardNoticeKey=key;$('#board-notice').textContent=text(key);$('#board-notice').classList.remove('pop');void $('#board-notice').offsetWidth;$('#board-notice').classList.add('pop');
  },onMove:(items,points,_chains,leavesCleared)=>{
    if(activeRound!==round||roundEnded)return;
    moves--;score+=points;clearedLeaves+=leavesCleared??0;items.forEach((n,i)=>collected[i]+=n);updateGoals();
    const level=levels[currentLevel-1];
    const won=level.goals.every(g=>collected[g.kind]>=g.count)&&clearedLeaves>=(level.leaves?.length??0);
    if(won||moves<=0){settleRound(won);scene.stopPlaying();resultTimer=setTimeout(()=>{if(activeRound!==round)return;resultTimer=undefined;finish(won);},300);}
    else checkpoint();
  }},restored);
  if(!restored)scene.configureLeaves(levels[id-1].leaves??[]);
  // 엔진 생성/복원 직후부터 안정 상태를 유지하며 연쇄 도중에는 갱신하지 않습니다.
  const stored=checkpoint();
  boardPending=true;
  if(!game){
    game=new Phaser.Game({type:Phaser.AUTO,width:480,height:480,parent:'game-canvas',backgroundColor:'#dae6d7',scene:[],transparent:false,
      scale:{mode:Phaser.Scale.FIT,autoCenter:Phaser.Scale.CENTER_BOTH},render:{antialias:true,roundPixels:false},audio:{noAudio:true},input:{activePointers:2}});
    game.events.on(Phaser.Core.Events.POST_RENDER,replaceBoard);
  }
  updateGoals();syncActivity();
  return stored;
}
function notice(key:TextKey){noticeKey=key;clearTimeout(toastTimer);$('#toast').textContent=text(key);$('#toast').classList.add('visible');toastTimer=setTimeout(()=>{noticeKey=undefined;$('#toast').classList.remove('visible');},3200);}
function renderTutorial(){
  practiceInputs?.dispose();practiceInputs=undefined;
  const headings:TextKey[]=['tutorialSwap','tutorialGoal','tutorialMagic','practiceTitle'];
  const descriptions:TextKey[]=['tutorialSwapDesc','tutorialGoalDesc','tutorialMagicDesc',practice?.completed?'practiceDone':'practiceDesc'];
  const tile=(name:string)=>`<img src="/assets/tiles/${name}.svg" alt=""/>`;
  const art=tutorialPage===3?practiceArt():tutorialPage===0?`<div class="guide-swap" aria-hidden="true">${tile('strawberry')}${tile('strawberry')}<span>${tile('carrot')}<b>↕</b>${tile('strawberry')}</span></div>`:tutorialPage===1?`<div class="guide-goals" aria-hidden="true"><span>${tile('strawberry')} 12</span><span>${tile('carrot')} 10</span>${icon('leaf',24)}</div>`:`<div class="guide-specials">${(['tutorialFour','tutorialFive','tutorialShape'] as TextKey[]).map((key,i)=>`<div><span class="guide-special special-${i}" aria-hidden="true">${tile(['leaf','flower','blueberry'][i])}</span><small>${text(key)}</small></div>`).join('')}</div>`;
  $('#tutorial-dialog').innerHTML=`<div class="guide-content"><div class="eyebrow">${text('tutorial')} · ${text('tutorialStep')} ${tutorialPage+1} / 4</div><h2 id="tutorial-title" tabindex="-1">${text(headings[tutorialPage])}</h2>${art}<p id="tutorial-description">${text(descriptions[tutorialPage])}</p><div class="guide-dots" aria-hidden="true">${[0,1,2,3].map(i=>`<i class="${i===tutorialPage?'active':''}"></i>`).join('')}</div><div class="guide-actions"><button id="guide-back" class="text-button" ${tutorialPage===0?'disabled':''}>${text('tutorialBack')}</button><button id="guide-next" class="primary" ${tutorialPage===3&&!practice?.completed?'disabled':''}>${text(tutorialPage===3?'tutorialStart':tutorialPage===2?'tutorialTry':'tutorialNext')}${icon('arrow',18)}</button></div><button id="guide-skip" class="text-button">${text('tutorialSkip')}</button></div>`;
  $('#guide-back').onclick=()=>{if(tutorialPage>0){tutorialPage--;renderTutorial();$('#tutorial-title').focus();}};
  $('#guide-next').onclick=()=>{if(tutorialPage<3){tutorialPage++;if(tutorialPage===3)practice=new SwapPractice();renderTutorial();$('#tutorial-title').focus();}else if(practice?.completed)closeTutorial();};
  $('#guide-skip').onclick=closeTutorial;
  if(tutorialPage===3)bindPracticeInputs();
}
function practiceArt(){
  const lesson=practice!;
  return `<div id="practice-board" class="practice-board" role="group" aria-label="${text('practiceBoard')}">${lesson.board.map((row,r)=>row.map((block,c)=>{
    const pos={row:r,col:c}, target=lesson.isTarget(pos), selected=lesson.selected?.row===r&&lesson.selected?.col===c;
    const cleared=lesson.result?.steps[0].removed.some(p=>p.row===r&&p.col===c);
    const name=text('practiceCell').replace('{tile}',text(tileNames[block.kind] as TextKey)).replace('{row}',String(r+1)).replace('{col}',String(c+1));
    return `<button id="practice-cell-${r}-${c}" data-row="${r}" data-col="${c}" class="practice-cell ${target&&!lesson.completed?'practice-target':''} ${cleared?'practice-cleared':''}" aria-label="${name}" aria-pressed="${Boolean(selected)}" ${!target||lesson.completed?'disabled':''}><img src="/assets/tiles/${tileNames[block.kind]}.svg" alt=""/>${cleared?'<span aria-hidden="true">✓</span>':''}</button>`;
  }).join('')).join('')}</div><div id="practice-feedback" class="practice-feedback" role="status">${text(lesson.completed?'practiceMatched':lesson.selected?'practiceSelected':'practicePrompt')}</div>`;
}
function bindPracticeInputs(){
  const refresh=(done:boolean,pos:{row:number,col:number})=>{
    renderTutorial();
    if(done){audio.play('match');$('#guide-next').focus();}
    else $(`#practice-cell-${pos.row}-${pos.col}`).focus();
  };
  const lesson=practice!;
  practiceInputs=bindPracticeBoard($('#practice-board'),{
    tap:pos=>refresh(lesson.select(pos),pos),
    swipe:(pos,dx,dy)=>{if(lesson.swipe(pos,dx,dy))refresh(true,pos);else $('#practice-feedback').textContent=text('practicePrompt');},
  });
}
function showTutorial(){
  if(!scene.canLeave()||resultTimer||$<HTMLDialogElement>('#result-dialog').open)return;
  tutorialPage=0;practice=undefined;renderTutorial();$<HTMLDialogElement>('#tutorial-dialog').showModal();
  syncActivity();
}
function closeTutorial(){
  practiceInputs?.dispose();practiceInputs=undefined;
  $<HTMLDialogElement>('#tutorial-dialog').close();save.tutorialSeen=true;persist();
  syncActivity();
}
function chapterTabs(selected:number,test=false){
  const prefix=test?'test-':'';
  return `<div class="chapter-tabs" role="tablist" aria-label="${text('chapterSelect')}">${chapters.map(chapter=>`<button id="${prefix}chapter-${chapter.id}" data-${prefix}chapter="${chapter.id}" role="tab" aria-selected="${chapter.id===selected}" aria-controls="${prefix}chapter-levels" tabindex="${chapter.id===selected?0:-1}"><strong>${chapter.first}–${chapter.last}</strong><small>${text(chapter.title)}</small></button>`).join('')}</div>`;
}
function bindChapterTabs(test=false){
  const prefix=test?'test-':'';
  document.querySelectorAll<HTMLButtonElement>(`[data-${prefix}chapter]`).forEach(button=>{
    const select=(id:number)=>{if(test){selectedTestChapter=id;renderTestPicker();}else{selectedChapter=id;renderViews();}$(`#${prefix}chapter-${id}`).focus();};
    button.onclick=()=>select(Number(test?button.dataset.testChapter:button.dataset.chapter));
    button.onkeydown=event=>{const index=chapters.findIndex(chapter=>chapter.id===Number(test?button.dataset.testChapter:button.dataset.chapter));const next=event.key==='ArrowRight'?(index+1)%chapters.length:event.key==='ArrowLeft'?(index+chapters.length-1)%chapters.length:event.key==='Home'?0:event.key==='End'?chapters.length-1:-1;if(next>=0){event.preventDefault();select(chapters[next].id);}};
  });
}
function renderTestPicker(){
  if(!TEST_TOOLS_ENABLED)return;
  const dialog=$<HTMLDialogElement>('#test-level-dialog');
  dialog.innerHTML=`<div class="test-picker"><h2 id="test-level-title">${text('testPickTitle')}</h2><p>${text('testPickDesc')}</p>${chapterTabs(selectedTestChapter,true)}<div class="test-level-grid" id="test-chapter-levels" role="tabpanel" aria-labelledby="test-chapter-${selectedTestChapter}">${levels.filter(level=>chapterForLevel(level.id).id===selectedTestChapter).map(level=>`<button id="test-stage-${level.id}" data-test-level="${level.id}" class="test-stage"><strong>${text('level')} ${level.id}</strong><small>${text(!level.leaves?'testBasic':level.leaves.some(p=>p.layers===2)?'testDouble':'testSingle')}</small></button>`).join('')}</div><button id="test-normal" class="primary">${text('testNormal')}</button><button id="test-close" class="text-button">${text('testClose')}</button></div>`;
  document.querySelectorAll<HTMLButtonElement>('[data-test-level]').forEach(button=>button.onclick=()=>{
    if(!scene.canLeave()||resultTimer)return;
    pickerReturnToResult=false;dialog.close();startLevel(Number(button.dataset.testLevel),true);switchView('puzzle');
  });
  bindChapterTabs(true);
  $('#test-normal').onclick=()=>{if(!scene.canLeave()||resultTimer)return;pickerReturnToResult=false;dialog.close();resumeNormal();switchView('puzzle');};
  $('#test-close').onclick=closeTestPicker;
}
function showTestPicker(fromResult=false){
  if(!TEST_TOOLS_ENABLED||!scene.canLeave()||resultTimer||$<HTMLDialogElement>('#result-dialog').open||$<HTMLDialogElement>('#tutorial-dialog').open)return;
  pickerReturnToResult=fromResult;selectedTestChapter=chapterForLevel(currentLevel).id;
  renderTestPicker();$<HTMLDialogElement>('#test-level-dialog').showModal();
  syncActivity();
}
function closeTestPicker(){
  if(!TEST_TOOLS_ENABLED)return;
  $<HTMLDialogElement>('#test-level-dialog').close();
  if(pickerReturnToResult){pickerReturnToResult=false;$<HTMLDialogElement>('#result-dialog').showModal();$('#result-next').focus();}
  else $('#test-level-button').focus();
  syncActivity();
}
function settleRound(won:boolean){
  if(roundEnded)return;
  roundEnded=true;
  firstReward=won&&!testingLevel&&!save.completed.includes(currentLevel);
  if(testingLevel)return;
  delete save.inProgress;
  if(firstReward){save.completed.push(currentLevel);save.stars++;save.coins+=40;save.highestLevel=Math.min(LEVEL_COUNT,Math.max(save.highestLevel,currentLevel+1));selectedChapter=chapterForLevel(save.highestLevel).id;}
  // 결과창 타이머 전에 회차 제거와 첫 보상을 하나의 저장으로 확정합니다.
  persist();updateWallet();renderViews();
}
function finish(won:boolean){
  if(resultShown)return;
  settleRound(won);resultShown=true;resultWon=won;
  const first=firstReward;
  audio.play(won?'win':'lose');
  const done=won&&!testingLevel&&currentLevel===LEVEL_COUNT;
  const testContinue=TEST_TOOLS_ENABLED&&testingLevel&&!won&&!testContinueUsed&&moves===0;
  const dialog=$<HTMLDialogElement>('#result-dialog');
  dialog.innerHTML=`<div class="result-content ${won?'result-win':'result-retry'}${testContinue?' result-with-continue':''}"><div class="result-stage" aria-hidden="true"><span class="result-ground"></span><span class="result-character"><img class="result-pip" src="/assets/pip.png" decoding="async" alt=""/></span><span class="result-symbol">${icon(won?'star':'leaf',25)}</span>${won?`<span class="result-sparkles">${[0,1,2].map(()=>`<i>${icon('star',14)}</i>`).join('')}</span>`:''}</div><p class="result-pip-line" id="result-pip-line">${text(won?'pipWin':'pipRetry')}</p><div class="eyebrow" id="result-level">${text('level')} ${currentLevel}${testingLevel?` · ${text('testPick')}`:''}</div><h2 id="result-title">${text(done?'complete':won?'win':'lose')}</h2><p id="result-description">${text(testingLevel?'testResultDesc':done?'completeDesc':won?(first?'winDesc':'replayDesc'):'loseDesc').replace('{count}',String(LEVEL_COUNT))}</p>${first?`<div class="result-rewards"><span>${icon('star',20)}<span class="sr-only" data-t="stars">${text('stars')}</span> +1</span><span>${icon('coin',20)}<span class="sr-only" data-t="coins">${text('coins')}</span> +40</span></div>`:''}<button class="primary" id="result-next">${text(won?(done||currentLevel===LEVEL_COUNT?'allDone':'next'):'retry')}${icon('arrow',19)}</button>${testContinue?`<button class="result-test-button" id="result-continue" aria-describedby="result-continue-note">${text('testContinue')}</button><p id="result-continue-note">${text('testContinueNote')}</p>`:''}${testingLevel?`<button class="result-test-button" id="result-test">${text('testOther')}</button>`:''}<button class="text-button" id="result-home">${text('home')}</button></div>`;
  dialog.showModal();syncActivity();
  $('#result-next').focus();
  $('#result-next').onclick=()=>{dialog.close();startLevel(won?Math.min(LEVEL_COUNT,currentLevel+1):currentLevel,testingLevel);switchView('puzzle');};
  $('#result-home').onclick=()=>{dialog.close();switchView('village');};
  if(testingLevel)$('#result-test').onclick=()=>{dialog.close();showTestPicker(true);};
  const continueButton=dialog.querySelector<HTMLButtonElement>('#result-continue');
  if(continueButton){const activeRound=round,activeScene=scene;continueButton.onclick=()=>{if(!testAds?.busy&&!rewardedContinue?.preparing)continueTestRound(activeRound,activeScene,continueButton);};}
  if(testContinue&&androidAdEntry&&continueButton){
    const controls=document.createElement('div');controls.className='result-reward-controls';
    controls.innerHTML=`<p id="result-ad-note"></p><p id="result-ad-status" role="status"></p><button class="result-test-button" id="result-ad-load"></button><button class="result-test-button" id="result-ad-show"></button><button class="text-button" id="result-ad-cancel"></button>`;
    continueButton.before(controls);
    rewardedContinue={round,scene,button:continueButton,preparing:false};
    const context=rewardedContinue;
    $('#result-ad-load').onclick=()=>{void prepareRewardContinue(context);};
    $('#result-ad-show').onclick=()=>{
      if(!context||!rewardContextValid(context)||!nativeActive||document.hidden||testBilling?.blocksAds||testAds?.busy||testAds?.snapshot.format!=='rewarded'||testAds.snapshot.state!=='ready')return;
      context.requestId=crypto.randomUUID();void testAds.command('show',context.requestId);
    };
    $('#result-ad-cancel').onclick=()=>{if(!context||!rewardContextValid(context))return;context.requestId=undefined;void testAds?.command('cancel');};
    ensureTestAds();renderRewardContinue();void testAds!.connect();
  }
  showResultPip($<HTMLImageElement>('.result-pip'),won);
}
function continueTestRound(activeRound:number,activeScene:BoardScene,button:HTMLButtonElement):boolean {
  const dialog=$<HTMLDialogElement>('#result-dialog');
  if(!TEST_TOOLS_ENABLED||!testingLevel||testContinueUsed||activeRound!==round||activeScene!==scene
    ||route!=='puzzle'||boardPending||game.scene.getScene('Board')!==activeScene||resultTimer!==undefined
    ||!roundEnded||!resultShown||resultWon!==false||moves!==0||!dialog.open
    ||dialog.querySelector('#result-continue')!==button)return false;
  if(!activeScene.resumeAfterFailure())return false;
  abandonRewardContinue();
  testContinueUsed=true;moves+=5;roundEnded=false;resultShown=false;resultWon=undefined;firstReward=false;
  boardNoticeKey=undefined;$('#board-notice').textContent='';$('#board-notice').classList.remove('pop');
  dialog.close();updateGoals();syncActivity();
  const board=$('#game-canvas');if(board.tabIndex===0)board.focus();
  return true;
}
function ensureTestAds(){
  if(!testAds)testAds=new TestAdsController(nativeTestAds(),()=>{renderAdDialog();syncActivity();});
}
function abandonRewardContinue(){
  rewardedContinue=undefined;testAds?.abandonReward();
  if(testAds?.needsCancellation&&!testAds.busy)void testAds.command('cancel');
}
function rewardContextValid(context:NonNullable<typeof rewardedContinue>){
  return context===rewardedContinue&&TEST_TOOLS_ENABLED&&androidAdEntry&&testingLevel&&!testContinueUsed
    &&context.round===round&&context.scene===scene&&game.scene.getScene('Board')===scene&&!boardPending&&resultTimer===undefined
    &&route==='puzzle'&&roundEnded&&resultShown&&resultWon===false&&moves===0
    &&$<HTMLDialogElement>('#result-dialog').open&&$<HTMLDialogElement>('#result-dialog').querySelector('#result-continue')===context.button;
}
async function prepareRewardContinue(context:typeof rewardedContinue){
  if(!context||!rewardContextValid(context)||context.preparing||!testAds||testAds.busy||testBilling?.blocksAds||!nativeActive||document.hidden)return;
  context.preparing=true;context.requestId=undefined;testAds.abandonReward();renderRewardContinue();
  try{
    if(testAds.snapshot.format!=='rewarded')await testAds.selectFormat('rewarded');
    if(rewardContextValid(context)&&!testBilling?.blocksAds&&nativeActive&&!document.hidden&&testAds.snapshot.format==='rewarded')await testAds.command('prepare');
  }finally{context.preparing=false;renderRewardContinue();}
}
function renderRewardContinue(){
  const context=rewardedContinue;
  if(!context||!testAds)return;
  if(!rewardContextValid(context)){abandonRewardContinue();return;}
  if(testBilling?.blocksAds){context.requestId=undefined;testAds.abandonReward();}
  if(context.requestId&&nativeActive&&!document.hidden&&!testBilling?.blocksAds&&testAds.takeReward(context.requestId)){
    const {round:activeRound,scene:activeScene,button}=context;
    context.requestId=undefined;continueTestRound(activeRound,activeScene,button);return;
  }
  const copy=adCopy(save.language),value=testAds.snapshot,busy=testAds.busy||context.preparing;
  $('#result-ad-note').textContent=text('testAdContinueNote');
  $('#result-ad-status').textContent=testBilling?.blocksAds?text('testAdContinueBlocked'):!value.available?copy.unavailable:value.state==='closed'?text('testAdContinueNoReward'):copy.states[value.state];
  $('#result-ad-load').textContent=text('testAdContinueLoad');$('#result-ad-show').textContent=text('testAdContinueShow');$('#result-ad-cancel').textContent=copy.cancel;
  $('#result-ad-load').toggleAttribute('disabled',!value.available||busy||value.state==='ready'||Boolean(testBilling?.blocksAds)||!nativeActive||document.hidden);
  $('#result-ad-show').toggleAttribute('disabled',!value.available||busy||value.state!=='ready'||value.format!=='rewarded'||Boolean(testBilling?.blocksAds)||!nativeActive||document.hidden);
  $('#result-ad-cancel').toggleAttribute('disabled',testAds.pending||testAds.overlay||context.preparing);
  for(const id of ['result-next','result-home','result-test','result-continue'])$('#'+id)?.toggleAttribute('disabled',busy);
}
// 문구만 갱신하여 결과 보상·타이머·아트 요청·버튼·초점을 유지합니다.
function updateResultCopy(){
  if(resultWon===undefined)return;
  const won=resultWon,done=won&&!testingLevel&&currentLevel===LEVEL_COUNT;
  $('#result-pip-line').textContent=text(won?'pipWin':'pipRetry');
  $('#result-level').textContent=`${text('level')} ${currentLevel}${testingLevel?' · '+text('testPick'):''}`;
  $('#result-title').textContent=text(done?'complete':won?'win':'lose');
  $('#result-description').textContent=text(testingLevel?'testResultDesc':done?'completeDesc':won?(firstReward?'winDesc':'replayDesc'):'loseDesc').replace('{count}',String(LEVEL_COUNT));
  $('#result-next').innerHTML=text(won?(done||currentLevel===LEVEL_COUNT?'allDone':'next'):'retry')+icon('arrow',19);
  $('#result-home').textContent=text('home');
  if(testingLevel)$('#result-test').textContent=text('testOther');
  const continueButton=$<HTMLDialogElement>('#result-dialog').querySelector<HTMLButtonElement>('#result-continue');
  if(continueButton){continueButton.textContent=text('testContinue');$('#result-continue-note').textContent=text('testContinueNote');}
  renderRewardContinue();
}
function renderAdDialog(){
  if(!testAds)return;
  const copy=adCopy(save.language),dialog=$<HTMLDialogElement>('#test-ad-dialog');
  if(!dialog.querySelector('#test-ad-title')){
    dialog.innerHTML='<div class="test-ad-content"><h2 id="test-ad-title" tabindex="-1"></h2><p id="test-ad-intro"></p><p id="test-ad-notice"></p><label id="test-ad-format-label" for="test-ad-format"></label><select id="test-ad-format"><option value="interstitial"></option><option value="rewarded"></option></select><p id="test-ad-events" role="status" aria-live="polite"></p><p id="test-ad-status" role="status" aria-live="polite"></p><p id="test-ad-error"></p><div class="test-ad-actions"><button id="test-ad-load" class="primary"></button><button id="test-ad-show" class="primary"></button><button id="test-ad-cancel" class="text-button"></button><button id="test-ad-privacy" class="text-button"></button><button id="test-ad-close" class="text-button"></button></div></div>';
    $<HTMLSelectElement>('#test-ad-format').onchange=event=>{void testAds!.selectFormat((event.target as HTMLSelectElement).value as AdFormat);};
    $('#test-ad-load').onclick=()=>{if(!testBilling?.blocksAds)void testAds!.command('prepare');};
    $('#test-ad-show').onclick=()=>{if(nativeActive&&!document.hidden&&!testBilling?.blocksAds)void testAds!.command('show');};
    $('#test-ad-cancel').onclick=()=>{void testAds!.command('cancel');};
    $('#test-ad-privacy').onclick=()=>{void testAds!.command('privacyOptions');};
    $('#test-ad-close').onclick=()=>{void closeAdDialog();};
  }
  const state=testAds.snapshot;
  $('#test-ad-title').textContent=copy.title;$('#test-ad-intro').textContent=copy.intro;$('#test-ad-notice').textContent=copy.notice;
  $('#test-ad-format-label').textContent=copy.format;
  for(const format of ['interstitial','rewarded'] as const)$('#test-ad-format option[value="'+format+'"]').textContent=copy[format];
  $<HTMLSelectElement>('#test-ad-format').value=state.format;
  $('#test-ad-format').toggleAttribute('disabled',!testAds.canSelectFormat);
  $('#test-ad-events').textContent=`${copy.events}: ${state.rewardEvents} · ${copy.eventNotice}`;
  $('#test-ad-status').textContent=state.available?copy.states[state.state]:copy.unavailable;
  $('#test-ad-error').textContent=testBilling?.blocksAds?(save.language==='ko'?'광고 제거 권한 확인 또는 적용 중 · 광고 보류':'Ad removal is active or being checked · Ads held'):state.error?(state.error.startsWith('consent')?copy.blocked:copy.recovery):'';
  $('#test-ad-load').textContent=copy.prepare;$('#test-ad-show').textContent=copy.show;$('#test-ad-cancel').textContent=copy.cancel;$('#test-ad-close').textContent=copy.close;$('#test-ad-privacy').textContent=copy.privacy;
  $('#test-ad-load').toggleAttribute('disabled',!state.available||testAds.busy||state.state==='ready'||Boolean(testBilling?.blocksAds));
  $('#test-ad-show').toggleAttribute('disabled',!state.available||testAds.busy||state.state!=='ready'||!nativeActive||document.hidden||Boolean(testBilling?.blocksAds));
  $('#test-ad-cancel').hidden=!['consent','loading','ready'].includes(state.state);
  $('#test-ad-cancel').toggleAttribute('disabled',testAds.pending||testAds.overlay);
  $('#test-ad-privacy').hidden=!state.privacyRequired;
  $('#test-ad-privacy').toggleAttribute('disabled',testAds.busy);
  $('#test-ad-close').toggleAttribute('disabled',testAds.busy);
}
async function showAdDialog(){
  if(!androidAdEntry||testBilling?.pausesGame||!scene.canLeave()||document.querySelector('dialog[open]'))return;
  ensureTestAds();
  renderAdDialog();$<HTMLDialogElement>('#test-ad-dialog').showModal();syncActivity();$('#test-ad-title').focus();
  await testAds!.connect();
}
async function closeAdDialog(){
  if(!testAds||testAds.busy)return;
  if(testAds.needsCancellation)await testAds.command('cancel');
  if(testAds.busy||testAds.needsCancellation)return;
  $<HTMLDialogElement>('#test-ad-dialog').close();syncActivity();$('#test-ad-button').focus();
}
function renderBillingDialog(){
  if(!testBilling)return;
  const copy=billingCopy(save.language),dialog=$<HTMLDialogElement>('#test-billing-dialog');
  if(!dialog.querySelector('#test-billing-title')){
    dialog.innerHTML='<div class="test-ad-content"><h2 id="test-billing-title" tabindex="-1"></h2><p id="test-billing-intro"></p><p id="test-billing-notice"></p><p id="test-billing-status" role="status" aria-live="polite"></p><p id="test-billing-error" role="status"></p><div class="test-ad-actions"><button id="test-billing-product" class="primary"></button><button id="test-billing-buy" class="primary"></button><button id="test-billing-restore" class="text-button"></button><button id="test-billing-close" class="text-button"></button></div></div>';
    $('#test-billing-product').onclick=()=>{void testBilling!.command('queryProduct');};
    $('#test-billing-buy').onclick=()=>{if(nativeActive&&!document.hidden&&!testAds?.busy)void testBilling!.command('purchase');};
    $('#test-billing-restore').onclick=()=>{void testBilling!.command('restore');};
    $('#test-billing-close').onclick=closeBillingDialog;
  }
  const value=testBilling.snapshot;
  $('#test-billing-title').textContent=copy.title;$('#test-billing-intro').textContent=copy.intro;$('#test-billing-notice').textContent=copy.notice;
  $('#test-billing-status').textContent=!value.configured?copy.unconfigured:copy.entitlement[value.entitlement]+(testBilling.busy?' · '+copy.busy:'');
  $('#test-billing-error').textContent=!value.configured?'':value.error?(value.error.startsWith('ack')?copy.ack:value.error==='verification'?copy.verification:value.error==='price-changed'?copy.priceChanged:value.error==='cancelled'?copy.cancelled:copy.error):value.state==='cancelled'?copy.cancelled:'';
  $('#test-billing-product').textContent=copy.queryProduct;
  $('#test-billing-buy').textContent=copy.purchase+(value.price?' · '+value.price:'');
  $('#test-billing-restore').textContent=copy.restore;$('#test-billing-close').textContent=copy.close;
  for(const id of ['product','restore'])$('#test-billing-'+id).toggleAttribute('disabled',!value.available||!value.configured||testBilling.busy||Boolean(testAds?.busy)||!nativeActive||document.hidden);
  $('#test-billing-buy').toggleAttribute('disabled',!testBilling.canPurchase||Boolean(testAds?.busy)||!nativeActive||document.hidden);
  // 전체 구매 조회 중에도 화면을 닫을 수 있습니다. 실제 Play 창 종료는 네이티브가 확인합니다.
  $('#test-billing-close').toggleAttribute('disabled',testBilling.pausesGame);
}
async function showBillingDialog(){
  if(!androidBillingEntry||!scene.canLeave()||testAds?.busy||document.querySelector('dialog[open]'))return;
  renderBillingDialog();$<HTMLDialogElement>('#test-billing-dialog').showModal();syncActivity();$('#test-billing-title').focus();
  await testBilling?.connect();
}
function closeBillingDialog(){
  if(testBilling?.pausesGame)return;
  $<HTMLDialogElement>('#test-billing-dialog').close();syncActivity();$('#test-billing-button').focus();
}
function renderViews(grew=false){
  const focused=document.activeElement as HTMLElement|null,focusedId=focused?.id;
  const scroll=Array.from(document.querySelectorAll<HTMLElement>('.view'),view=>({view,top:view.scrollTop,left:view.scrollLeft}));
  $('#village-view').innerHTML=`<div class="subview-heading"><div class="eyebrow">${text('chapterMeadow')}</div><h2>${text('mapTitle')}</h2><p>${text('mapDesc')}</p></div><div class="garden-card"><div class="garden-picture"><div class="garden-illustration" role="img" aria-label="${text('gardenImage').replace('{count}',String(save.garden))}">${gardenArt(save.garden,grew)}</div><span class="garden-pill">${icon('flower',17)} ${save.garden} / 5</span></div><h3>${text('garden')}</h3><p class="garden-stage" id="garden-stage" role="status" tabindex="-1">${text(`gardenStage${save.garden}` as TextKey)}</p><p>${text('gardenDesc')}</p><button class="primary" id="grow" ${growing||save.stars<2||save.garden>=5?'disabled':''}>${icon('leaf',20)}${text(save.garden>=5?'gardenDone':'grow')}</button>${save.stars<2&&save.garden<5?`<small>${text('needStars')}</small>`:''}</div><div class="level-picker"><h3>${text('levelSelect')}</h3>${chapterTabs(selectedChapter)}<div class="level-grid" id="chapter-levels" role="tabpanel" aria-labelledby="chapter-${selectedChapter}">${levels.filter(l=>chapterForLevel(l.id).id===selectedChapter).map(l=>`<button data-level="${l.id}" ${l.id>save.highestLevel?'disabled':''} class="level-node ${save.completed.includes(l.id)?'completed':''}" aria-label="${text('level')} ${l.id}${l.id>save.highestLevel?' · '+text('levelLocked'):save.completed.includes(l.id)?' · '+text('levelCompleted'):''}">${l.id>save.highestLevel?icon('lock',19):l.id}${save.completed.includes(l.id)?`<span>${icon('star',13)}</span>`:''}</button>`).join('')}</div></div>`;
  $('#journal-view').innerHTML=`<div class="subview-heading"><div class="eyebrow">${text('friendsHeading')}</div><h2>${text('friendsTitle')}</h2><p>${text('friendsDesc')}</p></div><div class="journal-card"><span class="friend-number">01</span><img src="/assets/pip.png" alt="${text('pip')}" data-alt="pip"/><h3>${text('pip')}</h3><p>${text('pipDesc')}</p><span class="friend-tag">${icon('leaf',15)} ${text('chapterMeadow')}</span></div>`;
  $('#settings-view').innerHTML=`<div class="subview-heading"><div class="eyebrow">PAWBLOSSOM PUZZLE</div><h2>${text('settingsTitle')}</h2><p>${text('settingsDesc')}</p></div><div class="settings-card"><div class="setting-row"><span>${icon('volume',22)}${text('music')}</span><button class="toggle ${save.music?'on':''}" id="music-toggle" role="switch" aria-checked="${save.music}" aria-label="${text('music')}"><i></i></button></div><div class="setting-row"><span>${icon('paw',22)}${text('sfx')}</span><button class="toggle ${save.sfx?'on':''}" id="sfx-toggle" role="switch" aria-checked="${save.sfx}" aria-label="${text('sfx')}"><i></i></button></div><div class="setting-row"><label for="language">${text('language')}</label><select id="language"><option value="en" ${save.language==='en'?'selected':''}>English</option><option value="ko" ${save.language==='ko'?'selected':''}>한국어</option></select></div><p class="sound-note">${text('soundHint')}</p></div><div class="save-note">${icon('leaf',20)}<p>${text('offline')}</p></div><div class="storage-card"><p id="save-status"></p><button id="save-retry" class="text-button" hidden></button><button id="save-reload" class="text-button" hidden></button></div><button id="reset" class="text-button reset-button">${text('reset')}</button><p class="version">Pawblossom Puzzle · v${APP_VERSION}</p>`;
  updateSaveStatus();
  $('#save-retry').onclick=()=>{retrySave(save);updateSaveStatus();};
  $('#save-reload').onclick=()=>{if(confirm(text('saveReloadConfirm')))window.location.reload();};
  bindChapterTabs();
  $('#grow').onclick=()=>{if(growing||save.stars<2||save.garden>=5)return;growing=true;save.stars-=2;save.garden++;const stored=persist();updateWallet();renderViews(true);audio.play('reward');if(stored)notice('planted');setTimeout(()=>{growing=false;$('#grow').toggleAttribute('disabled',save.stars<2||save.garden>=5);},450);};
  document.querySelectorAll<HTMLButtonElement>('[data-level]').forEach(button=>button.onclick=()=>{if(!scene.canLeave())return;const id=Number(button.dataset.level);if(id>save.highestLevel)return;startLevel(id);switchView('puzzle');});
  $('#music-toggle').onclick=()=>{save.music=!save.music;audio.setMusicEnabled(save.music);persist();$('#music-toggle').classList.toggle('on',save.music);$('#music-toggle').setAttribute('aria-checked',String(save.music));};
  const help=document.createElement('button');help.id='tutorial-help';help.className='primary guide-help';help.textContent=text('tutorial');help.onclick=showTutorial;$('#settings-view').append(help);
  if(androidAdEntry){const entry=document.createElement('button');entry.id='test-ad-button';entry.className='text-button';entry.textContent=adCopy(save.language).title;entry.onclick=()=>{void showAdDialog();};$('#settings-view').append(entry);}
  if(androidBillingEntry){const entry=document.createElement('button');entry.id='test-billing-button';entry.className='text-button';entry.textContent=billingCopy(save.language).title;entry.onclick=()=>{void showBillingDialog();};$('#settings-view').append(entry);}
  $('#sfx-toggle').onclick=()=>{save.sfx=!save.sfx;audio.setSfxEnabled(save.sfx);persist();$('#sfx-toggle').classList.toggle('on',save.sfx);$('#sfx-toggle').setAttribute('aria-checked',String(save.sfx));};
  $<HTMLSelectElement>('#language').onchange=event=>changeLanguage((event.target as HTMLSelectElement).value==='ko'?'ko':'en');
  $('#reset').onclick=()=>{if(!confirm(text('resetConfirm')))return;const cleared=clearSave();updateSaveStatus();if(!cleared)return;save=cleared;selectedChapter=1;audio.setMusicEnabled(save.music);audio.setSfxEnabled(save.sfx);localize();updateWallet();renderViews();startLevel(1);switchView('puzzle');showTutorial();};
  // DOM 교체 뒤에도 읽던 위치를 유지합니다. 심기 버튼이 비활성이면 갱신된 상태로 초점을 잇습니다.
  if(focusedId&&!focused?.isConnected){
    const replacement=document.querySelector<HTMLElement>('#'+focusedId);
    const target=focusedId==='grow'&&(replacement as HTMLButtonElement|null)?.disabled?$('#garden-stage'):replacement;
    target?.focus({preventScroll:true});
  }
  for(const {view,top,left} of scroll){view.scrollTop=top;view.scrollLeft=left;}
}
function localize(){
  document.documentElement.lang=save.language;
  document.querySelectorAll<HTMLElement>('[data-t]').forEach(el=>el.textContent=text(el.dataset.t as TextKey));
  document.querySelectorAll<HTMLElement>('[data-alt]').forEach(el=>el.setAttribute('alt',text(el.dataset.alt as TextKey)));
  $('#language-toggle').textContent=save.language==='en'?'한국어':'EN';$('#language-toggle').setAttribute('aria-label',text('switchLanguage'));
  $('#settings-button').setAttribute('aria-label',text('settings'));$('#restart').setAttribute('aria-label',text('restart'));
  if(noticeKey)$('#toast').textContent=text(noticeKey);
  if(boardNoticeKey)$('#board-notice').textContent=text(boardNoticeKey);
}
function changeLanguage(language:'en'|'ko'){
  const focused=document.activeElement as HTMLElement|null,focusedId=focused?.id;
  save.language=language;persist();localize();updateWallet();renderViews();updateGoals();updateBoardAccess();updateResultCopy();
  if($<HTMLDialogElement>('#tutorial-dialog').open)renderTutorial();
  if(TEST_TOOLS_ENABLED&&$<HTMLDialogElement>('#test-level-dialog').open)renderTestPicker();
  if(androidAdEntry&&testAds)renderAdDialog();if(androidBillingEntry&&testBilling)renderBillingDialog();
  if(focusedId&&!focused?.isConnected)document.querySelector<HTMLElement>('#'+focusedId)?.focus();
}
function switchView(name:string){
  if(name!=='puzzle')abandonRewardContinue();
  if(!scene.canLeave())return;
  route=name;document.querySelectorAll<HTMLElement>('.view').forEach(view=>view.hidden=view.id!==`${name}-view`);
  document.querySelectorAll<HTMLButtonElement>('[data-route]').forEach(b=>{b.classList.toggle('active',b.dataset.route===name);if(b.dataset.route===name)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
  updateSaveStatus();
  // Phaser refresh는 직전 parentSize로 계산하므로 숨김→표시 직후 부모 크기를 먼저 갱신합니다.
  if(name==='puzzle'&&game.isBooted){game.scale.getParentBounds();game.scale.refresh();}syncActivity();
}
document.querySelectorAll<HTMLButtonElement>('[data-route]').forEach(button=>button.onclick=()=>switchView(button.dataset.route!));
$('#settings-button').onclick=()=>switchView(route==='settings'?'puzzle':'settings');
$('.brand').onclick=e=>{e.preventDefault();switchView('puzzle');};
$('#language-toggle').onclick=()=>changeLanguage(save.language==='en'?'ko':'en');
$('#board-notice').addEventListener('animationend',()=>{boardNoticeKey=undefined;});
$('#restart').onclick=()=>{if(scene.canLeave())startLevel(currentLevel,testingLevel);};
if(TEST_TOOLS_ENABLED){$('#test-level-button').onclick=()=>showTestPicker();$<HTMLDialogElement>('#test-level-dialog').addEventListener('cancel',event=>{event.preventDefault();closeTestPicker();});}
$('#shuffle').onclick=()=>{if(!boardPending&&game.scene.isActive('Board')&&shuffles>0&&scene.shuffle()){shuffles--;updateGoals();checkpoint();}};
$<HTMLDialogElement>('#result-dialog').addEventListener('cancel',event=>{event.preventDefault();if(testAds?.busy||rewardedContinue?.preparing)return;$<HTMLDialogElement>('#result-dialog').close();switchView('village');});
$<HTMLDialogElement>('#tutorial-dialog').addEventListener('cancel',event=>{event.preventDefault();closeTutorial();});
document.addEventListener('pointerdown',()=>{void audio.unlock().catch(()=>{});},{passive:true,capture:true});
// 한 Game 동안 DOM에 한 번만 등록합니다. 회차 교체는 현재 scene을 조회합니다.
const boardFocus=$('#game-canvas');
boardFocus.addEventListener('focus',()=>{if(boardFocus.matches(':focus-visible')){boardFocus.dataset.keyboard='true';scene?.focusKeyboard();}updateBoardAccess();});
boardFocus.addEventListener('blur',()=>{boardFocus.dataset.keyboard='false';scene?.cancelInput();});
boardFocus.addEventListener('pointerdown',()=>{boardFocus.dataset.keyboard='false';scene?.hideKeyboardCursor();},{capture:true});
boardFocus.addEventListener('keydown',event=>{
  if(event.target!==boardFocus||document.activeElement!==boardFocus||event.altKey||event.ctrlKey||event.metaKey||event.isComposing)return;
  if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Enter',' ','Escape'].includes(event.key))return;
  if(boardPending||route!=='puzzle'||!nativeActive||document.hidden||testAds?.pausesGame||testBilling?.pausesGame||document.querySelector('dialog[open]'))return;
  // 대기 중에도 방향키/Space의 페이지 스크롤은 막고 엔진 입력은 거부합니다.
  event.preventDefault();
  if(!scene.keyboardState().available)return;
  boardFocus.dataset.keyboard='true';void audio.unlock().catch(()=>{});scene.focusKeyboard();scene.keyboardKey(event.key,event.repeat);
});
window.addEventListener('blur',()=>{boardFocus.dataset.keyboard='false';scene?.cancelInput();practiceInputs?.cancel();});
window.addEventListener('resize',()=>practiceInputs?.cancel());
document.addEventListener('visibilitychange',()=>{syncActivity();if(testAds){renderAdDialog();if(!document.hidden)void testAds.refresh();}if(testBilling){renderBillingDialog();if(!document.hidden)void testBilling.refresh();}});
window.addEventListener('pagehide',()=>{void testAds?.dispose();void testBilling?.dispose();});
if(Capacitor.isNativePlatform()){
  void App.addListener('appStateChange',({isActive})=>{nativeRevision++;nativeActive=isActive;syncActivity();if(testAds){renderAdDialog();if(isActive)void testAds.refresh();}if(testBilling){renderBillingDialog();if(isActive)void testBilling.refresh();}}).then(async()=>{
    const revision=nativeRevision;
    const state=await App.getState();
    // 늦게 반환된 초기 상태가 이후의 복귀 이벤트를 덮어쓰지 않도록 합니다.
    if(revision===nativeRevision){nativeActive=state.isActive;syncActivity();}
  }).catch(()=>{ /* 네이티브 상태를 확인할 수 없으면 비활성 상태를 유지합니다. */ });
  void App.addListener('backButton',()=>{const dialog=$<HTMLDialogElement>('#result-dialog');if(billingModal())closeBillingDialog();else if(testBilling?.pausesGame)return;else if(androidAdEntry&&$<HTMLDialogElement>('#test-ad-dialog').open){void closeAdDialog();}else if(testAds?.pausesGame)return;else if($<HTMLDialogElement>('#tutorial-dialog').open)closeTutorial();else if(TEST_TOOLS_ENABLED&&$<HTMLDialogElement>('#test-level-dialog').open)closeTestPicker();else if(dialog.open){dialog.close();switchView('village');}else if(route!=='puzzle')switchView('puzzle');else void App.minimizeApp();});
}
if(androidAdEntry)$<HTMLDialogElement>('#test-ad-dialog').addEventListener('cancel',event=>{event.preventDefault();void closeAdDialog();});
if(androidBillingEntry)$<HTMLDialogElement>('#test-billing-dialog').addEventListener('cancel',event=>{event.preventDefault();closeBillingDialog();});
if(typeof ResizeObserver!=='undefined'){
  new ResizeObserver(()=>{if(game?.isBooted&&route==='puzzle'){game.scale.getParentBounds();game.scale.refresh();}}).observe($('#game-canvas'));
}
const resumed=Boolean(save.inProgress);
const resumedStored=resumeNormal();updateWallet();renderViews();localize();
if(androidBillingEntry){
  testBilling=new TestBillingController(nativeTestBilling(),()=>{renderBillingDialog();if(testAds)renderAdDialog();syncActivity();});
  void testBilling.connect();
}
if(resumed&&resumedStored&&saveStatus().load!=='recovered')notice('roundResumed');
if(!save.tutorialSeen)showTutorial();
