import {gardenTendingArt} from '../src/GardenTending';

import {pipDecorationArt} from '../src/PipDecoration';
import {previewGardenTheme,gardenThemePreview} from '../src/GardenThemePreview';
import {reachedPipUnlock,pipUnlockCard} from '../src/PipUnlock';
import * as campaignProgressModel from '../src/CampaignProgress';
import * as albumModel from '../src/CampaignAlbum';
import * as campaignMilestoneUi from '../src/CampaignMilestone';
import {LEVEL_COUNT,chapters as currentChapters} from '../src/levels';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import packageInfo from '../package.json';
import {APP_VERSION} from '../src/appVersion';
import { BoardEngine, seededRng, type BoardMask, type BoardSnapshot } from '../src/core';
import {TestAdsController,adCopy,type TestAdsBridge,type AdSnapshot,type AdFormat} from '../src/testAds';
import {TestBillingController,billingCopy,type TestBillingBridge,type BillingSnapshot} from '../src/testBilling';
import {bindPracticeBoard} from '../src/bindPracticeInputs';
import {cloneSnapshot,prepareShuffle} from '../src/puzzleHelp';
import * as journeyModel from '../src/journeyGarden';
import * as journeyUI from '../src/JourneyGardenUI';
import {freshGardenSpaces} from '../src/gardenSpaces';
import {freshGardenDesign} from '../src/gardenDesign';
import {t, type TextKey} from '../src/i18n';
import {icon as renderIcon} from '../src/icons';
import * as trailEpisode from '../src/TrailEpisode';
import * as puzzleToolsModel from '../src/puzzleTools';
import * as puzzleToolActions from '../src/puzzleToolActions';
import * as puzzleToolUi from '../src/PuzzleToolUI';
import {specialTileArt,specialArtKinds,specialBodyKey,specialBodyPath} from '../src/SpecialTileArt';
import * as paintedGardenArt from '../src/GardenPaintedArt';
import * as gardenStructureArt from '../src/GardenStructureArt';
import * as boardDisplay from '../src/BoardDisplay';
import {campaignScenery,campaignWorld,campaignWorldName,campaignWorldPaint,campaignMusicTheme} from '../src/CampaignScenery';
import * as campaignRoute from '../src/CampaignRoute';

import {gardenGoals,goalNextStep,nextGardenGoal,newlyReadyGardenGoal} from '../src/GardenGoals';
import {previewGardenPreset} from '../src/GardenPresets';
import {gardenPresetPreview} from '../src/GardenPresetsUI';
import {pipTendingArt} from '../src/PipTending';

// 테스트에만 사용하는 Node API입니다. 별도 @types/node 설치 없이 런타임에서 읽습니다.
const fsModule = 'node:fs', vmModule = 'node:vm';
const fs = await import(fsModule), vm = await import(vmModule);
const read = (path: string): string => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const compile = (source: string): string => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const mainCode = compile(read('../src/main.ts').replace(/^import .*;\r?\n/gm, ''));
const stateCode = compile(read('../src/state.ts'));
const pipCareCode = compile(read('../src/pipCare.ts'));
const gardenDesignCode = compile(read('../src/gardenDesign.ts'));
const gardenSpacesCode = compile(read('../src/gardenSpaces.ts'));
const gardenSpaceArtCode = compile(read('../src/GardenSpaceArt.ts'));
const gardenSpacesUICode = compile(read('../src/GardenSpacesUI.ts'));
const levelsCode = compile(read('../src/levels.ts'));
const boardCode = compile(read('../src/BoardScene.ts'));
const effectsCode = compile(read('../src/BoardEffects.ts'));
const engineCode = compile(read('../src/core/BoardEngine.ts'));
const practiceCode = compile(read('../src/SwapPractice.ts'));
const specialPracticeCode = compile(read('../src/SpecialTapPractice.ts'));
const i18nCode = compile(read('../src/i18n.ts'));
const gardenCode = compile(read('../src/GardenArt.ts'));

class ElementStub {
  id: string;
  hidden: boolean;
  open = false;
  tabIndex = -1;
  scrollTop=0;scrollLeft=0;
  innerHTML = '';
  textContent = '';
  value = '';
  style: Record<string, string> = {};
  attributes:Record<string,string>={};
  dataset: Record<string, string> = {};
  listeners: Record<string, (event: { preventDefault(): void }) => void> = {};
  onclick: (event?:{detail:number;button:number}) => void = () => {};
  classList = { add() {}, remove() {}, toggle() {} };
  constructor(selector: string) { this.id = selector.slice(1); this.hidden = selector !== '#puzzle-view'; }
  setAttribute(name:string,value:string) {this.attributes[name]=value;}
  getAttribute(name:string) {return this.attributes[name]??null;}
  removeAttribute(name:string) {delete this.attributes[name];}
  append(_child:ElementStub) {}
  before() {}
  focus() {}
  matches(){return true;}
  querySelector(selector:string){return this.innerHTML.includes(`id="${selector.slice(1)}"`)?new ElementStub(selector):null;}
  setPointerCapture() {}
  hasPointerCapture(){return false;}releasePointerCapture(){}
  isConnected=true;disabled=false;
  getBoundingClientRect(){return {left:0,top:0,right:180,bottom:180};}
  getAnimations():{playState:string}[]{return [];}
  querySelectorAll(_selector:string):ElementStub[]{return [];}
  toggleAttribute(name:string,force?:boolean) {if(name==='disabled')this.disabled=force??!this.disabled;}
  addEventListener(name: string, callback: (event: { preventDefault(): void }) => void) { this.listeners[name] = callback; }
  removeEventListener(name:string,callback:unknown){if(this.listeners[name]===callback)delete this.listeners[name];}
  showModal() { this.open = true; }
  close() { this.open = false; }
}

function mainHarness(storageFails = false, firstUse = false, testTools = false, native = false, initial?:unknown, autoFrame=true, adsBridge?:TestAdsBridge,billingBridge?:TestBillingBridge,bootMap=false) {
  const elements = new Map<string, ElementStub>();
  const rectangles = new Map<string, ReturnType<ElementStub['getBoundingClientRect']>>();
  const timers = new Map<number, { callback: () => void; ms: number }>();
  let timerId = 0, writes = 0;
  let games=0, destroys=0, frame=()=>{};
  let resultArtCalls=0;
  const documentEvents:Record<string,()=>void>={};
  const windowEvents:Record<string,()=>void>={};
  const nativeEvents:Record<string,(state:{isActive:boolean})=>void>={};
  const pipControllers:{pip:ElementStub;disposed:boolean;disposals:number;alignment:'center'|'bottom'}[]=[];
  const accessoryControllers:{slot:ElementStub;kind:'ribbon'|'wateringCan';disposed:boolean}[]=[];
  const natureControllers:{picture:ElementStub;disposed:boolean;disposals:number;activations:boolean[]}[]=[];
  const pipLifecycle:string[]=[];
  const sceneryControllers:{disposed:boolean;active:boolean;paintVisible:boolean;notify:(id:number)=>void}[]=[];
  const mapTravels:{from:ElementStub;to:ElementStub;active:boolean;started:number;disposed:boolean;playing:boolean;finish():void;start():void;setActive(value:boolean):void;dispose():void}[]=[];
  let resolveNativeState!:(state:{isActive:boolean})=>void;
  const nativeState=new Promise<{isActive:boolean}>(resolve=>{resolveNativeState=resolve;});
  let stored = JSON.stringify({ version: 1, language: 'en', highestLevel: 2, completed: [1], stars: 1, coins: 40, garden: 0, music: true, sfx: true });
  if(firstUse)stored='null';
  if(initial!==undefined)stored=JSON.stringify(initial);
  const storageValues=new Map<string,string>(stored==='null'?[]:[['pawblossom.save.v1',stored]]);
  const element = (selector: string): ElementStub => {
    if (!elements.has(selector)) {
      elements.set(selector, new ElementStub(selector));
      elements.get(selector)!.getBoundingClientRect=()=>rectangles.get(selector)??{left:0,top:0,right:180,bottom:180};
      if(selector==='#stars-help'||selector==='#coins-help')elements.get(selector)!.hidden=false;
      if(['#map-view','#village-view','#journal-view'].includes(selector)){
        const view=selector.slice(1,-5),owned=view==='map'?['map-current-pip']:[`${view}-pip-actor`,`${view}-pip-image`,`${view}-pip-accessory`,...(view==='village'?['garden-nature','garden-tend']:[])];
        let markup='';
        Object.defineProperty(elements.get(selector)!,'innerHTML',{get:()=>markup,set:(value:string)=>{
          pipLifecycle.push(`${view}-replace`);
          for(const id of owned){const previous=elements.get('#'+id);if(previous)previous.isConnected=false;elements.delete('#'+id);}
          markup=value;
        }});
      }
      for(const view of ['village','journal']){
        if(selector===`#${view}-pip-accessory`){
          const kind=elements.get(`#${view}-view`)?.innerHTML.match(new RegExp(`id="${view}-pip-accessory"[^>]*data-pip-accessory="([^"]+)"`))?.[1];
          if(kind)elements.get(selector)!.dataset.pipAccessory=kind;
        }
        if(selector===`#${view}-pip-image`){
          const src=elements.get(`#${view}-view`)?.innerHTML.match(new RegExp(`id="${view}-pip-image"[^>]*src="([^"]+)"`))?.[1];
          if(src)elements.get(selector)!.attributes.src=src;
        }
      }
      if(selector==='#result-dialog')elements.get(selector)!.querySelector=child=>elements.get(selector)!.innerHTML.includes(`id="${child.slice(1)}"`)?element(child):null;
      if(selector==='#garden-tend')elements.get(selector)!.disabled=Boolean(elements.get('#village-view')?.innerHTML.match(/<button id="garden-tend"[^>]*\bdisabled/));
      // 동적으로 만든 설정 도움말도 실제 onclick과 opener 참조로 검사합니다.
      if(selector==='#settings-view')elements.get(selector)!.append=child=>{elements.set('#'+child.id,child);};
      if(selector==='#pip-tutorial-help')elements.get(selector)!.hidden=false;
    }
    if(selector==='#practice-board')elements.get(selector)!.querySelectorAll=()=>Array.from({length:9},(_,i)=>{const button=element(`#practice-cell-${Math.floor(i/3)}-${i%3}`);button.dataset={row:String(Math.floor(i/3)),col:String(i%3)};return button;});
    return elements.get(selector)!;
  };
  class SceneStub {
    engine:BoardEngine;
    busy=false;toolTarget?: (at:Position)=>void;preparedComplete?:()=>void;toolArea:Position[]=[];
    stopped=false;
    sys={settings:{visible:true},setVisible(value:boolean){this.settings.visible=value;}};
    constructor(public hooks: { onMove(items: number[], points: number): void; onReady():void; onNotice(key:string):void;onStart?():void;onToolCancel?():void },snapshot?:BoardSnapshot,mask?:BoardMask,crates?:Position[]) {this.engine=new BoardEngine(8,8,seededRng(42),snapshot,undefined,mask,crates);}
    configureLeaves(piles:Parameters<BoardEngine['setLeaves']>[0]) {this.engine.setLeaves(piles);}
    shuffle(){this.engine.shuffle();return true;}
    snapshot(){return cloneSnapshot({board:this.engine.board,leaves:this.engine.leaves,ruleVersion:this.engine.ruleVersion,...(this.engine.hasCrates?{crates:this.engine.crates}:{})});}
    applyPreparedShuffle(value:BoardSnapshot){const copy=cloneSnapshot(value);this.engine.board=copy.board;this.engine.leaves=copy.leaves;if(copy.crates)this.engine.crates=copy.crates;}
    canResumeAfterFailure(){return this.stopped;}
    resumePreparedFailure(){this.stopped=false;}
    canLeave() { return !this.busy; }
    stopPlaying() {this.stopped=true;}
    resumeAfterFailure(){if(!this.stopped)return false;this.stopped=false;return true;}
    keyboardState(){return {available:!this.stopped&&!this.busy,busy:this.busy,finished:this.stopped};}
    focusKeyboard() {} keyboardKey() {} hideKeyboardCursor() {}
    cancelInput(){if(this.toolTarget){this.toolTarget=undefined;this.hooks.onToolCancel?.();}this.completePrepared();}
    beginToolSelection(target:(at:Position)=>void){if(this.stopped||this.busy)return false;this.toolTarget=target;return true;}
    endToolSelection(){this.toolTarget=undefined;this.toolArea=[];}
    showToolArea(at:Position[]){this.toolArea=at;}
    playPreparedTool(plan:puzzleToolActions.PuzzleToolPlan,complete:()=>void){if(this.stopped||this.busy)return false;this.hooks.onStart?.();this.applyPreparedShuffle(plan.after);if(!plan.result){complete();return true;}this.busy=true;this.preparedComplete=complete;return true;}
    completePrepared(){if(!this.preparedComplete)return;const done=this.preparedComplete;this.preparedComplete=undefined;this.busy=false;done();}
  }
  class GameStub {
    constructor(public config:Record<string,unknown>){games++;}
    events = { on:(_name:string,callback:()=>void)=>{frame=callback;} };
    paused=false;pauses=0;resumes=0;
    scene = {
      isBooted:true,isProcessing:false,board:undefined as SceneStub|undefined,stops:0,removes:0,adds:0,
      getScene:()=>this.scene.board,
      stop:()=>{this.scene.stops++;this.scene.board?.stopPlaying();},
      remove:()=>{if(this.scene.isProcessing)throw Error('제거 큐 진입');this.scene.removes++;this.scene.board=undefined;},
      add:(_key:string,board:SceneStub)=>{
        if(!this.scene.isBooted||this.scene.isProcessing||this.scene.board)throw Error('추가 큐 진입 또는 중복 키');
        this.scene.board=board;this.scene.adds++;this.paused=false;board.hooks.onReady();
      },
      isPaused: () => this.paused, isActive: () => !this.paused, pause:()=>{this.paused=true;this.pauses++;}, resume:()=>{this.paused=false;this.resumes++;},
    };
    isBooted=true;
    scale = { getParentBounds() {},refresh() {} };
    destroy() {destroys++;}
  }
  class AudioStub {
    plays:string[]=[];
    suspended=false;suspends=0;resumes=0;unlocks=0;music=true;sfx=true;
    theme='meadow';setMusicTheme(theme:string){this.theme=theme;}
    setMusicEnabled(enabled:boolean) {this.music=enabled;}
    setSfxEnabled(enabled:boolean) {this.sfx=enabled;}
    unlock() { this.unlocks++;return Promise.resolve(); }
    play(key:string) {this.plays.push(key);}
    suspend() {this.suspended=true;this.suspends++;}
    resume() {this.suspended=false;this.resumes++;}
  }
  class FeedbackStub {
    constructor(public options:{pip:ElementStub}){}
    calls:{kind:string;payload?:unknown}[]=[];
    beginMove(payload:unknown){this.calls.push({kind:'begin',payload});}
    show(payload:unknown){this.calls.push({kind:'show',payload});}
    cancel(){this.calls.push({kind:'cancel'});}
  }
  const stateExports: Record<string, unknown> = {};
  const context = vm.createContext({
    crypto:globalThis.crypto,
    APP_VERSION:packageInfo.version,TEST_TOOLS_ENABLED:testTools,
    ANDROID_TEST_ADS_ENABLED:Boolean(adsBridge),TestAdsController,adCopy,nativeTestAds:()=>adsBridge,
    ANDROID_TEST_BILLING_ENABLED:Boolean(billingBridge),TestBillingController,billingCopy,nativeTestBilling:()=>billingBridge,
    exports: stateExports,
    localStorage: {
      removeItem:(key:string)=>storageValues.delete(key),
      getItem: (key:string) => storageValues.get(key)??null,
      setItem: (_key: string, value: string) => {
        writes++;
        if (storageFails) throw new Error('Storage write rejected');
        storageValues.set(_key,value);
      },
    },
    document: {
      body:{append(){}},
      createElement: () => {const created=new ElementStub('button');created.hidden=false;return created;},
      querySelector:(selector:string)=>selector==='dialog[open]'?null:element(selector),
      getElementById:(id:string)=>element('#'+id),
      querySelectorAll: (selector: string) => selector === '.bottom-nav button[data-route]' || selector === '[data-route]'
        ? [...(selector==='[data-route]'?[element('#app')]:[]),...['map','village','journal'].map(route=>{const button=element('#nav-'+route);button.dataset.route=route;return button;})] : selector === '[data-test-level]'
        ? Array.from({length:LEVEL_COUNT},(_,i)=>{const button=element(`#test-stage-${i+1}`);button.dataset.testLevel=String(i+1);return button;}) : selector === '[data-chapter]' || selector === '[data-test-chapter]'
        ? Array.from({length:currentChapters.length},(_,i)=>{const test=selector.includes('test-');const button=element(`#${test?'test-':''}chapter-${i+1}`);button.dataset[test?'testChapter':'chapter']=String(i+1);return button;}) : selector === '#practice-board button'
        ? Array.from({length:9},(_,i)=>{const button=element(`#practice-cell-${Math.floor(i/3)}-${i%3}`);button.dataset={row:String(Math.floor(i/3)),col:String(i%3)};return button;}) : selector === '.view'
        ? ['map','puzzle', 'village', 'journal', 'settings'].map(name => element(`#${name}-view`)) : [],
      documentElement: {}, hidden:false, addEventListener:(name:string,callback:()=>void)=>{documentEvents[name]=callback;},
    },
    window:{addEventListener:(name:string,callback:()=>void)=>{windowEvents[name]=callback;}},
    Phaser: { Game: GameStub, AUTO: 0, Scale: { FIT: 0, CENTER_BOTH: 0 }, Core:{Events:{POST_RENDER:'postrender'}} },
    BoardScene: SceneStub, tileNames: ['strawberry', 'carrot', 'blueberry', 'acorn', 'leaf', 'flower'],
    specialTileArt,
    ...campaignProgressModel,...campaignMilestoneUi,
    ...trailEpisode,...puzzleToolsModel,...puzzleToolActions,...puzzleToolUi,toolSeededRng:seededRng,
    ...boardDisplay,
    gardenTendingArt,pipDecorationArt,gardenGoals,goalNextStep,nextGardenGoal,newlyReadyGardenGoal,previewGardenPreset,gardenPresetPreview,pipTendingArt,previewGardenTheme,gardenThemePreview,reachedPipUnlock,pipUnlockCard,...journeyModel,...journeyUI,
    createJourneyGardenArt:()=>({setActive(){},dispose(){}}),
    bindPracticeBoard,
    cloneSnapshot,prepareShuffle,
    showResultPip:()=>{resultArtCalls++;},
    RoundFeedback:FeedbackStub,
    campaignScenery,campaignWorld,campaignWorldName,campaignWorldPaint,campaignMusicTheme,
    ...campaignRoute,
    createMapTravel:(_scroll:ElementStub,from:ElementStub,to:ElementStub,_pip:ElementStub,owns:()=>boolean,onPlaying:(value:boolean)=>void)=>{
      const flight={from,to,active:false,started:0,disposed:false,playing:true,
        finish(){if(!this.playing)return;this.playing=false;onPlaying(false);},
        setActive(value:boolean){this.active=value;if(!value)this.finish();},
        start(){if(this.disposed||!this.active||!this.playing||this.started||!owns())return;this.started++;if(!context.holdMapTravel)this.finish();},
        dispose(){this.disposed=true;this.finish();}};
      mapTravels.push(flight);return flight;
    },
    ...albumModel,
    createCampaignScenery:(_scroll:unknown,notify:(id:number)=>void)=>{const controller={notify,disposed:false,active:false,paintVisible:false,setActive(value:boolean,keepVisiblePaint=false){if(!this.disposed){this.active=value;this.paintVisible=value||keepVisiblePaint;}},dispose(){this.disposed=true;this.active=false;this.paintVisible=false;}};sceneryControllers.push(controller);return controller;},
    createPipIdle:(pip:ElementStub,_createImage?:()=>HTMLImageElement,alignment:'center'|'bottom'='center')=>{
      const idle={pip,alignment,disposed:false,disposals:0,
        setActive(active:boolean){if(!idle.disposed)pip.dataset.idleActive=String(active);},
        dispose(){if(idle.disposed)return;idle.disposed=true;idle.disposals++;pipLifecycle.push(`dispose:${pip.id}:${pip.isConnected}`);delete pip.dataset.idleActive;delete pip.dataset.idleReady;},
      };
      pipControllers.push(idle);return idle;
    },
    createPipAccessoryArt:(slot:ElementStub,kind:'ribbon'|'wateringCan')=>{
      const art={slot,kind,disposed:false,
        setActive(active:boolean){if(!art.disposed)slot.dataset.artActive=String(active);},
        dispose(){if(art.disposed)return;art.disposed=true;pipLifecycle.push(`accessory-dispose:${slot.id}:${slot.isConnected}`);delete slot.dataset.artActive;delete slot.dataset.artReady;},
      };
      accessoryControllers.push(art);return art;
    },
    createPipTendingPose:()=>({dispose(){}}),
    createGardenNature:(picture:ElementStub)=>{
      const nature={picture,disposed:false,disposals:0,activations:[] as boolean[],
        setActive(active:boolean){if(!nature.disposed){nature.activations.push(active);picture.dataset.natureActive=String(active);}},
        dispose(){if(nature.disposed)return;nature.disposed=true;nature.disposals++;pipLifecycle.push(`nature-dispose:${picture.id}:${picture.isConnected}`);delete picture.dataset.natureActive;delete picture.dataset.natureReady;},
      };
      natureControllers.push(nature);return nature;
    },
    AudioManager: AudioStub, t: (_language: string, key: string) => key, icon: () => '',
    Capacitor: { isNativePlatform: () => native,getPlatform:()=>native?'android':'web',isPluginAvailable:(name:string)=>Boolean(name==='PawblossomTestBilling'?billingBridge:adsBridge) },
    App:{addListener:(name:string,callback:(state:{isActive:boolean})=>void)=>{nativeEvents[name]=callback;return Promise.resolve({remove(){}});},getState:()=>nativeState,minimizeApp:()=>Promise.resolve()}, confirm: () => true,
    setTimeout: (callback: () => void, ms: number) => { timers.set(++timerId, { callback, ms }); return timerId; },
    clearTimeout: (id: number) => timers.delete(id),
  });
  const levelExports: Record<string, unknown> = {};
  vm.runInNewContext(levelsCode, {exports:levelExports});
  const pipCareExports:Record<string,unknown>={};vm.runInNewContext(pipCareCode,{exports:pipCareExports});Object.assign(context,pipCareExports);
  const gardenSpacesExports:Record<string,unknown>={};vm.runInNewContext(gardenSpacesCode,{exports:gardenSpacesExports,require:()=>levelExports});Object.assign(context,gardenSpacesExports);
  const gardenDesignExports:Record<string,unknown>={};vm.runInNewContext(gardenDesignCode,{exports:gardenDesignExports,require:(name:string)=>name==='./levels'?levelExports:name==='./journeyGarden'?journeyModel:gardenSpacesExports});Object.assign(context,gardenDesignExports);
  Object.assign(context,{require:(name:string) => {if(name==='./levels')return levelExports;if(name==='./core')return coreExports;if(name==='./pipCare')return pipCareExports;if(name==='./gardenDesign')return gardenDesignExports;if(name==='./puzzleTools')return puzzleToolsModel;throw new Error(name);}});
  const coreExports:Record<string,unknown>={}, practiceExports:Record<string,unknown>={};
  vm.runInNewContext(engineCode,{exports:coreExports});
  vm.runInNewContext(practiceCode,{exports:practiceExports,require:()=>coreExports});
  vm.runInNewContext(specialPracticeCode,{exports:practiceExports,require:()=>coreExports});
  Object.assign(context,practiceExports);
  const i18nExports:Record<string,unknown>={};
  vm.runInNewContext(i18nCode,{exports:i18nExports});
  Object.assign(context,i18nExports);
  const gardenSpaceArtExports:Record<string,unknown>={};vm.runInNewContext(gardenSpaceArtCode,{exports:gardenSpaceArtExports,require:(name:string)=>name==='./GardenPaintedArt'?paintedGardenArt:gardenStructureArt});Object.assign(context,gardenSpaceArtExports,gardenStructureArt);
  const gardenSpacesUIExports:Record<string,unknown>={};vm.runInNewContext(gardenSpacesUICode,{exports:gardenSpacesUIExports,require:(name:string)=>name==='./i18n'?i18nExports:name==='./gardenSpaces'?gardenSpacesExports:gardenSpaceArtExports});Object.assign(context,gardenSpacesUIExports);
  const gardenExports:Record<string,unknown>={};vm.runInNewContext(gardenCode,{exports:gardenExports,require:(name:string)=>name==='./gardenDesign'?gardenDesignExports:name==='./GardenPaintedArt'?paintedGardenArt:gardenStructureArt});Object.assign(context,gardenExports);
  vm.runInContext(stateCode, context);
  Object.assign(context, stateExports);
  vm.runInContext(mainCode, context);
  if(autoFrame)frame();
  // 기존 퍼즐 회귀는 실제 지도 부팅 뒤 퍼즐로 진입합니다. 지도 초기 상태는 bootMap으로 따로 검증합니다.
  if(!bootMap)vm.runInContext("switchView('puzzle')",context);
  return {
    setBounds:(selector:string,bounds:ReturnType<ElementStub['getBoundingClientRect']>)=>{rectangles.set(selector,bounds);},
    setStorageFails:(value:boolean)=>{storageFails=value;},disk:()=>[...storageValues],
    resultArtCalls:()=>resultArtCalls,frame:()=>frame(),games:()=>games,destroys:()=>destroys,
    documentEvents,windowEvents,nativeEvents,resolveNativeState,pipControllers,pipLifecycle,accessoryControllers,natureControllers,sceneryControllers,mapTravels,
    element, run: (code: string) => {const result=vm.runInContext(code, context);if(autoFrame)frame();return result;},
    resultTimers: () => [...timers.values()].filter(timer => timer.ms === 300),
    flushResults: () => [...timers].filter(([,timer]) => timer.ms === 300).forEach(([id,timer]) => {timers.delete(id);timer.callback();}),
    flushToasts: () => [...timers.values()].filter(timer => timer.ms === 3200).forEach(timer => timer.callback()),
    flushGrowth: () => [...timers.values()].filter(timer => timer.ms === 450).forEach(timer => timer.callback()),
    flushCareReaction: () => [...timers].filter(([,timer]) => timer.ms === 2400).forEach(([id,timer]) => {timers.delete(id);timer.callback();}),
    writes: () => writes, stored: () => JSON.parse(storageValues.get('pawblossom.save.v1')??'null'),
  };
}

describe('직접 고르는 산책 도구의 실제 저장/UI 경계',()=>{
  const ready=(testing=false)=>{
    const h=mainHarness(false,false,true);h.run(`save.highestLevel=${testing?2:69};save.coins=200;startLevel(6,${testing});switchView('puzzle')`);h.frame();
    h.run('const toolOriginalPrepare=preparePuzzleTool;preparePuzzleTool=(r,id,a,b)=>toolOriginalPrepare(r,id,a,b,toolSeededRng(8))');return h;
  };
  const select=(h:ReturnType<typeof mainHarness>,id='trowel')=>{
    h.run(`showToolInfo('${id}','tool-${id}')`);h.element('#tool-info-start').onclick();h.run('scene.toolTarget({row:0,col:0})');
  };
  it('5개 잠금은 정상 도달에서만 열리고 잠금 설명은 이동·재화·체험을 쓰지 않는다',()=>{
    const h=mainHarness(false,false,true),before=h.disk(),writes=h.writes();expect(h.element('#tool-shelf').innerHTML.match(/data-locked="true"/g)).toHaveLength(5);
    h.run("showToolInfo('trowel','tool-trowel')");expect(h.run('toolDialog.innerHTML')).toContain(t('en','toolUnlock').replace('{level}','9'));expect(h.run('toolDialog.innerHTML')).not.toContain('class="tool-info-pip"');h.element('#tool-info-start').onclick();expect(h.run('toolMode')).toBeUndefined();
    h.element('#tool-info-close').onclick();expect(h.disk()).toEqual(before);expect(h.writes()).toBe(writes);expect(h.run('save.puzzleTools.trialUsed')).toEqual([]);
  });
  it('소개는 첫 무료 체험을 소비하지 않고 확정은 비용/판/집계를 한 번만 저장하며 이동은 유지한다',()=>{
    const h=ready(),moves=h.run('moves');select(h);expect(h.run('save.puzzleTools.introduced')).toEqual(['trowel']);expect(h.run('save.puzzleTools.trialUsed')).toEqual([]);
    const writes=h.writes(),use=h.element('#tool-confirm').onclick;expect(h.element('#tool-confirm').disabled).toBe(false);use();const stored=h.stored();
    expect(h.writes()-writes).toBe(2);expect(stored.puzzleTools.trialUsed).toEqual(['trowel']);expect(stored.inProgress).toMatchObject({moves,toolsUsed:['trowel'],toolsStarted:true});expect(stored.coins).toBe(200);expect(h.run('moves')).toBe(moves);
    expect(h.run('scene.busy')).toBe(false);use();h.run('scene.completePrepared()');expect(h.stored()).toEqual(stored);expect(h.writes()-writes).toBe(2);expect(h.run('moves')).toBe(moves);
    expect(h.element('#tool-shelf').innerHTML).toContain('data-tool="trowel" data-locked="false" data-used="true"');expect(h.element('#tool-shelf').innerHTML).toContain(t('en','toolUsedBadge'));
    h.run('startLevel(69)');expect(h.element('#tool-shelf').innerHTML).toContain('data-tool="trowel" data-locked="false" data-used="false"');if(h.run('toolDialog.open'))h.element('#tool-info-close').onclick();h.run("showToolInfo('trowel','tool-trowel')");expect(h.run('toolDialog.innerHTML')).toContain(t('en','toolCost').replace('{coins}','30'));
  });
  it.each(['#tool-confirm','#tool-cancel'])('보드→%s 초점 이동은 같은 선택을 유지하고 버튼을 누를 수 있다',id=>{
    const h=ready();select(h);h.element('#game-canvas').listeners.blur({relatedTarget:h.element(id)} as never);expect(h.run('Boolean(toolMode)')).toBe(true);
    h.element(id).onclick();expect(h.run('toolMode')).toBeUndefined();expect(h.stored().puzzleTools.trialUsed).toEqual(id==='#tool-confirm'?['trowel']:[]);
  });
  it('도구 컨트롤 밖으로 보드 초점이 이동하면 선택과 낡은 확정을 폐기한다',()=>{
    const h=ready();select(h);const use=h.element('#tool-confirm').onclick,writes=h.writes();h.element('#game-canvas').listeners.blur({relatedTarget:h.element('#settings-button')} as never);
    expect(h.run('toolMode')).toBeUndefined();use();expect(h.writes()).toBe(writes);expect(h.stored().puzzleTools.trialUsed).toEqual([]);
  });
  it('저장 실패는 무료기록/지갑/live보드/회차를 그대로 두고 재시도 뒤30코인만 쓴다',()=>{
    const h=ready();h.run("save.puzzleTools={schema:2,introduced:['trowel'],trialUsed:['trowel']};checkpoint()");select(h);
    const memory=h.run('JSON.stringify({save,roundTools,score,collected,board:scene.snapshot(),moves})'),disk=h.disk(),use=h.element('#tool-confirm').onclick;h.setStorageFails(true);use();
    expect(h.disk()).toEqual(disk);expect(h.run('JSON.stringify({save,roundTools,score,collected,board:scene.snapshot(),moves})')).toBe(memory);
    h.setStorageFails(false);h.element('#save-retry').onclick();use();h.run('scene.completePrepared()');expect(h.stored().coins).toBe(170);expect(h.stored().inProgress.toolsUsed).toEqual(['trowel']);
  });
  it.each(['cancel','language','route','hidden','scene'] as const)('%s 뒤 남은 확정 콜백은 비용/사용/보드를 바꾸지 않는다',change=>{
    const h=ready();select(h);const use=h.element('#tool-confirm').onclick;
    if(change==='cancel')h.element('#tool-cancel').onclick();if(change==='language')h.run("changeLanguage('ko')");if(change==='route')h.run("switchView('map')");if(change==='hidden')h.run('document.hidden=true;syncActivity()');if(change==='scene'){h.run('startLevel(6)');h.frame();}
    const before=h.run('JSON.stringify({save,roundTools,board:scene.snapshot(),moves})'),writes=h.writes();use();expect(h.run('JSON.stringify({save,roundTools,board:scene.snapshot(),moves})')).toBe(before);expect(h.writes()).toBe(writes);
  });
  it('원래 특수 대상은 확정할 수 없고 사용한 도구/두 종 제한도 다시 사용할 수 없다',()=>{
    const h=ready();h.run("scene.engine.board[0][0].special='row';checkpoint()");select(h);expect(h.element('#tool-confirm').disabled).toBe(true);const writes=h.writes();h.element('#tool-confirm').onclick();expect(h.writes()).toBe(writes);
    h.element('#tool-cancel').onclick();h.run("roundTools={profile:'tools-v2',used:['trowel','broom'],started:true};checkpoint();showToolInfo('bell','tool-bell')");expect(h.run('toolDialog.innerHTML')).toContain(t('en','toolRoundLimit'));const before=h.disk();h.element('#tool-info-start').onclick();expect(h.disk()).toEqual(before);expect(h.run('toolMode')).toBeUndefined();
  });
  it('시험판은 정상 해금/무료사용/재화/원본 판에 기록하지 않는다',()=>{
    const h=ready(true),before=h.disk(),writes=h.writes(),normal=h.run('JSON.stringify(save)');select(h);h.element('#tool-confirm').onclick();h.run('scene.completePrepared()');
    expect(h.disk()).toEqual(before);expect(h.writes()).toBe(writes);expect(h.run('JSON.stringify(save)')).toBe(normal);expect(h.run('roundTools.used')).toEqual(['trowel']);
  });
  it('교환 도구의 승리는 첫 보상과 소비만 저장하고 연출 완료/결과 재방문은 다시 쓰지 않는다',()=>{
    const h=ready();h.run('roundTools.started=true;scene.engine.leaves=scene.engine.leaves.map(r=>r.map(()=>0));clearedLeaves=levels[5].leaves.length;for(const g of levels[5].goals)collected[g.kind]=g.count-(g===levels[5].goals[0]?1:0);const goalKind=levels[5].goals[0].kind;scene.engine.board=scene.engine.board.map((line,r)=>line.map((t,c)=>({kind:(r+c*2)%6})));for(const p of [{row:0,col:0},{row:0,col:2},{row:1,col:1}])scene.engine.board[p.row][p.col]={kind:goalKind};scene.engine.board[0][1]={kind:(goalKind+1)%6};checkpoint()');
    h.run("showToolInfo('gloves','tool-gloves')");h.element('#tool-info-start').onclick();h.run('scene.toolTarget({row:0,col:1});scene.toolTarget({row:1,col:1})');
    const before=h.stored(),writes=h.writes(),moves=h.run('moves');expect(h.element('#tool-confirm').disabled).toBe(false);h.element('#tool-confirm').onclick();expect(h.stored().inProgress).toBeUndefined();expect(h.stored().coins).toBe(before.coins+40);expect(h.stored().stars).toBe(before.stars+1);expect(h.writes()-writes).toBe(2);
    h.run('scene.completePrepared()');expect(h.element('#result-dialog').open).toBe(true);expect(h.run('resultGardenPlan.id')).toBe('bed-1');expect(h.element('#result-garden-card').hidden).toBe(false);expect(h.run('moves')).toBe(moves);expect(h.writes()-writes).toBe(2);h.run("switchView('map');switchView('puzzle');finish(true)");expect(h.writes()-writes).toBe(2);
  });
  it('해금 소개는 저장된 새 판의 첫 퍼즐 진입에도 나오고 닫은 뒤 중복 표시/체험 소비가 없다',()=>{
    const h=ready();h.run("save.highestLevel=9;startLevel(9);switchView('map')");h.frame();h.run("switchView('puzzle')");expect(h.run('toolDialog.open')).toBe(true);expect(h.run('toolDialog.innerHTML')).toContain(t('en','toolPipInvite'));expect(h.run('moves')).toBe(h.run('levels[8].moves'));
    h.element('#tool-info-close').onclick();expect(h.stored().puzzleTools.introduced).toEqual(['trowel']);expect(h.stored().puzzleTools.trialUsed).toEqual([]);expect(h.stored().inProgress.toolsStarted).toBe(false);
    h.run("switchView('map');switchView('puzzle')");expect(h.run('toolDialog.open')).toBe(false);h.run("showToolInfo('trowel','tool-trowel')");expect(h.run('toolDialog.innerHTML')).not.toContain('class="tool-info-pip"');expect(h.stored().puzzleTools.trialUsed).toEqual([]);
  });
});

describe('첫 보상에서 새 정원 작업으로 이어가기',()=>{
  it('별1→2의 확정된 첫 보상만 안내하고 이동·결과 재방문은 소비/보상/소리를 반복하지 않는다',()=>{
    const h=mainHarness();h.run('finish(true)');
    expect(h.run('resultGardenPlan.id')).toBe('bed-1');expect(h.element('#result-garden-card').hidden).toBe(false);
    const disk=h.disk(),writes=h.writes(),sounds=h.run('audio.plays.slice()'),art=h.resultArtCalls();let focus=0;
    h.element('#garden-stage').focus=()=>focus++;h.element('#result-garden-open').onclick();
    expect(h.run('route')).toBe('village');expect(h.element('#result-dialog').open).toBe(false);expect(focus).toBe(1);
    h.run("switchView('puzzle')");expect(h.element('#result-dialog').open).toBe(true);expect(h.element('#result-garden-card').hidden).toBe(false);
    h.run('finish(true);updateResultCopy()');expect(h.disk()).toEqual(disk);expect(h.writes()).toBe(writes);expect(h.run('audio.plays')).toEqual(sounds);expect(h.resultArtCalls()).toBe(art);
  });
  it.each(['ready','replay','practice','loss','storage'] as const)('%s에서는 새로운 작업을 안내하지 않는다',reason=>{
    const h=mainHarness(false,false,true);
    if(reason==='ready')h.run('save.stars=2');
    if(reason==='replay')h.run('startLevel(1)');
    if(reason==='practice')h.run('startLevel(2,true)');
    if(reason==='storage')h.setStorageFails(true);
    h.run(`finish(${reason!=='loss'})`);expect(h.element('#result-garden-card').hidden).toBe(true);expect(h.run('resultGardenPlan')).toBeUndefined();
  });
  it.each(['new-round','owner','made','hidden','inactive','busy'] as const)('%s 뒤 오래된 결과 버튼은 이동/소비하지 않는다',reason=>{
    const h=mainHarness();h.run('finish(true)');const click=h.element('#result-garden-open').onclick;
    if(reason==='new-round')h.run('startLevel(3)');
    if(reason==='owner')h.run('save=JSON.parse(JSON.stringify(save))');
    if(reason==='made')h.run('save.garden=1');
    if(reason==='hidden')h.run('document.hidden=true');
    if(reason==='inactive')h.run('nativeActive=false');
    if(reason==='busy')h.run('puzzleProcessing=true');
    const disk=h.disk(),writes=h.writes();click();expect(h.run('route')).toBe('puzzle');expect(h.disk()).toEqual(disk);expect(h.writes()).toBe(writes);
  });
  it('언어 변경은 같은 버튼/콜백을 유지하고 소유 변경 후 재방문은 안내를 숨긴다',()=>{
    const h=mainHarness();h.run('finish(true)');const button=h.element('#result-garden-open'),click=button.onclick;
    h.run("changeLanguage('ko')");expect(h.element('#result-garden-title').textContent).toBe(t('ko','resultGardenReady'));expect(h.element('#result-garden-name').textContent).toBe(t('ko','goalBed').replace('{number}','1'));expect(button.onclick).toBe(click);
    h.element('#result-garden-open').onclick();h.run("save=JSON.parse(JSON.stringify(save));save.garden=1;switchView('puzzle')");expect(h.element('#result-garden-card').hidden).toBe(true);expect(button.disabled).toBe(true);
  });
});

describe('숲길 에피소드의 실제 UI 연결',()=>{
  it('시험판 미리보기·HUD·결과와 한영 갱신이 재화/일반 진행을 건드리지 않는다',()=>{
    const h=mainHarness(false,false,true);h.run("startLevel(4,true);switchView('puzzle')");const disk=h.disk(),writes=h.writes();
    expect(h.element('#trail-encounter').hidden).toBe(false);expect(h.element('#trail-encounter').dataset.active).toBe('true');
    h.run("showStagePreview(4,'restart',document.querySelector('#restart'))");
    expect(h.run('previewDialog.innerHTML')).toContain(t('en','trailPractice'));expect(h.element('#trail-encounter').dataset.active).toBe('false');
    h.element('#preview-cancel').onclick();h.run('scene.hooks.onMove([0,0,0,14,12,0],100,1,4)');h.flushResults();
    expect(h.element('#result-dialog').innerHTML).toContain(t('en','trailFirstAfter'));expect(h.element('#result-dialog').innerHTML).toContain(t('en','trailPractice'));
    expect(h.element('#trail-encounter').dataset.resolved).toBe('true');expect(h.element('#trail-encounter').dataset.active).toBe('false');
    expect(h.disk()).toEqual(disk);expect(h.writes()).toBe(writes);
    h.run("changeLanguage('ko')");expect(h.element('#result-trail').innerHTML).toContain(t('ko','trailFirstAfter'));
  });
  it('정상 첫 완료의 기존 보상만 한 번 주며 결과 재방문은 같은 기억을 표시한다',()=>{
    const initial={version:1,language:'ko',highestLevel:4,completed:[1,2,3],stars:3,coins:120,garden:0,music:false,sfx:false,tutorialSeen:true};
    const h=mainHarness(false,false,false,false,initial);
    h.run('scene.hooks.onMove([0,0,0,14,12,0],100,1,4)');h.flushResults();
    expect(h.run('save.stars')).toBe(4);expect(h.run('save.coins')).toBe(160);expect(h.run('save.completed')).toEqual([1,2,3,4]);
    expect(h.element('#result-dialog').innerHTML).toContain(t('ko','trailFirstAfter'));const disk=h.disk(),writes=h.writes(),art=h.resultArtCalls();
    h.run("switchView('village');switchView('puzzle')");expect(h.element('#result-dialog').open).toBe(true);expect(h.element('#result-dialog').innerHTML).toContain(t('ko','trailFirstAfter'));
    expect(h.disk()).toEqual(disk);expect(h.writes()).toBe(writes);expect(h.resultArtCalls()).toBe(art);
  });
  it('낙엽 없는 다른 판·다른 탭·비활성에서는 늑대 표시/움직임을 남기지 않는다',()=>{
    const h=mainHarness(false,false,true);h.run("startLevel(6,true);switchView('puzzle')");expect(h.element('#trail-encounter').dataset.active).toBe('true');
    h.run("document.hidden=true;syncActivity()");expect(h.element('#trail-encounter').dataset.active).toBe('false');
    h.run("document.hidden=false;syncActivity();switchView('map')");expect(h.element('#trail-encounter').dataset.active).toBe('false');
    h.run("startLevel(5,true);switchView('puzzle')");expect(h.element('#trail-encounter').hidden).toBe(true);expect(h.element('#trail-encounter').innerHTML).toBe('');
  });
});

describe('현재 회차의 힌트 목표 조회',()=>{
  it('남은 색 목표를 0 이상으로 읽고 조회만으로 저장하지 않습니다',()=>{
    const h=mainHarness(false,false,true);h.run('startLevel(6,true);scene.hooks.onMove([15,0,0,0,0,7],200,1,1)');const writes=h.writes(),disk=h.disk();
    expect(h.run('scene.hooks.getHintGoals()')).toEqual({colors:[{kind:5,remaining:9},{kind:0,remaining:0}],leaves:true,crates:false});
    h.run('scene.hooks.getHintGoals()');expect(h.writes()).toBe(writes);expect(h.disk()).toEqual(disk);
  });
  it('상자 목표가 완료되면 후속 힌트의 상자 관련도를 사용하지 않습니다',()=>{
    const h=mainHarness(false,false,true);h.run('startLevel(levels.find(level=>level.crates?.length).id,true)');expect(h.run('scene.hooks.getHintGoals().crates')).toBe(true);
    h.run('clearedCrates=levels[currentLevel-1].crates.length');expect(h.run('scene.hooks.getHintGoals().crates')).toBe(false);
  });
  it('새 회차·다른 Scene·종료·체험에는 이전 목표 조회를 거부합니다',()=>{
    for(const reason of ['round','scene','ended','demo']){
      const h=mainHarness(false,false,true);h.run('priorHintScene=scene;startLevel(6,true)');const read=h.run('scene.hooks.getHintGoals');expect(read()).toBeDefined();
      if(reason==='round')h.run('startLevel(7,true)');if(reason==='scene')h.run('scene=priorHintScene');if(reason==='ended')h.run('roundEnded=true');if(reason==='demo')h.run('careDemo=true');
      expect(read()).toBeUndefined();
    }
  });
});

describe('첫 완료 뒤 지도의 단회 핍 이동',()=>{
  it('현재 최고레벨 첫 성공만 다음 발판으로 이동하며 완료 보상을 다시 쓰지 않습니다',()=>{
    const h=mainHarness();h.run('holdMapTravel=true;finish(true)');expect(h.mapTravels).toHaveLength(0);
    const disk=h.disk(),writes=h.writes();h.element('#result-home').onclick();
    expect(h.mapTravels).toHaveLength(1);const flight=h.mapTravels[0];
    expect(flight.from).toBe(h.element('#map-stage-2'));expect(flight.to).toBe(h.element('#map-stage-3'));expect(flight.started).toBe(1);expect(flight.playing).toBe(true);
    expect(h.stored()).toMatchObject({highestLevel:3,completed:[1,2],stars:2,coins:80});expect(h.disk()).toEqual(disk);expect(h.writes()).toBe(writes);
    flight.finish();expect(flight.playing).toBe(false);h.run("switchView('journal');switchView('map')");expect(h.mapTravels).toHaveLength(1);expect(h.disk()).toEqual(disk);expect(h.writes()).toBe(writes);
  });
  it.each(['replay','test','failure','final'] as const)('%s 결과에는 다음 위치 이동을 만들지 않습니다',reason=>{
    const h=mainHarness(false,false,true);
    if(reason==='replay')h.run('startLevel(1);finish(true)');
    if(reason==='test')h.run('startLevel(3,true);finish(true)');
    if(reason==='failure')h.run('finish(false)');
    if(reason==='final')h.run('save.highestLevel=500;save.completed=Array.from({length:499},(_,index)=>index+1);startLevel(500);finish(true)');
    h.element('#result-home').onclick();expect(h.run('route')).toBe('map');expect(h.mapTravels).toHaveLength(0);
  });
  it('지도로 돌아오기 전 새 판 시작과 비활성은 예약을 폐기합니다',()=>{
    const next=mainHarness();next.run('finish(true)');next.element('#result-next').onclick();next.run("switchView('map')");expect(next.mapTravels).toHaveLength(0);
    const hidden=mainHarness();hidden.run('finish(true);nativeActive=false;syncPipActivity();nativeActive=true;syncPipActivity()');hidden.element('#result-home').onclick();expect(hidden.mapTravels).toHaveLength(0);
  });
  it('재생 중 비활성·지도 교체는 한 번 정리하고 다시 활성화해도 재생하지 않습니다',()=>{
    const h=mainHarness();h.run('holdMapTravel=true;finish(true)');h.element('#result-home').onclick();const flight=h.mapTravels[0],disk=h.disk(),writes=h.writes();
    h.run('nativeActive=false;syncPipActivity()');expect(flight.playing).toBe(false);
    h.run("nativeActive=true;syncPipActivity();changeLanguage('ko')");const languageWrites=h.writes(),languageDisk=h.disk();
    h.run("switchView('journal');switchView('map')");expect(flight.disposed).toBe(true);expect(flight.started).toBe(1);expect(h.mapTravels).toHaveLength(1);
    expect(h.stored()).toMatchObject({highestLevel:3,completed:[1,2],stars:2,coins:80,language:'ko'});expect(languageWrites).toBeGreaterThan(writes);expect(languageDisk).not.toEqual(disk);expect(h.writes()).toBe(languageWrites);expect(h.disk()).toEqual(languageDisk);
  });
  it('현재 위치 버튼은 걷기를 취소하고 정지 위치의 대기 동작을 복구합니다',()=>{
    const h=mainHarness();h.run('holdMapTravel=true;finish(true)');h.element('#result-home').onclick();const flight=h.mapTravels[0],writes=h.writes();
    h.element('#map-locate').onclick();expect(flight.disposed).toBe(true);expect(h.run('mapTravel')).toBeUndefined();expect(h.element('#map-view').dataset.motionActive).toBe('true');expect(h.writes()).toBe(writes);
  });
  it('걷는 동안 막은 장 콜백을 종료 후 같은 ID로 다시 받으면 상단에 반영합니다',()=>{
    const h=mainHarness();h.run('holdMapTravel=true;finish(true)');h.element('#result-home').onclick();const observer=h.sceneryControllers.at(-1)!;
    observer.notify(10);expect(h.run('selectedChapter')).toBe(1);
    h.mapTravels[0].finish();observer.notify(10);expect(h.run('selectedChapter')).toBe(10);expect(h.element('#map-world-name').textContent).toBe(h.run('mapWorldLabel(10).name'));expect(h.element('#map-world-range').textContent).toBe(h.run('mapWorldLabel(10).range'));
  });
  it('저장 복구로 객체 소유자가 바뀌면 이전 완료의 이동 예약을 사용하지 않습니다',()=>{
    const h=mainHarness();h.run('finish(true);save={...save}');const disk=h.disk(),writes=h.writes();
    h.element('#result-home').onclick();expect(h.mapTravels).toHaveLength(0);expect(h.run('mapAdvance')).toBeUndefined();expect(h.disk()).toEqual(disk);expect(h.writes()).toBe(writes);
  });
});

describe('무료 추천 코디의 미리보기와 저장 경계',()=>{
  const boot=()=>{const h=mainHarness();h.run("save.garden=2;switchView('village')");return h;};
  it('선택·비교·취소는 원래 저장/정원을 보존하고 원래 버튼으로 초점을 돌립니다',()=>{
    const h=boot(),before=h.run('JSON.stringify(save)'),disk=h.disk(),writes=h.writes();
    h.run("globalThis.lookFocus=[];document.querySelector('#garden-look-open').focus=o=>lookFocus.push(o.preventScroll)");h.element('#garden-look-open').onclick();expect(h.run('lookDialog.open')).toBe(true);
    h.run('spaceDialog.listeners.close({preventDefault(){}});lookDialog.listeners.close({preventDefault(){}})');expect(h.run('lookDialog.open&&Boolean(lookPreview)')).toBe(true);
    h.element('#garden-look-butterfly').onclick();expect(h.run('lookDialog.innerHTML')).toContain(t('en','lookNeedButterflies'));
    h.element('#garden-look-sunny').onclick();h.element('#garden-look-current').onclick();h.element('#garden-look-after').onclick();h.element('#garden-look-cancel').onclick();
    expect(h.run('lookPreview')).toBeUndefined();expect(h.run('JSON.stringify(save)')).toBe(before);expect(h.disk()).toEqual(disk);expect(h.writes()).toBe(writes);expect(h.run('lookFocus')).toEqual([true]);
  });
  it('적용은 재화/핍/공간/보드를 보존한 한 payload이며 낡은 확인·같은 코디는 다시 쓰지 않습니다',()=>{
    const h=boot(),before=h.run('JSON.stringify({coins:save.coins,stars:save.stars,pip:save.pip,spaces:save.gardenDesign?.spaces,board:scene.engine.board})'),writes=h.writes();
    h.element('#garden-look-open').onclick();const old=h.element('#garden-look-confirm').onclick;old();
    // SaveStore는 기존 본문과 복구용 백업을 각각 한 번 기록합니다.
    expect(h.run('save.gardenDesign.flowers')).toEqual(['daisy','meadow','meadow','meadow','meadow']);expect(h.writes()).toBe(writes+2);expect(h.stored().gardenDesign.flowers[0]).toBe('daisy');
    expect(h.run('JSON.stringify({coins:save.coins,stars:save.stars,pip:save.pip,spaces:save.gardenDesign?.spaces,board:scene.engine.board})')).toBe(before);
    old();h.element('#garden-look-open').onclick();expect(h.run('lookDialog.innerHTML')).toContain(t('en','lookSame'));h.element('#garden-look-confirm').onclick();expect(h.writes()).toBe(writes+2);
  });
  it('저장 실패나 배경 전환·DOM 교체 후 낡은 확인은 수동 디자인을 덮어쓰지 않습니다',()=>{
    for(const action of ['fail','hidden','replace','language','route']){
      const h=boot(),before=h.run('JSON.stringify(save.gardenDesign)');h.element('#garden-look-open').onclick();const old=h.element('#garden-look-confirm').onclick;
      if(action==='fail')h.setStorageFails(true);
      if(action==='hidden')h.run('document.hidden=true;syncActivity()');
      if(action==='replace')h.run('renderViews()');
      if(action==='language')h.run("changeLanguage('ko')");
      if(action==='route')h.run("switchView('journal')");
      old();expect(h.run('JSON.stringify(save.gardenDesign)'),action).toBe(before);
    }
  });
  it('체험 코디는 정상 지갑/정원/판을 저장하지 않고 체험 종료 시 버립니다',()=>{
    const h=mainHarness(false,false,true),before=h.run('JSON.stringify(save)'),disk=h.disk();h.run("switchView('village')");expect(h.run('enterCareDemo()')).toBe(true);h.run("save.garden=2;renderViews()");
    h.element('#garden-look-open').onclick();h.element('#garden-look-confirm').onclick();expect(h.run('save.gardenDesign.flowers[0]')).toBe('daisy');
    h.run('exitCareDemo()');expect(h.run('JSON.stringify(save)')).toBe(before);expect(h.disk()).toEqual(disk);
  });
});

describe('핍 꽃 돌보기의 실제 화면 수명',()=>{
  it('무료 Lv3 행동의 물뿌리개는 하나이며 저장/수치/판을 바꾸지 않고 숨김·모달·종료를 따릅니다',()=>{
    const h=mainHarness();h.run("save.pip={growth:60,affection:40,owned:['ribbon'],equipped:'ribbon'};switchView('journal')");
    const before=h.run('JSON.stringify(save)'),disk=h.disk(),writes=h.writes();h.element('#pip-tend').onclick();
    const html=h.element('#journal-view').innerHTML;expect(html.match(/data-pip-accessory="wateringCan"/g)).toHaveLength(1);expect(html).toContain('pip-tending-scene');expect(h.element('#journal-pip-portrait').dataset.tendActive).toBe('true');
    h.run('document.hidden=true;syncActivity()');expect(h.element('#journal-pip-portrait').dataset.tendActive).toBe('false');h.run('document.hidden=false;syncActivity()');
    h.run('resourceDialog.open=true;syncActivity()');expect(h.element('#journal-pip-portrait').dataset.tendActive).toBe('false');h.run('resourceDialog.open=false;syncActivity()');
    h.flushCareReaction();expect(h.element('#journal-view').innerHTML).not.toContain('pip-tending-scene');expect(h.element('#journal-view').innerHTML).toContain('data-pip-accessory="ribbon"');expect(h.run('JSON.stringify(save)')).toBe(before);expect(h.disk()).toEqual(disk);expect(h.writes()).toBe(writes);
  });
  it('정원 동작에는 핍 화면의 받침꽃을 덧붙이지 않고 재렌더/교체는 이전 반응을 되살리지 않습니다',()=>{
    const h=mainHarness();h.run("save.pip={growth:60,affection:40,owned:[],equipped:'none'};switchView('village')");h.element('#garden-tend').onclick();expect(h.element('#village-view').innerHTML).not.toContain('pip-tending-scene');
    // 이 VM의 표시 시각만 고정합니다. CPU/렌더가100ms 이내라는 가정을 두지 않습니다.
    // 정원과 핍 탭의 행동은 별개입니다. 정원 이탈 후 핍 탭에서 새 무료 행동을 시작합니다.
    h.run("switchView('journal')");h.element('#pip-tend').onclick();h.run("const fixedTendNow=Date.now();Date.now=()=>fixedTendNow;careReactionStarted=fixedTendNow-900;renderViews()");expect(h.element('#journal-view').innerHTML).toContain('--tend-elapsed:900ms');
    h.element('#pip-feed').onclick();expect(h.element('#journal-view').innerHTML).not.toContain('pip-tending-scene');expect(h.run('pipReaction')).toBe('feed');
  });
});

describe('보드 고밀도 표시와 월드 분리',()=>{
  it('Game 버퍼만960으로 만들고8x8 엔진과 화면 규칙은 유지합니다',()=>{
    const h=mainHarness();expect(h.run('game.config.width')).toBe(960);expect(h.run('game.config.height')).toBe(960);
    expect(h.run('scene.engine.rows')).toBe(8);expect(h.run('scene.engine.cols')).toBe(8);
  });
});
describe('독립 스테이지 지도',()=>{
  const boot=()=>mainHarness(false,false,false,false,undefined,true,undefined,undefined,true);
  it('보이는 모달의 지도 그림만 유지하고 실제 비활성·경로 이탈에서는 해제합니다',()=>{
    const h=boot(),observer=h.sceneryControllers.find(c=>!c.disposed)!,before=h.run('JSON.stringify(save)'),writes=h.writes();
    h.element('#map-play').onclick();expect(h.run('previewDialog.open')).toBe(true);expect(observer.active).toBe(false);expect(observer.paintVisible).toBe(true);
    for(const [off,on] of [['nativeActive=false','nativeActive=true'],['document.hidden=true','document.hidden=false'],["document.querySelector('#map-view').hidden=true","document.querySelector('#map-view').hidden=false"],['testAds={pausesGame:true}','testAds=undefined'],['testBilling={pausesGame:true}','testBilling=undefined']]){
      h.run(off+';syncPipActivity()');expect(observer.paintVisible).toBe(false);h.run(on+';syncPipActivity()');expect(observer.paintVisible).toBe(true);expect(observer.active).toBe(false);
    }
    h.element('#preview-cancel').onclick();expect(observer.active).toBe(true);h.element('#stars-help').onclick();expect(h.run('resourceDialog.open')).toBe(true);expect(observer.active).toBe(false);expect(observer.paintVisible).toBe(true);
    h.element('#resource-help-close').onclick();expect(observer.active).toBe(true);h.run("switchView('journal')");expect(observer.paintVisible).toBe(false);expect(h.run('JSON.stringify(save)')).toBe(before);expect(h.writes()).toBe(writes);
  });
  it('지도 관측·정원·핍·퍼즐의 곡을 연결하고 설정/오래된 지도 알림은 다른 화면의 곡을 바꾸지 않습니다',()=>{
    const h=boot(),before=h.run('JSON.stringify(save)'),writes=h.writes();expect(h.run('audio.theme')).toBe('meadow');
    const observer=h.sceneryControllers.find(c=>!c.disposed)!;observer.notify(3);expect(h.run('audio.theme')).toBe('brook');expect(h.element('#map-world-name').textContent).toBe('Sunlit Brook');expect(h.element('#map-world-range').textContent).toBe('21–40');
    h.run("switchView('village')");expect(h.run('audio.theme')).toBe('garden');observer.notify(10);expect(h.run('audio.theme')).toBe('garden');
    h.run("switchView('journal')");expect(h.run('audio.theme')).toBe('pip');h.run("switchView('settings')");expect(h.run('audio.theme')).toBe('pip');
    h.run("switchView('puzzle')");expect(h.run('audio.theme')).toBe('meadow');expect(h.run('JSON.stringify(save)')).toBe(before);expect(h.writes()).toBe(writes);
  });
  it('숨은지도는재생성하지않고복귀시최신진행·언어로만들며오래된알림은거절합니다',()=>{
    const h=boot(),initial=h.sceneryControllers.length,observer=h.sceneryControllers.find(c=>!c.disposed)!,play=h.element('#map-play').onclick,locate=h.element('#map-locate').onclick;
    h.run("switchView('journal');renderViews();renderViews();changeLanguage('ko')");expect(h.sceneryControllers).toHaveLength(initial);expect(observer.disposed).toBe(false);expect(observer.active).toBe(false);const hiddenChapter=h.run('selectedChapter');play();locate();expect(h.run('stagePreview')).toBeUndefined();expect(h.run('selectedChapter')).toBe(hiddenChapter);
    h.run("switchView('puzzle');startLevel(1);finish(true)");expect(h.sceneryControllers).toHaveLength(initial);expect(h.stored().highestLevel).toBe(2);
    h.run("switchView('map')");expect(h.sceneryControllers).toHaveLength(initial+1);expect(observer.disposed).toBe(true);expect(h.element('#map-view').innerHTML).toContain('aria-current="step"');expect(h.element('#map-view').innerHTML).toContain('스테이지 2');
    const chapter=h.run('selectedChapter'),label=h.element('#map-world-name').textContent;observer.notify(10);expect(h.run('selectedChapter')).toBe(chapter);expect(h.element('#map-world-name').textContent).toBe(label);
  });
  it('지도에서 부팅하고 보드는 같은 Scene으로 일시중단하며100단계 잠금/완료/현재 상태를 표시합니다',()=>{
    const h=boot();expect(h.run('route')).toBe('map');expect(h.run('game.paused')).toBe(true);expect(h.element('#game-canvas').tabIndex).toBe(-1);
    const html=h.element('#map-view').innerHTML;expect(html.match(/data-level="/g)).toHaveLength(500);
    expect(html.match(/data-world-start="true"/g)).toHaveLength(25);
    expect(html).not.toContain('class="campaign-island"');
    expect(html).not.toMatch(/class="trail-(earth|edge|surface|gravel)"/);
    expect(html.match(/class="trail-dots"/g)).toHaveLength(61);
    expect(html).not.toContain('map-world-gateway');expect(html).not.toContain('map-gateway-branch');
    expect(html.match(/data-world-title="integrated"/g)).toHaveLength(31);
    expect(new Set([...html.matchAll(/id="map-chapter-title-(\d+)"/g)].map(match=>match[1])).size).toBe(31);
    expect(html.match(/preserveAspectRatio="xMidYMid slice"/g)).toHaveLength(69);
    expect(html).toContain('viewBox="627 627 627 627"');expect(html).toContain('data-map-src="/assets/campaign/worlds-atlas-v1.png"');
    expect(html).toMatch(/id="map-stage-2"[^>]+aria-current="step"/);
    expect(html).toMatch(/data-level="3" disabled/);expect(html).toContain(t('en','levelCompleted'));
    expect(h.element('#village-view').innerHTML).not.toContain('data-level=');
  });
  it('지도 미리보기의 취소/이어하기는 보드·회차·지갑·저장 쓰기를 보존하고 잠금은 거부합니다',()=>{
    const h=boot(),before=h.run('JSON.stringify({round,moves,collected,save,board:scene.engine.board})'),disk=h.disk(),writes=h.writes();
    h.element('#map-play').onclick();expect(h.run('stagePreview.route')).toBe('map');expect(h.run('previewDialog.innerHTML')).not.toContain('id="preview-remaining"');expect(h.run('previewDialog.innerHTML')).toContain(t('en','previewStartAction'));h.element('#preview-cancel').onclick();
    expect(h.run('route')).toBe('map');expect(h.run('JSON.stringify({round,moves,collected,save,board:scene.engine.board})')).toBe(before);
    h.run("showStagePreview(3,'map',document.querySelector('#map-stage-3'))");expect(h.run('stagePreview')).toBeUndefined();
    h.element('#map-play').onclick();h.run("confirmStagePreview(stagePreview,'continue')");expect(h.run('route')).toBe('puzzle');
    expect(h.run('JSON.stringify({round,moves,collected,save,board:scene.engine.board})')).toBe(before);expect(h.disk()).toEqual(disk);expect(h.writes()).toBe(writes);
  });
  it('탐색 위치와 진행을 언어 변경·설정 왕복에서도 보존하고 현재 위치 버튼만 명시 이동합니다',()=>{
    const h=boot();h.run("document.querySelector('#campaign-scroll').scrollTop=613;globalThis.beforeMap=JSON.stringify(scene.engine.board);changeLanguage('ko')");
    expect(h.element('#campaign-scroll').scrollTop).toBe(613);expect(h.element('#map-view').innerHTML).toContain('꽃바람 초원');expect(h.element('#map-view').innerHTML).toContain('id="map-world-range" class="campaign-world-range">1–20</span>');
    h.element('#settings-button').onclick();expect(h.run('route')).toBe('settings');h.element('#settings-button').onclick();expect(h.run('route')).toBe('map');
    expect(h.element('#campaign-scroll').scrollTop).toBe(613);expect(h.run('JSON.stringify(scene.engine.board)')).toBe(h.run('beforeMap'));
    h.run("globalThis.located=false;document.querySelector('#map-stage-2').scrollIntoView=()=>{located=true}");h.element('#map-locate').onclick();expect(h.run('located')).toBe(true);
  });
  it('저장된 진행 판도 지도에서 복원하고 이어하기가 같은 보드와 잔량을 유지합니다',()=>{
    const original=mainHarness();original.run('scene.hooks.onMove([1,2,0,0,0,0],30)');
    const h=mainHarness(false,false,false,false,original.stored(),true,undefined,undefined,true);
    expect(h.run('route')).toBe('map');expect(h.run('game.paused')).toBe(true);expect(h.run('moves')).toBe(23);
    expect(h.run('JSON.stringify(scene.engine.board)')).toBe(original.run('JSON.stringify(scene.engine.board)'));
    const state=h.run('JSON.stringify({round,moves,score,collected,save,board:scene.engine.board})'),disk=h.disk(),writes=h.writes();
    h.element('#map-play').onclick();expect(h.run('previewDialog.innerHTML')).toContain('id="preview-remaining"');expect(h.run('previewDialog.innerHTML')).toContain('Moves remaining: 23.');
    h.run("confirmStagePreview(stagePreview,'continue')");expect(h.run('route')).toBe('puzzle');expect(h.run('JSON.stringify({round,moves,score,collected,save,board:scene.engine.board})')).toBe(state);expect(h.disk()).toEqual(disk);expect(h.writes()).toBe(writes);
  });
  it('정원에서 숨은 지도 DOM의 scrollTop이0으로 줄어도 탐색 위치는 메모리에 보존합니다',()=>{
    const h=boot();h.element('#campaign-scroll').scrollTop=613;const before=h.run('JSON.stringify(save)'),disk=h.disk(),writes=h.writes();
    h.run("switchView('village')");h.element('#campaign-scroll').scrollTop=0;h.run('renderViews()');h.element('#campaign-scroll').scrollTop=0;
    h.run("switchView('map')");expect(h.element('#campaign-scroll').scrollTop).toBe(613);expect(h.run('JSON.stringify(save)')).toBe(before);expect(h.disk()).toEqual(disk);expect(h.writes()).toBe(writes);
  });
});

describe('보드 피드백 연결과 정산 경계',()=>{
  it('이동 시작 잔량과 단계 표시만 전달하고 실제 onMove 전에는 숫자·보드·세 저장 키가 같습니다',()=>{
    const h=mainHarness(),disk=h.disk(),writes=h.writes();
    const before=h.run('JSON.stringify({moves,score,collected,clearedLeaves,board:scene.engine.board,save})');
    h.run('boardFeedback.calls=[];scene.hooks.onStart();scene.hooks.onResolveVisual({cascade:1,removed:[{kind:0,x:44,y:44}],clearedLeaves:[],specialCreated:false,specialActivated:false})');
    expect(h.run('boardFeedback.calls.map(c=>c.kind)')).toEqual(['begin','show']);
    expect(h.run('boardFeedback.calls[0].payload')).toEqual(h.run("levels[currentLevel-1].goals.map(g=>({key:String(g.kind),remaining:g.count-collected[g.kind],src:'/assets/tiles-v3/'+tileNames[g.kind]+'.webp'})).concat([{key:'leaves',remaining:0,src:'/assets/obstacles-v4/leaf-pile.webp'}])"));
    expect(h.run('JSON.stringify({moves,score,collected,clearedLeaves,board:scene.engine.board,save})')).toBe(before);
    expect(h.disk()).toEqual(disk);expect(h.writes()).toBe(writes);
    expect(h.element('#goals').innerHTML).toContain(`data-feedback-goal="${h.run('levels[currentLevel-1].goals[0].kind')}"`);
    h.run('scene.hooks.onMove([1,0,0,0,0,0],10,1,0)');
    expect(h.run('boardFeedback.calls.at(-1).kind')).toBe('cancel');expect(h.run('collected[0]')).toBe(1);expect(h.run('score')).toBe(10);
  });
  it.each(['blur','resize','scroll','pagehide'])('window %s는 남은 시각 효과를 취소합니다',boundary=>{
    const h=mainHarness();h.run('boardFeedback.calls=[]');h.windowEvents[boundary]();expect(h.run('boardFeedback.calls.at(-1).kind')).toBe('cancel');
  });
  it('백그라운드·화면/언어 전환·새 회차는 취소하고 이전 scene 콜백을 다시 전달하지 않습니다',()=>{
    const h=mainHarness();h.run('boardFeedback.calls=[];document.hidden=true');h.documentEvents.visibilitychange();expect(h.run('boardFeedback.calls.at(-1).kind')).toBe('cancel');
    h.run("document.hidden=false;switchView('village')");expect(h.run('boardFeedback.calls.at(-1).kind')).toBe('cancel');
    h.run("boardFeedback.calls=[];changeLanguage('ko')");expect(h.run('boardFeedback.calls[0].kind')).toBe('cancel');
    h.run('globalThis.oldFeedbackHooks=scene.hooks;startLevel(2)');
    h.run('boardFeedback.calls=[];oldFeedbackHooks.onStart();oldFeedbackHooks.onVisualCancel();oldFeedbackHooks.onResolveVisual({cascade:2,removed:[],clearedLeaves:[]})');
    expect(h.run('boardFeedback.calls')).toEqual([]);
    h.run('scene.hooks.onVisualCancel()');expect(h.run('boardFeedback.calls.at(-1).kind')).toBe('cancel');
  });
});

describe('핍 육성·재화 소비와 정원 전용 체험',()=>{
  const normalState='JSON.stringify({round,currentLevel,moves,score,collected,shuffles,clearedLeaves,roundEnded,resultShown,firstReward,resultWon,testingLevel,continueUsed,board:scene.engine.board,leaves:scene.engine.leaves})';
  it.each(['feed','play'] as const)('체험의 단일 %s 25회 뒤 모든 꾸미기를 소유해도170코인6별이 남고 정상 저장을 복원합니다',kind=>{
    const language=kind==='feed'?'ko':'en',h=mainHarness(false,false,true);h.run(`changeLanguage('${language}');switchView('village');globalThis.budgetNormal=save;globalThis.budgetScene=scene`);
    const disk=h.disk(),writes=h.writes(),normal=h.run('JSON.stringify(save)'),round=h.run(normalState);expect(h.run('enterCareDemo()')).toBe(true);expect(h.run('save.coins')).toBe(1800);expect(h.element('#village-view').innerHTML).toContain(t(language,'journeyDemoHint').replace('{count}','100').replace('{stars}','100').replace('{coins}','1800'));
    for(let i=0;i<5;i++){h.element('#grow').onclick();h.flushGrowth();}h.run("switchView('journal')");
    for(let i=0;i<25;i++)h.element('#pip-'+kind).onclick();expect(h.run('save.pip')).toMatchObject({growth:100,affection:100});expect(h.run('save.coins')).toBe(1550);
    h.element('#pip-buy-ribbon').onclick();h.element('#pip-buy-wateringCan').onclick();h.run("switchView('village')");h.element('#garden-plot-1').onclick();h.element('#garden-flower-daisy').onclick();h.element('#garden-plot-2').onclick();h.element('#garden-flower-violet').onclick();
    for(const project of ['bench','butterflies','lantern'])h.element('#garden-project-'+project).onclick();for(const theme of ['sunset','starlight']){h.element('#garden-theme-'+theme).onclick();h.element('#garden-look-confirm').onclick();}
    for(const area of ['pond','shelter','arch']){h.element('#garden-area-'+area).onclick();for(let phase=0;phase<2;phase++){h.element('#garden-space-restore').onclick();h.element('#space-preview-confirm').onclick();}h.element('#garden-space-alt').onclick();h.element('#space-preview-confirm').onclick();}
    expect(h.run('save.coins')).toBe(170);expect(h.run('save.stars')).toBe(6);expect(h.run('save.pip.owned')).toEqual(['ribbon','wateringCan']);expect(h.run('save.gardenDesign.owned')).toEqual(['bench','butterflies','lantern']);expect(h.run('save.gardenDesign.ownedThemes')).toEqual(['sunset','starlight']);expect(h.run('Object.values(save.gardenDesign.spaces).every(s=>s.phase===2&&s.altOwned)')).toBe(true);
    expect(h.run('exitCareDemo()')).toBe(true);expect(h.run('save===budgetNormal&&scene===budgetScene')).toBe(true);expect(h.run('JSON.stringify(save)')).toBe(normal);expect(h.run(normalState)).toBe(round);expect(h.disk()).toEqual(disk);expect(h.writes()).toBe(writes);
  });
  it('먹이·놀이를 저장하고 지난 버튼 콜백으로 두 번 차감하지 않습니다',()=>{
    const h=mainHarness();h.run("switchView('journal');globalThis.beforeCheckpoint=JSON.stringify(save.inProgress)");
    h.run("globalThis.pipFocus='';document.activeElement={id:'pip-feed',isConnected:false};document.querySelector('#pip-feed').focus=()=>{pipFocus='pip-feed'}");
    const feed=h.element('#pip-feed').onclick;feed();feed();
    expect(h.run('pipFocus')).toBe('pip-feed');
    expect(h.stored()).toMatchObject({coins:30,pip:{growth:10,affection:4}});
    expect(h.element('#journal-view').innerHTML).toContain('/assets/pip-feed-v1.webp');
    h.element('#pip-play').onclick();expect(h.stored()).toMatchObject({coins:20,pip:{growth:14,affection:14}});
    expect(h.element('#journal-view').innerHTML).toContain('/assets/pip-play-v1.webp');
    expect(h.run('JSON.stringify(save.inProgress)===beforeCheckpoint')).toBe(true);
  });
  it.each(['ko','en'] as const)('%s의실제 잔여 증가량·무료반응·소품 접근성 이름·소유 꾸미기 설명은 행동과 일치합니다',language=>{
    const base={version:1,language,highestLevel:2,completed:[1],stars:1,coins:200,garden:0,music:true,sfx:true,tutorialSeen:true};
    const button=(h:ReturnType<typeof mainHarness>,id:string)=>h.element('#journal-view').innerHTML.match(new RegExp(`<button id="${id}"[\\s\\S]*?</button>`))![0];
    const cases=[
      {growth:100,affection:96,kind:'feed',gainGrowth:0,gainAffection:4,afterGrowth:100,afterAffection:100},
      {growth:96,affection:100,kind:'play',gainGrowth:4,gainAffection:0,afterGrowth:100,afterAffection:100},
      {growth:99,affection:98,kind:'feed',gainGrowth:1,gainAffection:2,afterGrowth:100,afterAffection:100},
      {growth:100,affection:20,kind:'feed',gainGrowth:0,gainAffection:4,afterGrowth:100,afterAffection:24},
      {growth:100,affection:100,kind:'play',gainGrowth:0,gainAffection:0,afterGrowth:100,afterAffection:100},
    ];
    for(const example of cases){
      const h=mainHarness(false,false,false,false,{...base,pip:{growth:example.growth,affection:example.affection,owned:[],equipped:'none'}});h.run("switchView('journal')");
      const before=button(h,'pip-'+example.kind);expect(before).not.toContain('+0');
      for(const [key,gain] of [['pipGrowth',example.gainGrowth],['pipAffection',example.gainAffection]] as const){if(gain)expect(before).toContain(t(language,key)+' +'+gain);else expect(before).not.toContain(t(language,key)+' +');}
      const free=example.growth===100&&example.affection===100;if(free)expect(before).toContain(t(language,'pipPlayFreeReaction'));else expect(before).toContain('10');
      const old=h.element('#pip-'+example.kind).onclick;old();old();expect(h.stored()).toMatchObject({coins:free?200:190,pip:{growth:example.afterGrowth,affection:example.afterAffection}});
      if(example.afterGrowth===100&&example.afterAffection===100){
        const settled=h.stored();for(const kind of ['feed','play'] as const){expect(button(h,'pip-'+kind)).toContain(t(language,kind==='feed'?'pipFeedFreeReaction':'pipPlayFreeReaction'));h.element('#pip-'+kind).onclick();expect(h.element('#journal-view').innerHTML).toContain('/assets/pip-'+kind+'-v1.webp');expect(h.element('#journal-view').innerHTML).toContain(t(language,kind==='feed'?'pipFeedReaction':'pipPlayReaction'));expect(h.run('audio.plays.at(-1)')).toBe('reward');expect(h.stored()).toEqual(settled);h.flushCareReaction();expect(h.run('pipReaction')).toBeUndefined();expect(h.stored()).toEqual(settled);}
      }
    }
    const shop=mainHarness(false,false,false,false,{...base,pip:{growth:100,affection:100,owned:[],equipped:'none'}});shop.run("switchView('journal')");
    for(const [item,key,price] of [['ribbon','pipRibbon',40],['wateringCan','pipWateringCan',80]] as const){
      expect(button(shop,'pip-buy-'+item)).toContain(`aria-label="${t(language,key)} · ${t(language,'gardenBuy').replace('{cost}',String(price))}"`);
      shop.element('#pip-buy-'+item).onclick();expect(button(shop,'pip-equip-'+item)).toContain(`aria-label="${t(language,key)} · ${t(language,'pipEquipped')}"`);expect(button(shop,'pip-equip-'+item)).toMatch(/ disabled/);
      shop.element('#pip-equip-none').onclick();expect(button(shop,'pip-equip-'+item)).toContain(`aria-label="${t(language,key)} · ${t(language,'pipEquipFree')}"`);const coins=shop.run('save.coins');shop.element('#pip-equip-'+item).onclick();expect(shop.run('save.coins')).toBe(coins);
    }
    expect(shop.run('save.coins')).toBe(80);
    for(const [space,price] of [['pond',240],['shelter',360],['arch',480]] as const){
      const unowned=shop.run(`gardenSpacePanel('${language}','${space}',{...freshGardenSpaces(),${space}:{phase:2,altOwned:false,style:'base'}},100,100)`);expect(unowned).toContain(t(language,'spaceStyleConditions').replace('{cost}',String(price)));
      for(const style of ['base','alt']){const owned=shop.run(`gardenSpacePanel('${language}','${space}',{...freshGardenSpaces(),${space}:{phase:2,altOwned:true,style:'${style}'}},100,100)`);expect(owned).toContain(t(language,'spaceOwned')+' · '+t(language,'spaceSwitchFree'));expect(owned).not.toContain(t(language,'spaceStyleConditions').replace('{cost}',String(price)));expect(owned).not.toContain(t(language,'spaceBuyStyle').replace('{cost}',String(price)));}
    }
  });
  it('성장 해금·소품 구매·무료 장착 변경을 실제 카드에 표시합니다',()=>{
    const h=mainHarness();h.run("save.coins=100;switchView('journal')");
    h.element('#pip-buy-ribbon').onclick();expect(h.run('save.coins')).toBe(100);
    h.element('#pip-feed').onclick();h.element('#pip-feed').onclick();
    expect(h.element('#journal-view').innerHTML).toContain('Lv. 2');
    h.run(`globalThis.pipFocus='';document.activeElement={id:'pip-buy-ribbon',isConnected:false};
      document.querySelector('#pip-care-title').focus=()=>{pipFocus='pip-care-title'};
      const careQuery=document.querySelector;document.querySelector=selector=>selector==='#pip-buy-ribbon'&&save.pip?.owned.includes('ribbon')?null:careQuery(selector);`);
    const buy=h.element('#pip-buy-ribbon').onclick;buy();buy();
    expect(h.run('pipFocus')).toBe('pip-care-title');
    expect(h.element('#journal-view').innerHTML).toContain('id="pip-care-title" tabindex="-1"');
    expect(h.stored()).toMatchObject({coins:40,pip:{growth:20,owned:['ribbon'],equipped:'ribbon'}});
    expect(h.element('#journal-view').innerHTML).toContain('pip-ribbon');
    h.element('#pip-equip-none').onclick();
    h.run(`pipFocus='';document.activeElement={id:'pip-equip-ribbon',isConnected:false};
      Object.defineProperty(document.querySelector('#pip-equip-ribbon'),'disabled',{configurable:true,get:()=>save.pip?.equipped==='ribbon'});`);
    h.element('#pip-equip-ribbon').onclick();expect(h.stored().coins).toBe(40);expect(h.run('pipFocus')).toBe('pip-care-title');
    h.element('#pip-greet').onclick();expect(h.element('#journal-view').innerHTML).toContain(t('en','pipGreetReaction'));
    for(let i=0;i<4;i++)h.element('#pip-feed').onclick();
    const beforeTend=h.disk(),writesBeforeTend=h.writes();h.element('#pip-tend').onclick();
    expect(h.element('#journal-view').innerHTML).toContain('pip-watering-can');expect(h.run('save.pip.equipped')).toBe('ribbon');
    expect(h.disk()).toEqual(beforeTend);expect(h.writes()).toBe(writesBeforeTend);
  });
  it('소비 저장 실패와 다른 실행의 저장 충돌은 코인·성장·별을 변경하지 않습니다',()=>{
    const h=mainHarness();h.run("switchView('journal');globalThis.originalCareSave=save");const before=h.disk();
    h.setStorageFails(true);h.element('#pip-feed').onclick();
    expect(h.run('save===originalCareSave')).toBe(true);expect(h.disk()).toEqual(before);expect(h.run('save.coins')).toBe(40);expect(h.run('save.pip')).toBeUndefined();
    h.setStorageFails(false);h.run("localStorage.setItem('pawblossom.save.v1',JSON.stringify({...save,coins:99}))");const changed=h.disk();
    h.element('#pip-feed').onclick();expect(h.disk()).toEqual(changed);expect(h.run('save.coins')).toBe(40);expect(h.run('saveStatus().load')).toBe('conflict');
  });
  it.each(['explicit','puzzle','settings','brand'] as const)('%s 종료는 세 저장 키와 원래 save·scene·회차·언어·오디오를 유지합니다',method=>{
    const h=mainHarness(false,false,true);
    h.run("switchView('village');globalThis.normalSaveRef=save;globalThis.normalSceneRef=scene;globalThis.normalEngineRef=scene.engine;globalThis.normalSaveJson=JSON.stringify(save)");
    h.run("globalThis.careFocusCalls=[];document.querySelector('#care-demo-enter-village').focus=options=>careFocusCalls.push({id:'care-demo-enter-village',preventScroll:options?.preventScroll})");
    h.run("globalThis.careEntryFocusCalls=[];document.querySelector('#care-demo-exit-village').focus=options=>careEntryFocusCalls.push({id:'care-demo-exit-village',preventScroll:options?.preventScroll})");
    const disk=h.disk(),writes=h.writes(),roundState=h.run(normalState),adds=h.run('game.scene.adds');
    expect(h.run('enterCareDemo()')).toBe(true);expect(h.element('#village-view').innerHTML).not.toContain('class="level-picker"');
    expect(h.run('careEntryFocusCalls')).toEqual([{id:'care-demo-exit-village',preventScroll:true}]);
    h.element('#grow').onclick();h.flushGrowth();h.run("switchView('journal');changeLanguage('ko');audio.setMusicEnabled(false);audio.setSfxEnabled(false)");
    h.element('#pip-feed').onclick();h.element('#pip-feed').onclick();h.element('#pip-buy-ribbon').onclick();
    expect(h.run('save.coins')).toBe(1740);expect(h.run('normalSaveRef===save')).toBe(false);
    h.run('scene.hooks.onMove([99,0,0,0,0,0],999);settleRound(true);finish(true);checkpoint();startLevel(1);showTestPicker();showStagePreview(1,"map",document.querySelector("#map-opener"))');
    expect(h.run(normalState)).toBe(roundState);
    if(method==='explicit')h.element('#care-demo-exit-journal').onclick();
    else if(method==='brand')h.run("document.querySelector('.brand').onclick({preventDefault(){}})");
    else h.run(`switchView('${method}')`);
    expect(h.run('careDemo')).toBeUndefined();expect(h.run('save===normalSaveRef&&scene===normalSceneRef&&scene.engine===normalEngineRef')).toBe(true);
    expect(h.run('JSON.stringify(save)===normalSaveJson')).toBe(true);expect(h.run(normalState)).toBe(roundState);expect(h.run('game.scene.adds')).toBe(adds);
    expect(h.run('save.language')).toBe('en');expect(h.run('audio.music&&audio.sfx')).toBe(true);
    expect(h.disk()).toEqual(disk);expect(h.writes()).toBe(writes);expect(h.run('route')).toBe(method==='explicit'?'village':method==='brand'?'map':method);
    expect(h.run('careFocusCalls')).toEqual(method==='explicit'?[{id:'care-demo-enter-village',preventScroll:true}]:[]);
  });
  it('끝난 회차와 늦은 일반/체험/설정 버튼 콜백도 복원 뒤 다시 적용되지 않습니다',()=>{
    const h=mainHarness(false,false,true);h.run("finish(false);document.querySelector('#result-dialog').close();switchView('journal')");
    const oldFeed=h.element('#pip-feed').onclick,oldReset=h.element('#reset').onclick,oldRetry=h.element('#save-retry').onclick;
    const ended=h.run(normalState),disk=h.disk(),writes=h.writes();expect(h.run('enterCareDemo()')).toBe(true);
    oldFeed();oldReset();oldRetry();expect(h.run('save.coins')).toBe(1800);
    const demoFeed=h.element('#pip-feed').onclick;demoFeed();expect(h.run('save.coins')).toBe(1790);
    h.run('exitCareDemo()');oldFeed();oldReset();oldRetry();demoFeed();
    expect(h.run(normalState)).toBe(ended);expect(h.disk()).toEqual(disk);expect(h.writes()).toBe(writes);
  });
  it('production은 체험 진입이나 가짜 재화를 노출하지 않습니다',()=>{
    const h=mainHarness(false,false,false);h.run("switchView('journal')");const disk=h.disk(),state=h.run(normalState);
    expect(h.run('enterCareDemo()')).toBe(false);expect(h.run('careDemo')).toBeUndefined();expect(h.run('save.coins')).toBe(40);
    expect(h.element('#journal-view').innerHTML).not.toContain('care-demo-');expect(h.element('#village-view').innerHTML).not.toContain('care-demo-');
    expect(h.disk()).toEqual(disk);expect(h.run(normalState)).toBe(state);
  });
  it('체험 중 비활성·복귀에서도 보드를 멈추고 Android 뒤로가기는 원래 저장의 지도로 돌아갑니다',()=>{
    const h=mainHarness(false,false,true,true);h.run("nativeActive=true;switchView('journal');globalThis.careOriginalScene=scene;globalThis.careOriginalSave=save");
    const disk=h.disk(),state=h.run(normalState);expect(h.run('enterCareDemo()')).toBe(true);
    h.element('#pip-play').onclick();h.run('document.hidden=true');h.documentEvents.visibilitychange();h.nativeEvents.appStateChange({isActive:false});
    h.run('document.hidden=false');h.documentEvents.visibilitychange();h.nativeEvents.appStateChange({isActive:true});
    expect(h.run('game.paused')).toBe(true);expect(h.run(normalState)).toBe(state);
    h.nativeEvents.backButton({isActive:true});expect(h.run('careDemo')).toBeUndefined();expect(h.run('route')).toBe('map');
    expect(h.run('scene===careOriginalScene&&save===careOriginalSave')).toBe(true);expect(h.run(normalState)).toBe(state);expect(h.disk()).toEqual(disk);
  });
  it('비활성·모달·회차교체·정산·육성 처리 중에는 체험을 시작하지 않습니다',()=>{
    for(const guard of ['document.hidden=true','nativeActive=false',"document.querySelector('#tutorial-dialog').open=true",'boardPending=true','resultTimer=1','scene.canLeave=()=>false','careProcessing=true','growing=true','testAds={pausesGame:true}','testBilling={pausesGame:true}']){
      const h=mainHarness(false,false,true,false,undefined,false);h.frame();h.run("switchView('village')");const disk=h.disk();h.run(guard);
      expect(h.run('enterCareDemo()'),guard).toBe(false);expect(h.disk()).toEqual(disk);expect(h.run('careDemo')).toBeUndefined();
    }
  });
});

describe('명시적 스테이지 전환의 보드 초점',()=>{
  function setup(){
    const h=mainHarness(false,false,false,false,undefined,false);h.frame();
    h.run(`globalThis.focusCalls=[];globalThis.cursorStarts=0;document.activeElement=document.body;
      BoardScene.prototype.focusKeyboard=()=>{cursorStarts++;};
      const target=document.querySelector('#game-canvas');target.matches=()=>true;
      target.focus=options=>{const changed=document.activeElement!==target;document.activeElement=target;
        focusCalls.push({pending:boardPending,available:scene.keyboardState().available,preventScroll:options?.preventScroll});
        if(changed)target.listeners.focus();};`);
    return h;
  }
  function transition(h:ReturnType<typeof mainHarness>,kind:string){
    if(kind==='next'||kind==='retry'){
      h.run(`finish(${kind==='next'});document.activeElement=document.querySelector('#result-next')`);
      h.element('#result-next').onclick();
    }else{
      if(kind==='preview-start')h.run("switchView('village');showStagePreview(1,'map',document.querySelector('#map-opener'))");
      else h.element('#restart').onclick();
      h.run("confirmStagePreview(stagePreview,'start')");
    }
  }
  it.each(['next','retry','preview-start','preview-restart'])('%s는 교체 전 초점을 옮기지 않고 준비된 새 보드로 한 번 전달합니다',kind=>{
    const h=setup(),before=h.run('round');transition(h,kind);
    expect(h.run('focusCalls')).toEqual([]);expect(h.run('boardPending')).toBe(true);
    h.frame();
    expect(h.run('focusCalls')).toEqual([{pending:false,available:true,preventScroll:true}]);
    expect(h.run("document.activeElement===document.querySelector('#game-canvas')")).toBe(true);
    expect(h.run('cursorStarts')).toBe(1);expect(h.run('round')).toBe(before+1);
    expect(h.run('route')).toBe('puzzle');expect(h.run('currentLevel')).toBe(kind==='next'?3:kind==='preview-start'?1:2);
    h.run('scene.hooks.onReady()');expect(h.run('focusCalls.length')).toBe(1);
  });
  it.each(['route','hidden','inactive','modal','user-focus','superseded'])('%s로 달라진 준비 결과는 초점을 빼앗거나 복귀 때 재시도하지 않습니다',reason=>{
    const h=setup();transition(h,'next');
    const change:Record<string,string>={route:"switchView('village')",hidden:'document.hidden=true',inactive:'nativeActive=false',modal:"document.querySelector('#result-dialog').open=true",'user-focus':"document.activeElement=document.querySelector('#language-toggle')",superseded:'globalThis.staleReady=scene.hooks.onReady;startLevel(1);staleReady()'};
    h.run(change[reason]);h.frame();expect(h.run('focusCalls')).toEqual([]);
    if(reason==='user-focus')expect(h.run('document.activeElement.id')).toBe('language-toggle');
    h.run("document.hidden=false;nativeActive=true;document.querySelector('#result-dialog').open=false;document.activeElement=document.body;switchView('puzzle');scene.hooks.onReady()");
    expect(h.run('focusCalls')).toEqual([]);
  });
  it.each([true,false])('같은 보드 DOM에 남은 초점은 focus-visible=%s일 때만 새 키보드 커서를 만듭니다',keyboard=>{
    const h=setup();transition(h,'next');
    h.run(`document.activeElement=document.querySelector('#game-canvas');document.activeElement.matches=()=>${keyboard}`);h.frame();
    expect(h.run('focusCalls.length')).toBe(1);expect(h.run('cursorStarts')).toBe(keyboard?1:0);
  });
});

describe('핍·설정 도움말과 원래 화면 복귀',()=>{
  const open=(h:ReturnType<typeof mainHarness>,route:'settings'|'journal')=>{
    h.run(`switchView('${route}')`);
    h.element(route==='settings'?'#tutorial-help':'#pip-tutorial-help').onclick({detail:0,button:0});
  };
  it.each(['ko','en'])('%s에서는 첫 안내의 필수 교환과 다시 연 도움말의 즉시 닫기를 구분합니다',language=>{
    const first=mainHarness(false,true);first.run(`changeLanguage('${language}')`);
    for(let i=0;i<3;i++)first.element('#guide-next').onclick();
    expect(first.element('#tutorial-dialog').innerHTML).toContain(t(language as 'ko'|'en','tutorialStart'));
    first.element('#guide-next').onclick();expect(first.element('#tutorial-dialog').open).toBe(true);
    for(const route of ['settings','journal'] as const){
      const h=mainHarness();h.run(`changeLanguage('${language}')`);open(h,route);
      expect(h.run('tutorialIntent')).toBe('help'); // 실제 onclick 이벤트를 전달해도 intent가 바뀌지 않습니다.
      for(let i=0;i<3;i++)h.element('#guide-next').onclick();
      expect(h.run('practice.completed')).toBe(false);
      expect(h.element('#tutorial-dialog').innerHTML).toContain(t(language as 'ko'|'en','tutorialClose'));
      expect(h.element('#tutorial-dialog').innerHTML).not.toMatch(/id="guide-next"[^>]*disabled/);
      h.element('#guide-next').onclick();expect(h.element('#tutorial-dialog').open).toBe(false);
      expect(h.run('route')).toBe(route);
    }
  });
  it.each(['settings','journal'] as const)('%s 도움말의 닫기·Escape·native back은 본판·RNG·회차·지갑과 opener를 보존합니다',route=>{
    for(const exit of ['last','close','escape','native-back']){
      const h=mainHarness(false,false,false,exit==='native-back');
      h.run('nativeActive=true;scene.hooks.onMove([1,0,0,0,0,0],10);globalThis.originalScene=scene;globalThis.originalEngine=scene.engine;globalThis.originalGame=game;globalThis.rngCalls=0;const rng=scene.engine.rng;scene.engine.rng=()=>{rngCalls++;return rng();}');
      const state=()=>h.run('JSON.stringify({round,currentLevel,moves,score,collected,shuffles,clearedLeaves,save,board:scene.engine.board,leaves:scene.engine.leaves})');
      const before=state();let focused=false;
      h.run(`switchView('${route}');document.querySelector('#${route}-view').scrollTop=123`);
      const opener=h.element(route==='settings'?'#tutorial-help':'#pip-tutorial-help');opener.focus=()=>{focused=true;};
      opener.onclick();
      expect(h.element('#tutorial-dialog').open).toBe(true);expect(h.run('game.paused')).toBe(true);
      if(exit==='last'){for(let i=0;i<3;i++)h.element('#guide-next').onclick();h.element('#guide-next').onclick();}
      else if(exit==='close')h.element('#guide-skip').onclick();
      else if(exit==='escape')h.element('#tutorial-dialog').listeners.cancel({preventDefault(){}});
      else h.nativeEvents.backButton({isActive:true});
      expect(h.element('#tutorial-dialog').open).toBe(false);expect(h.run('route')).toBe(route);expect(focused).toBe(true);
      expect(h.run(`document.querySelector('#${route}-view').scrollTop`)).toBe(123);
      expect(state()).toBe(before);expect(h.run('scene===originalScene&&scene.engine===originalEngine&&game===originalGame&&rngCalls===0')).toBe(true);
      expect(h.stored().tutorialSeen).toBe(true);expect(h.run('game.paused')).toBe(true);
    }
  });
  it.each(['settings','journal'] as const)('%s opener는 언어 변경으로 교체되어도 새 같은 ID와 원래 스크롤로 복귀합니다',route=>{
    const h=mainHarness();open(h,route);
    const id=route==='settings'?'tutorial-help':'pip-tutorial-help';
    h.run(`globalThis.oldOpener=tutorialReturn.opener;oldOpener.isConnected=false;globalThis.replacement=document.createElement('button');replacement.id='${id}';replacement.focus=options=>{globalThis.restored=options;};const query=document.querySelector;document.querySelector=selector=>selector==='#${id}'?replacement:query(selector);changeLanguage('ko')`);
    expect(h.run('tutorialPage')).toBe(0);expect(h.element('#tutorial-dialog').innerHTML).toContain('안내 닫기');
    h.element('#guide-skip').onclick();expect(h.run('restored.preventScroll')).toBe(true);
    expect(h.run('route')).toBe(route);expect(h.run('save.language')).toBe('ko');
  });
  it.each(['hidden','inactive','pending','busy','result','picker','ad','billing','disabled-opener','hidden-opener','hidden-view','preview'])('%s 중 다시 열기는 현재 회차와 modal을 덮어쓰지 않습니다',reason=>{
    const h=mainHarness(false,false,true);h.run("switchView('journal')");
    const code:Record<string,string>={hidden:'document.hidden=true',inactive:'nativeActive=false',pending:'boardPending=true',busy:'scene.canLeave=()=>false',result:"document.querySelector('#result-dialog').open=true",picker:"document.querySelector('#test-level-dialog').open=true",ad:'testAds={pausesGame:true}',billing:'testBilling={pausesGame:true}','disabled-opener':"document.querySelector('#pip-tutorial-help').disabled=true",'hidden-opener':"document.querySelector('#pip-tutorial-help').hidden=true",'hidden-view':"document.querySelector('#journal-view').hidden=true",preview:'stagePreview={}'};
    const disk=h.disk();h.run(`${code[reason]};document.querySelector('#pip-tutorial-help').onclick()`);
    expect(h.element('#tutorial-dialog').open).toBe(false);expect(h.disk()).toEqual(disk);expect(h.run('tutorialReturn')).toBeUndefined();
  });
  it('이미 열린 도움말은 두 번째 열기로 단계나 opener를 초기화하지 않습니다',()=>{
    const h=mainHarness();open(h,'journal');h.element('#guide-next').onclick();const opener=h.run('tutorialReturn');
    h.element('#pip-tutorial-help').onclick();expect(h.run('tutorialPage')).toBe(1);expect(h.run('tutorialReturn')).toBe(opener);
  });
  it('첫 native 안내는 보드 부팅과 활성 상태 응답을 기다리는 동안에도 기존대로 열립니다',()=>{
    const h=mainHarness(false,true,false,true,undefined,false);
    expect(h.run('boardPending')).toBe(true);expect(h.run('nativeActive')).toBe(false);expect(h.element('#tutorial-dialog').open).toBe(true);
  });
});

describe('스테이지 미리보기와 명시적 회차 교체',()=>{
  const snapshot=(h:ReturnType<typeof mainHarness>)=>h.run('JSON.stringify({round,currentLevel,testingLevel,moves,score,collected,clearedLeaves,shuffles,save,board:scene.engine.board,leaves:scene.engine.leaves})');
  const open=(h:ReturnType<typeof mainHarness>,id=2)=>h.run(`switchView('village');showStagePreview(${id},'map',document.querySelector('#map-opener'))`);
  it.each(['cancel','escape','continue','native-back'])('%s는 저장 전체·Scene·엔진·RNG·회차 집계를 보존합니다',reason=>{
    const h=mainHarness(false,false,false,reason==='native-back');h.run('nativeActive=true;globalThis.originalScene=scene;globalThis.originalEngine=scene.engine;globalThis.rngCalls=0;const rng=scene.engine.rng;scene.engine.rng=()=>{rngCalls++;return rng();};scene.hooks.onMove([1,2,0,0,0,0],30)');
    const before=snapshot(h),disk=h.disk(),writes=h.writes();open(h);
    expect(h.run('previewDialog.open')).toBe(true);expect(h.run('game.paused')).toBe(true);expect(h.element('#game-canvas').tabIndex).toBe(-1);
    expect(h.run('previewDialog.innerHTML')).toContain('Current puzzle · Moves remaining: 23.');
    if(reason==='cancel')h.element('#preview-cancel').onclick();
    if(reason==='escape')h.run('previewDialog.listeners.cancel({preventDefault(){}})');
    if(reason==='continue')h.run("confirmStagePreview(stagePreview,'continue')");
    if(reason==='native-back')h.nativeEvents.backButton({isActive:true});
    expect(snapshot(h)).toBe(before);expect(h.disk()).toEqual(disk);expect(h.writes()).toBe(writes);
    expect(h.run('scene===originalScene&&scene.engine===originalEngine&&rngCalls===0')).toBe(true);
    expect(h.run('route')).toBe(reason==='continue'?'puzzle':'village');expect(h.run('previewDialog.open')).toBe(false);
  });
  it.each(['restart','switch'])('%s 확인만 새 회차를 정확히 한 번 만들고 영구 진행을 보존합니다',reason=>{
    const h=mainHarness();h.run('globalThis.oldScene=scene;scene.hooks.onMove([1,0,0,0,0,0],10)');const disk=h.disk(),beforeRound=h.run('round');
    if(reason==='restart')h.element('#restart').onclick();else open(h,1);
    expect(h.disk()).toEqual(disk);h.run('globalThis.oldPreview=stagePreview');
    h.run("confirmStagePreview(oldPreview,'start');confirmStagePreview(oldPreview,'start')");
    expect(h.run('round')).toBe(beforeRound+1);expect(h.run('scene===oldScene')).toBe(false);expect(h.run('currentLevel')).toBe(reason==='restart'?2:1);
    expect(h.stored()).toMatchObject({completed:[1],stars:1,coins:40,garden:0,inProgress:{score:0}});
  });
  it('실제 엔진의 유효 교환 뒤에도 미리보기 취소와 이어하기는 같은 난수 흐름을 유지합니다',()=>{
    const h=mainHarness();h.run('globalThis.originalScene=scene;const move=scene.engine.legalMoves()[0];const result=scene.engine.swap(move.a,move.b);if(!result.valid)throw Error("유효 교환 실패");scene.hooks.onMove(result.collected,result.score,result.steps.length,result.leavesCleared);globalThis.rngCalls=0;const rng=scene.engine.rng;scene.engine.rng=()=>{rngCalls++;return rng();}');
    const before=snapshot(h),disk=h.disk();open(h);h.element('#preview-cancel').onclick();open(h);h.run("confirmStagePreview(stagePreview,'continue')");expect(snapshot(h)).toBe(before);expect(h.disk()).toEqual(disk);expect(h.run('scene===originalScene&&rngCalls===0')).toBe(true);
  });
  it.each(['hidden','native','pending','busy','tutorial','result','picker','ad','billing'])('%s 중에는 열기 자체도 거부합니다',reason=>{
    const h=mainHarness(false,false,true);const code:Record<string,string>={hidden:'document.hidden=true',native:'nativeActive=false',pending:'boardPending=true',busy:'scene.canLeave=()=>false',tutorial:"document.querySelector('#tutorial-dialog').open=true",result:"document.querySelector('#result-dialog').open=true",picker:"document.querySelector('#test-level-dialog').open=true",ad:'testAds={pausesGame:true}',billing:'testBilling={pausesGame:true}'};
    const disk=h.disk();h.run(`${code[reason]};showStagePreview(2,'restart',document.querySelector('#restart'))`);expect(h.run('stagePreview')).toBeUndefined();expect(h.disk()).toEqual(disk);
  });
  it.each(['hidden','background','pending','busy','tutorial','result','picker','ad','billing','stale-round','stale-scene','locked'])('%s 조건의 지연 확인은 회차를 바꾸지 않습니다',reason=>{
    const h=mainHarness(false,false,true);open(h,1);h.run('globalThis.oldPreview=stagePreview');
    const code:Record<string,string>={hidden:'document.hidden=true',background:'nativeActive=false',pending:'boardPending=true',busy:'scene.canLeave=()=>false',tutorial:"document.querySelector('#tutorial-dialog').open=true",result:"document.querySelector('#result-dialog').open=true",picker:"document.querySelector('#test-level-dialog').open=true",ad:'testAds={pausesGame:true}',billing:'testBilling={pausesGame:true}', 'stale-round':'round++','stale-scene':'scene={...scene}',locked:'save.highestLevel=0'};
    const disk=h.disk();h.run(`${code[reason]};globalThis.expectedRound=round;confirmStagePreview(oldPreview,'start')`);expect(h.run('round')).toBe(h.run('expectedRound'));expect(h.disk()).toEqual(disk);
  });
  it.each(['0','31','1.5','NaN','3'])('잘못되거나 잠긴 id %s와 분리된 DOM은 미리보기를 열지 않습니다',id=>{
    const h=mainHarness(),disk=h.disk();open(h,Number(id));expect(h.run('stagePreview')).toBeUndefined();h.run("document.querySelector('#map-opener').isConnected=false;showStagePreview(1,'map',document.querySelector('#map-opener'))");expect(h.run('stagePreview')).toBeUndefined();expect(h.disk()).toEqual(disk);
  });
  it('시험 회차를 같은 일반 회차로 이어가지 않으며 시험 재시작은 정상 체크포인트를 보존합니다',()=>{
    const h=mainHarness(false,false,true),disk=h.disk();h.run('startLevel(2,true)');open(h);expect(h.run('previewDialog.innerHTML')).not.toContain('preview-continue');h.run("confirmStagePreview(stagePreview,'continue')");expect(h.run('testingLevel')).toBe(true);h.run('closeStagePreview();switchView("puzzle")');h.element('#restart').onclick();h.run("confirmStagePreview(stagePreview,'start')");expect(h.run('testingLevel')).toBe(true);expect(h.disk()).toEqual(disk);
  });
  it('언어 재렌더·중첩·시험 진입은 선택과 회차를 보존하고 다른 시작은 이전 미리보기를 무효화합니다',()=>{
    const h=mainHarness(false,false,true);open(h,1);h.run('globalThis.oldPreview=stagePreview;showStagePreview(2,"map",document.querySelector("#map-opener"));showTestPicker();showTutorial();changeLanguage("ko")');
    expect(h.run('stagePreview===oldPreview')).toBe(true);expect(h.run('previewDialog.innerHTML')).toContain('스테이지 1');expect(h.element('#test-level-dialog').open).toBe(false);expect(h.element('#tutorial-dialog').open).toBe(false);
    h.run('startLevel(2)');const round=h.run('round');h.run("confirmStagePreview(oldPreview,'start')");expect(h.run('round')).toBe(round);expect(h.run('previewDialog.open')).toBe(false);
  });
  it('접근성 detail=0 활성화는 DOM 초점 강제 없이 허용하고 새 pointerdown 없는 호환 클릭은 거절합니다',()=>{
    const h=mainHarness();h.element('#restart').onclick();const before=h.run('round');
    h.run("previewDialog.contains=()=>true;document.querySelector('#preview-start').onclick({isTrusted:true,detail:1})");expect(h.run('round')).toBe(before);
    h.run("document.querySelector('#preview-start').onclick({isTrusted:true,detail:0})");expect(h.run('round')).toBe(before+1);
  });
  it.each([22,30])('%s의 세 목표 또는 두 겹 낙엽은 원래 수량과 초기 이동을 표시합니다',id=>{
    const h=mainHarness();h.run('save.highestLevel=30');open(h,id);const html=h.run('previewDialog.innerHTML');expect(html.match(/class="preview-goal"/g)).toHaveLength(3);
    if(id===30){expect(html).toContain('leaf-pile.webp');expect(html).toContain('two layers');}
    expect(html).toContain('preview-initial');expect(html).not.toContain('preview-remaining');
  });
});

type Pointer = { id: number; x: number; y: number };
describe('목표·남은 이동 접근성 안내',()=>{
  const sentences=(h:ReturnType<typeof mainHarness>)=>Array.from(h.element('#goals').innerHTML.matchAll(/<span class="sr-only">([^<]+)<\/span>/g),match=>match[1]);
  const observe=(h:ReturnType<typeof mainHarness>)=>h.run(`globalThis.liveWrites=[];globalThis.statusValue=document.querySelector('#board-keyboard-status').textContent;Object.defineProperty(document.querySelector('#board-keyboard-status'),'textContent',{get:()=>statusValue,set:value=>{statusValue=value;liveWrites.push(value);}});`);
  it.each(['ko','en'])('%s 목표마다 남음·완료 문장 하나만 제공하고 그림·시각 숫자·체크를 장식으로 둡니다',language=>{
    const h=mainHarness();h.run(`startLevel(1);changeLanguage('${language}')`);
    expect(sentences(h)).toEqual(language==='ko'?['딸기 12개 남음.','당근 10개 남음.']:['Strawberry: 12 remaining.','Carrot: 10 remaining.']);
    h.run('scene.hooks.onMove([12,0,0,0,0,0],120,1,0)');
    expect(sentences(h)).toEqual(language==='ko'?['딸기 목표 완료.','당근 10개 남음.']:['Strawberry: complete.','Carrot: 10 remaining.']);
    h.run('startLevel(6);scene.hooks.onMove([0,0,0,0,0,16],160,1,3)');
    expect(sentences(h)).toEqual(language==='ko'?['꽃 목표 완료.','딸기 12개 남음.','낙엽 더미 1개 남음.']:['Flower: complete.','Strawberry: 12 remaining.','Leaf pile: 1 remaining.']);
    h.run('scene.hooks.onMove([12,0,0,0,0,0],120,1,1)');
    expect(sentences(h)).toEqual(language==='ko'?['꽃 목표 완료.','딸기 목표 완료.','낙엽 더미 목표 완료.']:['Flower: complete.','Strawberry: complete.','Leaf pile: complete.']);
    const html=h.element('#goals').innerHTML;
    expect(html.match(/alt=""/g)).toHaveLength(3);expect(html.match(/<strong aria-hidden="true">/g)).toHaveLength(3);expect(html).not.toMatch(/aria-live|role="status"/);
  });
  it.each(['ko','en'])('%s 최종 이동 집계 뒤에만 요약하고 같은 상태는 다시 쓰지 않습니다',language=>{
    const h=mainHarness();h.run(`startLevel(1);changeLanguage('${language}');globalThis.stateReads=0;globalThis.access={available:false,busy:true};scene.keyboardState=()=>{stateReads++;return access;};updateBoardAccess();`);observe(h);const reads=h.run('stateReads');
    h.run('scene.hooks.onMove([3,0,0,0,0,0],30,2,0)');
    expect(h.run('liveWrites')).toEqual([]);expect(h.run('stateReads')).toBe(reads);
    h.run('scene.hooks.onBoardState()');
    expect(h.run('liveWrites')).toEqual([]);
    h.run('access={available:true,busy:false,cursor:{row:0,col:0},tile:{kind:0},layers:0,selected:{row:1,col:2}};scene.hooks.onBoardState()');
    const status=h.element('#board-keyboard-status').textContent;
    expect(status).toContain(language==='ko'?'남은 이동 25회. 딸기 9개 남음. 당근 10개 남음.':'Moves remaining: 25. Strawberry: 9 remaining. Carrot: 10 remaining.');
    expect(status).toContain(language==='ko'?'선택한 칸: 2행 3열.':'Selected: row 2, column 3.');
    expect(h.run('liveWrites')).toEqual([status]);
    h.run('updateGoals();updateBoardAccess();scene.hooks.onBoardState();syncActivity()');expect(h.run('liveWrites')).toEqual([status]);
  });
  it.each(['ko','en'])('%s 낙엽 두 겹에서 한 겹이 되어도 남은 더미 수를 줄이지 않습니다',language=>{
    const h=mainHarness();h.run(`startLevel(6);changeLanguage('${language}');scene.engine.leaves[2][2]=1;scene.hooks.onMove([0,0,0,0,0,0],0,1,0);scene.keyboardState=()=>({available:true,cursor:{row:2,col:2},tile:{kind:0},layers:scene.engine.leaves[2][2]});scene.hooks.onBoardState()`);
    expect(sentences(h).at(-1)).toBe(language==='ko'?'낙엽 더미 4개 남음.':'Leaf pile: 4 remaining.');
    expect(h.element('#board-keyboard-status').textContent).toContain(language==='ko'?'낙엽 남은 겹: 1.':'Leaf layers remaining: 1.');
    expect(h.element('#board-keyboard-status').textContent).toContain(language==='ko'?'낙엽 더미 4개 남음.':'Leaf pile: 4 remaining.');
    h.run('scene.engine.leaves[2][2]=0;scene.hooks.onMove([0,0,0,0,0,0],0,1,1);scene.hooks.onBoardState()');
    expect(sentences(h).at(-1)).toBe(language==='ko'?'낙엽 더미 3개 남음.':'Leaf pile: 3 remaining.');
  });
  it.each(['busy','finished','modal','hidden','pending','settings'])('%s에서는 요약을 배제하고 기존 짧은 상태·입력 차단을 유지합니다',reason=>{
    const h=mainHarness(false,false,false,false,undefined,false);h.frame();h.run(`scene.keyboardState=()=>({available:${reason!=='busy'&&reason!=='finished'},busy:${reason==='busy'},finished:${reason==='finished'}});`);
    if(reason==='modal')h.element('#tutorial-dialog').open=true;
    if(reason==='hidden')h.run('document.hidden=true');if(reason==='pending')h.run('boardPending=true');if(reason==='settings')h.run("route='settings'");
    h.run('updateBoardAccess()');expect(h.element('#board-keyboard-status').textContent).toBe(reason==='busy'?'Resolving the move. Please wait.':reason==='finished'?'Round finished.':'Board is not available.');
    expect(h.element('#game-canvas').tabIndex).toBe(reason==='busy'?0:-1);
  });
  it.each(['ko','en'])('%s 저장 복원과 언어 전환이 같은 회차의 이동·목표를 안내합니다',language=>{
    const h=mainHarness();h.run(`save.highestLevel=6;startLevel(6);changeLanguage('${language}');moves=8;collected=[12,0,0,0,0,5];clearedLeaves=2;scene.engine.leaves[2][2]=0;scene.engine.leaves[2][5]=0;roundTools.started=true;checkpoint()`);
    const next=mainHarness(false,false,false,false,h.stored());
    expect(next.element('#board-keyboard-status').textContent).toContain(language==='ko'?'남은 이동 8회. 꽃 11개 남음. 딸기 목표 완료. 낙엽 더미 2개 남음.':'Moves remaining: 8. Flower: 11 remaining. Strawberry: complete. Leaf pile: 2 remaining.');
    const before=next.run('JSON.stringify({moves,collected,clearedLeaves,round})');next.run(`changeLanguage('${language==='ko'?'en':'ko'}')`);
    expect(next.run('JSON.stringify({moves,collected,clearedLeaves,round})')).toBe(before);
    expect(next.element('#board-keyboard-status').textContent).toContain(language==='ko'?'Moves remaining: 8.':'남은 이동 8회.');
    expect(sentences(next).at(-1)).toBe(language==='ko'?'Leaf pile: 2 remaining.':'낙엽 더미 2개 남음.');
  });
  it.each(['ko','en'])('%s +5 이어하기의 이른 상태 콜백은 요약하지 않고 창을 닫은 뒤 새 값만 읽습니다',language=>{
    const h=mainHarness(false,false,true);h.run(`startLevel(6,true);changeLanguage('${language}');moves=1;scene.hooks.onMove([0,0,0,0,0,0],0,1,0)`);h.flushResults();observe(h);
    h.run('scene.resumePreparedFailure=()=>{scene.stopped=false;scene.hooks.onBoardState();globalThis.earlyStatus=document.querySelector("#board-keyboard-status").textContent;}');
    h.element('#result-continue').onclick();
    expect(h.run('earlyStatus')).toBe(language==='ko'?'지금은 보드를 조작할 수 없어요.':'Board is not available.');
    const status=h.element('#board-keyboard-status').textContent;
    expect(status).toContain(language==='ko'?'남은 이동 5회. 꽃 16개 남음.':'Moves remaining: 5. Flower: 16 remaining.');
    expect(h.run('liveWrites').filter((value:string)=>value.includes(language==='ko'?'남은 이동':'Moves remaining'))).toEqual([status]);
  });
  it.each(['ko','en'])('%s 마지막 이동으로 완료하면 목표 문장은 남기고 보드에는 종료만 안내합니다',language=>{
    const h=mainHarness();h.run(`startLevel(1);changeLanguage('${language}');moves=1;scene.hooks.onMove([12,10,0,0,0,0],220,1,0);scene.hooks.onBoardState()`);
    expect(h.run('moves')).toBe(0);expect(h.element('#board-keyboard-status').textContent).toBe(language==='ko'?'회차가 끝났어요.':'Round finished.');
    expect(sentences(h)).toEqual(language==='ko'?['딸기 목표 완료.','당근 목표 완료.']:['Strawberry: complete.','Carrot: complete.']);
  });
});
describe('시험 실패 회차 이어하기',()=>{
  const fail=(h:ReturnType<typeof mainHarness>)=>{h.run('moves=1;scene.hooks.onMove([0,0,0,0,0,0],0,1,0)');h.flushResults();};
  const setup=()=>{const h=mainHarness(false,false,true);h.run('startLevel(6,true)');fail(h);return h;};
  it('같은 round/scene/engine과 목표·점수·낙엽·셔플을 유지하며 이동만5 추가하고 저장 바이트를 쓰지 않습니다',()=>{
    const h=setup();h.run('score=321;collected=[2,3,4,5,6,7];clearedLeaves=2;shuffles=0');
    const scene=h.run('scene'),engine=h.run('scene.engine'),round=h.run('round'),disk=h.disk(),writes=h.writes();
    const before=h.run('JSON.stringify({score,collected,clearedLeaves,shuffles,board:scene.engine.board,leaves:scene.engine.leaves})');
    const button=h.element('#result-continue');expect(h.element('#result-dialog').innerHTML).toContain('Test continue +5 moves');
    expect(h.run('game.paused')).toBe(true);button.onclick();button.onclick();
    expect(h.run('moves')).toBe(5);expect(h.run('round')).toBe(round);expect(h.run('scene')).toBe(scene);expect(h.run('scene.engine')).toBe(engine);
    expect(h.run('JSON.stringify({score,collected,clearedLeaves,shuffles,board:scene.engine.board,leaves:scene.engine.leaves})')).toBe(before);
    expect(h.run('({roundEnded,resultShown,resultWon,continueUsed})')).toEqual({roundEnded:false,resultShown:false,resultWon:undefined,continueUsed:true});
    expect(h.run('game.paused')).toBe(false);expect(h.element('#result-dialog').open).toBe(false);
    h.run('scene.hooks.onMove([1,0,0,0,0,0],20,1,0)');expect(h.run('moves')).toBe(4);expect(h.run('score')).toBe(341);
    expect(h.disk()).toEqual(disk);expect(h.writes()).toBe(writes);
  });
  it.each([false,true])('이어하기 후 두 번째 결과 won=%s는 원래 hooks로 처리하며 다시 이어하지 않습니다',won=>{
    const h=setup(),disk=h.disk();h.element('#result-continue').onclick();
    if(won)h.run('scene.hooks.onMove([99,99,99,99,99,99],1000,1,64)');else for(let i=0;i<5;i++)h.run('scene.hooks.onMove([0,0,0,0,0,0],0,1,0)');
    h.flushResults();expect(h.element('#result-dialog').open).toBe(true);expect(h.run('resultWon')).toBe(won);
    expect(h.element('#result-dialog').innerHTML).not.toContain('id="result-continue"');expect(h.disk()).toEqual(disk);
  });
  it('모달 언어 갱신은 같은 버튼/callback을 유지하고 1회 제한을 초기화하지 않습니다',()=>{
    const h=setup(),callback=h.element('#result-continue').onclick;
    h.run("changeLanguage('ko')");expect(h.element('#result-continue').onclick).toBe(callback);expect(h.element('#result-continue').textContent).toBe('시험 이어하기 +5');
    expect(h.element('#result-continue-note').textContent).toContain('광고 없이');
    h.run("changeLanguage('en')");callback();expect(h.run('moves')).toBe(5);
    fail(h);h.run("changeLanguage('ko')");callback();expect(h.run('moves')).toBe(0);expect(h.run('continueUsed')).toBe(true);
  });
  it.each(['normal','production','won','not-failed'])('%s는 이어하기 버튼/실행이 없습니다',reason=>{
    const h=mainHarness(false,false,reason!=='production');h.run(`startLevel(6,${reason!=='normal'})`);
    if(reason==='won')h.run('finish(true)');else if(reason==='not-failed')h.run('finish(false)');else fail(h);
    expect(h.element('#result-dialog').innerHTML).not.toContain('id="result-continue"');
    const moves=h.run('moves');expect(h.run("continueTestRound(round,scene,document.querySelector('#result-continue'))")).toBe(false);expect(h.run('moves')).toBe(moves);
  });
  it.each(['timer','closed','home','board-pending','wrong-scene','stale-node','resume-blocked'])('%s에서 오래된 callback은 이동/상태/저장을 바꾸지 않습니다',reason=>{
    const h=setup(),callback=h.element('#result-continue').onclick;
    if(reason==='timer')h.run('resultTimer=123');if(reason==='closed')h.element('#result-dialog').close();
    if(reason==='home')h.element('#result-home').onclick();
    if(reason==='wrong-scene')h.run('game.scene.board=undefined');if(reason==='resume-blocked')h.run('scene.canResumeAfterFailure=()=>false');
    if(reason==='stale-node')h.element('#result-dialog').querySelector=()=>new ElementStub('#result-continue');
    const state=h.run('JSON.stringify({moves,roundEnded,resultShown,continueUsed})'),disk=h.disk();
    if(reason==='board-pending')h.run("boardPending=true;document.querySelector('#result-continue').onclick()");else callback();
    expect(h.run('JSON.stringify({moves,roundEnded,resultShown,continueUsed})')).toBe(state);expect(h.disk()).toEqual(disk);
  });
  it.each(['restart','new-test','normal'])('%s로 생성한 새 round에서는 오래된 callback을 차단하고 시험 새 회차만 사용 횟수를 초기화합니다',reason=>{
    const h=setup(),callback=h.element('#result-continue').onclick;callback();
    if(reason==='restart'){h.element('#restart').onclick();h.run("confirmStagePreview(stagePreview,'start')");}else h.run(`startLevel(6,${reason==='new-test'})`);
    fail(h);const currentRound=h.run('round'),moves=h.run('moves');callback();
    expect(h.run('round')).toBe(currentRound);expect(h.run('moves')).toBe(moves);expect(h.run('continueUsed')).toBe(false);
    if(reason!=='normal'){h.element('#result-continue').onclick();expect(h.run('moves')).toBe(5);}
  });
  it.each(['hidden','native'])('%s 비활성 중에는 지급하지 않고 활성 복귀 후 새 입력만 이어합니다',reason=>{
    const h=setup();if(reason==='hidden')h.run('document.hidden=true');else h.run('nativeActive=false');
    h.element('#result-continue').onclick();expect(h.run('moves')).toBe(0);expect(h.run('game.paused')).toBe(true);expect(h.element('#game-canvas').tabIndex).toBe(-1);
    h.run('document.hidden=false;nativeActive=true;syncActivity()');expect(h.run('game.paused')).toBe(true);
    h.element('#result-continue').onclick();expect(h.run('moves')).toBe(5);expect(h.run('game.paused')).toBe(false);
  });
});
describe('광고 제거 조회·구매창과 게임 활동 상태',()=>{
  function setup(configured=true){
    let value:BillingSnapshot={available:true,configured,state:configured?'querying':'idle',entitlement:'unknown',revision:0,error:'',price:'',overlay:false,adsBlocked:configured,preparingPurchase:false};
    let callback!:(state:BillingSnapshot)=>void;
    const emit=(patch:Partial<BillingSnapshot>)=>{value={...value,...patch,revision:value.revision+1};callback?.({...value});return {...value};};
    const bridge:TestBillingBridge={getStatus:async()=>({...value}),restore:async()=>emit({state:'querying'}),queryProduct:async()=>emit({state:'products'}),purchase:async()=>emit({state:'purchasing',overlay:true}),addListener:async(_name,listener)=>{callback=listener;return {remove:async()=>{}};}};
    const h=mainHarness(false,false,true,true,undefined,true,undefined,bridge);h.nativeEvents.appStateChange({isActive:true});
    return {h,emit};
  }
  it('시작 자동 조회는 보드·음악을 멈추지 않고 모달을 연 동안만 멈춥니다',async()=>{
    const {h,emit}=setup();await h.run('testBilling.connect()');
    expect(h.run('game.paused')).toBe(false);expect(h.run('audio.suspended')).toBe(false);
    await h.run('showBillingDialog()');expect(h.run('game.paused')).toBe(true);expect(h.run('audio.suspended')).toBe(true);
    h.run('closeBillingDialog()');expect(h.run('game.paused')).toBe(false);expect(h.run('audio.suspended')).toBe(false);
    emit({state:'failed',error:'query:2'});expect(h.run('game.paused')).toBe(false);
  });
  it('Play창 종료·늦은 검증 결과만으로 모달을 닫거나 게임을 자동 재개하지 않습니다',async()=>{
    const {h,emit}=setup();await h.run('testBilling.connect()');const before=h.stored();await h.run('showBillingDialog()');
    emit({state:'purchasing',overlay:true});h.run('closeBillingDialog()');expect(h.element('#test-billing-dialog').open).toBe(true);
    h.nativeEvents.appStateChange({isActive:false});emit({state:'idle',overlay:false,entitlement:'owned',adsBlocked:true});
    expect(h.run('game.paused')).toBe(true);h.nativeEvents.appStateChange({isActive:true});expect(h.run('game.paused')).toBe(true);
    h.run('document.hidden=true;closeBillingDialog()');expect(h.run('game.paused')).toBe(true);
    h.run('document.hidden=false');h.documentEvents.visibilitychange();expect(h.run('game.paused')).toBe(false);
    expect(h.stored()).toEqual(before);
  });
  it('구성 미완료 모달은 즉시 닫히고 음량·기존 진행 저장을 보존합니다',async()=>{
    const {h}=setup(false);await h.run('testBilling.connect()');const before=h.stored();
    await h.run('showBillingDialog()');expect(h.element('#test-billing-status').textContent).toContain('Setup incomplete');
    h.run('closeBillingDialog()');expect(h.element('#test-billing-dialog').open).toBe(false);expect(h.run('game.paused')).toBe(false);expect(h.stored()).toEqual(before);
  });
  it('구매 준비 연결/상품 재조회 중 닫기·뒤로가기·Escape를 막고 늦은 Play창도 같은 모달 아래 유지합니다',async()=>{
    const {h,emit}=setup();await h.run('testBilling.connect()');await h.run('showBillingDialog()');
    for(const state of ['connecting','products'] as const){
      emit({state,preparingPurchase:true});h.element('#test-billing-close').onclick();h.nativeEvents.backButton({isActive:true});h.element('#test-billing-dialog').listeners.cancel({preventDefault(){}});
      expect(h.element('#test-billing-dialog').open).toBe(true);expect(h.run('game.paused')).toBe(true);expect(h.run('audio.suspended')).toBe(true);
    }
    emit({state:'purchasing',preparingPurchase:false,overlay:true});h.run('closeBillingDialog()');expect(h.element('#test-billing-dialog').open).toBe(true);
    emit({state:'failed',preparingPurchase:false,overlay:false,error:'timeout'});h.run('closeBillingDialog()');expect(h.element('#test-billing-dialog').open).toBe(false);
    await h.run('showBillingDialog()');emit({state:'products',preparingPurchase:false});h.run('closeBillingDialog()');expect(h.element('#test-billing-dialog').open).toBe(false);
  });
});
describe('모든 광고 제거와 두 실제 컨트롤러 통합',()=>{
  async function setup(format:AdFormat='interstitial',rewardContinue=false){
    let ad:AdSnapshot={bridgeVersion:3,receipt:null,format,rewardEvents:0,available:true,state:'idle',revision:0,error:'',privacyRequired:false};
    let billing:BillingSnapshot={available:true,configured:true,state:'idle',entitlement:'not-owned',revision:0,error:'',price:'',overlay:false,adsBlocked:false,preparingPurchase:false};
    let onAd!:(value:AdSnapshot)=>void,onBilling!:(value:BillingSnapshot)=>void,attempt=0;
    const calls={prepare:0,show:0,cancel:0,restore:0};
    const emitAd=(patch:Partial<AdSnapshot>)=>{ad={...ad,...patch,revision:ad.revision+1};onAd?.({...ad});return {...ad};};
    // 네이티브의 폐기/overlay 보존을 흉내 내는 대역이며 실제 SDK 검증은 아닙니다.
    const emitBilling=(patch:Partial<BillingSnapshot>)=>{
      billing={...billing,...patch,revision:billing.revision+1};
      if(billing.adsBlocked){
        if(['consent','loading','ready'].includes(ad.state))emitAd({state:'failed',error:'billing-blocked',receipt:null});
        else if(['presenting','showing'].includes(ad.state))emitAd({receipt:null});
      }
      onBilling?.({...billing});return {...billing};
    };
    const adsBridge:TestAdsBridge={getStatus:async()=>({...ad}),selectFormat:async({format})=>emitAd({format,state:'idle',receipt:null}),
      prepare:async()=>{calls.prepare++;return emitAd({state:'loading',receipt:null});},
      show:async({requestId})=>{calls.show++;return emitAd({state:'presenting',receipt:ad.format==='rewarded'?{requestId,attemptId:String(++attempt),earned:false,closed:false}:null});},
      cancel:async()=>{calls.cancel++;return emitAd({state:'cancelled',receipt:null});},privacyOptions:async()=>emitAd({state:'privacy'}),
      addListener:async(_name,callback)=>{onAd=callback;return {remove:async()=>{}};}};
    const billingBridge:TestBillingBridge={getStatus:async()=>({...billing}),queryProduct:async()=>({...billing}),purchase:async()=>({...billing}),
      restore:async()=>{calls.restore++;return emitBilling({state:'idle',entitlement:'owned',adsBlocked:true});},
      addListener:async(_name,callback)=>{onBilling=callback;return {remove:async()=>{}};}};
    const h=mainHarness(false,false,true,true,undefined,true,adsBridge,billingBridge);h.nativeEvents.appStateChange({isActive:true});
    await h.run('testBilling.connect()');
    if(rewardContinue){h.run('startLevel(6,true);moves=1;scene.hooks.onMove([0,0,0,0,0,0],0,1,0)');h.flushResults();await h.run('testAds.connect()');}
    else await h.run('showAdDialog()');
    const unchanged=()=>({disk:h.disk(),memory:h.run('JSON.stringify(save)'),scene:h.run('scene'),engine:h.run('scene.engine'),round:h.run('round'),moves:h.run('moves'),used:h.run('continueUsed')});
    const start=async()=>{await h.run('prepareRewardContinue(rewardedContinue)');emitAd({state:'ready',receipt:null});h.element('#result-ad-show').onclick();await Promise.resolve();};
    return {h,calls,emitAd,emitBilling,unchanged,start,ad:()=>({...ad}),billing:()=>({...billing})};
  }
  for(const format of ['interstitial','rewarded'] as const)for(const phase of ['loading','ready'] as const)for(const acquisition of ['event','restore'] as const){
    it(`${format} ${phase}에서 ${acquisition} owned 전환은 늦은 ready와 UI 요청을 막고 진행을 보존합니다`,async()=>{
      const x=await setup(format),{h}=x,before=x.unchanged();h.element('#test-ad-load').onclick();await Promise.resolve();
      if(phase==='ready')x.emitAd({state:'ready'});
      if(acquisition==='restore')await h.run("testBilling.command('restore')");else x.emitBilling({entitlement:'owned',adsBlocked:true});
      const counts={...x.calls};x.emitAd({state:'ready',receipt:null});
      h.element('#test-ad-load').onclick();h.element('#test-ad-show').onclick();await Promise.resolve();
      expect(x.calls).toEqual(counts);expect(x.calls.prepare).toBe(1);expect(x.calls.show).toBe(0);expect(x.calls.restore).toBe(acquisition==='restore'?1:0);
      expect(h.element('#test-ad-load').disabled).toBe(true);expect(h.element('#test-ad-show').disabled).toBe(true);
      expect(h.element('#test-ad-error').textContent).toBe(billingCopy('en').entitlement.owned);expect(x.unchanged()).toEqual(before);
    });
  }
  it.each(['ko','en'] as const)('%s의 owned와 확인/처리 중 안내를 광고·이어하기·구매 화면에서 구분합니다',async language=>{
    const x=await setup('rewarded',true),{h}=x;h.run(`changeLanguage('${language}');renderAdDialog()`);
    const before=x.unchanged();
    for(const patch of [{entitlement:'unknown',adsBlocked:true},{entitlement:'pending',adsBlocked:true},{entitlement:'not-owned',adsBlocked:false,state:'querying'},{entitlement:'owned',adsBlocked:true,state:'idle'}] as const){
      x.emitBilling(patch);const expected=patch.entitlement==='owned'?billingCopy(language).entitlement.owned:t(language,'testAdContinueBlocked');
      expect(h.element('#test-ad-error').textContent).toBe(expected);expect(h.element('#result-ad-status').textContent).toBe(expected);
      expect(h.element('#test-billing-status').textContent).toContain(billingCopy(language).entitlement[patch.entitlement]);
      h.element('#result-ad-load').onclick();h.element('#result-ad-show').onclick();await Promise.resolve();
      expect(x.calls.prepare).toBe(0);expect(x.calls.show).toBe(0);expect(x.unchanged()).toEqual(before);
    }
  });
  it.each([false,true])('보상 표시 중 owned 뒤 닫힘 전 미구매 전환 %s: 늦은 receipt는 지급하지 않고 새 요청만 이어갑니다',async unlockBeforeClose=>{
    const x=await setup('rewarded',true),{h}=x,before=x.unchanged();await x.start();const old=x.ad().receipt!;
    x.emitAd({state:'showing',receipt:{...old,earned:true}});x.emitBilling({entitlement:'owned',adsBlocked:true});
    expect(h.run('testAds.overlay')).toBe(true);expect(h.run('game.paused')).toBe(true);expect(h.run('audio.suspended')).toBe(true);
    if(unlockBeforeClose)x.emitBilling({entitlement:'not-owned',adsBlocked:false});
    x.emitAd({state:'showing',receipt:{...old,earned:true},rewardEvents:1});
    expect(x.unchanged()).toEqual(before);expect(h.run('testAds.overlay')).toBe(true);
    x.emitAd({state:'closed',receipt:{...old,earned:true,closed:true}});expect(x.unchanged()).toEqual(before);
    if(!unlockBeforeClose){x.emitBilling({entitlement:'not-owned',adsBlocked:false});x.emitAd({state:'closed',receipt:{...old,earned:true,closed:true}});expect(x.unchanged()).toEqual(before);}
    expect(h.element('#result-dialog').open).toBe(true);expect(h.run('game.paused')).toBe(true);
    await x.start();const fresh=x.ad().receipt!;expect(fresh.requestId).not.toBe(old.requestId);
    x.emitAd({state:'showing',receipt:{...old,earned:true}});x.emitAd({state:'closed',receipt:{...old,earned:true,closed:true}});
    expect(x.unchanged()).toEqual(before); // 이전 요청으로 새 claim도 성립하지 않습니다.
    await x.start();const final=x.ad().receipt!;
    x.emitAd({state:'showing',receipt:{...final,earned:true},rewardEvents:2});x.emitAd({state:'closed',receipt:{...final,earned:true,closed:true}});
    expect(h.run('moves')).toBe(5);expect(h.run('continueUsed')).toBe(true);expect(h.run('scene')).toBe(before.scene);expect(h.run('scene.engine')).toBe(before.engine);
    expect(h.disk()).toEqual(before.disk);expect(h.run('JSON.stringify(save)')).toBe(before.memory);expect(x.calls.show).toBe(3);
  });
  it.each(['interstitial','rewarded'] as const)('%s 표시 중 owned여도 실제 closed 전 닫기·Escape·뒤로가기 보호를 유지합니다',async format=>{
    const x=await setup(format),{h}=x,before=x.unchanged();h.element('#test-ad-load').onclick();await Promise.resolve();x.emitAd({state:'ready'});
    h.element('#test-ad-show').onclick();await Promise.resolve();x.emitAd({state:'showing'});x.emitBilling({entitlement:'owned',adsBlocked:true});
    await h.run('closeAdDialog()');h.element('#test-ad-dialog').listeners.cancel({preventDefault(){}});h.nativeEvents.backButton({isActive:true});
    expect(h.element('#test-ad-dialog').open).toBe(true);expect(h.run('testAds.overlay')).toBe(true);expect(h.run('game.paused')).toBe(true);expect(x.calls.cancel).toBe(0);
    expect(x.unchanged()).toEqual(before);x.emitAd({state:'closed',receipt:null});await h.run('closeAdDialog()');
    expect(h.element('#test-ad-dialog').open).toBe(false);expect(h.run('game.paused')).toBe(false);expect(x.unchanged()).toEqual(before);
  });
});
describe('시험 광고와 기존 게임 활동 상태 통합',()=>{
  function setup(format:import('../src/testAds').AdFormat='interstitial'){
    let value={bridgeVersion:3,receipt:null,format,rewardEvents:0,available:true,state:'idle',revision:0,error:'',privacyRequired:false} as import('../src/testAds').AdSnapshot;
    let callback!:(state:typeof value)=>void;
    const emit=(state:typeof value.state)=>{value={...value,state,revision:value.revision+1};callback?.({...value});return {...value};};
    const bridge:TestAdsBridge={getStatus:async()=>({...value}),selectFormat:async({format})=>{value={...value,format};return emit('idle');},prepare:async()=>emit('consent'),show:async()=>emit('presenting'),cancel:async()=>emit('cancelled'),privacyOptions:async()=>emit('privacy'),addListener:async(_name,listener)=>{callback=listener;return {remove:async()=>{}};}};
    const h=mainHarness(false,false,true,true,undefined,true,bridge);
    h.nativeEvents.appStateChange({isActive:true});
    return {h,emit,bridge};
  }
  it.each(['interstitial','rewarded'] as const)('%s 표시 중 보드·오디오·키보드를 멈추고 닫힌 뒤 모달/화면 조건을 따릅니다',async format=>{
    const {h,emit}=setup(format);const before=h.stored();
    await h.run('showAdDialog()');emit('ready');await h.run("testAds.command('show')");emit('showing');
    expect(h.run('game.paused')).toBe(true);expect(h.run('audio.suspended')).toBe(true);
    expect(h.element('#game-canvas').tabIndex).toBe(-1);
    emit('closed');expect(h.run('game.paused')).toBe(true); // 시험 dialog가 아직 열려 있습니다.
    await h.run('closeAdDialog()');expect(h.run('game.paused')).toBe(false);expect(h.run('audio.suspended')).toBe(false);
    expect(h.stored()).toEqual(before);
  });
  it('닫힘·실패 후에도 document/native 비활성 상태를 유지합니다',async()=>{
    const {h,emit}=setup();await h.run('showAdDialog()');emit('showing');
    h.nativeEvents.appStateChange({isActive:false});h.run('document.hidden=true');emit('failed');
    await h.run('closeAdDialog()');expect(h.run('game.paused')).toBe(true);expect(h.run('audio.suspended')).toBe(true);
    h.nativeEvents.appStateChange({isActive:true});expect(h.run('audio.suspended')).toBe(true);
    h.run('document.hidden=false');h.documentEvents.visibilitychange();expect(h.run('game.paused')).toBe(false);expect(h.run('audio.suspended')).toBe(false);
  });
  it('표시 중 JS 뒤로가기는 네이티브 광고를 닫힌 것으로 처리하지 않습니다',async()=>{
    const {h,emit}=setup();await h.run('showAdDialog()');emit('showing');await h.run('closeAdDialog()');
    expect(h.element('#test-ad-dialog').open).toBe(true);expect(h.run('audio.suspended')).toBe(true);
    emit('closed');await h.run('closeAdDialog()');expect(h.element('#test-ad-dialog').open).toBe(false);
  });
  it('준비된 광고 폐기 실패 때 창을 유지하며 취소 성공 뒤에만 닫습니다',async()=>{
    const {h,emit,bridge}=setup();await h.run('showAdDialog()');emit('ready');
    bridge.cancel=async()=>{throw Error('IPC');};await h.run('closeAdDialog()');
    expect(h.element('#test-ad-dialog').open).toBe(true);expect(h.run('testAds.snapshot.state')).toBe('ready');
    bridge.cancel=async()=>emit('cancelled');await h.run('closeAdDialog()');
    expect(h.element('#test-ad-dialog').open).toBe(false);await h.run('showAdDialog()');
    expect(h.run('testAds.snapshot.state')).toBe('cancelled');
  });
  it('SDK 시작 전 상태 조회가 실패해도 돌아갈 수 있습니다',async()=>{
    const {h,bridge}=setup();bridge.getStatus=async()=>{throw Error('IPC');};await h.run('showAdDialog()');
    expect(h.run('testAds.snapshot.available')).toBe(false);await h.run('closeAdDialog()');
    expect(h.element('#test-ad-dialog').open).toBe(false);expect(h.run('game.paused')).toBe(false);
  });
  it('준비 취소와 재조회가 함께 실패해도 닫기 재시도로 폐기할 수 있습니다',async()=>{
    const {h,emit,bridge}=setup();await h.run('showAdDialog()');emit('ready');
    bridge.cancel=async()=>{throw Error('IPC');};bridge.getStatus=async()=>{throw Error('IPC');};
    await h.run('closeAdDialog()');expect(h.element('#test-ad-dialog').open).toBe(true);
    bridge.cancel=async()=>emit('cancelled');await h.run('closeAdDialog()');
    expect(h.element('#test-ad-dialog').open).toBe(false);
  });
});
type Position = { row: number; col: number };
describe('보상형 시험 이어하기 요청 문맥',()=>{
  async function setup(){
    let state:import('../src/testAds').AdSnapshot={bridgeVersion:3,format:'interstitial',receipt:null,rewardEvents:0,available:true,state:'idle',revision:0,error:'',privacyRequired:false};
    let callback!:(value:typeof state)=>void;
    const emit=(patch:Partial<typeof state>)=>{state={...state,...patch,revision:state.revision+1};callback?.({...state});return {...state};};
    const bridge:TestAdsBridge={getStatus:async()=>({...state}),selectFormat:async({format})=>emit({format,state:'idle',receipt:null}),
      prepare:async()=>emit({state:'loading',receipt:null}),show:async({requestId})=>emit({state:'presenting',receipt:{requestId,attemptId:'11',earned:false,closed:false}}),
      cancel:async()=>emit({state:'cancelled',receipt:null}),privacyOptions:async()=>emit({state:'privacy'}),addListener:async(_name,listener)=>{callback=listener;return {remove:async()=>{}};}};
    const h=mainHarness(false,false,true,true,undefined,true,bridge);h.nativeEvents.appStateChange({isActive:true});
    h.run('startLevel(6,true);moves=1;scene.hooks.onMove([0,0,0,0,0,0],0,1,0)');h.flushResults();await h.run('testAds.connect()');
    const start=async()=>{await h.run('prepareRewardContinue(rewardedContinue)');emit({state:'ready'});h.element('#result-ad-show').onclick();await Promise.resolve();};
    const earned=()=>emit({state:'showing',rewardEvents:state.rewardEvents+1,receipt:{...state.receipt!,earned:true}});
    const closed=(reward=true)=>emit({state:'closed',receipt:{...state.receipt!,earned:reward,closed:true}});
    return {h,bridge,emit,start,earned,closed,state:()=>state};
  }
  it('earned는 보드/저장을 건드리지 않고 닫힘 뒤 같은 보드·회차에 한 번만 +5를 적용합니다',async()=>{
    const x=await setup(),{h}=x,disk=h.disk(),scene=h.run('scene'),engine=h.run('scene.engine'),round=h.run('round');
    await x.start();x.earned();expect(h.run('moves')).toBe(0);expect(h.run('game.paused')).toBe(true);expect(h.disk()).toEqual(disk);
    const done=x.closed();expect(h.run('moves')).toBe(5);expect(h.run('scene')).toBe(scene);expect(h.run('scene.engine')).toBe(engine);expect(h.run('round')).toBe(round);
    x.emit(done);h.element('#result-continue').onclick();expect(h.run('moves')).toBe(5);expect(h.disk()).toEqual(disk);
    h.run('scene.hooks.onMove([0,0,0,0,0,0],0,1,0)');expect(h.run('moves')).toBe(4);
  });
  it.each(['home','new-round','stale-dom','no-reward','failed','cancelled'])('%s는 지급0이고 회차 자격을 소모하지 않습니다',async reason=>{
    const x=await setup(),{h}=x;await x.start();x.earned();
    if(reason==='home')h.run("switchView('village')");if(reason==='new-round')h.run('startLevel(6,true)');
    if(reason==='stale-dom')h.element('#result-dialog').querySelector=()=>new ElementStub('#result-continue');
    const before=h.run('moves'),disk=h.disk();
    if(reason==='failed'||reason==='cancelled')x.emit({state:reason,receipt:null});else x.closed(reason!=='no-reward');
    expect(h.run('moves')).toBe(before);expect(h.run('continueUsed')).toBe(false);expect(h.disk()).toEqual(disk);
  });
  it('실패/취소 뒤 명시적 재시도로 받을 수 있고 비활성 닫힘은 복귀까지 보드가 멈춥니다',async()=>{
    const x=await setup(),{h}=x;await x.start();x.closed(false);expect(h.run('continueUsed')).toBe(false);
    await h.run("testAds.command('cancel')");await x.start();x.earned();h.nativeEvents.appStateChange({isActive:false});x.closed();
    expect(h.run('moves')).toBe(0);expect(h.run('game.paused')).toBe(true);h.nativeEvents.appStateChange({isActive:true});
    expect(h.run('moves')).toBe(5);expect(h.run('game.paused')).toBe(false);
  });
  it('광고busy의비활성home은이탈하지않고동일문맥의정상보상을한번만받습니다',async()=>{
    const x=await setup(),{h}=x,disk=h.disk();await x.start();const context=h.run('rewardedContinue');expect(h.element('#result-home').disabled).toBe(true);h.element('#result-home').onclick();expect(h.run('route')).toBe('puzzle');expect(h.element('#result-dialog').open).toBe(true);expect(h.run('rewardedContinue')).toBe(context);expect(h.run('moves')).toBe(0);expect(h.disk()).toEqual(disk);x.earned();const receipt=x.closed();expect(h.run('moves')).toBe(5);x.emit(receipt);expect(h.run('moves')).toBe(5);expect(h.disk()).toEqual(disk);
  });
  it('결과 재방문의 새 문맥은 이전 earned/closed와 오래된 show를 지급하지 않습니다',async()=>{
    const x=await setup(),{h}=x,disk=h.disk();await x.start();x.earned();
    const oldContext=h.run('rewardedContinue'),oldShow=h.element('#result-ad-show').onclick;
    // 광고 overlay의disabled home을누르는대신외부이탈을명시합니다. 늦은보상0기대는그대로입니다.
    h.run("document.querySelector('#result-dialog').close();switchView('map')");expect(h.run('route')).toBe('map');expect(h.element('#result-dialog').open).toBe(false);expect(h.run('rewardedContinue')).toBeUndefined();const oldReceipt=x.closed();expect(h.run('moves')).toBe(0);
    h.run("switchView('puzzle')");expect(h.element('#result-dialog').open).toBe(true);expect(h.run('rewardedContinue')).not.toBe(oldContext);expect(h.run('rewardedContinue.requestId')).toBeUndefined();
    x.emit(oldReceipt);oldShow();expect(h.run('moves')).toBe(0);expect(h.run('continueUsed')).toBe(false);
    await x.start();x.earned();x.closed();expect(h.run('moves')).toBe(5);expect(h.run('continueUsed')).toBe(true);expect(h.disk()).toEqual(disk);
  });
  it('준비 광고 취소 중 즉시 퍼즐 복귀는 지도에 머물고 취소 뒤 명시 복귀만 결과를 엽니다',async()=>{
    const x=await setup(),{h}=x;await h.run('prepareRewardContinue(rewardedContinue)');x.emit({state:'ready'});
    let finishCancel!:()=>void;
    x.bridge.cancel=()=>new Promise<ReturnType<typeof x.state>>(resolve=>{finishCancel=()=>resolve(x.emit({state:'cancelled',receipt:null}));});
    h.element('#result-home').onclick();expect(h.run('testAds.pending')).toBe(true);
    h.run("switchView('puzzle')");expect(h.run('route')).toBe('map');expect(h.element('#result-dialog').open).toBe(false);
    finishCancel();await h.run('testAds.connect()');
    expect(h.run('testAds.pending')).toBe(false);expect(h.run('route')).toBe('map');expect(h.element('#result-dialog').open).toBe(false);
    h.run("switchView('puzzle')");expect(h.element('#result-dialog').open).toBe(true);expect(h.run('moves')).toBe(0);expect(h.run('rewardedContinue.requestId')).toBeUndefined();
  });
});
function boardHarness() {
  const handlers: Record<string, (pointer: Pointer) => void> = {};
  const lifecycle: Record<string, () => void> = {};
  const attempts: { a: Position; b: Position }[] = [], taps: Position[] = [];
  const graphics: object = new Proxy({}, { get: () => () => graphics });
  class PhaserSceneStub {
    sys={isActive:()=>true};
    cameras = { main: { setBackgroundColor() {},setViewport(){return this;},setZoom(){return this;},centerOn(){return this;},preRender(){},getWorldPoint(x:number,y:number){return {x,y};} } };
    add = { graphics: () => graphics };
    // 간단한 좌표 시나리오도 실제 Phaser의 정상 touch 필드를 갖추어 전달합니다.
    input = { on: (name: string, callback: (pointer: Pointer) => void,context?:unknown) => { handlers[name] = p=>callback.call(context??this,{wasTouch:true,wasCanceled:false,button:0,downTime:1,event:{touches:[{}]},...p} as Pointer); },off:(name:string)=>{delete handlers[name];} };
    scale={on(){},off(){}};
    events = {
      on: (name: string, callback: () => void) => { lifecycle[name] = callback; },
      once: (name: string, callback: () => void) => { lifecycle[name] = callback; },
      off:(name:string)=>{delete lifecycle[name];},
    };
  }
  const engineExports: Record<string, unknown> = {}, boardExports: Record<string, unknown> = {};
  const motionExports={reducedMotion:()=>false};
  const effectsExports:Record<string,unknown>={};vm.runInNewContext(effectsCode,{exports:effectsExports,require:(name:string)=>name==='./BoardDisplay'?boardDisplay:motionExports});
  vm.runInNewContext(engineCode, { exports: engineExports });
  vm.runInNewContext(boardCode, {
    exports: boardExports,
    require: (name: string) => name === 'phaser' ? { default: {
      Scene: PhaserSceneStub,
      Scenes: { Events: { PAUSE: 'pause', RESUME: 'resume', SLEEP: 'sleep', WAKE:'wake', SHUTDOWN: 'shutdown', DESTROY:'destroy', CREATE:'create' } },Scale:{Events:{RESIZE:'resize'}},
    } } : name==='./BoardDisplay'?boardDisplay:name==='./BoardEffects'?effectsExports:name==='./reducedMotion'?motionExports:name==='./SpecialTileArt'?{specialArtKinds,specialBodyKey,specialBodyPath}:engineExports,
  });
  const Constructor = boardExports.BoardScene as new (hooks: object) => {
    create(): void; paint: () => void; resetHint: () => void; pieces:unknown[][];
    attempt: (a: Position, b: Position) => void; tap: (position: Position) => void;
    selected?: Position; down?: { pointerId: number };focusKeyboard():void;keyboardKey(key:string):boolean;keyboardState():{cursor?:Position;selected?:Position};
  };
  const scene = new Constructor({ audio: {}, onStart() {}, onMove() {}, onNotice() {} });
  // 실제 create()와 제스처 정리를 사용하고 표시/애니메이션만 생략합니다.
  scene.paint = () => {scene.pieces=Array.from({length:8},()=>[]);}; scene.resetHint = () => {};
  scene.attempt = (a, b) => { attempts.push({ a, b }); };
  scene.tap = position => { taps.push(position); };
  scene.create();
  return { handlers, lifecycle, attempts, taps, scene };
}

describe('게임 블록과 장애물 bitmap 로더',()=>{
  it('100번 혼합 목표의 HUD·미리보기·제거 피드백은 같은 장애물 원본을 사용합니다',()=>{
    const h=mainHarness(false,false,true);h.run('startLevel(100,true);scene.hooks.onStart()');
    for(const name of ['leaf-pile','wooden-crate'])expect(h.element('#goals').innerHTML).toContain(`/assets/obstacles-v4/${name}.webp`);
    const goals=h.run('boardFeedback.calls.find(call=>call.kind==="begin").payload') as {key:string;src:string}[];
    expect(goals.find(goal=>goal.key==='leaves')?.src).toBe('/assets/obstacles-v4/leaf-pile.webp');
    expect(goals.find(goal=>goal.key==='crates')?.src).toBe('/assets/obstacles-v4/wooden-crate.webp');
    h.run("showStagePreview(currentLevel,'restart',document.querySelector('#restart'))");
    for(const name of ['leaf-pile','wooden-crate'])expect(h.run('previewDialog.innerHTML')).toContain(`/assets/obstacles-v4/${name}.webp`);
  });
  it('소재와 장애물의 기존 key를 image로 읽고 캐시된 종류는 재요청하지 않습니다',()=>{
    const h=boardHarness(),images:string[][]=[],vectors:string[][]=[];
    const scene=h.scene as unknown as {preload():void;textures:{exists(name:string):boolean};load:{image(name:string,url:string):void;svg(name:string,url:string):void}};
    scene.textures={exists:name=>name==='carrot'||name==='special-art-column'||name==='leaf-single'};
    scene.load={image:(name,url)=>{images.push([name,url]);},svg:(name,url)=>{vectors.push([name,url]);}};
    scene.preload();
    expect(images).toEqual([...['strawberry','blueberry','acorn','leaf','flower'].map(name=>[name,`/assets/tiles-v3/${name}.webp`]),...['row','bomb','rainbow'].map(kind=>[`special-art-${kind}`,`/assets/specials-v4/${kind}.webp`]),...['leaf-pile','wooden-crate'].map(name=>[name,`/assets/obstacles-v4/${name}.webp`])]);
    expect(vectors).toEqual([]);
    images.length=0;scene.textures.exists=()=>true;scene.preload();expect(images).toEqual([]);
  });
});

describe('종료된 회차의 명시적 퍼즐 복귀',()=>{
  function ended(test=false,won=true,level=2,native=false){
    const h=mainHarness(false,false,true,native);
    if(native)h.nativeEvents.appStateChange({isActive:true});
    h.run(`startLevel(${level},${test});moves=1;scene.hooks.onMove(${won?'[99,99,99,99,99,99]':'[0,0,0,0,0,0]'},100,1,${won?'64':'0'})`);
    h.flushResults();return h;
  }
  it.each([{test:false,won:true,level:2},{test:false,won:false,level:2},{test:true,won:true,level:6},{test:true,won:false,level:6},{test:false,won:true,level:30}])('지도 왕복은 $test/$won/$level 결과와 회차·보상·아트·소리를 다시 만들지 않습니다',({test,won,level})=>{
    const h=ended(test,won,level),disk=h.disk(),writes=h.writes(),scene=h.run('scene'),engine=h.run('scene.engine'),round=h.run('round');
    const sounds=h.run('audio.plays.slice()'),art=h.resultArtCalls(),html=h.element('#result-dialog').innerHTML,next=h.element('#result-next').onclick;
    let focus=0;h.element('#result-next').focus=()=>{focus++;};
    for(let i=0;i<3;i++){
      h.element('#result-home').onclick();expect(h.run('route')).toBe('map');expect(h.element('#result-dialog').open).toBe(false);
      h.run("switchView('puzzle')");expect(h.element('#result-dialog').open).toBe(true);expect(h.run('game.paused')).toBe(true);expect(h.element('#game-canvas').tabIndex).toBe(-1);
    }
    expect(focus).toBe(3);expect(h.disk()).toEqual(disk);expect(h.writes()).toBe(writes);expect(h.run('audio.plays')).toEqual(sounds);expect(h.resultArtCalls()).toBe(art);
    expect(h.run('scene')).toBe(scene);expect(h.run('scene.engine')).toBe(engine);expect(h.run('round')).toBe(round);expect(h.element('#result-dialog').innerHTML).toBe(html);expect(h.element('#result-next').onclick).toBe(next);
    h.element('#result-next').onclick();expect(h.run('currentLevel')).toBe(won?Math.min(LEVEL_COUNT,level+1):level);expect(h.run('testingLevel')).toBe(test);expect(h.element('#result-dialog').open).toBe(false);
  });
  it.each([true,false])('Escape로 닫은 결과 won=%s도 명시적으로 돌아올 수 있습니다',won=>{
    const h=ended(false,won);h.element('#result-dialog').listeners.cancel({preventDefault(){}});expect(h.run('route')).toBe('map');
    h.run("switchView('puzzle')");expect(h.element('#result-dialog').open).toBe(true);expect(h.run('resultWon')).toBe(won);
  });
  it('Android 뒤로가기로 지도에 나간 결과도 다시 선택할 수 있습니다',()=>{
    const h=ended(false,false,2,true);h.nativeEvents.backButton({isActive:true});expect(h.run('route')).toBe('map');
    h.run("switchView('puzzle')");expect(h.element('#result-dialog').open).toBe(true);expect(h.run('resultWon')).toBe(false);
  });
  it.each(['hidden','native','pending','timer','tutorial','ads','billing','wrong-scene'])('%s 중에는 화면 전환 전에 막고 자동으로 초점을 가져가지 않습니다',reason=>{
    const h=ended();h.element('#result-home').onclick();let focus=0;h.element('#result-next').focus=()=>{focus++;};
    const changes:Record<string,string>={hidden:'document.hidden=true',native:'nativeActive=false',pending:'boardPending=true',timer:'resultTimer=123',tutorial:"document.querySelector('#tutorial-dialog').open=true",ads:'testAds={pausesGame:true}',billing:'testBilling={pausesGame:true}', 'wrong-scene':'game.scene.board=undefined'};
    h.run(changes[reason]+";switchView('puzzle')");expect(h.run('route')).toBe('map');expect(h.element('#result-dialog').open).toBe(false);expect(focus).toBe(0);
    h.run("document.hidden=false;nativeActive=true;boardPending=false;resultTimer=undefined;document.querySelector('#tutorial-dialog').open=false;testAds=undefined;testBilling=undefined;game.scene.board=scene;syncActivity()");
    expect(h.run('route')).toBe('map');expect(h.element('#result-dialog').open).toBe(false);expect(focus).toBe(0);
    h.run("switchView('puzzle')");expect(h.element('#result-dialog').open).toBe(true);expect(focus).toBe(1);
  });
  it('진행 중 회차와 새 회차에는 닫았던 결과를 표시하지 않습니다',()=>{
    const h=mainHarness();h.run("switchView('village');switchView('puzzle')");expect(h.element('#result-dialog').open).toBe(false);
    h.run('finish(true)');h.element('#result-home').onclick();h.run("startLevel(3);switchView('puzzle')");expect(h.element('#result-dialog').open).toBe(false);expect(h.run('roundEnded')).toBe(false);
  });
  it('정원에서 바꾼 언어는 같은 결과 버튼과 첫 보상 표시를 유지합니다',()=>{
    const h=ended(),next=h.element('#result-next').onclick;h.element('#result-home').onclick();h.run("changeLanguage('ko')");const disk=h.disk(),writes=h.writes();
    h.run("switchView('puzzle')");expect(h.element('#result-next').innerHTML).toContain('다음 스테이지');expect(h.element('#result-dialog').innerHTML).toContain('result-rewards');expect(h.element('#result-next').onclick).toBe(next);expect(h.disk()).toEqual(disk);expect(h.writes()).toBe(writes);
  });
});

describe('첫 시제품 UI 흐름 회귀 검증 (모의 DOM/Phaser)', () => {
  it('숨김 화면에서 보드 복귀는 현재 부모 크기를 먼저 읽어 입력 좌표를 계산합니다',()=>{
    const h=mainHarness();h.run(`switchView('settings');globalThis.boundsOrder=[];game.scale.getParentBounds=()=>boundsOrder.push('parent');game.scale.refresh=()=>boundsOrder.push('canvas');switchView('puzzle');`);
    expect(h.run('boundsOrder')).toEqual(['parent','canvas']);expect(h.run('game.paused')).toBe(false);
  });
  it.each(['pause','resume','sleep','shutdown','destroy'])('%s는 보드 키보드 커서와 선택·포인터를 정리합니다',event=>{
    const h=boardHarness();h.scene.focusKeyboard();h.scene.keyboardKey('ArrowRight');h.scene.selected={row:1,col:1};h.scene.down={pointerId:1};
    expect(h.scene.keyboardState().cursor).toEqual({row:0,col:1});h.lifecycle[event]();
    expect(h.scene.keyboardState()).toMatchObject({cursor:undefined,selected:undefined});expect(h.scene.down).toBeUndefined();
  });
  it('보드 초점의 순수 키만 전달하고 조합키·입력창·모달·다른 화면은 차단하지 않습니다',()=>{
    const h=mainHarness(false,false,true);
    h.run(`globalThis.keys=[];globalThis.blocked=0;const board=document.querySelector('#game-canvas');document.activeElement=board;scene.keyboardKey=(key,repeat)=>keys.push([key,repeat]);globalThis.sendKey=(overrides={})=>board.listeners.keydown({target:board,key:'ArrowRight',repeat:false,preventDefault(){blocked++},...overrides});sendKey();sendKey({key:' ',repeat:true});`);
    expect(h.run('keys')).toEqual([['ArrowRight',false],[' ',true]]);expect(h.run('blocked')).toBe(2);
    h.run(`sendKey({altKey:true});sendKey({ctrlKey:true});sendKey({metaKey:true});sendKey({isComposing:true});sendKey({target:document.querySelector('#language')});sendKey({key:'Tab'});document.activeElement=document.querySelector('#language');sendKey();document.activeElement=board;route='settings';sendKey();route='puzzle';boardPending=true;sendKey();`);
    expect(h.run('keys.length')).toBe(2);expect(h.run('blocked')).toBe(2);
    h.run(`boardPending=false;document.querySelector=(selector)=>selector==='dialog[open]'?{}:board;sendKey();`);
    expect(h.run('keys.length')).toBe(2);expect(h.run('blocked')).toBe(2);
  });
  it('Shift+Enter만 교환 전용 선택으로 전달하고 Space/일반 Enter와 반복 여부를 구분합니다',()=>{
    const h=mainHarness();h.run(`globalThis.keys=[];const board=document.querySelector('#game-canvas');document.activeElement=board;scene.keyboardKey=(...args)=>keys.push(args);for(const event of [{key:'Enter',shiftKey:true,repeat:false},{key:'Enter',shiftKey:false,repeat:false},{key:' ',shiftKey:true,repeat:false},{key:'Enter',shiftKey:true,repeat:true}])board.listeners.keydown({target:board,preventDefault(){},...event});`);
    expect(h.run('keys')).toEqual([['Enter',false,true],['Enter',false,false],[' ',false,false],['Enter',true,true]]);
  });
  it('busy/finished 보드 키는 전달하지 않으며 대기 중 스크롤만 막습니다',()=>{
    const h=mainHarness();h.run(`globalThis.keys=0;globalThis.blocked=0;const board=document.querySelector('#game-canvas');document.activeElement=board;scene.keyboardKey=()=>keys++;scene.keyboardState=()=>({available:false,busy:true});board.listeners.keydown({target:board,key:' ',preventDefault(){blocked++}});scene.keyboardState=()=>({available:false,finished:true});board.listeners.keydown({target:board,key:'Enter',preventDefault(){blocked++}});`);
    expect(h.run('keys')).toBe(0);expect(h.run('blocked')).toBe(2);
  });
  it.each([true,false])('테스트 결과 %s에서 선택 취소는 결과로 돌아가고 다른 스테이지는 기록을 쓰지 않습니다',won=>{
    const h=mainHarness(false,false,true),before=h.stored(),writes=h.writes();
    h.run(`startLevel(6,true);finish(${won})`);
    const result=h.element('#result-dialog').innerHTML;
    expect(result).toContain(won?'result-win':'result-retry');expect(result).toContain('/assets/pip.png');
    expect(result).not.toContain('result-rewards');
    h.element('#result-test').onclick();expect(h.element('#result-dialog').open).toBe(false);expect(h.element('#test-level-dialog').open).toBe(true);
    h.element('#test-close').onclick();expect(h.element('#result-dialog').open).toBe(true);expect(h.element('#result-dialog').innerHTML).toBe(result);
    h.element('#result-test').onclick();h.element('#test-level-dialog').listeners.cancel({preventDefault(){}});
    expect(h.element('#result-dialog').open).toBe(true);
    h.element('#result-test').onclick();h.element('#test-stage-8').onclick();
    expect(h.run('currentLevel')).toBe(8);expect(h.run('testingLevel')).toBe(true);expect(h.run('pickerReturnToResult')).toBe(false);
    expect(h.element('#result-dialog').open).toBe(false);expect(h.run('game.paused')).toBe(false);
    h.element('#test-level-button').onclick();h.element('#test-close').onclick();expect(h.element('#result-dialog').open).toBe(false);
    expect(h.stored()).toEqual(before);expect(h.writes()).toBe(writes);
  });
  it('일반 첫 완료와 재플레이는 실제 보상에 맞는 결과를 표시합니다',()=>{
    const h=mainHarness();h.run('startLevel(2);finish(true)');
    expect(h.element('#result-dialog').innerHTML).toContain('result-rewards');expect(h.stored()).toMatchObject({completed:[1,2],stars:2,coins:80});
    expect(h.element('#result-dialog').innerHTML).not.toContain('result-test');
    h.run('startLevel(2);finish(true)');expect(h.element('#result-dialog').innerHTML).not.toContain('result-rewards');
    expect(h.element('#result-dialog').innerHTML).toContain('first clear');expect(h.stored()).toMatchObject({completed:[1,2],stars:2,coins:80});
  });
  it('테스트 선택은 잠긴 스테이지로 이동하지만 완료·재시작·재도전에 기록과 보상을 쓰지 않습니다',()=>{
    const h=mainHarness(false,false,true),before=h.stored(),writes=h.writes();
    h.element('#test-level-button').onclick();expect(h.element('#test-level-dialog').open).toBe(true);expect(h.run('game.paused')).toBe(true);
    h.element('#test-stage-6').onclick();expect(h.run('currentLevel')).toBe(6);expect(h.run('testingLevel')).toBe(true);
    expect(h.element('#test-level-dialog').open).toBe(false);expect(h.run('game.paused')).toBe(false);
    h.element('#restart').onclick();h.run("confirmStagePreview(stagePreview,'start')");expect(h.run('testingLevel')).toBe(true);
    h.run('scene.hooks.onMove([12,0,0,0,0,16],280,1,4)');h.flushResults();
    expect(h.stored()).toEqual(before);expect(h.writes()).toBe(writes);
    h.element('#result-next').onclick();expect(h.run('currentLevel')).toBe(7);expect(h.run('testingLevel')).toBe(true);
    h.run('finish(false)');h.element('#result-next').onclick();expect(h.run('testingLevel')).toBe(true);
    h.element('#test-level-button').onclick();h.element('#test-normal').onclick();
    expect(h.run('currentLevel')).toBe(2);expect(h.run('testingLevel')).toBe(false);
    expect(h.stored()).toEqual(before);
    h.run('scene.hooks.onMove([0,12,10,0,0,0],220)');h.flushResults();
    expect(h.stored()).toMatchObject({completed:[1,2],stars:2,coins:80,highestLevel:3});
  });
  it('시험 번호는 첫 판·기존 경계·확장 시작·마지막 판으로 바로 이동하고 일반 저장을 유지합니다',()=>{
    for(const id of [1,100,101,500]){
      const h=mainHarness(false,false,true),before=h.disk();
      h.element('#test-level-button').onclick();h.element('#test-level-number').value=String(id);
      h.element('#test-level-number-start').onclick();
      expect(h.run('currentLevel')).toBe(id);expect(h.run('testingLevel')).toBe(true);
      expect(h.element('#test-level-dialog').open).toBe(false);expect(h.disk()).toEqual(before);
      h.run('finish(true)');expect(h.disk()).toEqual(before);
    }
  });
  it('시험 번호의 빈값·소수·과학 표기·범위 밖은 판을 바꾸지 않고 수정 후 시작할 수 있습니다',()=>{
    const h=mainHarness(false,false,true),before=h.disk();h.run('showTestPicker()');const initial=h.run('round');
    for(const value of ['', ' ', '0', '501', '5000', '999', '-1', '+1', '1.5', '1e2', '500x', '５００']){
      h.element('#test-level-number').value=value;h.element('#test-level-number-start').onclick();
      expect(h.run('round')).toBe(initial);expect(h.element('#test-level-dialog').open).toBe(true);
      expect(h.element('#test-level-number').getAttribute('aria-invalid')).toBe('true');
      expect(h.element('#test-level-number-error').textContent).toContain('500');expect(h.disk()).toEqual(before);
    }
    h.element('#test-level-number').value=' 500 ';h.run("document.querySelector('#test-level-number').oninput()");
    expect(h.element('#test-level-number').getAttribute('aria-invalid')).toBeNull();expect(h.element('#test-level-number-error').textContent).toBe('');
    h.element('#test-level-number-start').onclick();expect(h.run('currentLevel')).toBe(500);expect(h.disk()).toEqual(before);
  });
  it('시험 번호 Enter는 반복·조합 중에는 시작하지 않고 한 번만 새 판을 준비합니다',()=>{
    const h=mainHarness(false,false,true);h.run('showTestPicker()');h.element('#test-level-number').value='500';const before=h.run('round');
    h.run("globalThis.numberFocus=0;document.querySelector('#game-canvas').focus=()=>numberFocus++");
    h.run("document.querySelector('#test-level-number').onkeydown({key:'Enter',repeat:true,preventDefault(){}})");
    h.run("document.querySelector('#test-level-number').onkeydown({key:'Enter',isComposing:true,preventDefault(){}})");expect(h.run('round')).toBe(before);
    h.run("document.querySelector('#test-level-number').onkeydown({key:'Enter',preventDefault(){}})");
    expect(h.run('round')).toBe(Number(before)+1);expect(h.run('currentLevel')).toBe(500);expect(h.run('numberFocus')).toBe(1);
    h.element('#test-level-number-start').onclick();expect(h.run('round')).toBe(Number(before)+1);
  });
  it('시험 번호는 닫힘·예전 회차·처리 중·앱 비활성·광고/결제 pause에서 시작하지 않습니다',()=>{
    const states=["document.querySelector('#test-level-dialog').close()",'round++','boardPending=true','scene.canLeave=()=>false','nativeActive=false','document.hidden=true','resultTimer=77','testAds={pausesGame:true}','testBilling={pausesGame:true}','testAds={busy:true}','testBilling={busy:true}',"document.querySelector('#test-level-number').isConnected=false"];
    for(const state of states){
      const h=mainHarness(false,false,true,false,undefined,false);h.frame();h.run('showTestPicker()');h.element('#test-level-number').value='500';h.run(state);const before=h.run('round'),disk=h.disk();
      h.element('#test-level-number-start').onclick();expect(h.run('round')).toBe(before);expect(h.run('currentLevel')).toBe(2);expect(h.disk()).toEqual(disk);
    }
  });
  it('시험 번호 한영 표시는 현재 언어를 따르며 production에는 번호 진입을 노출하지 않습니다',()=>{
    const test=mainHarness(false,false,true);test.run('showTestPicker()');expect(test.element('#test-level-dialog').innerHTML).toContain('Level number');
    test.run("changeLanguage('ko')");expect(test.element('#test-level-dialog').innerHTML).toContain('스테이지 번호');
    const normal=mainHarness();normal.run('showTestPicker()');expect(normal.element('#test-level-dialog').innerHTML).not.toContain('test-level-number');expect(normal.element('#test-level-dialog').open).toBe(false);
  });
  it('시험 번호로 이동·실패·복귀해도 일반 회차의 실제 저장과 이동 수를 복원합니다',()=>{
    const h=mainHarness(false,false,true);h.run('scene.hooks.onMove([1,0,0,0,0,0],20)');const disk=h.disk(),saved=h.stored(),moves=h.run('moves');
    h.run('showTestPicker()');h.element('#test-level-number').value='500';h.element('#test-level-number-start').onclick();h.run('finish(false)');
    expect(h.disk()).toEqual(disk);h.element('#result-test').onclick();h.element('#test-normal').onclick();expect(h.run('currentLevel')).toBe(2);expect(h.run('moves')).toBe(moves);expect(h.stored()).toEqual(saved);
    expect(JSON.parse(h.disk().find(([key])=>key==='pawblossom.save.v1.backup')![1])).toEqual(saved);
  });
  it('선택 창 취소는 기존 보드와 이동을 유지하고 연쇄·결과 대기 중에는 열리지 않습니다',()=>{
    const h=mainHarness(false,false,true);h.run('moves=20');
    h.element('#test-level-button').onclick();h.element('#test-close').onclick();
    expect(h.run('moves')).toBe(20);expect(h.run('game.paused')).toBe(false);
    h.run('scene.canLeave=()=>false;showTestPicker()');expect(h.element('#test-level-dialog').open).toBe(false);
    h.run('scene.canLeave=()=>true;startLevel(1);scene.hooks.onMove([12,10,0,0,0,0],220);showTestPicker()');
    expect(h.element('#test-level-dialog').open).toBe(false);h.flushResults();h.run('showTestPicker()');expect(h.element('#test-level-dialog').open).toBe(false);
  });
  it('출시 설정은 테스트 UI와 기능을 끄며 새 실행에는 테스트 상태를 저장하지 않습니다',()=>{
    const h=mainHarness();expect(h.element('#app').innerHTML).not.toContain('test-level-button');
    h.run('showTestPicker();startLevel(2,true)');expect(h.element('#test-level-dialog').open).toBe(false);expect(h.run('testingLevel')).toBe(false);
    const test=mainHarness(false,false,true);test.run('startLevel(10,true)');expect(test.stored()).not.toHaveProperty('testingLevel');
    expect(test.run('loadSave().highestLevel')).toBe(2);
    test.run('startLevel(501,true)');expect(test.run('currentLevel')).toBe(10);
    test.run("showTestPicker();changeLanguage('ko')");expect(test.element('#test-level-dialog').innerHTML).toContain('낙엽 두 겹');
    test.element('#test-level-dialog').listeners.cancel({preventDefault(){}});expect(test.run('game.paused')).toBe(false);
  });
  it('열매와 낙엽 목표를 모두 채워야 완료되고 기존 보상은 재지급하지 않습니다',()=>{
    const h=mainHarness();h.run("save.highestLevel=6;startLevel(4)");
    h.run('scene.hooks.onMove([0,0,0,14,12,0],260,1,3)');
    expect(h.resultTimers()).toHaveLength(0);expect(h.run('clearedLeaves')).toBe(3);
    expect(h.element('#goals').innerHTML).toContain('leaf-pile.webp');
    h.run('scene.hooks.onMove([0,0,0,0,0,0],20,1,1)');h.flushResults();
    expect(h.stored()).toMatchObject({completed:[1,4],stars:2,coins:80});
    h.run('startLevel(4);scene.hooks.onMove([0,0,0,14,12,0],260,1,4)');h.flushResults();
    expect(h.stored()).toMatchObject({completed:[1,4],stars:2,coins:80});
    h.run('startLevel(6)');expect(h.run('clearedLeaves')).toBe(0);
    expect(h.element('#board-hint-text').textContent).toContain('2 means two layers');
    h.run("changeLanguage('ko')");expect(h.element('#board-hint-text').textContent).toContain('두 겹');
  });
  it('꽃밭 성장은 별 2개를 한 번만 쓰고 저장·그림·최대 5개 제한을 유지합니다',()=>{
    const h=mainHarness();h.run("save.stars=4;switchView('village')");
    h.element('#grow').onclick();h.element('#grow').onclick();
    expect(h.stored()).toMatchObject({stars:2,garden:1,coins:40,highestLevel:2});
    expect(h.element('#village-view').innerHTML).toContain('data-stage="1"');
    h.flushGrowth();h.element('#grow').onclick();
    expect(h.stored()).toMatchObject({stars:0,garden:2});
    h.flushGrowth();h.element('#grow').onclick();expect(h.run('save.garden')).toBe(2);
    h.run('save.garden=5;save.stars=8;renderViews()');h.element('#grow').onclick();
    expect(h.run('save.garden')).toBe(5);expect(h.run('save.stars')).toBe(8);
  });
  it('두 번째 이후 심은 꽃밭을 바로 선택하고 꽃 변경은 새 칸에만 반영합니다',()=>{
    const h=mainHarness();h.run("save.stars=10;switchView('village')");
    const flowers=['daisy','violet','daisy','violet','daisy'];
    for(let index=0;index<5;index++){
      if(index)h.element('#garden-plot-0').onclick();
      h.element('#grow').onclick();
      expect(h.run('selectedGardenPlot')).toBe(index);
      expect(h.element('#village-view').innerHTML).toMatch(new RegExp(`id="garden-plot-${index}"[^>]*aria-pressed="true"`));
      h.flushGrowth();h.element('#garden-flower-'+flowers[index]).onclick();
      expect(h.stored().gardenDesign.flowers.slice(0,index+1)).toEqual(flowers.slice(0,index+1));
      expect(h.stored().stars).toBe(10-2*(index+1));
    }
    const before=h.disk();h.element('#grow').onclick();expect(h.run('selectedGardenPlot')).toBe(4);expect(h.disk()).toEqual(before);
  });
  it('심기 종료 뒤 현재 돌보기 버튼을 풀고 그림·초점·스크롤·저장을 다시 만들지 않습니다',()=>{
    const h=mainHarness();h.run("save.stars=4;save.pip={growth:60,affection:40,owned:[],equipped:'none'};switchView('village')");
    expect(h.element('#garden-tend').disabled).toBe(true);h.element('#grow').onclick();
    const button=h.element('#garden-tend'),html=h.element('#village-view').innerHTML,writes=h.writes(),disk=h.disk();
    h.element('#village-view').scrollTop=83;h.run("document.activeElement=document.querySelector('#grow')");
    expect(button.disabled).toBe(true);h.flushGrowth();
    expect(h.element('#garden-tend')).toBe(button);expect(button.disabled).toBe(false);expect(h.element('#village-view').innerHTML).toBe(html);
    expect(h.element('#village-view').scrollTop).toBe(83);expect(h.run('document.activeElement.id')).toBe('grow');expect(h.writes()).toBe(writes);expect(h.disk()).toEqual(disk);
    if(!button.disabled)button.onclick();expect(h.run('gardenTendingPlot')).toBe(0);expect(h.run('pipReaction')).toBe('tend');expect(h.disk()).toEqual(disk);
  });
  it.each(['young','hidden','new-dom'] as const)('심기 종료는 %s의 현재 조건과 현재 버튼만 반영합니다',state=>{
    const h=mainHarness();h.run("save.stars=4;save.pip={growth:60,affection:40,owned:[],equipped:'none'};switchView('village')");h.element('#grow').onclick();
    const old=h.element('#garden-tend');
    if(state==='young')h.run('save.pip.growth=20');
    if(state==='hidden')h.run('document.hidden=true;syncActivity()');
    if(state==='new-dom')h.run("switchView('journal');document.querySelector('#pip-open-space').onclick()");
    const current=h.element('#garden-tend'),disk=h.disk(),writes=h.writes();h.flushGrowth();
    expect(current.disabled).toBe(state==='young');expect(h.run('growing')).toBe(false);expect(h.run('growthTimer')).toBeUndefined();
    if(state==='new-dom'){expect(current).not.toBe(old);expect(old.isConnected).toBe(false);expect(old.disabled).toBe(true);}
    if(state==='hidden'){current.onclick();expect(h.run('pipReaction')).toBeUndefined();h.run('document.hidden=false;syncActivity()');expect(current.disabled).toBe(false);}
    expect(h.disk()).toEqual(disk);expect(h.writes()).toBe(writes);
  });
  it.each(['stars','storage'] as const)('%s 때문에 심지 못하면 기존 선택을 바꾸지 않습니다',reason=>{
    const h=mainHarness(reason==='storage');h.run("save.garden=2;selectedGardenPlot=0;save.stars="+(reason==='stars'?1:2)+";switchView('village')");
    const before=h.run('JSON.stringify({garden:save.garden,stars:save.stars,selectedGardenPlot})');h.element('#grow').onclick();
    expect(h.run('JSON.stringify({garden:save.garden,stars:save.stars,selectedGardenPlot})')).toBe(before);
    expect(h.run('growing')).toBe(false);
  });
  it('이전 꽃밭을 살펴보던 중 심어도 새 칸의 핍 활동을 다시 선택할 수 있습니다',()=>{
    const h=mainHarness();h.run("save.stars=4;switchView('village')");h.element('#grow').onclick();h.flushGrowth();
    h.element('#garden-activity-flower').onclick();expect(h.run('gardenActivity')).toEqual({kind:'flower',plot:0});
    h.element('#grow').onclick();expect(h.run('selectedGardenPlot')).toBe(1);expect(h.run('gardenActivity')).toBeUndefined();
    h.flushGrowth();h.element('#garden-activity-flower').onclick();expect(h.run('gardenActivity')).toEqual({kind:'flower',plot:1});
    expect(h.stored()).toMatchObject({garden:2,stars:0});
  });
  it('심기 직후 핍의 공간 바로가기로 이동해 버튼이 없어져도 타이머와 모션을 정리합니다',()=>{
    const h=mainHarness();h.run("save.stars=4;switchView('village');const realQuery=document.querySelector;document.querySelector=selector=>selector==='#grow'&&selectedGardenArea!=='flowers'?null:realQuery(selector)");
    h.element('#grow').onclick();const stored=h.stored(),disk=h.disk(),writes=h.writes();
    expect(stored).toMatchObject({stars:2,garden:1,coins:40});expect(h.run('growing')).toBe(true);
    h.run("switchView('journal')");h.element('#pip-open-space').onclick();
    expect(h.run('route')).toBe('village');expect(h.run('selectedGardenArea')).toBe('pond');
    expect(h.element('#village-view').innerHTML).not.toContain('id="grow"');expect(h.run("document.querySelector('#grow')")).toBeNull();
    expect(h.natureControllers.filter(c=>!c.disposed).map(c=>c.picture.dataset.natureActive)).toEqual(['false']);
    expect(()=>h.flushGrowth()).not.toThrow();expect(h.run('growing')).toBe(false);expect(h.run('growthTimer')).toBeUndefined();
    expect(h.stored()).toEqual(stored);expect(h.disk()).toEqual(disk);expect(h.writes()).toBe(writes);
    expect(h.natureControllers.filter(c=>!c.disposed).map(c=>c.picture.dataset.natureActive)).toEqual(['true']);
  });
  it('정원 저장 실패 안내는 성공 메시지로 덮어쓰지 않습니다',()=>{
    const h=mainHarness(true);h.run("save.stars=2;switchView('village')");h.element('#grow').onclick();
    expect(h.run('save.garden')).toBe(0);expect(h.run('save.stars')).toBe(2);
    expect(h.element('#save-status').textContent).toMatch(/recovery copy could not be written/);
    expect(h.stored().garden).toBe(0);
  });
  it.each(['ko','en'] as const)('스테이지 이름에 %s 완료·잠금 상태를 포함하고 잠금은 비활성으로 유지합니다',language=>{
    const h=mainHarness();h.run(`changeLanguage('${language}');switchView('map')`);
    const html=h.element('#map-view').innerHTML;
    expect(html).toContain(`aria-label="${t(language,'level')} 1 · ${t(language,'levelCompleted')}"`);
    expect(html).toContain(`aria-label="${t(language,'level')} 2 · ${t(language,'mapAvailable')} · ${t(language,'previewCurrent')}"`);
    expect(html).toContain('aria-current="step"');
    expect(html).toMatch(new RegExp(`data-level="3" disabled[^>]+aria-label="${t(language,'level')} 3 · ${t(language,'levelLocked')}"`));
  });
  it('정원 DOM 갱신은 내부 스크롤과 심기 뒤 상태 초점을 복원합니다',()=>{
    const h=mainHarness();
    h.run(`document.querySelector('#village-view').scrollTop=87;document.querySelector('#village-view').scrollLeft=0;
      document.activeElement={id:'grow',isConnected:false};document.querySelector('#grow').disabled=true;
      globalThis.focused='';document.querySelector('#garden-stage').focus=options=>{globalThis.focused='garden-stage';globalThis.preventScroll=options.preventScroll};renderViews(true);`);
    expect(h.run('focused')).toBe('garden-stage');expect(h.run('preventScroll')).toBe(true);
    expect(h.run("document.querySelector('#village-view').scrollTop")).toBe(87);
  });
  it.each(['ko','en'] as const)('최초 보상은 %s 별·코인 종류와 수량을 함께 렌더합니다',language=>{
    const h=mainHarness();h.run(`changeLanguage('${language}');finish(true)`);
    const html=h.element('#result-dialog').innerHTML;
    expect(html).toContain(`data-t="stars">${t(language,'stars')}</span> +1`);
    expect(html).toContain(`data-t="coins">${t(language,'coins')}</span> +40`);
    expect(h.stored()).toMatchObject({stars:2,coins:80,completed:[1,2]});
  });
  it('새 회차 시작은 이전 결과 타이머를 취소하고 이미 추출한 콜백도 무시합니다', () => {
    const h = mainHarness();
    h.run('startLevel(1);scene.hooks.onMove([12,10,0,0,0,0],220)');
    const oldTimer = h.resultTimers()[0];
    expect(oldTimer).toBeDefined();
    h.run('startLevel(2)');
    expect(h.resultTimers()).toHaveLength(0);
    oldTimer.callback();
    expect(Array.from(h.run('save.completed'))).toEqual([1]);
    expect(h.run('save.stars')).toBe(1);
    expect(h.run('save.highestLevel')).toBe(2);
    expect(h.run('score')).toBe(0);
    expect(h.element('#result-dialog').open).toBe(false);
  });

  it('마을·설정에서 열린 승리/실패 결과의 다음·재시도는 퍼즐을 표시합니다', () => {
    for (const route of ['village', 'settings']) for (const won of [true, false]) {
      const h = mainHarness();
      h.run('startLevel(1)');
      h.run(won ? 'scene.hooks.onMove([12,10,0,0,0,0],220)' : 'moves=1;scene.hooks.onMove([0,0,0,0,0,0],0)');
      h.run(`switchView('${route}')`);
      h.flushResults();
      expect(h.element('#result-dialog').open).toBe(true);
      h.element('#result-next').onclick();
      expect(h.run('route')).toBe('puzzle');
      expect(h.element('#puzzle-view').hidden).toBe(false);
      expect(h.element(`#${route}-view`).hidden).toBe(true);
      expect(h.run('currentLevel')).toBe(won ? 2 : 1);
      expect(h.element('#result-dialog').open).toBe(false);
    }
  });

  it('두 번째 손가락은 첫 제스처를 덮어쓰거나 완료하지 않습니다', () => {
    const { handlers, attempts, taps } = boardHarness();
    handlers.pointerdown({ id: 1, x: 44, y: 44 });
    handlers.pointerdown({ id: 2, x: 100, y: 44 });
    handlers.pointerup({ id: 2, x: 100, y: 44 });
    expect(taps).toHaveLength(0);
    expect(attempts).toHaveLength(0);
    handlers.pointerup({ id: 1, x: 44, y: 44 });
    expect(taps).toEqual([{ row: 0, col: 0 }]);
    expect(attempts).toHaveLength(0);
  });

  it('일시정지 중 손을 떼어도 복귀 후 제자리 탭은 이전 스와이프로 처리되지 않습니다', () => {
    for (const event of ['pause', 'resume', 'sleep', 'shutdown']) {
      const { handlers, lifecycle, attempts, taps, scene } = boardHarness();
      handlers.pointerdown({ id: 1, x: 44, y: 44 });
      scene.selected = { row: 0, col: 0 };
      lifecycle[event]();
      expect(scene.down).toBeUndefined();
      expect(scene.selected).toBeUndefined();
      // 비활성 Scene에서는 놓기 이벤트가 전달되지 않는 상황입니다.
      if (event === 'pause' || event === 'sleep') lifecycle.resume();
      if (event === 'shutdown') continue; // 종료한 Scene은 입력을 재개하지 않습니다.
      handlers.pointerdown({ id: 1, x: 100, y: 44 });
      handlers.pointerup({ id: 1, x: 100, y: 44 });
      expect(taps).toEqual([{ row: 0, col: 1 }]);
      expect(attempts).toHaveLength(0);
    }
  });

  it('초기화 의도 저장에 실패하면 세션과 기존 기록을 유지하고 안내합니다', () => {
    const h = mainHarness(true);
    h.element('#reset').onclick();
    expect(h.writes()).toBeGreaterThan(0);
    expect(h.run('save.highestLevel')).toBe(2);
    expect(h.element('#save-status').textContent).toMatch(/Reset could not be recorded/);
    expect(h.stored().highestLevel).toBe(2); // 저장 실패가 이전 데이터를 지우지는 않습니다.
    expect(h.run('loadSave().highestLevel')).toBe(2);
  });
});

describe('첫 플레이 안내', () => {
  it.each(['ko','en'] as const)('%s 안내와 실제 특수 탭 실습은 본판과 같은 자체 특수 원본을 쓰고 회차를 보존합니다',language=>{
    const h=mainHarness(false,true);h.run(`changeLanguage('${language}')`);
    const disk=h.disk(),round=h.run('JSON.stringify({round,moves,score,collected,board:scene.engine.board})');
    h.element('#guide-next').onclick();h.element('#guide-next').onclick();
    const html=h.element('#tutorial-dialog').innerHTML;
    for(const special of ['row','rainbow','bomb'])expect(html).toContain(`/assets/specials-v4/${special}.webp`);
    expect(html).not.toContain('guide-special special-');
    h.element('#guide-next').onclick();h.element('#practice-cell-0-2').onclick({detail:0,button:0});h.element('#practice-cell-1-2').onclick({detail:0,button:0});
    h.element('#practice-special').onclick();
    expect(h.element('#tutorial-dialog').innerHTML).toContain('/assets/specials-v4/row.webp');
    expect(h.element('#tutorial-dialog').innerHTML).toContain('special-tile-art-row');
    h.element('#practice-cell-1-1').onclick({detail:0,button:0});
    const completed=h.element('#tutorial-dialog').innerHTML;
    expect(completed).toContain('special-tile-art-row');expect(completed).toContain('class="practice-check"');
    expect(completed).toMatch(/id="practice-cell-1-1"[^>]+practice-cleared/);
    expect(h.run('JSON.stringify({round,moves,score,collected,board:scene.engine.board})')).toBe(round);expect(h.disk()).toEqual(disk);
  });
  it('언어 전환 때 별·코인 보조 라벨이 갱신되며 지갑 숫자는 유지됩니다',()=>{
    const h=mainHarness();
    expect(h.element('.wallet.stars .sr-only').textContent).toBe('Stars');
    expect(h.element('.wallet.coins .sr-only').textContent).toBe('Coins');
    h.run("changeLanguage('ko')");
    expect(h.element('.wallet.stars .sr-only').textContent).toBe('별');
    expect(h.element('.wallet.coins .sr-only').textContent).toBe('코인');
    expect(h.element('#star-count').textContent).toBe('1');
    expect(h.element('#coin-count').textContent).toBe('40');
    h.run("changeLanguage('en')");
    expect(h.element('.wallet.coins .sr-only').textContent).toBe('Coins');
    expect(h.stored()).toMatchObject({stars:1,coins:40,highestLevel:2,completed:[1]});
  });
  it('첫 실행은 보드를 멈추고 설명·실습을 끝낸 뒤 저장하고 재개합니다', () => {
    const h=mainHarness(false,true);
    expect(h.element('#tutorial-dialog').open).toBe(true);
    expect(h.run('game.paused')).toBe(true);
    h.element('#guide-next').onclick();
    expect(h.run('tutorialPage')).toBe(1);
    h.element('#guide-next').onclick();
    expect(h.run('tutorialPage')).toBe(2);
    h.element('#guide-next').onclick();
    expect(h.run('tutorialPage')).toBe(3);
    h.element('#guide-next').onclick(); // 실습 전에는 다음으로 갈 수 없습니다.
    expect(h.element('#tutorial-dialog').open).toBe(true);
    h.element('#practice-cell-0-2').onclick({detail:0,button:0});
    h.element('#practice-cell-1-2').onclick({detail:0,button:0});
    expect(h.run('practice.completed')).toBe(true);
    h.element('#guide-next').onclick();
    expect(h.element('#tutorial-dialog').open).toBe(false);
    expect(h.run('game.paused')).toBe(false);
    expect(h.stored().tutorialSeen).toBe(true);
    expect(h.run('moves')).toBe(26);
    expect(h.stored().completed).toEqual([]);
  });
  it('건너뛰기와 Escape 모두 재실행 때 자동 안내를 반복하지 않습니다', () => {
    for(const escape of [false,true]){
      const h=mainHarness(false,true);
      if(escape)h.element('#tutorial-dialog').listeners.cancel({preventDefault(){}});
      else h.element('#guide-skip').onclick();
      expect(h.run('loadSave().tutorialSeen')).toBe(true);
      expect(h.element('#tutorial-dialog').open).toBe(false);
      expect(h.run('game.paused')).toBe(false);
    }
  });
  it('기존 완료 기록이 있으면 자동 안내를 생략하고 설정에서 다시 볼 수 있습니다', () => {
    const h=mainHarness();
    expect(h.element('#tutorial-dialog').open).toBe(false);
    h.run("switchView('settings');showTutorial()");
    expect(h.element('#tutorial-dialog').open).toBe(true);
    h.element('#guide-next').onclick();
    h.element('#guide-back').onclick();
    expect(h.run('tutorialPage')).toBe(0);
    h.element('#guide-skip').onclick();
    expect(h.run('route')).toBe('settings');
    expect(h.run('game.paused')).toBe(true);
    h.run("switchView('puzzle')");
    expect(h.run('game.paused')).toBe(false);
  });
  it('안내 도중 언어를 바꾸어도 현재 단계와 진행은 보존됩니다', () => {
    const h=mainHarness(false,true);
    h.element('#guide-next').onclick();
    h.run("changeLanguage('ko')");
    expect(h.run('tutorialPage')).toBe(1);
    expect(h.element('#tutorial-dialog').open).toBe(true);
    expect(h.stored().language).toBe('ko');
    expect(h.run('moves')).toBe(26);
  });
  it('결과 대기 또는 결과 창 표시 중에는 안내를 열지 않습니다', () => {
    const h=mainHarness();
    h.run('startLevel(1);scene.hooks.onMove([12,10,0,0,0,0],220);showTutorial()');
    expect(h.element('#tutorial-dialog').open).toBe(false);
    h.flushResults();
    h.run('showTutorial()');
    expect(h.element('#tutorial-dialog').open).toBe(false);
    expect(h.element('#result-dialog').open).toBe(true);
  });
  it('설정 실습은 언어 변경 중 선택과 성공을 유지하며 진행·보상을 쓰지 않습니다',()=>{
    const h=mainHarness();const before=h.stored();
    h.run("switchView('settings');showTutorial()");
    for(let i=0;i<3;i++)h.element('#guide-next').onclick();
    h.element('#practice-cell-1-2').onclick({detail:0,button:0});
    h.run("changeLanguage('ko')");
    expect(h.run('practice.selected.row')).toBe(1);
    h.element('#practice-cell-0-2').onclick({detail:0,button:0});
    h.run("changeLanguage('en')");
    expect(h.run('practice.completed')).toBe(true);
    expect(h.run('moves')).toBe(24); // 현재 본 게임은 저장된 2스테이지입니다.
    h.element('#guide-next').onclick();
    expect(h.stored()).toMatchObject(before);
    expect(h.run('route')).toBe('settings');
    expect(h.run('game.paused')).toBe(true);
    h.run('showTutorial()');
    for(let i=0;i<3;i++)h.element('#guide-next').onclick();
    expect(h.run('practice.completed')).toBe(false);
  });
  it.each(['ko','en'])('%s 선택형 특수 탭은 기존 완료·본판 엔진·전체 저장을 보존하고 초점을 옮깁니다',language=>{
    const h=mainHarness();h.run(`changeLanguage('${language}');switchView('settings');showTutorial()`);
    for(let i=0;i<3;i++)h.element('#guide-next').onclick();
    expect(h.element('#tutorial-dialog').innerHTML).not.toContain('id="practice-special"');
    h.element('#practice-cell-0-2').onclick({detail:0,button:0});h.element('#practice-cell-1-2').onclick({detail:0,button:0});
    expect(h.element('#tutorial-dialog').innerHTML).toContain('id="practice-special"');
    const disk=h.disk(),state=h.run('JSON.stringify({moves,score,collected,save,board:scene.engine.board,leaves:scene.engine.leaves})');
    h.run('globalThis.originalScene=scene;globalThis.originalResult=practice.result;globalThis.controlEngine=new (require("./core").BoardEngine)(8,8,require("./core").seededRng(42));');
    let focused='';h.element('#practice-cell-1-1').focus=()=>{focused='center';};h.element('#guide-next').focus=()=>{focused='start';};
    h.element('#practice-special').onclick();expect(focused).toBe('center');
    expect(h.run('practice.completed&&practice.result===originalResult')).toBe(true);
    expect(h.element('#tutorial-dialog').innerHTML).toContain('4 / 4');
    expect(h.element('#tutorial-dialog').innerHTML).not.toMatch(/id="guide-next"[^>]*disabled/);
    h.element('#practice-cell-1-1').onclick({detail:0,button:0});expect(focused).toBe('start');
    expect(h.run('specialPractice.completed')).toBe(true);
    expect(h.element('#tutorial-dialog').innerHTML.match(/practice-cleared/g)).toHaveLength(3);
    expect(h.run('scene===originalScene&&practice.result===originalResult')).toBe(true);
    expect(h.run('JSON.stringify({moves,score,collected,save,board:scene.engine.board,leaves:scene.engine.leaves})')).toBe(state);
    expect(h.disk()).toEqual(disk);
    expect(h.run('scene.engine.shuffle();controlEngine.shuffle();JSON.stringify(scene.engine.board)===JSON.stringify(controlEngine.board)')).toBe(true);
  });
  it('특수 실습의 언어 재렌더는 캡처를 취소하고 상태·초점을 유지하며 뒤로·재열기는 초기화합니다',()=>{
    const h=mainHarness();h.run("switchView('settings');showTutorial()");
    for(let i=0;i<3;i++)h.element('#guide-next').onclick();
    h.run('practice.swipe({row:0,col:2},0,60);renderTutorial()');h.element('#practice-special').onclick();
    let focused=0,released=0;h.element('#practice-cell-1-1').focus=()=>{focused++;};
    h.element('#practice-cell-1-1').hasPointerCapture=()=>true;h.element('#practice-cell-1-1').releasePointerCapture=()=>{released++;};
    h.run("document.querySelector('#practice-cell-1-1').onpointerdown({preventDefault(){},button:0,isPrimary:true,pointerId:1,clientX:30,clientY:30});changeLanguage('ko')");
    expect(released).toBe(1);expect(focused).toBe(1);expect(h.run('specialPractice.completed')).toBe(false);
    h.element('#practice-cell-1-1').onclick({detail:0,button:0});h.run("changeLanguage('en')");expect(h.run('specialPractice.completed')).toBe(true);
    h.element('#guide-back').onclick();h.element('#guide-next').onclick();expect(h.run('specialPractice')).toBeUndefined();expect(h.run('practice.completed')).toBe(false);
    h.element('#guide-skip').onclick();h.run('showTutorial()');expect(h.run('specialPractice')).toBeUndefined();expect(h.run('tutorialPage')).toBe(0);
  });
  it.each(['start','skip','escape'])('선택형 특수 실습 미완료에서도 %s로 즉시 나갈 수 있습니다',exit=>{
    const h=mainHarness(false,true);for(let i=0;i<3;i++)h.element('#guide-next').onclick();
    h.run('practice.swipe({row:0,col:2},0,60);renderTutorial()');h.element('#practice-special').onclick();
    expect(h.run('specialPractice.completed')).toBe(false);
    if(exit==='escape')h.element('#tutorial-dialog').listeners.cancel({preventDefault(){}});else h.element(exit==='start'?'#guide-next':'#guide-skip').onclick();
    expect(h.element('#tutorial-dialog').open).toBe(false);expect(h.stored().tutorialSeen).toBe(true);expect(h.run('game.paused')).toBe(false);expect(h.run('moves')).toBe(26);
  });
  it('완료 초점은 즉시 이동하되 후속 터치 click 전에는 스크롤하지 않고 닫힌·교체된 DOM 예약은 무시합니다',()=>{
    const h=mainHarness(false,true);for(let i=0;i<3;i++)h.element('#guide-next').onclick();
    h.run(`globalThis.scrolls=0;globalThis.focusOptions=undefined;globalThis.pendingFocus=[];
      setTimeout=callback=>{pendingFocus.push(callback);return pendingFocus.length;};
      document.querySelector('#guide-next').focus=options=>{focusOptions=options;document.activeElement=document.querySelector('#guide-next');};
      document.querySelector('#guide-next').scrollIntoView=()=>{scrolls++;};
      practice.swipe({row:0,col:2},0,60);renderTutorial();focusPracticeStart();`);
    expect(h.run('focusOptions.preventScroll')).toBe(true);expect(h.run('scrolls')).toBe(0);
    h.run('pendingFocus.shift()()');expect(h.run('scrolls')).toBe(1);
    h.run("focusPracticeStart();document.activeElement=document.querySelector('#guide-skip');pendingFocus.shift()()");expect(h.run('scrolls')).toBe(1);
    h.run('focusPracticeStart();document.querySelector("#guide-next").isConnected=false;pendingFocus.shift()()');expect(h.run('scrolls')).toBe(1);
    h.run('document.querySelector("#guide-next").isConnected=true;focusPracticeStart();closeTutorial();pendingFocus.shift()()');expect(h.run('scrolls')).toBe(1);
  });
  it('실습 중 건너뛰기와 뒤로 이동은 게임 진행을 바꾸지 않습니다',()=>{
    const h=mainHarness(false,true);
    for(let i=0;i<3;i++)h.element('#guide-next').onclick();
    h.element('#practice-cell-0-2').onclick({detail:0,button:0});
    h.element('#guide-back').onclick();h.element('#guide-next').onclick();
    expect(h.run('practice.selected')).toBeUndefined();
    h.element('#guide-skip').onclick();
    expect(h.run('moves')).toBe(26);
    expect(h.stored()).toMatchObject({completed:[],stars:0,coins:0,tutorialSeen:true});
  });
  it('실습 포인터는 다른 손가락의 놓기를 무시하고 취소 후 다시 밀 수 있습니다',()=>{
    const h=mainHarness(false,true);
    for(let i=0;i<3;i++)h.element('#guide-next').onclick();
    h.run("document.querySelector('#practice-cell-0-2').onpointerdown({preventDefault(){},button:0,isPrimary:true,pointerId:1,clientX:0,clientY:0})");
    h.run("document.querySelector('#practice-cell-0-2').onpointerup({button:0,pointerId:2,clientX:0,clientY:60,preventDefault(){}})");
    expect(h.run('practice.completed')).toBe(false);
    h.run("document.querySelector('#practice-cell-0-2').onpointercancel({pointerId:1})");
    h.run("document.querySelector('#practice-cell-0-2').onpointerdown({preventDefault(){},button:0,isPrimary:true,pointerId:3,clientX:0,clientY:0})");
    h.run("document.querySelector('#practice-cell-0-2').onpointerup({button:0,pointerId:3,clientX:0,clientY:60,preventDefault(){}})");
    expect(h.run('practice.completed')).toBe(true);
    expect(h.run('moves')).toBe(26);
    expect(h.run('save.coins')).toBe(0);
  });
});


describe('100스테이지 진행과 선택 묶음',()=>{
  it('10번 완료는 11번을 해제하고 마지막 완료 안내를 표시하지 않습니다',()=>{
    const app=mainHarness();app.run('startLevel(10);finish(true)');
    expect(app.stored().highestLevel).toBe(11);
    expect(app.element('#result-dialog').innerHTML).toContain('Next level');
    app.element('#result-next').onclick();expect(app.run('currentLevel')).toBe(11);
    expect(app.element('#chapter-name').textContent).toContain('Flower Path');
    app.run('startLevel(40);finish(true)');expect(app.stored().highestLevel).toBe(41);expect(app.element('#result-dialog').innerHTML).toContain('Next level');expect(app.element('#result-dialog').innerHTML).not.toContain('All 100 prototype levels');
    const earned=app.stored();app.element('#result-next').onclick();expect(app.run('currentLevel')).toBe(41);app.run('startLevel(40);finish(true)');expect(app.stored().coins).toBe(earned.coins);expect(app.stored().stars).toBe(earned.stars);expect(app.stored().completed).toEqual(earned.completed);
  });
  it('100번은101로이어지고500번만마지막이며구100재완료보상은없습니다',()=>{
    const app=mainHarness();app.run('startLevel(100);finish(true)');expect(app.stored().highestLevel).toBe(101);expect(app.element('#result-dialog').innerHTML).toContain('Next level');
    const first=app.stored();app.element('#result-next').onclick();expect(app.run('currentLevel')).toBe(101);app.run('startLevel(100);finish(true)');expect(app.stored().coins).toBe(first.coins);expect(app.stored().stars).toBe(first.stars);
    app.run('startLevel(500);finish(true)');expect(app.stored().highestLevel).toBe(500);expect(app.element('#result-dialog').innerHTML).not.toContain('You have cleared all 500 stages');expect(app.element('#result-dialog').innerHTML).toContain(t('en','winDesc'));app.element('#result-next').onclick();expect(app.run('currentLevel')).toBe(500);
    const before=app.stored();app.run('finish(true)');expect(app.stored()).toEqual({...before,inProgress:undefined});
  });
  it('일반 선택 묶음은 잠금을 유지하고 테스트 30번은 진행 기록을 바꾸지 않습니다',()=>{
    const app=mainHarness(false,false,true), before=app.stored();
    app.run("switchView('map');document.querySelector('#map-chapter-select').onchange({target:{value:'3'}})");expect(app.run('selectedChapter')).toBe(3);
    expect(app.element('#map-view').innerHTML).toContain('data-level="30" disabled');
    expect(app.element('#map-view').innerHTML).toContain('data-level="1"');
    app.run('showTestPicker()');app.element('#test-chapter-3').onclick();
    expect(app.element('#test-level-dialog').innerHTML).toContain('data-test-level="30"');
    expect(app.element('#test-level-dialog').innerHTML).not.toContain('data-test-level="1"');
    app.element('#test-stage-30').onclick();app.run('finish(true)');expect(app.stored()).toEqual(before);
    app.run("showTestPicker();document.querySelector('#test-chapter-3').onkeydown({key:'End',preventDefault(){}})");expect(app.element('#test-level-dialog').innerHTML).toContain('data-test-level="500"');
    app.run("globalThis.tabStrip={scrollLeft:0,getBoundingClientRect:()=>({left:0,right:96,width:96})};const lastTab=document.querySelector('#test-chapter-11');lastTab.parentElement=tabStrip;lastTab.getBoundingClientRect=()=>({left:960,right:1056});document.querySelector('#village-view').scrollTop=77;revealChapterTab(lastTab)");expect(app.run('tabStrip.scrollLeft')).toBe(960);expect(app.run("document.querySelector('#village-view').scrollTop")).toBe(77);
    app.run("document.querySelector('#test-level-dialog').close();startLevel(100,true);tabStrip.scrollLeft=0;tabStrip.getBoundingClientRect=()=>document.querySelector('#test-level-dialog').open?({left:0,right:96,width:96}):({left:0,right:0,width:0});showTestPicker()");expect(app.run('tabStrip.scrollLeft')).toBe(960);
  });
});


describe('첫 활성 배경음과 현재 언어 선택',()=>{
  it('Android 초기 활성 확인 뒤 입력 없이 한 번 준비하고 복귀 이벤트로 중복 준비하지 않습니다',async()=>{
    const h=mainHarness(false,false,false,true);
    expect(h.run('audio.unlocks')).toBe(0);
    await Promise.resolve();h.resolveNativeState({isActive:true});await new Promise(resolve=>setTimeout(resolve,0));
    expect(h.run('audio.unlocks')).toBe(1);expect(h.run('audio.suspended')).toBe(false);
    h.nativeEvents.appStateChange({isActive:false});h.nativeEvents.appStateChange({isActive:true});h.documentEvents.visibilitychange();
    expect(h.run('audio.unlocks')).toBe(1);
  });
  it('숨김 문서와 광고 보류가 모두 풀린 뒤에만 첫 자동 준비를 합니다',()=>{
    const h=mainHarness(false,false,false,true);
    h.run('document.hidden=true;nativeActive=true;syncActivity()');expect(h.run('audio.unlocks')).toBe(0);
    h.run('document.hidden=false;testAds={pausesGame:true};syncActivity()');expect(h.run('audio.unlocks')).toBe(0);
    h.run('testAds=undefined;testBilling={pausesGame:true};syncActivity()');expect(h.run('audio.unlocks')).toBe(0);
    h.run('testBilling=undefined;syncActivity()');expect(h.run('audio.unlocks')).toBe(1);
  });
  it('저장된 배경음 끄기를 존중하고 웹은 기존 첫 입력 경로를 유지합니다',()=>{
    const h=mainHarness(false,false,false,true,{version:1,language:'ko',highestLevel:1,completed:[],stars:0,coins:0,garden:0,music:false,sfx:true,tutorialSeen:true});
    h.run('nativeActive=true;syncActivity()');expect(h.run('audio.unlocks')).toBe(0);expect(h.stored().music).toBe(false);
    const web=mainHarness();expect(web.run('audio.unlocks')).toBe(0);web.documentEvents.pointerdown();expect(web.run('audio.unlocks')).toBe(1);
  });
  it('자동 준비가 실패해도 첫 입력에서 재시도할 수 있습니다',async()=>{
    const h=mainHarness(false,false,false,true);
    h.run('audio.unlock=()=>{audio.unlocks++;return Promise.reject(new Error("blocked"));};nativeActive=true;syncActivity()');
    await Promise.resolve();expect(h.run('audio.unlocks')).toBe(1);
    h.documentEvents.pointerdown();await Promise.resolve();expect(h.run('audio.unlocks')).toBe(2);
  });
  it('상단과 설정의 선택이 현재 언어 표시·저장에 함께 반영되고 회차는 유지됩니다',()=>{
    const h=mainHarness(),round=h.run('JSON.stringify({round,moves,score,collected,board:scene.engine.board,leaves:scene.engine.leaves})');
    expect(h.run('document.querySelector("#language-toggle").value')).toBe('en');
    h.run('document.querySelector("#language-toggle").onchange({target:{value:"ko"}})');
    expect(h.stored().language).toBe('ko');expect(h.run('document.querySelector("#language-toggle").value')).toBe('ko');
    expect(h.element('#settings-view').innerHTML).toContain('value="ko" selected');
    h.run('document.querySelector("#language").onchange({target:{value:"en"}})');
    expect(h.stored().language).toBe('en');expect(h.run('document.querySelector("#language-toggle").value')).toBe('en');
    expect(h.run('JSON.stringify({round,moves,score,collected,board:scene.engine.board,leaves:scene.engine.leaves})')).toBe(round);
  });
});

describe('문서·Android·모달 복귀',()=>{
  it('문서 표시가 먼저 돌아와도 Android 비활성이면 보드와 소리를 재개하지 않습니다',async()=>{
    const app=mainHarness(false,false,true,true);
    await Promise.resolve();app.resolveNativeState({isActive:true});await new Promise(resolve=>setTimeout(resolve,0));
    expect(app.run('game.paused')).toBe(false);
    app.nativeEvents.appStateChange({isActive:false});
    app.run('document.hidden=true');app.documentEvents.visibilitychange();
    app.run('document.hidden=false');app.documentEvents.visibilitychange();
    expect(app.run('game.paused')).toBe(true);expect(app.run('audio.suspended')).toBe(true);
    app.nativeEvents.appStateChange({isActive:true});expect(app.run('game.paused')).toBe(false);expect(app.run('audio.suspended')).toBe(false);
    const resumes=app.run('audio.resumes'), sceneResumes=app.run('game.resumes');
    app.nativeEvents.appStateChange({isActive:true});app.documentEvents.visibilitychange();
    expect(app.run('audio.resumes')).toBe(resumes);expect(app.run('game.resumes')).toBe(sceneResumes);
  });
  it('Android가 먼저 돌아와도 문서가 숨겨져 있으면 재개하지 않습니다',()=>{
    const app=mainHarness(false,false,false,true);
    app.run('document.hidden=true');app.documentEvents.visibilitychange();
    app.nativeEvents.appStateChange({isActive:true});expect(app.run('game.paused')).toBe(true);expect(app.run('audio.suspended')).toBe(true);
    app.run('document.hidden=false');app.documentEvents.visibilitychange();expect(app.run('game.paused')).toBe(false);
  });
  it('늦은 초기 Android 상태는 그 뒤 수신한 상태를 덮어쓰지 않습니다',async()=>{
    const app=mainHarness(false,false,false,true);await Promise.resolve();
    app.nativeEvents.appStateChange({isActive:true});app.resolveNativeState({isActive:false});await new Promise(resolve=>setTimeout(resolve,0));
    expect(app.run('nativeActive')).toBe(true);expect(app.run('game.paused')).toBe(false);
  });
  it('안내·테스트·결과 창과 다른 화면에서는 복귀해도 보드를 멈춰 둡니다',()=>{
    const app=mainHarness(false,false,true);
    for(const modal of ['showTutorial()','showTestPicker()','finish(false)']){
      app.run('startLevel(2);'+modal);expect(app.run('game.paused')).toBe(true);
      app.run('document.hidden=true');app.documentEvents.visibilitychange();app.run('document.hidden=false');app.documentEvents.visibilitychange();
      expect(app.run('game.paused')).toBe(true);
      app.run("document.querySelector('#tutorial-dialog').close();document.querySelector('#test-level-dialog').close();document.querySelector('#result-dialog').close();syncActivity()");
      expect(app.run('game.paused')).toBe(false);
    }
    app.run("switchView('settings');document.hidden=true");app.documentEvents.visibilitychange();app.run('document.hidden=false');app.documentEvents.visibilitychange();expect(app.run('game.paused')).toBe(true);
    app.run("switchView('puzzle')");expect(app.run('game.paused')).toBe(true);expect(app.element('#result-dialog').open).toBe(true);
    app.element('#result-next').onclick();expect(app.run('game.paused')).toBe(false);
  });
  it('결과에서 선택창을 취소하면 보드가 결과창 아래에서 재개되지 않습니다',()=>{
    const app=mainHarness(false,false,true);app.run('startLevel(6,true);finish(false)');app.element('#result-test').onclick();app.element('#test-close').onclick();
    expect(app.element('#result-dialog').open).toBe(true);expect(app.run('game.paused')).toBe(true);
  });
  it('에셋 로딩이 늦게 끝나도 열린 안내와 다른 화면의 일시정지를 적용합니다',()=>{
    const app=mainHarness(false,true,true);app.run('game.paused=false;scene.hooks.onReady()');expect(app.run('game.paused')).toBe(true);
    app.run("closeTutorial();switchView('village');game.paused=false;scene.hooks.onReady()");expect(app.run('game.paused')).toBe(true);
    const ready=app.run('scene.hooks.onReady');app.run("switchView('puzzle');startLevel(2)");ready();expect(app.run('game.paused')).toBe(false);
  });
});

describe('Game 유지와 최신 Board 교체',()=>{
  it('부팅 전 여러 선택을 합치고 첫 프레임에는 최신 보드만 추가합니다',()=>{
    const app=mainHarness(false,false,true,false,undefined,false);
    app.run('game.scene.isBooted=false;startLevel(4,true);startLevel(6,true)');app.frame();
    expect(app.run('game.scene.adds')).toBe(0);
    app.run('game.scene.isBooted=true');app.frame();
    expect(app.run('game.scene.board===scene')).toBe(true);expect(app.run('currentLevel')).toBe(6);
    expect(app.run('game.scene.adds')).toBe(1);expect(app.games()).toBe(1);expect(app.destroys()).toBe(0);
  });
  it('Scene 처리 중 교체는 큐를 건드리지 않고 종료 뒤 최신 선택을 stop/remove/add합니다',()=>{
    const app=mainHarness(false,false,true,false,undefined,false);app.frame();
    const previous=app.run('scene');
    app.run('game.scene.isProcessing=true;startLevel(4,true);startLevel(30,true)');app.frame();
    expect(previous.stopped).toBe(true);expect(app.run('game.scene.adds')).toBe(1);expect(app.run('game.scene.removes')).toBe(0);
    app.run('game.scene.isProcessing=false');app.frame();
    expect(app.run('game.scene.board===scene')).toBe(true);expect(app.run('currentLevel')).toBe(30);
    expect(app.run('[game.scene.stops,game.scene.removes,game.scene.adds]')).toEqual([1,1,2]);
    expect(app.games()).toBe(1);expect(app.destroys()).toBe(0);
  });
  it('로딩 중 재선택의 오래된 준비·알림·이동 콜백은 최신 모달과 저장을 바꾸지 않습니다',()=>{
    const app=mainHarness(false,false,true,false,undefined,false);app.frame();const stale=app.run('scene.hooks');
    app.run('startLevel(6,true);startLevel(10,true);showTutorial()');app.frame();
    const saved=app.stored(),pauses=app.run('game.pauses');
    stale.onReady();stale.onNotice('chain');stale.onMove([99,99,99,99,99,99],999);
    expect(app.element('#board-notice').textContent).toBe('');expect(app.stored()).toEqual(saved);
    expect(app.run('game.pauses')).toBe(pauses);expect(app.run('game.paused')).toBe(true);
    expect(app.run('game.scene.board===scene')).toBe(true);expect(app.run('currentLevel')).toBe(10);
  });
});

describe('정상 회차 복구와 종료 확정',()=>{
  it('엔진 판정 뒤 숨김·설정 저장은 직전 회차를 유지하고 이동 완료 뒤 재실행합니다',()=>{
    const app=mainHarness(),before=app.stored().inProgress;
    app.run('const move=scene.engine.legalMoves()[0];const resolved=scene.engine.swap(move.a,move.b)');
    app.run("document.hidden=true");app.documentEvents.visibilitychange();app.run("changeLanguage('ko')");
    expect(app.stored().inProgress).toEqual(before);
    const interrupted=mainHarness(false,false,false,false,app.stored());
    expect(interrupted.run('scene.engine.board')).toEqual(before.board);expect(interrupted.run('moves')).toBe(before.moves);
    app.run('scene.hooks.onMove(resolved.collected,resolved.score,resolved.steps.length,resolved.leavesCleared)');
    const saved=app.stored();expect(saved.inProgress.moves).toBe(before.moves-1);expect(saved.inProgress.score).toBeGreaterThan(0);
    const restored=mainHarness(false,false,false,false,saved);
    expect(restored.stored()).toEqual(saved);expect(restored.run('scene.engine.board')).toEqual(saved.inProgress.board);
  });
  it('무료 다음 20코인 섞기를 한 번만 저장하고 cap까지 복원합니다',()=>{
    const app=mainHarness(),before=app.stored();app.element('#shuffle').onclick();
    const shuffled=app.stored();expect(shuffled.inProgress.shuffles).toBe(0);expect(shuffled.inProgress.board).not.toEqual(before.inProgress.board);
    app.element('#shuffle').onclick();const paid=app.stored();expect(paid.coins).toBe(shuffled.coins-20);expect(paid.inProgress.paidShuffleUsed).toBe(true);
    app.element('#shuffle').onclick();expect(app.stored()).toEqual(paid);
    const restored=mainHarness(false,false,false,false,paid);expect(restored.run('shuffles')).toBe(0);expect(restored.run('paidShuffleUsed')).toBe(true);expect(restored.stored()).toEqual(paid);
  });
  it('시험·시험 재시작·완료는 정상 저장을 보존하고 일반 복귀와 재실행은 이어갑니다',()=>{
    const app=mainHarness(false,false,true);app.element('#shuffle').onclick();const normal=app.stored();
    app.run('startLevel(30,true);scene.hooks.onMove([2,0,0,0,0,0],20,1,0)');
    app.element('#restart').onclick();app.run("confirmStagePreview(stagePreview,'start');finish(true)");expect(app.stored()).toEqual(normal);
    const relaunched=mainHarness(false,false,true,false,app.stored());expect(relaunched.run('testingLevel')).toBe(false);expect(relaunched.stored()).toEqual(normal);
    app.element('#result-test').onclick();app.element('#test-normal').onclick();expect(app.stored()).toEqual(normal);expect(app.run('shuffles')).toBe(0);
  });
  it('정상 재시작·다른 선택·초기화는 새 회차이며 이전 콜백을 무시합니다',()=>{
    const app=mainHarness();app.element('#shuffle').onclick();const stale=app.run('scene.hooks.onMove');
    app.element('#restart').onclick();app.run("confirmStagePreview(stagePreview,'start')");expect(app.stored().inProgress.shuffles).toBe(1);
    const restarted=app.stored();stale([20,20,20,20,20,20],999);expect(app.stored()).toEqual(restarted);
    app.run('startLevel(1)');expect(app.stored().inProgress.levelId).toBe(1);
    app.element('#reset').onclick();expect(app.stored()).toMatchObject({completed:[],coins:0,stars:0,garden:0,inProgress:{levelId:1,score:0,moves:26}});
  });
  it('완료 보상과 회차 삭제는 결과창 전 저장하고 중복·늦은 콜백을 무시합니다',()=>{
    const app=mainHarness(),callback=app.run('scene.hooks.onMove');callback([0,12,10,0,0,0],220);
    expect(app.element('#result-dialog').open).toBe(false);expect(app.stored()).toMatchObject({completed:[1,2],stars:2,coins:80,highestLevel:3});expect(app.stored().inProgress).toBeUndefined();
    const settled=app.stored();callback([0,12,10,0,0,0],220);expect(app.stored()).toEqual(settled);expect(app.resultTimers()).toHaveLength(1);
    const relaunched=mainHarness(false,false,false,false,settled);expect(relaunched.run('currentLevel')).toBe(3);expect(relaunched.stored().coins).toBe(80);
    const delayed=app.resultTimers()[0].callback;app.run('startLevel(3)');delayed();expect(app.element('#result-dialog').open).toBe(false);expect(app.stored().coins).toBe(80);
  });
  it('마지막 실패도 결과창 전 회차를 지우며 실패 복원·보상을 만들지 않습니다',()=>{
    const app=mainHarness();app.run('moves=1;scene.hooks.onMove([0,0,0,0,0,0],0,1,0)');
    expect(app.stored().inProgress).toBeUndefined();expect(app.stored().coins).toBe(40);
    const next=mainHarness(false,false,false,false,app.stored());expect(next.run('moves')).toBe(24);
    app.flushResults();expect(app.element('#result-dialog').open).toBe(true);expect(app.element('#result-dialog').innerHTML).toContain('Try again');
  });
  it('저장 실패는 안내하고 이전 디스크 회차를 유지합니다',()=>{
    const source=mainHarness().stored(),app=mainHarness(true,false,false,false,source);
    app.element('#shuffle').onclick();expect(app.stored()).toEqual(source);expect(app.element('#save-status').textContent).toContain('recovery copy could not be written');
  });
  it('초기 복원 저장 실패 경고를 복원 안내로 덮지 않고 메모리에서 플레이합니다',()=>{
    const source=mainHarness().stored(),app=mainHarness(true,false,false,false,source);
    expect(app.element('#save-status').textContent).toContain('recovery copy could not be written');
    expect(app.run('scene.engine.board')).toEqual(source.inProgress.board);expect(app.stored()).toEqual(source);
    app.run('scene.hooks.onMove([1,0,0,0,0,0],10)');expect(app.run('moves')).toBe(source.inProgress.moves-1);
    expect(app.stored()).toEqual(source);expect(app.element('#save-status').textContent).toContain('recovery copy could not be written');
  });
});


describe('저장 상태·초기화 UI 보호',()=>{
  it.each([
    {load:'new',write:'idle',resetPending:false,hidden:true},
    {load:'loaded',write:'saved',resetPending:false,hidden:true},
    {load:'recovered',write:'saved',resetPending:false,hidden:false},
    {load:'loaded',write:'failed',resetPending:false,hidden:false},
    {load:'loaded',write:'backup-failed',resetPending:false,hidden:false},
    {load:'loaded',write:'reset-failed',resetPending:false,hidden:false},
    {load:'loaded',write:'blocked',resetPending:false,hidden:false},
    {load:'new',write:'saved',resetPending:true,hidden:false},
    {load:'corrupt',write:'blocked',resetPending:false,hidden:false},
    {load:'unsupported',write:'blocked',resetPending:false,hidden:false},
    {load:'read-error',write:'blocked',resetPending:false,hidden:false},
    {load:'conflict',write:'blocked',resetPending:false,hidden:false},
  ])('정상 중복 카드만 숨기고 $load/$write/대기$resetPending 경고와 live를 유지합니다',({hidden,...status})=>{
    const h=mainHarness(),writes=h.writes(),saved=h.stored();h.run(`saveStatus=()=>(${JSON.stringify(status)});announcedSave='';updateSaveStatus()`);
    expect(h.element('#storage-card').hidden).toBe(hidden);
    expect(h.element('#storage-announcement').textContent==='').toBe(hidden);
    expect(h.element('#save-reload').hidden).toBe(status.load!=='conflict');
    expect(h.stored()).toEqual(saved);expect(h.writes()).toBe(writes);
  });
  it('저장 회복 뒤 초점된 재시도는 언어 DOM 교체에서도 유지하고 초점을 떠난 뒤 정상 카드를 접습니다',()=>{
    const h=mainHarness(true);h.run("document.activeElement=document.querySelector('#save-retry')");h.setStorageFails(false);h.element('#save-retry').onclick();
    expect(h.element('#storage-card').hidden).toBe(false);expect(h.element('#save-retry').hidden).toBe(false);
    h.run("document.activeElement={id:'save-retry',isConnected:false};document.querySelector('#save-retry').focus=()=>{document.activeElement=document.querySelector('#save-retry')};changeLanguage('ko')");
    expect(h.run('document.activeElement.id')).toBe('save-retry');expect(h.element('#storage-card').hidden).toBe(false);expect(h.element('#save-retry').hidden).toBe(false);
    h.run("document.activeElement=document.querySelector('#reset');document.querySelector('#save-retry').listeners.blur()");
    expect(h.element('#storage-card').hidden).toBe(true);expect(h.element('#save-retry').hidden).toBe(true);expect(h.run('document.activeElement.id')).toBe('reset');
  });
  it.each(['ko','en'] as const)('%s 고객센터 메일은 링크/발송 동작이 없는 일반 텍스트입니다',language=>{
    const h=mainHarness();h.run(`changeLanguage('${language}')`);const html=h.element('#settings-view').innerHTML;
    expect(html).toContain(`id="support-title">${t(language,'support')}</h3>`);
    expect(html).toContain('<p id="support-email">doeud1410@gmail.com</p>');expect(html).not.toContain('mailto:');
  });
  it('초기화 대기 중 외부 기록 변경은 충돌을 우선 안내하고 재시도로 덮지 않습니다',()=>{
    const h=mainHarness();h.run("save=clearSave();localStorage.setItem('pawblossom.save.v1',JSON.stringify({...save,coins:280}))");
    const disk=h.disk(),writes=h.writes();expect(h.run('persist()')).toBe(false);
    expect(h.element('#save-status').textContent).toContain('저장 기록이 바뀌었거나');expect(h.element('#save-reload').hidden).toBe(false);
    h.element('#save-retry').onclick();h.element('#save-retry').onclick();
    expect(h.disk()).toEqual(disk);expect(h.writes()).toBe(writes);expect(h.run('save.coins')).toBe(0);
    expect(h.run('saveStatus().resetPending')).toBe(true);expect(h.run('saveStatus().load')).toBe('conflict');
  });
  it('초기화 취소는 메모리·회차·모든 저장 키와 쓰기 횟수를 바꾸지 않습니다',()=>{
    const h=mainHarness(),disk=h.disk(),writes=h.writes(),memory=h.run('JSON.stringify(save)'),board=h.run('scene');
    h.run('confirm=()=>false');h.element('#reset').onclick();
    expect(h.disk()).toEqual(disk);expect(h.writes()).toBe(writes);expect(h.run('JSON.stringify(save)')).toBe(memory);expect(h.run('scene')).toBe(board);
  });
  it('초기화는 marker와 새 회차를 한 번 쓰고 기존 사본을 교체합니다',()=>{
    const h=mainHarness(),writes=h.writes();h.element('#reset').onclick();
    expect(h.writes()-writes).toBe(3); // marker → 새 회차 backup → primary, 별도 기본값 persist 없음
    const backup=JSON.parse(h.disk().find(([key])=>key.endsWith('.backup'))![1]);
    expect(backup).toEqual(h.stored());expect(backup.coins).toBe(0);expect(backup.inProgress.levelId).toBe(1);
    expect(h.disk().some(([key])=>key.endsWith('.reset'))).toBe(false);
  });
  it('장애 중 보상·정원 진행을 재시도하고 반복 실패로 토스트를 만들지 않습니다',()=>{
    const h=mainHarness(true);h.run('finish(true)');const before=h.run('JSON.stringify(save)');
    h.element('#save-retry').onclick();h.element('#save-retry').onclick();expect(h.element('#toast').textContent).toBe('');
    h.setStorageFails(false);h.element('#save-retry').onclick();
    expect(h.stored()).toEqual(JSON.parse(before));expect(h.stored().coins).toBe(80);expect(h.stored().completed).toEqual([1,2]);
    h.element('#save-retry').onclick();expect(h.stored().coins).toBe(80);
  });
});


describe('도구 행동 프로필과 실제 저장 경계',()=>{
  it('새 판은 tools-v2로 시작하고 설정/언어는 시작 전 자격을 소비하지 않으며 한 수 뒤 복원한다',()=>{
    const h=mainHarness(),first=h.stored();expect(first.version).toBe(2);expect(first.inProgress).toMatchObject({schema:2,actionProfile:'tools-v2',toolsUsed:[],toolsStarted:false});
    h.run("switchView('settings');changeLanguage('ko');switchView('puzzle')");expect(h.stored().inProgress.toolsStarted).toBe(false);
    h.run('scene.hooks.onMove([0,0,0,0,0,0],0,1,0)');expect(h.stored().inProgress.toolsStarted).toBe(true);
    const next=mainHarness(false,false,false,false,h.stored());expect(next.run('moves')).toBe(first.inProgress.moves-1);expect(next.run('roundTools.started')).toBe(true);
  });
  it('옛 tools-v1 판은 언어·일반 이동·섞기·이어하기에서 프로필을 유지하고 새 판만 v2다',()=>{
    const base=mainHarness().stored();base.inProgress.actionProfile='tools-v1';base.inProgress.toolsUsed=['trowel'];base.inProgress.toolsStarted=true;
    base.highestLevel=69;base.puzzleTools={schema:1,introduced:['trowel'],trialUsed:['trowel']};
    const h=mainHarness(false,false,true,false,base),board=h.run('JSON.stringify(scene.snapshot())');
    expect(h.run('roundTools.profile')).toBe('tools-v1');h.run("showToolInfo('broom','tool-broom')");expect(h.run('toolDialog.innerHTML')).toContain(t('en','toolNewRound'));
    h.element('#tool-info-start').onclick();expect(h.run('toolMode')).toBeUndefined();h.element('#tool-info-close').onclick();
    expect(h.run('JSON.stringify(scene.snapshot())')).toBe(board);expect(h.stored().puzzleTools.introduced).toEqual(['trowel']);
    h.run("changeLanguage('ko');scene.hooks.onMove([0,0,0,0,0,0],0,1,0)");h.element('#shuffle').onclick();expect(h.run('shuffles')).toBe(0);
    expect(h.stored().inProgress.actionProfile).toBe('tools-v1');expect(h.stored().inProgress.toolsUsed).toEqual(['trowel']);
    const next=mainHarness(false,false,true,false,h.stored());expect(next.run('roundTools.profile')).toBe('tools-v1');
    next.run('startLevel(currentLevel)');expect(next.stored().inProgress.actionProfile).toBe('tools-v2');expect(next.stored().puzzleTools.trialUsed).toEqual(['trowel']);
  });
  it('이동0 섞기도 시작 행동이며 실패한 저장은 live판/자격/재화를 먼저 바꾸지 않는다',()=>{
    const h=mainHarness(),before=h.run('JSON.stringify({roundTools,board:scene.snapshot(),moves,coins:save.coins})'),stored=h.stored();h.setStorageFails(true);
    h.element('#shuffle').onclick();expect(h.run('JSON.stringify({roundTools,board:scene.snapshot(),moves,coins:save.coins})')).toBe(before);expect(h.stored()).toEqual(stored);
    h.setStorageFails(false);h.element('#shuffle').onclick();expect(h.run('roundTools.started')).toBe(true);expect(h.stored().inProgress).toMatchObject({toolsStarted:true,toolsUsed:[],shuffles:0});expect(h.run('moves')).toBe(stored.inProgress.moves);
  });
});

describe('V1 회차 보존과 V2 정사각 안내',()=>{
  it('버전 없는 기존 판을 그대로 복원·재저장하고 명시 재시작부터2를 쓰며 Pip·영구 기록을 보존합니다',()=>{
    const original=mainHarness().stored();original.version=1;delete original.puzzleTools;original.inProgress.schema=1;for(const key of ['ruleVersion','actionProfile','toolsUsed','toolsStarted'])delete original.inProgress[key];
    original.inProgress.board=Array.from({length:8},(_,r)=>Array.from({length:8},(_,c)=>({kind:(r*2+c)%5})));
    for(const [r,c] of [[2,2],[2,3],[3,2],[3,3]])original.inProgress.board[r][c]={kind:5};original.inProgress.board[0][0].special='row';
    original.pip={growth:34,affection:22,owned:['ribbon'],equipped:'ribbon'};
    const h=mainHarness(false,false,false,false,original),before=h.run('JSON.stringify({board:scene.engine.board,leaves:scene.engine.leaves,moves,score,collected})');
    expect(h.run('scene.engine.ruleVersion')).toBe(1);expect(h.element('#round-resumed-notice').textContent).toBe(t('en','roundResumedClassic'));
    h.run("changeLanguage('ko');checkpoint()");expect(h.element('#round-resumed-notice').textContent).toBe(t('ko','roundResumedClassic'));
    expect(h.stored().inProgress.ruleVersion).toBe(1);expect(h.run('JSON.stringify({board:scene.engine.board,leaves:scene.engine.leaves,moves,score,collected})')).toBe(before);
    const next=mainHarness(false,false,false,false,h.stored());expect(next.run('scene.engine.ruleVersion')).toBe(1);
    next.run('startLevel(currentLevel)');expect(next.run('scene.engine.ruleVersion')).toBe(2);expect(next.stored().inProgress.ruleVersion).toBe(2);
    for(const field of ['completed','stars','coins','garden','pip'])expect(next.stored()[field]).toEqual(original[field]);
  });
  it.each(['ko','en'] as const)('%s 선택형2×2는 본판/저장을 바꾸지 않고 실제 생성·완료와 언제든 시작을 유지합니다',language=>{
    const h=mainHarness();h.run(`changeLanguage('${language}');switchView('settings');showTutorial();tutorialPage=3;practice=new SwapPractice();practice.swipe({row:0,col:2},0,56);renderTutorial()`);
    const saved=h.disk(),before=h.run('JSON.stringify({round,moves,score,collected,board:scene.engine.board,leaves:scene.engine.leaves})');
    h.element('#practice-square').onclick();expect(h.run('squarePractice.completed')).toBe(false);
    expect(h.element('#tutorial-dialog').innerHTML).toContain(t(language,'squarePracticeTitle'));
    expect(h.element('#tutorial-dialog').innerHTML).not.toMatch(/id="guide-next"[^>]*disabled/);
    h.run('squarePractice.swipe({row:1,col:2},-56,0);renderTutorial()');
    expect(h.run('squarePractice.result.steps[0].created[0].tile.special')).toBe('bomb');
    const html=h.element('#tutorial-dialog').innerHTML;
    expect(html.split(t(language,'squarePracticeDone'))).toHaveLength(2);
    expect(html).toContain(t(language,'squarePracticeMatched'));expect(html).toContain('special-tile-art-bomb');expect(html).toContain('/assets/specials-v4/bomb.webp');
    expect(html).toContain(t(language,'squarePracticeBombCell').replace('{row}','2').replace('{col}','2'));
    expect(html).toMatch(/id="practice-cell-1-1"[^>]+practice-created[^>]+disabled/);
    expect(h.disk()).toEqual(saved);expect(h.run('JSON.stringify({round,moves,score,collected,board:scene.engine.board,leaves:scene.engine.leaves})')).toBe(before);
  });
});

describe('언어 정합성과 버전 단일 원본',()=>{
  it('KO/EN 키와 치환 변수가 같고 빈 번역이 없습니다',()=>{
    const values:Record<string,any>={};vm.runInNewContext(i18nCode+'\nexports.messages=strings;', {exports:values});
    const {en,ko}=values.messages;
    expect(Object.keys(ko).sort()).toEqual(Object.keys(en).sort());
    const placeholders=(value:string)=>[...value.matchAll(/\{(\w+)\}/g)].map(match=>match[1]).sort();
    for(const key of Object.keys(en)){
      expect(ko[key].trim(),key).not.toBe('');expect(en[key].trim(),key).not.toBe('');
      expect(placeholders(ko[key]),key).toEqual(placeholders(en[key]));
    }
  });
  it('빌드 정의와 실제 설정 표시가 package.json 버전과 같습니다',()=>{
    expect(APP_VERSION).toBe(packageInfo.version);
    const app=mainHarness();expect(app.element('#settings-view').innerHTML).toContain(`Pawblossom Puzzle · v${packageInfo.version}`);
  });
  it('한국어/영어 지역명·친구 제목·핍 설명을 실제 렌더에 연결합니다',()=>{
    const app=mainHarness();app.run("changeLanguage('ko')");
    expect(app.element('#village-view').innerHTML).toContain('꽃잎 초원');
    expect(app.element('#journal-view').innerHTML).toContain(t('ko','friendsTitle'));
    expect(app.element('#journal-view').innerHTML).toContain('alt="정원사 토끼 핍"');
    expect(app.element('#journal-view').innerHTML).not.toMatch(/Blossom Meadow|PAWBLOSSOM FRIENDS|alt="Pip"/);
    app.run("changeLanguage('en')");expect(app.element('#journal-view').innerHTML).toContain(t('en','friendsTitle'));
    expect(app.element('#journal-view').innerHTML).toContain('alt="Pip the gardener"');
  });
});

describe('열린 화면의 언어 변경은 진행·결과 처리를 보존합니다',()=>{
  it.each([
    {id:2,won:true,test:false,replay:false,title:'win',description:'winDesc'},
    {id:1,won:true,test:false,replay:true,title:'win',description:'replayDesc'},
    {id:2,won:false,test:false,replay:false,title:'lose',description:'loseDesc'},
    {id:500,won:true,test:false,replay:false,title:'complete',description:'completeDesc',allPrior:true},
    {id:500,won:true,test:false,replay:false,title:'win',description:'winDesc',allPrior:false},
    {id:30,won:true,test:true,replay:false,title:'win',description:'testResultDesc'},
    {id:30,won:false,test:true,replay:false,title:'lose',description:'testResultDesc'},
  ])('$id번 성공=$won 시험=$test 재완료=$replay 결과 문구만 바꿉니다',({id,won,test,title,description,allPrior})=>{
    const prior=allPrior?{version:1,language:'en',highestLevel:500,completed:Array.from({length:499},(_,i)=>i+1),stars:499,coins:19960,garden:0,music:true,sfx:true,tutorialSeen:true}:undefined;
    const app=mainHarness(false,false,true,false,prior);app.run(`startLevel(${id},${test});finish(${won})`);
    const saved=app.stored(),memory=app.run('JSON.stringify({currentLevel,moves,score,collected,shuffles,firstReward,roundEnded,resultShown})');
    const scene=app.run('scene'),dialog=app.element('#result-dialog'),html=dialog.innerHTML,next=app.element('#result-next').onclick,home=app.element('#result-home').onclick;
    const sounds=app.run('audio.plays.slice()'),art=app.resultArtCalls();
    app.run("document.activeElement=document.querySelector('#result-next');changeLanguage('ko')");
    expect(app.element('#result-title').textContent).toBe(t('ko',title as TextKey));expect(app.element('#result-description').textContent).toBe(t('ko',description as TextKey).replace('{count}',String(LEVEL_COUNT)));
    expect(dialog.innerHTML).toBe(html);expect(dialog.open).toBe(true);
    expect(app.element('#result-next').onclick).toBe(next);expect(app.element('#result-home').onclick).toBe(home);
    expect(app.run("document.activeElement===document.querySelector('#result-next')")).toBe(true);
    expect(app.run('scene')).toBe(scene);expect(app.run('game.paused')).toBe(true);
    expect(app.run('audio.plays')).toEqual(sounds);expect(app.resultArtCalls()).toBe(art);expect(app.resultTimers()).toHaveLength(0);
    expect(app.stored()).toEqual({...saved,language:'ko'});expect(app.run('JSON.stringify({currentLevel,moves,score,collected,shuffles,firstReward,roundEnded,resultShown})')).toBe(memory);
    app.run("changeLanguage('en');changeLanguage('ko');finish(true)");expect(app.resultArtCalls()).toBe(art);expect(app.run('audio.plays')).toEqual(sounds);
  });
  it('300ms 결과 대기 중 전환은 저장된 보상을 한 번 유지하며 새 언어로 창을 엽니다',()=>{
    const app=mainHarness();app.run('scene.hooks.onMove([99,99,99,99,99,99],220,1,0)');const timer=app.resultTimers()[0],saved=app.stored();
    app.run("changeLanguage('ko')");expect(app.resultTimers()).toEqual([timer]);expect(app.stored()).toEqual({...saved,language:'ko'});
    expect(app.resultArtCalls()).toBe(0);app.flushResults();expect(app.resultArtCalls()).toBe(1);expect(app.element('#result-dialog').innerHTML).toContain(t('ko','win'));
    expect(app.stored()).toEqual({...saved,language:'ko'});
  });
  it('실습 선택과 시험 묶음, 일반 회차·저장 경고·짧은 안내를 유지하며 번역합니다',()=>{
    const app=mainHarness(true,false,true);app.run("showTutorial();tutorialPage=3;practice=new SwapPractice();practice.select({row:0,col:2});renderTutorial()");
    const lesson=app.run('practice'),board=app.run('scene');app.run("changeLanguage('ko')");
    expect(app.run('practice')).toBe(lesson);expect(app.run('practice.selected')).toEqual({row:0,col:2});expect(app.run('scene')).toBe(board);
    expect(app.element('#tutorial-dialog').innerHTML).toContain('하나를 골랐어요.');expect(app.element('#save-status').textContent).toContain('복구 사본을 쓰지 못해');
    app.run("closeTutorial();showTestPicker();selectedTestChapter=3;renderTestPicker();notice('planted');scene.hooks.onNotice('chain');changeLanguage('en')");
    expect(app.run('selectedTestChapter')).toBe(3);expect(app.element('#test-level-dialog').innerHTML).toContain('Level 30');
    expect(app.element('#save-status').textContent).toContain('recovery copy could not be written');expect(app.element('#toast').textContent).toBe('A new patch is blooming!');expect(app.element('#board-notice').textContent).toBe('Keep it going!');
  });
});


it('끝난 짧은 안내는 언어 변경으로 다시 발표하지 않습니다',()=>{
  const app=mainHarness();app.run("notice('planted');scene.hooks.onNotice('chain')");app.flushToasts();app.element('#board-notice').listeners.animationend({preventDefault(){}});
  app.run("changeLanguage('ko')");expect(app.element('#toast').textContent).toBe('');expect(app.element('#board-notice').textContent).toBe('');
  expect(app.run('noticeKey')).toBeUndefined();expect(app.run('boardNoticeKey')).toBeUndefined();
});

it('새 회차는 보드 안내를 비우며 이전 회차 콜백은 새 안내를 덮어쓰지 않습니다',()=>{
  const app=mainHarness();app.run("globalThis.previousScene=scene;scene.hooks.onNotice('chain');startLevel(3)");
  expect(app.element('#board-notice').textContent).toBe('');expect(app.run('boardNoticeKey')).toBeUndefined();
  app.run("scene.hooks.onNotice('matched');previousScene.hooks.onNotice('chain');changeLanguage('ko')");
  expect(app.element('#board-notice').textContent).toBe(t('ko','matched'));
});

it('getAnimations API가 없는 환경도 종료 안내를 예외 없이 비웁니다',()=>{
  const app=mainHarness();app.run("document.querySelector('#board-notice').getAnimations=undefined;scene.hooks.onNotice('chain')");
  expect(()=>app.element('#board-notice').listeners.animationend({preventDefault(){}})).not.toThrow();
  expect(app.element('#board-notice').textContent).toBe('');expect(app.run('boardNoticeKey')).toBeUndefined();
  app.run("changeLanguage('ko')");expect(app.element('#board-notice').textContent).toBe('');
});

it('퍼즐 화면 이탈이 허용될 때만 보드 안내를 정리하고 복귀해도 재발표하지 않습니다',()=>{
  const app=mainHarness();app.run("scene.hooks.onNotice('matched');scene.canLeave=()=>false;switchView('settings')");
  expect(app.element('#board-notice').textContent).toBe(t('en','matched'));
  app.run("scene.canLeave=()=>true;switchView('settings')");expect(app.element('#board-notice').textContent).toBe('');
  expect(app.run('boardNoticeKey')).toBeUndefined();app.run("switchView('puzzle');changeLanguage('ko')");
  expect(app.element('#board-notice').textContent).toBe('');
});

it('연속 안내의 이전 만료·종료 이벤트는 활성 안내를 지우지 않습니다',()=>{
  const app=mainHarness();app.run(`globalThis.callbacks=[];const originalTimeout=setTimeout;setTimeout=(callback,ms)=>{if(ms===3200)callbacks.push(callback);return originalTimeout(callback,ms)};
    notice('planted');notice('saveFailed');callbacks[0]();scene.hooks.onNotice('chain');scene.hooks.onNotice('matched');`);
  expect(app.element('#toast').textContent).toBe(t('en','saveFailed'));expect(app.run('noticeKey')).toBe('saveFailed');
  app.element('#board-notice').getAnimations=()=>[{playState:'running'}];
  app.element('#board-notice').listeners.animationend({preventDefault(){}});
  app.run("changeLanguage('ko')");expect(app.element('#board-notice').textContent).toBe(t('ko','matched'));
  app.element('#board-notice').getAnimations=()=>[];
  app.element('#board-notice').listeners.animationend({preventDefault(){}});app.run('callbacks[1]()');
  expect(app.element('#board-notice').textContent).toBe('');expect(app.element('#toast').textContent).toBe('');
});

describe('회차 복원 안내의 표시 수명',()=>{
  const restored=()=>{const first=mainHarness();return mainHarness(false,false,false,false,first.stored());};
  it('저장 회차 복원만 힌트 안내로 표시하고 일반 toast·진행·초점은 바꾸지 않습니다',()=>{
    const first=mainHarness(),saved=first.stored(),h=mainHarness(false,false,false,false,saved);
    expect(first.element('#round-resumed-notice').hidden).toBe(true);
    expect(h.element('#round-resumed-notice').hidden).toBe(false);
    expect(h.element('#round-resumed-notice').textContent).toBe(t('en','roundResumed'));
    expect(h.run('noticeKey')).toBeUndefined();expect(h.run('document.activeElement')).toBeUndefined();
    expect(h.stored()).toEqual(saved);
    const failed=mainHarness(true,false,false,false,saved);expect(failed.element('#round-resumed-notice').hidden).toBe(true);
  });
  it('언어를 바꿔도 같은 만료 예약을 유지하고 만료 뒤 다시 표시하지 않습니다',()=>{
    const h=restored(),timer=h.run('resumeNoticeTimer');h.run("changeLanguage('ko')");
    expect(h.run('resumeNoticeTimer')).toBe(timer);expect(h.element('#round-resumed-notice').textContent).toBe(t('ko','roundResumed'));
    h.flushToasts();expect(h.element('#round-resumed-notice').hidden).toBe(true);expect(h.run('resumeNoticeTimer')).toBeUndefined();
    h.run("changeLanguage('en')");expect(h.element('#round-resumed-notice').textContent).toBe('');
  });
  it('취소되거나 이전 회차에서 늦게 실행된 만료는 새 안내를 지우지 않습니다',()=>{
    const h=restored();h.run(`globalThis.callbacks=[];const originalTimeout=setTimeout;setTimeout=(callback,ms)=>{if(ms===3200)callbacks.push(callback);return originalTimeout(callback,ms)};
      showResumeNotice();showResumeNotice();callbacks[0]();`);
    expect(h.element('#round-resumed-notice').hidden).toBe(false);
    h.run('startLevel(3)');expect(h.element('#round-resumed-notice').hidden).toBe(true);
    h.run('showResumeNotice();callbacks[1]()');expect(h.element('#round-resumed-notice').hidden).toBe(false);
  });
  it('주 포인터·보드 키 입력·화면 이탈로 안내만 정리하고 첫 선택 전에 저장을 쓰지 않습니다',()=>{
    const h=restored(),saved=h.stored(),writes=h.writes();
    h.run("document.querySelector('#game-canvas').listeners.pointerdown({button:2,isPrimary:true})");expect(h.element('#round-resumed-notice').hidden).toBe(false);
    h.run("document.querySelector('#game-canvas').listeners.pointerdown({button:0,isPrimary:false})");expect(h.element('#round-resumed-notice').hidden).toBe(false);
    h.run("document.querySelector('#game-canvas').listeners.pointerdown({button:0,isPrimary:true})");expect(h.element('#round-resumed-notice').hidden).toBe(true);
    h.run("showResumeNotice();document.activeElement=document.querySelector('#game-canvas');document.querySelector('#game-canvas').listeners.keydown({target:document.activeElement,key:'ArrowRight',preventDefault(){}})");
    expect(h.element('#round-resumed-notice').hidden).toBe(true);expect(h.stored()).toEqual(saved);expect(h.writes()).toBe(writes);
    h.run("showResumeNotice();switchView('settings')");expect(h.element('#round-resumed-notice').hidden).toBe(true);
    h.run("notice('planted')");expect(h.element('#toast').textContent).toBe(t('en','planted'));
  });
});

describe('새 mask 챕터와 이전 완료 진행',()=>{
  it('30 완료는 31을 열고 재플레이는 무보상이며 새 판·재로드의 null 칸을 유지합니다',()=>{
    const app=mainHarness();app.run('startLevel(30);finish(true)');expect(app.stored().highestLevel).toBe(31);
    const wallet=app.run('JSON.stringify({stars:save.stars,coins:save.coins})');app.run('startLevel(30);finish(true)');expect(app.run('JSON.stringify({stars:save.stars,coins:save.coins})')).toBe(wallet);
    app.element('#result-next').onclick();expect(app.run('currentLevel')).toBe(31);expect(app.element('#chapter-name').textContent).toContain('Pond Trail');
    expect(app.stored().inProgress.board[0][0]).toBeNull();const old=app.stored();const resumed=mainHarness(false,false,false,false,old);expect(resumed.stored()).toEqual(old);
    app.run('startLevel(34);finish(true)');expect(app.stored().highestLevel).toBe(35);
  });
  it('새 테스트 묶음은 비정형·빈칸을 표시하고 본판 저장을 보존합니다',()=>{
    const app=mainHarness(false,false,true),before=app.stored();app.run('showTestPicker()');app.element('#test-chapter-4').onclick();
    expect(app.element('#test-level-dialog').innerHTML).toContain('data-test-level="35"');expect(app.element('#test-level-dialog').innerHTML).toContain('Shaped board · empty spaces');
    app.element('#test-stage-32').onclick();expect(app.run('scene.engine.board[3][3]')).toBeNull();expect(app.element('#board-hint-text').textContent).toContain('Tiles fall within each section.');
    expect(app.stored()).toEqual(before);
  });
});

describe('비정형 보드의 짧은 플레이 안내와 가로 화면 높이',()=>{
  it.each(['ko','en'] as const)('%s 실플레이 안내는 상세 preview·기본 hint를 중복하지 않으며 언어/키보드 도움말과 저장을 유지합니다',language=>{
    const app=mainHarness(false,false,true);app.run(`startLevel(33,true);changeLanguage('${language}')`);const before=app.disk();
    expect(app.element('#board-hint-text').textContent).toBe(t(language,'testRound')+' · '+t(language,'maskPlayHint'));
    expect(app.element('#board-hint-text').textContent).not.toContain(t(language,'maskHint'));
    expect(app.element('#board-hint-text').textContent).not.toContain(t(language,'hint'));
    expect(app.element('#board-keyboard-help').textContent).toBe(t(language,'boardKeyboardHelp'));
    app.run("save.highestLevel=33;switchView('village');showStagePreview(33,'map',document.querySelector('#settings-button'))");
    expect(app.run('previewDialog.innerHTML')).toContain(t(language,'maskHint'));
    expect(app.disk()).toEqual(before);
  });
});
describe('회차 도움 원자성과 검증된 시험 구매 혜택',()=>{
  const state=(h:ReturnType<typeof mainHarness>)=>h.run('JSON.stringify({save,moves,shuffles,paidShuffleUsed,continueUsed,roundEnded,board:scene.engine.board,leaves:scene.engine.leaves})');
  it.each(['failed','blocked','conflict','candidate','stale','route','modal','busy','hidden','poor'])('%s 섞기 거절은 회차와 재화를 보존합니다',reason=>{
    const h=mainHarness();h.element('#shuffle').onclick();const callback=h.element('#shuffle').onclick;
    if(reason==='failed')h.setStorageFails(true);
    if(reason==='blocked')h.run("saveStatus=()=>({load:'loaded',write:'blocked',resetPending:false})");
    if(reason==='conflict')h.run("localStorage.setItem('pawblossom.save.v1',JSON.stringify({...save,coins:999}))");
    if(reason==='candidate')h.run('prepareShuffle=()=>undefined');
    if(reason==='stale')h.run('startLevel(1)');if(reason==='route')h.run("route='settings'");
    if(reason==='modal')h.run("const originalQuery=document.querySelector;document.querySelector=s=>s==='dialog[open]'?{}:originalQuery(s)");
    if(reason==='busy')h.run('scene.keyboardState=()=>({available:false})');if(reason==='hidden')h.run('document.hidden=true');
    if(reason==='poor')h.run('save.coins=19');
    const before=state(h),disk=h.disk();callback();expect(state(h)).toBe(before);expect(h.disk()).toEqual(disk);
  });
  it('무료 저장 실패는 무료 횟수를 잃지 않고 후보 exact 적용 시 원래 engine을 유지합니다',()=>{
    const h=mainHarness(),engine=h.run('scene.engine');h.run('globalThis.candidate=prepareShuffle(scene.snapshot());prepareShuffle=()=>cloneSnapshot(candidate)');
    const before=state(h);h.setStorageFails(true);h.element('#shuffle').onclick();expect(state(h)).toBe(before);
    h.setStorageFails(false);h.element('#shuffle').onclick();expect(h.run('scene.engine')).toBe(engine);
    expect(h.run('scene.engine.board')).toEqual(h.run('candidate.board'));expect(h.stored().inProgress.board).toEqual(h.run('candidate.board'));expect(h.stored().coins).toBe(40);
  });
  it('시험 회차 무료 섞기는 정상 저장을 보존하고 유료 섞기는 비활성입니다',()=>{
    const h=mainHarness(false,false,true);h.run('startLevel(6,true)');const disk=h.disk();h.element('#shuffle').onclick();const before=state(h);
    expect(h.element('#shuffle').disabled).toBe(true);h.element('#shuffle').onclick();expect(state(h)).toBe(before);expect(h.disk()).toEqual(disk);
  });
  async function owned(test=false,id=2){
    let value:BillingSnapshot={available:true,configured:true,state:'idle',entitlement:'owned',revision:1,error:'',price:'',overlay:false,adsBlocked:true,preparingPurchase:false};
    let listener!:(s:BillingSnapshot)=>void;
    const bridge:TestBillingBridge={getStatus:async()=>({...value}),restore:async()=>({...value}),queryProduct:async()=>({...value}),purchase:async()=>({...value}),addListener:async(_n,fn)=>{listener=fn;return {remove:async()=>{}};}};
    const h=mainHarness(false,false,true,true,undefined,true,undefined,bridge);h.nativeEvents.appStateChange({isActive:true});await h.run('testBilling.connect()');
    if(test)h.run('startLevel(6,true)');else if(id!==2)h.run(`save.highestLevel=${id};startLevel(${id})`);h.run('moves=1;scene.hooks.onMove([0,0,0,0,0,0],0,1,0)');h.flushResults();
    return {h,emit:(patch:Partial<BillingSnapshot>)=>{value={...value,...patch,revision:value.revision+1};listener(value);}};
  }
  it('검증 시험 구매자는 정상 실패판 +5와 cap을 한 저장에 확정하고 재실행해도 공통 한 번입니다',async()=>{
    const {h}=await owned();const engine=h.run('scene.engine');h.element('#result-buyer-continue').onclick();
    expect(h.run('moves')).toBe(5);expect(h.run('scene.engine')).toBe(engine);expect(h.stored().inProgress).toMatchObject({moves:5,continueUsed:true});expect(h.stored().coins).toBe(40);
    const next=mainHarness(false,false,false,false,h.stored());expect(next.run('continueUsed')).toBe(true);expect(next.run('moves')).toBe(5);
    h.run('moves=1;scene.hooks.onMove([0,0,0,0,0,0],0,1,0)');h.flushResults();const before=state(h);h.element('#result-buyer-continue').onclick();expect(state(h)).toBe(before);
  });
  it.each(['failed','unknown','unconfigured','blocked','stale','modal','primary-failure'])('%s 구매 혜택은 지급하지 않습니다',async reason=>{
    const {h,emit}=await owned();const callback=h.element('#result-buyer-continue').onclick;
    if(reason==='failed')h.setStorageFails(true);if(reason==='unknown')emit({entitlement:'unknown',adsBlocked:true});if(reason==='unconfigured')emit({configured:false});
    if(reason==='blocked')h.run("saveStatus=()=>({load:'loaded',write:'blocked',resetPending:false})");if(reason==='stale')h.run('startLevel(1)');
    if(reason==='modal')h.element('#test-billing-dialog').open=true;
    if(reason==='primary-failure')h.run("const originalWrite=localStorage.setItem;localStorage.setItem=(key,value)=>{if(key==='pawblossom.save.v1')throw Error('primary failed');originalWrite(key,value)}");
    const before=state(h),disk=h.disk();callback();expect(state(h)).toBe(before);
    if(reason==='primary-failure')expect(h.stored()).toEqual(JSON.parse(disk.find(([key])=>key==='pawblossom.save.v1')![1]));else expect(h.disk()).toEqual(disk);
  });
  it('육성으로 새 저장 객체가 생겨도 퍼즐 복귀 뒤 무료 섞기와 설정 조작은 현재 제어를 사용합니다',()=>{
    const h=mainHarness();h.run("switchView('journal');save.pip=freshPip();renderViews()");
    h.element('#pip-feed').onclick();h.run("switchView('puzzle')");h.element('#shuffle').onclick();expect(h.run('shuffles')).toBe(0);
    const music=h.stored().music;h.element('#music-toggle').onclick();expect(h.stored().music).toBe(!music);
  });
  it('시험/구매자 버튼은 같은 cap을 공유하고 production 웹에는 구매 혜택 버튼이 없습니다',async()=>{
    const {h}=await owned(true);const buy=h.element('#result-buyer-continue').onclick,disk=h.disk();h.element('#result-continue').onclick();buy();expect(h.run('moves')).toBe(5);expect(h.disk()).toEqual(disk);
    const production=mainHarness();production.run('moves=1;scene.hooks.onMove([0,0,0,0,0,0],0,1,0)');production.flushResults();expect(production.element('#result-dialog').innerHTML).not.toContain('result-buyer-continue');
  });
  it('pond 무료/유료 후보는 저장 실패 때 무차감이고 reload 후 구멍·cap·Pip을 유지합니다',()=>{
    const h=mainHarness();h.run("save.highestLevel=32;save.pip={growth:34,affection:22,owned:['ribbon'],equipped:'ribbon'};startLevel(32)");
    const engine=h.run('scene.engine');let before=state(h),disk=h.disk();h.setStorageFails(true);h.element('#shuffle').onclick();expect(state(h)).toBe(before);expect(h.disk()).toEqual(disk);
    h.setStorageFails(false);h.element('#shuffle').onclick();expect(h.run('scene.engine')).toBe(engine);expect(h.stored().coins).toBe(40);expect(h.run('shuffles')).toBe(0);
    before=state(h);disk=h.disk();h.setStorageFails(true);h.element('#shuffle').onclick();expect(state(h)).toBe(before);expect(h.disk()).toEqual(disk);
    h.setStorageFails(false);h.element('#shuffle').onclick();const saved=h.stored();expect(saved.coins).toBe(20);expect(saved.inProgress.paidShuffleUsed).toBe(true);expect(saved.inProgress.board[3][3]).toBeNull();expect(saved.pip).toMatchObject({growth:34,affection:22,equipped:'ribbon'});
    const restored=mainHarness(false,false,false,false,saved);expect(restored.stored()).toEqual(saved);expect(restored.run('scene.engine.board[3][3]')).toBeNull();expect(restored.run('paidShuffleUsed')).toBe(true);
    const last=state(restored);restored.element('#shuffle').onclick();expect(state(restored)).toBe(last);
  });
  it('pond 정상 실패판의 검증 시험 +5는 null·엔진을 유지하고 reload로 공통 cap을 복원합니다',async()=>{
    const {h}=await owned(false,32),engine=h.run('scene.engine'),board=h.run('JSON.stringify(scene.engine.board)');h.element('#result-buyer-continue').onclick();
    expect(h.run('moves')).toBe(5);expect(h.run('scene.engine')).toBe(engine);expect(h.run('JSON.stringify(scene.engine.board)')).toBe(board);expect(h.stored().inProgress).toMatchObject({continueUsed:true,ruleVersion:2,moves:5});expect(h.stored().inProgress.board[3][3]).toBeNull();
    const restored=mainHarness(false,false,false,false,h.stored());expect(restored.run('continueUsed')).toBe(true);expect(restored.run('moves')).toBe(5);expect(restored.run('scene.engine.board[3][3]')).toBeNull();
  });

});


describe('나무상자 챕터와 별도 목표·저장 연결',()=>{
  it.each(['ko','en'] as const)('%s: 35 완료는 36을 열고 상자 파괴/목표/미리보기/복원을 연결합니다',language=>{
    const app=mainHarness();app.run('startLevel(35);finish(true)');expect(app.stored().highestLevel).toBe(36);
    app.element('#result-next').onclick();app.run("changeLanguage('"+language+"')");
    expect(app.run('currentLevel')).toBe(36);expect(app.stored().inProgress.crates[2][2]).toBe(1);expect(app.stored().inProgress.board[2][2]).toBeNull();
    expect(app.element('#goals').innerHTML).toContain('data-feedback-goal="crates"');expect(app.element('#goals').innerHTML).toContain(t(language,'woodenCrate'));
    expect(app.element('#board-hint-text').textContent).toBe(t(language,'cratePlayHint'));
    app.run("scene.keyboardState=()=>({available:true,busy:false,finished:false,cursor:{row:2,col:2},crate:true});updateBoardAccess()");
    expect(app.element('#board-keyboard-status').textContent).toContain(t(language,'boardCrateCell').replace('{row}','3').replace('{col}','3'));
    app.run("scene.engine.board[2][0].special='row';const crateResult=scene.engine.activate({row:2,col:0});scene.hooks.onMove(crateResult.collected,crateResult.score,crateResult.steps.length,crateResult.leavesCleared??0,crateResult.cratesCleared??0)");
    expect(app.stored().inProgress.clearedCrates).toBeGreaterThanOrEqual(2);expect(app.stored().inProgress.crates[2][2]).toBe(0);expect(app.stored().inProgress.board[2][2]).not.toBeNull();
    const old=app.stored(),resumed=mainHarness(false,false,false,false,old);expect(resumed.stored().inProgress).toEqual(old.inProgress);
    resumed.run("switchView('village');showStagePreview(36,'map',document.querySelector('#settings-button'))");
    expect(resumed.run('previewDialog.innerHTML')).toContain(t(language,'crateHint'));expect(resumed.run('previewDialog.innerHTML')).toContain('/assets/obstacles-v4/wooden-crate.webp');
  });
  it('시험 챕터 36–40은 일반 기록과 보상을 보존합니다',()=>{
    const app=mainHarness(false,false,true),before=app.disk();app.run('showTestPicker()');app.element('#test-chapter-5').onclick();
    expect(app.element('#test-level-dialog').innerHTML).toContain('data-test-level="40"');expect(app.element('#test-level-dialog').innerHTML).toContain(t('en','testCrates'));
    app.element('#test-stage-40').onclick();expect(app.run('scene.engine.remainingCrates()')).toBe(8);app.run('finish(true)');expect(app.disk()).toEqual(before);
  });
});


describe('확정된 핍 성장의 해금 안내',()=>{
  const initial=(language:'ko'|'en'='ko',growth=10,coins=40)=>({version:1,language,highestLevel:2,completed:[1],stars:1,coins,garden:0,music:true,sfx:true,tutorialSeen:true,pip:{growth,affection:20,owned:[],equipped:'none'}});
  it.each(['ko','en'] as const)('%s 성장20·60에서 실제 무료행동과 선택 구매를 알리고 자동 지급하지 않습니다',language=>{
    for(const [growth,action,level] of [[10,'feed',2],[56,'play',3]] as const){
      const h=mainHarness(false,false,false,false,initial(language,growth));h.run("switchView('journal')");
      expect(h.run('pipUnlock')).toBeUndefined();h.element('#pip-'+action).onclick();
      expect(h.run('pipUnlock')).toBe(level);expect(h.stored().pip.owned).toEqual([]);expect(h.stored().coins).toBe(30);
      expect(h.element('#journal-view').innerHTML).toContain(t(language,'pipUnlockTitle'));
      expect(h.element('#journal-view').innerHTML).toContain(t(language,level===2?'pipUnlockGreeting':'pipUnlockTending'));
      expect(h.element('#journal-view').innerHTML).toContain(t(language,'pipUnlockShop').replace('{item}',t(language,level===2?'pipRibbon':'pipWateringCan')));
      const disk=h.disk(),writes=h.writes();h.flushCareReaction();expect(h.run('pipUnlock')).toBe(level);
      h.element('#pip-unlock-try').onclick();expect(h.run('pipReaction')).toBe(level===2?'greet':'tend');expect(h.run('pipUnlock')).toBeUndefined();expect(h.disk()).toEqual(disk);expect(h.writes()).toBe(writes);
    }
  });
  it('닫기·이탈·숨김은 안내만 지우고 이전 버튼으로 새 행동을 되살리지 않습니다',()=>{
    for(const kind of ['dismiss','route','hidden'] as const){
      const h=mainHarness(false,false,false,false,initial());h.run("switchView('journal')");h.element('#pip-feed').onclick();const stale=h.element('#pip-unlock-try').onclick,disk=h.disk(),writes=h.writes();
      if(kind==='dismiss')h.element('#pip-unlock-dismiss').onclick();else if(kind==='route')h.run("switchView('map')");else h.run('document.hidden=true;syncActivity()');
      expect(h.run('pipUnlock')).toBeUndefined();const reaction=h.run('pipReaction');stale();expect(h.run('pipReaction')).toBe(reaction);expect(h.disk()).toEqual(disk);expect(h.writes()).toBe(writes);
    }
  });
  it.each(['storage','coins','existing','same-level'] as const)('%s 경계에서는 새로운 해금 안내가 생기지 않습니다',kind=>{
    const h=mainHarness(kind==='storage',false,false,false,initial('ko',kind==='existing'?60:kind==='same-level'?0:10,kind==='coins'?9:40));h.run("switchView('journal')");h.element('#pip-feed').onclick();expect(h.run('pipUnlock')).toBeUndefined();
    expect(h.element('#journal-view').innerHTML).not.toContain('id="pip-unlock-card"');
  });
  it('체험에서 열린 행동 안내와 예전 버튼을 정상 저장에 가져오지 않습니다',()=>{
    const h=mainHarness(false,false,true,false,initial());h.run("switchView('journal')");const disk=h.disk();h.run('enterCareDemo()');h.element('#pip-feed').onclick();h.element('#pip-feed').onclick();expect(h.run('pipUnlock')).toBe(2);const stale=h.element('#pip-unlock-try').onclick;
    h.run('exitCareDemo()');stale();expect(h.run('pipUnlock')).toBeUndefined();expect(h.run('save.pip.growth')).toBe(10);expect(h.disk()).toEqual(disk);
  });
});

describe('별·코인 사용처의 읽기 전용 안내',()=>{
  const state=(h:ReturnType<typeof mainHarness>)=>h.run('JSON.stringify({round,currentLevel,testingLevel,moves,score,collected,clearedLeaves,clearedCrates,shuffles,paidShuffleUsed,continueUsed,save,careDemo,board:scene.engine.board,leaves:scene.engine.leaves,crates:scene.engine.crates})');
  it.each(['ko','en'] as const)('%s 별·코인 버튼은 정확한 잔액/사용처와 닫기만 제공하고 상태·RNG를 보존합니다',language=>{
    const h=mainHarness();h.run("changeLanguage('"+language+"');globalThis.resourceEngine=scene.engine;globalThis.resourceRngCalls=0;const resourceRng=scene.engine.rng;scene.engine.rng=()=>{resourceRngCalls++;return resourceRng();};");
    for(const kind of ['stars','coins'] as const){
      const before=state(h),disk=h.disk(),writes=h.writes(),count=h.run('save.'+kind);
      expect(h.element('#'+kind+'-help').attributes['aria-label']).toBe(t(language,'resourceHelpButton').replace('{name}',t(language,kind)).replace('{count}',String(count)));
      h.element('#'+kind+'-help').onclick();expect(h.run('resourceDialog.open')).toBe(true);expect(h.run('game.paused')).toBe(true);expect(h.element('#game-canvas').tabIndex).toBe(-1);expect(h.element('#game-canvas').attributes['aria-disabled']).toBe('true');
      const html=h.run('resourceDialog.innerHTML');expect(html).toContain(t(language,kind==='stars'?'starsHelpUse':'coinsHelpUse'));expect(html).toContain(t(language,'resourceNormalBalance'));expect(html.match(/<button /g)).toHaveLength(1);
      expect(h.run('resourceDialog.attributes["aria-describedby"]')).toBe('resource-help-description');
      h.element('#resource-help-close').onclick();expect(h.run('resourceDialog.open')).toBe(false);expect(h.run('game.paused')).toBe(false);expect(h.element('#game-canvas').tabIndex).toBe(0);
      expect(state(h)).toBe(before);expect(h.disk()).toEqual(disk);expect(h.writes()).toBe(writes);expect(h.run('scene.engine===resourceEngine&&resourceRngCalls===0')).toBe(true);
    }
  });
  it.each(['close','escape','native-back'])('%s는 원래 버튼 초점/스크롤/화면과 동일 보드를 복귀합니다',exit=>{
    const h=mainHarness(false,false,false,exit==='native-back');h.run("nativeActive=true;switchView('journal');document.querySelector('#journal-view').scrollTop=123;document.querySelector('#journal-view').scrollLeft=7;globalThis.helpFocus=[];document.querySelector('#coins-help').focus=options=>helpFocus.push(options);");
    const before=state(h),disk=h.disk();h.element('#coins-help').onclick();
    h.run("document.querySelector('#journal-view').scrollTop=0;document.querySelector('#journal-view').scrollLeft=0");
    if(exit==='close')h.element('#resource-help-close').onclick();else if(exit==='escape')h.run('resourceDialog.listeners.cancel({preventDefault(){}})');else h.nativeEvents.backButton({isActive:true});
    expect(h.run('resourceHelp')).toBeUndefined();expect(h.run('resourceDialog.open')).toBe(false);expect(h.run('helpFocus')).toEqual([{preventScroll:true}]);expect(h.run('route')).toBe('journal');expect(h.run("document.querySelector('#journal-view').scrollTop")).toBe(123);expect(h.run("document.querySelector('#journal-view').scrollLeft")).toBe(7);
    expect(state(h)).toBe(before);expect(h.disk()).toEqual(disk);expect(h.run('game.paused')).toBe(true);
  });
  it.each(['hidden','inactive','pending','busy','scene-mismatch','result-delay','result','picker','tutorial','preview','ad','ad-busy','billing','billing-busy','care-processing','puzzle-processing','growing','reward-preparing','opener-hidden','opener-disabled','opener-detached'] as const)('안전하지 않은 %s 진입은 모달·저장·회차를 바꾸지 않습니다',reason=>{
    const h=mainHarness(false,false,true),disk=h.disk();
    const patches:Record<string,string>={hidden:'document.hidden=true',inactive:'nativeActive=false',pending:'boardPending=true',busy:'scene.canLeave=()=>false','scene-mismatch':'game.scene.board={}','result-delay':'resultTimer=77',result:"document.querySelector('#result-dialog').open=true",picker:"document.querySelector('#test-level-dialog').open=true",tutorial:"document.querySelector('#tutorial-dialog').open=true",preview:'previewDialog.open=true',ad:'testAds={pausesGame:true}','ad-busy':'testAds={busy:true}',billing:'testBilling={pausesGame:true}','billing-busy':'testBilling={busy:true,pausesGame:false}','care-processing':'careProcessing=true','puzzle-processing':'puzzleProcessing=true',growing:'growing=true','reward-preparing':'rewardedContinue={preparing:true}','opener-hidden':"document.querySelector('#stars-help').hidden=true",'opener-disabled':"document.querySelector('#stars-help').disabled=true",'opener-detached':"document.querySelector('#stars-help').isConnected=false"};
    const before=state(h);h.run(patches[reason]+";document.querySelector('#stars-help').onclick()");expect(h.run('resourceHelp')).toBeUndefined();expect(h.run('resourceDialog.open')).toBe(false);expect(state(h)).toBe(before);expect(h.disk()).toEqual(disk);
  });
  it('다른 안내·모달·화면·섞기·설정 소비를 겹치지 않고 오래된 닫기는 새 안내를 닫지 않습니다',async()=>{
    const h=mainHarness(false,false,true);h.run("switchView('settings')");const disk=h.disk(),before=state(h);h.element('#stars-help').onclick();const close=h.element('#resource-help-close').onclick;
    h.element('#coins-help').onclick();h.run("showTestPicker();showTutorial();showStagePreview(2,'restart',document.querySelector('#restart'));switchView('village')");await h.run('showAdDialog();showBillingDialog()');h.element('#music-toggle').onclick();h.element('#reset').onclick();h.element('#shuffle').onclick();
    expect(h.run('resourceHelp.kind')).toBe('stars');expect(h.run('route')).toBe('settings');expect(h.element('#tutorial-dialog').open).toBe(false);expect(h.element('#test-level-dialog').open).toBe(false);expect(h.run('previewDialog.open')).toBe(false);expect(state(h)).toBe(before);expect(h.disk()).toEqual(disk);
    close();h.element('#coins-help').onclick();close();expect(h.run('resourceHelp.kind')).toBe('coins');expect(h.run('resourceDialog.open')).toBe(true);h.element('#resource-help-close').onclick();
  });
  it.each(['ko','en'] as const)('%s 체험은 체험 잔액을 명시하고 일반 저장·체험 객체를 그대로 유지합니다',language=>{
    const h=mainHarness(false,false,true);h.run("switchView('journal');enterCareDemo();changeLanguage('"+language+"');globalThis.helpDemo=careDemo;globalThis.helpDemoSave=save");const disk=h.disk(),before=state(h),writes=h.writes();
    h.element('#coins-help').onclick();expect(h.run('resourceDialog.innerHTML')).toContain(t(language,'resourceDemoBalance'));expect(h.run('resourceDialog.innerHTML')).toContain(t(language,'resourceDemoNote'));expect(h.element('#coins-help').attributes['aria-label']).toContain(t(language,'resourceDemoBalance'));
    h.element('#resource-help-close').onclick();expect(h.run('careDemo===helpDemo&&save===helpDemoSave')).toBe(true);expect(state(h)).toBe(before);expect(h.disk()).toEqual(disk);expect(h.writes()).toBe(writes);
  });
  it('시험 회차는 일반 잔액/무보상을 명시하고 저장 충돌 중에도 읽기만 허용합니다',()=>{
    const h=mainHarness(false,false,true);h.run('startLevel(36,true)');const disk=h.disk(),before=state(h);h.element('#coins-help').onclick();expect(h.run('resourceDialog.innerHTML')).toContain(t('en','resourceTestNote'));h.element('#resource-help-close').onclick();expect(state(h)).toBe(before);expect(h.disk()).toEqual(disk);
    const blocked=mainHarness();blocked.run("localStorage.setItem('pawblossom.save.v1',JSON.stringify({...save,coins:99}));persist()");expect(blocked.run('saveStatus().load')).toBe('conflict');const writes=blocked.writes(),blockedDisk=blocked.disk();blocked.element('#stars-help').onclick();expect(blocked.run('resourceDialog.open')).toBe(true);blocked.element('#resource-help-close').onclick();expect(blocked.writes()).toBe(writes);expect(blocked.disk()).toEqual(blockedDisk);
  });
  it('최대 잔액 ARIA는 원값을 유지하고 열린 안내의 언어를 변경합니다',()=>{
    const h=mainHarness();h.run('save.stars=40;save.coins=1000000;updateWallet()');expect(h.element('#coin-count').textContent).toBe('1M');expect(h.element('#coins-help').attributes['aria-label']).toContain('1000000');h.element('#coins-help').onclick();h.run("changeLanguage('ko')");expect(h.element('#coin-count').textContent).toBe('100만');expect(h.run('resourceDialog.innerHTML')).toContain(t('ko','coinsHelpTitle'));expect(h.run('resourceDialog.innerHTML')).toContain('1000000');expect(h.run('resourceDialog.open')).toBe(true);
  });
  it('작은 화면 버튼/대화상자는 기본44px와 viewport안쪽 스크롤을 사용합니다',()=>{
    const css=read('../src/style.css'),source=read('../src/main.ts');expect(source).toContain('id="stars-help" type="button"');expect(source).toContain('id="coins-help" type="button"');
    expect(css).toMatch(/\.wallet-help\{[^}]*min-width:44px;min-height:44px/);expect(css).toMatch(/#resource-help-dialog\{[^}]*max-height:calc\(100dvh - 24px\);overflow:auto/);
  });
});


describe('중복 소개 제거와 큰 퍼즐 핍·정사각 아이콘',()=>{
  it.each(['ko','en'] as const)('%s 모든 화면에서 소개 배너를 중복하지 않고 같은 피드백 host를 유지합니다',language=>{
    const h=mainHarness(false,false,true);h.run("changeLanguage('"+language+"');globalThis.feedbackHost=document.querySelector('#header-pip');const queryBeforeIntroRemoval=document.querySelector;document.querySelector=selector=>['#story-chapter-name','#garden-count','#garden-fill'].includes(selector)?null:queryBeforeIntroRemoval(selector);");
    const disk=h.disk(),before=h.run('JSON.stringify({round,currentLevel,moves,score,collected,clearedLeaves,clearedCrates,save,board:scene.engine.board})');
    for(const route of ['village','journal','settings','puzzle'])h.run("switchView('"+route+"');updateWallet();updateGoals()");
    expect(h.element('#app').innerHTML).not.toContain('class="story-panel"');expect(h.element('#app').innerHTML).not.toContain('class="friend-message"');expect(h.element('#app').innerHTML).not.toContain('/assets/meadow.png');
    expect(h.element('#app').innerHTML.match(/id="header-pip"/g)).toHaveLength(1);expect(h.element('#app').innerHTML).toContain('id="header-pip" class="header-pip" aria-hidden="true"');expect(h.run("document.querySelector('#header-pip')===feedbackHost")).toBe(true);
    expect(h.run('JSON.stringify({round,currentLevel,moves,score,collected,clearedLeaves,clearedCrates,save,board:scene.engine.board})')).toBe(before);expect(h.disk()).toEqual(disk);
  });
  it('큰 핍의 전체 아트와 짧은 화면/190px 가로 배치를 분리하고 보드 정사각을 유지합니다',()=>{
    const css=read('../src/style.css');expect(css).toMatch(/\.header-pip\{[^}]*width:112px;height:112px/);expect(css).toMatch(/\.header-pip-image\{[^}]*width:100%;height:100%;[^}]*object-fit:contain/);
    expect(css).toContain('grid-template-columns:88px minmax(0,1fr);grid-template-rows:38px 44px');expect(css).toContain('flex-basis:88px;width:88px;height:88px');expect(css).toContain('.header-pip{flex-basis:80px;width:80px;height:80px}');
    expect(css).toContain('#game-canvas{width:min(100cqw,100cqh);height:min(100cqw,100cqh);aspect-ratio:1');expect(css).not.toContain('.header-pip-image.happy{left:');
  });
  it('설정 톱니의 아트 외곽은 가로/세로 대칭이고 터치44px/SVG22px를 분리합니다',()=>{
    const svg=renderIcon('settings',22),d=svg.match(/<path d="([^"]+)"/)![1],coords=[...d.matchAll(/[ML]([\d.]+) ([\d.]+)/g)].map(m=>[Number(m[1]),Number(m[2])]);
    const xs=coords.map(p=>p[0]),ys=coords.map(p=>p[1]);expect(coords).toHaveLength(32);expect([Math.min(...xs),Math.max(...xs),Math.min(...ys),Math.max(...ys)]).toEqual([3,21,3,21]);
    expect(svg).toContain('width="22" height="22" viewBox="0 0 24 24"');const css=read('../src/style.css');expect(css).toContain('#settings-button{display:grid;place-items:center;flex:0 0 44px;width:44px;height:44px');expect(css).toContain('#settings-button svg{display:block;flex:none;width:22px;height:22px;aspect-ratio:1}');
  });
});


describe('꽃 선택·공동 작품과 핍의 정원 연결',()=>{
  const initial=()=>({version:1,language:'en',highestLevel:2,completed:[1],stars:4,coins:40,garden:3,music:true,sfx:true,tutorialSeen:true,pip:{growth:100,affection:100,owned:[],equipped:'none'}});
  it.each(['ko','en'] as const)('%s 꽃 세 종류와 세 작품의 조합을 저장하고 재실행해도 유지합니다',language=>{
    const h=mainHarness(false,false,true,false,{...initial(),language});h.run("switchView('village')");
    const round=h.run('JSON.stringify({round,currentLevel,moves,score,board:scene.engine.board,inProgress:save.inProgress})'),writes=h.writes();
    h.element('#garden-plot-1').onclick();expect(h.writes()).toBe(writes);expect(h.element('#village-view').innerHTML).toContain('id="garden-plot-1" type="button" aria-pressed="true"');
    h.element('#garden-flower-daisy').onclick();h.element('#garden-plot-2').onclick();h.element('#garden-flower-violet').onclick();
    expect(h.stored().gardenDesign.flowers).toEqual(['meadow','daisy','violet','meadow','meadow']);expect(h.stored().coins).toBe(40);
    h.element('#garden-project-bench').onclick();h.element('#garden-project-butterflies').onclick();const buy=h.element('#garden-project-lantern').onclick;buy();buy();
    expect(h.stored().coins).toBe(20);expect(h.stored().gardenDesign.owned).toEqual(['bench','butterflies','lantern']);expect(h.element('#village-view').innerHTML).toContain('data-decoration="lantern"');
    const hide=h.element('#garden-project-lantern').onclick;hide();hide();expect(h.stored().gardenDesign.placed).not.toContain('lantern');expect(h.stored().coins).toBe(20);h.element('#garden-project-lantern').onclick();
    h.element('#garden-plot-1').onclick();h.element('#garden-flower-meadow').onclick();h.element('#garden-plot-2').onclick();h.element('#garden-flower-meadow').onclick();
    expect(h.stored().gardenDesign.owned).toHaveLength(3);expect(h.run('JSON.stringify({round,currentLevel,moves,score,board:scene.engine.board,inProgress:save.inProgress})')).toBe(round);
    const loaded=mainHarness(false,false,false,false,h.stored());loaded.run("switchView('village')");expect(loaded.element('#village-view').innerHTML).toContain('data-decoration="lantern"');loaded.run("switchView('journal')");expect(loaded.element('#journal-view').innerHTML).toContain(t(language,'gardenProjectsDone'));
    expect(h.element('#village-view').innerHTML).toContain('id="garden-plot-4" type="button" aria-pressed="false"');expect(h.element('#village-view').innerHTML).toMatch(/id="garden-plot-4"[^>]*disabled/);
    expect(h.stored().gardenDesign).not.toHaveProperty('lanternPlot');expect(h.element('#village-view').innerHTML).toContain(t(language,'gardenLanternDefault'));
    for(let i=0;i<2;i++){h.element('#grow').onclick();h.flushGrowth();}
    h.element('#garden-plot-3').onclick();const place=h.element('#garden-lantern-place').onclick;place();place();expect(h.stored().gardenDesign.lanternPlot).toBe(3);expect(h.stored().coins).toBe(20);
    const placedWrites=h.writes();h.element('#garden-lantern-place').onclick();expect(h.writes()).toBe(placedWrites);
    h.element('#garden-project-lantern').onclick();expect(h.stored().gardenDesign.placed).not.toContain('lantern');h.element('#garden-lantern-place').onclick();expect(h.stored().gardenDesign.placed).toContain('lantern');
    h.element('#garden-plot-4').onclick();expect(h.element('#village-view').innerHTML).toContain(t(language,'gardenLanternMove').replace('{number}','5'));h.element('#garden-lantern-place').onclick();
    expect(h.stored().gardenDesign.lanternPlot).toBe(4);expect(h.stored().coins).toBe(20);expect(h.run('JSON.stringify({round,currentLevel,moves,score,board:scene.engine.board,inProgress:save.inProgress})')).toBe(round);
    const reloaded=mainHarness(false,false,false,false,h.stored());reloaded.run("switchView('village')");const html=reloaded.element('#village-view').innerHTML;expect(html).toContain('data-decoration="lantern" transform="translate(405 244)"');expect(html).toContain(t(language,'gardenLanternAt').replace('{number}','5'));
  });
  it('옛 저장은 보기만 할 때 디자인을 추가하지 않고 목표 링크는 정원 편집 제목에 초점을 줍니다',()=>{
    const h=mainHarness();h.run("switchView('journal')");const before=h.disk(),writes=h.writes();expect(h.run('save.gardenDesign')).toBeUndefined();
    h.run("globalThis.editorFocus=[];document.querySelector('#garden-edit-title').focus=options=>editorFocus.push(options?.preventScroll)");
    h.element('#pip-open-garden').onclick();expect(h.run('route')).toBe('village');expect(h.run('editorFocus')).toEqual([true]);expect(h.run('save.gardenDesign')).toBeUndefined();expect(h.disk()).toEqual(before);expect(h.writes()).toBe(writes);
    expect(h.element('#journal-view').innerHTML).toContain(t('en','gardenBench'));expect(h.element('#village-view').innerHTML).toContain(t('en','gardenFirstPlot'));
  });
  it.each(['flower','claim','toggle'] as const)('%s 실패와 저장 충돌은 잔액·선택·소유를 확정하지 않습니다',action=>{
    const start=initial(),design={schema:1,flowers:['meadow','daisy','violet','meadow','meadow'],owned:action==='toggle'?['bench']:[],placed:action==='toggle'?['bench']:[]};
    const h=mainHarness(false,false,false,false,{...start,gardenDesign:design});h.run("switchView('village');globalThis.originalGardenSave=save");const before=h.disk(),save=h.run('JSON.stringify(save)'),id=action==='flower'?'garden-flower-daisy':action==='claim'?'garden-project-lantern':'garden-project-bench';
    h.setStorageFails(true);h.element('#'+id).onclick();expect(h.run('save===originalGardenSave')).toBe(true);expect(h.run('JSON.stringify(save)')).toBe(save);expect(h.disk()).toEqual(before);
    h.setStorageFails(false);h.run("localStorage.setItem('pawblossom.save.v1',JSON.stringify({...save,coins:99}))");const changed=h.disk();h.element('#'+id).onclick();expect(h.run('saveStatus().load')).toBe('conflict');expect(h.run('save===originalGardenSave')).toBe(true);expect(h.disk()).toEqual(changed);
    if(action==='claim'){
      const placement=mainHarness(false,false,false,false,{...start,gardenDesign:{...design,owned:['lantern'],placed:[]}});placement.run("switchView('village');globalThis.beforePlacement=save");const disk=placement.disk();placement.setStorageFails(true);placement.element('#garden-lantern-place').onclick();expect(placement.disk()).toEqual(disk);expect(placement.run('save===beforePlacement')).toBe(true);
      placement.setStorageFails(false);placement.run("localStorage.setItem('pawblossom.save.v1',JSON.stringify({...save,coins:99}))");const conflict=placement.disk();placement.element('#garden-lantern-place').onclick();expect(placement.run('saveStatus().load')).toBe('conflict');expect(placement.run('save===beforePlacement')).toBe(true);expect(placement.disk()).toEqual(conflict);
    }
  });
  it('체험은 fresh 디자인과1800코인으로 시작하고 새 조합/반응·늦은 버튼은 정상 저장으로 넘어가지 않습니다',()=>{
    const h=mainHarness(false,false,true,false,{...initial(),gardenDesign:{schema:1,flowers:['meadow','daisy','violet','meadow','meadow'],owned:['bench','lantern'],placed:['bench'],lanternPlot:2}});h.run("switchView('village');globalThis.normalGardenSave=save");const before=h.disk(),normal=h.run('JSON.stringify(save)'),old=h.element('#garden-lantern-place').onclick,writes=h.writes();
    expect(h.run('enterCareDemo()')).toBe(true);expect(h.run('save.coins')).toBe(1800);expect(h.run('save.gardenDesign')).toEqual({schema:1,flowers:Array(5).fill('meadow'),owned:[],placed:[]});old();
    h.element('#grow').onclick();h.flushGrowth();h.element('#garden-flower-daisy').onclick();const stale=h.element('#garden-flower-violet').onclick;h.element('#garden-visit').onclick();expect(h.element('#village-view').innerHTML).toContain(t('en','pipGreetReaction'));
    const noOwner=h.run('JSON.stringify(save)');h.element('#garden-lantern-place').onclick();expect(h.run('JSON.stringify(save)')).toBe(noOwner);
    for(let i=0;i<2;i++){h.element('#grow').onclick();h.flushGrowth();}h.run("switchView('journal')");for(let i=0;i<6;i++){h.element('#pip-feed').onclick();h.element('#pip-play').onclick();}h.run("switchView('village')");h.element('#garden-plot-0').onclick();h.element('#garden-flower-meadow').onclick();h.element('#garden-plot-1').onclick();h.element('#garden-flower-daisy').onclick();h.element('#garden-plot-2').onclick();h.element('#garden-flower-violet').onclick();h.element('#garden-project-lantern').onclick();const demoPlacement=h.element('#garden-lantern-place').onclick;demoPlacement();expect(h.run('save.gardenDesign.lanternPlot')).toBe(2);
    expect(h.run('exitCareDemo()')).toBe(true);stale();demoPlacement();expect(h.run('save===normalGardenSave')).toBe(true);expect(h.run('JSON.stringify(save)')).toBe(normal);expect(h.disk()).toEqual(before);expect(h.writes()).toBe(writes);
  });
  it('모달/숨김/중복처리 중 편집은 거절하고 무료 방문·돌보기는 재화를 쓰지 않습니다',()=>{
    for(const guard of ['document.hidden=true','nativeActive=false',"document.querySelector('#tutorial-dialog').open=true",'careProcessing=true','growing=true','boardPending=true']){
      const h=mainHarness(false,false,false,false,initial(),false);h.frame();h.run("switchView('village')");const before=h.disk(),value=h.run('JSON.stringify(save)');h.run(guard);h.element('#garden-flower-daisy').onclick();expect(h.disk()).toEqual(before);expect(h.run('JSON.stringify(save)')).toBe(value);
    }
    const h=mainHarness(false,false,false,false,{...initial(),gardenDesign:{schema:1,flowers:Array(5).fill('meadow'),owned:['bench'],placed:['bench']}});h.run("switchView('village')");const before=h.disk(),writes=h.writes();h.element('#garden-visit').onclick();expect(h.element('#village-view').innerHTML).toContain(t('en','gardenVisitBench'));h.element('#garden-tend').onclick();expect(h.element('#village-view').innerHTML).toContain('pip-watering-can');expect(h.disk()).toEqual(before);expect(h.writes()).toBe(writes);
  });
  it('선택 버튼은44px·눌림 상태이며 긴 문구와 작은 화면은 내부 스크롤을 사용합니다',()=>{
    const css=read('../src/style.css');expect(css).toMatch(/\.garden-plots button,\.garden-flowers button\{[^}]*min-height:44px/);expect(css).toContain('grid-template-columns:repeat(5,minmax(0,1fr))');expect(css).toContain('grid-template-columns:repeat(3,minmax(0,1fr))');expect(css).toContain('.view{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain}');
    expect(css).toContain('.garden-preview{position:sticky;top:0;z-index:1}');expect(css).toContain('scroll-margin-top:min(340px,calc(58.333vw - 12px))');
    const h=mainHarness();const html=h.element('#village-view').innerHTML;expect(html).toMatch(/class="garden-workshop">[\s\S]*class="garden-picture garden-preview">[\s\S]*class="garden-visitor [^"]*">[\s\S]*id="garden-edit-title"[\s\S]*<\/section>/);expect(html).not.toContain('data-level=');
  });
  it('해금 뒤 비활성 버튼은 편집 제목으로 초점을 복귀하고 선택 칸/스크롤은 체험 왕복에 보존합니다',()=>{
    const h=mainHarness(false,false,true,false,{...initial(),gardenDesign:{schema:1,flowers:Array(5).fill('meadow'),owned:['lantern'],placed:[]}});h.run("switchView('village');selectedGardenPlot=2;renderViews();globalThis.gardenFocus=[];document.activeElement={id:'garden-flower-violet',isConnected:false};document.querySelector('#garden-flower-violet').disabled=true;document.querySelector('#garden-edit-title').focus=options=>gardenFocus.push(options?.preventScroll);globalThis.gardenScroll=[];document.querySelector('#garden-edit-title').scrollIntoView=options=>gardenScroll.push(options?.block);document.querySelector('#village-view').scrollTop=175;renderViews()");
    expect(h.run('gardenFocus')).toEqual([true]);expect(h.run('gardenScroll')).toEqual(['start']);expect(h.run("document.querySelector('#village-view').scrollTop")).toBe(175);h.run('enterCareDemo();exitCareDemo()');expect(h.run('selectedGardenPlot')).toBe(2);
    h.run("gardenFocus=[];document.activeElement={id:'garden-lantern-place',isConnected:false};Object.defineProperty(document.querySelector('#garden-lantern-place'),'disabled',{configurable:true,get:()=>save.gardenDesign.lanternPlot===2&&save.gardenDesign.placed.includes('lantern')})");h.element('#garden-lantern-place').onclick();expect(h.run('gardenFocus')).toEqual([true]);expect(h.run('save.gardenDesign.lanternPlot')).toBe(2);
  });
  it('primary 쓰기 실패는 정원 구매와 잔액을 메모리에 확정하지 않고 원래 primary를 유지합니다',()=>{
    const h=mainHarness(false,false,false,false,{...initial(),gardenDesign:{schema:1,flowers:['meadow','daisy','violet','meadow','meadow'],owned:[],placed:[]}});h.run("switchView('village');globalThis.beforeGardenPurchase=save;globalThis.beforePrimary=localStorage.getItem('pawblossom.save.v1');const gardenSet=localStorage.setItem;localStorage.setItem=(key,value)=>{if(key==='pawblossom.save.v1')throw Error('primary blocked');gardenSet(key,value)}");
    h.element('#garden-project-lantern').onclick();expect(h.run('save===beforeGardenPurchase')).toBe(true);expect(h.run('save.coins')).toBe(40);expect(h.run('save.gardenDesign.owned')).toEqual([]);expect(h.run("localStorage.getItem('pawblossom.save.v1')===beforePrimary")).toBe(true);expect(h.run('saveStatus().write')).toBe('failed');
    const move=mainHarness(false,false,false,false,{...initial(),gardenDesign:{schema:1,flowers:Array(5).fill('meadow'),owned:['lantern'],placed:[]}});move.run("switchView('village');globalThis.beforeLanternPlacement=save;globalThis.beforeLanternPrimary=localStorage.getItem('pawblossom.save.v1');const placeSet=localStorage.setItem;localStorage.setItem=(key,value)=>{if(key==='pawblossom.save.v1')throw Error('primary blocked');placeSet(key,value)}");move.element('#garden-lantern-place').onclick();expect(move.run('save===beforeLanternPlacement')).toBe(true);expect(move.run('save.coins')).toBe(40);expect(move.run('save.gardenDesign')).not.toHaveProperty('lanternPlot');expect(move.run('save.gardenDesign.placed')).toEqual([]);expect(move.run("localStorage.getItem('pawblossom.save.v1')===beforeLanternPrimary")).toBe(true);
  });
});


describe('후반 고유 완료 풍경과 정원 거래 context',()=>{
  const themeSave=(clears=40)=>({version:1,language:'en',highestLevel:clears===40?40:clears+1,completed:Array.from({length:clears},(_,i)=>i+1),stars:0,coins:200,garden:5,music:true,sfx:true,tutorialSeen:true,pip:{growth:100,affection:100,owned:[],equipped:'none'},gardenDesign:{schema:1,flowers:['meadow','daisy','violet','meadow','meadow'],owned:['bench','butterflies','lantern'],placed:['bench','butterflies','lantern'],lanternPlot:4}});
  it.each(['ko','en'] as const)('%s 풍경 현재/변경 보기·취소는 코인·소유·꽃과 회차를 보존합니다',language=>{
    const h=mainHarness(false,false,false,false,{...themeSave(),language});h.run("switchView('village')");
    const disk=h.disk(),writes=h.writes(),save=h.run('JSON.stringify(save)'),round=h.run('JSON.stringify({round,moves,score,board:scene.engine.board})');
    h.element('#garden-theme-starlight').onclick();expect(h.run('lookDialog.open')).toBe(true);expect(h.run('lookDialog.innerHTML')).toContain('data-sky="starlight"');expect(h.run('lookDialog.innerHTML')).toContain(t(language,'themePreviewRemaining').replace('{coins}','120'));
    const stale=h.element('#garden-look-confirm').onclick;h.element('#garden-look-current').onclick();expect(h.run('lookDialog.innerHTML')).not.toContain('data-sky="starlight"');h.element('#garden-look-after').onclick();
    h.element('#garden-look-cancel').onclick();stale();expect(h.run('lookDialog.open')).toBe(false);expect(h.run('JSON.stringify(save)')).toBe(save);expect(h.disk()).toEqual(disk);expect(h.writes()).toBe(writes);expect(h.run('JSON.stringify({round,moves,score,board:scene.engine.board})')).toBe(round);
  });
  it.each(['hidden','inactive','route','language','generation','detached'] as const)('%s 전의 풍경 확인 버튼은 구매할 수 없습니다',reason=>{
    const h=mainHarness(false,false,false,false,themeSave());h.run("switchView('village')");h.element('#garden-theme-sunset').onclick();const confirm=h.element('#garden-look-confirm').onclick;
    if(reason==='hidden')h.run('document.hidden=true;syncActivity()');else if(reason==='inactive')h.run('nativeActive=false;syncActivity()');else if(reason==='route')h.run("switchView('journal')");else if(reason==='language')h.run("changeLanguage('ko')");else if(reason==='generation')h.run('careGeneration++');else h.element('#garden-look-confirm').isConnected=false;
    confirm();expect(h.run('save.coins')).toBe(200);expect(h.run('save.gardenDesign.ownedThemes')).toBeUndefined();expect(h.run('save.gardenDesign.theme')).toBeUndefined();
  });
  it.each(['clears','coins','storage'] as const)('%s 부족 상태도 그림은 볼 수 있지만 구매 확정은 거절합니다',reason=>{
    const initial=themeSave(reason==='clears'?19:40);if(reason==='coins')initial.coins=79;
    const h=mainHarness(false,false,false,false,initial);h.run("switchView('village')");if(reason==='storage')h.run("saveStatus=()=>({load:'loaded',write:'blocked',resetPending:false})");const before=h.run('JSON.stringify(save)'),disk=h.disk();h.element('#garden-theme-sunset').onclick();
    expect(h.run('lookDialog.open')).toBe(true);expect(h.run('lookDialog.innerHTML')).toContain('data-sky="sunset"');expect(h.run('lookDialog.innerHTML')).toMatch(/id="garden-look-confirm"[^>]*disabled/);
    h.element('#garden-look-confirm').onclick();expect(h.run('JSON.stringify(save)')).toBe(before);expect(h.disk()).toEqual(disk);
  });
  it('풍경을 보는 중 이전 설정 버튼은 미리보기 context를 바꾸지 않습니다',()=>{
    const h=mainHarness(false,false,false,false,themeSave());h.run("switchView('village')");const oldMusic=h.element('#music-toggle').onclick,oldReset=h.element('#reset').onclick;h.element('#garden-theme-sunset').onclick();const disk=h.disk();oldMusic();oldReset();expect(h.disk()).toEqual(disk);expect(h.run('lookDialog.open')).toBe(true);
  });
  it.each(['ko','en'] as const)('%s 20/40풍경을 한번 구매하고 무료 선택·기존행동·재실행·ARIA/초점을 보존합니다',language=>{
    const h=mainHarness(false,false,false,false,{...themeSave(),language});h.run("switchView('journal')");expect(h.element('#journal-view').innerHTML).toContain(t(language,'gardenThemeSunset'));h.element('#pip-open-garden').onclick();
    const before=h.run('JSON.stringify({round,currentLevel,moves,score,board:scene.engine.board,inProgress:save.inProgress})');
    h.run("globalThis.themeFocus=[];document.activeElement={id:'garden-theme-sunset',isConnected:false};document.querySelector('#garden-edit-title').focus=options=>themeFocus.push(options?.preventScroll);Object.defineProperty(document.querySelector('#garden-theme-sunset'),'disabled',{configurable:true,get:()=>save.gardenDesign.theme==='sunset'})");
    const buy=h.element('#garden-theme-sunset').onclick;buy();buy();const confirm=h.element('#garden-look-confirm').onclick;confirm();confirm();expect(h.stored().coins).toBe(120);expect(h.stored().gardenDesign.ownedThemes).toEqual(['sunset']);expect(h.run('themeFocus')).toEqual([true,true]);expect(h.element('#village-view').innerHTML).toContain('data-sky="sunset"');
    h.run("switchView('journal')");expect(h.element('#journal-view').innerHTML).toContain(t(language,'gardenThemeStarlight'));h.run("switchView('village')");h.element('#garden-theme-starlight').onclick();h.element('#garden-look-confirm').onclick();expect(h.stored().coins).toBe(40);
    h.element('#garden-theme-meadow').onclick();expect(h.element('#village-view').innerHTML).not.toContain('data-sky=');h.element('#garden-theme-sunset').onclick();const writes=h.writes();h.element('#garden-theme-sunset').onclick();expect(h.writes()).toBe(writes);
    h.element('#garden-flower-daisy').onclick();h.element('#garden-project-lantern').onclick();h.element('#garden-lantern-place').onclick();h.run("switchView('journal')");h.element('#pip-feed').onclick();expect(h.stored().coins).toBe(40);expect(h.stored().gardenDesign).toMatchObject({ownedThemes:['sunset','starlight'],theme:'sunset',lanternPlot:0});expect(h.run('JSON.stringify({round,currentLevel,moves,score,board:scene.engine.board,inProgress:save.inProgress})')).toBe(before);
    expect(h.element('#journal-view').innerHTML).toContain(t(language,'gardenThemesDone'));const reload=mainHarness(false,false,false,false,h.stored());reload.run("switchView('village')");const html=reload.element('#village-view').innerHTML;expect(html).toContain('data-sky="sunset"');expect(html).toContain(t(language,'gardenThemeSunset')+' · '+t(language,'gardenThemeSelected'));expect(html).toContain('id="garden-theme-sunset" type="button"');
  });
  it('시험 회차와 중복 완료는 일반19개를20개로 올리지 않으며 구 소유 필드를 만들지 않습니다',()=>{
    const initial=themeSave(19);initial.completed.push(1);const h=mainHarness(false,false,true,false,initial);h.run("startLevel(20,true);finish(true);document.querySelector('#result-dialog').close();switchView('village')");expect(h.run('gardenCompletedCount()')).toBe(19);const disk=h.disk(),coins=h.run('save.coins');h.element('#garden-theme-sunset').onclick();expect(h.disk()).toEqual(disk);expect(h.run('save.coins')).toBe(coins);expect(h.run('save.gardenDesign')).not.toHaveProperty('ownedThemes');expect(h.run('save.completed.length')).toBe(19);
  });
  it('구매와 무료 선택은 backup/primary실패·충돌 때 같은 원본을 유지합니다',()=>{
    for(const owned of [false,true])for(const phase of ['backup','primary','conflict']){
      const h=mainHarness(false,false,false,false,{...themeSave(),gardenDesign:{...themeSave().gardenDesign,...(owned?{ownedThemes:['sunset'],theme:'meadow'}:{})}});h.run("switchView('village');globalThis.themeSaveBefore=save;globalThis.themeJsonBefore=JSON.stringify(save);globalThis.themePrimaryBefore=localStorage.getItem('pawblossom.save.v1')");
      if(phase==='backup')h.setStorageFails(true);else if(phase==='primary')h.run("const themeSet=localStorage.setItem;localStorage.setItem=(key,value)=>{if(key==='pawblossom.save.v1')throw Error('primary blocked');themeSet(key,value)}");else h.run("localStorage.setItem('pawblossom.save.v1',JSON.stringify({...save,coins:999}))");
      const primary=h.run("localStorage.getItem('pawblossom.save.v1')");h.element('#garden-theme-sunset').onclick();h.element('#garden-look-confirm').onclick();expect(h.run('save===themeSaveBefore')).toBe(true);expect(h.run('JSON.stringify(save)===themeJsonBefore')).toBe(true);expect(h.run("localStorage.getItem('pawblossom.save.v1')")).toBe(primary);
    }
  });
  it('체험의40완료 context는 실제 완료목록·정상RNG/회차를 바꾸지 않고 종료시 풍경도 폐기합니다',()=>{
    const h=mainHarness(false,false,true,false,themeSave(19));h.run("switchView('village');globalThis.themeNormal=save;globalThis.themeCompleted=JSON.stringify(save.completed);globalThis.themeRound=JSON.stringify({round,moves,score,board:scene.engine.board,inProgress:save.inProgress})");const before=h.disk(),normal=h.run('JSON.stringify(save)'),writes=h.writes();const stale=h.element('#garden-theme-sunset').onclick;
    expect(h.run('enterCareDemo()')).toBe(true);expect(h.run('gardenCompletedCount()')).toBe(100);expect(h.element('#village-view').innerHTML).toContain(t('en','journeyDemoHint').replace('{count}','100').replace('{stars}','100').replace('{coins}','1800'));expect(h.run('JSON.stringify(save.completed)===themeCompleted')).toBe(true);expect(h.run('save.gardenDesign')).not.toHaveProperty('ownedThemes');
    for(let i=0;i<5;i++){h.element('#grow').onclick();h.flushGrowth();}h.run("switchView('journal')");for(let i=0;i<8;i++){h.element('#pip-feed').onclick();h.element('#pip-play').onclick();}h.element('#pip-buy-ribbon').onclick();h.element('#pip-buy-wateringCan').onclick();expect(h.run('save.pip.owned')).toEqual(['ribbon','wateringCan']);h.run("switchView('village')");h.element('#garden-flower-daisy').onclick();h.element('#garden-plot-1').onclick();h.element('#garden-flower-violet').onclick();for(const id of ['bench','butterflies','lantern'])h.element('#garden-project-'+id).onclick();expect(h.run('save.gardenDesign.owned')).toEqual(['bench','butterflies','lantern']);const demoCoins=h.run('save.coins');stale();expect(h.run('save.coins')).toBe(demoCoins);h.element('#garden-theme-sunset').onclick();h.element('#garden-look-confirm').onclick();h.element('#garden-theme-starlight').onclick();h.element('#garden-look-confirm').onclick();expect(h.run('save.gardenDesign.theme')).toBe('starlight');expect(h.run('save.coins')).toBe(1350);const demoSelect=h.element('#garden-theme-meadow').onclick;
    for(const area of ['pond','shelter','arch']){
      h.element('#garden-area-'+area).onclick();for(let phase=0;phase<2;phase++){h.element('#garden-space-restore').onclick();expect(h.run('spaceDialog.open')).toBe(true);h.element('#space-preview-confirm').onclick();}
      h.element('#garden-space-alt').onclick();h.element('#space-preview-confirm').onclick();
      const balance=h.run('save.coins');for(const style of ['base','alt']){h.element('#garden-space-'+style).onclick();h.element('#space-preview-confirm').onclick();expect(h.run('save.coins')).toBe(balance);}
    }
    expect(h.run('save.coins')).toBe(270);expect(h.run('save.stars')).toBe(6);expect(h.run('Object.values(save.gardenDesign.spaces).every(s=>s.phase===2&&s.altOwned&&s.style===\'alt\')')).toBe(true);
    // 기존 action도 체험100 context로 새 소유물을 유지합니다.
    h.element('#garden-area-flowers').onclick();h.element('#garden-theme-meadow').onclick();h.element('#garden-flower-meadow').onclick();h.run("switchView('journal')");h.element('#pip-feed').onclick();expect(h.run('save.coins')).toBe(270);
    expect(h.run('exitCareDemo()')).toBe(true);demoSelect();expect(h.run('save===themeNormal')).toBe(true);expect(h.run('JSON.stringify(save)')).toBe(normal);expect(h.run('JSON.stringify({round,moves,score,board:scene.engine.board,inProgress:save.inProgress})===themeRound')).toBe(true);expect(h.disk()).toEqual(before);expect(h.writes()).toBe(writes);
  });
});


describe('경로 표시 컨테이너와 메뉴 버튼의 이벤트 경계',()=>{
  it('내부 버튼 클릭이 app까지 버블링되어도 복원 미리보기를 닫지 않고 실제 메뉴만 경로를 바꿉니다',()=>{
    const h=mainHarness(false,false,true,false,{version:1,language:'ko',highestLevel:61,completed:Array.from({length:60},(_,i)=>i+1),coins:120,stars:30,garden:1,music:true,sfx:true,tutorialSeen:true});
    h.element('#nav-village').onclick();expect(h.run('route')).toBe('village');expect(h.element('#nav-village').attributes['aria-current']).toBe('page');expect(h.element('#app').attributes['aria-current']).toBeUndefined();
    h.element('#garden-area-pond').onclick();h.element('#app').onclick();const before=h.disk(),writes=h.writes();h.element('#garden-space-restore').onclick();h.element('#app').onclick();
    expect(h.run('spaceDialog.open')).toBe(true);expect(h.run('Boolean(spacePreview)')).toBe(true);expect(h.disk()).toEqual(before);expect(h.writes()).toBe(writes);
    h.element('#space-preview-confirm').onclick();expect(h.run('spaceDialog.open')).toBe(false);expect(h.run('save.stars')).toBe(18);expect(h.run('save.gardenDesign.spaces.pond.phase')).toBe(1);
    h.element('#nav-map').onclick();expect(h.run('route')).toBe('map');expect(h.element('#nav-map').attributes['aria-current']).toBe('page');expect(h.element('#nav-village').attributes['aria-current']).toBeUndefined();
  });
});

describe('핍 여행 앨범의 실제 기록·수명과 지도 이동',()=>{
  const initial=(language='ko')=>({version:1,language,highestLevel:21,completed:Array.from({length:20},(_,i)=>i+1),coins:800,stars:20,garden:0,music:true,sfx:true,tutorialSeen:true});
  const snapshot='JSON.stringify({save,round,currentLevel,moves,score,board:scene.engine.board})';
  it.each(['ko','en'] as const)('%s: 실제20완료만1장으로 표시하고 선택·지도이동은 회차와 저장을 바꾸지 않습니다',language=>{
    const h=mainHarness(false,false,true,false,initial(language));h.run("switchView('journal')");
    expect(h.element('#journal-view').innerHTML).toContain(t(language,'albumCollection').replace('{count}','1').replace('{total}','25'));
    const before=h.run(snapshot),disk=h.disk(),writes=h.writes();
    h.run("document.querySelector('#album-world-select').value='24';document.querySelector('#album-world-select').onchange()");
    expect(h.run('selectedAlbumWorld')).toBe(24);expect(h.element('#journal-view').innerHTML).not.toContain('album-postcard-31-0');
    let focused=0;h.element('#map-chapter-title-31').focus=()=>{focused++;};
    h.element('#album-open-map').onclick();expect(h.run('route')).toBe('map');expect(h.run('selectedChapter')).toBe(31);expect(focused).toBe(1);expect(h.element('#map-chapter-title-31').tabIndex).toBe(-1);
    expect(h.run(snapshot)).toBe(before);expect(h.disk()).toEqual(disk);expect(h.writes()).toBe(writes);
  });
  it('체험500·시험 회차는 실제엽서를 만들지 않고 낡은/비활성 입력을 차단합니다',()=>{
    const h=mainHarness(false,false,true,false,initial());h.run("switchView('journal')");const stale=h.element('#album-open-map').onclick;
    h.run('enterCareDemo();setCareDemoPreset(500)');expect(h.run('albumCompleted().length')).toBe(20);expect(h.element('#journal-view').innerHTML).toContain(t('ko','albumRealOnly'));expect(h.element('#journal-view').innerHTML).toContain(t('ko','albumCollection').replace('{count}','1').replace('{total}','25'));
    h.run("switchView('journal')");const before=h.run(snapshot);stale();h.element('#album-open-map').onclick();expect(h.run('route')).toBe('journal');expect(h.run(snapshot)).toBe(before);
    h.run('exitCareDemo();document.hidden=true');h.element('#album-open-map').onclick();expect(h.run('route')).toBe('journal');
  });
  it('선택 그림은 숨김/모달에서 비활성화하고 DOM교체·언어변경 뒤 이전 소유자를 폐기합니다',()=>{
    const h=mainHarness(false,false,true,false,initial());h.run("switchView('journal')");const art=h.run('albumArt');expect(art.active).toBe(true);
    h.run('document.hidden=true;syncPipActivity()');expect(art.active).toBe(false);h.run('document.hidden=false;syncPipActivity()');expect(h.run('albumArt.active')).toBe(true);
    h.run("changeLanguage('en')");expect(art.disposed).toBe(true);const next=h.run('albumArt');expect(next.active).toBe(true);
    h.run("switchView('puzzle')");expect(next.active).toBe(false);
    h.run("switchView('journal');document.querySelector('#tutorial-dialog').open=true;syncPipActivity()");expect(h.run('albumArt.active')).toBe(false);
  });
});

describe('공동 정원 계획의 이동 전용 입력',()=>{
  const initial=()=>({version:1,language:'ko',highestLevel:2,completed:[1],coins:100,stars:0,garden:1,music:true,sfx:true,tutorialSeen:true});
  const snapshot='JSON.stringify({save,round,currentLevel,moves,score,board:scene.engine.board})';
  it.each(['ko','en'] as const)('%s: 실제36복원을 모두 소유했을 때만 전체 완료를 안내합니다',language=>{
    const spaces=freshGardenSpaces();for(const space of Object.values(spaces))space.phase=2;
    const design={...freshGardenDesign(),flowers:['meadow','daisy','violet','meadow','meadow'],owned:['bench','butterflies','lantern'],ownedThemes:['sunset','starlight'],spaces,journeyProjects:Object.fromEntries(journeyModel.journeyProjectSpecs.map(spec=>[spec.id,{phase:2,altOwned:false,style:'base'}]))};
    const h=mainHarness(false,false,true,false,{...initial(),language,garden:5,pip:{growth:100,affection:100,owned:[],equipped:'none'},highestLevel:500,completed:Array.from({length:500},(_,i)=>i+1),gardenDesign:design});
    h.run("switchView('village')");const html=h.run("sharedGardenPlan('village')");expect(html).toContain('36 / 36');expect(html).toContain(t(language,'goalAllDone'));expect(html).not.toContain('garden-plan-next');
  });
  it.each(['ko','en'] as const)('%s: 여행 목표의 기초 선행은 해당 작품을 열고 별 부족은 퍼즐로 안내하며 이동만으로 저장하지 않습니다',language=>{
    const data={...initial(),language,highestLevel:181,completed:Array.from({length:180},(_,i)=>i+1),stars:30};
    const h=mainHarness(false,false,true,false,data);h.run("switchView('village')");
    expect(h.run("sharedGardenPlan('village')")).toContain('1 / 36');
    expect(h.run("sharedGardenPlan('village')")).toContain(journeyUI.journeyName(language,'lotus'));
    const before=h.run(snapshot),disk=h.disk(),writes=h.writes(),stale=h.element('#village-goal-journey-lotus-2').onclick;
    let focused=0;h.element('#garden-space-title').focus=()=>{focused++;};
    stale();expect(h.run('route')).toBe('village');expect(h.run('selectedGardenArea')).toBe('journey');expect(h.run('selectedJourneyProject')).toBe('lotus');expect(focused).toBe(1);
    expect(h.run(snapshot)).toBe(before);expect(h.disk()).toEqual(disk);expect(h.writes()).toBe(writes);
    h.element('#journey-restore').onclick();h.element('#space-preview-confirm').onclick();expect(h.stored().gardenDesign.journeyProjects.lotus.phase).toBe(1);expect(h.stored().stars).toBe(15);
    h.run("switchView('journal')");const after=h.run(snapshot),afterWrites=h.writes();h.element('#journal-goal-journey-lotus-2').onclick();expect(h.run('route')).toBe('map');expect(h.run(snapshot)).toBe(after);expect(h.writes()).toBe(afterWrites);
    stale();expect(h.run('route')).toBe('map');expect(h.run(snapshot)).toBe(after);
  });
  it.each(['ko','en'] as const)('%s: 부족한 성장·별의 목적지에 이동하고 자동 소비/저장/회차 교체를 하지 않습니다',language=>{
    const h=mainHarness(false,false,false,false,{...initial(),language});h.run("switchView('village')");
    const before=h.run(snapshot),disk=h.disk(),writes=h.writes();
    expect(h.run("sharedGardenPlan('village')")).toContain(t(language,'goalPlan'));expect(h.run("sharedGardenPlan('village')")).toContain('1 / 16');
    expect(h.run("sharedGardenPlan('village')")).toContain(`aria-label="${t(language,'gardenBench')} · ${t(language,'goalCare')}"`);
    h.element('#village-goal-bench').onclick();expect(h.run('route')).toBe('journal');
    h.element('#journal-goal-bed-2').onclick();expect(h.run('route')).toBe('map');
    expect(h.run(snapshot)).toBe(before);expect(h.disk()).toEqual(disk);expect(h.writes()).toBe(writes);expect(h.run('save.gardenDesign')).toBeUndefined();
  });
  it('완료/비활성·모달·오래된 DOM·체험 이전 버튼으로 계획을 실행하지 않습니다',()=>{
    for(const guard of ['document.hidden=true','nativeActive=false','careProcessing=true',"document.querySelector('#tutorial-dialog').open=true", "document.querySelector('#village-goal-bench').isConnected=false"]){
      const h=mainHarness(false,false,true,false,initial());h.run("switchView('village')");const before=h.run(snapshot);h.run(guard);h.element('#village-goal-bench').onclick();expect(h.run('route')).toBe('village');expect(h.run(snapshot)).toBe(before);
    }
    const h=mainHarness(false,false,true,false,initial());h.run("switchView('village')");const stale=h.element('#village-goal-bench').onclick;h.run('enterCareDemo()');stale();expect(h.run('route')).toBe('village');h.run('exitCareDemo()');expect(h.run('save.garden')).toBe(1);
  });
});

describe('무료 정원 공간 교감',()=>{
  const initial=(language:'ko'|'en'='ko',garden=1,phase:0|1|2=2,style:'base'|'alt'='base')=>({version:1,language,highestLevel:61,completed:Array.from({length:60},(_,i)=>i+1),coins:180,stars:6,garden,music:true,sfx:true,tutorialSeen:true,pip:{growth:0,affection:0,owned:[],equipped:'none'},gardenDesign:{schema:1,flowers:Array.from({length:5},(_,i)=>i<garden?i===0?'daisy':i===1?'violet':'meadow':'meadow'),owned:[],placed:[],spaces:{...freshGardenSpaces(),pond:{phase,altOwned:style==='alt',style}}}});
  const roundState='JSON.stringify({round,currentLevel,moves,score,collected,board:scene.engine.board,inProgress:save.inProgress})';
  it.each(['ko','en'] as const)('%s: 빈터·기초 복원·완성 상태의 인사를 구분하며 중간 상태에는 완성 공간을 말하지 않습니다',language=>{
    for(const area of ['pond','shelter','arch'] as const)for(const phase of [0,1,2] as const){
      const data={...initial(language,1),highestLevel:100,completed:Array.from({length:100},(_,i)=>i+1)};
      data.gardenDesign.spaces={...freshGardenSpaces(),[area]:{phase,altOwned:false,style:'base'}};
      const h=mainHarness(false,false,false,false,data);h.run("switchView('village')");h.element('#garden-area-'+area).onclick();
      const line=h.run('gardenVisitControls()'),key=phase===0?'spaceVisitEmpty':phase===1?'spaceVisitBuilding':({pond:'spaceVisitPond',shelter:'spaceVisitShelter',arch:'spaceVisitArch'} as const)[area];
      expect(line).toContain(t(language,key));if(phase===1)expect(line).not.toContain(t(language,({pond:'spaceVisitPond',shelter:'spaceVisitShelter',arch:'spaceVisitArch'} as const)[area]));
    }
  });
  it.each(['ko','en'] as const)('%s: 실제 꽃밭/꽃 종류에 반응하고 무료 활동은 저장·성장·회차를 바꾸지 않습니다',language=>{
    const h=mainHarness(false,false,false,false,initial(language,2));h.run("switchView('village');globalThis.activitySave=save;globalThis.activityScene=scene");
    const disk=h.disk(),writes=h.writes(),before=h.run('JSON.stringify(save)'),round=h.run(roundState);
    h.run("document.querySelector('#village-view').scrollTop=175");h.element('#garden-activity-flower').onclick();
    expect(h.run('gardenActivity')).toEqual({kind:'flower',plot:0});expect(h.run('gardenWorkshop(false)')).toContain(t(language,'gardenDaisy'));
    expect(h.run('gardenActivitySpots()')).toMatch(/id="garden-activity-flower"[^>]*aria-pressed="true"/);
    const same=h.run('gardenActivity');h.element('#garden-activity-flower').onclick();expect(h.run('gardenActivity')).toBe(same);
    h.element('#garden-plot-1').onclick();expect(h.run('gardenActivity')).toBeUndefined();h.element('#garden-activity-flower').onclick();
    expect(h.run('gardenActivity')).toEqual({kind:'flower',plot:1});expect(h.run('gardenVisitControls()')).toContain(t(language,'gardenViolet'));
    expect(h.run('save===activitySave&&scene===activityScene')).toBe(true);expect(h.run('JSON.stringify(save)')).toBe(before);expect(h.run(roundState)).toBe(round);
    expect(h.run("document.querySelector('#village-view').scrollTop")).toBe(175);expect(h.disk()).toEqual(disk);expect(h.writes()).toBe(writes);
    h.element('#garden-tend').onclick();expect(h.run('pipReaction')).toBeUndefined();expect(h.run('save.pip.growth')).toBe(0);
  });
  it('빈 꽃밭과 미복원/공사 중 연못에는 활동이 없고 오래된 클릭도 시작하지 않습니다',()=>{
    const empty=mainHarness(false,false,false,false,initial('ko',0));empty.run("switchView('village')");expect(empty.run('gardenActivitySpots()')).toBe('');empty.element('#garden-activity-flower').onclick();expect(empty.run('gardenActivity')).toBeUndefined();
    for(const phase of [0,1] as const){const h=mainHarness(false,false,false,false,initial('ko',1,phase));h.run("switchView('village')");h.element('#garden-area-pond').onclick();expect(h.run('gardenActivitySpots()')).toBe('');h.element('#garden-activity-ripples').onclick();expect(h.run('gardenActivity')).toBeUndefined();}
  });
  it('다음 복원 공간으로 바로 이동할 때 이전 꽃밭 교감과 핍 위치를 초기화합니다',()=>{
    const h=mainHarness(false,false,false,false,initial('ko',5,0));h.run("switchView('village')");h.element('#garden-activity-flower').onclick();expect(h.run('gardenActivity.kind')).toBe('flower');
    const disk=h.disk(),writes=h.writes();h.element('#garden-open-space').onclick();expect(h.run('selectedGardenArea')).toBe('pond');expect(h.run('gardenActivity')).toBeUndefined();expect(h.run('gardenVisitControls()')).toContain(t('ko','spaceVisitEmpty'));expect(h.disk()).toEqual(disk);expect(h.writes()).toBe(writes);
  });
  it.each(['base','alt'] as const)('%s 복원 연못은 연꽃과 물결의 대상/핍 위치를 바꾸고 재화·성장·저장을 보존합니다',style=>{
    const h=mainHarness(false,false,false,false,initial('ko',1,2,style));h.run("switchView('village')");h.element('#garden-area-pond').onclick();
    const disk=h.disk(),writes=h.writes(),round=h.run(roundState),value=h.run('JSON.stringify(save)');
    h.element('#garden-activity-lily').onclick();const lily=h.run('gardenVisitor()');expect(h.run('gardenVisitControls()')).toContain(t('ko','gardenLilyMoment'));
    h.element('#garden-activity-ripples').onclick();expect(h.run('gardenVisitor()')).not.toBe(lily);expect(h.run('gardenVisitControls()')).toContain(t('ko','gardenRippleMoment'));
    expect(h.run('gardenActivitySpots()')).toMatch(/id="garden-activity-ripples"[^>]*aria-pressed="true"/);
    expect(h.run('JSON.stringify(save)')).toBe(value);expect(h.run(roundState)).toBe(round);expect(h.disk()).toEqual(disk);expect(h.writes()).toBe(writes);
    h.element('#garden-space-'+(style==='base'?'alt':'base')).onclick();expect(h.run('spaceDialog.open')).toBe(true);expect(h.run('gardenActivity')).toBeUndefined();
  });
  it('모달·비활성·중복 처리·옛 DOM 입력을 막고 경로/체험 왕복에는 활동을 남기지 않습니다',()=>{
    for(const guard of ['document.hidden=true','nativeActive=false',"document.querySelector('#tutorial-dialog').open=true",'careProcessing=true','growing=true','boardPending=true',"document.querySelector('#garden-activity-flower').isConnected=false"]){
      const h=mainHarness(false,false,false,false,initial(),false);h.frame();h.run("switchView('village')");const before=h.disk(),writes=h.writes();h.run(guard);h.element('#garden-activity-flower').onclick();expect(h.run('gardenActivity'),guard).toBeUndefined();expect(h.disk()).toEqual(before);expect(h.writes()).toBe(writes);
    }
    const h=mainHarness(false,false,true,false,initial());h.run("switchView('village')");h.element('#garden-activity-flower').onclick();const stale=h.element('#garden-activity-flower').onclick;
    const disk=h.disk(),writes=h.writes(),before=h.run('JSON.stringify(save)'),round=h.run(roundState);
    h.run('enterCareDemo()');stale();expect(h.run('gardenActivity')).toBeUndefined();h.element('#grow').onclick();h.flushGrowth();h.element('#garden-activity-flower').onclick();expect(h.run('gardenActivity.kind')).toBe('flower');
    h.run('exitCareDemo()');expect(h.run('gardenActivity')).toBeUndefined();expect(h.run('JSON.stringify(save)')).toBe(before);expect(h.run(roundState)).toBe(round);expect(h.disk()).toEqual(disk);expect(h.writes()).toBe(writes);
    h.element('#garden-activity-flower').onclick();h.run("switchView('map')");expect(h.run('gardenActivity')).toBeUndefined();
  });
});

describe('후반 정원 공간과 확정 전 미리보기',()=>{
  it.each(['ko','en'] as const)('%s: 완성 쉼터/꽃아치는 별도 무료 활동·핍 위치/눈/꽃잎을 표시하고 회차와 저장을 보존합니다',language=>{
    const spaces=freshGardenSpaces();spaces.shelter.phase=2;spaces.arch.phase=2;
    const data={version:1,language,highestLevel:100,completed:Array.from({length:100},(_,i)=>i+1),coins:0,stars:0,garden:0,music:true,sfx:true,tutorialSeen:true,gardenDesign:{schema:1,flowers:Array(5).fill('meadow'),owned:[],placed:[],spaces}};
    const h=mainHarness(false,false,false,false,data);h.run("switchView('village')");const before=h.run('JSON.stringify({save,round,moves,score,board:scene.engine.board})'),disk=h.disk(),writes=h.writes();
    h.element('#garden-area-shelter').onclick();h.element('#garden-activity-rest').onclick();
    expect(h.run('gardenActivity.kind')).toBe('rest');expect(h.run('careIdlePose()')).toBe(true);expect(h.run('gardenVisitor()')).toContain('pip-idle-blink-v2.webp');expect(h.run('gardenVisitControls()')).toContain(t(language,'gardenRestMoment'));
    const same=h.run('gardenActivity');h.element('#garden-activity-rest').onclick();expect(h.run('gardenActivity')).toBe(same);const rest=h.run('gardenVisitor()');
    h.run('document.hidden=true');h.documentEvents.visibilitychange();expect(h.element('#garden-nature').dataset.momentActive).toBe('false');h.run('document.hidden=false');h.documentEvents.visibilitychange();expect(h.element('#garden-nature').dataset.momentActive).toBe('true');
    h.element('#garden-area-arch').onclick();expect(h.run('gardenActivity')).toBeUndefined();h.element('#garden-activity-arch').onclick();expect(h.run('gardenVisitor()')).not.toBe(rest);expect(h.run('gardenActivitySpots()')).toContain('garden-arch-petals');expect(h.run('gardenVisitControls()')).toContain(t(language,'gardenArchMoment'));
    expect(h.run('JSON.stringify({save,round,moves,score,board:scene.engine.board})')).toBe(before);expect(h.disk()).toEqual(disk);expect(h.writes()).toBe(writes);
    h.run("switchView('journal')");expect(h.run('gardenActivity')).toBeUndefined();expect(h.element('#garden-nature').dataset.momentActive).toBe('false');
  });
  it('기초/미복원 쉼터·꽃아치는 활동을 숨기고 체험 이전·모달·다른 구역 입력도 막습니다',()=>{
    for(const area of ['shelter','arch'] as const)for(const phase of [0,1,2] as const){
      const spaces=freshGardenSpaces();spaces[area].phase=phase;
      const data={version:1,language:'ko',highestLevel:100,completed:Array.from({length:100},(_,i)=>i+1),coins:0,stars:0,garden:0,music:true,sfx:true,tutorialSeen:true,gardenDesign:{schema:1,flowers:Array(5).fill('meadow'),owned:[],placed:[],spaces}};
      const h=mainHarness(false,false,true,false,data);h.run("switchView('village')");h.element('#garden-area-'+area).onclick();const kind=area==='shelter'?'rest':'arch',button=h.element('#garden-activity-'+kind),stale=button.onclick;
      if(phase<2){expect(h.run('gardenActivitySpots()')).toBe('');button.onclick();expect(h.run('gardenActivity')).toBeUndefined();continue;}
      h.run("document.querySelector('#tutorial-dialog').open=true");button.onclick();expect(h.run('gardenActivity')).toBeUndefined();h.run("document.querySelector('#tutorial-dialog').open=false");
      h.run('enterCareDemo()');stale();expect(h.run('gardenActivity')).toBeUndefined();h.run('exitCareDemo()');h.element('#garden-area-flowers').onclick();stale();expect(h.run('gardenActivity')).toBeUndefined();
    }
  });
  const initial=(language:'en'|'ko'='en',clears=100)=>({version:1,language,highestLevel:Math.min(100,clears+1),completed:Array.from({length:clears},(_,i)=>i+1),coins:2000,stars:100,garden:5,music:true,sfx:true,tutorialSeen:true,pip:{growth:100,affection:100,owned:[],equipped:'none'}});
  const roundState='JSON.stringify({round,currentLevel,moves,score,collected,board:scene.engine.board,inProgress:save.inProgress})';
  const open=(h:ReturnType<typeof mainHarness>)=>{h.element('#garden-area-pond').onclick();h.element('#garden-space-restore').onclick();expect(h.run('spaceDialog.open')).toBe(true);};
  it.each(['ko','en'] as const)('%s 다리 앞그림은 물결 뒤그림과 분리되고 미리보기·취소·무료 교감은 회차와 재화를 보존합니다',language=>{
    const spaces=freshGardenSpaces();spaces.pond={phase:2,altOwned:true,style:'alt'};
    const h=mainHarness(false,false,false,false,{...initial(language),gardenDesign:{schema:1,flowers:Array(5).fill('meadow'),owned:[],placed:[],spaces}});
    h.run("switchView('village')");h.element('#garden-area-pond').onclick();
    const disk=h.disk(),writes=h.writes(),round=h.run(roundState);h.element('#garden-activity-ripples').onclick();
    const html=h.run('gardenWorkshop(false)');expect(html.match(/data-garden-structure-image="bridge"/g)).toHaveLength(1);
    expect(html.indexOf('garden-activity-art')).toBeLessThan(html.indexOf('garden-structure-foreground'));
    expect(html).toContain('cx="355" cy="193"');expect(html).toContain('rx="48" ry="13"');
    h.element('#garden-space-base').onclick();expect(h.run('spaceDialog.innerHTML')).not.toContain('data-garden-structure-image="bridge"');
    h.element('#space-preview-current').onclick();const preview=h.run('spaceDialog.innerHTML');
    expect(preview.match(/data-garden-structure-image="bridge"/g)).toHaveLength(1);expect(preview).not.toContain('class="garden-structure-foreground"');
    h.element('#space-preview-cancel').onclick();expect(h.disk()).toEqual(disk);expect(h.writes()).toBe(writes);expect(h.run(roundState)).toBe(round);
  });
  it.each(['ko','en'] as const)('%s의4탭·큰 장면·현재/바뀔 모습 비교·취소는 저장/선택/회차를 보존하고 정상 확정만12별 씁니다',language=>{
    const h=mainHarness(false,false,false,false,initial(language,50));h.run("switchView('village');globalThis.spaceRound=scene;globalThis.spaceFocus=[];document.querySelector('#garden-space-restore').focus=options=>spaceFocus.push(options?.preventScroll)");
    expect(h.run('gardenWorkshop(false)')).toContain('data-renderer="painted-v4"');
    expect(h.run('gardenWorkshop(false)')).toContain('href="/assets/garden-v4/backdrop-meadow.webp"');
    const disk=h.disk(),writes=h.writes(),round=h.run(roundState);open(h);
    expect(h.run('otherModal()')).toBe(true);expect(h.run('spaceDialog.innerHTML')).toContain(t(language,'spacePreviewTitle'));expect(h.run('spaceDialog.innerHTML')).toContain('data-phase="1"');expect(h.run('spaceDialog.innerHTML')).toContain('id="preview-space-sky"');
    expect(h.run('spaceDialog.innerHTML')).toContain('data-renderer="painted-v4"');expect(h.run('spaceDialog.innerHTML')).toContain('href="/assets/garden-v4/backdrop-meadow.webp"');
    const previewControls=[...(h.run('spaceDialog.innerHTML') as string).matchAll(/<button id="(space-preview-[^"]+)"/g)].map(match=>match[1]);
    expect(previewControls).toEqual(['space-preview-current','space-preview-after','space-preview-confirm','space-preview-cancel']);
    expect(h.run('gardenWorkshop(false)')).toContain('data-renderer="painted-v4"');
    const staleConfirm=h.element('#space-preview-confirm').onclick;h.element('#space-preview-current').onclick();expect(h.run('spaceDialog.innerHTML')).toContain('data-phase="0"');h.element('#space-preview-after').onclick();
    expect(h.run('gardenWorkshop(false)')).not.toContain('data-plot=');expect(h.run('gardenWorkshop(false)')).not.toContain(' / 5</span>');expect(h.run('gardenWorkshop(false)')).toContain('data-area="pond"');
    expect(h.run('gardenWorkshop(false)').match(/class="garden-art garden-space-art"/g)).toHaveLength(1);
    h.element('#space-preview-cancel').onclick();staleConfirm();expect(h.run('spaceFocus')).toEqual([true]);expect(h.disk()).toEqual(disk);expect(h.writes()).toBe(writes);expect(h.run('selectedGardenArea')).toBe('pond');
    h.element('#garden-space-restore').onclick();const confirm=h.element('#space-preview-confirm').onclick;confirm();confirm();expect(h.stored().stars).toBe(88);expect(h.stored().coins).toBe(2000);expect(h.stored().gardenDesign.spaces.pond.phase).toBe(1);expect(h.run('spaceDialog.open')).toBe(false);expect(h.run(roundState)).toBe(round);expect(h.run('scene===spaceRound')).toBe(true);
    const reload=mainHarness(false,false,false,false,h.stored());reload.run("switchView('village')");reload.element('#garden-area-pond').onclick();expect(reload.run('gardenWorkshop(false)')).toContain('data-phase="1"');
    h.run("document.querySelector('#garden-area-pond').onkeydown({key:'End',preventDefault(){}})");expect(h.run('selectedGardenArea')).toBe('journey');h.run("document.querySelector('#garden-area-journey').onkeydown({key:'ArrowLeft',preventDefault(){}})");expect(h.run('selectedGardenArea')).toBe('arch');h.run("document.querySelector('#garden-area-arch').onkeydown({key:'ArrowLeft',preventDefault(){}})");expect(h.run('selectedGardenArea')).toBe('shelter');h.run("document.querySelector('#garden-area-shelter').onkeydown({key:'Home',preventDefault(){}})");expect(h.run('selectedGardenArea')).toBe('flowers');
  });
  it.each(['ko','en'] as const)('%s: 꽃밭 완성 뒤에는 유료 풍경 구입 없이도 다음 별 복원 공간으로 이어집니다',language=>{
    const h=mainHarness(false,false,false,false,initial(language,49));h.run("switchView('village')");
    expect(h.element('#village-view').innerHTML).toContain(t(language,'spaceNext'));
    expect(h.element('#village-view').innerHTML).toContain('id="garden-open-space"');
    const disk=h.disk(),writes=h.writes(),round=h.run(roundState),normal=h.run('JSON.stringify(save)');
    const openSpace=h.element('#garden-open-space').onclick;openSpace();
    expect(h.run('selectedGardenArea')).toBe('pond');expect(h.run('route')).toBe('village');
    expect(h.element('#village-view').innerHTML).toContain('data-space="pond"');
    expect(h.element('#village-view').innerHTML).not.toContain('id="garden-open-space"');
    h.run("switchView('puzzle')");openSpace();expect(h.run('route')).toBe('puzzle');
    expect(h.run('JSON.stringify(save)')).toBe(normal);expect(h.run(roundState)).toBe(round);
    expect(h.disk()).toEqual(disk);expect(h.writes()).toBe(writes);
  });
  it('완료/별/코인 부족도 미리보기는 보이고 확정은 차단하며 재플레이 수입을 안내하지 않습니다',()=>{
    for(const reason of ['clears','stars','coins']){
      const data=initial('en',reason==='clears'?49:100);if(reason==='stars')data.stars=11;if(reason==='coins')data.coins=239;
      const h=mainHarness(false,false,true,false,data);h.run("switchView('village')");
      if(reason==='clears'){h.run("startLevel(50,true);finish(true);document.querySelector('#result-dialog').close();switchView('village')");expect(h.run('gardenCompletedCount()')).toBe(49);}
      h.element('#garden-area-pond').onclick();
      if(reason==='coins'){for(let i=0;i<2;i++){h.element('#garden-space-restore').onclick();h.element('#space-preview-confirm').onclick();}h.element('#garden-space-alt').onclick();}else h.element('#garden-space-restore').onclick();
      expect(h.run('spaceDialog.open')).toBe(true);const before=h.run('JSON.stringify(save)'),primary=h.run("localStorage.getItem('pawblossom.save.v1')");
      const copy=h.run('spaceDialog.innerHTML');expect(copy).toMatch(/id="space-preview-confirm"[^>]*disabled/);expect(copy).toContain(t('en',reason==='clears'?'spaceNeedClears':reason==='stars'?'spaceNeedStars':'spaceNeedCoins').split('{')[0]);
      h.element('#space-preview-confirm').onclick();expect(h.run('JSON.stringify(save)')).toBe(before);expect(h.run("localStorage.getItem('pawblossom.save.v1')")).toBe(primary);
    }
  });
  it('미리보기는 배경 돌보기/복원을 막고 ESC·뒤로·언어·경로·비활성·다른모달·오래된 DOM에서 소비하지 않습니다',()=>{
    for(const boundary of ['escape','back','language','route','hidden','native','blur','otherModal','stale','generation','save']){
      const h=mainHarness(false,false,true,true,initial());h.run("nativeActive=true;switchView('village')");const oldGrow=h.element('#grow').onclick,oldFeed=h.element('#pip-feed').onclick;open(h);
      const confirm=h.element('#space-preview-confirm').onclick,stars=h.run('save.stars'),coins=h.run('save.coins');oldGrow();oldFeed();expect(h.run('save.stars')).toBe(stars);expect(h.run('save.coins')).toBe(coins);
      if(boundary==='escape')h.run('spaceDialog.listeners.cancel({preventDefault(){}})');
      else if(boundary==='back')h.nativeEvents.backButton({isActive:true});
      else if(boundary==='language')h.run("changeLanguage('ko')");
      else if(boundary==='route')h.run("switchView('journal')");
      else if(boundary==='hidden'){h.run('document.hidden=true');h.documentEvents.visibilitychange();}
      else if(boundary==='native')h.nativeEvents.appStateChange({isActive:false});
      else if(boundary==='blur')h.windowEvents.blur();
      else if(boundary==='otherModal')h.run("document.querySelector('#tutorial-dialog').showModal();syncActivity()");
      else if(boundary==='stale')h.run("document.querySelector('#garden-space-restore').isConnected=false");
      else if(boundary==='generation')h.run('careGeneration++;syncActivity()');
      else h.run('save=loadSave();syncActivity()');
      confirm();expect(h.run('save.stars')).toBe(stars);expect(h.run('save.coins')).toBe(coins);expect(h.run('save.gardenDesign?.spaces')).toBeUndefined();
    }
  });
  it('backup/primary 쓰기 실패와 충돌은 자원·단계·메모리 원본을 확정하지 않습니다',()=>{
    for(const failure of ['backup','primary','conflict'])for(const style of [false,true]){
      const spaces=freshGardenSpaces();spaces.pond.phase=2;
      const data={...initial(),...(style?{gardenDesign:{schema:1,flowers:Array(5).fill('meadow'),owned:[],placed:[],spaces}}:{})};
      const h=mainHarness(false,false,false,false,data);h.run("switchView('village');globalThis.spaceSaveBefore=save");
      if(style){h.element('#garden-area-pond').onclick();h.element('#garden-space-alt').onclick();expect(h.run('spaceDialog.open')).toBe(true);}else open(h);
      if(failure==='conflict')h.run("localStorage.setItem('pawblossom.save.v1',JSON.stringify({...save,coins:1900}))");
      else h.run("const spaceSet=localStorage.setItem;localStorage.setItem=(key,value)=>{if(key==='pawblossom.save."+(failure==='primary'?'v1':'v1.backup')+"')throw Error('blocked');spaceSet(key,value)}");
      const primary=h.run("localStorage.getItem('pawblossom.save.v1')"),design=h.run('JSON.stringify(save.gardenDesign)');h.element('#space-preview-confirm').onclick();expect(h.run('save===spaceSaveBefore')).toBe(true);expect(h.run('save.stars')).toBe(100);expect(h.run('save.coins')).toBe(2000);expect(h.run('JSON.stringify(save.gardenDesign)')).toBe(design);expect(h.run("localStorage.getItem('pawblossom.save.v1')")).toBe(primary);
    }
  });
  it('체험은 원래 구역/꽃칸·정상 저장·회차를 복원하고 핍의 다음 core 목표는 유료 풍경과 독립입니다',()=>{
    const h=mainHarness(false,false,true,false,initial('ko',49));h.run("switchView('village');selectedGardenPlot=3;renderViews()");h.element('#garden-area-shelter').onclick();const disk=h.disk(),normal=h.run('JSON.stringify(save)'),round=h.run(roundState);expect(h.run('enterCareDemo()')).toBe(true);expect(h.run('selectedGardenArea')).toBe('flowers');expect(h.run('gardenCompletedCount()')).toBe(100);
    h.element('#garden-area-arch').onclick();h.element('#garden-space-restore').onclick();expect(h.run('spaceDialog.innerHTML')).toContain(t('ko','spaceDemo'));h.element('#space-preview-cancel').onclick();expect(h.run('exitCareDemo()')).toBe(true);expect(h.run('selectedGardenArea')).toBe('shelter');expect(h.run('selectedGardenPlot')).toBe(3);expect(h.run('JSON.stringify(save)')).toBe(normal);expect(h.run(roundState)).toBe(round);expect(h.disk()).toEqual(disk);
    h.run("switchView('journal')");expect(h.element('#journal-view').innerHTML).toContain(t('ko','goalPlan'));expect(h.element('#journal-view').innerHTML.match(/id="journal-plan-title"/g)).toHaveLength(1);h.element('#pip-open-space').onclick();expect(h.run('selectedGardenArea')).toBe('pond');expect(h.run('route')).toBe('village');expect(h.disk()).toEqual(disk);
    const css=read('../src/style.css');expect(css).toContain('grid-template-columns:repeat(4,minmax(0,1fr))');expect(css).toContain('.garden-area-tabs button{min-width:0;min-height:44px');expect(css).toContain('#garden-space-dialog{width:min(500px,calc(100vw - 24px));max-height:calc(100dvh - 24px);overflow:auto}');
  });
});


describe('퍼즐 밖 보드 그리기 수명',()=>{
  it('현재 보드만 경로에 따라 숨기며 퍼즐 모달·회차·지갑·저장은 유지합니다',()=>{
    const h=mainHarness(false,false,false,false,undefined,true,undefined,undefined,true);
    const before=h.run('JSON.stringify({save,round,currentLevel,moves,score,board:scene.engine.board})'),disk=h.disk(),writes=h.writes();
    expect(h.run('game.scene.board.sys.settings.visible')).toBe(false);
    h.run("switchView('puzzle')");expect(h.run('game.scene.board.sys.settings.visible')).toBe(true);
    h.run("showStagePreview(currentLevel,'restart',document.querySelector('#restart'))");
    expect(h.run('game.paused')).toBe(true);expect(h.run('game.scene.board.sys.settings.visible')).toBe(true);
    h.run('closeStagePreview()');expect(h.run('game.scene.board.sys.settings.visible')).toBe(true);
    for(const route of ['village','journal','settings','map']){h.run(`switchView('${route}')`);expect(h.run('game.scene.board.sys.settings.visible')).toBe(false);}
    h.run("switchView('puzzle')");expect(h.run('game.scene.board.sys.settings.visible')).toBe(true);
    expect(h.run('JSON.stringify({save,round,currentLevel,moves,score,board:scene.engine.board})')).toBe(before);
    expect(h.disk()).toEqual(disk);expect(h.writes()).toBe(writes);
  });
  it('등록 전 교체 대기를 막지 않고 새 Scene의 CREATE 뒤 현재 경로를 반영합니다',()=>{
    const h=mainHarness(false,false,false,false,undefined,true,undefined,undefined,true);
    const old=h.run('game.scene.board');
    h.run('game.scene.isBooted=false;startLevel(1)');expect(h.run('boardPending')).toBe(true);
    expect(h.run('game.scene.board')).toBe(old);expect(h.run('game.scene.board.sys.settings.visible')).toBe(false);
    h.run('game.scene.isBooted=true;replaceBoard()');expect(h.run('boardPending')).toBe(false);
    expect(h.run('game.scene.board')).not.toBe(old);expect(h.run('game.scene.board===scene')).toBe(true);
    expect(h.run('game.scene.board.sys.settings.visible')).toBe(false);
    h.run("switchView('puzzle')");expect(h.run('game.scene.board.sys.settings.visible')).toBe(true);
    expect(h.element('#game-canvas').tabIndex).toBe(0);
  });
});

describe('퍼즐 핍 idle 표시 수명',()=>{
  it('반응은 내부 슬롯을 쓰며 지도 재생성도 외곽header·회차·지갑·저장 쓰기를 바꾸지 않습니다',()=>{
    const h=mainHarness(false,false,false,false,undefined,true,undefined,undefined,true);
    const header=h.element('#header-pip'),face=h.element('#header-pip-face');
    expect(h.run('boardFeedback.options.pip===document.querySelector("#header-pip-face")')).toBe(true);
    expect(h.run('boardFeedback.options.pip===document.querySelector("#header-pip")')).toBe(false);
    const before=h.run('JSON.stringify({save,round,currentLevel,moves,score,board:scene.engine.board})'),disk=h.disk(),writes=h.writes();
    const map=h.element('#map-view').innerHTML;
    expect(map.match(/id="map-current-pip"/g)).toHaveLength(1);expect(map.match(/class="campaign-leaf"/g)).toHaveLength(4);
    expect(map.match(/class="campaign-node /g)).toHaveLength(LEVEL_COUNT);
    h.run("renderViews();switchView('puzzle');renderViews();switchView('map')");
    expect(h.element('#header-pip')).toBe(header);expect(h.element('#header-pip-face')).toBe(face);
    expect(h.pipControllers.filter(controller=>controller.pip===header)).toHaveLength(1);
    expect(h.pipControllers.find(controller=>controller.pip===header)!.disposed).toBe(false);
    expect(h.run('JSON.stringify({save,round,currentLevel,moves,score,board:scene.engine.board})')).toBe(before);
    expect(h.disk()).toEqual(disk);expect(h.writes()).toBe(writes);
  });
  it('지도DOM 교체 전에 이전 controller를 dispose하고 새 호스트에만 현재 활동을 반영합니다',()=>{
    const h=mainHarness(false,false,false,false,undefined,true,undefined,undefined,true);
    const liveMap=()=>h.pipControllers.filter(controller=>controller.pip.id==='map-current-pip'&&!controller.disposed);
    expect(liveMap()).toHaveLength(1);const previous=liveMap()[0];h.pipLifecycle.length=0;
    h.run('renderViews()');
    expect(h.pipLifecycle.slice(0,2)).toEqual(['dispose:map-current-pip:true','map-replace']);
    expect(previous.disposals).toBe(1);expect(previous.pip.isConnected).toBe(false);expect(liveMap()).toHaveLength(1);
    expect(liveMap()[0].pip).not.toBe(previous.pip);expect(liveMap()[0].pip.dataset.idleActive).toBe('true');
    const cached=liveMap()[0];h.run("switchView('puzzle');renderViews()");expect(liveMap()).toHaveLength(1);expect(liveMap()[0]).toBe(cached);expect(cached.pip.dataset.idleActive).toBe('false');
    h.run("switchView('map')");expect(liveMap()).toHaveLength(1);
    const map=liveMap()[0];h.windowEvents.pagehide();expect(map.disposed).toBe(false);
  });
  it('지도 motion은 모달·숨김·nativeInactive·다른경로에서 정지하고 종료 뒤 지도에서도 복귀합니다',()=>{
    const h=mainHarness(false,false,true,true,undefined,true,undefined,undefined,true);
    const active=()=>{const value=h.element('#map-view').dataset.motionActive;expect(h.sceneryControllers.filter(c=>!c.disposed)).toHaveLength(1);expect(h.sceneryControllers.find(c=>!c.disposed)!.active).toBe(value==='true');return value;};
    expect(active()).toBe('false');h.nativeEvents.appStateChange({isActive:true});expect(active()).toBe('true');
    h.element('#map-play').onclick();expect(active()).toBe('false');h.element('#preview-cancel').onclick();expect(active()).toBe('true');
    for(const dialog of ['tutorial-dialog','result-dialog','test-level-dialog']){
      h.run(`document.querySelector('#${dialog}').open=true;syncActivity()`);expect(active()).toBe('false');
      h.run(`document.querySelector('#${dialog}').open=false;syncActivity()`);expect(active()).toBe('true');
    }
    h.run('document.hidden=true');h.documentEvents.visibilitychange();expect(active()).toBe('false');
    h.run('document.hidden=false');h.documentEvents.visibilitychange();expect(active()).toBe('true');
    h.nativeEvents.appStateChange({isActive:false});expect(active()).toBe('false');
    h.nativeEvents.appStateChange({isActive:true});expect(active()).toBe('true');
    expect(h.run("boardPending=true;syncActivity();document.querySelector('#map-view').dataset.motionActive")).toBe('false');
    h.run("boardPending=false;roundEnded=true;syncActivity()");expect(active()).toBe('true');
    h.run("switchView('settings')");expect(active()).toBe('false');h.run("switchView('map')");expect(active()).toBe('true');
    expect(h.element('#header-pip').dataset.idleActive).toBe('false');
  });
  it.each([true,false])('승패 %s 정산부터 결과창 전300ms에도 idle을 즉시 멈춥니다',won=>{
    const h=mainHarness();h.run('startLevel(1)');expect(h.element('#header-pip').dataset.idleActive).toBe('true');
    h.run(won?'scene.hooks.onMove([12,10,0,0,0,0],220)':'moves=1;scene.hooks.onMove([0,0,0,0,0,0],0)');
    expect(h.run('roundEnded')).toBe(true);expect(h.run('resultShown')).toBe(false);
    expect(h.resultTimers()).toHaveLength(1);expect(h.element('#header-pip').dataset.idleActive).toBe('false');
  });
  it('지도/설정/모달/숨김/종료 상태에서는 멈추고 실제 퍼즐 복귀에서만 재개합니다',()=>{
    const h=mainHarness(false,false,false,false,undefined,true,undefined,undefined,true);
    const active=()=>h.element('#header-pip').dataset.idleActive;
    expect(active()).toBe('false');h.run("switchView('puzzle')");expect(active()).toBe('true');
    h.run("switchView('settings')");expect(active()).toBe('false');h.run("switchView('puzzle')");expect(active()).toBe('true');
    h.run('document.hidden=true');h.documentEvents.visibilitychange();expect(active()).toBe('false');
    h.run('document.hidden=false');h.documentEvents.visibilitychange();expect(active()).toBe('true');
    h.run("showStagePreview(currentLevel,'restart',document.querySelector('#restart'))");expect(active()).toBe('false');
    h.run('closeStagePreview()');expect(active()).toBe('true');
    expect(h.run("boardPending=true;syncActivity();document.querySelector('#header-pip').dataset.idleActive")).toBe('false');
    h.run('boardPending=false;roundEnded=true;syncActivity()');expect(active()).toBe('false');
  });
});

describe('정원·돌봄의 표시 전용 관절과 착용 슬롯',()=>{
  const initial=()=>({version:1,language:'ko',highestLevel:2,completed:[1],stars:10,coins:200,garden:2,music:true,sfx:true,tutorialSeen:true,
    pip:{growth:60,affection:60,owned:['ribbon'],equipped:'ribbon'}});
  const boot=(native=false,tools=false)=>mainHarness(false,false,tools,native,initial(),true,undefined,undefined,true);
  const liveCare=(h:ReturnType<typeof boot>)=>h.pipControllers.filter(controller=>/^(village|journal)-pip-actor$/.test(controller.pip.id)&&!controller.disposed);
  const liveArt=(h:ReturnType<typeof boot>)=>h.accessoryControllers.filter(controller=>!controller.disposed);
  const snapshot='JSON.stringify({save,round,currentLevel,moves,score,board:scene.engine.board})';

  it('재렌더 없는 journal 진입과 actor 왕복에 한 controller·소품만 연결하고 회차·저장·스크롤을 보존합니다',()=>{
    const h=boot(),before=h.run(snapshot),disk=h.disk(),writes=h.writes();
    const journal=h.element('#journal-view').innerHTML;h.element('#journal-view').scrollTop=211;h.element('#village-view').scrollTop=173;
    h.run("switchView('journal')");expect(h.element('#journal-view').innerHTML).toBe(journal);
    expect(liveCare(h)).toHaveLength(1);expect(liveCare(h)[0]).toMatchObject({alignment:'center',pip:{id:'journal-pip-actor'}});
    expect(liveArt(h)).toHaveLength(1);expect(liveArt(h)[0]).toMatchObject({kind:'ribbon',slot:{id:'journal-pip-accessory'}});
    expect(h.element('#journal-pip-image').getAttribute('src')).toBe('/assets/pip-idle-open-v2.webp');
    h.run("switchView('village')");expect(liveCare(h)).toHaveLength(1);expect(liveCare(h)[0]).toMatchObject({alignment:'bottom',pip:{id:'village-pip-actor'}});
    const previous=liveCare(h)[0];h.pipLifecycle.length=0;h.run('renderViews()');
    expect(previous.disposed).toBe(true);expect(previous.pip.isConnected).toBe(false);
    expect(h.pipLifecycle.indexOf('dispose:village-pip-actor:true')).toBeLessThan(h.pipLifecycle.indexOf('village-replace'));
    expect(h.pipLifecycle.indexOf('accessory-dispose:village-pip-accessory:true')).toBeLessThan(h.pipLifecycle.indexOf('village-replace'));
    const renderedJournal=h.element('#journal-view').innerHTML;h.run("switchView('journal')");expect(h.element('#journal-view').innerHTML).toBe(renderedJournal);
    expect(liveCare(h)).toHaveLength(1);expect(liveArt(h)).toHaveLength(1);
    expect(h.element('#journal-view').scrollTop).toBe(211);expect(h.element('#village-view').scrollTop).toBe(173);
    expect(h.run(snapshot)).toBe(before);expect(h.disk()).toEqual(disk);expect(h.writes()).toBe(writes);
  });
  it.each(['feed','play','greet','tend'] as const)('%s pose와 기존2400ms를 우선하고 표시 동기화는 타이머·착용·지급을 다시 만들지 않습니다',kind=>{
    const h=boot();h.run("switchView('journal')");h.element('#pip-'+kind).onclick();
    expect(h.run('pipReaction')).toBe(kind);const timer=h.run('careReactionTimer'),after=h.run(snapshot),disk=h.disk(),writes=h.writes();
    expect(liveCare(h)[0].pip.dataset.idleActive).toBe('false');expect(liveArt(h)[0].slot.dataset.artActive).toBe('false');
    expect(h.element('#journal-pip-image').getAttribute('src')).toBe(kind==='feed'?'/assets/pip-feed-v1.webp':kind==='play'?'/assets/pip-play-v1.webp':kind==='tend'?'/assets/pip-idle-open-v2.webp':'/assets/pip.png');
    expect(liveArt(h)[0].kind).toBe(kind==='tend'?'wateringCan':'ribbon');expect(h.run('save.pip.equipped')).toBe('ribbon');
    h.run('syncActivity();syncPipActivity()');h.run('document.hidden=true');h.documentEvents.visibilitychange();h.run('document.hidden=false');h.documentEvents.visibilitychange();
    expect(h.run('careReactionTimer')).toBe(timer);expect(h.run(snapshot)).toBe(after);expect(h.disk()).toEqual(disk);expect(h.writes()).toBe(writes);
    h.flushCareReaction();expect(h.run('pipReaction')).toBeUndefined();expect(h.run('careReactionTimer')).toBeUndefined();
    expect(liveCare(h)[0].pip.dataset.idleActive).toBe('true');expect(liveArt(h)[0].kind).toBe('ribbon');
    expect(h.element('#journal-pip-image').getAttribute('src')).toBe('/assets/pip-idle-open-v2.webp');expect(h.disk()).toEqual(disk);expect(h.writes()).toBe(writes);
  });
  it.each(['journal','village'] as const)('%s 물주기는 기본 idle 그림을 유지하지만 대기 관절과 착용 모션은 재개하지 않습니다',view=>{
    const h=boot();h.run(`switchView('${view}')`);const image=`#${view}-pip-image`,before=h.element(image).getAttribute('src'),disk=h.disk(),writes=h.writes();
    expect(before).toBe('/assets/pip-idle-open-v2.webp');h.element(view==='journal'?'#pip-tend':'#garden-tend').onclick();
    expect(h.element(image).getAttribute('src')).toBe(before);expect(liveCare(h)[0].pip.dataset.idleActive).toBe('false');expect(liveArt(h)[0].slot.dataset.artActive).toBe('false');
    expect(h.run('pipReaction')).toBe('tend');const timer=h.run('careReactionTimer');h.run('syncCarePipActivity()');expect(h.run('careReactionTimer')).toBe(timer);
    h.flushCareReaction();expect(h.element(image).getAttribute('src')).toBe(before);expect(liveCare(h)[0].pip.dataset.idleActive).toBe('true');
    expect(h.disk()).toEqual(disk);expect(h.writes()).toBe(writes);
  });
  it('무료 활동과 성장 중에는 기존 위치·pose를 보이고450ms 종료는 DOM 교체나 추가 소비 없이 표시만 재개합니다',()=>{
    const h=boot();h.run("switchView('village')");const before=h.run(snapshot),disk=h.disk(),writes=h.writes();
    h.element('#garden-activity-flower').onclick();expect(h.run('gardenActivity.kind')).toBe('flower');
    expect(liveCare(h)[0].pip.dataset.idleActive).toBe('false');expect(h.element('#village-pip-image').getAttribute('src')).toBe('/assets/pip.png');
    expect(h.run(snapshot)).toBe(before);expect(h.disk()).toEqual(disk);expect(h.writes()).toBe(writes);
    h.element('#garden-plot-1').onclick();expect(h.run('gardenActivity')).toBeUndefined();expect(liveCare(h)[0].pip.dataset.idleActive).toBe('true');
    h.element('#grow').onclick();expect(h.run('growing')).toBe(true);expect(liveCare(h)[0].pip.dataset.idleActive).toBe('false');
    const actor=liveCare(h)[0],after=h.run(snapshot),grownDisk=h.disk(),grownWrites=h.writes(),replacements=h.pipLifecycle.filter(event=>event==='village-replace').length;
    expect(h.element('#village-pip-image').getAttribute('src')).toBe('/assets/pip.png');h.flushGrowth();
    expect(h.run('growing')).toBe(false);expect(liveCare(h)[0]).toBe(actor);expect(actor.pip.dataset.idleActive).toBe('true');
    expect(h.element('#village-pip-image').getAttribute('src')).toBe('/assets/pip-idle-open-v2.webp');
    expect(h.pipLifecycle.filter(event=>event==='village-replace')).toHaveLength(replacements);
    expect(h.run(snapshot)).toBe(after);expect(h.disk()).toEqual(grownDisk);expect(h.writes()).toBe(grownWrites);
  });
  it('모달·숨김·nativeInactive는 일시 정지만 하고 첫 비활성 화면에 controller를 추가하지 않습니다',()=>{
    const h=boot(true,true);h.run("switchView('village')");expect(liveCare(h)).toHaveLength(0);expect(liveArt(h)).toHaveLength(0);
    h.nativeEvents.appStateChange({isActive:true});const actor=liveCare(h)[0],art=liveArt(h)[0],before=h.run(snapshot),disk=h.disk(),writes=h.writes();
    const active=()=>[actor.pip.dataset.idleActive,art.slot.dataset.artActive];expect(active()).toEqual(['true','true']);
    h.nativeEvents.appStateChange({isActive:false});expect(active()).toEqual(['false','false']);h.nativeEvents.appStateChange({isActive:true});expect(active()).toEqual(['true','true']);
    h.run('document.hidden=true');h.documentEvents.visibilitychange();expect(active()).toEqual(['false','false']);
    h.run('document.hidden=false');h.documentEvents.visibilitychange();expect(active()).toEqual(['true','true']);
    h.element('#stars-help').onclick();expect(active()).toEqual(['false','false']);h.element('#resource-help-close').onclick();expect(active()).toEqual(['true','true']);
    h.run("document.querySelector('#tutorial-dialog').open=true;syncActivity()");expect(active()).toEqual(['false','false']);
    h.run("document.querySelector('#tutorial-dialog').open=false;syncActivity()");expect(active()).toEqual(['true','true']);
    h.run("switchView('settings')");expect(active()).toEqual(['false','false']);expect(actor.disposed).toBe(false);expect(art.disposed).toBe(false);
    h.run("switchView('journal')");expect(actor.disposed).toBe(true);expect(art.disposed).toBe(true);expect(liveCare(h)).toHaveLength(1);expect(liveArt(h)).toHaveLength(1);
    expect(h.run(snapshot)).toBe(before);expect(h.disk()).toEqual(disk);expect(h.writes()).toBe(writes);
  });
  it('체험의 actor도 움직이지만 종료·언어 재생성 뒤 이전 소유자는 정상 host·착용·저장을 되살리지 못합니다',()=>{
    const h=boot(false,true);h.run("switchView('journal');globalThis.oldCareIdle=carePipDisplay.idle;globalThis.oldCareArt=carePipDisplay.accessory");
    const before=h.run(snapshot),disk=h.disk(),writes=h.writes(),old=liveCare(h)[0];
    h.run('enterCareDemo()');expect(old.disposed).toBe(true);expect(liveCare(h)).toHaveLength(1);expect(liveCare(h)[0].pip.dataset.idleActive).toBe('true');expect(liveArt(h)).toHaveLength(0);
    h.run('exitCareDemo();oldCareIdle.setActive(true);oldCareArt.setActive(true)');
    expect(liveCare(h)).toHaveLength(1);expect(liveArt(h)).toHaveLength(1);expect(old.pip.dataset.idleActive).toBeUndefined();
    expect(h.run(snapshot)).toBe(before);expect(h.disk()).toEqual(disk);expect(h.writes()).toBe(writes);
    const actor=liveCare(h)[0];h.run("changeLanguage('en')");expect(actor.disposed).toBe(true);expect(liveCare(h)).toHaveLength(1);expect(liveArt(h)).toHaveLength(1);
    expect(h.run('save.pip.equipped')).toBe('ribbon');expect(h.run('save.coins')).toBe(200);
  });
});

describe('현재 정원 그림의 자연 모션 연결과 수명',()=>{
  const initial=()=>({version:1,language:'ko',highestLevel:2,completed:[1],stars:10,coins:200,garden:2,music:true,sfx:true,tutorialSeen:true,
    pip:{growth:60,affection:60,owned:['ribbon'],equipped:'ribbon'},gardenDesign:{schema:1,flowers:['daisy','violet','meadow','meadow','meadow'],owned:['butterflies'],placed:['butterflies']}});
  const boot=(native=false,tools=false)=>mainHarness(false,false,tools,native,initial(),true,undefined,undefined,true);
  const live=(h:ReturnType<typeof boot>)=>h.natureControllers.filter(controller=>!controller.disposed);
  const snapshot='JSON.stringify({save,round,currentLevel,moves,score,board:scene.engine.board})';
  it('실제 village 그림 한 곳만 소유하고 native·hidden·모달은 같은 controller를 비활성화합니다',()=>{
    const h=boot(true);expect(live(h)).toHaveLength(0);expect(h.element('#village-view').innerHTML).toContain('id="garden-nature"');
    h.run("switchView('village')");expect(live(h)).toHaveLength(0);h.nativeEvents.appStateChange({isActive:true});
    const nature=live(h)[0],before=h.run(snapshot),disk=h.disk(),writes=h.writes();expect(live(h)).toHaveLength(1);expect(nature.picture).toBe(h.element('#garden-nature'));expect(nature.picture.dataset.natureActive).toBe('true');
    h.run('syncActivity();syncCarePipActivity()');expect(live(h)).toEqual([nature]);
    h.nativeEvents.appStateChange({isActive:false});expect(nature.picture.dataset.natureActive).toBe('false');h.nativeEvents.appStateChange({isActive:true});
    h.run('document.hidden=true');h.documentEvents.visibilitychange();expect(nature.picture.dataset.natureActive).toBe('false');h.run('document.hidden=false');h.documentEvents.visibilitychange();
    h.element('#stars-help').onclick();expect(nature.picture.dataset.natureActive).toBe('false');h.element('#resource-help-close').onclick();expect(nature.picture.dataset.natureActive).toBe('true');
    expect(live(h)).toEqual([nature]);expect(h.run(snapshot)).toBe(before);expect(h.disk()).toEqual(disk);expect(h.writes()).toBe(writes);
  });
  it('경로 이탈은 nature만 폐기하고 같은 host 복귀에는 기존 Pip/착용 cache와 새 nature를 사용합니다',()=>{
    const h=boot();h.run("switchView('village')");const old=live(h)[0],pip=h.run('carePipDisplay.idle'),art=h.run('carePipDisplay.accessory'),picture=old.picture,before=h.run(snapshot),disk=h.disk(),writes=h.writes();
    h.run("switchView('settings')");expect(old.disposed).toBe(true);expect(old.disposals).toBe(1);expect(live(h)).toHaveLength(0);
    expect(h.run('carePipDisplay.idle')).toBe(pip);expect(h.run('carePipDisplay.accessory')).toBe(art);expect(h.run('carePipDisplay.nature')).toBeUndefined();
    h.run("route='village';document.querySelector('#village-view').hidden=false;syncActivity()");const fresh=live(h)[0];expect(fresh).not.toBe(old);expect(fresh.picture).toBe(picture);
    expect(h.run('carePipDisplay.idle')).toBe(pip);expect(h.run('carePipDisplay.accessory')).toBe(art);old.activations.length=0;
    h.run("switchView('journal')");expect(fresh.disposed).toBe(true);expect(live(h)).toHaveLength(0);expect(old.activations).toEqual([]);
    expect(h.run(snapshot)).toBe(before);expect(h.disk()).toEqual(disk);expect(h.writes()).toBe(writes);
  });
  it('DOM 교체 전에 폐기하며 옛 자연 controller와 분리된 picture를 다시 활성화하지 않습니다',()=>{
    const h=boot();h.run("switchView('village')");const old=live(h)[0];h.pipLifecycle.length=0;h.run('renderViews()');
    expect(old.disposed).toBe(true);expect(old.picture.isConnected).toBe(false);expect(h.pipLifecycle.indexOf('nature-dispose:garden-nature:true')).toBeLessThan(h.pipLifecycle.indexOf('village-replace'));
    const current=live(h)[0];expect(live(h)).toHaveLength(1);expect(current.picture).not.toBe(old.picture);
    current.picture.isConnected=false;const actor=h.run('carePipDisplay.idle');h.run('syncCarePipActivity()');expect(current.disposed).toBe(true);expect(live(h)).toHaveLength(0);expect(h.run('carePipDisplay.idle')).toBe(actor);
  });
  it.each(['careProcessing','growing','boardPending','busy-scene'] as const)('%s는 추가 생성·저장 없이 현재 모션만 끕니다',guard=>{
    const h=mainHarness(false,false,false,false,initial(),false,undefined,undefined,true);h.frame();h.run("switchView('village')");const nature=live(h)[0],count=h.natureControllers.length,before=h.run(snapshot),disk=h.disk(),writes=h.writes();
    h.run(guard==='busy-scene'?'scene.canLeave=()=>false;syncCarePipActivity()':`${guard}=true;syncCarePipActivity()`);expect(nature.picture.dataset.natureActive).toBe('false');
    h.run(guard==='busy-scene'?'scene.canLeave=()=>true;syncCarePipActivity()':`${guard}=false;syncCarePipActivity()`);expect(nature.picture.dataset.natureActive).toBe('true');
    expect(h.natureControllers).toHaveLength(count);expect(live(h)).toEqual([nature]);expect(h.run(snapshot)).toBe(before);expect(h.disk()).toEqual(disk);expect(h.writes()).toBe(writes);
  });
  it('핍2400ms 반응·무료 활동과450ms 성장이 우선하고 종료는 기존 표시 소유자만 재개합니다',()=>{
    const h=boot();h.run("switchView('village')");const disk=h.disk(),writes=h.writes(),before=h.run(snapshot);
    h.element('#garden-activity-flower').onclick();expect(live(h)[0].picture.dataset.natureActive).toBe('false');expect(h.run('gardenActivity.kind')).toBe('flower');
    expect(h.run(snapshot)).toBe(before);expect(h.disk()).toEqual(disk);expect(h.writes()).toBe(writes);h.element('#garden-plot-1').onclick();expect(live(h)[0].picture.dataset.natureActive).toBe('true');
    h.element('#garden-visit').onclick();const reaction=h.run('careReactionTimer');expect(live(h)[0].picture.dataset.natureActive).toBe('false');h.run('syncActivity();syncCarePipActivity()');expect(h.run('careReactionTimer')).toBe(reaction);
    h.flushCareReaction();expect(live(h)[0].picture.dataset.natureActive).toBe('true');h.element('#grow').onclick();const nature=live(h)[0],after=h.run(snapshot),grown=h.disk(),grownWrites=h.writes();
    expect(nature.picture.dataset.natureActive).toBe('false');h.flushGrowth();expect(live(h)).toEqual([nature]);expect(nature.picture.dataset.natureActive).toBe('true');
    expect(h.run(snapshot)).toBe(after);expect(h.disk()).toEqual(grown);expect(h.writes()).toBe(grownWrites);
  });
  it('수련·물결 선택이 모션보다 우선하며 미리보기 동안 정지하고 취소 뒤 재개합니다',()=>{
    const spaces=freshGardenSpaces();spaces.pond={phase:2,altOwned:true,style:'alt'};
    const h=mainHarness(false,false,false,false,{...initial(),highestLevel:61,completed:Array.from({length:60},(_,i)=>i+1),garden:5,gardenDesign:{...initial().gardenDesign,spaces}},true,undefined,undefined,true);
    h.run("switchView('village')");h.element('#garden-area-pond').onclick();const before=h.run(snapshot),disk=h.disk(),writes=h.writes();
    h.element('#garden-activity-lily').onclick();expect(live(h)[0].picture.dataset.natureActive).toBe('false');expect(h.run('gardenActivity.kind')).toBe('lily');
    h.element('#garden-activity-ripples').onclick();expect(live(h)[0].picture.dataset.natureActive).toBe('false');expect(h.run('gardenActivity.kind')).toBe('ripples');
    expect(h.run('gardenActivitySpots()')).toContain('cx="355" cy="193"');expect(h.run('gardenWorkshop(false)').match(/data-garden-structure-image="bridge"/g)).toHaveLength(1);
    h.element('#garden-space-base').onclick();const current=live(h)[0];expect(current.picture.dataset.natureActive).toBe('false');expect(h.run('spaceDialog.innerHTML')).not.toContain('id="garden-nature"');
    h.element('#space-preview-cancel').onclick();expect(live(h)).toEqual([current]);expect(current.picture.dataset.natureActive).toBe('true');
    expect(h.run(snapshot)).toBe(before);expect(h.disk()).toEqual(disk);expect(h.writes()).toBe(writes);
  });
  it('체험·언어 재생성은 이전 표시를 폐기하며 재화·성장/소유는 추가 변경하지 않습니다',()=>{
    const h=boot(false,true);h.run("switchView('village')");const old=live(h)[0],disk=h.disk(),writes=h.writes(),before=h.run(snapshot);
    h.run('enterCareDemo()');expect(old.disposed).toBe(true);expect(live(h)).toHaveLength(1);h.run('exitCareDemo()');expect(live(h)).toHaveLength(1);
    expect(h.run(snapshot)).toBe(before);expect(h.disk()).toEqual(disk);expect(h.writes()).toBe(writes);
    const previous=live(h)[0];h.run("changeLanguage('en')");expect(previous.disposed).toBe(true);expect(live(h)).toHaveLength(1);expect(live(h)[0].picture.dataset.natureActive).toBe('true');
    expect(h.run('save.coins')).toBe(200);expect(h.run('save.stars')).toBe(10);expect(h.run('save.pip.growth')).toBe(60);expect(h.run('save.gardenDesign.owned')).toEqual(['butterflies']);
  });
});


describe('500판 여행 정원과 별·소유 확정 경계',()=>{
  const initial=(clears=500,stars=clears,coins=8000)=>({version:1,language:'ko',highestLevel:Math.min(500,clears+1),completed:Array.from({length:clears},(_,i)=>i+1),stars,coins,garden:0,music:true,sfx:true,tutorialSeen:true});
  const open=(h:ReturnType<typeof mainHarness>)=>{h.run("switchView('village')");h.element('#garden-area-journey').onclick();};
  const select=(h:ReturnType<typeof mainHarness>,id:string)=>h.run(`document.querySelector('#journey-project-select').value='${id}';document.querySelector('#journey-project-select').onchange()`);
  const confirm=(h:ReturnType<typeof mainHarness>)=>{h.element('#journey-restore').onclick();expect(h.run('spaceDialog.open')).toBe(true);h.element('#space-preview-confirm').onclick();};
  const board="JSON.stringify({round,moves,score,board:scene.engine.board,inProgress:save.inProgress,completed:save.completed,pip:save.pip,garden:save.garden})";
  it.each(['ribbon','wateringCan'] as const)('장착 %s는 일반→여행작품→방문→핍 전환에도 유지되며 소유/재화를 쓰지 않습니다',equipped=>{
    const h=mainHarness(false,false,false,false,{...initial(),garden:1,pip:{growth:100,affection:100,owned:[equipped],equipped},gardenDesign:{schema:1,flowers:Array(5).fill('meadow'),owned:[],placed:[],journeyProjects:{conservatory:{phase:2,altOwned:false,style:'base'}}}});
    h.run("switchView('village')");expect(h.element('#village-view').innerHTML).toContain(`data-pip-accessory="${equipped}"`);const disk=h.disk(),writes=h.writes();
    h.element('#garden-area-journey').onclick();expect(h.element('#village-view').innerHTML).toContain(`data-pip-accessory="${equipped}"`);
    expect(h.accessoryControllers.filter(a=>!a.disposed)).toHaveLength(1);expect(h.accessoryControllers.filter(a=>!a.disposed)[0].kind).toBe(equipped);
    h.element('#journey-visit').onclick();expect(h.element('#village-view').innerHTML).toContain(`data-pip-accessory="${equipped}"`);h.flushCareReaction();
    h.run("switchView('journal')");expect(h.element('#journal-view').innerHTML).toContain(`data-pip-accessory="${equipped}"`);expect(h.disk()).toEqual(disk);expect(h.writes()).toBe(writes);
    h.element('#pip-equip-none').onclick();h.run("switchView('village')");h.element('#garden-area-journey').onclick();expect(h.element('#village-view').innerHTML).not.toContain('village-pip-accessory');
  });
  it.each(['ko','en'] as const)('%s: 10작품의두단계와선택스타일은기존판/성장없이한payload씩저장됩니다',language=>{
    const h=mainHarness(false,false,false,false,{...initial(),language});open(h);const before=h.run(board);let stars=500,coins=8000;
    for(const spec of journeyModel.journeyProjectSpecs){select(h,spec.id);for(const cost of [15,25]){confirm(h);stars-=cost;expect(h.stored().stars).toBe(stars);expect(h.stored().coins).toBe(coins);}
      h.element('#journey-style-alt').onclick();h.element('#space-preview-confirm').onclick();coins-=spec.altCoins;expect(h.stored().coins).toBe(coins);expect(h.stored().gardenDesign.journeyProjects[spec.id]).toEqual({phase:2,altOwned:true,style:'alt'});
      for(const style of ['base','alt']){h.element('#journey-style-'+style).onclick();h.element('#space-preview-confirm').onclick();expect(h.stored().coins).toBe(coins);}
    }
    expect(stars).toBe(100);expect(coins).toBe(3400);expect(h.run(board)).toBe(before);expect(h.run('save.pip?.growth??0')).toBe(0);expect(h.run('journeyNextCard(save.language,save.gardenDesign.journeyProjects,gardenCompletedCount(),"village")')).toContain(t(language,'journeyAllDone'));
    const reload=mainHarness(false,false,false,false,h.stored());open(reload);select(reload,'starstage');expect(reload.run('gardenWorkshop(false)')).toContain('data-phase="2"');expect(reload.run('save.gardenDesign.journeyProjects.starstage.altOwned')).toBe(true);
  });
  it('미리보기/전후비교/취소는저장하지않고확정두번과낡은버튼은중복소비하지않습니다',()=>{
    const h=mainHarness(false,false,false,false,initial());open(h);const disk=h.disk(),before=h.run('JSON.stringify(save)'),writes=h.writes();h.element('#journey-restore').onclick();const stale=h.element('#space-preview-confirm').onclick;
    h.element('#space-preview-current').onclick();expect(h.run('spaceDialog.innerHTML')).toContain('data-phase="0"');h.element('#space-preview-after').onclick();expect(h.run('spaceDialog.innerHTML')).toContain('data-phase="1"');h.element('#space-preview-cancel').onclick();stale();expect(h.disk()).toEqual(disk);expect(h.run('JSON.stringify(save)')).toBe(before);expect(h.writes()).toBe(writes);
    h.element('#journey-restore').onclick();const once=h.element('#space-preview-confirm').onclick;once();once();expect(h.stored().stars).toBe(485);expect(h.stored().gardenDesign.journeyProjects.conservatory.phase).toBe(1);
  });
  it.each(['clears','stars','coins'] as const)('%s 부족은미리볼수있지만현재잔액으로다시차단됩니다',kind=>{
    const data=initial(kind==='clears'?119:500,kind==='stars'?14:100,kind==='coins'?279:8000),h=mainHarness(false,false,false,false,data);open(h);
    if(kind==='coins'){confirm(h);confirm(h);h.element('#journey-style-alt').onclick();}else h.element('#journey-restore').onclick();
    const before=h.run('JSON.stringify(save)'),disk=h.disk();expect(h.run('spaceDialog.innerHTML')).toMatch(/id="space-preview-confirm"[^>]*disabled/);h.element('#space-preview-confirm').onclick();expect(h.run('JSON.stringify(save)')).toBe(before);expect(h.disk()).toEqual(disk);
  });
  it.each(['primary','backup','conflict'] as const)('%s 저장실패시별과복원소유를둘다적용하지않고원문을보존합니다',phase=>{
    const h=mainHarness(false,false,false,false,initial());open(h);h.element('#journey-restore').onclick();const before=h.run('JSON.stringify(save)');
    if(phase==='backup')h.setStorageFails(true);else if(phase==='primary')h.run("const originalSet=localStorage.setItem;localStorage.setItem=(key,value)=>{if(key==='pawblossom.save.v1')throw Error('primary failed');originalSet(key,value)}");else h.run("localStorage.setItem('pawblossom.save.v1',JSON.stringify({...save,coins:7999}))");
    const primary=h.run("localStorage.getItem('pawblossom.save.v1')");h.element('#space-preview-confirm').onclick();expect(h.run('JSON.stringify(save)')).toBe(before);expect(h.run("localStorage.getItem('pawblossom.save.v1')")).toBe(primary);expect(h.run('save.gardenDesign?.journeyProjects')).toBeUndefined();
  });
  it.each(['project','hidden','route','language','oldDOM'] as const)('%s 무효화뒤늦은확정은소비하지않습니다',kind=>{
    const h=mainHarness(false,false,false,false,initial());open(h);h.element('#journey-restore').onclick();const stale=h.element('#space-preview-confirm').onclick,disk=h.disk(),stars=h.run('save.stars');
    if(kind==='project')h.run("selectedJourneyProject='lotus'");else if(kind==='hidden')h.run('document.hidden=true');else if(kind==='route')h.run("switchView('journal')");else if(kind==='language')h.run("changeLanguage('en')");else h.element('#space-preview-confirm').isConnected=false;
    const after=h.disk();stale();expect(h.run('save.stars')).toBe(stars);expect(h.run('save.gardenDesign?.journeyProjects')).toBeUndefined();expect(h.disk()).toEqual(kind==='language'?after:disk);
  });
  it('완성후무료방문은성장0에서도가능하고수치/지갑/판을바꾸지않으며복귀시정리됩니다',()=>{
    const h=mainHarness(false,false,false,false,initial());open(h);confirm(h);confirm(h);const before=h.run(board),disk=h.disk(),writes=h.writes();h.element('#journey-visit').onclick();expect(h.run('journeyMoment')).toBe(true);expect(h.run('gardenWorkshop(false)')).toContain(t('ko','journeyMoment'));h.flushCareReaction();expect(h.run('journeyMoment')).toBe(false);expect(h.run(board)).toBe(before);expect(h.disk()).toEqual(disk);expect(h.writes()).toBe(writes);
    h.element('#journey-visit').onclick();h.run("switchView('journal')");expect(h.run('journeyMoment')).toBe(false);expect(h.run('nextGardenProject()')).toContain('journal-open-journey');h.element('#journal-open-journey').onclick();expect(h.run('selectedGardenArea')).toBe('journey');expect(h.run('selectedJourneyProject')).toBe('lotus');
  });
  it('500체험은실제완료/회차를조작하지않고모든복원/꾸미기후키세개와원래선택을복원합니다',()=>{
    const h=mainHarness(false,false,true,false,initial(121,30,600));open(h);select(h,'reading');const normal=h.run('JSON.stringify(save)'),round=h.run(board),disk=h.disk(),writes=h.writes();h.run('enterCareDemo()');h.element('#care-demo-preset-500-village').onclick();expect(h.run('gardenCompletedCount()')).toBe(500);expect(h.run('save.completed.length')).toBe(121);expect(h.run('save.stars')).toBe(500);expect(h.run('save.coins')).toBe(8000);
    for(const spec of journeyModel.journeyProjectSpecs){select(h,spec.id);confirm(h);confirm(h);h.element('#journey-style-alt').onclick();h.element('#space-preview-confirm').onclick();}
    expect(h.run('save.stars')).toBe(100);expect(h.run('save.coins')).toBe(3400);expect(h.disk()).toEqual(disk);expect(h.writes()).toBe(writes);h.element('#care-demo-exit-village').onclick();expect(h.run('JSON.stringify(save)')).toBe(normal);expect(h.run(board)).toBe(round);expect(h.run('selectedJourneyProject')).toBe('reading');expect(h.run('selectedGardenArea')).toBe('journey');expect(h.disk()).toEqual(disk);
  });
  it('체험프리셋교체는모달/비활성에서차단하고낡은확정을정상저장으로넘기지않습니다',()=>{
    const h=mainHarness(false,false,true,false,initial());open(h);h.run('enterCareDemo();setCareDemoPreset(500)');h.element('#journey-restore').onclick();const stale=h.element('#space-preview-confirm').onclick;h.run('setCareDemoPreset(100)');expect(h.run('careDemo.preset')).toBe(500);h.element('#space-preview-cancel').onclick();h.run('setCareDemoPreset(100)');expect(h.run('careDemo.preset')).toBe(100);const stars=h.run('save.stars'),disk=h.disk();stale();expect(h.run('save.stars')).toBe(stars);h.run('document.hidden=true;setCareDemoPreset(500)');expect(h.run('careDemo.preset')).toBe(100);expect(h.disk()).toEqual(disk);
  });
});


describe('풍경 완주와 결과 입력 소유권',()=>{
  const prior=(n:number)=>({version:1,language:'en',highestLevel:Math.min(500,n+1),completed:Array.from({length:n},(_,i)=>i+1),stars:n,coins:n*40,garden:0,music:true,sfx:true,tutorialSeen:true});
  it('실제기록의19→20완주는1별40코인외새보상없이한번표시하고재완료/시험/실패는표시하지않습니다',()=>{
    const h=mainHarness(false,false,true,false,prior(19));h.run('startLevel(20);finish(true)');expect(h.stored().completed).toHaveLength(20);expect(h.stored().stars).toBe(20);expect(h.stored().coins).toBe(800);expect(h.element('#result-dialog').innerHTML).toContain('id="result-world-picture"');expect(h.run('resultWorld')).toEqual({index:0,first:1,last:20,done:20,total:20,journeyComplete:false});expect(h.run('worldProgressText(2)')).toBe('Cleared 20/20');
    const before=h.stored();h.run('startLevel(20);finish(true)');expect(h.stored()).toEqual(before);expect(h.run('resultWorld')).toBeUndefined();expect(h.element('#result-dialog').innerHTML).not.toContain('result-world-picture');
    for(const [test,won] of [[true,true],[false,false]]){const probe=mainHarness(false,false,true,false,prior(19));probe.run(`startLevel(20,${test});finish(${won})`);expect(probe.run('resultWorld')).toBeUndefined();expect(probe.stored().stars).toBe(19);expect(probe.stored().coins).toBe(760);}
  });
  it('500고유완주만최종문구/25번째엽서를표시하고언어갱신은같은owner·회차·소리를보존합니다',()=>{
    const h=mainHarness(false,false,true,false,prior(499));h.run('startLevel(500);finish(true)');expect(h.stored().completed).toHaveLength(500);expect(h.stored().stars).toBe(500);expect(h.stored().coins).toBe(20000);expect(h.run('resultWorld.journeyComplete')).toBe(true);expect(h.element('#result-dialog').innerHTML).toContain(t('en','complete'));const controller=h.run('resultWorldScenery'),count=h.sceneryControllers.length,sounds=h.run('audio.plays.slice()'),round=h.run('round'),scene=h.run('scene');
    h.run("changeLanguage('ko')");expect(h.element('#result-title').textContent).toBe(t('ko','complete'));expect(h.element('#result-world-title').textContent).toBe(t('ko','worldComplete'));expect(h.element('#result-world-name').textContent).toContain('481–500');expect(h.run('resultWorldScenery')).toBe(controller);expect(h.sceneryControllers).toHaveLength(count);expect(h.run('round')).toBe(round);expect(h.run('scene')).toBe(scene);expect(h.run('audio.plays')).toEqual(sounds);expect(h.stored().coins).toBe(20000);
  });
  it('완주엽서는비활성/닫힘에멈추고정원구매뒤동일결과복귀는다음입력을허용하며새판에서폐기합니다',()=>{
    const h=mainHarness(false,false,true,false,prior(19));h.run('startLevel(20);finish(true)');const art=h.run('resultWorldScenery') as {active:boolean;disposed:boolean};expect(art.active).toBe(true);h.run('document.hidden=true');h.documentEvents.visibilitychange();expect(art.active).toBe(false);h.run('document.hidden=false');h.documentEvents.visibilitychange();expect(art.active).toBe(true);
    h.run("document.querySelector('#result-dialog').close();switchView('village')");expect(art.active).toBe(false);const next=h.element('#result-next').onclick;h.element('#grow').onclick();h.flushGrowth();expect(h.stored().garden).toBe(1);h.run("switchView('puzzle')");expect(h.element('#result-dialog').open).toBe(true);expect(h.run('resultWorldScenery')).toBe(art);expect(art.active).toBe(true);next();expect(h.run('currentLevel')).toBe(21);expect(art.disposed).toBe(true);expect(h.run('resultWorld')).toBeUndefined();expect(h.stored().coins).toBe(800);
  });
  it.each(['hidden','inactive','closed','oldDOM','otherModal','disabled','round','scene'] as const)('%s 결과문맥에서는현재다음콜백도이동/저장을바꾸지않습니다',kind=>{
    const h=mainHarness();h.run('finish(true)');const button=h.element('#result-next'),next=button.onclick;
    if(kind==='hidden')h.run('document.hidden=true');else if(kind==='inactive')h.run('nativeActive=false');else if(kind==='closed')h.element('#result-dialog').close();else if(kind==='oldDOM')button.isConnected=false;else if(kind==='otherModal')h.run('resourceDialog.showModal()');else if(kind==='disabled')button.disabled=true;else if(kind==='round')h.run('round++');else h.run('scene={...scene}');
    const before=h.run('JSON.stringify({level:currentLevel,round,moves,route,save})'),disk=h.disk();next();expect(h.run('JSON.stringify({level:currentLevel,round,moves,route,save})')).toBe(before);expect(h.disk()).toEqual(disk);
  });

  it('pagehide폐기뒤pageshow복원은같은엽서DOM/판/보상/소리로그림owner만재생성합니다',()=>{
    const h=mainHarness(false,false,true,false,prior(19));h.run('startLevel(20);finish(true)');const owner=h.run('resultWorldScenery') as {active:boolean;disposed:boolean},count=h.sceneryControllers.length,html=h.element('#result-dialog').innerHTML,disk=h.disk(),sound=h.run('audio.plays.slice()'),state=h.run('JSON.stringify({round,currentLevel,moves,score,firstReward,resultWorld,save})');h.windowEvents.pagehide();expect(owner.disposed).toBe(true);expect(h.run('resultWorldScenery')).toBeUndefined();h.windowEvents.pageshow();const next=h.run('resultWorldScenery') as {active:boolean;disposed:boolean};expect(next).not.toBe(owner);expect(next.active).toBe(true);expect(h.sceneryControllers).toHaveLength(count+1);expect(h.element('#result-dialog').innerHTML).toBe(html);expect(h.run('JSON.stringify({round,currentLevel,moves,score,firstReward,resultWorld,save})')).toBe(state);expect(h.run('audio.plays')).toEqual(sound);expect(h.disk()).toEqual(disk);h.windowEvents.pageshow();expect(h.run('resultWorldScenery')).toBe(next);expect(h.sceneryControllers).toHaveLength(count+1);
  });
  it('비연속진행의마지막누락1번에서도고유500전체완주를표시하고다시즐기기는같은판입니다',()=>{
    const data={...prior(499),completed:Array.from({length:499},(_,i)=>i+2)},h=mainHarness(false,false,true,false,data);h.run('startLevel(1);finish(true)');expect(h.stored().completed).toHaveLength(500);expect(h.run('resultWorld.journeyComplete')).toBe(true);expect(h.element('#result-dialog').innerHTML).toContain(t('en','completeDesc').replace('{count}','500'));expect(h.element('#result-dialog').innerHTML).toContain(t('en','worldLastMemory'));h.run("changeLanguage('ko')");expect(h.element('#result-title').textContent).toBe(t('ko','complete'));expect(h.element('#result-world-note').textContent).toBe(t('ko','worldLastMemory'));h.element('#result-next').onclick();expect(h.run('currentLevel')).toBe(1);expect(h.stored().coins).toBe(20000);
  });
  it('이전 결과의다음콜백을두번호출해도새판을건너뛰지않습니다',()=>{
    const h=mainHarness();h.run('finish(true)');const next=h.element('#result-next').onclick;next();h.run('replaceBoard()');const expected=h.run('JSON.stringify({level:currentLevel,round,moves,board:scene.engine.board})');expect(h.run('currentLevel')).toBe(3);next();expect(h.run('JSON.stringify({level:currentLevel,round,moves,board:scene.engine.board})')).toBe(expected);
  });
  it('이전 결과의홈콜백이새퍼즐의경로를바꾸지않습니다',()=>{
    const h=mainHarness();h.run('finish(true)');const home=h.element('#result-home').onclick;h.element('#result-next').onclick();h.run('replaceBoard()');home();expect(h.run('route')).toBe('puzzle');expect(h.run('currentLevel')).toBe(3);
  });
  it('이전 결과의시험선택콜백은새회차에서옛결과로돌아오는선택창을열지않습니다',()=>{
    const h=mainHarness(false,false,true);h.run('startLevel(20,true);finish(true)');const picker=h.element('#result-test').onclick;h.element('#result-next').onclick();h.run('replaceBoard()');picker();expect(h.element('#test-level-dialog').open).toBe(false);expect(h.run('currentLevel')).toBe(21);
  });
});


describe('선택한 정원 꽃밭에 무료 물주기',()=>{
  const initial=(language='ko',garden=5,growth=100)=>({version:1,language,highestLevel:6,completed:[1,2,3,4,5],stars:10,coins:200,garden,music:true,sfx:true,tutorialSeen:true,pip:{growth,affection:100,owned:['ribbon'],equipped:'ribbon'},gardenDesign:{schema:1,flowers:['meadow','daisy','violet','meadow','daisy'],owned:[],placed:[]}});
  it.each(['ko','en'] as const)('%s: 선택5칸의 위치·이름을 실제 돌보기에 연결하고 종료/반복에도 쓰기나 성장 보상이 없습니다',language=>{
    const h=mainHarness(false,false,false,false,initial(language));h.run("switchView('village')");const disk=h.disk(),writes=h.writes(),before=h.run('JSON.stringify(save)');
    for(let plot=0;plot<5;plot++){
      h.element('#garden-plot-'+plot).onclick();h.element('#garden-tend').onclick();
      expect(h.run('gardenTendingPlot')).toBe(plot);const html=h.element('#village-view').innerHTML;
      expect(html).toContain(`data-tending-plot="${plot}"`);expect(html).toContain('id="village-pip-tend-stage"');expect(html).not.toContain('pip-tending-scene');
      expect(html).toContain(t(language,'gardenTendMoment').replace('{number}',String(plot+1)).replace('{flower}',h.run(`flowerName(save.gardenDesign.flowers[${plot}])`)));
      h.flushCareReaction();expect(h.run('gardenTendingPlot')).toBeUndefined();expect(h.element('#village-view').innerHTML).not.toContain('village-pip-tend-stage');
    }
    expect(h.disk()).toEqual(disk);expect(h.writes()).toBe(writes);expect(h.run('JSON.stringify(save)')).toBe(before);
  });
  it('그림 밖에서 무료 돌보기를 누르면 정원 스크롤만 옮기고 실행 초점과 저장은 보존합니다',()=>{
    const h=mainHarness(false,false,false,false,initial());h.run("switchView('village');selectedGardenPlot=1;renderViews()");
    h.setBounds('#village-view',{left:0,right:480,top:100,bottom:500});h.setBounds('#garden-nature',{left:0,right:480,top:-160,bottom:60});
    h.run("document.querySelector('#village-view').scrollTop=480;globalThis.tendFocus=[];document.activeElement={id:'garden-tend',isConnected:false};const currentQuery=document.querySelector;document.querySelector=selector=>{const target=currentQuery(selector);if(selector==='#garden-tend')target.focus=options=>{tendFocus.push(options.preventScroll);document.activeElement=target};return target};document.querySelector('#journal-view').scrollTop=77");
    const disk=h.disk(),writes=h.writes(),before=h.run('JSON.stringify(save)');h.element('#garden-tend').onclick();
    expect(h.run('gardenTendingPlot')).toBe(1);expect(h.element('#village-view').scrollTop).toBe(220);expect(h.element('#journal-view').scrollTop).toBe(77);expect(h.run('tendFocus')).toEqual([true]);expect(h.run("document.activeElement===document.querySelector('#garden-tend')")).toBe(true);
    expect(h.disk()).toEqual(disk);expect(h.writes()).toBe(writes);expect(h.run('JSON.stringify(save)')).toBe(before);
  });
  it('이미 보이는 그림과 거절된 돌보기는 사용자의 탐색 위치를 바꾸지 않습니다',()=>{
    for(const [growth,top,bottom] of [[100,120,360],[20,-160,60]]){
      const h=mainHarness(false,false,false,false,initial('ko',5,growth));h.run("switchView('village')");
      h.setBounds('#village-view',{left:0,right:480,top:100,bottom:500});h.setBounds('#garden-nature',{left:0,right:480,top,bottom});h.element('#village-view').scrollTop=480;
      h.element('#garden-tend').onclick();expect(h.element('#village-view').scrollTop).toBe(480);
      expect(h.run('gardenTendingPlot')).toBe(growth===100?0:undefined);
    }
  });
  it('빈칸·잠긴 성장·숨김·모달·성장 중에는 꽃밭 물주기를 시작하지 않습니다',()=>{
    for(const [garden,growth,guard] of [[0,100,''],[5,20,''],[5,100,'document.hidden=true'],[5,100,'nativeActive=false'],[5,100,"document.querySelector('#tutorial-dialog').open=true"],[5,100,'growing=true']] as const){
      const h=mainHarness(false,false,false,false,initial('ko',garden,growth));h.run("switchView('village')");if(guard)h.run(guard);h.element('#garden-tend').onclick();expect(h.run('gardenTendingPlot')).toBeUndefined();
    }
  });
  it('다른 칸/구역/페이지·모달로 이동하면 이전 물주기는 남지 않습니다',()=>{
    for(const change of ["document.querySelector('#garden-plot-3').onclick()","document.querySelector('#garden-area-pond').onclick()","switchView('journal')","document.querySelector('#garden-look-open').onclick()"]){
      const h=mainHarness(false,false,false,false,initial());h.run("switchView('village')");h.element('#garden-tend').onclick();const disk=h.disk();h.run(change);expect(h.run('gardenTendingPlot')).toBeUndefined();h.flushCareReaction();expect(h.disk()).toEqual(disk);
    }
  });
});
