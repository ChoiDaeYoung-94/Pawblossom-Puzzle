import { describe, expect, it } from 'vitest';
import ts from 'typescript';

// 테스트에만 사용하는 Node API입니다. 별도 @types/node 설치 없이 런타임에서 읽습니다.
const fsModule = 'node:fs', vmModule = 'node:vm';
const fs = await import(fsModule), vm = await import(vmModule);
const read = (path: string): string => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const compile = (source: string): string => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const mainCode = compile(read('../src/main.ts').replace(/^import .*;\r?\n/gm, ''));
const stateCode = compile(read('../src/state.ts'));
const boardCode = compile(read('../src/BoardScene.ts'));
const engineCode = compile(read('../src/core/BoardEngine.ts'));

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
  toggleAttribute() {}
  addEventListener(name: string, callback: (event: { preventDefault(): void }) => void) { this.listeners[name] = callback; }
  showModal() { this.open = true; }
  close() { this.open = false; }
}

function mainHarness(storageFails = false) {
  const elements = new Map<string, ElementStub>();
  const timers = new Map<number, { callback: () => void; ms: number }>();
  let timerId = 0, writes = 0;
  let stored = JSON.stringify({ version: 1, language: 'en', highestLevel: 2, completed: [1], stars: 1, coins: 40, garden: 0, music: true, sfx: true });
  const element = (selector: string): ElementStub => {
    if (!elements.has(selector)) elements.set(selector, new ElementStub(selector));
    return elements.get(selector)!;
  };
  class SceneStub {
    constructor(public hooks: { onMove(items: number[], points: number): void }) {}
    canLeave() { return true; }
    stopPlaying() {}
  }
  class GameStub {
    scene = { isPaused: () => false, isActive: () => true, pause() {}, resume() {} };
    scale = { refresh() {} };
    destroy() {}
  }
  class AudioStub {
    setMusicEnabled() {}
    setSfxEnabled() {}
    unlock() { return Promise.resolve(); }
    play() {}
    suspend() {}
    resume() {}
  }
  const stateExports: Record<string, unknown> = {};
  const context = vm.createContext({
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
      querySelector: element,
      querySelectorAll: (selector: string) => selector === '.view'
        ? ['puzzle', 'village', 'journal', 'settings'].map(name => element(`#${name}-view`)) : [],
      documentElement: {}, addEventListener() {},
    },
    Phaser: { Game: GameStub, AUTO: 0, Scale: { FIT: 0, CENTER_BOTH: 0 } },
    BoardScene: SceneStub, tileNames: ['strawberry', 'carrot', 'blueberry', 'acorn', 'leaf', 'flower'],
    AudioManager: AudioStub, t: (_language: string, key: string) => key, icon: () => '',
    Capacitor: { isNativePlatform: () => false }, confirm: () => true,
    setTimeout: (callback: () => void, ms: number) => { timers.set(++timerId, { callback, ms }); return timerId; },
    clearTimeout: (id: number) => timers.delete(id),
  });
  vm.runInContext(stateCode, context);
  Object.assign(context, stateExports);
  vm.runInContext(mainCode, context);
  return {
    element, run: (code: string) => vm.runInContext(code, context),
    resultTimers: () => [...timers.values()].filter(timer => timer.ms === 300),
    flushResults: () => [...timers.values()].filter(timer => timer.ms === 300).forEach(timer => timer.callback()),
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
  vm.runInNewContext(engineCode, { exports: engineExports });
  vm.runInNewContext(boardCode, {
    exports: boardExports,
    require: (name: string) => name === 'phaser' ? { default: {
      Scene: PhaserSceneStub,
      Scenes: { Events: { PAUSE: 'pause', RESUME: 'resume', SLEEP: 'sleep', SHUTDOWN: 'shutdown' } },
    } } : engineExports,
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
    expect(h.element('#toast').textContent).toMatch(/Storage is unavailable/);
    expect(h.stored().highestLevel).toBe(2); // 저장 실패가 이전 데이터를 지우지는 않습니다.
    expect(h.run('loadSave().highestLevel')).toBe(2);
  });
});
