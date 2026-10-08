import { describe, expect, it } from 'vitest';
import { BoardEngine, seededRng, type Tile } from '../src/core';

// 규칙이 드러나는 작은 보드를 직접 설정하고 첫 제거 단계를 확인합니다.
function fixture(): BoardEngine {
  const engine = new BoardEngine(8, 8, seededRng(42));
  engine.board = Array.from({ length: 8 }, (_, row) => Array.from({ length: 8 }, (_, col) => ({ kind: (row * 2 + col) % 6 })));
  return engine;
}
function set(engine: BoardEngine, row: number, col: number, kind: number, special?: Tile['special']): void {
  engine.board[row][col] = special ? { kind, special } : { kind };
}

describe('BoardEngine', () => {
  it('초기 매치 없이 합법 이동이 있고 같은 시드는 같은 보드를 만듭니다', () => {
    for (let seed = 0; seed < 30; seed++) {
      const engine = new BoardEngine(8, 8, seededRng(seed));
      expect(engine.findMatches()).toEqual([]);
      expect(engine.hasMoves()).toBe(true);
      expect(engine.board).toEqual(new BoardEngine(8, 8, seededRng(seed)).board);
    }
    const constant = new BoardEngine(3, 3, () => 0);
    expect(constant.findMatches()).toEqual([]);
    expect(constant.hasMoves()).toBe(true);
  });
  it('잘못된 좌표와 대각선, 매치 없는 교환은 보드를 보존합니다', () => {
    const engine = fixture(), before = JSON.stringify(engine.board);
    for (const b of [{ row: -1, col: 0 }, { row: 1, col: 1 }, { row: 0, col: 1 }]) {
      expect(engine.swap({ row: 0, col: 0 }, b)).toEqual({ valid: false, steps: [], collected: [0, 0, 0, 0, 0, 0], score: 0 });
      expect(JSON.stringify(engine.board)).toBe(before);
    }
    engine.hasMoves();
    expect(JSON.stringify(engine.board)).toBe(before);
  });
  it('T 교차의 좌표는 중복되지 않습니다', () => {
    const engine = fixture();
    for (const [row, col] of [[2, 1], [2, 2], [2, 3], [3, 2], [4, 2]]) set(engine, row, col, 5);
    expect(engine.findMatches()).toEqual([{ row: 2, col: 1 }, { row: 2, col: 2 }, { row: 2, col: 3 }, { row: 3, col: 2 }, { row: 4, col: 2 }]);
  });
  it.each([['row', true], ['column', false]] as const)('4매치는 %s 특수를 생성하고 생성 칸을 보존합니다', (special, horizontal) => {
    const engine = fixture();
    const cells = horizontal ? [[2, 0], [2, 1], [2, 2], [3, 3]] : [[0, 2], [1, 2], [2, 2], [3, 3]];
    cells.forEach(([row, col]) => set(engine, row, col, 5));
    set(engine, horizontal ? 2 : 3, horizontal ? 3 : 2, 1);
    const result = engine.swap({ row: 3, col: 3 }, horizontal ? { row: 2, col: 3 } : { row: 3, col: 2 });
    const first = result.steps[0];
    expect(result.valid).toBe(true);
    expect(first.created?.[0].tile.special).toBe(special);
    expect(first.removed).toHaveLength(3);
    expect(first.removed).not.toContainEqual({ row: first.created![0].row, col: first.created![0].col });
    expect(engine.findMatches()).toEqual([]);
  });
  it('5매치는 rainbow를 생성합니다', () => {
    const engine = fixture();
    [0, 1, 3, 4].forEach(col => set(engine, 2, col, 5));
    set(engine, 2, 2, 1); set(engine, 3, 2, 5);
    const result = engine.swap({ row: 3, col: 2 }, { row: 2, col: 2 });
    expect(result.steps[0].created).toEqual([{ row: 2, col: 2, tile: { kind: 5, special: 'rainbow' } }]);
    expect(result.steps[0].removed).toHaveLength(4);
  });
  it('T 매치는 bomb를 생성합니다', () => {
    const engine = fixture();
    [[2, 1], [2, 3], [3, 2], [4, 2], [1, 2]].forEach(([row, col]) => set(engine, row, col, 5));
    set(engine, 2, 2, 0);
    const result = engine.swap({ row: 1, col: 2 }, { row: 2, col: 2 });
    expect(result.steps[0].created?.[0]).toEqual({ row: 2, col: 2, tile: { kind: 5, special: 'bomb' } });
    expect(result.steps[0].removed).toHaveLength(4);
  });
  it('rainbow 교환은 상대 색만 지우고 수집량은 실제 제거 수와 일치합니다', () => {
    const engine = fixture();
    set(engine, 0, 0, 0, 'rainbow'); set(engine, 0, 1, 1);
    const targetCount = engine.board.flat().filter(tile => tile.kind === 1).length;
    const result = engine.swap({ row: 0, col: 0 }, { row: 0, col: 1 });
    expect(result.steps[0].removed).toHaveLength(targetCount + 1);
    const counts = [0, 0, 0, 0, 0, 0];
    result.steps.forEach(step => step.removed.forEach(p => counts[step.before[p.row][p.col].kind]++));
    expect(result.collected).toEqual(counts);
    expect(result.score).toBe(result.steps.reduce((total, step, i) => total + step.removed.length * 10 * (i + 1), 0));
    expect(engine.findMatches()).toEqual([]);
    expect(engine.hasMoves()).toBe(true);
    const snapshot = JSON.stringify(result.steps);
    engine.board[0][0].kind = 5;
    expect(JSON.stringify(result.steps)).toBe(snapshot);
  });
  it('rainbow 두 개는 전체 보드를 한 번씩 제거합니다', () => {
    const engine = fixture();
    set(engine, 0, 0, 0, 'rainbow'); set(engine, 0, 1, 1, 'rainbow');
    const result = engine.swap({ row: 0, col: 0 }, { row: 0, col: 1 });
    expect(result.steps[0].removed).toHaveLength(64);
    expect(new Set(result.steps[0].removed.map(p => `${p.row},${p.col}`)).size).toBe(64);
  });
  it('줄 특수 조합에 맞은 bomb는 연쇄 발동합니다', () => {
    const engine = fixture();
    set(engine, 3, 3, 3, 'row'); set(engine, 3, 4, 4, 'column'); set(engine, 3, 6, 0, 'bomb');
    const result = engine.swap({ row: 3, col: 3 }, { row: 3, col: 4 });
    expect(result.steps[0].removed).toContainEqual({ row: 2, col: 7 });
    expect(result.steps[0].removed).toContainEqual({ row: 4, col: 7 });
  });
  it('셔플 결과는 매치 없이 이동 가능하고 정상 구성의 타일을 보존합니다', () => {
    const engine = fixture();
    const signature = () => engine.board.flat().map(tile => `${tile.kind}:${tile.special ?? ''}`).sort();
    set(engine, 0, 0, 0, 'bomb');
    const before = signature();
    expect(engine.hasMoves()).toBe(false);
    engine.shuffle();
    expect(signature()).toEqual(before);
    expect(engine.findMatches()).toEqual([]);
    expect(engine.hasMoves()).toBe(true);
  });
  it('낙하 순서를 보존하고 연쇄 단계의 스냅샷을 연결합니다', () => {
    const engine = fixture();
    set(engine, 3, 0, 5); set(engine, 3, 1, 5); set(engine, 3, 2, 1); set(engine, 4, 2, 5);
    const result = engine.swap({ row: 4, col: 2 }, { row: 3, col: 2 });
    expect(result.valid).toBe(true);
    for (let i = 0; i < result.steps.length; i++) {
      const step = result.steps[i];
      if (i > 0) expect(step.before).toEqual(result.steps[i - 1].after);
      if (!step.removed.length) continue;
      for (let col = 0; col < 8; col++) {
        const survivors = step.before.map((row, index) => ({ tile: row[col], row: index }))
          .filter(item => !step.removed.some(p => p.row === item.row && p.col === col))
          .map(item => step.created?.find(p => p.row === item.row && p.col === col)?.tile ?? item.tile);
        expect(step.after.slice(8 - survivors.length).map(row => row[col])).toEqual(survivors);
      }
    }
    expect(result.steps.at(-1)?.after).toEqual(engine.board);
  });
  it('L 교차도 bomb를 생성합니다', () => {
    const engine = fixture();
    [[2, 1], [2, 2], [3, 1], [4, 1], [1, 3]].forEach(([row, col]) => set(engine, row, col, 5));
    set(engine, 5, 1, 2);
    set(engine, 2, 3, 1);
    const result = engine.swap({ row: 1, col: 3 }, { row: 2, col: 3 });
    expect(result.steps[0].created?.[0].tile.special).toBe('bomb');
    expect(result.steps[0].removed).toHaveLength(4);
  });
  it('bomb 두 개는 각각 반경 2를 제거합니다', () => {
    const engine = fixture();
    set(engine, 3, 3, 3, 'bomb'); set(engine, 3, 4, 4, 'bomb');
    const result = engine.swap({ row: 3, col: 3 }, { row: 3, col: 4 });
    expect(result.steps[0].removed).toHaveLength(30);
  });
  it('rainbow와 줄 특수를 교환하면 해당 색의 줄도 발동합니다', () => {
    const engine = fixture();
    set(engine, 0, 0, 0, 'rainbow'); set(engine, 0, 1, 1, 'row');
    const result = engine.swap({ row: 0, col: 0 }, { row: 0, col: 1 });
    expect(result.steps[0].removed).toHaveLength(64);
  });
  it('상수 난수의 보충도 연쇄를 종료합니다', () => {
    const engine = new BoardEngine(3, 3, () => 0);
    engine.board = [[{ kind: 0, special: 'rainbow' }, { kind: 1, special: 'rainbow' }, { kind: 2 }], [{ kind: 2 }, { kind: 3 }, { kind: 4 }], [{ kind: 4 }, { kind: 5 }, { kind: 0 }]];
    const result = engine.swap({ row: 0, col: 0 }, { row: 0, col: 1 });
    expect(result.steps.length).toBeGreaterThan(1);
    expect(result.steps.length).toBeLessThan(60);
    expect(engine.findMatches()).toEqual([]);
    expect(engine.hasMoves()).toBe(true);
  });
  it('여러 게임의 합법 이동을 반복해도 최종 보드와 수집 수를 유지합니다', () => {
    for (let seed = 0; seed < 10; seed++) {
      const engine = new BoardEngine(8, 8, seededRng(seed));
      for (let turn = 0; turn < 15; turn++) {
        let played = false;
        for (let row = 0; row < 8 && !played; row++) for (let col = 0; col < 8 && !played; col++) {
          for (const b of [{ row, col: col + 1 }, { row: row + 1, col }]) {
            const result = engine.swap({ row, col }, b);
            if (!result.valid) continue;
            expect(result.collected.reduce((total, count) => total + count, 0)).toBe(result.steps.reduce((total, step) => total + step.removed.length, 0));
            expect(engine.findMatches()).toEqual([]);
            expect(engine.hasMoves()).toBe(true);
            expect(engine.board.flat()).toHaveLength(64);
            expect(engine.board.flat().every(tile => tile.kind >= 0 && tile.kind <= 5)).toBe(true);
            played = true;
            break;
          }
        }
        expect(played).toBe(true);
      }
    }
  });
});
