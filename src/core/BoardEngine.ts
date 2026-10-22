export type Special = 'row' | 'column' | 'bomb' | 'rainbow';
export type RuleVersion = 1 | 2;
export interface Tile { kind: number; special?: Special }
export type Cell = Tile | null;
export type BoardMask = readonly (readonly boolean[])[];
export interface BoardSnapshot { board: Cell[][]; leaves: number[][]; ruleVersion?: RuleVersion; crates?: number[][] }
/** from 부재는 새 타일이며 startRow는 해당 세로 구간의 보충 시작점입니다. */
export interface Fall { from?: Position; to: Position; startRow: number }
export interface Position { row: number; col: number }
export interface LeafPile extends Position { layers: 1 | 2 }
export interface LeafHit extends Position { before: number; after: number }
export interface LegalMove { a: Position; b: Position }
export interface ResolveStep {
  before: Cell[][];
  removed: Position[];
  after: Cell[][];
  falls?: Fall[];
  created?: (Position & { tile: Tile })[];
  effects?: (Position & { special: Special })[];
  leaves?: { before: number[][]; after: number[][]; hits: LeafHit[] };
  crates?: { before: number[][]; after: number[][]; hits: Position[] };
}
export interface SwapResult {
  valid: boolean;
  steps: ResolveStep[];
  collected: number[];
  score: number;
  leavesCleared?: number;
  cratesCleared?: number;
}
interface Run { cells: Position[]; horizontal?: boolean; square?: true }
const clone = (board: Cell[][]): Cell[][] => board.map(row => row.map(tile => tile ? { ...tile } : null));

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
  public board: Cell[][];
  public readonly mask: BoardMask;
  public leaves: number[][];
  public crates: number[][];
  public readonly hasCrates:boolean;
  public readonly ruleVersion:RuleVersion;
  constructor(public readonly rows = 8, public readonly cols = 8, private readonly rng: () => number = Math.random, snapshot?: BoardSnapshot, ruleVersion?:RuleVersion, mask?:BoardMask, cratePositions?:readonly Position[]) {
    if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 3 || cols < 3) {
      throw new RangeError('보드의 행과 열은 각각 3 이상의 정수여야 합니다.');
    }
    const saved=snapshot?.ruleVersion;
    const rules=ruleVersion===undefined?(snapshot?(saved===undefined?1:saved):2):ruleVersion;
    if((rules!==1&&rules!==2)||(saved!==undefined&&saved!==rules))throw new RangeError('지원하지 않거나 일치하지 않는 회차 규칙입니다.');
    this.ruleVersion=rules;
    if(mask&&(mask.length!==rows||mask.some(row=>row.length!==cols||row.some(cell=>typeof cell!=='boolean'))))throw new RangeError('mask 크기와 활성 칸을 확인해 주세요.');
    this.mask=Object.freeze(Array.from({length:rows},(_,r)=>Object.freeze(Array.from({length:cols},(_,c)=>mask?.[r][c]??true))));
    this.hasCrates=Boolean(cratePositions?.length||snapshot?.crates!==undefined);
    this.crates=Array.from({length:rows},()=>Array(cols).fill(0));
    for(const p of cratePositions??[]){if(!this.isActive(p)||this.crates[p.row][p.col])throw new RangeError('상자 좌표·중복을 확인해 주세요.');this.crates[p.row][p.col]=1;}
    if(this.hasCrates&&rules!==2)throw new RangeError('상자는 V2 규칙에서만 지원합니다.');
    if(snapshot&&this.hasCrates){
      const grid=snapshot.crates;
      const invalid=()=>new RangeError('저장 상자가 canonical 좌표와 일치하지 않습니다.');
      if(!Array.isArray(grid)||grid.length!==rows)throw invalid();
      for(let r=0;r<rows;r++){
        if(!Object.hasOwn(grid,r)||!Array.isArray(grid[r])||grid[r].length!==cols)throw invalid();
        for(let c=0;c<cols;c++){
          const n=grid[r][c];
          if(!Object.hasOwn(grid[r],c)||(n!==0&&n!==1)||n===1&&(!this.mask[r][c]||cratePositions!==undefined&&!this.crates[r][c]))throw invalid();
        }
      }
      this.crates=grid.map(line=>line.slice());
    }
    if(!this.hasCrates&&!this.fallbackOrigin()||this.hasCrates&&!this.crateMotifs().length)throw new RangeError('보드에는 합법 교환을 만들 수 있는 열린 구간이 필요합니다.');
    if(snapshot&&(snapshot.board.length!==rows||snapshot.leaves.length!==rows||snapshot.board.some((row,r)=>row.length!==cols||row.some((tile,c)=>this.isPlayable({row:r,col:c})?!tile:tile!==null))||snapshot.leaves.some((row,r)=>row.length!==cols||row.some((n,c)=>!this.isPlayable({row:r,col:c})&&n!==0))))throw new RangeError('저장판과 canonical mask·상자가 일치하지 않습니다.');
    // 저장 검증을 마친 스냅샷은 초기 생성 난수를 소비하지 않고 복원합니다.
    this.board = snapshot ? clone(snapshot.board) : [];
    this.leaves = snapshot ? snapshot.leaves.map(row=>row.slice()) : Array.from({length:rows},()=>Array(cols).fill(0));
    if(!snapshot)this.generate();
  }

  /** 낙엽은 타일과 별개인 고정 바닥층입니다. 잘못된 설정은 기존 층을 바꾸지 않습니다. */
  public setLeaves(piles: LeafPile[]): void {
    const keys=new Set<number>();
    for(const pile of piles){
      if(!this.isPlayable(pile)||(pile.layers!==1&&pile.layers!==2)||keys.has(this.key(pile)))throw new RangeError('낙엽 좌표·겹 수·중복 설정을 확인해 주세요.');
      keys.add(this.key(pile));
    }
    this.leaves=Array.from({length:this.rows},()=>Array(this.cols).fill(0));
    piles.forEach(p=>{this.leaves[p.row][p.col]=p.layers;});
  }
  public remainingLeaves(): number {return this.leaves.flat().filter(layers=>layers>0).length;}
  public remainingCrates():number {return this.crates.flat().filter(Boolean).length;}

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
  public isActive(p:Position):boolean {return this.inside(p)&&this.mask[p.row][p.col];}
  public isPlayable(p:Position):boolean {return this.isActive(p)&&this.crates[p.row][p.col]===0;}
  private crateMotifs():Position[][] {
    const motifs:Position[][]=[];
    for(const vertical of [false,true])for(let row=0;row<this.rows;row++)for(let col=0;col<this.cols;col++){
      const cells=[0,1].flatMap(r=>[0,1,2].map(c=>({row:row+(vertical?c:r),col:col+(vertical?r:c)})));
      if(cells.every(p=>this.isPlayable(p)))motifs.push(cells);
    }
    return motifs;
  }
  /** RNG를 추가 소비하지 않는 유한 fallback. 고정 2×3 모티프 주변도 매치 없이 채웁니다. */
  private generateCrateFallback():void {
    for(const motif of this.crateMotifs()){
      this.board=this.mask.map(line=>line.map(()=>null));
      motif.forEach((p,i)=>{this.board[p.row][p.col]={kind:[0,1,0,2,0,3][i]};});
      let valid=true;
      for(let row=0;row<this.rows&&valid;row++)for(let col=0;col<this.cols;col++)if(this.isPlayable({row,col})&&!this.board[row][col]){
        let found=false;
        for(let kind=0;kind<6;kind++){this.board[row][col]={kind};if(!this.findMatches().length){found=true;break;}}
        if(!found){valid=false;break;}
      }
      if(valid&&!this.findMatches().length&&this.hasMoves())return;
    }
    throw new RangeError('상자 배치에 안정적인 합법 교환을 만들 수 없습니다.');
  }
  private fallbackOrigin():Position|undefined {
    for(let row=0;row<=this.rows-3;row++)for(let col=0;col<=this.cols-3;col++)if([0,1,2].every(dr=>[0,1,2].every(dc=>this.mask[row+dr][col+dc])))return {row,col};
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
          const tile=this.board[first.row][first.col];
          if(!tile){start++;continue;}
          const kind = tile.kind;
          let end = start + 1;
          while (end < length) {
            const p = pos(end);
            if (this.board[p.row][p.col]?.kind !== kind) break;
            end++;
          }
          if (end - start >= 3) result.push({ horizontal, cells: Array.from({ length: end - start }, (_, i) => pos(start + i)) });
          start = end;
        }
      }
    }
    if(this.ruleVersion===2)for(let row=0;row<this.rows-1;row++)for(let col=0;col<this.cols-1;col++){
      const cells=[{row,col},{row,col:col+1},{row:row+1,col},{row:row+1,col:col+1}];
      if(this.board[row][col]&&cells.every(p=>this.board[p.row][p.col]?.kind===this.board[row][col]!.kind))result.push({cells,square:true});
    }
    return result;
  }
  public findMatches(): Position[] {
    return [...new Set(this.runs().flatMap(run => run.cells.map(p => this.key(p))))].sort((a, b) => a - b).map(key => this.position(key));
  }
  private specialSwap(a: Position, b: Position): boolean {
    const x = this.board[a.row][a.col]!.special;
    const y = this.board[b.row][b.col]!.special;
    return Boolean(x || y);
  }
  /** 보드와 보충 난수를 소비하지 않는 합법 이동 조회입니다. */
  public legalMoves(): LegalMove[] { return [...this.scanMoves()]; }
  public hasMoves(): boolean { return !this.scanMoves().next().done; }
  private *scanMoves(): Generator<LegalMove> {
    for (let row = 0; row < this.rows; row++) for (let col = 0; col < this.cols; col++) {
      const a = { row, col };
      if(!this.isPlayable(a))continue;
      for (const b of [{ row, col: col + 1 }, { row: row + 1, col }]) {
        if (!this.isPlayable(b)) continue;
        if (this.specialSwap(a, b)) { yield {a,b}; continue; }
        this.exchange(a, b);
        const matches = this.findMatches();
        this.exchange(a, b);
        if (matches.some(p => this.key(p) === this.key(a) || this.key(p) === this.key(b))) yield {a,b};
      }
    }
  }
  private generate(): void {
    for (let attempt = 0; attempt < 100; attempt++) {
      this.board = Array.from({ length: this.rows }, () => [] as Cell[]);
      for (let row = 0; row < this.rows; row++) for (let col = 0; col < this.cols; col++) {
        if(!this.isPlayable({row,col})){this.board[row][col]=null;continue;}
        const choices = [0, 1, 2, 3, 4, 5].filter(kind =>
          !(col >= 2 && this.board[row][col - 1]?.kind === kind && this.board[row][col - 2]?.kind === kind) &&
          !(row >= 2 && this.board[row - 1][col]?.kind === kind && this.board[row - 2][col]?.kind === kind) &&
          !(this.ruleVersion===2&&row>0&&col>0&&this.board[row-1][col]?.kind===kind&&this.board[row][col-1]?.kind===kind&&this.board[row-1][col-1]?.kind===kind));
        this.board[row][col] = { kind: choices[this.randomIndex(choices.length)] };
      }
      if (this.hasMoves()) return;
    }
    // 전체 판에서는 기존 좌상단 패턴·RNG 순서를 유지하며 mask에서는 활성 3×3 안으로 옮깁니다.
    if(this.hasCrates){this.generateCrateFallback();return;}
    const origin=this.fallbackOrigin()!;
    this.board = this.mask.map((line,row)=>line.map((active,col)=>active?{kind:(((row-origin.row)*2+col-origin.col)%6+6)%6}:null));
    this.board[origin.row][origin.col+2] = {kind:0};this.board[origin.row+1][origin.col+1] = {kind:0};
  }
  /** 타일과 특수를 보존해 섞습니다. 불가능한 구성은 새 일반 보드로 대체합니다. */
  public shuffle(): void {
    const tiles = this.board.flat().filter((tile):tile is Tile=>tile!==null).map(tile => ({ ...tile }));
    for (let attempt = 0; attempt < 300; attempt++) {
      for (let i = tiles.length - 1; i > 0; i--) {
        const j = this.randomIndex(i + 1);
        [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
      }
      let index=0;this.board=this.mask.map((line,row)=>line.map((_,col)=>this.isPlayable({row,col})?{...tiles[index++]}:null));
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
      const long = group.find(run => !run.square&&run.cells.length >= 5);
      const cross = group.some(run => run.horizontal===true) && group.some(run => run.horizontal===false);
      const square=group.find(run=>run.square);
      const four = group.find(run => !run.square&&run.cells.length >= 4);
      const special: Special | undefined = long ? 'rainbow' : cross||square ? 'bomb' : four ? (four.horizontal ? 'row' : 'column') : undefined;
      if (!special) return [];
      const cells = group.flatMap(run => run.cells);
      const intersection = cells.find(p => group.filter(run => run.cells.some(q => this.key(p) === this.key(q))).length > 1);
      const anchor = preferred.find(p => cells.some(q => this.key(p) === this.key(q))) ?? (cross ? intersection : undefined) ?? (long ?? four ?? group[0]).cells[0];
      // 기존 특수는 발동해야 하므로 새 특수 생성 위치로 사용하지 않습니다.
      const available = this.board[anchor.row][anchor.col]!.special ? cells.find(p => !this.board[p.row][p.col]!.special) : anchor;
      return available ? [{ ...available, tile: { kind: this.board[available.row][available.col]!.kind, special } }] : [];
    });
  }

  public swap(a: Position, b: Position): SwapResult {
    const result: SwapResult = { valid: false, steps: [], collected: [0, 0, 0, 0, 0, 0], score: 0 };
    if (!this.isPlayable(a) || !this.isPlayable(b) || Math.abs(a.row - b.row) + Math.abs(a.col - b.col) !== 1) return result;
    const combined = this.specialSwap(a, b);
    this.exchange(a, b);
    const runs = this.runs();
    if (!combined && !runs.some(run => run.cells.some(p => this.key(p) === this.key(a) || this.key(p) === this.key(b)))) {
      this.exchange(a, b);
      return result;
    }
    return this.resolve(a,b,combined);
  }
  /** 특수블록은 매치 없이 탭으로 사용할 수 있습니다. rainbow 탭은 자체 색을 제거합니다. */
  public activate(p:Position):SwapResult {
    if(!this.isPlayable(p)||!this.board[p.row][p.col]!.special)return {valid:false,steps:[],collected:[0,0,0,0,0,0],score:0};
    return this.resolve(p,p,false,[p]);
  }
  private resolve(a:Position,b:Position,combined:boolean,trigger:Position[]=[]):SwapResult {
    const result:SwapResult={valid:true,steps:[],collected:[0,0,0,0,0,0],score:0};
    let runs=this.runs();
    let first = true;
    while (runs.length || (first && (combined||trigger.length))) {
      const before = clone(this.board);
      const created = first && (combined||trigger.length) ? [] : this.creations(runs, first ? [b, a] : []);
      const protectedKeys = new Set(created.map(p => this.key(p)));
      const removed = new Set<number>();
      const queue: Position[] = [];
      const effects: (Position & { special: Special })[] = [];
      const specialTargets=new Set<number>();
      const crateTargets=new Set<number>();
      const add = (p: Position): void => {
        if (!this.isPlayable(p) || protectedKeys.has(this.key(p)) || removed.has(this.key(p))) return;
        removed.add(this.key(p)); queue.push(p);
      };
      const hit=(p:Position):void=>{if(this.isActive(p)){specialTargets.add(this.key(p));if(this.crates[p.row][p.col])crateTargets.add(this.key(p));}add(p);};
      const area = (p: Position, radius: number): void => {
        for (let row = p.row - radius; row <= p.row + radius; row++) for (let col = p.col - radius; col <= p.col + radius; col++) hit({ row, col });
      };
      runs.forEach(run => run.cells.forEach(add));
      if(first)trigger.forEach(add);
      if (first && combined) {
        const x = before[a.row][a.col]!, y = before[b.row][b.col]!;
        if(x.special)hit(a);if(y.special)hit(b);
        if (x.special === 'rainbow' || y.special === 'rainbow') {
          const other = x.special === 'rainbow' ? y : x;
          for (let row = 0; row < this.rows; row++) for (let col = 0; col < this.cols; col++) {
            if (this.mask[row][col]&&(other.special === 'rainbow' || before[row][col]?.kind === other.kind)) {
              if (other.special && other.special !== 'rainbow' && this.board[row][col] && !protectedKeys.has(row * this.cols + col)) this.board[row][col]!.special = other.special;
              hit({ row, col });
            }
          }
        } else if (!x.special || !y.special) {
          // 단일 특수와 일반 블록의 교환은 해당 특수의 원래 범위를 발동합니다.
        } else if (x.special === 'bomb' && y.special === 'bomb') {
          area(a, 2); area(b, 2);
        } else if (x.special === 'bomb' || y.special === 'bomb') {
          const center = x.special === 'bomb' ? a : b;
          for (let row = 0; row < this.rows; row++) for (let col = 0; col < this.cols; col++) {
            if (Math.abs(row - center.row) <= 1 || Math.abs(col - center.col) <= 1) hit({ row, col });
          }
        } else {
          // 줄 특수 두 개는 교환 위치 두 곳에서 가로·세로를 모두 지웁니다.
          for (const center of [a, b]) for (let row = 0; row < this.rows; row++) for (let col = 0; col < this.cols; col++) {
            if (row === center.row || col === center.col) hit({ row, col });
          }
        }
      }
      for (let i = 0; i < queue.length; i++) {
        const p = queue[i], tile = this.board[p.row][p.col]!;
        if(tile.special)effects.push({...p,special:tile.special});
        if (tile.special === 'row') for (let col = 0; col < this.cols; col++) hit({ row: p.row, col });
        if (tile.special === 'column') for (let row = 0; row < this.rows; row++) hit({ row, col: p.col });
        if (tile.special === 'bomb') area(p, 1);
        if (tile.special === 'rainbow' && !(first && combined && (this.key(p) === this.key(a) || this.key(p) === this.key(b)))) for (let row = 0; row < this.rows; row++) for (let col = 0; col < this.cols; col++) {
          if (this.board[row][col]?.kind === tile.kind) hit({ row, col });
        }
      }
      const leafTargets=new Set(specialTargets);
      // 한 단계에서 여러 매치가 같은 더미에 닿아도 한 겹만 제거합니다. 대각선은 제외합니다.
      for(const run of runs)for(const p of run.cells)for(const [dr,dc] of [[0,0],[-1,0],[1,0],[0,-1],[0,1]]){
        const q={row:p.row+dr,col:p.col+dc};if(this.isActive(q)){leafTargets.add(this.key(q));if(this.crates[q.row][q.col])crateTargets.add(this.key(q));}
      }
      const crateHits=[...crateTargets].sort((x,y)=>x-y).map(key=>this.position(key));
      const crateBefore=crateHits.length?this.crates.map(row=>row.slice()):undefined;
      crateHits.forEach(p=>{this.crates[p.row][p.col]=0;});
      if(crateHits.length)result.cratesCleared=(result.cratesCleared??0)+crateHits.length;
      const leafHits:LeafHit[]=[...leafTargets].sort((x,y)=>x-y).flatMap(key=>{
        const p=this.position(key),before=this.leaves[p.row][p.col];
        return before>0?[{...p,before,after:specialTargets.has(key)?0:before-1}]:[];
      });
      const leafBefore=leafHits.length?this.leaves.map(row=>row.slice()):undefined;
      leafHits.forEach(p=>{this.leaves[p.row][p.col]=p.after;});
      const cleared=leafHits.filter(p=>p.after===0).length;
      if(cleared)result.leavesCleared=(result.leavesCleared??0)+cleared;
      const positions = [...removed].sort((x, y) => x - y).map(key => this.position(key));
      positions.forEach(p => { result.collected[before[p.row][p.col]!.kind]++; });
      result.score += positions.length * 10 * (result.steps.length + 1)+cleared*20;
      created.forEach(p => { this.board[p.row][p.col] = { ...p.tile }; });
      const next: (Cell | undefined)[][] = this.mask.map((line,row)=>line.map((_,col)=>this.isPlayable({row,col})?undefined:null));
      const falls:Fall[]=[];
      for (let col = 0; col < this.cols; col++) {
        let top=0;
        while(top<this.rows){
          if(!this.isPlayable({row:top,col})){top++;continue;}
          let bottom=top;while(bottom+1<this.rows&&this.isPlayable({row:bottom+1,col}))bottom++;
          const survivors:Position[]=[];
          for(let row=top;row<=bottom;row++)if(this.board[row][col]&&!removed.has(row*this.cols+col))survivors.push({row,col});
          const missing=bottom-top+1-survivors.length;
          survivors.forEach((from,i)=>{
            const to={row:top+missing+i,col};next[to.row][col]={...this.board[from.row][col]!};
            falls.push({from,to,startRow:from.row});
          });
          for(let row=top;row<top+missing;row++)falls.push({to:{row,col},startRow:top===0?row-missing:top});
          top=bottom+1;
        }
      }
      // 기존 전체 판과 동일하게 row-major 순서로만 보충 난수를 소비합니다.
      for (let row = 0; row < this.rows; row++) for (let col = 0; col < this.cols; col++) if (next[row][col]===undefined) {
        let choices = [0, 1, 2, 3, 4, 5];
        // 비정상적인 상수 rng에서도 연쇄가 유한 시간 안에 종료되도록 합니다.
        if (result.steps.length >= 50) choices = choices.filter(kind => {
          for (const [dr, dc] of [[1, 0], [0, 1]]) for (let offset = -2; offset <= 0; offset++) {
            const cells = [0, 1, 2].map(i => next[row + (offset + i) * dr]?.[col + (offset + i) * dc]);
            if (cells.every((tile, i) => offset + i === 0 || tile?.kind === kind)) return false;
          }
          if(this.ruleVersion===2)for(const dr of [-1,0])for(const dc of [-1,0]){
            const cells=[{row:row+dr,col:col+dc},{row:row+dr,col:col+dc+1},{row:row+dr+1,col:col+dc},{row:row+dr+1,col:col+dc+1}];
            if(cells.every(p=>(p.row===row&&p.col===col)||next[p.row]?.[p.col]?.kind===kind))return false;
          }
          return true;
        });
        next[row][col] = { kind: choices[this.randomIndex(choices.length)] };
      }
      this.board = next as Cell[][];
      result.steps.push({ before, removed: positions, after: clone(this.board), falls, ...(created.length ? { created: created.map(p => ({ ...p, tile: { ...p.tile } })) } : {}), ...(effects.length?{effects}: {}), ...(leafBefore?{leaves:{before:leafBefore,after:this.leaves.map(row=>row.slice()),hits:leafHits}}:{}), ...(crateBefore?{crates:{before:crateBefore,after:this.crates.map(row=>row.slice()),hits:crateHits}}:{}) });
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
