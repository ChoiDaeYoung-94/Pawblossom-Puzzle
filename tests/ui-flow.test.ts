import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { BoardEngine, seededRng, type BoardSnapshot } from '../src/core';

// 테스트에만 사용하는 Node API입니다. 별도 @types/node 설치 없이 런타임에서 읽습니다.
const fsModule = 'node:fs', vmModule = 'node:vm';
const fs = await import(fsModule), vm = await import(vmModule);
const read = (path: string): string => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const compile = (source: string): string => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const mainCode = compile(read('../src/main.ts').replace(/^import .*;\r?\n/gm, ''));
const stateCode = compile(read('../src/state.ts'));
const levelsCode = compile(read('../src/levels.ts'));
const boardCode = compile(read('../src/BoardScene.ts'));
const effectsCode = compile(read('../src/BoardEffects.ts'));
const engineCode = compile(read('../src/core/BoardEngine.ts'));
const practiceCode = compile(read('../src/SwapPractice.ts'));
const i18nCode = compile(read('../src/i18n.ts'));
const gardenCode = compile(read('../src/GardenArt.ts'));

class ElementStub {
  id: string;
  hidden: boolean;
  open = false;
  innerHTML = '';
  textContent = '';
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  listeners: Record<string, (event: { preventDefault(): void }) => void> = {};
  onclick: () => void = () => {};
  classList = { add() {}, remove() {}, toggle() {} };
  constructor(selector: string) { this.id = selector.slice(1); this.hidden = selector !== '#puzzle-view'; }
  setAttribute() {}
  removeAttribute() {}
  append() {}
  focus() {}
  setPointerCapture() {}
  toggleAttribute() {}
  addEventListener(name: string, callback: (event: { preventDefault(): void }) => void) { this.listeners[name] = callback; }
  showModal() { this.open = true; }
  close() { this.open = false; }
}

function mainHarness(storageFails = false, firstUse = false, testTools = false, native = false, initial?:unknown, autoFrame=true) {
  const elements = new Map<string, ElementStub>();
  const timers = new Map<number, { callback: () => void; ms: number }>();
  let timerId = 0, writes = 0;
  let games=0, destroys=0, frame=()=>{};
  const documentEvents:Record<string,()=>void>={};
  const nativeEvents:Record<string,(state:{isActive:boolean})=>void>={};
  let resolveNativeState!:(state:{isActive:boolean})=>void;
  const nativeState=new Promise<{isActive:boolean}>(resolve=>{resolveNativeState=resolve;});
  let stored = JSON.stringify({ version: 1, language: 'en', highestLevel: 2, completed: [1], stars: 1, coins: 40, garden: 0, music: true, sfx: true });
  if(firstUse)stored='null';
  if(initial!==undefined)stored=JSON.stringify(initial);
  const element = (selector: string): ElementStub => {
    if (!elements.has(selector)) elements.set(selector, new ElementStub(selector));
    return elements.get(selector)!;
  };
  class SceneStub {
    engine:BoardEngine;
    stopped=false;
    constructor(public hooks: { onMove(items: number[], points: number): void; onReady():void; onNotice(key:string):void },snapshot?:BoardSnapshot) {this.engine=new BoardEngine(8,8,seededRng(42),snapshot);}
    configureLeaves(piles:Parameters<BoardEngine['setLeaves']>[0]) {this.engine.setLeaves(piles);}
    shuffle(){this.engine.shuffle();return true;}
    canLeave() { return true; }
    stopPlaying() {this.stopped=true;}
  }
  class GameStub {
    constructor(){games++;}
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
    scale = { refresh() {} };
    destroy() {destroys++;}
  }
  class AudioStub {
    suspended=false;suspends=0;resumes=0;
    setMusicEnabled() {}
    setSfxEnabled() {}
    unlock() { return Promise.resolve(); }
    play() {}
    suspend() {this.suspended=true;this.suspends++;}
    resume() {this.suspended=false;this.resumes++;}
  }
  const stateExports: Record<string, unknown> = {};
  const context = vm.createContext({
    TEST_TOOLS_ENABLED:testTools,
    exports: stateExports,
    localStorage: {
      getItem: () => stored,
      setItem: (_key: string, value: string) => {
        writes++;
        if (storageFails) throw new Error('Storage write rejected');
        stored = value;
      },
    },
    document: {
      createElement: () => new ElementStub('button'),
      querySelector: element,
      querySelectorAll: (selector: string) => selector === '[data-test-level]'
        ? Array.from({length:30},(_,i)=>{const button=element(`#test-stage-${i+1}`);button.dataset.testLevel=String(i+1);return button;}) : selector === '[data-chapter]' || selector === '[data-test-chapter]'
        ? Array.from({length:3},(_,i)=>{const test=selector.includes('test-');const button=element(`#${test?'test-':''}chapter-${i+1}`);button.dataset[test?'testChapter':'chapter']=String(i+1);return button;}) : selector === '#practice-board button'
        ? Array.from({length:9},(_,i)=>{const button=element(`#practice-cell-${Math.floor(i/3)}-${i%3}`);button.dataset={row:String(Math.floor(i/3)),col:String(i%3)};return button;}) : selector === '.view'
        ? ['puzzle', 'village', 'journal', 'settings'].map(name => element(`#${name}-view`)) : [],
      documentElement: {}, hidden:false, addEventListener:(name:string,callback:()=>void)=>{documentEvents[name]=callback;},
    },
    Phaser: { Game: GameStub, AUTO: 0, Scale: { FIT: 0, CENTER_BOTH: 0 }, Core:{Events:{POST_RENDER:'postrender'}} },
    BoardScene: SceneStub, tileNames: ['strawberry', 'carrot', 'blueberry', 'acorn', 'leaf', 'flower'],
    AudioManager: AudioStub, t: (_language: string, key: string) => key, icon: () => '',
    Capacitor: { isNativePlatform: () => native },
    App:{addListener:(name:string,callback:(state:{isActive:boolean})=>void)=>{nativeEvents[name]=callback;return Promise.resolve({remove(){}});},getState:()=>nativeState,minimizeApp:()=>Promise.resolve()}, confirm: () => true,
    setTimeout: (callback: () => void, ms: number) => { timers.set(++timerId, { callback, ms }); return timerId; },
    clearTimeout: (id: number) => timers.delete(id),
  });
  const levelExports: Record<string, unknown> = {};
  vm.runInNewContext(levelsCode, {exports:levelExports});
  Object.assign(context,{require:(name:string) => {if(name==='./levels')return levelExports;if(name==='./core')return coreExports;throw new Error(name);}});
  const coreExports:Record<string,unknown>={}, practiceExports:Record<string,unknown>={};
  vm.runInNewContext(engineCode,{exports:coreExports});
  vm.runInNewContext(practiceCode,{exports:practiceExports,require:()=>coreExports});
  Object.assign(context,practiceExports);
  const i18nExports:Record<string,unknown>={};
  vm.runInNewContext(i18nCode,{exports:i18nExports});
  Object.assign(context,i18nExports);
  const gardenExports:Record<string,unknown>={};vm.runInNewContext(gardenCode,{exports:gardenExports});Object.assign(context,gardenExports);
  vm.runInContext(stateCode, context);
  Object.assign(context, stateExports);
  vm.runInContext(mainCode, context);
  if(autoFrame)frame();
  return {
    frame:()=>frame(),games:()=>games,destroys:()=>destroys,
    documentEvents,nativeEvents,resolveNativeState,
    element, run: (code: string) => {const result=vm.runInContext(code, context);if(autoFrame)frame();return result;},
    resultTimers: () => [...timers.values()].filter(timer => timer.ms === 300),
    flushResults: () => [...timers.values()].filter(timer => timer.ms === 300).forEach(timer => timer.callback()),
    flushGrowth: () => [...timers.values()].filter(timer => timer.ms === 450).forEach(timer => timer.callback()),
    writes: () => writes, stored: () => JSON.parse(stored),
  };
}

type Pointer = { id: number; x: number; y: number };
type Position = { row: number; col: number };
function boardHarness() {
  const handlers: Record<string, (pointer: Pointer) => void> = {};
  const lifecycle: Record<string, () => void> = {};
  const attempts: { a: Position; b: Position }[] = [], taps: Position[] = [];
  const graphics: object = new Proxy({}, { get: () => () => graphics });
  class PhaserSceneStub {
    cameras = { main: { setBackgroundColor() {} } };
    add = { graphics: () => graphics };
    input = { on: (name: string, callback: (pointer: Pointer) => void) => { handlers[name] = callback; } };
    events = {
      on: (name: string, callback: () => void) => { lifecycle[name] = callback; },
      once: (name: string, callback: () => void) => { lifecycle[name] = callback; },
    };
  }
  const engineExports: Record<string, unknown> = {}, boardExports: Record<string, unknown> = {};
  const effectsExports:Record<string,unknown>={};vm.runInNewContext(effectsCode,{exports:effectsExports});
  vm.runInNewContext(engineCode, { exports: engineExports });
  vm.runInNewContext(boardCode, {
    exports: boardExports,
    require: (name: string) => name === 'phaser' ? { default: {
      Scene: PhaserSceneStub,
      Scenes: { Events: { PAUSE: 'pause', RESUME: 'resume', SLEEP: 'sleep', SHUTDOWN: 'shutdown' } },
    } } : name==='./BoardEffects'?effectsExports:engineExports,
  });
  const Constructor = boardExports.BoardScene as new (hooks: object) => {
    create(): void; paint: () => void; resetHint: () => void;
    attempt: (a: Position, b: Position) => void; tap: (position: Position) => void;
    selected?: Position; down?: { pointerId: number };
  };
  const scene = new Constructor({ audio: {}, onStart() {}, onMove() {}, onNotice() {} });
  // 실제 create()와 제스처 정리를 사용하고 표시/애니메이션만 생략합니다.
  scene.paint = () => {}; scene.resetHint = () => {};
  scene.attempt = (a, b) => { attempts.push({ a, b }); };
  scene.tap = position => { taps.push(position); };
  scene.create();
  return { handlers, lifecycle, attempts, taps, scene };
}

describe('첫 시제품 UI 흐름 회귀 검증 (모의 DOM/Phaser)', () => {
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
    h.element('#restart').onclick();expect(h.run('testingLevel')).toBe(true);
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
    test.run('startLevel(99,true)');expect(test.run('currentLevel')).toBe(10);
    test.run("showTestPicker();changeLanguage('ko')");expect(test.element('#test-level-dialog').innerHTML).toContain('낙엽 두 겹');
    test.element('#test-level-dialog').listeners.cancel({preventDefault(){}});expect(test.run('game.paused')).toBe(false);
  });
  it('열매와 낙엽 목표를 모두 채워야 완료되고 기존 보상은 재지급하지 않습니다',()=>{
    const h=mainHarness();h.run("save.highestLevel=6;startLevel(4)");
    h.run('scene.hooks.onMove([0,0,0,14,12,0],260,1,3)');
    expect(h.resultTimers()).toHaveLength(0);expect(h.run('clearedLeaves')).toBe(3);
    expect(h.element('#goals').innerHTML).toContain('leaf-pile.svg');
    h.run('scene.hooks.onMove([0,0,0,0,0,0],20,1,1)');h.flushResults();
    expect(h.stored()).toMatchObject({completed:[1,4],stars:2,coins:80});
    h.run('startLevel(4);scene.hooks.onMove([0,0,0,14,12,0],260,1,4)');h.flushResults();
    expect(h.stored()).toMatchObject({completed:[1,4],stars:2,coins:80});
    h.run('startLevel(6)');expect(h.run('clearedLeaves')).toBe(0);
    expect(h.element('#board-hint-text').textContent).toContain('2 means two layers');
    h.run("changeLanguage('ko')");expect(h.element('#board-hint-text').textContent).toContain('두 겹');
  });
  it('꽃밭 성장은 별 2개를 한 번만 쓰고 저장·그림·최대 5개 제한을 유지합니다',()=>{
    const h=mainHarness();h.run('save.stars=4;renderViews()');
    h.element('#grow').onclick();h.element('#grow').onclick();
    expect(h.stored()).toMatchObject({stars:2,garden:1,coins:40,highestLevel:2});
    expect(h.element('#village-view').innerHTML).toContain('data-stage="1"');
    h.flushGrowth();h.element('#grow').onclick();
    expect(h.stored()).toMatchObject({stars:0,garden:2});
    h.flushGrowth();h.element('#grow').onclick();expect(h.run('save.garden')).toBe(2);
    h.run('save.garden=5;save.stars=8;renderViews()');h.element('#grow').onclick();
    expect(h.run('save.garden')).toBe(5);expect(h.run('save.stars')).toBe(8);
  });
  it('정원 저장 실패 안내는 성공 메시지로 덮어쓰지 않습니다',()=>{
    const h=mainHarness(true);h.run('save.stars=2;renderViews()');h.element('#grow').onclick();
    expect(h.run('save.garden')).toBe(1);
    expect(h.element('#toast').textContent).toMatch(/Storage is unavailable/);
    expect(h.stored().garden).toBe(0);
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

  it('초기화 저장에 실패하면 세션은 초기화하되 저장 실패 안내를 표시합니다', () => {
    const h = mainHarness(true);
    h.element('#reset').onclick();
    expect(h.writes()).toBeGreaterThan(0);
    expect(h.run('save.highestLevel')).toBe(1);
    expect(h.element('#toast').textContent).toMatch(/기기 저장 공간을 사용할 수 없어요/);
    expect(h.stored().highestLevel).toBe(2); // 저장 실패가 이전 데이터를 지우지는 않습니다.
    expect(h.run('loadSave().highestLevel')).toBe(2);
  });
});

describe('첫 플레이 안내', () => {
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
    h.element('#practice-cell-0-2').onclick();
    h.element('#practice-cell-1-2').onclick();
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
    h.element('#practice-cell-1-2').onclick();
    h.run("changeLanguage('ko')");
    expect(h.run('practice.selected.row')).toBe(1);
    h.element('#practice-cell-0-2').onclick();
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
  it('실습 중 건너뛰기와 뒤로 이동은 게임 진행을 바꾸지 않습니다',()=>{
    const h=mainHarness(false,true);
    for(let i=0;i<3;i++)h.element('#guide-next').onclick();
    h.element('#practice-cell-0-2').onclick();
    h.element('#guide-back').onclick();h.element('#guide-next').onclick();
    expect(h.run('practice.selected')).toBeUndefined();
    h.element('#guide-skip').onclick();
    expect(h.run('moves')).toBe(26);
    expect(h.stored()).toMatchObject({completed:[],stars:0,coins:0,tutorialSeen:true});
  });
  it('실습 포인터는 다른 손가락의 놓기를 무시하고 취소 후 다시 밀 수 있습니다',()=>{
    const h=mainHarness(false,true);
    for(let i=0;i<3;i++)h.element('#guide-next').onclick();
    h.run("document.querySelector('#practice-cell-0-2').onpointerdown({button:0,pointerId:1,clientX:0,clientY:0})");
    h.run("document.querySelector('#practice-cell-0-2').onpointerup({pointerId:2,clientX:0,clientY:60,preventDefault(){}})");
    expect(h.run('practice.completed')).toBe(false);
    h.run("document.querySelector('#practice-cell-0-2').onpointercancel()");
    h.run("document.querySelector('#practice-cell-0-2').onpointerdown({button:0,pointerId:3,clientX:0,clientY:0})");
    h.run("document.querySelector('#practice-cell-0-2').onpointerup({pointerId:3,clientX:0,clientY:60,preventDefault(){}})");
    expect(h.run('practice.completed')).toBe(true);
    expect(h.run('moves')).toBe(26);
    expect(h.run('save.coins')).toBe(0);
  });
});


describe('30스테이지 진행과 선택 묶음',()=>{
  it('10번 완료는 11번을 해제하고 마지막 완료 안내를 표시하지 않습니다',()=>{
    const app=mainHarness();app.run('startLevel(10);finish(true)');
    expect(app.stored().highestLevel).toBe(11);
    expect(app.element('#result-dialog').innerHTML).toContain('Next level');
    app.element('#result-next').onclick();expect(app.run('currentLevel')).toBe(11);
    expect(app.element('#chapter-name').textContent).toContain('Flower Path');
  });
  it('30번 완료는 31번을 열지 않으며 재플레이 보상을 중복 지급하지 않습니다',()=>{
    const app=mainHarness();app.run('startLevel(30);finish(true)');
    expect(app.stored().highestLevel).toBe(30);
    expect(app.element('#result-dialog').innerHTML).toContain('All 30 prototype levels');
    app.element('#result-next').onclick();expect(app.run('currentLevel')).toBe(30);
    const before=app.stored();app.run('finish(true)');expect(app.stored()).toEqual({...before,inProgress:undefined});
  });
  it('일반 선택 묶음은 잠금을 유지하고 테스트 30번은 진행 기록을 바꾸지 않습니다',()=>{
    const app=mainHarness(false,false,true), before=app.stored();
    app.element('#chapter-3').onclick();
    expect(app.element('#village-view').innerHTML).toContain('data-level="30" disabled');
    expect(app.element('#village-view').innerHTML).not.toContain('data-level="1"');
    app.run('showTestPicker()');app.element('#test-chapter-3').onclick();
    expect(app.element('#test-level-dialog').innerHTML).toContain('data-test-level="30"');
    expect(app.element('#test-level-dialog').innerHTML).not.toContain('data-test-level="1"');
    app.element('#test-stage-30').onclick();app.run('finish(true)');expect(app.stored()).toEqual(before);
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
    app.run("switchView('puzzle')");expect(app.run('game.paused')).toBe(false);
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
  it('무료 섞기 후 보드와 사용 횟수를 복원하며 두 번째 사용은 저장하지 않습니다',()=>{
    const app=mainHarness(),before=app.stored();app.element('#shuffle').onclick();
    const shuffled=app.stored();expect(shuffled.inProgress.shuffles).toBe(0);expect(shuffled.inProgress.board).not.toEqual(before.inProgress.board);
    app.element('#shuffle').onclick();expect(app.stored()).toEqual(shuffled);
    const restored=mainHarness(false,false,false,false,shuffled);expect(restored.run('shuffles')).toBe(0);expect(restored.stored()).toEqual(shuffled);
  });
  it('시험·시험 재시작·완료는 정상 저장을 보존하고 일반 복귀와 재실행은 이어갑니다',()=>{
    const app=mainHarness(false,false,true);app.element('#shuffle').onclick();const normal=app.stored();
    app.run('startLevel(30,true);scene.hooks.onMove([2,0,0,0,0,0],20,1,0)');
    app.element('#restart').onclick();app.run('finish(true)');expect(app.stored()).toEqual(normal);
    const relaunched=mainHarness(false,false,true,false,app.stored());expect(relaunched.run('testingLevel')).toBe(false);expect(relaunched.stored()).toEqual(normal);
    app.element('#result-test').onclick();app.element('#test-normal').onclick();expect(app.stored()).toEqual(normal);expect(app.run('shuffles')).toBe(0);
  });
  it('정상 재시작·다른 선택·초기화는 새 회차이며 이전 콜백을 무시합니다',()=>{
    const app=mainHarness();app.element('#shuffle').onclick();const stale=app.run('scene.hooks.onMove');
    app.element('#restart').onclick();expect(app.stored().inProgress.shuffles).toBe(1);
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
    app.element('#shuffle').onclick();expect(app.stored()).toEqual(source);expect(app.element('#toast').textContent).toContain('Storage is unavailable');
  });
  it('초기 복원 저장 실패 경고를 복원 안내로 덮지 않고 메모리에서 플레이합니다',()=>{
    const source=mainHarness().stored(),app=mainHarness(true,false,false,false,source);
    expect(app.element('#toast').textContent).toContain('Storage is unavailable');
    expect(app.run('scene.engine.board')).toEqual(source.inProgress.board);expect(app.stored()).toEqual(source);
    app.run('scene.hooks.onMove([1,0,0,0,0,0],10)');expect(app.run('moves')).toBe(source.inProgress.moves-1);
    expect(app.stored()).toEqual(source);expect(app.element('#toast').textContent).toContain('Storage is unavailable');
  });
});
