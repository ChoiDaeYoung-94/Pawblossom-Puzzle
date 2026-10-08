export type Special = 'row' | 'column' | 'bomb' | 'rainbow';
export interface Tile { kind: number; special?: Special }
export interface Position { row: number; col: number }
export interface ResolveStep {
  before: Tile[][];
  removed: Position[];
  after: Tile[][];
  created?: (Position & { tile: Tile })[];
}
export interface SwapResult {
  valid: boolean;
  steps: ResolveStep[];
  collected: number[];
  score: number;
}
interface Run { cells: Position[]; horizontal: boolean }
const clone = (board: Tile[][]): Tile[][] => board.map(row => row.map(tile => ({ ...tile })));

/** 재현 가능한 Mulberry32 난수 생성기입니다. */
export function seededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** 순수 동기 엔진입니다. board를 직접 바꿀 때는 크기와 kind 범위를 유지해 주세요. */
export class BoardEngine {
  public board: Tile[][];
  constructor(public readonly rows = 8, public readonly cols = 8, private readonly rng: () => number = Math.random) {
    if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 3 || cols < 3) {
      throw new RangeError('보드의 행과 열은 각각 3 이상의 정수여야 합니다.');
    }
    this.board = [];
    this.generate();
  }

  private randomIndex(length: number): number {
    const value = this.rng();
    if (!Number.isFinite(value) || value < 0 || value >= 1) throw new RangeError('rng는 0 이상 1 미만이어야 합니다.');
    return Math.floor(value * length);
  }
  private key(p: Position): number { return p.row * this.cols + p.col; }
  private position(key: number): Position { return { row: Math.floor(key / this.cols), col: key % this.cols }; }
  private inside(p: Position): boolean {
    return Number.isInteger(p.row) && Number.isInteger(p.col) && p.row >= 0 && p.row < this.rows && p.col >= 0 && p.col < this.cols;
  }
  private exchange(a: Position, b: Position): void {
    [this.board[a.row][a.col], this.board[b.row][b.col]] = [this.board[b.row][b.col], this.board[a.row][a.col]];
  }
  private runs(): Run[] {
    const result: Run[] = [];
    for (const horizontal of [true, false]) {
      const lines = horizontal ? this.rows : this.cols;
      const length = horizontal ? this.cols : this.rows;
      for (let line = 0; line < lines; line++) {
        let start = 0;
        while (start < length) {
          const pos = (offset: number): Position => horizontal ? { row: line, col: offset } : { row: offset, col: line };
          const first = pos(start);
          const kind = this.board[first.row][first.col].kind;
          let end = start + 1;
          while (end < length) {
            const p = pos(end);
            if (this.board[p.row][p.col].kind !== kind) break;
            end++;
          }
          if (end - start >= 3) result.push({ horizontal, cells: Array.from({ length: end - start }, (_, i) => pos(start + i)) });
          start = end;
        }
      }
    }
    return result;
  }
  public findMatches(): Position[] {
    return [...new Set(this.runs().flatMap(run => run.cells.map(p => this.key(p))))].sort((a, b) => a - b).map(key => this.position(key));
  }
  private specialSwap(a: Position, b: Position): boolean {
    const x = this.board[a.row][a.col].special;
    const y = this.board[b.row][b.col].special;
    return x === 'rainbow' || y === 'rainbow' || (!!x && !!y);
  }
  public hasMoves(): boolean {
    for (let row = 0; row < this.rows; row++) for (let col = 0; col < this.cols; col++) {
      const a = { row, col };
      for (const b of [{ row, col: col + 1 }, { row: row + 1, col }]) {
        if (!this.inside(b)) continue;
        if (this.specialSwap(a, b)) return true;
        this.exchange(a, b);
        const matches = this.findMatches();
        this.exchange(a, b);
        if (matches.some(p => this.key(p) === this.key(a) || this.key(p) === this.key(b))) return true;
      }
    }
    return false;
  }
  private generate(): void {
    for (let attempt = 0; attempt < 100; attempt++) {
      this.board = Array.from({ length: this.rows }, () => [] as Tile[]);
      for (let row = 0; row < this.rows; row++) for (let col = 0; col < this.cols; col++) {
        const choices = [0, 1, 2, 3, 4, 5].filter(kind =>
          !(col >= 2 && this.board[row][col - 1].kind === kind && this.board[row][col - 2].kind === kind) &&
          !(row >= 2 && this.board[row - 1][col].kind === kind && this.board[row - 2][col].kind === kind));
        this.board[row][col] = { kind: choices[this.randomIndex(choices.length)] };
      }
      if (this.hasMoves()) return;
    }
    // 상수 난수에서도 종료하도록 좌상단에 한 번의 합법 이동을 만듭니다.
    this.board = Array.from({ length: this.rows }, (_, row) => Array.from({ length: this.cols }, (_, col) => ({ kind: (row * 2 + col) % 6 })));
    this.board[0][0] = { kind: 0 }; this.board[0][1] = { kind: 1 }; this.board[0][2] = { kind: 0 }; this.board[1][1] = { kind: 0 };
  }
  /** 타일과 특수를 보존해 섞습니다. 불가능한 구성은 새 일반 보드로 대체합니다. */
  public shuffle(): void {
    const tiles = this.board.flat().map(tile => ({ ...tile }));
    for (let attempt = 0; attempt < 300; attempt++) {
      for (let i = tiles.length - 1; i > 0; i--) {
        const j = this.randomIndex(i + 1);
        [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
      }
      this.board = Array.from({ length: this.rows }, (_, row) => tiles.slice(row * this.cols, (row + 1) * this.cols).map(tile => ({ ...tile })));
      if (!this.findMatches().length && this.hasMoves()) return;
    }
    this.generate();
  }

  private creations(runs: Run[], preferred: Position[]): (Position & { tile: Tile })[] {
    const groups: Run[][] = [];
    for (const run of runs) {
      const touching = groups.filter(group => group.some(other => other.cells.some(p => run.cells.some(q => this.key(p) === this.key(q)))));
      const group = [run, ...touching.flat()];
      for (const old of touching) groups.splice(groups.indexOf(old), 1);
      groups.push(group);
    }
    return groups.flatMap(group => {
      const long = group.find(run => run.cells.length >= 5);
      const cross = group.some(run => run.horizontal) && group.some(run => !run.horizontal);
      const four = group.find(run => run.cells.length >= 4);
      const special: Special | undefined = long ? 'rainbow' : cross ? 'bomb' : four ? (four.horizontal ? 'row' : 'column') : undefined;
      if (!special) return [];
      const cells = group.flatMap(run => run.cells);
      const intersection = cells.find(p => group.filter(run => run.cells.some(q => this.key(p) === this.key(q))).length > 1);
      const anchor = preferred.find(p => cells.some(q => this.key(p) === this.key(q))) ?? (cross ? intersection : undefined) ?? (long ?? four ?? group[0]).cells[0];
      // 기존 특수는 발동해야 하므로 새 특수 생성 위치로 사용하지 않습니다.
      const available = this.board[anchor.row][anchor.col].special ? cells.find(p => !this.board[p.row][p.col].special) : anchor;
      return available ? [{ ...available, tile: { kind: this.board[available.row][available.col].kind, special } }] : [];
    });
  }

  public swap(a: Position, b: Position): SwapResult {
    const result: SwapResult = { valid: false, steps: [], collected: [0, 0, 0, 0, 0, 0], score: 0 };
    if (!this.inside(a) || !this.inside(b) || Math.abs(a.row - b.row) + Math.abs(a.col - b.col) !== 1) return result;
    const combined = this.specialSwap(a, b);
    this.exchange(a, b);
    let runs = this.runs();
    if (!combined && !runs.some(run => run.cells.some(p => this.key(p) === this.key(a) || this.key(p) === this.key(b)))) {
      this.exchange(a, b);
      return result;
    }
    result.valid = true;
    let first = true;
    while (runs.length || (first && combined)) {
      const before = clone(this.board);
      const created = first && combined ? [] : this.creations(runs, first ? [b, a] : []);
      const protectedKeys = new Set(created.map(p => this.key(p)));
      const removed = new Set<number>();
      const queue: Position[] = [];
      const add = (p: Position): void => {
        if (!this.inside(p) || protectedKeys.has(this.key(p)) || removed.has(this.key(p))) return;
        removed.add(this.key(p)); queue.push(p);
      };
      const area = (p: Position, radius: number): void => {
        for (let row = p.row - radius; row <= p.row + radius; row++) for (let col = p.col - radius; col <= p.col + radius; col++) add({ row, col });
      };
      runs.forEach(run => run.cells.forEach(add));
      if (first && combined) {
        const x = before[a.row][a.col], y = before[b.row][b.col];
        add(a); add(b);
        if (x.special === 'rainbow' || y.special === 'rainbow') {
          const other = x.special === 'rainbow' ? y : x;
          for (let row = 0; row < this.rows; row++) for (let col = 0; col < this.cols; col++) {
            if (other.special === 'rainbow' || before[row][col].kind === other.kind) {
              if (other.special && other.special !== 'rainbow' && !protectedKeys.has(row * this.cols + col)) this.board[row][col].special = other.special;
              add({ row, col });
            }
          }
        } else if (x.special === 'bomb' && y.special === 'bomb') {
          area(a, 2); area(b, 2);
        } else if (x.special === 'bomb' || y.special === 'bomb') {
          const center = x.special === 'bomb' ? a : b;
          for (let row = 0; row < this.rows; row++) for (let col = 0; col < this.cols; col++) {
            if (Math.abs(row - center.row) <= 1 || Math.abs(col - center.col) <= 1) add({ row, col });
          }
        } else {
          // 줄 특수 두 개는 교환 위치 두 곳에서 가로·세로를 모두 지웁니다.
          for (const center of [a, b]) for (let row = 0; row < this.rows; row++) for (let col = 0; col < this.cols; col++) {
            if (row === center.row || col === center.col) add({ row, col });
          }
        }
      }
      for (let i = 0; i < queue.length; i++) {
        const p = queue[i], tile = this.board[p.row][p.col];
        if (tile.special === 'row') for (let col = 0; col < this.cols; col++) add({ row: p.row, col });
        if (tile.special === 'column') for (let row = 0; row < this.rows; row++) add({ row, col: p.col });
        if (tile.special === 'bomb') area(p, 1);
        if (tile.special === 'rainbow' && !(first && combined && (this.key(p) === this.key(a) || this.key(p) === this.key(b)))) for (let row = 0; row < this.rows; row++) for (let col = 0; col < this.cols; col++) {
          if (this.board[row][col].kind === tile.kind) add({ row, col });
        }
      }
      const positions = [...removed].sort((x, y) => x - y).map(key => this.position(key));
      positions.forEach(p => { result.collected[before[p.row][p.col].kind]++; });
      result.score += positions.length * 10 * (result.steps.length + 1);
      created.forEach(p => { this.board[p.row][p.col] = { ...p.tile }; });
      const next: (Tile | undefined)[][] = Array.from({ length: this.rows }, () => Array(this.cols).fill(undefined));
      for (let col = 0; col < this.cols; col++) {
        const survivors = this.board.map(row => row[col]).filter((_, row) => !removed.has(row * this.cols + col));
        survivors.forEach((tile, i) => { next[this.rows - survivors.length + i][col] = { ...tile }; });
      }
      for (let row = 0; row < this.rows; row++) for (let col = 0; col < this.cols; col++) if (!next[row][col]) {
        let choices = [0, 1, 2, 3, 4, 5];
        // 비정상적인 상수 rng에서도 연쇄가 유한 시간 안에 종료되도록 합니다.
        if (result.steps.length >= 50) choices = choices.filter(kind => {
          for (const [dr, dc] of [[1, 0], [0, 1]]) for (let offset = -2; offset <= 0; offset++) {
            const cells = [0, 1, 2].map(i => next[row + (offset + i) * dr]?.[col + (offset + i) * dc]);
            if (cells.every((tile, i) => offset + i === 0 || tile?.kind === kind)) return false;
          }
          return true;
        });
        next[row][col] = { kind: choices[this.randomIndex(choices.length)] };
      }
      this.board = next as Tile[][];
      result.steps.push({ before, removed: positions, after: clone(this.board), ...(created.length ? { created: created.map(p => ({ ...p, tile: { ...p.tile } })) } : {}) });
      first = false;
      runs = this.runs();
    }
    if (!this.hasMoves()) {
      const before = clone(this.board);
      this.shuffle();
      result.steps.push({ before, removed: [], after: clone(this.board) });
    }
    return result;
  }
}
