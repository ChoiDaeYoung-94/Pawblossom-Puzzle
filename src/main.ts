import Phaser from 'phaser';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import '@fontsource/nunito/latin-400.css';
import '@fontsource/nunito/latin-600.css';
import '@fontsource/nunito/latin-700.css';
import '@fontsource/nunito/latin-800.css';
import '@fontsource/fraunces/latin-600.css';
import './style.css';
import './CampaignMap.css';
import './CampaignMilestone.css';
import {campaignClearCount,campaignProgress,campaignMilestone} from './CampaignProgress';
import {campaignMilestoneCard,milestoneCopy} from './CampaignMilestone';
import {campaignAlbumCard,albumSelection,parseAlbumIndex} from './CampaignAlbum';
import './CampaignAlbum.css';
import './PuzzlePresentation.css';
import './PipIdle.css';
import './PipTending.css';
import {pipTendingArt} from './PipTending';
import {createPipTendingPose} from './PipTendingPose';
import './SpecialTileArt.css';
import './GardenStructureArt.css';
import './JourneyGarden.css';
import {journeyProjectSpecs,journeyProjectFor,nextJourneyProject,previewJourneyAction,prepareJourneyAction,type JourneyProject,type JourneyAction} from './journeyGarden';
import {journeyGardenPanel,journeyGardenPreview,journeyNextCard,journeyName,journeyPhase} from './JourneyGardenUI';
import {createJourneyGardenArt} from './JourneyGardenArt';
import './UiTheme.css';
import './MapComposition.css';
import './MapJourney.css';
import {CAMPAIGN_NODE_STEP,CAMPAIGN_NODE_X,campaignNodePath} from './CampaignRoute';
import {createMapTravel} from './MapTravel';
import { BoardScene,tileNames } from './BoardScene';
import {BOARD_RENDER_SIZE} from './BoardDisplay';
import {specialTileArt} from './SpecialTileArt';
import { AudioManager } from './audio/AudioManager';
import { loadSave,saveData,retrySave,saveStatus,clearSave,levels,LEVEL_COUNT,chapters,chapterForLevel,levelSignature,type RoundCheckpoint,type SaveData } from './state';
import { freshPip,pipLevel,careCost,preparePipAction,type PipAction } from './pipCare';
import { t,type TextKey } from './i18n';
import { icon } from './icons';
import { SwapPractice } from './SwapPractice';
import { SpecialTapPractice } from './SpecialTapPractice';
import { bindPracticeBoard } from './bindPracticeInputs';
import { gardenArt,flowerArt } from './GardenArt';
import {previewGardenPreset,type GardenPresetId} from './GardenPresets';
import {gardenPresetPreview} from './GardenPresetsUI';
import {gardenGoals,goalNextStep,nextGardenGoal,type GardenGoal,type GoalNeed} from './GardenGoals';
import {gardenSpaceArt} from './GardenSpaceArt';
import {paintedGardenForeground} from './GardenStructureArt';
import {gardenSpaceSpecs,gardenSpacesFor,prepareSpaceAction,previewSpaceAction,type GardenArea,type SpaceAction} from './gardenSpaces';
import {gardenAreas,gardenAreaName,gardenAreaTabs,gardenSpacePanel,gardenSpacePreview,nextSpaceGoal,spacePhaseName,spaceStyleName} from './GardenSpacesUI';
import { flowerStyles,gardenProjects,gardenThemes,gardenDesignFor,freshGardenDesign,flowerDiversity,projectReady,themeReady,prepareGardenAction,type GardenTheme,type GardenProject,type GardenAction } from './gardenDesign';
import { showResultPip } from './ResultPip';
import { RoundFeedback } from './RoundFeedback';
import { createPipIdle } from './PipIdle';
import {campaignScenery,createCampaignScenery,campaignWorld,campaignWorldName,campaignIsland,campaignWorldPaint,campaignMusicTheme} from './CampaignScenery';
import { createPipAccessoryArt } from './PipAccessoryArt';
import { createGardenNature } from './GardenNature';
import { cloneSnapshot,prepareShuffle } from './puzzleHelp';
import type { BoardSnapshot } from './core';
import { APP_VERSION } from './appVersion';
import { TEST_TOOLS_ENABLED } from './buildFlags';
import { ANDROID_TEST_ADS_ENABLED } from './buildFlags';
import { ANDROID_TEST_BILLING_ENABLED } from './buildFlags';
import { TestAdsController,nativeTestAds,adCopy,type AdFormat } from './testAds';
import { TestBillingController,nativeTestBilling,billingCopy } from './testBilling';

let save=loadSave(), currentLevel=save.highestLevel, moves=0, score=0, collected=Array(6).fill(0) as number[], shuffles=1;
let scene:BoardScene, game:Phaser.Game, route='map', toastTimer:ReturnType<typeof setTimeout>;
let settingsReturnRoute='map';
let mapPositioned:number|undefined;
let mapScrollOffset=0;
let detachMapScroll:(()=>void)|undefined;
let resultTimer:ReturnType<typeof setTimeout>|undefined;
let resumeNoticeTimer:ReturnType<typeof setTimeout>|undefined;
let round=0;
let boardPending=false;
let roundEnded=false, resultShown=false, firstReward=false;
let resultWon:boolean|undefined;
let resultWorld:ReturnType<typeof campaignMilestone>;
let resultWorldScenery:ReturnType<typeof createCampaignScenery>|undefined;
let noticeKey:TextKey|undefined, boardNoticeKey:TextKey|undefined;
let tutorialPage=0;
let tutorialIntent:'onboarding'|'help'='onboarding';
let tutorialReturn:{opener:HTMLButtonElement;id:string;scroll:{view:HTMLElement;top:number;left:number}[]}|undefined;
let practice:SwapPractice|undefined;
let specialPractice:SpecialTapPractice|undefined;
let squarePractice:SwapPractice|undefined;
let practiceInputs:ReturnType<typeof bindPracticeBoard>|undefined;
let growing=false;
let growthTimer:ReturnType<typeof setTimeout>|undefined;
let careProcessing=false,careGeneration=0;
let selectedGardenPlot=0;
let selectedGardenArea:GardenArea='flowers';
let selectedJourneyProject:JourneyProject='conservatory';
let selectedAlbumWorld:number|undefined;
let albumArt:ReturnType<typeof createCampaignScenery>|undefined,albumArtHost:HTMLElement|undefined;
let journeyMoment=false;
let journeyArt:ReturnType<typeof createJourneyGardenArt>|undefined,journeyArtHost:HTMLElement|undefined;
let journeyPreviewArt:ReturnType<typeof createJourneyGardenArt>|undefined;
let careDemo:{normalSave:SaveData;returnRoute:'village'|'journal';chapter:number;plot:number;area:GardenArea;project:JourneyProject;preset:100|500}|undefined;
let pipReaction:'feed'|'play'|'greet'|'tend'|undefined;
let careReactionStarted=0;
let gardenActivity:{kind:'flower'|'lily'|'ripples'|'rest'|'arch';plot:number}|undefined;
let careReactionTimer:ReturnType<typeof setTimeout>|undefined;
let clearedLeaves=0;
let clearedCrates=0;
let testingLevel=false;
let continueUsed=false,paidShuffleUsed=false,puzzleProcessing=false;
let pickerReturnToResult=false;
let selectedChapter=chapterForLevel(save.highestLevel).id;
let selectedTestChapter=chapterForLevel(currentLevel).id;
let nativeActive=!Capacitor.isNativePlatform();
let nativeRevision=0;
type StagePreview={id:number;intent:'map'|'restart';round:number;scene:BoardScene;testing:boolean;route:string;opener:HTMLElement;scroll:{view:HTMLElement;top:number;left:number}[]};
let stagePreview:StagePreview|undefined;
let audioActive:boolean|undefined;
let nativeAudioAttempted=false;
const androidAdEntry=typeof ANDROID_TEST_ADS_ENABLED!=='undefined'&&ANDROID_TEST_ADS_ENABLED&&Capacitor.isNativePlatform()&&Capacitor.getPlatform()==='android'&&Capacitor.isPluginAvailable('PawblossomTestAds');
let testAds:TestAdsController|undefined;
let rewardedContinue:{round:number;scene:BoardScene;button:HTMLButtonElement;requestId?:string;preparing:boolean}|undefined;
const androidBillingEntry=typeof ANDROID_TEST_BILLING_ENABLED!=='undefined'&&ANDROID_TEST_BILLING_ENABLED&&Capacitor.isNativePlatform()&&Capacitor.getPlatform()==='android'&&Capacitor.isPluginAvailable('PawblossomTestBilling');
let testBilling:TestBillingController|undefined;
const audio=new AudioManager(false);audio.setMusicEnabled(save.music);audio.setSfxEnabled(save.sfx);
const text=(key:TextKey)=>t(save.language,key);
const label=(key:TextKey)=>`<span data-t="${key}">${text(key)}</span>`;
const $=<T extends HTMLElement=HTMLElement>(selector:string)=>document.querySelector<T>(selector)!;
function persist(){if(careDemo)return true;const stored=saveData(save);updateSaveStatus();return stored;}
let announcedSave='';
function updateSaveStatus(restoreControl?:string){
  const status=saveStatus();
  const problem=status.write==='reset-failed'||status.write==='blocked'||status.write==='failed'||status.write==='backup-failed'||status.resetPending||['corrupt','unsupported','read-error','conflict'].includes(status.load);
  const key:TextKey=status.write==='reset-failed'?'saveResetFailed':status.load==='conflict'?'saveConflict':status.resetPending?'saveResetPending':status.load==='unsupported'?'saveUnsupported':status.load==='read-error'?'saveReadError':status.load==='corrupt'?'saveCorrupt':status.write==='backup-failed'?'saveBackupFailed':status.write==='failed'?'saveFailed':status.load==='recovered'?'saveRecovered':status.write==='saved'?'saveSaved':'saveNew';
  const message=text(key), detail=document.querySelector('#save-status');
  if(detail)detail.textContent=message;
  const focusedControl=restoreControl??document.activeElement?.id;
  const retry=document.querySelector<HTMLButtonElement>('#save-retry');
  if(retry){retry.textContent=text('saveRetry');retry.hidden=!problem&&focusedControl!=='save-retry';}
  const reload=document.querySelector<HTMLButtonElement>('#save-reload');if(reload){reload.textContent=text('saveReload');reload.hidden=status.load!=='conflict'&&focusedControl!=='save-reload';}
  const card=document.querySelector<HTMLElement>('#storage-card');
  if(card)card.hidden=!problem&&(key==='saveNew'||key==='saveSaved')&&retry?.hidden!==false&&reload?.hidden!==false;
  const settings=$('#settings-button');settings.classList.toggle('save-attention',problem||status.load==='recovered');settings.setAttribute('aria-label',text('settings')+(problem?' · '+text('saveAttention'):''));
  const signature=key+':'+save.language;
  if(signature!==announcedSave){announcedSave=signature;$('#storage-announcement').textContent=problem||status.load==='recovered'?message:'';}
}

$('#app').innerHTML=`
  <header class="topbar">
    <a class="brand" href="#map" aria-label="Pawblossom Puzzle"><span class="brand-mark">${icon('paw',26)}</span><span>Pawblossom<small>PUZZLE</small></span></a>
    <div class="header-right"><button id="stars-help" type="button" class="wallet wallet-help stars" aria-haspopup="dialog">${icon('star',18)}<strong id="star-count" aria-hidden="true">0</strong><span class="sr-only">${text('stars')}</span></button><button id="coins-help" type="button" class="wallet wallet-help coins" aria-haspopup="dialog">${icon('coin',18)}<strong id="coin-count" aria-hidden="true">0</strong><span class="sr-only">${text('coins')}</span></button><select id="language-toggle" class="language-button" aria-label="${text('language')}"><option value="ko" ${save.language==='ko'?'selected':''}>한국어</option><option value="en" ${save.language==='en'?'selected':''}>English</option></select><button id="settings-button" class="icon-button" aria-label="${text('settings')}">${icon('settings',21)}</button></div>
  </header>
  <main class="workspace">
    <section class="game-panel">
      <div id="map-view" class="view"></div>
      <div id="puzzle-view" class="view" hidden>
        <div class="level-top"><div class="level-heading"><span id="header-pip" class="header-pip" aria-hidden="true"><span id="header-pip-face" class="pip-face"><img class="header-pip-image" src="/assets/pip-idle-open-v2.webp" alt=""/></span></span><div class="level-copy"><div class="eyebrow"><span id="chapter-name"></span></div><h2><span data-t="level">${text('level')}</span> <span id="level-number">1</span></h2></div></div><div class="level-actions">${TEST_TOOLS_ENABLED?`<button id="test-level-button" class="test-level-button">${label('testPick')}</button>`:''}<button id="restart" class="icon-button" aria-label="${text('restart')}">${icon('restart',20)}</button></div></div>
        <div class="mission-bar"><div class="moves-box"><strong id="moves">22</strong>${label('moves')}</div><div class="goal-box"><div class="goal-heading">${label('goal')}<span class="score-label">${label('score')} <span id="score">0</span></span></div><div id="goals"></div></div></div>
        <div class="board-wrap"><div id="game-canvas" tabindex="-1" aria-label="${text('boardLabel')}" aria-describedby="board-keyboard-help board-keyboard-status" role="application"></div><div id="board-notice" aria-live="polite"></div></div>
        <p class="board-hint">${icon('leaf',15)} <span id="board-hint-text">${text('hint')}</span><span id="board-keyboard-help">${text('boardKeyboardHelp')}</span><span id="round-resumed-notice" role="status" aria-live="polite" aria-atomic="true" hidden></span></p>
        <div id="board-keyboard-status" class="sr-only" role="status" aria-live="polite" aria-atomic="true"></div>
        <div class="tools"><button id="shuffle" class="shuffle-button">${icon('shuffle',20)}${label('shuffle')}<span id="shuffle-count">1</span></button><span class="tool-note">${label('shuffleHelp')}</span></div>
      </div>
      <div id="village-view" class="view" hidden></div><div id="journal-view" class="view" hidden></div><div id="settings-view" class="view" hidden></div>
      <nav class="bottom-nav" aria-label="${text('navLabel')}">${(['map','village','journal'] as const).map((name,i)=>`<button data-route="${name}" class="${i===0?'active':''}" ${i===0?'aria-current="page"':''}>${icon(['map','home','paw'][i],21)}${label(name)}</button>`).join('')}</nav>
    </section>
  </main>
  <footer class="page-footer"><span>${label('tagline')}</span><span>${label('prototype')}</span></footer>
  <div id="storage-announcement" class="sr-only" role="status" aria-live="polite" aria-atomic="true"></div>
  <div id="round-feedback-layer" aria-hidden="true"></div><div id="toast" role="status"></div><dialog id="result-dialog" aria-labelledby="result-title" aria-describedby="result-description"></dialog><dialog id="tutorial-dialog" aria-labelledby="tutorial-title" aria-describedby="tutorial-description"></dialog>${TEST_TOOLS_ENABLED?'<dialog id="test-level-dialog" aria-labelledby="test-level-title"></dialog>':''}
`;
$('#app').dataset.route=route;
if(androidAdEntry){
  const dialog=document.createElement('dialog');dialog.id='test-ad-dialog';dialog.setAttribute('aria-labelledby','test-ad-title');document.body.append(dialog);
}
if(androidBillingEntry){
  const dialog=document.createElement('dialog');dialog.id='test-billing-dialog';dialog.setAttribute('aria-labelledby','test-billing-title');document.body.append(dialog);
}
function billingModal(){return Boolean(androidBillingEntry&&$<HTMLDialogElement>('#test-billing-dialog').open);}
const previewDialog=document.createElement('dialog');previewDialog.id='stage-preview-dialog';previewDialog.setAttribute('aria-labelledby','stage-preview-title');previewDialog.setAttribute('aria-describedby','stage-preview-description');document.body.append(previewDialog);
const resourceDialog=document.createElement('dialog');resourceDialog.id='resource-help-dialog';resourceDialog.setAttribute('aria-labelledby','resource-help-title');resourceDialog.setAttribute('aria-describedby','resource-help-description');document.body.append(resourceDialog);
const lookDialog=document.createElement('dialog');lookDialog.id='garden-look-dialog';lookDialog.setAttribute('aria-labelledby','garden-look-title');lookDialog.setAttribute('aria-describedby','garden-look-description');document.body.append(lookDialog);
const spaceDialog=document.createElement('dialog');spaceDialog.id='garden-space-dialog';spaceDialog.setAttribute('aria-labelledby','garden-space-preview-title');spaceDialog.setAttribute('aria-describedby','garden-space-preview-description');document.body.append(spaceDialog);
type SpacePreview={action:SpaceAction|JourneyAction;project:JourneyProject;save:SaveData;generation:number;route:string;demo:typeof careDemo;round:number;scene:BoardScene;opener:HTMLButtonElement;area:GardenArea;showCurrent:boolean;scroll:number};
let spacePreview:SpacePreview|undefined;
function spacePreviewEnvironment(){return route==='village'&&nativeActive&&!document.hidden&&!boardPending&&!resultTimer&&!puzzleProcessing&&!careProcessing&&!growing&&!stagePreview&&!previewDialog.open&&!otherModal(false)&&!testAds?.busy&&!testBilling?.busy&&!testAds?.pausesGame&&!testBilling?.pausesGame&&Boolean(scene?.canLeave())&&game.scene.getScene('Board')===scene;}
function validSpacePreview(context:SpacePreview){return spacePreview===context&&spaceDialog.open&&context.save===save&&context.generation===careGeneration&&context.route===route&&context.demo===careDemo&&context.round===round&&context.scene===scene&&context.area===selectedGardenArea&&context.project===selectedJourneyProject&&currentControl(context.opener,context.save,context.generation)&&spacePreviewEnvironment();}
function closeSpacePreview(restore=true){
  const context=spacePreview;spacePreview=undefined;journeyPreviewArt?.dispose();journeyPreviewArt=undefined;spaceDialog.close();syncActivity();
  if(!restore||!context||!nativeActive||document.hidden||context.route!==route||context.save!==save||context.demo!==careDemo||otherModal()||previewDialog.open)return;
  if(currentControl(context.opener,context.save,context.generation))context.opener.focus({preventScroll:true});
  $('#village-view').scrollTop=context.scroll;
}
function renderSpacePreview(){
  const context=spacePreview;if(!context)return;
  journeyPreviewArt?.dispose();journeyPreviewArt=undefined;
  spaceDialog.innerHTML='project' in context.action?journeyGardenPreview(save.language,save.gardenDesign?.journeyProjects,context.action,gardenCompletedCount(),save.stars,save.coins,context.showCurrent,careStorageBlocked(),Boolean(careDemo)):gardenSpacePreview(save.language,save.gardenDesign?.spaces,context.action,gardenCompletedCount(),save.stars,save.coins,save.gardenDesign?.theme??'meadow',context.showCurrent,careStorageBlocked(),Boolean(careDemo));
  const picture=document.querySelector<HTMLElement>('#journey-preview-picture');if(picture)journeyPreviewArt=createJourneyGardenArt(picture);
  journeyPreviewArt?.setActive(spaceDialog.open&&nativeActive&&!document.hidden);
  for(const current of [true,false]){
    const button=$<HTMLButtonElement>(current?'#space-preview-current':'#space-preview-after');
    button.onclick=()=>{if(!validSpacePreview(context)||$('#'+button.id)!==button)return;context.showCurrent=current;renderSpacePreview();$('#'+button.id).focus({preventScroll:true});};
  }
  const confirm=$<HTMLButtonElement>('#space-preview-confirm');
  confirm.onclick=()=>{
    if(!validSpacePreview(context)||confirm.disabled||$('#space-preview-confirm')!==confirm)return;
    // 자기 모달만 닫은 뒤 기존 거래 가드와 현재 자원을 다시 검증합니다.
    closeSpacePreview(false);
    if(commitCare(confirm,context.save,context.generation,next=>{
      if('project' in context.action){
        const result=prepareJourneyAction(next.stars,next.coins,next.gardenDesign?.journeyProjects,context.action,gardenCompletedCount(next));if(!result)return false;
        next.stars=result.stars;next.coins=result.coins;next.gardenDesign=gardenDesignFor(next.gardenDesign);next.gardenDesign.journeyProjects=result.projects;return true;
      }
      const result=prepareSpaceAction(next.stars,next.coins,next.gardenDesign?.spaces,context.action,gardenCompletedCount(next));if(!result)return false;
      next.stars=result.stars;next.coins=result.coins;next.gardenDesign=gardenDesignFor(next.gardenDesign);next.gardenDesign.spaces=result.spaces;return true;
    })){selectedGardenArea='project' in context.action?'journey':context.action.space;reactPip('greet');audio.play('reward');renderViews();$('#garden-space-title').focus({preventScroll:true});}
    else context.opener.focus({preventScroll:true});
  };
  $('#space-preview-cancel').onclick=()=>{if(spacePreview===context)closeSpacePreview();};
}
function showSpacePreview(action:SpaceAction|JourneyAction,opener:HTMLButtonElement){
  if(spacePreview||spaceDialog.open||!spacePreviewEnvironment()||!currentControl(opener,save,careGeneration)||('project' in action?selectedGardenArea!=='journey'||selectedJourneyProject!==action.project||!previewJourneyAction(save.gardenDesign?.journeyProjects,action,gardenCompletedCount()):selectedGardenArea!==action.space||!previewSpaceAction(save.gardenDesign?.spaces,action,gardenCompletedCount())))return;
  if(pipReaction||gardenActivity){const id=opener.id;clearCareReaction();renderViews();opener=$<HTMLButtonElement>('#'+id);}
  clearCareReaction();spacePreview={action:{...action},project:selectedJourneyProject,save,generation:careGeneration,route,demo:careDemo,round,scene,opener,area:selectedGardenArea,showCurrent:false,scroll:$('#village-view').scrollTop};
  renderSpacePreview();scene.cancelInput();spaceDialog.showModal();journeyPreviewArt?.setActive(nativeActive&&!document.hidden);syncActivity();$('#garden-space-preview-title').focus({preventScroll:true});
}
spaceDialog.addEventListener('cancel',event=>{event.preventDefault();closeSpacePreview();});
spaceDialog.addEventListener('close',()=>{if(!spaceDialog.open&&spacePreview)closeSpacePreview(false);});
spaceDialog.addEventListener('keydown',event=>{if(event.repeat&&(event.key==='Enter'||event.key===' '))event.preventDefault();});
type LookPreview={save:SaveData;generation:number;route:string;demo:typeof careDemo;round:number;scene:BoardScene;opener:HTMLButtonElement;id:GardenPresetId;showCurrent:boolean;language:SaveData['language'];scroll:number};
let lookPreview:LookPreview|undefined;
function lookPreviewEnvironment(){return route==='village'&&selectedGardenArea==='flowers'&&nativeActive&&!document.hidden&&!boardPending&&!resultTimer&&!puzzleProcessing&&!careProcessing&&!growing&&!stagePreview&&!previewDialog.open&&!otherModal(true,false)&&!testAds?.busy&&!testBilling?.busy&&!testAds?.pausesGame&&!testBilling?.pausesGame&&Boolean(scene?.canLeave())&&game.scene.getScene('Board')===scene;}
function validLookPreview(context:LookPreview){return lookPreview===context&&lookDialog.open&&context.save===save&&context.language===save.language&&context.generation===careGeneration&&context.route===route&&context.demo===careDemo&&context.round===round&&context.scene===scene&&currentControl(context.opener,context.save,context.generation)&&lookPreviewEnvironment();}
function closeLookPreview(restore=true){
  const context=lookPreview;lookPreview=undefined;lookDialog.close();syncActivity();
  if(!restore||!context||!nativeActive||document.hidden||context.route!==route||context.save!==save||context.demo!==careDemo||otherModal()||previewDialog.open)return;
  if(currentControl(context.opener,context.save,context.generation))context.opener.focus({preventScroll:true});
  $('#village-view').scrollTop=context.scroll;
}
function renderLookPreview(){
  const context=lookPreview;if(!context)return;
  lookDialog.innerHTML=gardenPresetPreview(save.language,save.gardenDesign,save.garden,save.pip??freshPip(),gardenCompletedCount(),context.id,context.showCurrent,careStorageBlocked(),Boolean(careDemo));
  for(const id of ['sunny','butterfly','starlight'] as const){
    const button=$<HTMLButtonElement>('#garden-look-'+id);
    button.onclick=()=>{if(!validLookPreview(context)||$('#'+button.id)!==button)return;context.id=id;context.showCurrent=false;renderLookPreview();$('#'+button.id).focus({preventScroll:true});};
  }
  for(const current of [true,false]){
    const button=$<HTMLButtonElement>(current?'#garden-look-current':'#garden-look-after');
    button.onclick=()=>{if(!validLookPreview(context)||button.disabled||$('#'+button.id)!==button)return;context.showCurrent=current;renderLookPreview();$('#'+button.id).focus({preventScroll:true});};
  }
  const confirm=$<HTMLButtonElement>('#garden-look-confirm');
  confirm.onclick=()=>{
    if(!validLookPreview(context)||confirm.disabled||$('#'+confirm.id)!==confirm)return;
    closeLookPreview(false);
    if(commitCare(confirm,context.save,context.generation,next=>{
      const plan=previewGardenPreset(context.id,next.gardenDesign,next.garden,next.pip??freshPip(),gardenCompletedCount(next));
      if(!plan?.design||!plan.changed)return false;
      next.gardenDesign=plan.design;return true;
    })){renderViews();notice('lookApplied');$('#garden-edit-title').focus({preventScroll:true});}
    else if(currentControl(context.opener,context.save,context.generation))context.opener.focus({preventScroll:true});
  };
  $('#garden-look-cancel').onclick=()=>{if(lookPreview===context)closeLookPreview();};
}
function showLookPreview(opener:HTMLButtonElement){
  if(lookPreview||lookDialog.open||!lookPreviewEnvironment()||!currentControl(opener,save,careGeneration))return;
  if(pipReaction||gardenActivity){clearCareReaction();renderViews();opener=$<HTMLButtonElement>('#garden-look-open');}
  lookPreview={save,generation:careGeneration,route,demo:careDemo,round,scene,opener,id:'sunny',showCurrent:false,language:save.language,scroll:$('#village-view').scrollTop};
  renderLookPreview();scene.cancelInput();lookDialog.showModal();syncActivity();$('#garden-look-title').focus({preventScroll:true});
}
lookDialog.addEventListener('cancel',event=>{event.preventDefault();closeLookPreview();});
lookDialog.addEventListener('close',()=>{if(!lookDialog.open&&lookPreview)closeLookPreview(false);});
lookDialog.addEventListener('keydown',event=>{if(event.repeat&&(event.key==='Enter'||event.key===' '))event.preventDefault();});

type ResourceKind='stars'|'coins';
let resourceHelp:{kind:ResourceKind;opener:HTMLElement;save:SaveData;round:number;scene:BoardScene;route:string;demo:typeof careDemo;scroll:{view:HTMLElement;top:number;left:number}[]}|undefined;
function renderResourceHelp(){
  const context=resourceHelp;if(!context)return;
  const stars=context.kind==='stars',name=text(context.kind),label=text(careDemo?'resourceDemoBalance':'resourceNormalBalance');
  resourceDialog.innerHTML=`<div class="resource-help-content"><h2 id="resource-help-title" tabindex="-1">${icon(stars?'star':'coin',25)}${text(stars?'starsHelpTitle':'coinsHelpTitle')}</h2><p class="resource-help-balance">${label} · ${name} <strong>${save[context.kind]}</strong></p><div id="resource-help-description"><p>${text(stars?'starsHelpEarn':'coinsHelpEarn')}</p><p>${text(stars?'starsHelpUse':'coinsHelpUse')}</p>${careDemo?`<p class="resource-help-note">${text('resourceDemoNote')}</p>`:testingLevel?`<p class="resource-help-note">${text('resourceTestNote')}</p>`:''}</div><button id="resource-help-close" type="button" class="primary">${text('resourceHelpClose')}</button></div>`;
  $('#resource-help-close').onclick=()=>{if(resourceHelp===context)closeResourceHelp();};
}
function closeResourceHelp(restore=true){
  const context=resourceHelp;resourceHelp=undefined;resourceDialog.close();syncActivity();
  if(!restore||!context||!nativeActive||document.hidden||testAds?.pausesGame||testBilling?.pausesGame||otherModal()||previewDialog.open||context.save!==save||context.round!==round||context.scene!==scene||context.route!==route||context.demo!==careDemo)return;
  if(context.opener.isConnected&&$('#'+context.opener.id)===context.opener)context.opener.focus({preventScroll:true});
  for(const {view,top,left} of context.scroll){view.scrollTop=top;view.scrollLeft=left;}
}
function showResourceHelp(kind:ResourceKind,opener:HTMLElement){
  if(resourceHelp||resourceDialog.open||!['stars','coins'].includes(kind)||!opener.isConnected||opener.hidden||(opener as HTMLButtonElement).disabled||$('#'+kind+'-help')!==opener
    ||!nativeActive||document.hidden||boardPending||resultTimer||puzzleProcessing||careProcessing||growing||rewardedContinue?.preparing
    ||testAds?.busy||testAds?.pausesGame||testBilling?.busy||testBilling?.pausesGame||stagePreview||previewDialog.open||otherModal()
    ||!scene?.canLeave()||game.scene.getScene('Board')!==scene||roundEnded&&route==='puzzle')return;
  resourceHelp={kind,opener,save,round,scene,route,demo:careDemo,scroll:Array.from(document.querySelectorAll<HTMLElement>('.view')).map(view=>({view,top:view.scrollTop,left:view.scrollLeft}))};
  renderResourceHelp();scene.cancelInput();resourceDialog.showModal();syncActivity();$('#resource-help-title').focus({preventScroll:true});
}
resourceDialog.addEventListener('cancel',event=>{event.preventDefault();closeResourceHelp();});
resourceDialog.addEventListener('keydown',event=>{if(event.repeat&&(event.key==='Enter'||event.key===' '))event.preventDefault();});
const pipIdle=createPipIdle($('#header-pip'));
let mapPipIdle:ReturnType<typeof createPipIdle>|undefined;
let mapScenery:ReturnType<typeof createCampaignScenery>|undefined;
let mapTravel:ReturnType<typeof createMapTravel>|undefined;
let mapAdvance:{from:number;to:number;owner:SaveData}|undefined;
let carePipDisplay:{host:HTMLElement;generation:number;idle:ReturnType<typeof createPipIdle>;accessory?:ReturnType<typeof createPipAccessoryArt>;nature?:ReturnType<typeof createGardenNature>;naturePicture?:HTMLElement;pose?:ReturnType<typeof createPipTendingPose>}|undefined;
const boardFeedback=new RoundFeedback({layer:$('#round-feedback-layer'),pip:$('#header-pip-face'),
  canvas:()=>document.querySelector('#game-canvas canvas'),goal:key=>document.querySelector(`[data-feedback-goal="${key}"] img`),
  active:()=>nativeActive&&!document.hidden&&!careDemo&&route==='puzzle'&&!boardPending&&!roundEnded&&!previewDialog.open&&!otherModal()&&!testAds?.pausesGame&&!testBilling?.pausesGame,
});
function otherModal(includeSpace=true,includeLook=true){return includeLook&&lookDialog.open||includeSpace&&spaceDialog.open||resourceDialog.open||$<HTMLDialogElement>('#tutorial-dialog').open||$<HTMLDialogElement>('#result-dialog').open||(TEST_TOOLS_ENABLED&&$<HTMLDialogElement>('#test-level-dialog').open)||(androidAdEntry&&$<HTMLDialogElement>('#test-ad-dialog').open)||billingModal();}
function disposeCarePipDisplay(){albumArt?.dispose();albumArt=undefined;albumArtHost=undefined;journeyArt?.dispose();journeyArt=undefined;journeyArtHost=undefined;carePipDisplay?.pose?.dispose();carePipDisplay?.nature?.dispose();carePipDisplay?.idle.dispose();carePipDisplay?.accessory?.dispose();carePipDisplay=undefined;}
function syncAlbumActivity(){
  const picture=document.querySelector<HTMLElement>('#album-picture');
  if(albumArtHost!==picture){albumArt?.dispose();albumArt=undefined;albumArtHost=picture??undefined;}
  const active=route==='journal'&&careEnvironment()&&!careProcessing;
  if(active&&picture&&albumSelection(albumCompleted(),selectedAlbumWorld).collected&&!albumArt)albumArt=createCampaignScenery(picture,()=>{});
  albumArt?.setActive(active);
}
function syncCarePipActivity(){
  const work=document.querySelector<HTMLElement>('#journey-work-picture');
  if(journeyArtHost!==work){journeyArt?.dispose();journeyArt=undefined;journeyArtHost=work??undefined;}
  if(work&&route==='village'&&selectedGardenArea==='journey'&&!journeyArt)journeyArt=createJourneyGardenArt(work);
  journeyArt?.setActive(route==='village'&&selectedGardenArea==='journey'&&careEnvironment()&&!careProcessing);
  journeyPreviewArt?.setActive(spaceDialog.open&&Boolean(spacePreview)&&nativeActive&&!document.hidden);
  const view=route==='village'||route==='journal'?route:undefined;
  const tending=document.querySelector<HTMLElement>('#journal-pip-portrait');
  if(tending)tending.dataset.tendActive=String(view==='journal'&&careEnvironment()&&!careProcessing&&pipReaction==='tend'&&Date.now()-careReactionStarted>=0&&Date.now()-careReactionStarted<2400);
  const momentPicture=document.querySelector<HTMLElement>('#garden-nature');
  if(momentPicture)momentPicture.dataset.momentActive=String(view==='village'&&careEnvironment()&&!careProcessing);
  const host=view?document.querySelector<HTMLElement>(`#${view}-pip-actor`):null;
  const picture=view==='village'?document.querySelector<HTMLElement>('#garden-nature'):null;
  if(carePipDisplay?.nature&&(view!=='village'||!picture?.isConnected||carePipDisplay.naturePicture!==picture)){
    carePipDisplay.nature.dispose();carePipDisplay.nature=undefined;carePipDisplay.naturePicture=undefined;
  }
  if(carePipDisplay&&(!carePipDisplay.host.isConnected||carePipDisplay.generation!==careGeneration||(view!==undefined&&carePipDisplay.host!==host)))disposeCarePipDisplay();
  const visible=Boolean(host)&&careEnvironment()&&!careProcessing;
  if(visible&&host&&!carePipDisplay){
    const slot=document.querySelector<HTMLElement>(`#${view}-pip-accessory`),kind=slot?.dataset.pipAccessory;
    const accessory=slot&&(kind==='ribbon'||kind==='wateringCan')?createPipAccessoryArt(slot,kind):undefined;
    carePipDisplay={host,generation:careGeneration,idle:createPipIdle(host,undefined,view==='village'?'bottom':'center'),accessory};
  }
  if(visible&&view==='village'&&picture?.isConnected&&carePipDisplay&&!carePipDisplay.nature){
    carePipDisplay.nature=createGardenNature(picture);carePipDisplay.naturePicture=picture;
  }
  if(visible&&view==='journal'&&pipReaction==='tend'&&tending?.isConnected&&carePipDisplay&&!carePipDisplay.pose){
    const stage=document.querySelector<HTMLElement>('#journal-pip-tend-stage'),started=careReactionStarted,generation=careGeneration;
    if(stage?.isConnected)carePipDisplay.pose=createPipTendingPose(tending,stage,()=>pipReaction==='tend'&&careReactionStarted===started&&careGeneration===generation&&route==='journal'&&Date.now()-started>=0&&Date.now()-started<2400);
  }
  const idle=visible&&careIdlePose();
  if(idle&&view){
    const face=document.querySelector<HTMLImageElement>(`#${view}-pip-image`);
    const image=view==='village'&&gardenActivity?.kind==='rest'?'/assets/pip-idle-blink-v2.webp':'/assets/pip-idle-open-v2.webp';
    if(face&&face.getAttribute('src')!==image){face.setAttribute('src',image);face.alt=text('pip');}
  }
  carePipDisplay?.idle.setActive(idle);carePipDisplay?.accessory?.setActive(idle);
  carePipDisplay?.nature?.setActive(idle&&view==='village');
}
function clearMapTravel(){const previous=mapTravel;mapTravel=undefined;previous?.dispose();}
function syncPipActivity(){
  if(!nativeActive||document.hidden||testAds?.pausesGame||testBilling?.pausesGame)mapAdvance=undefined;
  const active=nativeActive&&!document.hidden&&!careDemo&&!boardPending&&!testAds?.pausesGame&&!testBilling?.pausesGame&&!previewDialog.open&&!otherModal();
  pipIdle.setActive(active&&route==='puzzle'&&!roundEnded);
  const mapActive=active&&route==='map';
  mapTravel?.setActive(mapActive);mapPipIdle?.setActive(mapActive&&!mapTravel?.playing);$('#map-view').dataset.motionActive=String(mapActive);
  const keepMapPaint=route==='map'&&!$('#map-view').hidden&&nativeActive&&!document.hidden&&!careDemo&&!boardPending&&!testAds?.pausesGame&&!testBilling?.pausesGame&&(previewDialog.open||otherModal());
  mapScenery?.setActive(mapActive,keepMapPaint);
  const resultDialog=$<HTMLDialogElement>('#result-dialog');
  const worldActive=nativeActive&&!document.hidden&&!careDemo&&!boardPending&&!testAds?.pausesGame&&!testBilling?.pausesGame&&resultDialog.open&&Boolean(resultWorld)&&roundEnded&&resultShown&&!previewDialog.open&&!resourceDialog.open&&!spaceDialog.open&&!lookDialog.open;
  if(worldActive&&!resultWorldScenery){const picture=resultDialog.querySelector<HTMLElement>('#result-world-picture');if(picture)resultWorldScenery=createCampaignScenery(picture,()=>{});}
  resultDialog.dataset.worldActive=String(worldActive);resultWorldScenery?.setActive(worldActive);
  syncCarePipActivity();
  syncAlbumActivity();
}
function previewEnvironment(){return !careDemo&&nativeActive&&!document.hidden&&!testAds?.pausesGame&&!testBilling?.pausesGame&&!otherModal()&&!boardPending&&Boolean(scene?.canLeave())&&!resultTimer;}
function validPreview(context:StagePreview){return stagePreview===context&&context.round===round&&context.scene===scene&&context.testing===testingLevel&&context.route===route&&previewDialog.open&&previewEnvironment()&&Number.isInteger(context.id)&&context.id>=1&&context.id<=LEVEL_COUNT&&(context.intent==='restart'||context.id<=save.highestLevel);}
function hasRoundProgress(){return !testingLevel&&!roundEnded&&(moves<levels[currentLevel-1].moves||shuffles<1||continueUsed||paidShuffleUsed);}
function canContinuePreview(context:StagePreview){return context.intent==='map'&&!testingLevel&&!roundEnded&&context.id===currentLevel;}
function closeStagePreview(restore=true){
  const context=stagePreview;stagePreview=undefined;previewDialog.close();syncActivity();
  if(!restore||!context)return;
  const opener=context.opener.isConnected?context.opener:document.querySelector<HTMLElement>(context.intent==='restart'?'#restart':`[data-level="${context.id}"]`);
  opener?.focus({preventScroll:true});
  for(const {view,top,left} of context.scroll){view.scrollTop=top;view.scrollLeft=left;}
}
function confirmStagePreview(context:StagePreview,action:'continue'|'start'){
  if(!validPreview(context))return;
  if(action==='continue'&&!canContinuePreview(context))return;
  const testPlay=context.intent==='restart'&&context.testing;
  closeStagePreview(false);
  if(action==='start')startLevel(context.id,testPlay,undefined,{focusBoard:true});
  switchView('puzzle');
  if(action==='continue')$('#game-canvas').focus({preventScroll:true});
}
function renderStagePreview(){
  const context=stagePreview;if(!context)return;
  const level=levels[context.id-1],continuing=canContinuePreview(context),progressed=continuing&&hasRoundProgress();
  const goal=(name:TextKey,count:number,src:string)=>`<span class="preview-goal"><img src="${src}" alt=""/><span>${text(name)} <strong>${count}</strong></span></span>`;
  const goals=(remaining:boolean)=>level.goals.map(g=>goal(tileNames[g.kind] as TextKey,Math.max(0,g.count-(remaining?collected[g.kind]:0)),`/assets/tiles-v3/${tileNames[g.kind]}.webp`)).join('')+((level.leaves?.length??0)?goal('leafPile',Math.max(0,level.leaves!.length-(remaining?clearedLeaves:0)),'/assets/obstacles-v4/leaf-pile.webp'):'')+((level.crates?.length??0)?goal('woodenCrate',Math.max(0,level.crates!.length-(remaining?clearedCrates:0)),'/assets/obstacles-v4/wooden-crate.webp'):'');
  previewDialog.innerHTML=`<div class="stage-preview"><div class="eyebrow">${text(chapterForLevel(context.id).title)}${context.testing&&context.intent==='restart'?' · '+text('testRound'):''}</div><h2 id="stage-preview-title" tabindex="-1">${text('level')} ${context.id}</h2><p id="stage-preview-description">${text(context.intent==='restart'?'previewRestart':progressed?'previewResume':'previewStart')}</p><section aria-labelledby="preview-initial"><h3 id="preview-initial">${text('previewInitial')} · ${text('movesRemaining').replace('{count}',String(level.moves))}</h3><div class="preview-goals">${goals(false)}</div>${level.crates?`<p class="preview-leaf-note">${text('crateHint')}</p>`:''}${level.mask?`<p class="preview-leaf-note">${text('maskHint')}</p>`:''}${level.leaves?.some(p=>p.layers===2)?`<p class="preview-leaf-note">${text('previewDouble')}</p>`:''}</section>${progressed?`<section aria-labelledby="preview-remaining"><h3 id="preview-remaining">${text('previewRemaining')} · ${text('movesRemaining').replace('{count}',String(moves))}</h3><div class="preview-goals">${goals(true)}</div></section>`:''}${hasRoundProgress()?`<p class="preview-warning">${text(continuing?'previewRestartWarning':'previewReplaceWarning')}</p>`:''}<p class="preview-kept">${text('previewKept')}</p><div class="preview-actions">${continuing?`<button id="preview-continue" class="primary">${text(progressed?'previewContinue':'previewStartAction')}</button>`:''}${!continuing||progressed||context.intent==='restart'?`<button id="preview-start" class="${continuing?'text-button':'primary'}">${text(context.intent==='restart'||continuing?'previewRestartAction':'previewStartAction')}</button>`:''}<button id="preview-cancel" class="text-button">${text('previewCancel')}</button></div></div>`;
  let pointerTarget:HTMLElement|undefined;
  for(const action of ['continue','start'] as const){
    if(action==='continue'&&!continuing)continue;
    const button=$<HTMLButtonElement>(`#preview-${action}`);if(!button)continue;
    button.onpointerdown=event=>{pointerTarget=event.isPrimary!==false&&event.button===0?button:undefined;};
    button.onclick=event=>{const allowed=button.isConnected&&previewDialog.contains(button)&&event.isTrusted&&(event.detail===0||pointerTarget===button);pointerTarget=undefined;if(allowed)confirmStagePreview(context,action);};
  }
  $('#preview-cancel').onclick=()=>{if(stagePreview===context)closeStagePreview();};
}
function showStagePreview(id:number,intent:'map'|'restart',opener:HTMLElement){
  if(stagePreview||previewDialog.open||!opener.isConnected||!previewEnvironment()||!Number.isInteger(id)||id<1||id>LEVEL_COUNT||(intent==='map'&&(!['map','village'].includes(route)||id>save.highestLevel))||(intent==='restart'&&route!=='puzzle'))return;
  stagePreview={id,intent,round,scene,testing:testingLevel,route,opener,scroll:Array.from(document.querySelectorAll<HTMLElement>('.view')).map(view=>({view,top:view.scrollTop,left:view.scrollLeft}))};
  renderStagePreview();scene.cancelInput();previewDialog.showModal();syncActivity();$('#stage-preview-title').focus({preventScroll:true});
}
previewDialog.addEventListener('cancel',event=>{event.preventDefault();closeStagePreview();});
previewDialog.addEventListener('keydown',event=>{if(event.repeat&&(event.key==='Enter'||event.key===' '))event.preventDefault();});

function syncMusicTheme(){
  if(route==='settings')return;
  audio.setMusicTheme(route==='journal'?'pip':route==='village'?'garden':campaignMusicTheme(route==='map'?selectedChapter:chapterForLevel(currentLevel).id));
}

// 문서와 Android 상태 중 하나라도 비활성이면 오디오와 진행을 멈춥니다.
function syncActivity(){
  syncMusicTheme();
  if(lookPreview&&!validLookPreview(lookPreview))closeLookPreview(false);
  if(spacePreview&&!validSpacePreview(spacePreview))closeSpacePreview(false);
  renderBuyerContinue();
  renderRewardContinue();
  const active=nativeActive&&!document.hidden&&!testAds?.pausesGame&&!testBilling?.pausesGame&&!billingModal();
  if(!active)practiceInputs?.cancel();
  if(audioActive!==active){audioActive=active;if(active)audio.resume();else audio.suspend();}
  // 앱은 첫 활성화에서 배경음을 준비합니다. 제한된 WebView는 기존 입력 경로로 재시도합니다.
  if(active&&Capacitor.isNativePlatform()&&!nativeAudioAttempted){nativeAudioAttempted=true;if(save.music)void audio.unlock().catch(()=>{});}
  if(!game)return;
  // pause만 한 Scene도 그려지므로 CSS로 숨긴 경로에서는 객체 그리기만 끕니다.
  game.scene.getScene('Board')?.sys.setVisible(route==='puzzle');
  const modal=$<HTMLDialogElement>('#tutorial-dialog').open||$<HTMLDialogElement>('#result-dialog').open||(TEST_TOOLS_ENABLED&&$<HTMLDialogElement>('#test-level-dialog').open)||(androidAdEntry&&$<HTMLDialogElement>('#test-ad-dialog').open);
  const playing=active&&!careDemo&&route==='puzzle'&&!modal&&!previewDialog.open&&!resourceDialog.open&&!spaceDialog.open;
  syncPipActivity();
  if(!playing)boardFeedback.cancel();
  if(playing){if(game.scene.isPaused('Board'))game.scene.resume('Board');}
  else if(game.scene.isActive('Board'))game.scene.pause('Board');
  updateBoardAccess();
}
function updateBoardAccess(){
  const board=$('#game-canvas'),state=scene?.keyboardState();
  const modal=$<HTMLDialogElement>('#tutorial-dialog').open||$<HTMLDialogElement>('#result-dialog').open||(TEST_TOOLS_ENABLED&&$<HTMLDialogElement>('#test-level-dialog').open)||(androidAdEntry&&$<HTMLDialogElement>('#test-ad-dialog').open);
  const visible=!careDemo&&nativeActive&&!document.hidden&&!testAds?.pausesGame&&!testBilling?.pausesGame&&!billingModal()&&route==='puzzle'&&!modal&&!previewDialog.open&&!resourceDialog.open&&!spaceDialog.open&&!boardPending;
  const available=visible&&Boolean(state?.available);
  board.tabIndex=visible&&(available||state?.busy)?0:-1;
  board.setAttribute('aria-disabled',String(!available));board.setAttribute('aria-busy',String(Boolean(state?.busy)));
  let description=text(state?.finished?'boardFinished':state?.busy?'boardBusy':'boardUnavailable');
  if(available&&state?.cursor&&state.tile){
    description=text('boardCell').replace('{row}',String(state.cursor.row+1)).replace('{col}',String(state.cursor.col+1))
      .replace('{tile}',text(tileNames[state.tile.kind] as TextKey)).replace('{special}',text(state.tile.special==='row'?'boardRow':state.tile.special==='column'?'boardColumn':state.tile.special==='bomb'?'boardBomb':state.tile.special==='rainbow'?'boardRainbow':'boardOrdinary'))
      .replace('{layers}',String(state.layers));
    description+=' '+(state.selected?text('boardSelected').replace('{row}',String(state.selected.row+1)).replace('{col}',String(state.selected.col+1)):text('boardUnselected'));
  }else if(available&&state?.cursor&&state.crate)description=text('boardCrateCell').replace('{row}',String(state.cursor.row+1)).replace('{col}',String(state.cursor.col+1));
  else if(available)description=text('boardKeyboardHelp');
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
  if(level.crates?.length)descriptions.push(describe('woodenCrate',Math.max(0,level.crates.length-clearedCrates)));
  return descriptions;
}
function walletCount(count:number):string {return count>=10_000?new Intl.NumberFormat(save.language==='ko'?'ko-KR':'en-US',{notation:'compact',maximumFractionDigits:1}).format(count):String(count);}
function updateWallet(){
  $('.wallet.stars .sr-only').textContent=text('stars');$('.wallet.coins .sr-only').textContent=text('coins');
  for(const kind of ['stars','coins'] as const)$('#'+kind+'-help').setAttribute('aria-label',text('resourceHelpButton').replace('{name}',text(kind)).replace('{count}',String(save[kind]))+(careDemo?' · '+text('resourceDemoBalance'):''));
  $('#star-count').textContent=walletCount(save.stars);$('#coin-count').textContent=walletCount(save.coins);
}
function updateGoals(){
  $('#game-canvas').setAttribute('aria-label',text('boardLabel'));
  $('#board-keyboard-help').textContent=text('boardKeyboardHelp');
  $('.bottom-nav').setAttribute('aria-label',text('navLabel'));
  const level=levels[currentLevel-1];
  const descriptions=goalDescriptions();
  const chapter=chapterForLevel(currentLevel);
  $('#chapter-name').textContent=`${text(chapter.title)} · ${chapter.first}–${chapter.last}`;
  $('#level-number').textContent=String(currentLevel);$('#moves').textContent=String(moves);$('#score').textContent=score.toLocaleString(save.language==='ko'?'ko-KR':'en-US');
  $('#goals').innerHTML=level.goals.map((goal,index)=>{const remaining=Math.max(0,goal.count-collected[goal.kind]);return `<div data-feedback-goal="${goal.kind}" class="goal-item ${remaining===0?'done':''}"><span class="sr-only">${descriptions[index]}</span><img src="/assets/tiles-v3/${tileNames[goal.kind]}.webp" alt=""/><strong aria-hidden="true">${remaining===0?icon('check',18):remaining}</strong><span class="goal-progress" style="--progress:${Math.min(100,collected[goal.kind]/goal.count*100)}%"></span></div>`;}).join('');
  const total=level.leaves?.length??0,remaining=Math.max(0,total-clearedLeaves);
  $('#goals').classList.toggle('has-leaves',total>0);
  $('#goals').classList.toggle('has-many',level.goals.length+(total?1:0)+(level.crates?.length?1:0)>2);
  if(total)$('#goals').innerHTML+=`<div data-feedback-goal="leaves" class="goal-item ${remaining===0?'done':''}"><span class="sr-only">${descriptions[level.goals.length]}</span><img src="/assets/obstacles-v4/leaf-pile.webp" alt=""/><strong aria-hidden="true">${remaining===0?icon('check',18):remaining}</strong><span class="goal-progress" style="--progress:${Math.min(100,clearedLeaves/total*100)}%"></span></div>`;
  const crateTotal=level.crates?.length??0,crateRemaining=Math.max(0,crateTotal-clearedCrates);
  if(crateTotal)$('#goals').innerHTML+=`<div data-feedback-goal="crates" class="goal-item ${crateRemaining===0?'done':''}"><span class="sr-only">${descriptions[level.goals.length+(total?1:0)]}</span><img src="/assets/obstacles-v4/wooden-crate.webp" alt=""/><strong aria-hidden="true">${crateRemaining===0?icon('check',18):crateRemaining}</strong><span class="goal-progress" style="--progress:${Math.min(100,clearedCrates/crateTotal*100)}%"></span></div>`;
  $('#board-hint-text').textContent=(testingLevel?text('testRound')+' · ':'')+text(crateTotal?'cratePlayHint':level.mask?'maskPlayHint':total?(level.leaves!.some(p=>p.layers===2)?'leafHintDouble':'leafHint'):'hint');
  const shuffle=$<HTMLButtonElement>('#shuffle'),free=shuffles>0;
  shuffle.innerHTML=`${icon('shuffle',20)}<span>${text(free?'shuffle':'paidShuffle')}</span><span id="shuffle-count" class="${free?'':'shuffle-cost'}">${free?'1':paidShuffleUsed?'0':`${icon('coin',12)} 20`}</span>`;
  shuffle.toggleAttribute('disabled',!free&&(testingLevel||paidShuffleUsed||save.coins<20));
  $('.tool-note').textContent=text(testingLevel?'shuffleHelpTest':'shuffleHelp');
  const expectedRound=round,expectedScene=scene,expectedSave=save;
  shuffle.onclick=()=>shuffleRound(shuffle,expectedRound,expectedScene,expectedSave);
}
function roundCheckpoint(snapshot:BoardSnapshot,nextMoves=moves,free=shuffles,paid=paidShuffleUsed,continued=continueUsed):RoundCheckpoint {
  return {...cloneSnapshot(snapshot),schema:1,levelId:currentLevel,levelSignature:levelSignature(levels[currentLevel-1]),moves:nextMoves,score,
    collected:collected.slice(),shuffles:free,clearedLeaves,...(levels[currentLevel-1].crates?{clearedCrates}:{}),...(paid?{paidShuffleUsed:true}:{}),...(continued?{continueUsed:true}:{})};
}
function shuffleRound(button:HTMLButtonElement,expectedRound:number,expectedScene:BoardScene,expectedSave:SaveData):boolean {
  const valid=()=>!puzzleProcessing&&!careDemo&&!roundEnded&&route==='puzzle'&&nativeActive&&!document.hidden&&!boardPending&&!resultTimer
    &&!document.querySelector('dialog[open]')&&!testAds?.pausesGame&&!testBilling?.pausesGame&&game.scene.isActive('Board')
    &&round===expectedRound&&scene===expectedScene&&save===expectedSave&&game.scene.getScene('Board')===scene
    &&button.isConnected&&$('#shuffle')===button&&scene.keyboardState().available;
  if(!valid())return false;
  const free=shuffles>0;
  if(!free&&(testingLevel||paidShuffleUsed||save.coins<20))return false;
  if(careStorageBlocked()){notice('careSaveBlocked');return false;}
  puzzleProcessing=true;
  try{
    const candidate=prepareShuffle(scene.snapshot(),undefined,scene.engine.mask);
    if(!candidate){notice('shuffleUnavailable');return false;}
    const next=JSON.parse(JSON.stringify(save)) as SaveData;
    const paid=paidShuffleUsed||!free;
    if(!testingLevel){next.coins-=free?0:20;next.inProgress=roundCheckpoint(candidate,moves,0,paid);
      if(!saveData(next)){updateSaveStatus();notice('careSaveBlocked');return false;}}
    // 후보 생성·저장·적용 사이에는 await가 없으며 현재 Scene/RNG를 재생성하지 않습니다.
    if(!testingLevel)save=next;
    shuffles=0;paidShuffleUsed=paid;scene.applyPreparedShuffle(candidate);updateWallet();updateGoals();renderViews();updateSaveStatus();return true;
  }finally{puzzleProcessing=false;}
}
function checkpoint(){
  if(careDemo||testingLevel||roundEnded)return;
  save.inProgress=roundCheckpoint(scene.snapshot());
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
function startLevel(id:number,testPlay=false,restored?:RoundCheckpoint,options:{focusBoard?:boolean}={}){
  if(careDemo)return;
  if(lookPreview)closeLookPreview(false);if(spacePreview)closeSpacePreview(false);
  if(resourceHelp)closeResourceHelp(false);
  boardFeedback.cancel();
  if(stagePreview)closeStagePreview(false);
  abandonRewardContinue();
  if(!Number.isInteger(id)||id<1||id>levels.length)return;
  mapAdvance=undefined;clearMapTravel();
  resultWorldScenery?.dispose();resultWorldScenery=undefined;resultWorld=undefined;
  clearResumeNotice();
  clearTimeout(resultTimer);resultTimer=undefined;round++;
  roundEnded=false;resultShown=false;firstReward=false;resultWon=undefined;clearBoardNotice();continueUsed=false;paidShuffleUsed=false;
  const activeRound=round;
  const focusOrigin=document.activeElement;let focusRequested=options.focusBoard===true;
  testingLevel=TEST_TOOLS_ENABLED&&testPlay;
  pickerReturnToResult=false;
  $<HTMLDialogElement>('#result-dialog').close();
  currentLevel=id;moves=levels[id-1].moves;score=0;collected=Array(6).fill(0);shuffles=1;clearedLeaves=0;clearedCrates=0;
  if(restored&&!testingLevel){moves=restored.moves;score=restored.score;collected=restored.collected.slice();shuffles=restored.shuffles;clearedLeaves=restored.clearedLeaves;clearedCrates=restored.clearedCrates??0;continueUsed=restored.continueUsed===true;paidShuffleUsed=restored.paidShuffleUsed===true;}
  scene?.stopPlaying();
  const activeScene:BoardScene=scene=new BoardScene({audio,onBoardState:()=>{if(activeRound===round)updateBoardAccess();},onReady:()=>{
    if(activeRound!==round||scene!==activeScene)return;
    syncActivity();
    if(!focusRequested)return;
    focusRequested=false;
    const board=$('#game-canvas'),focused=document.activeElement;
    if(board.tabIndex!==0||!activeScene.keyboardState().available||(focused!==focusOrigin&&focused!==document.body&&focused!==board))return;
    const alreadyFocused=focused===board;
    board.focus({preventScroll:true});
    // 같은 DOM에 초점이 남아 있으면 focus 이벤트가 다시 발생하지 않습니다.
    if(alreadyFocused&&board.matches(':focus-visible'))activeScene.focusKeyboard();
  },onStart:()=>{
    if(activeRound!==round||scene!==activeScene)return;
    const level=levels[currentLevel-1];
    boardFeedback.beginMove(level.goals.map(g=>({key:String(g.kind),remaining:Math.max(0,g.count-collected[g.kind]),src:`/assets/tiles-v3/${tileNames[g.kind]}.webp`}))
      .concat([{key:'leaves',remaining:Math.max(0,(level.leaves?.length??0)-clearedLeaves),src:'/assets/obstacles-v4/leaf-pile.webp'}])
      .concat(level.crates?[{key:'crates',remaining:Math.max(0,level.crates.length-clearedCrates),src:'/assets/obstacles-v4/wooden-crate.webp'}]:[]));
    void audio.unlock().catch(()=>{});
  },onResolveVisual:event=>{if(activeRound===round&&scene===activeScene)boardFeedback.show(event);},
  onVisualCancel:()=>{if(activeRound===round&&scene===activeScene)boardFeedback.cancel();},onNotice:key=>{
    if(activeRound!==round)return;
    boardNoticeKey=key;$('#board-notice').textContent=text(key);$('#board-notice').classList.remove('pop');void $('#board-notice').offsetWidth;$('#board-notice').classList.add('pop');
  },onMove:(items,points,_chains,leavesCleared,cratesCleared)=>{
    if(careDemo||activeRound!==round||roundEnded)return;
    boardFeedback.cancel();
    moves--;score+=points;clearedLeaves+=leavesCleared??0;clearedCrates+=cratesCleared??0;items.forEach((n,i)=>collected[i]+=n);updateGoals();
    const level=levels[currentLevel-1];
    const won=level.goals.every(g=>collected[g.kind]>=g.count)&&clearedLeaves>=(level.leaves?.length??0)&&clearedCrates>=(level.crates?.length??0);
    if(won||moves<=0){settleRound(won);scene.stopPlaying();resultTimer=setTimeout(()=>{if(activeRound!==round)return;resultTimer=undefined;finish(won);},300);}
    else checkpoint();
  }},restored,levels[id-1].mask,levels[id-1].crates);
  if(!restored)scene.configureLeaves(levels[id-1].leaves??[]);
  // 엔진 생성/복원 직후부터 안정 상태를 유지하며 연쇄 도중에는 갱신하지 않습니다.
  const stored=checkpoint();
  boardPending=true;
  if(!game){
    game=new Phaser.Game({type:Phaser.AUTO,width:BOARD_RENDER_SIZE,height:BOARD_RENDER_SIZE,parent:'game-canvas',backgroundColor:'#284c42',scene:[],transparent:false,
      scale:{mode:Phaser.Scale.FIT,autoCenter:Phaser.Scale.CENTER_BOTH},render:{antialias:true,roundPixels:false},audio:{noAudio:true},input:{activePointers:2}});
    game.events.on(Phaser.Core.Events.POST_RENDER,replaceBoard);
  }
  updateGoals();syncActivity();
  return stored;
}
function clearBoardNotice(){boardNoticeKey=undefined;$('#board-notice').textContent='';$('#board-notice').classList.remove('pop');}
function notice(key:TextKey){
  noticeKey=key;clearTimeout(toastTimer);$('#toast').textContent=text(key);$('#toast').classList.add('visible');
  const timer=setTimeout(()=>{if(toastTimer!==timer)return;noticeKey=undefined;$('#toast').classList.remove('visible');$('#toast').textContent='';},3200);
  toastTimer=timer;
}
function clearResumeNotice(){
  clearTimeout(resumeNoticeTimer);resumeNoticeTimer=undefined;
  $('#round-resumed-notice').hidden=true;$('#round-resumed-notice').textContent='';
  $('.board-hint').classList.remove('has-resume-notice');
}
function showResumeNotice(){
  clearResumeNotice();const activeRound=round;
  $('#round-resumed-notice').textContent=text(scene.engine.ruleVersion===1?'roundResumedClassic':'roundResumed');$('#round-resumed-notice').hidden=false;
  $('.board-hint').classList.add('has-resume-notice');
  const timer=setTimeout(()=>{if(resumeNoticeTimer!==timer||round!==activeRound)return;clearResumeNotice();},3200);
  resumeNoticeTimer=timer;
}
function renderTutorial(){
  practiceInputs?.dispose();practiceInputs=undefined;
  const headings:TextKey[]=['tutorialSwap','tutorialGoal','tutorialMagic',specialPractice?'specialPracticeTitle':squarePractice?'squarePracticeTitle':'practiceTitle'];
  const descriptions:TextKey[]=['tutorialSwapDesc','tutorialGoalDesc','tutorialMagicDesc',specialPractice?(specialPractice.completed?'specialPracticeDone':'specialPracticeDesc'):squarePractice?(squarePractice.completed?'squarePracticeDone':'squarePracticeDesc'):practice?.completed?'practiceDone':'practiceDesc'];
  const tile=(name:string)=>`<img src="/assets/tiles-v3/${name}.webp" alt=""/>`;
  const art=tutorialPage===3?practiceArt():tutorialPage===0?`<div class="guide-swap" aria-hidden="true">${tile('strawberry')}${tile('strawberry')}<span>${tile('carrot')}<b>↕</b>${tile('strawberry')}</span></div>`:tutorialPage===1?`<div class="guide-goals" aria-hidden="true"><span>${tile('strawberry')} 12</span><span>${tile('carrot')} 10</span>${icon('leaf',24)}</div>`:`<div class="guide-specials">${(['tutorialFour','tutorialFive','tutorialShape'] as TextKey[]).map((key,i)=>`<div>${specialTileArt(['leaf','flower','blueberry'][i],(['row','rainbow','bomb'] as const)[i])}<small>${text(key)}</small></div>`).join('')}</div>`;
  $('#tutorial-dialog').innerHTML=`<div class="guide-content"><div class="eyebrow">${text('tutorial')} · ${text('tutorialStep')} ${tutorialPage+1} / 4</div><h2 id="tutorial-title" tabindex="-1">${text(headings[tutorialPage])}</h2>${art}<p id="tutorial-description">${text(descriptions[tutorialPage])}</p><div class="guide-dots" aria-hidden="true">${[0,1,2,3].map(i=>`<i class="${i===tutorialPage?'active':''}"></i>`).join('')}</div><div class="guide-actions"><button id="guide-back" class="text-button" ${tutorialPage===0?'disabled':''}>${text('tutorialBack')}</button><button id="guide-next" class="primary" ${tutorialPage===3&&tutorialIntent==='onboarding'&&!practice?.completed?'disabled':''}>${text(tutorialPage===3?(tutorialIntent==='help'?'tutorialClose':'tutorialStart'):tutorialPage===2?'tutorialTry':'tutorialNext')}${icon('arrow',18)}</button></div><button id="guide-skip" class="text-button">${text(tutorialIntent==='help'?'tutorialClose':'tutorialSkip')}</button></div>`;
  $('#guide-back').onclick=()=>{if(tutorialPage>0){tutorialPage--;specialPractice=undefined;squarePractice=undefined;renderTutorial();$('#tutorial-title').focus();}};
  $('#guide-next').onclick=()=>{if(tutorialPage<3){tutorialPage++;if(tutorialPage===3){practice=new SwapPractice();specialPractice=undefined;squarePractice=undefined;}renderTutorial();$('#tutorial-title').focus();}else if(tutorialIntent==='help'||practice?.completed)closeTutorial();};
  $('#guide-skip').onclick=closeTutorial;
  if(tutorialPage===3){
    bindPracticeInputs();
    if(!specialPractice&&!squarePractice&&practice?.completed){
      $('#practice-special').onclick=()=>{specialPractice=new SpecialTapPractice();renderTutorial();};
      $('#practice-square').onclick=()=>{squarePractice=new SwapPractice(true);renderTutorial();$('#practice-cell-1-1').focus();};
    }
    if(specialPractice){if(specialPractice.completed)focusPracticeStart();else $('#practice-cell-1-1').focus();}
  }
}
function practiceArt(){
  const lesson=specialPractice??squarePractice??practice!;
  return `<div id="practice-board" class="practice-board" role="group" aria-label="${text('practiceBoard')}">${lesson.board.map((row,r)=>row.map((block,c)=>{
    const pos={row:r,col:c}, target=lesson.isTarget(pos), selected=!specialPractice&&(squarePractice??practice)?.selected?.row===r&&(squarePractice??practice)?.selected?.col===c;
    const cleared=lesson.result?.steps[0].removed.some(p=>p.row===r&&p.col===c);
    const shown=lesson.result?.steps[0].created?.find(p=>p.row===r&&p.col===c)?.tile??block;
    const name=(shown.special==='bomb'?text('squarePracticeBombCell'):specialPractice&&target?text('specialPracticeCell'):text('practiceCell').replace('{tile}',text(tileNames[block.kind] as TextKey))).replace('{row}',String(r+1)).replace('{col}',String(c+1));
    const image=`<img src="/assets/tiles-v3/${tileNames[shown.kind]}.webp" alt=""/>`;
    return `<button id="practice-cell-${r}-${c}" data-row="${r}" data-col="${c}" class="practice-cell ${shown.special?'practice-created':''} ${target&&!lesson.completed?'practice-target':''} ${cleared?'practice-cleared':''}" aria-label="${name}" aria-pressed="${Boolean(selected)}" ${!target||lesson.completed?'disabled':''}>${shown.special?specialTileArt(tileNames[shown.kind],shown.special):image}${cleared?'<span class="practice-check" aria-hidden="true">✓</span>':''}</button>`;
  }).join('')).join('')}</div><div id="practice-feedback" class="practice-feedback" role="status">${specialPractice?text(lesson.completed?'specialPracticeMatched':'specialPracticePrompt'):squarePractice?text(lesson.completed?'squarePracticeMatched':'squarePracticePrompt'):practice?.completed?`<button id="practice-special" class="text-button">${text('specialPracticeTry')}</button><button id="practice-square" class="text-button">${text('squarePracticeTry')}</button>`:text(practice?.selected?'practiceSelected':'practicePrompt')}</div>`;
}
function bindPracticeInputs(){
  const refresh=(done:boolean,pos:{row:number,col:number})=>{
    renderTutorial();
    if(done){audio.play('match');if(!specialPractice)focusPracticeStart();}
    else $(`#practice-cell-${pos.row}-${pos.col}`).focus();
  };
  const lesson=squarePractice??practice!;
  const special=specialPractice;
  practiceInputs=bindPracticeBoard($('#practice-board'),{
    tap:pos=>{if(special){if(special.tap(pos))refresh(true,pos);}else refresh(lesson.select(pos),pos);},
    swipe:(pos,dx,dy)=>{if(special)return;if(lesson.swipe(pos,dx,dy))refresh(true,pos);else $('#practice-feedback').textContent=text(squarePractice?'squarePracticePrompt':'practicePrompt');},
  });
}
function focusPracticeStart(){
  const button=$('#guide-next');
  button.focus({preventScroll:true});
  // touchup 뒤 합성 click이 끝나기 전에 스크롤하면 새 시작 버튼에 click이 닿을 수 있습니다.
  setTimeout(()=>{if(button.isConnected&&document.activeElement===button&&$<HTMLDialogElement>('#tutorial-dialog').open)button.scrollIntoView({block:'nearest'});},0);
}
function showTutorial(intent:'onboarding'|'help'='onboarding',opener?:HTMLButtonElement){
  if(careDemo)return;
  if(stagePreview||previewDialog.open||otherModal()||!scene.canLeave()||resultTimer)return;
  // 첫 안내는 보드 부팅 중에도 열립니다. 사용자가 다시 여는 도움말만 활성 화면을 확인합니다.
  if(intent==='help'&&(!nativeActive||document.hidden||boardPending||testAds?.pausesGame||testBilling?.pausesGame||!opener?.isConnected||opener.disabled||opener.hidden||!['settings','journal'].includes(route)||$('#'+route+'-view').hidden))return;
  tutorialIntent=intent;
  tutorialReturn=intent==='help'&&opener?{opener,id:opener.id,scroll:Array.from(document.querySelectorAll<HTMLElement>('.view'),view=>({view,top:view.scrollTop,left:view.scrollLeft}))}:undefined;
  tutorialPage=0;practice=undefined;specialPractice=undefined;squarePractice=undefined;renderTutorial();$<HTMLDialogElement>('#tutorial-dialog').showModal();
  syncActivity();
}
function closeTutorial(){
  if(!$<HTMLDialogElement>('#tutorial-dialog').open)return;
  const context=tutorialReturn;tutorialReturn=undefined;
  practiceInputs?.dispose();practiceInputs=undefined;
  $<HTMLDialogElement>('#tutorial-dialog').close();save.tutorialSeen=true;persist();
  syncActivity();
  if(context){
    const opener=context.opener.isConnected?context.opener:document.querySelector<HTMLButtonElement>('#'+context.id);
    if(opener?.isConnected&&!opener.disabled&&!opener.hidden)opener.focus({preventScroll:true});
    for(const {view,top,left} of context.scroll){view.scrollTop=top;view.scrollLeft=left;}
  }
}
function chapterTabs(selected:number,test=false){
  const prefix=test?'test-':'';
  return `<div class="chapter-tabs" ${test?'role="tablist"':'role="navigation"'} aria-label="${text('chapterSelect')}">${chapters.map(chapter=>`<button id="${prefix}chapter-${chapter.id}" data-${prefix}chapter="${chapter.id}" ${test?`role="tab" aria-selected="${chapter.id===selected}" aria-controls="test-chapter-levels" tabindex="${chapter.id===selected?0:-1}"`:`aria-controls="map-chapter-${chapter.id}"`}><strong>${chapter.first}–${chapter.last}</strong><small>${text(chapter.title)}</small></button>`).join('')}</div>`;
}
function revealChapterTab(button:HTMLElement){
  const strip=button.parentElement;if(!strip)return;
  const bounds=strip.getBoundingClientRect(),tab=button.getBoundingClientRect();if(bounds.width<=0)return;
  if(tab.left<bounds.left)strip.scrollLeft-=bounds.left-tab.left;else if(tab.right>bounds.right)strip.scrollLeft+=tab.right-bounds.right;
}
function bindChapterTabs(test=false){
  const prefix=test?'test-':'';
  document.querySelectorAll<HTMLButtonElement>(`[data-${prefix}chapter]`).forEach(button=>{
    const select=(id:number)=>{if(test){selectedTestChapter=id;renderTestPicker();}else{selectedChapter=id;document.querySelector(`#map-chapter-${id}`)?.scrollIntoView?.({block:'start',behavior:'auto'});}const target=$(`#${prefix}chapter-${id}`);target.focus({preventScroll:true});revealChapterTab(target);};
    button.onclick=()=>select(Number(test?button.dataset.testChapter:button.dataset.chapter));
    button.onkeydown=event=>{const index=chapters.findIndex(chapter=>chapter.id===Number(test?button.dataset.testChapter:button.dataset.chapter));const next=event.key==='ArrowRight'?(index+1)%chapters.length:event.key==='ArrowLeft'?(index+chapters.length-1)%chapters.length:event.key==='Home'?0:event.key==='End'?chapters.length-1:-1;if(next>=0){event.preventDefault();select(chapters[next].id);}};
  });
  const selected=document.querySelector<HTMLElement>(`#${prefix}chapter-${test?selectedTestChapter:selectedChapter}`);if(selected)revealChapterTab(selected);
}
function testLevelNumber(raw:string):number|undefined {
  if(!TEST_TOOLS_ENABLED||!/^\d{1,3}$/.test(raw.trim()))return;
  const id=Number(raw.trim());return id>=1&&id<=LEVEL_COUNT?id:undefined;
}
function renderTestPicker(){
  if(!TEST_TOOLS_ENABLED)return;
  const dialog=$<HTMLDialogElement>('#test-level-dialog');
  dialog.innerHTML=`<div class="test-picker"><h2 id="test-level-title" tabindex="-1" autofocus>${text('testPickTitle')}</h2><p>${text('testPickDesc')}</p><div class="test-level-direct"><label for="test-level-number">${text('testNumberLabel')}</label><input id="test-level-number" inputmode="numeric" autocomplete="off" aria-describedby="test-level-number-error" placeholder="1–${LEVEL_COUNT}"><button id="test-level-number-start" class="primary">${text('testNumberStart')}</button></div><p id="test-level-number-error" class="test-level-number-error" role="status"></p>${chapterTabs(selectedTestChapter,true)}<div class="test-level-grid" id="test-chapter-levels" role="tabpanel" aria-labelledby="test-chapter-${selectedTestChapter}">${levels.filter(level=>chapterForLevel(level.id).id===selectedTestChapter).map(level=>`<button id="test-stage-${level.id}" data-test-level="${level.id}" class="test-stage"><strong>${text('level')} ${level.id}</strong><small>${text(level.crates?'testCrates':level.mask?'testMasked':!level.leaves?'testBasic':level.leaves.some(p=>p.layers===2)?'testDouble':'testSingle')}</small></button>`).join('')}</div><a id="carrier-trial-entry" class="primary" href="/carrier-trial.html?lang=${save.language}">${text('carrierTrial')}</a><p>${text('carrierTrialNote')}</p><button id="test-normal" class="primary">${text('testNormal')}</button><button id="test-close" class="text-button">${text('testClose')}</button></div>`;
  const columnTrial=document.createElement('a');columnTrial.id='column-carrier-trial-entry';columnTrial.className='primary';
  columnTrial.href=`/carrier-trial.html?mode=column&lang=${save.language}`;columnTrial.textContent=text('columnCarrierTrial');
  dialog.querySelector('#carrier-trial-entry')!.before(columnTrial);
  const input=$<HTMLInputElement>('#test-level-number'),error=$('#test-level-number-error'),pickerRound=round,pickerScene=scene;
  const canPick=()=>dialog.open&&input.isConnected&&input===document.querySelector('#test-level-number')&&pickerRound===round&&pickerScene===scene&&game.scene.getScene('Board')===scene&&!careDemo&&nativeActive&&!document.hidden&&!boardPending&&scene.canLeave()&&!resultTimer&&!testAds?.busy&&!testAds?.pausesGame&&!testBilling?.busy&&!testBilling?.pausesGame;
  const choose=(id:number,keyboard=false)=>{
    if(!canPick()||!Number.isInteger(id)||id<1||id>LEVEL_COUNT)return;
    pickerReturnToResult=false;dialog.close();startLevel(id,true,undefined,{focusBoard:keyboard});switchView('puzzle');
  };
  const submit=(keyboard=false)=>{
    if(!canPick())return;
    const id=testLevelNumber(input.value);
    if(id===undefined){input.setAttribute('aria-invalid','true');error.textContent=text('testNumberRange').replace('{max}',String(LEVEL_COUNT));input.focus();return;}
    choose(id,keyboard);
  };
  input.oninput=()=>{input.removeAttribute('aria-invalid');error.textContent='';};
  input.onkeydown=event=>{if(event.key!=='Enter'||event.isComposing)return;event.preventDefault();if(!event.repeat)submit(true);};
  $('#test-level-number-start').onclick=()=>submit();
  document.querySelectorAll<HTMLButtonElement>('[data-test-level]').forEach(button=>button.onclick=()=>choose(Number(button.dataset.testLevel)));
  bindChapterTabs(true);
  $('#test-normal').onclick=()=>{if(!scene.canLeave()||resultTimer)return;pickerReturnToResult=false;dialog.close();resumeNormal();switchView('puzzle');};
  $('#test-close').onclick=closeTestPicker;
}
function showTestPicker(fromResult=false){
  if(careDemo)return;
  if(resourceDialog.open)return;
  if(stagePreview)return;
  if(!TEST_TOOLS_ENABLED||!scene.canLeave()||resultTimer||$<HTMLDialogElement>('#result-dialog').open||$<HTMLDialogElement>('#tutorial-dialog').open)return;
  pickerReturnToResult=fromResult;selectedTestChapter=chapterForLevel(currentLevel).id;
  renderTestPicker();$<HTMLDialogElement>('#test-level-dialog').showModal();
  const selected=document.querySelector<HTMLElement>(`#test-chapter-${selectedTestChapter}`);if(selected)revealChapterTab(selected);
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
  if(careDemo||roundEnded)return;
  roundEnded=true;
  pipIdle.setActive(false);
  const previousMapLevel=save.highestLevel;
  firstReward=won&&!testingLevel&&!save.completed.includes(currentLevel);
  if(testingLevel)return;
  delete save.inProgress;
  if(firstReward){save.completed.push(currentLevel);save.stars++;save.coins+=40;save.highestLevel=Math.min(LEVEL_COUNT,Math.max(save.highestLevel,currentLevel+1));selectedChapter=chapterForLevel(save.highestLevel).id;}
  if(firstReward&&previousMapLevel===currentLevel&&save.highestLevel===currentLevel+1)mapAdvance={from:currentLevel,to:currentLevel+1,owner:save};
  // 결과창 타이머 전에 회차 제거와 첫 보상을 하나의 저장으로 확정합니다.
  persist();updateWallet();renderViews();
}
function finish(won:boolean){
  if(careDemo||resultShown)return;
  settleRound(won);resultShown=true;resultWon=won;
  const first=firstReward;
  audio.play(won?'win':'lose');
  const done=won&&!testingLevel&&campaignClearCount(save.completed)===LEVEL_COUNT&&(firstReward||currentLevel===LEVEL_COUNT);
  const testContinue=TEST_TOOLS_ENABLED&&testingLevel&&!won&&!continueUsed&&moves===0;
  const dialog=$<HTMLDialogElement>('#result-dialog');
  resultWorldScenery?.dispose();resultWorldScenery=undefined;resultWorld=campaignMilestone(save.completed,currentLevel,first,testingLevel,won);
  dialog.innerHTML=`<div class="result-content ${won?'result-win':'result-retry'}${testContinue?' result-with-continue':''}"><div class="result-stage" aria-hidden="true"><span class="result-ground"></span><span class="result-character"><img class="result-pip" src="/assets/pip.png" decoding="async" alt=""/></span><span class="result-symbol">${icon(won?'star':'leaf',25)}</span>${won?`<span class="result-sparkles">${[0,1,2].map(()=>`<i>${icon('star',14)}</i>`).join('')}</span>`:''}</div><p class="result-pip-line" id="result-pip-line">${text(won?'pipWin':'pipRetry')}</p><div class="eyebrow" id="result-level">${text('level')} ${currentLevel}${testingLevel?` · ${text('testPick')}`:''}</div><h2 id="result-title">${text(done?'complete':won?'win':'lose')}</h2><p id="result-description">${text(testingLevel?'testResultDesc':done?'completeDesc':won?(first?'winDesc':'replayDesc'):'loseDesc').replace('{count}',String(LEVEL_COUNT))}</p>${first?`<div class="result-rewards"><span>${icon('star',20)}<span class="sr-only" data-t="stars">${text('stars')}</span> +1</span><span>${icon('coin',20)}<span class="sr-only" data-t="coins">${text('coins')}</span> +40</span></div>`:''}${campaignMilestoneCard(save.language,resultWorld,round)}<button class="primary" id="result-next">${text(won?(done||currentLevel===LEVEL_COUNT?'allDone':'next'):'retry')}${icon('arrow',19)}</button>${androidBillingEntry&&!won&&!continueUsed&&moves===0?`<button class="result-test-button" id="result-buyer-continue" hidden>${text('buyerContinueTest')}</button>`:''}${testContinue?`<button class="result-test-button" id="result-continue" aria-describedby="result-continue-note">${text('testContinue')}</button><p id="result-continue-note">${text('testContinueNote')}</p>`:''}${testingLevel?`<button class="result-test-button" id="result-test">${text('testOther')}</button>`:''}<button class="text-button" id="result-home">${text('home')}</button></div>`;
  dialog.showModal();syncActivity();
  $('#result-next').focus();
  const resultRound=round,resultScene=scene,resultLevel=currentLevel,resultTesting=testingLevel;
  const canNavigate=(button:HTMLButtonElement)=>!careDemo&&!puzzleProcessing&&nativeActive&&!document.hidden&&!boardPending&&resultTimer===undefined
    &&roundEnded&&resultShown&&resultWon===won&&round===resultRound&&scene===resultScene&&currentLevel===resultLevel&&testingLevel===resultTesting
    &&game.scene.getScene('Board')===resultScene&&dialog.open&&button.isConnected&&!button.disabled&&$('#'+button.id)===button
    &&!previewDialog.open&&!resourceDialog.open&&!spaceDialog.open&&!lookDialog.open&&!$<HTMLDialogElement>('#tutorial-dialog').open
    &&!(TEST_TOOLS_ENABLED&&$<HTMLDialogElement>('#test-level-dialog').open)&&!billingModal()&&!testAds?.busy&&!testAds?.pausesGame&&!testBilling?.busy&&!testBilling?.pausesGame&&!rewardedContinue?.preparing;
  const next=$<HTMLButtonElement>('#result-next'),home=$<HTMLButtonElement>('#result-home');
  next.onclick=()=>{if(!canNavigate(next))return;dialog.close();startLevel(won&&!done?Math.min(LEVEL_COUNT,currentLevel+1):currentLevel,testingLevel,undefined,{focusBoard:true});switchView('puzzle');};
  home.onclick=()=>{if(!canNavigate(home))return;dialog.close();switchView('map');};
  if(testingLevel){const picker=$<HTMLButtonElement>('#result-test');picker.onclick=()=>{if(!canNavigate(picker))return;dialog.close();showTestPicker(true);};}
  const continueButton=dialog.querySelector<HTMLButtonElement>('#result-continue');
  if(continueButton){const activeRound=round,activeScene=scene;continueButton.onclick=()=>{if(!testAds?.busy&&!rewardedContinue?.preparing)continueTestRound(activeRound,activeScene,continueButton);};}
  const buyerButton=dialog.querySelector<HTMLButtonElement>('#result-buyer-continue');
  if(buyerButton){const activeRound=round,activeScene=scene;buyerButton.onclick=()=>continueRound(activeRound,activeScene,buyerButton,'owned');}
  if(testContinue&&androidAdEntry&&continueButton){
    const controls=document.createElement('div');controls.className='result-reward-controls';
    controls.innerHTML=`<p id="result-ad-note"></p><p id="result-ad-status" role="status"></p><button class="result-test-button" id="result-ad-load"></button><button class="result-test-button" id="result-ad-show"></button><button class="text-button" id="result-ad-cancel"></button>`;
    continueButton.before(controls);
    bindRewardContinue(continueButton);
  }
  showResultPip($<HTMLImageElement>('.result-pip'),won);
}
// 결과 재방문은 기존 DOM을 사용하되 떠날 때 폐기한 광고 요청은 되살리지 않습니다.
function bindRewardContinue(button:HTMLButtonElement){
  const context:NonNullable<typeof rewardedContinue>=rewardedContinue={round,scene,button,preparing:false};
  $('#result-ad-load').onclick=()=>{void prepareRewardContinue(context);};
  $('#result-ad-show').onclick=()=>{
    if(!rewardContextValid(context)||!nativeActive||document.hidden||testBilling?.blocksAds||testAds?.busy||testAds?.snapshot.format!=='rewarded'||testAds.snapshot.state!=='ready')return;
    context.requestId=crypto.randomUUID();void testAds.command('show',context.requestId);
  };
  $('#result-ad-cancel').onclick=()=>{if(!rewardContextValid(context))return;context.requestId=undefined;void testAds?.command('cancel');};
  ensureTestAds();renderRewardContinue();void testAds!.connect();
}
function continueTestRound(activeRound:number,activeScene:BoardScene,button:HTMLButtonElement):boolean {
  return continueRound(activeRound,activeScene,button,'test');
}
function buyerContinueAvailable(){return androidBillingEntry&&testBilling?.verifiedOwned===true;}
function renderBuyerContinue(){
  if(!androidBillingEntry)return;
  const button=$<HTMLDialogElement>('#result-dialog').querySelector<HTMLButtonElement>('#result-buyer-continue');if(!button)return;
  button.hidden=!buyerContinueAvailable()||continueUsed||!roundEnded||!resultShown||resultWon!==false||moves!==0;
  button.textContent=text('buyerContinueTest');
  button.disabled=button.hidden||puzzleProcessing||Boolean(testAds?.busy)||Boolean(rewardedContinue?.preparing)||!nativeActive||document.hidden;
}
function continueRound(activeRound:number,activeScene:BoardScene,button:HTMLButtonElement,source:'test'|'ad'|'owned'):boolean {
  if(careDemo||puzzleProcessing||!nativeActive||document.hidden||testAds?.busy||testBilling?.pausesGame||rewardedContinue?.preparing)return false;
  if(previewDialog.open||billingModal()||$<HTMLDialogElement>('#tutorial-dialog').open
    ||TEST_TOOLS_ENABLED&&$<HTMLDialogElement>('#test-level-dialog').open
    ||androidAdEntry&&$<HTMLDialogElement>('#test-ad-dialog').open)return false;
  const dialog=$<HTMLDialogElement>('#result-dialog');
  const key=source==='owned'?'#result-buyer-continue':'#result-continue';
  if((source==='owned'?!buyerContinueAvailable():!TEST_TOOLS_ENABLED||!testingLevel)||continueUsed||activeRound!==round||activeScene!==scene
    ||route!=='puzzle'||boardPending||game.scene.getScene('Board')!==activeScene||resultTimer!==undefined
    ||!roundEnded||!resultShown||resultWon!==false||moves!==0||!dialog.open
    ||!button.isConnected||dialog.querySelector(key)!==button||!activeScene.canResumeAfterFailure())return false;
  if(careStorageBlocked()){notice('careSaveBlocked');return false;}
  puzzleProcessing=true;
  try{
    const next=JSON.parse(JSON.stringify(save)) as SaveData;
    if(!testingLevel){next.inProgress=roundCheckpoint(activeScene.snapshot(),5,shuffles,paidShuffleUsed,true);
      if(!saveData(next)){updateSaveStatus();notice('careSaveBlocked');return false;}}
    if(!testingLevel)save=next;
    activeScene.resumePreparedFailure();abandonRewardContinue();
    continueUsed=true;moves=5;roundEnded=false;resultShown=false;resultWon=undefined;firstReward=false;clearBoardNotice();
    dialog.close();updateGoals();renderViews();syncActivity();
    const board=$('#game-canvas');if(board.tabIndex===0)board.focus({preventScroll:true});return true;
  }finally{puzzleProcessing=false;}
}
function ensureTestAds(){
  if(!testAds)testAds=new TestAdsController(nativeTestAds(),()=>{renderAdDialog();syncActivity();});
}
function abandonRewardContinue(){
  rewardedContinue=undefined;testAds?.abandonReward();
  if(testAds?.needsCancellation&&!testAds.busy)void testAds.command('cancel');
}
function rewardContextValid(context:NonNullable<typeof rewardedContinue>){
  return context===rewardedContinue&&TEST_TOOLS_ENABLED&&androidAdEntry&&testingLevel&&!continueUsed
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
function adBlockMessage(){
  return testBilling?.snapshot.entitlement==='owned'?billingCopy(save.language).entitlement.owned:text('testAdContinueBlocked');
}
function renderRewardContinue(){
  const context=rewardedContinue;
  if(!context||!testAds)return;
  if(!rewardContextValid(context)){abandonRewardContinue();return;}
  if(testBilling?.blocksAds){context.requestId=undefined;testAds.abandonReward();}
  if(context.requestId&&nativeActive&&!document.hidden&&!testBilling?.blocksAds&&testAds.takeReward(context.requestId)){
    const {round:activeRound,scene:activeScene,button}=context;
    context.requestId=undefined;continueRound(activeRound,activeScene,button,'ad');return;
  }
  const copy=adCopy(save.language),value=testAds.snapshot,busy=testAds.busy||context.preparing;
  $('#result-ad-note').textContent=text('testAdContinueNote');
  $('#result-ad-status').textContent=testBilling?.blocksAds?adBlockMessage():!value.available?copy.unavailable:value.state==='closed'?text('testAdContinueNoReward'):copy.states[value.state];
  $('#result-ad-load').textContent=text('testAdContinueLoad');$('#result-ad-show').textContent=text('testAdContinueShow');$('#result-ad-cancel').textContent=copy.cancel;
  $('#result-ad-load').toggleAttribute('disabled',!value.available||busy||value.state==='ready'||Boolean(testBilling?.blocksAds)||!nativeActive||document.hidden);
  $('#result-ad-show').toggleAttribute('disabled',!value.available||busy||value.state!=='ready'||value.format!=='rewarded'||Boolean(testBilling?.blocksAds)||!nativeActive||document.hidden);
  $('#result-ad-cancel').toggleAttribute('disabled',testAds.pending||testAds.overlay||context.preparing);
  for(const id of ['result-next','result-home','result-test','result-continue'])$('#'+id)?.toggleAttribute('disabled',busy);
}
// 문구만 갱신하여 결과 보상·타이머·아트 요청·버튼·초점을 유지합니다.
function updateResultCopy(){
  if(resultWon===undefined)return;
  const won=resultWon,done=won&&!testingLevel&&campaignClearCount(save.completed)===LEVEL_COUNT&&(firstReward||currentLevel===LEVEL_COUNT);
  $('#result-pip-line').textContent=text(won?'pipWin':'pipRetry');
  $('#result-level').textContent=`${text('level')} ${currentLevel}${testingLevel?' · '+text('testPick'):''}`;
  $('#result-title').textContent=text(done?'complete':won?'win':'lose');
  $('#result-description').textContent=text(testingLevel?'testResultDesc':done?'completeDesc':won?(firstReward?'winDesc':'replayDesc'):'loseDesc').replace('{count}',String(LEVEL_COUNT));
  $('#result-next').innerHTML=text(won?(done||currentLevel===LEVEL_COUNT?'allDone':'next'):'retry')+icon('arrow',19);
  $('#result-home').textContent=text('home');
  if(resultWorld){const copy=milestoneCopy(save.language,resultWorld);for(const [id,value] of [['title',copy.title],['name',copy.name],['note',copy.note]]){const node=document.querySelector<HTMLElement>('#result-world-'+id);if(node)node.textContent=value;}}
  if(testingLevel)$('#result-test').textContent=text('testOther');
  const continueButton=$<HTMLDialogElement>('#result-dialog').querySelector<HTMLButtonElement>('#result-continue');
  if(continueButton){continueButton.textContent=text('testContinue');$('#result-continue-note').textContent=text('testContinueNote');}
  renderBuyerContinue();
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
  $('#test-ad-error').textContent=testBilling?.blocksAds?adBlockMessage():state.error?(state.error.startsWith('consent')?copy.blocked:copy.recovery):'';
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
  if(resourceDialog.open)return;
  if(careDemo)return;
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
  if(resourceDialog.open)return;
  if(careDemo)return;
  if(!androidBillingEntry||!scene.canLeave()||testAds?.busy||document.querySelector('dialog[open]'))return;
  renderBillingDialog();$<HTMLDialogElement>('#test-billing-dialog').showModal();syncActivity();$('#test-billing-title').focus();
  await testBilling?.connect();
}
function closeBillingDialog(){
  if(testBilling?.pausesGame)return;
  $<HTMLDialogElement>('#test-billing-dialog').close();syncActivity();$('#test-billing-button').focus();
}
function currentControl(button:HTMLElement,expectedSave:SaveData,generation:number){
  return expectedSave===save&&generation===careGeneration&&button.isConnected&&$('#'+button.id)===button;
}
function careEnvironment(){
  return ['village','journal'].includes(route)&&nativeActive&&!document.hidden&&!boardPending&&!resultTimer
    &&!stagePreview&&!previewDialog.open&&!otherModal()&&!testAds?.pausesGame&&!testBilling?.pausesGame
    &&Boolean(scene?.canLeave())&&game.scene.getScene('Board')===scene;
}
function careStorageBlocked(){
  if(careDemo)return false;
  const status=saveStatus();
  return status.resetPending||status.write==='blocked'||['conflict','corrupt','unsupported','read-error'].includes(status.load);
}
/** 같은 실행의 재화와 효과를 한 payload로 확정합니다. 다른 탭의 비교→쓰기 경쟁은 기존 저장 제한을 따릅니다. */
function commitCare(button:HTMLButtonElement,expectedSave:SaveData,generation:number,prepare:(next:SaveData)=>boolean):boolean {
  if(careProcessing||!currentControl(button,expectedSave,generation)||!careEnvironment())return false;
  if(careStorageBlocked()){notice('careSaveBlocked');updateSaveStatus();return false;}
  careProcessing=true;
  try{
    const next:SaveData=JSON.parse(JSON.stringify(save));
    if(!prepare(next))return false;
    if(!careDemo&&!saveData(next)){updateSaveStatus();notice('careSaveBlocked');return false;}
    save=next;updateWallet();updateSaveStatus();return true;
  }finally{careProcessing=false;}
}
function clearCareReaction(){clearTimeout(careReactionTimer);careReactionTimer=undefined;pipReaction=undefined;careReactionStarted=0;gardenActivity=undefined;journeyMoment=false;}
function reactPip(kind:NonNullable<typeof pipReaction>){
  clearCareReaction();pipReaction=kind;careReactionStarted=Date.now();
  const generation=careGeneration;
  const timer=setTimeout(()=>{if(generation!==careGeneration||careReactionTimer!==timer)return;careReactionTimer=undefined;pipReaction=undefined;careReactionStarted=0;journeyMoment=false;renderViews();},2400);
  careReactionTimer=timer;
}
function enterCareDemo():boolean {
  if(!TEST_TOOLS_ENABLED||careDemo||careProcessing||growing||!careEnvironment())return false;
  const returnRoute=route as 'village'|'journal';
  const demo:SaveData=JSON.parse(JSON.stringify(save));
  careDemo={normalSave:save,returnRoute,chapter:selectedChapter,plot:selectedGardenPlot,area:selectedGardenArea,project:selectedJourneyProject,preset:100};careGeneration++;
  demo.coins=1800;demo.stars=100;demo.garden=0;demo.pip=freshPip();demo.gardenDesign=freshGardenDesign();save=demo;selectedGardenPlot=0;selectedGardenArea='flowers';
  clearCareReaction();scene.cancelInput();renderViews();localize();updateWallet();syncActivity();
  document.querySelector<HTMLButtonElement>('#care-demo-exit-'+returnRoute)?.focus({preventScroll:true});
  return true;
}
function exitCareDemo(navigate=true):boolean {
  if(!careDemo||careProcessing||otherModal()||previewDialog.open)return false;
  const context=careDemo;careDemo=undefined;careGeneration++;
  clearTimeout(growthTimer);growthTimer=undefined;growing=false;clearCareReaction();
  save=context.normalSave;selectedChapter=context.chapter;selectedGardenPlot=context.plot;selectedGardenArea=context.area;selectedJourneyProject=context.project;
  // 저장이나 회차 재생성 없이 원래 언어·오디오 설정만 복원합니다.
  audio.setMusicEnabled(save.music);audio.setSfxEnabled(save.sfx);
  renderViews();localize();updateWallet();updateGoals();updateResultCopy();syncActivity();
  if(navigate){
    switchView(context.returnRoute);
    const target=document.querySelector<HTMLElement>('#care-demo-enter-'+context.returnRoute)
      ??document.querySelector<HTMLElement>('#'+context.returnRoute+'-view h2');
    if(target){if(target.tagName==='H2')target.tabIndex=-1;target.focus({preventScroll:true});}
  }
  return true;
}
function setCareDemoPreset(preset:100|500){
  if(!careDemo||!careEnvironment()||careProcessing||growing||careDemo.preset===preset)return;
  careGeneration++;clearCareReaction();careDemo.preset=preset;
  save={...save,coins:preset===500?8000:1800,stars:preset,garden:0,pip:freshPip(),gardenDesign:freshGardenDesign()};
  selectedGardenArea=preset===500?'journey':'flowers';selectedJourneyProject='conservatory';selectedGardenPlot=0;
  renderViews();updateWallet();syncActivity();$('#care-demo-preset-'+preset+'-'+route).focus({preventScroll:true});
}
function careDemoPanel(view:'village'|'journal'){
  if(!TEST_TOOLS_ENABLED)return '';
  return careDemo?`<aside class="care-demo-banner care-demo-controls"><strong>${text('careDemoActive')}</strong><p>${text('journeyDemoHint').replace('{count}',String(careDemo.preset)).replace('{stars}',String(careDemo.preset)).replace('{coins}',String(careDemo.preset===500?8000:1800))}</p><div class="care-demo-presets">${([100,500] as const).map(preset=>`<button id="care-demo-preset-${preset}-${view}" class="text-button" aria-pressed="${careDemo!.preset===preset}" ${careDemo!.preset===preset?'disabled':''}>${text(preset===100?'journeyDemoEarly':'journeyDemoLate')}</button>`).join('')}</div><button id="care-demo-exit-${view}" class="text-button">${text('careDemoExit')}</button></aside>`
    :`<aside class="care-demo-entry"><p>${text('careDemoInvite')}</p><button id="care-demo-enter-${view}" class="text-button">${text('careDemoEnter')}</button></aside>`;
}
function careIdlePose(){return !pipReaction&&!growing&&(!gardenActivity||gardenActivity.kind==='rest'||gardenActivity.kind==='arch');}
function pipDecoration(view:'village'|'journal'){
  const equipped=(save.pip??freshPip()).equipped;
  if(equipped==='ribbon'&&pipReaction!=='tend')return `<span id="${view}-pip-accessory" class="pip-accessory pip-ribbon" data-pip-accessory="ribbon" aria-hidden="true"><svg class="pip-accessory-fallback" viewBox="0 0 80 36"><path d="M35 16Q8-6 5 9Q-1 31 35 23M45 16Q72-6 75 9Q81 31 45 23" fill="#e7a4b5" stroke="#965e74" stroke-width="3"/><rect x="33" y="13" width="14" height="14" rx="5" fill="#f5c7d2" stroke="#965e74" stroke-width="3"/></svg></span>`;
  if(equipped==='wateringCan'||pipReaction==='tend')return `<span id="${view}-pip-accessory" class="pip-accessory pip-watering-can ${view==='journal'&&pipReaction==='tend'?'pip-tending-can':''}" data-pip-accessory="wateringCan" aria-hidden="true"><svg class="pip-accessory-fallback" viewBox="0 0 76 70"><path d="M48 27Q73 7 68 34Q65 45 51 43M19 33 7 19 1 23 18 47" fill="none" stroke="#527c70" stroke-width="7"/><path d="M16 26Q33 21 51 26L54 59Q35 66 14 59Z" fill="#91b8a0" stroke="#456b5b" stroke-width="3"/><path d="M25 25V16Q34 11 43 16V25" fill="none" stroke="#456b5b" stroke-width="4"/><path d="M26 40h17m-8-8v17" stroke="#f6e6ad" stroke-width="4" stroke-linecap="round"/></svg></span>`;
  return '';
}
function journalPipDecoration(){
  if(pipReaction!=='tend')return pipDecoration('journal');
  const elapsed=Math.max(0,Math.min(2400,Date.now()-careReactionStarted));
  return `<span id="journal-pip-tend-stage" class="pip-tending-stage" style="--tend-elapsed:${elapsed}ms">${pipDecoration('journal')}${pipTendingArt(elapsed)}</span>`;
}
const projectName=(id:GardenProject)=>text(({bench:'gardenBench',butterflies:'gardenButterflies',lantern:'gardenLantern'} as const)[id]);
const themeName=(id:GardenTheme)=>text(({meadow:'gardenThemeMeadow',sunset:'gardenThemeSunset',starlight:'gardenThemeStarlight'} as const)[id]);
// 체험은 해금 조건만 미리 봅니다. 실제 완료 목록과 회차는 변경하지 않습니다.
function gardenCompletedCount(data:SaveData=save){return careDemo?careDemo.preset:new Set(data.completed.filter(id=>Number.isInteger(id)&&id>=1&&id<=LEVEL_COUNT)).size;}
function albumCompleted(){return (careDemo?.normalSave??save).completed;}
const flowerName=(id:typeof flowerStyles[number])=>text(({meadow:'gardenMeadow',daisy:'gardenDaisy',violet:'gardenViolet'} as const)[id]);
const gardenPlotPoints=[[158,153],[285,141],[413,153],[218,222],[351,222]];
function gardenVisitor(){
  const activity=gardenActivity,plot=gardenPlotPoints[activity?.plot??0];
  const position=activity?activity.kind==='flower'?`left:${(plot[0]-130)/4.8}%;bottom:${(280-plot[1]-32)/2.8}%;`:activity.kind==='rest'?'left:35%;bottom:3%;':activity.kind==='arch'?'left:58%;bottom:2%;':`left:${activity.kind==='lily'?25:65}%;bottom:3%;`:'';
  const image=activity?.kind==='rest'?'/assets/pip-idle-blink-v2.webp':pipReaction==='greet'?'/assets/pip-play-v1.webp':careIdlePose()?'/assets/pip-idle-open-v2.webp':'/assets/pip.png';
  return `<div data-area="${selectedGardenArea}" data-activity="${activity?.kind??'none'}" class="garden-visitor ${pipReaction==='greet'?'pip-reaction-greet':''}${activity?' garden-activity-visitor':''}"${position?` style="${position}"`:''}><span id="village-pip-actor" class="care-pip-visual"><span class="pip-face"><img id="village-pip-image" src="${image}" alt="${text('pip')}"/></span></span>${pipDecoration('village')}</div>`;
}
function gardenActivitySpots(mode:'art'|'controls'|'both'='both'){
  const flower=selectedGardenArea==='flowers'&&save.garden>0,spaces=gardenSpacesFor(save.gardenDesign?.spaces);
  const pond=selectedGardenArea==='pond'&&spaces.pond.phase===2,rest=selectedGardenArea==='shelter'&&spaces.shelter.phase===2,arch=selectedGardenArea==='arch'&&spaces.arch.phase===2;
  if(!flower&&!pond&&!rest&&!arch)return '';
  const plot=Math.min(selectedGardenPlot,save.garden-1);
  const kinds=flower?['flower'] as const:rest?['rest'] as const:arch?['arch'] as const:['lily','ripples'] as const;
  const buttons=kinds.map(kind=>{
    const label=text(kind==='flower'?'gardenLookFlower':kind==='lily'?'gardenLookLily':kind==='rest'?'gardenRest':kind==='arch'?'gardenArchWalk':'gardenLookRipples').replace('{number}',String(plot+1));
    const short=text(({flower:'gardenLookShort',lily:'gardenLilyShort',ripples:'gardenRippleShort',rest:'gardenRestShort',arch:'gardenArchShort'} as const)[kind]);
    return `<button type="button" id="garden-activity-${kind}" class="garden-activity-spot" aria-label="${short} · ${label}" aria-pressed="${gardenActivity?.kind===kind}">${kind==='ripples'?'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8q3-4 6 0t6 0t6 0M3 16q3-4 6 0t6 0t6 0" fill="none" stroke="currentColor" stroke-width="2"/></svg>':icon(kind==='rest'?'paw':'flower',20)}<span aria-hidden="true">${short}<small>${text('gardenMomentFree')}</small></span></button>`;
  }).join('');
  const active=gardenActivity,point=active?.kind==='flower'?[gardenPlotPoints[active.plot][0],gardenPlotPoints[active.plot][1]-20]:active?.kind==='lily'?[235,185]:active?.kind==='rest'?[295,210]:active?.kind==='arch'?[300,235]:[355,193];
  const mark=!active?'':`<svg class="garden-activity-art" viewBox="0 0 480 280" aria-hidden="true"><g class="garden-activity-sheen" style="transform-origin:${point[0]}px ${point[1]}px" fill="none" stroke="${active.kind==='ripples'?'#effffc':'#fff2a7'}" stroke-width="4"><ellipse cx="${point[0]}" cy="${point[1]}" rx="${active.kind==='flower'?57:30}" ry="${active.kind==='flower'?26:active.kind==='ripples'?8:13}"/>${active.kind==='ripples'?`<ellipse cx="${point[0]}" cy="${point[1]}" rx="48" ry="13"/>`:`<path d="m${point[0]-28} ${point[1]-32} 0-12m-6 6h12m42 10v-12m-6 6h12"/>`}</g></svg>`;
  const moment=active?.kind==='rest'?'<span class="garden-rest-note" aria-hidden="true">♪</span>':active?.kind==='arch'?'<svg class="garden-arch-petals" viewBox="0 0 480 280" aria-hidden="true"><g fill="#ecc5af"><path d="M240 118q-10-12-13 0q4 12 13 0Z"/><path d="M305 108q-10-12-13 0q4 12 13 0Z"/><path d="M351 147q-10-12-13 0q4 12 13 0Z"/></g></svg>':'';
  return `${mode==='controls'?'':mark+moment}${mode==='art'?'':`<div class="garden-activity-spots" role="group" aria-label="${text('gardenActivities')}">${buttons}</div>`}`;
}
const lanternLocation=(plot:number|undefined)=>plot===undefined?text('gardenLanternDefault'):text('gardenLanternAt').replace('{number}',String(plot+1));
function gardenDescription(){const design=gardenDesignFor(save.gardenDesign);if(selectedGardenArea==='journey')return journeyName(save.language,selectedJourneyProject)+' · '+journeyPhase(save.language,journeyProjectFor(design.journeyProjects,selectedJourneyProject));if(selectedGardenArea!=='flowers'){const state=gardenSpacesFor(design.spaces)[selectedGardenArea];return [gardenAreaName(save.language,selectedGardenArea),spacePhaseName(save.language,state),...(state.phase===2?[spaceStyleName(save.language,selectedGardenArea,state)]:[]),themeName(design.theme??'meadow')].join(' · ');}return [text('gardenImage').replace('{count}',String(save.garden)),themeName(design.theme??'meadow'),...design.flowers.slice(0,save.garden).map((flower,i)=>text('gardenPlot').replace('{number}',String(i+1))+' '+flowerName(flower)),...design.placed.map(project=>projectName(project)+(project==='lantern'?' · '+lanternLocation(design.lanternPlot):''))].join(' · ');}
function lanternPlacement(){
  const design=gardenDesignFor(save.gardenDesign);if(!design.owned.includes('lantern'))return '';
  const shown=design.placed.includes('lantern');
  return `<div class="garden-lantern-placement"><p id="garden-lantern-position" role="status">${text('gardenLantern')} · ${lanternLocation(design.lanternPlot)} · ${text(shown?'gardenLanternShown':'gardenLanternHidden')}</p><button id="garden-lantern-place" type="button" class="text-button" aria-describedby="garden-lantern-position" ${careStorageBlocked()||selectedGardenPlot>=save.garden||design.lanternPlot===selectedGardenPlot&&shown?'disabled':''}>${text('gardenLanternMove').replace('{number}',String(selectedGardenPlot+1))}</button></div>`;
}
function projectConditions(project:typeof gardenProjects[number]){
  const pip=save.pip??freshPip(),design=gardenDesignFor(save.gardenDesign);
  return text('gardenConditions').replace('{plots}',String(save.garden)).replace('{needPlots}',String(project.plots)).replace('{growth}',String(pip.growth)).replace('{needGrowth}',String(project.growth)).replace('{affection}',String(pip.affection)).replace('{needAffection}',String(project.affection)).replace('{types}',String(flowerDiversity(design,save.garden))).replace('{needTypes}',String(project.diversity));
}
function themeConditions(theme:typeof gardenThemes[number]){
  const pip=save.pip??freshPip();
  return text('gardenThemeConditions').replace('{clears}',String(gardenCompletedCount())).replace('{needClears}',String(theme.clears)).replace('{plots}',String(save.garden)).replace('{needPlots}',String(theme.plots)).replace('{growth}',String(pip.growth)).replace('{needGrowth}',String(theme.growth)).replace('{affection}',String(pip.affection)).replace('{needAffection}',String(theme.affection));
}
function gardenThemePanel(){
  const design=gardenDesignFor(save.gardenDesign),selected=design.theme??'meadow',blocked=careStorageBlocked();
  return `<section class="garden-themes" aria-labelledby="garden-themes-title"><h4 id="garden-themes-title">${text('gardenThemes')}</h4>${(['meadow',...gardenThemes.map(t=>t.id)] as GardenTheme[]).map(id=>{
    const theme=gardenThemes.find(t=>t.id===id),owned=id==='meadow'||design.ownedThemes?.includes(id),ready=!theme||themeReady(theme,save.garden,save.pip??freshPip(),gardenCompletedCount());
    const label=selected===id?text('gardenThemeSelected'):owned?text('gardenThemeSelect'):text('gardenBuy').replace('{cost}',String(theme!.cost));
    return `<article class="garden-project"><div><strong>${themeName(id)}</strong><p>${owned?text('gardenThemeOwned'):themeConditions(theme!)}</p></div><button id="garden-theme-${id}" type="button" aria-label="${themeName(id)} · ${label}" aria-pressed="${selected===id}" ${blocked||selected===id||!owned&&(!ready||save.coins<theme!.cost)?'disabled':''}>${label}</button></article>`;
  }).join('')}</section>`;
}
function nextGardenProject(){
  return `${journeyNextCard(save.language,save.gardenDesign?.journeyProjects,gardenCompletedCount(),'journal')}<details class="pip-project"><summary>${text('gardenTogether')}</summary>${nextSpaceGoal(save.language,save.gardenDesign?.spaces,gardenCompletedCount(),save.stars)}<button id="pip-open-space" class="text-button">${text('spaceOpen')}</button><button id="pip-open-garden" class="text-button">${text('gardenOpenEditor')}</button></details>`;
}
function sharedGardenPlan(view:'village'|'journal'){
  const goals=gardenGoals({plots:save.garden,pip:save.pip??freshPip(),design:save.gardenDesign,clears:gardenCompletedCount(),stars:save.stars,coins:save.coins});
  const next=nextGardenGoal(goals),done=goals.filter(goal=>goal.done).length;
  const achievements=[...(goals.filter(g=>g.kind==='project').every(g=>g.done)?[text('gardenProjectsDone')]:[]),...(goals.filter(g=>g.kind==='theme').every(g=>g.done)?[text('gardenThemesDone')]:[])];
  const name=(goal:GardenGoal)=>goal.kind==='bed'?text('goalBed').replace('{number}',goal.name):goal.kind==='project'?projectName(goal.name as GardenProject):goal.kind==='theme'?themeName(goal.name as GardenTheme):(goal.kind==='journey'?journeyName(save.language,goal.project!):gardenAreaName(save.language,goal.area as GardenArea))+' · '+text(goal.name==='1'?'spaceFoundation':'spaceComplete');
  const needName=(kind:GoalNeed)=>text(({plots:'goalPlots',growth:'pipGrowth',affection:'pipAffection',diversity:'goalDiversity',clears:'goalClears',stars:'stars',coins:'coins',foundation:'spaceFoundation'} as const)[kind]);
  const detail=(goal:GardenGoal)=>{
    const step=goalNextStep(goal);if(!step)return text('goalDone');
    if(step.unavailableIncome)return text('goalNoIncome');
    const missing=step.missing;
    return !missing?text('goalReady'):missing.kind==='foundation'?text('goalFoundationFirst'):text('goalNeed').replace('{condition}',needName(missing.kind)).replace('{count}',String(missing.required-missing.current));
  };
  const button=(goal:GardenGoal)=>{
    const destination=goalNextStep(goal)?.destination;
    const label=text(destination==='map'?'goalPlay':destination==='pip'?'goalCare':destination==='flowers'?'goalEdit':'goalSpace');
    return `<button type="button" class="text-button" id="${view}-goal-${goal.id}" aria-label="${name(goal)} · ${label}">${label}${icon('arrow',16)}</button>`;
  };
  return `<section class="garden-plan" aria-labelledby="${view}-plan-title"><div class="garden-plan-heading"><h3 id="${view}-plan-title">${text('goalPlan')}</h3><span>${done} / ${goals.length}</span></div>${achievements.map(message=>`<p class="garden-plan-achievement">${message}</p>`).join('')}<progress aria-label="${text('goalPlan')}" value="${done}" max="${goals.length}"></progress>${next?`<div class="garden-plan-next"><small>${text('gardenNext')}</small><strong>${name(next)}</strong><p>${detail(next)}</p>${button(next)}</div>`:`<p>${text('goalAllDone')}</p>`}<details><summary>${text('goalAllPlans')}</summary><ol>${goals.map(goal=>`<li class="${goal.done?'done':''}"><span aria-hidden="true">${goal.done?'✓':'○'}</span><div><strong>${name(goal)}</strong>${goal.done?`<small>${text('goalDone')}</small>`:`<p>${detail(goal)}</p>${goal.id===next?.id?'':button(goal)}`}</div></li>`).join('')}</ol></details><p class="garden-plan-note">${text('goalNoAutoSpend')}</p></section>`;
}
function gardenVisitControls(){
  if(selectedGardenArea==='journey')return '';
  const design=gardenDesignFor(save.gardenDesign),pip=save.pip??freshPip();
  const phase=selectedGardenArea==='flowers'?undefined:gardenSpacesFor(design.spaces)[selectedGardenArea].phase;
  const reaction:TextKey=pipReaction==='tend'?'pipTendReaction':selectedGardenArea!=='flowers'?(phase===0?'spaceVisitEmpty':phase===1?'spaceVisitBuilding':({pond:'spaceVisitPond',shelter:'spaceVisitShelter',arch:'spaceVisitArch'} as const)[selectedGardenArea]):pipReaction==='greet'?design.placed.includes('lantern')?'gardenVisitLantern':design.placed.includes('butterflies')?'gardenVisitButterflies':design.placed.includes('bench')?'gardenVisitBench':'pipGreetReaction':'gardenVisitInvite';
  const activityLine=gardenActivity?text(gardenActivity.kind==='flower'?'gardenFlowerMoment':gardenActivity.kind==='lily'?'gardenLilyMoment':gardenActivity.kind==='rest'?'gardenRestMoment':gardenActivity.kind==='arch'?'gardenArchMoment':'gardenRippleMoment').replace('{flower}',flowerName(design.flowers[gardenActivity.plot])).replace('{number}',String(gardenActivity.plot+1)):text(reaction);
  return `<div class="garden-companion"><div><p class="garden-visit-line" role="status">${activityLine}</p><div class="garden-visit-actions"><button id="garden-visit" class="text-button">${text('gardenVisit')}</button><button id="garden-tend" class="text-button" ${pipLevel(pip)<3?'disabled':''}>${text('pipTend')}</button></div></div></div>`;
}
function gardenEditor(){
  const design=gardenDesignFor(save.gardenDesign),pip=save.pip??freshPip(),blocked=careStorageBlocked();
  selectedGardenPlot=Math.max(0,Math.min(selectedGardenPlot,Math.max(0,save.garden-1)));
  return `${gardenVisitControls()}<section class="garden-editor" aria-labelledby="garden-edit-title"><h3 id="garden-edit-title" tabindex="-1">${text('gardenEdit')}</h3><div class="garden-plots" role="group" aria-label="${text('gardenChoosePlot')}">${Array.from({length:5},(_,i)=>`<button id="garden-plot-${i}" type="button" aria-pressed="${i===selectedGardenPlot&&i<save.garden}" aria-label="${text('gardenPlot').replace('{number}',String(i+1))} · ${i<save.garden?flowerName(design.flowers[i]):text('levelLocked')}" ${i>=save.garden?'disabled':''}>${i<save.garden?flowerArt(design.flowers[i]):icon('lock',18)}<span>${i+1}</span></button>`).join('')}</div><p class="garden-selection" role="status">${save.garden?text('gardenPlot').replace('{number}',String(selectedGardenPlot+1))+' · '+flowerName(design.flowers[selectedGardenPlot])+' · '+text('gardenFreeChange'):text('gardenFirstPlot')}</p><div class="garden-flowers" role="group" aria-label="${text('gardenChooseFlower')}">${flowerStyles.map(style=>`<button id="garden-flower-${style}" type="button" aria-pressed="${save.garden>0&&design.flowers[selectedGardenPlot]===style}" ${blocked||save.garden===0?'disabled':''}>${flowerArt(style)}<span>${flowerName(style)}</span></button>`).join('')}</div><button id="garden-look-open" class="text-button" type="button">${text('lookOpen')}</button>${lanternPlacement()}<h4>${text('gardenTogether')}</h4><div class="garden-projects">${gardenProjects.map(project=>{
    const owned=design.owned.includes(project.id),placed=design.placed.includes(project.id),ready=projectReady(project,save.garden,pip,design);
    return `<article class="garden-project"><div><strong>${projectName(project.id)}</strong><p>${owned?text('gardenOwned'):projectConditions(project)}</p></div><button id="garden-project-${project.id}" type="button" ${owned?`aria-pressed="${placed}"`:''} ${blocked||!owned&&(!ready||save.coins<project.cost)?'disabled':''}>${owned?text(placed?'gardenHide':'gardenPlace'):project.cost?text('gardenBuy').replace('{cost}',String(project.cost)):text('gardenClaim')}</button></article>`;
  }).join('')}</div>${gardenThemePanel()}${blocked?`<p class="pip-save-note" role="status">${text('careSaveBlocked')}</p>`:''}</section>`;
}
function pipCareCard(){
  const pip=save.pip??freshPip(),level=pipLevel(pip),cost=careCost(pip),blocked=careStorageBlocked();
  const next=level===1?20:level===2?60:100;
  const image=pipReaction==='feed'?'/assets/pip-feed-v1.webp':pipReaction==='play'?'/assets/pip-play-v1.webp':careIdlePose()?'/assets/pip-idle-open-v2.webp':'/assets/pip.png';
  const reactionKey:TextKey=pipReaction==='feed'?'pipFeedReaction':pipReaction==='play'?'pipPlayReaction':pipReaction==='greet'?'pipGreetReaction':pipReaction==='tend'?'pipTendReaction':level===3?'pipLevel3Line':level===2?'pipLevel2Line':'pipLevel1Line';
  const effect=(kind:'feed'|'play')=>{
    const growth=Math.min(100-pip.growth,kind==='feed'?10:4),affection=Math.min(100-pip.affection,kind==='feed'?4:10);
    return [growth>0?`${text('pipGrowth')} +${growth}`:'',affection>0?`${text('pipAffection')} +${affection}`:''].filter(Boolean).join(' · ')||text(kind==='feed'?'pipFeedFreeReaction':'pipPlayFreeReaction');
  };
  const price=cost?`${icon('coin',15)} ${cost}`:text('pipFreeCare');
  const decoration=(item:'ribbon'|'wateringCan',required:number,price:number)=>{
    const owned=pip.owned.includes(item),equipped=pip.equipped===item,name=text(item==='ribbon'?'pipRibbon':'pipWateringCan');
    const action=equipped?text('pipEquipped'):owned?text('pipEquipFree'):text('gardenBuy').replace('{cost}',String(price));
    return `<div class="pip-shop-item"><div><strong>${name}</strong><small>${owned?text('pipOwned'):text('pipUnlockAt').replace('{level}',String(required))}</small></div><button id="pip-${owned?'equip':'buy'}-${item}" class="text-button" aria-label="${name} · ${action}" ${blocked||equipped||(!owned&&(level<required||save.coins<price))?'disabled':''}>${equipped?text('pipEquipped'):owned?text('pipEquipFree'):`${icon('coin',15)} ${price}`}</button></div>`;
  };
  return `<section class="journal-card pip-care-card" aria-labelledby="pip-care-title"><div class="pip-care-hero"><div id="journal-pip-portrait" class="pip-portrait ${pipReaction?'pip-reaction-'+pipReaction:''}"><span id="journal-pip-actor" class="care-pip-visual"><span class="pip-face"><img id="journal-pip-image" src="${image}" alt="${text(pipReaction==='feed'?'pipFeedAlt':pipReaction==='play'?'pipPlayAlt':'pip')}"/></span></span>${journalPipDecoration()}</div><div class="pip-summary"><h3 id="pip-care-title" tabindex="-1"><span class="pip-name">${text('pip')}</span><span class="pip-level">Lv. ${level}</span></h3><p class="pip-reaction-line" role="status" aria-live="polite">${text(reactionKey)}</p><div class="pip-stats"><label>${text('pipGrowth')} <strong>${pip.growth} / 100</strong><progress max="100" value="${pip.growth}"></progress></label><label>${text('pipAffection')} <strong>${pip.affection} / 100</strong><progress max="100" value="${pip.affection}"></progress></label></div></div></div><p class="pip-next">${text(level<3?'pipNextUnlock':'pipAllUnlocked').replace('{count}',String(Math.max(0,next-pip.growth))).replace('{reward}',text(level===1?'pipLevel2Unlock':'pipLevel3Unlock'))}</p>${nextGardenProject()}<div class="pip-care-actions"><button id="pip-feed" class="primary" ${blocked||save.coins<cost?'disabled':''}><span>${text('pipFeed')} · ${price}</span><small>${effect('feed')}</small></button><button id="pip-play" class="primary" ${blocked||save.coins<cost?'disabled':''}><span>${text('pipPlay')} · ${price}</span><small>${effect('play')}</small></button></div><p class="pip-purpose">${text('pipPurpose')}</p><p class="pip-care-note">${text('pipNoDecay')}</p><div class="pip-reactions"><button id="pip-greet" class="text-button" ${level<2?'disabled':''}>${text('pipGreet')}</button><button id="pip-tend" class="text-button" ${level<3?'disabled':''}>${text('pipTend')}</button></div><h4>${text('pipDecorate')}</h4><p class="pip-shop-note">${text('pipShopHint')}</p>${decoration('ribbon',2,40)}${decoration('wateringCan',3,80)}<button id="pip-equip-none" class="text-button" ${blocked||pip.equipped==='none'?'disabled':''}>${text('pipUnequip')}</button>${blocked?`<p class="pip-save-note" role="status">${text('careSaveBlocked')}</p>`:''}</section>`;
}
// 상점까지 내리거나 화면을 회전한 뒤에도 반응 그림과 돌보기 버튼을 함께 보여 줍니다.
function revealPipCare(){
  if(route!=='journal')return;
  const view=$('#journal-view'),hero=view.querySelector<HTMLElement>('.pip-care-hero'),actions=view.querySelector<HTMLElement>('.pip-care-actions');
  if(!hero||!actions)return;
  const bounds=view.getBoundingClientRect(),top=hero.getBoundingClientRect().top,bottom=actions.getBoundingClientRect().bottom;
  if(top<bounds.top||bottom>bounds.bottom){
    view.scrollTop=Math.max(0,view.scrollTop+top-bounds.top);
    const active=document.activeElement;
    if(active&&view.contains(active)&&!hero.contains(active)&&!actions.contains(active))$('#pip-care-title').focus({preventScroll:true});
  }
}
function bindCareControls(){
  const expectedSave=save,generation=careGeneration;
  const bind=(id:string,handler:(button:HTMLButtonElement)=>void)=>{const button=document.querySelector<HTMLButtonElement>('#'+id);if(button)button.onclick=()=>{if(currentControl(button,expectedSave,generation))handler(button);};};
  bind('garden-look-open',button=>showLookPreview(button));
  const albumSelect=document.querySelector<HTMLSelectElement>('#album-world-select');
  if(albumSelect)albumSelect.onchange=()=>{
    if(!currentControl(albumSelect,expectedSave,generation)||route!=='journal'||!careEnvironment()||careProcessing||growing)return;
    const index=parseAlbumIndex(albumSelect.value);if(index===undefined)return;
    selectedAlbumWorld=index;renderViews();$('#album-world-select').focus({preventScroll:true});
  };
  bind('album-open-map',()=>{
    if(route!=='journal'||careDemo||!careEnvironment()||careProcessing||growing)return;
    const world=albumSelection(albumCompleted(),selectedAlbumWorld);switchView('map');if((route as string)!=='map')return;
    selectedChapter=world.chapter;$<HTMLSelectElement>('#map-chapter-select').value=String(world.chapter);
    document.querySelector(`#map-chapter-${world.chapter}`)?.scrollIntoView?.({block:'start',behavior:'auto'});
    mapScrollOffset=$('#campaign-scroll').scrollTop;
    const title=$('#map-chapter-title-'+world.chapter);title.tabIndex=-1;title.focus({preventScroll:true});syncMusicTheme();
  });
  const selectArea=(area:GardenArea)=>{
    if(route!=='village'||!careEnvironment()||careProcessing||growing)return;
    selectedGardenArea=area;clearCareReaction();renderViews();$('#garden-area-'+area).focus({preventScroll:true});
  };
  for(const [index,area] of gardenAreas.entries()){
    bind('garden-area-'+area,()=>selectArea(area));
    const tab=document.querySelector<HTMLButtonElement>('#garden-area-'+area);if(!tab)continue;
    tab.onkeydown=event=>{
      if(!currentControl(tab,expectedSave,generation)||!careEnvironment()||event.altKey||event.ctrlKey||event.metaKey)return;
      const next=event.key==='Home'?0:event.key==='End'?gardenAreas.length-1:event.key==='ArrowRight'?(index+1)%gardenAreas.length:event.key==='ArrowLeft'?(index+gardenAreas.length-1)%gardenAreas.length:undefined;
      if(next===undefined)return;event.preventDefault();selectArea(gardenAreas[next]);
    };
  }
  const area=selectedGardenArea;
  const plans=gardenGoals({plots:save.garden,pip:save.pip??freshPip(),design:save.gardenDesign,clears:gardenCompletedCount(),stars:save.stars,coins:save.coins});
  for(const view of ['village','journal'] as const)for(const goal of plans)bind(`${view}-goal-${goal.id}`,()=>{
    if(route!==view||!careEnvironment()||careProcessing||growing)return;
    const step=goalNextStep(goal);if(!step)return;
    clearCareReaction();
    if(step.destination==='map'){switchView('map');$('#map-play').focus({preventScroll:true});return;}
    if(step.destination==='pip'){
      switchView('journal');const target=$<HTMLButtonElement>(step.missing?.kind==='affection'?'#pip-play':'#pip-feed');
      const focus=target.disabled?$('#pip-care-title'):target;focus.focus({preventScroll:true});focus.scrollIntoView?.({block:'center'});return;
    }
    selectedGardenArea=step.destination;if(step.destination==='journey'&&goal.project)selectedJourneyProject=goal.project;
    switchView('village');renderViews();
    const id=step.destination!=='flowers'?'garden-space-title':step.missing?.kind==='diversity'?'garden-edit-title':goal.kind==='bed'?'garden-stage':'garden-edit-title';
    const target=$('#'+id);target.focus({preventScroll:true});target.scrollIntoView?.({block:'start'});
  });
  if(area==='journey'){
    const select=document.querySelector<HTMLSelectElement>('#journey-project-select');
    if(select)select.onchange=()=>{if(!currentControl(select,expectedSave,generation)||!careEnvironment()||route!=='village'||selectedGardenArea!=='journey'||careProcessing||growing)return;const project=journeyProjectSpecs.find(spec=>spec.id===select.value)?.id;if(!project)return;selectedJourneyProject=project;clearCareReaction();renderViews();$('#journey-project-select').focus({preventScroll:true});};
    const project=selectedJourneyProject;
    bind('journey-restore',button=>showSpacePreview({kind:'restore',project},button));
    for(const style of ['base','alt'] as const)bind('journey-style-'+style,button=>showSpacePreview({kind:'style',project,style},button));
    bind('journey-visit',()=>{if(route!=='village'||selectedGardenArea!=='journey'||selectedJourneyProject!==project||!careEnvironment()||careProcessing||journeyProjectFor(save.gardenDesign?.journeyProjects,project).phase!==2)return;reactPip('greet');journeyMoment=true;renderViews();});
  }else if(area!=='flowers'){
    bind('garden-space-restore',button=>showSpacePreview({kind:'restore',space:area},button));
    for(const style of ['base','alt'] as const)bind('garden-space-'+style,button=>showSpacePreview({kind:'style',space:area,style},button));
  }
  for(const view of ['village','journal'] as const){
    if(TEST_TOOLS_ENABLED){for(const preset of [100,500] as const)bind('care-demo-preset-'+preset+'-'+view,()=>{if(route===view)setCareDemoPreset(preset);});bind('care-demo-enter-'+view,()=>{if(route===view)enterCareDemo();});bind('care-demo-exit-'+view,()=>{if(route===view)exitCareDemo();});}
  }
  const actions:[string,PipAction][]=[['feed','feed'],['play','play'],['buy-ribbon','buyRibbon'],['buy-wateringCan','buyWateringCan'],['equip-ribbon','equipRibbon'],['equip-wateringCan','equipWateringCan'],['equip-none','equipNone']];
  for(const [id,action] of actions)bind('pip-'+id,button=>{
    if(route!=='journal')return;
    if(commitCare(button,expectedSave,generation,next=>{const result=preparePipAction(next.coins,next.pip??freshPip(),action);if(!result)return false;next.coins=result.coins;next.pip=result.pip;return true;})){
      if(action==='feed'||action==='play')reactPip(action);else clearCareReaction();
      audio.play('reward');renderViews();revealPipCare();
    }
  });
  for(const kind of ['greet','tend'] as const)bind('pip-'+kind,()=>{if(route==='journal'&&careEnvironment()&&pipLevel(save.pip??freshPip())>=(kind==='greet'?2:3)){reactPip(kind);renderViews();revealPipCare();}});
  for(const view of ['village','journal'] as const)bind(view+'-open-journey',()=>{if(route!==view||!careEnvironment()||careProcessing||growing)return;clearCareReaction();selectedGardenArea='journey';selectedJourneyProject=nextJourneyProject(save.gardenDesign?.journeyProjects)?.id??selectedJourneyProject;switchView('village');renderViews();$('#garden-space-title').focus({preventScroll:true});$('#garden-space-title').scrollIntoView?.({block:'start'});});
  bind('pip-open-garden',()=>{if(route!=='journal'||!careEnvironment()||careProcessing)return;selectedGardenArea='flowers';switchView('village');const title=$('#garden-edit-title');title.focus({preventScroll:true});title.scrollIntoView?.({block:'start'});});
  bind('pip-open-space',()=>{
    if(route!=='journal'||!careEnvironment()||careProcessing)return;
    const spaces=gardenSpacesFor(save.gardenDesign?.spaces);selectedGardenArea=gardenSpaceSpecs.find(spec=>spaces[spec.id].phase<2)?.id??'arch';
    switchView('village');$('#garden-space-title').focus({preventScroll:true});$('#garden-space-title').scrollIntoView?.({block:'start'});
  });
  bind('garden-open-space',()=>{
    if(route!=='village'||selectedGardenArea!=='flowers'||!careEnvironment()||careProcessing||growing)return;
    const spaces=gardenSpacesFor(save.gardenDesign?.spaces);
    clearCareReaction();selectedGardenArea=gardenSpaceSpecs.find(spec=>spaces[spec.id].phase<2)?.id??'arch';
    renderViews();$('#village-view').scrollTop=0;$('#garden-area-'+selectedGardenArea).focus({preventScroll:true});
  });
  for(let plot=0;plot<5;plot++)bind('garden-plot-'+plot,()=>{if(route!=='village'||selectedGardenArea!=='flowers'||!careEnvironment()||careProcessing||plot>=save.garden)return;selectedGardenPlot=plot;clearCareReaction();renderViews();});
  const changeGarden=(button:HTMLButtonElement,action:GardenAction)=>{
    if(route!=='village'||selectedGardenArea!=='flowers'||growing)return;
    if(commitCare(button,expectedSave,generation,next=>{const result=prepareGardenAction(next.coins,next.garden,next.pip??freshPip(),next.gardenDesign,action,gardenCompletedCount(next));if(!result)return false;next.coins=result.coins;next.gardenDesign=result.design;return true;})){
      reactPip('greet');renderViews();
    }
  };
  const plot=selectedGardenPlot;
  bind('garden-theme-meadow',button=>changeGarden(button,{kind:'selectTheme',theme:'meadow'}));
  for(const theme of gardenThemes){const owned=save.gardenDesign?.ownedThemes?.includes(theme.id);bind('garden-theme-'+theme.id,button=>changeGarden(button,{kind:owned?'selectTheme':'buyTheme',theme:theme.id}));}
  bind('garden-lantern-place',button=>changeGarden(button,{kind:'placeLantern',plot}));
  for(const flower of flowerStyles)bind('garden-flower-'+flower,button=>changeGarden(button,{kind:'flower',plot,flower}));
  for(const project of gardenProjects){const owned=save.gardenDesign?.owned.includes(project.id);bind('garden-project-'+project.id,button=>changeGarden(button,{kind:owned?'toggle':'claim',project:project.id}));}
  for(const kind of ['flower','lily','ripples','rest','arch'] as const)bind('garden-activity-'+kind,()=>{
    const area=kind==='rest'?'shelter':kind==='arch'?'arch':'pond';
    const available=kind==='flower'?selectedGardenArea==='flowers'&&save.garden>0:selectedGardenArea===area&&gardenSpacesFor(save.gardenDesign?.spaces)[area].phase===2;
    if(route!=='village'||!careEnvironment()||careProcessing||growing||!available||gardenActivity?.kind===kind)return;
    clearCareReaction();gardenActivity={kind,plot:Math.max(0,Math.min(selectedGardenPlot,save.garden-1))};renderViews();
  });
  bind('garden-visit',()=>{if(route==='village'&&careEnvironment()&&!careProcessing){reactPip('greet');renderViews();}});
  bind('garden-tend',()=>{if(route==='village'&&careEnvironment()&&!careProcessing&&pipLevel(save.pip??freshPip())>=3){reactPip('tend');renderViews();}});
  bind('grow',button=>{
    if(route!=='village'||selectedGardenArea!=='flowers'||growing)return;
    if(!commitCare(button,expectedSave,generation,next=>{if(next.stars<2||next.garden>=5)return false;next.stars-=2;next.garden++;return true;}))return;
    growing=true;audio.play('reward');renderViews(true);notice('planted');
    const timer=setTimeout(()=>{
      if(generation!==careGeneration||growthTimer!==timer)return;
      growthTimer=undefined;growing=false;
      document.querySelector<HTMLButtonElement>('#grow')?.toggleAttribute('disabled',careStorageBlocked()||save.stars<2||save.garden>=5);
      syncCarePipActivity();
    },450);
    growthTimer=timer;
  });
}
function gardenWorkshop(grew:boolean){
  if(selectedGardenArea==='journey')return `<section class="garden-workshop">${gardenAreaTabs(save.language,'journey')}<div id="garden-area-panel" role="tabpanel" aria-labelledby="garden-area-journey">${journeyGardenPanel(save.language,selectedJourneyProject,save.gardenDesign?.journeyProjects,gardenCompletedCount(),save.stars,journeyMoment)}</div></section>`;
  const flowers=selectedGardenArea==='flowers',spaces=gardenSpacesFor(save.gardenDesign?.spaces);
  const space=selectedGardenArea as Exclude<GardenArea,'flowers'|'journey'>;
  const image=flowers?gardenArt(save.garden,grew,save.gardenDesign,{renderer:'painted-v4'}):gardenSpaceArt(space,spaces[space],save.gardenDesign?.theme??'meadow','garden-space','painted-v4',{foreground:false});
  const progress=flowers?`${icon('flower',17)} ${save.garden} / 5`:spacePhaseName(save.language,spaces[selectedGardenArea as Exclude<GardenArea,'flowers'|'journey'>]);
  return `<section class="garden-workshop">${gardenAreaTabs(save.language,selectedGardenArea)}<div id="garden-area-panel" role="tabpanel" aria-labelledby="garden-area-${selectedGardenArea}"><div id="garden-nature" class="garden-picture garden-preview"><div class="garden-illustration" role="img" aria-label="${gardenDescription()}">${image}</div>${gardenVisitor()}${gardenActivitySpots('art')}${flowers?'':paintedGardenForeground(space,spaces[space])}<span class="garden-pill">${progress}</span></div>${gardenActivitySpots('controls')}${journeyNextCard(save.language,save.gardenDesign?.journeyProjects,gardenCompletedCount(),'village')}${sharedGardenPlan('village')}${flowers?`<div class="garden-card garden-growth"><h3>${text('garden')}</h3><p class="garden-stage" id="garden-stage" role="status" tabindex="-1">${text(`gardenStage${save.garden}` as TextKey)}</p><p>${text('gardenDesc')}</p><button class="primary" id="grow" ${growing||save.stars<2||save.garden>=5?'disabled':''}>${icon('leaf',20)}${text(save.garden>=5?'gardenDone':'grow')}</button>${save.stars<2&&save.garden<5?`<small>${text('needStars')}</small>`:''}</div>${save.garden===5?`<section class="pip-project garden-next-space">${nextSpaceGoal(save.language,save.gardenDesign?.spaces,gardenCompletedCount(),save.stars)}<button id="garden-open-space" class="text-button">${text('spaceOpen')}</button></section>`:''}${gardenEditor()}`:`${gardenVisitControls()}${gardenSpacePanel(save.language,selectedGardenArea as Exclude<GardenArea,'flowers'|'journey'>,save.gardenDesign?.spaces,gardenCompletedCount(),save.stars)}`}</div></section>`;
}
function mapCurrentLevel(){return !testingLevel&&!roundEnded?currentLevel:save.highestLevel;}
function revealMapStage(){
  selectedChapter=chapterForLevel(mapCurrentLevel()).id;
  $<HTMLSelectElement>('#map-chapter-select').value=String(selectedChapter);
  const target=document.querySelector<HTMLElement>(`#map-stage-${mapCurrentLevel()}`);
  target?.scrollIntoView?.({block:'center',behavior:'auto'});
  mapScrollOffset=$('#campaign-scroll').scrollTop;
}
function mapWorldLabel(chapterId:number){
  const full=campaignWorldName(chapterId,save.language),at=full.lastIndexOf(' · ');
  return at<0?{name:full,range:''}:{name:full.slice(0,at),range:full.slice(at+3)};
}
function worldProgressText(chapterId:number){
  const chapter=chapters.find(chapter=>chapter.id===chapterId);if(!chapter)return '';
  const progress=campaignProgress(save.completed,chapter.first)!;
  return text('worldProgress').replace('{done}',String(progress.done)).replace('{total}',String(progress.total));
}
function updateMapWorldProgress(chapterId:number){
  const node=document.querySelector<HTMLElement>('#map-world-progress'),chapter=chapters.find(chapter=>chapter.id===chapterId);if(!node||!chapter)return;
  const value=worldProgressText(chapterId);if(node.textContent!==value)node.textContent=value;
  const progress=campaignProgress(save.completed,chapter.first)!;node.classList.toggle('complete',progress.done===progress.total);
}
function renderCampaignMap(){
  const current=mapCurrentLevel(),active=hasRoundProgress();
  const worldLabel=mapWorldLabel(selectedChapter);
  const positions=CAMPAIGN_NODE_X;
  const status=(id:number)=>id>save.highestLevel?'levelLocked':save.completed.includes(id)?'levelCompleted':'mapAvailable';
  return `<div class="campaign-heading"><div class="campaign-heading-copy"><h2 id="map-world-name" class="campaign-world-name">${worldLabel.name}</h2><div class="campaign-world-line"><span id="map-world-range" class="campaign-world-range">${worldLabel.range}</span><span id="map-world-progress" class="campaign-world-progress">${worldProgressText(selectedChapter)}</span></div></div><button id="map-locate" class="map-locate" aria-label="${text('mapLocate')}">${icon('paw',20)}<span>${text('mapLocate')}</span></button></div><div class="campaign-chapters"><select id="map-chapter-select" aria-label="${text('chapterSelect')}">${chapters.map(chapter=>`<option value="${chapter.id}" ${chapter.id===selectedChapter?'selected':''}>${chapter.first}–${chapter.last} · ${text(chapter.title)}</option>`).join('')}</select></div><div id="campaign-scroll" class="campaign-scroll" aria-label="${text('mapStages')}">${chapters.map(chapter=>{
    const stages=levels.filter(level=>level.id>=chapter.first&&level.id<=chapter.last),height=stages.length*CAMPAIGN_NODE_STEP;
    const path=campaignNodePath(stages.length,chapter.id>1,chapter.last<LEVEL_COUNT);
    const world=campaignWorld(chapter.id),worldStart=chapter.id===1||campaignWorld(chapter.id-1)!==world;
    return `<section class="campaign-chapter" data-world="${world}" data-world-start="${worldStart}" data-world-title="integrated" style="--campaign-path-height:${height}px" data-chapter="${chapter.id}" id="map-chapter-${chapter.id}" aria-labelledby="map-chapter-title-${chapter.id}">${campaignScenery(chapter.id,stages.length)}<div class="map-world-ground" aria-hidden="true">${campaignWorldPaint(chapter.id)}</div><div class="map-arrival-petals" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>${chapter.id>1?`<svg class="campaign-trail campaign-entry-trail" viewBox="0 0 100 1" preserveAspectRatio="none" aria-hidden="true"><path class="trail-earth" d="M 50 0 L 50 1"/><path class="trail-edge" d="M 50 0 L 50 1"/><path class="trail-surface" d="M 50 0 L 50 1"/><path class="trail-gravel" d="M 50 0 L 50 1"/></svg>`:''}<h3 id="map-chapter-title-${chapter.id}"><span>${chapter.first}–${chapter.last}</span>${text(chapter.title)}</h3><div class="campaign-path" style="height:${height}px"><svg class="campaign-trail" viewBox="0 0 100 ${height}" preserveAspectRatio="none" aria-hidden="true"><path class="trail-earth" d="${path}"/><path class="trail-edge" d="${path}"/><path class="trail-surface" d="${path}"/><path class="trail-gravel" d="${path}"/></svg>${stages.map((level,index)=>{
      const completed=save.completed.includes(level.id),locked=level.id>save.highestLevel,here=level.id===current;
      const name=`${text('level')} ${level.id} · ${text(status(level.id))}${here?' · '+text('previewCurrent'):''}`;
      return `<div class="campaign-stop" style="left:${positions[index%positions.length]}%;top:${index*CAMPAIGN_NODE_STEP}px">${campaignIsland(chapter.id)}<button id="map-stage-${level.id}" data-level="${level.id}" ${locked?'disabled':''} class="campaign-node ${completed?'completed':''} ${here?'current':''}" ${here?'aria-current="step"':''} aria-label="${name}"><span>${level.id}</span>${locked?icon('lock',16):completed?`<i>${icon('star',15)}</i>`:''}</button>${here?`<span id="map-current-pip" class="campaign-pip" aria-hidden="true"><span class="pip-face"><img src="/assets/pip-idle-open-v2.webp" alt=""/></span></span><span class="campaign-breeze" aria-hidden="true">${[0,1,2,3].map(()=>`<span class="campaign-leaf">${icon('leaf',12)}</span>`).join('')}</span>`:''}</div>`;
    }).join('')}</div></section>`;
  }).join('')}</div><div class="campaign-play"><div><span>${text(chapterForLevel(current).title)}</span><strong>${text('level')} ${current}</strong></div><button id="map-play" class="primary">${text(active?'mapResume':'mapPlay')}${icon('arrow',20)}</button></div>`;
}
/** 숨은 지도는 유지하고, 다음 지도 진입에서 현재 진행/언어/회차를 반영합니다. */
function renderCampaignMapView(){
  if(route!=='map'&&mapScenery)return;
  clearMapTravel();
  mapPipIdle?.dispose();mapPipIdle=undefined;
  mapScenery?.dispose();mapScenery=undefined;
  detachMapScroll?.();detachMapScroll=undefined;
  $('#map-view').innerHTML=renderCampaignMap();
  const observer=createCampaignScenery($('#campaign-scroll'),id=>{
    if(mapScenery!==observer||route!=='map'||mapTravel?.playing)return;selectedChapter=id;$<HTMLSelectElement>('#map-chapter-select').value=String(id);
    const label=mapWorldLabel(id);$('#map-world-name').textContent=label.name;$('#map-world-range').textContent=label.range;updateMapWorldProgress(id);syncMusicTheme();
  });
  mapScenery=observer;
  const campaignScroll=$('#campaign-scroll');
  const ownsMap=()=>route==='map'&&mapScenery===observer&&document.querySelector('#campaign-scroll')===campaignScroll;
  const rememberMapScroll=()=>{if(campaignScroll.isConnected&&route==='map'&&!$('#map-view').hidden)mapScrollOffset=campaignScroll.scrollTop;};
  campaignScroll.addEventListener('scroll',rememberMapScroll,{passive:true});
  detachMapScroll=()=>campaignScroll.removeEventListener('scroll',rememberMapScroll);
  if(route==='map'){
    const mapPip=document.querySelector<HTMLElement>('#map-current-pip');
    if(mapPip){
      mapPipIdle=createPipIdle(mapPip);
      const advance=mapAdvance;mapAdvance=undefined;
      if(advance&&advance.owner===save&&advance.to===mapCurrentLevel()&&save.completed.includes(advance.from)){
        const from=document.querySelector<HTMLElement>(`#map-stage-${advance.from}`),to=document.querySelector<HTMLElement>(`#map-stage-${advance.to}`);
        if(from&&to){const flight=createMapTravel(campaignScroll,from,to,mapPip,ownsMap,()=>{if(mapTravel===flight)syncPipActivity();});mapTravel=flight;}
      }
    }
  }
  $('#map-play').onclick=()=>{if(ownsMap())showStagePreview(mapCurrentLevel(),'map',$('#map-play'));};
  $('#map-locate').onclick=()=>{if(ownsMap()){clearMapTravel();revealMapStage();syncPipActivity();}};
  $<HTMLSelectElement>('#map-chapter-select').onchange=event=>{
    if(!ownsMap()||route!=='map'||stagePreview||otherModal())return;
    const id=Number((event.target as HTMLSelectElement).value);if(!chapters.some(chapter=>chapter.id===id))return;
    clearMapTravel();selectedChapter=id;document.querySelector(`#map-chapter-${id}`)?.scrollIntoView?.({block:'start',behavior:'auto'});syncPipActivity();
    mapScrollOffset=campaignScroll.scrollTop;
  };
  campaignScroll.scrollTop=mapScrollOffset;
  document.querySelectorAll<HTMLButtonElement>('[data-level]').forEach(button=>button.onclick=()=>{if(ownsMap())showStagePreview(Number(button.dataset.level),'map',button);});
}
function renderViews(grew=false){
  if(lookPreview)closeLookPreview(false);if(spacePreview)closeSpacePreview(false);
  const focused=document.activeElement as HTMLElement|null,focusedId=focused?.id;
  const scroll=Array.from(document.querySelectorAll<HTMLElement>('.view'),view=>({view,top:view.scrollTop,left:view.scrollLeft}));
  if(route==='map'&&$('#map-view').dataset.motionActive==='true')mapScrollOffset=document.querySelector<HTMLElement>('#campaign-scroll')?.scrollTop??mapScrollOffset;
  disposeCarePipDisplay();
  renderCampaignMapView();
  $('#village-view').innerHTML=`<div class="subview-heading"><div class="eyebrow">${text('chapterMeadow')}</div><h2>${text('mapTitle')}</h2><p>${text('mapDesc')}</p></div>${gardenWorkshop(grew)}`;
  if(careDemo)$('#village-view').innerHTML=$('#village-view').innerHTML.split('<div class="level-picker">')[0];
  $('#village-view').innerHTML=careDemoPanel('village')+$('#village-view').innerHTML;
  document.querySelector<HTMLButtonElement>('#grow')?.toggleAttribute('disabled',growing||careStorageBlocked()||save.stars<2||save.garden>=5);
  $('#journal-view').innerHTML=`${careDemoPanel('journal')}<div class="subview-heading pip-view-heading"><div class="eyebrow">${text('friendsHeading')}</div><h2>${text('friendsTitle')}</h2></div>${pipCareCard()}${campaignAlbumCard(save.language,albumCompleted(),selectedAlbumWorld,Boolean(careDemo))}${sharedGardenPlan('journal')}${!careDemo?`<button id="pip-tutorial-help" class="text-button guide-help">${text('tutorial')}</button>`:''}`;
  if(!careDemo)$('#pip-tutorial-help').onclick=()=>showTutorial('help',$<HTMLButtonElement>('#pip-tutorial-help'));
  $('#settings-view').innerHTML=`<div class="subview-heading"><div class="eyebrow">PAWBLOSSOM PUZZLE</div><h2>${text('settingsTitle')}</h2><p>${text('settingsDesc')}</p></div><div class="settings-card"><div class="setting-row"><span>${icon('volume',22)}${text('music')}</span><button class="toggle ${save.music?'on':''}" id="music-toggle" role="switch" aria-checked="${save.music}" aria-label="${text('music')}"><i></i></button></div><div class="setting-row"><span>${icon('paw',22)}${text('sfx')}</span><button class="toggle ${save.sfx?'on':''}" id="sfx-toggle" role="switch" aria-checked="${save.sfx}" aria-label="${text('sfx')}"><i></i></button></div><div class="setting-row"><label for="language">${text('language')}</label><select id="language"><option value="en" ${save.language==='en'?'selected':''}>English</option><option value="ko" ${save.language==='ko'?'selected':''}>한국어</option></select></div><p class="sound-note">${text('soundHint')}</p></div><div class="save-note">${icon('leaf',20)}<p>${text('offline')}</p></div><div class="storage-card" id="storage-card"><p id="save-status"></p><button id="save-retry" class="text-button" hidden></button><button id="save-reload" class="text-button" hidden></button></div><section class="support-note" aria-labelledby="support-title"><h3 id="support-title">${text('support')}</h3><p id="support-email">doeud1410@gmail.com</p></section><button id="reset" class="text-button reset-button">${text('reset')}</button><p class="version">Pawblossom Puzzle · v${APP_VERSION}</p>`;
  updateSaveStatus(focusedId);
  for(const id of ['#save-retry','#save-reload'])$(id).addEventListener('blur',()=>updateSaveStatus());
  const renderedSave=save,renderedGeneration=careGeneration;
  const renderedControls=new Map(['save-retry','save-reload','music-toggle','sfx-toggle','language','reset'].map(id=>[id,$('#'+id)]));
  const settingsAction=(id:string)=>!spaceDialog.open&&!resourceDialog.open&&!careDemo&&currentControl(renderedControls.get(id)!,renderedSave,renderedGeneration);
  $('#save-retry').onclick=()=>{if(!settingsAction('save-retry'))return;retrySave(save);updateSaveStatus();};
  $('#save-reload').onclick=()=>{if(!settingsAction('save-reload'))return;if(confirm(text('saveReloadConfirm')))window.location.reload();};
  bindCareControls();
  $('#music-toggle').onclick=()=>{if(!settingsAction('music-toggle'))return;save.music=!save.music;audio.setMusicEnabled(save.music);persist();$('#music-toggle').classList.toggle('on',save.music);$('#music-toggle').setAttribute('aria-checked',String(save.music));};
  const help=document.createElement('button');help.id='tutorial-help';help.className='primary guide-help';help.textContent=text('tutorial');help.onclick=()=>showTutorial('help',help);$('#settings-view').append(help);
  if(androidAdEntry){const entry=document.createElement('button');entry.id='test-ad-button';entry.className='text-button';entry.textContent=adCopy(save.language).title;entry.onclick=()=>{void showAdDialog();};$('#settings-view').append(entry);}
  if(androidBillingEntry){const entry=document.createElement('button');entry.id='test-billing-button';entry.className='text-button';entry.textContent=billingCopy(save.language).title;entry.onclick=()=>{void showBillingDialog();};$('#settings-view').append(entry);}
  $('#sfx-toggle').onclick=()=>{if(!settingsAction('sfx-toggle'))return;save.sfx=!save.sfx;audio.setSfxEnabled(save.sfx);persist();$('#sfx-toggle').classList.toggle('on',save.sfx);$('#sfx-toggle').setAttribute('aria-checked',String(save.sfx));};
  $<HTMLSelectElement>('#language').onchange=event=>{if(settingsAction('language'))changeLanguage((event.target as HTMLSelectElement).value==='ko'?'ko':'en');};
  $('#reset').onclick=()=>{if(!settingsAction('reset')||!confirm(text('resetConfirm')))return;const cleared=clearSave();updateSaveStatus();if(!cleared)return;clearCareReaction();careGeneration++;clearTimeout(growthTimer);growthTimer=undefined;growing=false;save=cleared;selectedChapter=1;audio.setMusicEnabled(save.music);audio.setSfxEnabled(save.sfx);localize();updateWallet();renderViews();startLevel(1);switchView('puzzle');showTutorial();};
  // DOM 교체 뒤에도 읽던 위치를 유지합니다. 심기 버튼이 비활성이면 갱신된 상태로 초점을 잇습니다.
  let fallbackFocus:HTMLElement|undefined;
  if(focusedId&&!focused?.isConnected){
    const replacement=document.querySelector<HTMLElement>('#'+focusedId);
    const target=focusedId==='grow'&&(replacement as HTMLButtonElement|null)?.disabled?$('#garden-stage')
      :focusedId.startsWith('garden-')&&(!replacement||(replacement as HTMLButtonElement).disabled)?$('#'+(selectedGardenArea==='flowers'?'garden-edit-title':'garden-space-title'))
      :focusedId.startsWith('pip-')&&(!replacement||(replacement as HTMLButtonElement).disabled)?$('#pip-care-title'):replacement;
    target?.focus({preventScroll:true});
    if(target&&target!==replacement)fallbackFocus=target;
  }
  for(const {view,top,left} of scroll){view.scrollTop=top;view.scrollLeft=left;}
  fallbackFocus?.scrollIntoView?.({block:'start'});
  syncPipActivity();
}
function localize(){
  document.documentElement.lang=save.language;
  document.querySelectorAll<HTMLElement>('[data-t]').forEach(el=>el.textContent=text(el.dataset.t as TextKey));
  document.querySelectorAll<HTMLElement>('[data-alt]').forEach(el=>el.setAttribute('alt',text(el.dataset.alt as TextKey)));
  $<HTMLSelectElement>('#language-toggle').value=save.language;$('#language-toggle').setAttribute('aria-label',text('language'));
  $('#settings-button').setAttribute('aria-label',text('settings'));$('#restart').setAttribute('aria-label',text('restart'));
  if(noticeKey)$('#toast').textContent=text(noticeKey);
  if(resumeNoticeTimer!==undefined)$('#round-resumed-notice').textContent=text(scene.engine.ruleVersion===1?'roundResumedClassic':'roundResumed');
  if(boardNoticeKey)$('#board-notice').textContent=text(boardNoticeKey);
}
function changeLanguage(language:'en'|'ko'){
  if(lookPreview)closeLookPreview(false);if(spacePreview)closeSpacePreview(false);
  boardFeedback.cancel();
  const focused=document.activeElement as HTMLElement|null,focusedId=focused?.id;
  save.language=language;persist();localize();updateWallet();renderViews();updateGoals();updateBoardAccess();updateResultCopy();
  if($<HTMLDialogElement>('#tutorial-dialog').open)renderTutorial();
  if(TEST_TOOLS_ENABLED&&$<HTMLDialogElement>('#test-level-dialog').open)renderTestPicker();
  if(stagePreview)renderStagePreview();
  if(resourceHelp)renderResourceHelp();
  if(androidAdEntry&&testAds)renderAdDialog();if(androidBillingEntry&&testBilling)renderBillingDialog();
  if(focusedId&&!focused?.isConnected)document.querySelector<HTMLElement>('#'+focusedId)?.focus();
}
function switchView(name:string){
  if(lookPreview)closeLookPreview(false);if(spacePreview)closeSpacePreview(false);
  if(resourceDialog.open)return;
  if(careDemo&&!['village','journal'].includes(name)&&!exitCareDemo(false))return;
  if(stagePreview)return;
  const returnToResult=name==='puzzle'&&roundEnded&&resultShown&&resultWon!==undefined;
  // 광고 취소 등으로 아직 표시할 수 없으면 종료 보드로 이동하지 않고 현재 화면을 유지합니다.
  if(returnToResult&&(!nativeActive||document.hidden||testAds?.pausesGame||testBilling?.pausesGame||boardPending||resultTimer!==undefined||previewDialog.open||otherModal()||game.scene.getScene('Board')!==scene))return;
  if(name!=='puzzle')abandonRewardContinue();
  if(!scene.canLeave())return;
  if(route==='map')mapScrollOffset=$('#campaign-scroll').scrollTop;
  if(name!=='puzzle'){clearResumeNotice();clearBoardNotice();}
  if(name!=='village'&&(gardenActivity||journeyMoment))clearCareReaction();
  route=name;$('#app').dataset.route=name;document.querySelectorAll<HTMLElement>('.view').forEach(view=>view.hidden=view.id!==`${name}-view`);
  if(name==='village'||name==='map')renderViews();
  if(name==='map'&&mapPositioned!==mapCurrentLevel()){revealMapStage();mapPositioned=mapCurrentLevel();}
  document.querySelectorAll<HTMLButtonElement>('.bottom-nav button[data-route]').forEach(b=>{b.classList.toggle('active',b.dataset.route===name);if(b.dataset.route===name)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
  updateSaveStatus();
  // Phaser refresh는 직전 parentSize로 계산하므로 숨김→표시 직후 부모 크기를 먼저 갱신합니다.
  if(name==='puzzle'&&game.isBooted){game.scale.getParentBounds();game.scale.refresh();updateGoals();}
  if(returnToResult){
    const dialog=$<HTMLDialogElement>('#result-dialog');dialog.showModal();
    const button=dialog.querySelector<HTMLButtonElement>('#result-continue');
    if(androidAdEntry&&button&&testingLevel&&!continueUsed&&resultWon===false&&moves===0)bindRewardContinue(button);
  }
  syncActivity();
  if(name==='map')mapTravel?.start();
  if(returnToResult)$('#result-next').focus({preventScroll:true});
}
document.querySelectorAll<HTMLButtonElement>('.bottom-nav button[data-route]').forEach(button=>button.onclick=()=>switchView(button.dataset.route!));
$('#settings-button').onclick=()=>{if(route==='settings')switchView(settingsReturnRoute);else{settingsReturnRoute=route;switchView('settings');}};
$('.brand').onclick=e=>{e.preventDefault();switchView('map');};
$('#language-toggle').onchange=event=>changeLanguage((event.target as HTMLSelectElement).value==='en'?'en':'ko');
$('#board-notice').addEventListener('animationend',()=>{
  // 이전 애니메이션의 늦은 종료 이벤트는 현재 재생 중인 새 안내를 지우지 않습니다.
  if($('#board-notice').getAnimations?.().some(animation=>animation.playState==='running'))return;
  clearBoardNotice();
});
for(const kind of ['stars','coins'] as const)$('#'+kind+'-help').onclick=()=>showResourceHelp(kind,$('#'+kind+'-help'));
$('#restart').onclick=()=>showStagePreview(currentLevel,'restart',$('#restart'));
if(TEST_TOOLS_ENABLED){$('#test-level-button').onclick=()=>showTestPicker();$<HTMLDialogElement>('#test-level-dialog').addEventListener('cancel',event=>{event.preventDefault();closeTestPicker();});}
$<HTMLDialogElement>('#result-dialog').addEventListener('cancel',event=>{event.preventDefault();if(testAds?.busy||rewardedContinue?.preparing)return;$<HTMLDialogElement>('#result-dialog').close();switchView('map');});
$<HTMLDialogElement>('#tutorial-dialog').addEventListener('cancel',event=>{event.preventDefault();closeTutorial();});
document.addEventListener('pointerdown',()=>{void audio.unlock().catch(()=>{});},{passive:true,capture:true});
// 한 Game 동안 DOM에 한 번만 등록합니다. 회차 교체는 현재 scene을 조회합니다.
const boardFocus=$('#game-canvas');
boardFocus.addEventListener('focus',()=>{if(boardFocus.matches(':focus-visible')){boardFocus.dataset.keyboard='true';scene?.focusKeyboard();}updateBoardAccess();});
boardFocus.addEventListener('blur',()=>{boardFocus.dataset.keyboard='false';scene?.cancelInput();});
boardFocus.addEventListener('pointerdown',event=>{if(event.button===0&&event.isPrimary!==false&&scene?.keyboardState().available)clearResumeNotice();boardFocus.dataset.keyboard='false';scene?.hideKeyboardCursor();},{capture:true});
boardFocus.addEventListener('keydown',event=>{
  if(event.target!==boardFocus||document.activeElement!==boardFocus||event.altKey||event.ctrlKey||event.metaKey||event.isComposing)return;
  if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Enter',' ','Escape'].includes(event.key))return;
  if(boardPending||route!=='puzzle'||!nativeActive||document.hidden||testAds?.pausesGame||testBilling?.pausesGame||document.querySelector('dialog[open]'))return;
  // 대기 중에도 방향키/Space의 페이지 스크롤은 막고 엔진 입력은 거부합니다.
  event.preventDefault();
  if(!scene.keyboardState().available)return;
  clearResumeNotice();
  boardFocus.dataset.keyboard='true';void audio.unlock().catch(()=>{});scene.focusKeyboard();scene.keyboardKey(event.key,event.repeat,event.shiftKey&&event.key==='Enter');
});
window.addEventListener('blur',()=>{if(lookPreview)closeLookPreview(false);if(spacePreview)closeSpacePreview(false);boardFocus.dataset.keyboard='false';scene?.cancelInput();practiceInputs?.cancel();boardFeedback.cancel();});
window.addEventListener('resize',()=>{practiceInputs?.cancel();boardFeedback.cancel();});
window.addEventListener('scroll',()=>boardFeedback.cancel(),{capture:true,passive:true});
document.addEventListener('visibilitychange',()=>{syncActivity();if(testAds){renderAdDialog();if(!document.hidden)void testAds.refresh();}if(testBilling){renderBillingDialog();if(!document.hidden)void testBilling.refresh();}});
window.addEventListener('pageshow',()=>syncActivity());
window.addEventListener('pagehide',()=>{resultWorldScenery?.dispose();resultWorldScenery=undefined;$('#result-dialog').dataset.worldActive='false';if(lookPreview)closeLookPreview(false);if(spacePreview)closeSpacePreview(false);boardFeedback.cancel();void testAds?.dispose();void testBilling?.dispose();});
if(Capacitor.isNativePlatform()){
  void App.addListener('appStateChange',({isActive})=>{nativeRevision++;nativeActive=isActive;syncActivity();if(testAds){renderAdDialog();if(isActive)void testAds.refresh();}if(testBilling){renderBillingDialog();if(isActive)void testBilling.refresh();}}).then(async()=>{
    const revision=nativeRevision;
    const state=await App.getState();
    // 늦게 반환된 초기 상태가 이후의 복귀 이벤트를 덮어쓰지 않도록 합니다.
    if(revision===nativeRevision){nativeActive=state.isActive;syncActivity();}
  }).catch(()=>{ /* 네이티브 상태를 확인할 수 없으면 비활성 상태를 유지합니다. */ });
  void App.addListener('backButton',()=>{const dialog=$<HTMLDialogElement>('#result-dialog');if(billingModal())closeBillingDialog();else if(testBilling?.pausesGame)return;else if(androidAdEntry&&$<HTMLDialogElement>('#test-ad-dialog').open){void closeAdDialog();}else if(testAds?.pausesGame)return;else if(lookPreview)closeLookPreview();else if(spacePreview)closeSpacePreview();else if(resourceHelp)closeResourceHelp();else if(stagePreview)closeStagePreview();else if($<HTMLDialogElement>('#tutorial-dialog').open)closeTutorial();else if(TEST_TOOLS_ENABLED&&$<HTMLDialogElement>('#test-level-dialog').open)closeTestPicker();else if(dialog.open){dialog.close();switchView('map');}else if(route==='settings')switchView(settingsReturnRoute);else if(route!=='map')switchView('map');else void App.minimizeApp();});
}
if(androidAdEntry)$<HTMLDialogElement>('#test-ad-dialog').addEventListener('cancel',event=>{event.preventDefault();void closeAdDialog();});
if(androidBillingEntry)$<HTMLDialogElement>('#test-billing-dialog').addEventListener('cancel',event=>{event.preventDefault();closeBillingDialog();});
if(typeof ResizeObserver!=='undefined'){
  new ResizeObserver(()=>{boardFeedback.cancel();if(game?.isBooted&&route==='puzzle'){game.scale.getParentBounds();game.scale.refresh();}}).observe($('#game-canvas'));
}
const resumed=Boolean(save.inProgress);
const resumedStored=resumeNormal();updateWallet();renderViews();localize();switchView('map');
if(androidBillingEntry){
  testBilling=new TestBillingController(nativeTestBilling(),()=>{renderBillingDialog();if(testAds)renderAdDialog();syncActivity();});
  void testBilling.connect();
}
if(resumed&&resumedStored&&saveStatus().load!=='recovered')showResumeNotice();
if(!save.tutorialSeen)showTutorial();
