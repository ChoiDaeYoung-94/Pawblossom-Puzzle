import {describe,it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {BoardEngine,seededRng,type RuleVersion,type Tile} from '../src/core';
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const golden=JSON.parse(readFileSync(new URL('./helpers/board-v1-golden.json',import.meta.url),'utf8'));
function board(ruleVersion:RuleVersion=2){
  const rng=vi.fn(seededRng(42));
  const e=new BoardEngine(8,8,rng,undefined,ruleVersion);
  e.board=Array.from({length:8},(_,r)=>Array.from({length:8},(_,c)=>({kind:(r*2+c)%5})));
  rng.mockClear();return {e,rng};
}
const put=(e:BoardEngine,cells:number[][])=>cells.forEach(([r,c])=>{e.board[r][c]={kind:5};});
const square=[[2,2],[2,3],[3,2],[3,3]];
describe('회차 규칙 V1 보존과 V2 정사각 꽃폭탄',()=>{
  it('기준 V1의 실제 결과·보드·누적 RNG golden을 교환/실패/섞기/특수 탭 뒤 재현합니다',()=>{
    expect(golden.sourceLfSha256).toBe('f07d4d5ae190b9a0ff28150e2c392adf7810a3eb84b17e1de25c3493269c293e');
    for(const run of golden.runs){
      let calls=0;const next=seededRng(run.seed),e=new BoardEngine(8,8,()=>{calls++;return next();},undefined,1);
      e.setLeaves([{row:2,col:2,layers:2},{row:5,col:5,layers:1}]);
      expect({digest:hash({board:e.board,leaves:e.leaves}),calls}).toEqual(run.initial);
      for(const step of run.steps){
        const c=step.command;let result;
        if(c.type==='shuffle'){e.shuffle();result=null;}else result=c.type==='activate'?e.activate(c.at):e.swap(c.a,c.b);
        expect({calls,result:hash(result?{...result,steps:result.steps.map(({falls,...legacy})=>legacy)}:null),state:hash({board:e.board,leaves:e.leaves})}).toEqual({calls:step.calls,result:step.result,state:step.state});
      }
    }
  });
  it('누락된 복원 버전은1, 새 판은2이고 미지원/충돌 버전은 거절합니다',()=>{
    const {e}=board(),snapshot={board:e.board,leaves:e.leaves};
    expect(new BoardEngine(8,8,()=>{throw Error();},snapshot).ruleVersion).toBe(1);
    expect(new BoardEngine(8,8,seededRng(42)).ruleVersion).toBe(2);
    for(const ruleVersion of [null,0,3,'2'])expect(()=>new BoardEngine(8,8,()=>0,{...snapshot,ruleVersion} as never)).toThrow(RangeError);
    expect(()=>new BoardEngine(8,8,()=>0,{...snapshot,ruleVersion:1},2)).toThrow(RangeError);
  });
  it('정사각만 만드는 교환의 힌트/판정이 같고 V1에서는 무효이며 조회는 난수를 쓰지 않습니다',()=>{
    for(const version of [1,2] as const){
      const {e,rng}=board(version);put(e,[[2,2],[2,3],[3,2],[3,4]]);e.board[3][3]={kind:0};
      const a={row:3,col:4},b={row:3,col:3},before=JSON.stringify(e.board);
      expect(e.legalMoves().some(m=>m.a.row===b.row&&m.a.col===b.col&&m.b.row===a.row&&m.b.col===a.col)).toBe(version===2);
      expect(JSON.stringify(e.board)).toBe(before);expect(rng).not.toHaveBeenCalled();
      const result=e.swap(a,b);expect(result.valid).toBe(version===2);
      if(version===1){expect(JSON.stringify(e.board)).toBe(before);expect(rng).not.toHaveBeenCalled();continue;}
      expect(result.steps[0].created).toEqual([{...b,tile:{kind:5,special:'bomb'}}]);
      expect(result.steps[0].removed).toEqual([{row:2,col:2},{row:2,col:3},{row:3,col:2}]);
      expect(result.steps[0].effects).toBeUndefined();expect(e.findMatches()).toEqual([]);
    }
  });
  it.each([
    {name:'독립 4가로',cells:[[2,1],[2,2],[2,3],[2,4]],special:'row'},
    {name:'독립 4세로',cells:[[1,2],[2,2],[3,2],[4,2]],special:'column'},
    {name:'실제 T교차',cells:[[2,1],[2,2],[2,3],[3,2],[4,2]],special:'bomb'},
    {name:'정사각+4줄',cells:[...square,[2,4],[2,5]],special:'bomb'},
    {name:'정사각+5줄',cells:[...square,[2,4],[2,5],[2,6]],special:'rainbow'},
    {name:'겹친 정사각',cells:[...square,[2,4],[3,4]],special:'bomb'},
  ])('$name 패턴의 우선순위와 그룹당 생성 한 개·생성 칸 보호를 지킵니다',({cells,special})=>{
    const {e}=board();put(e,cells);
    // 안정 상태는 아니지만 패턴을 한 번에 해소시키는 인접 같은 색 교환입니다.
    const [r,c]=cells[0],neighbor=cells.find(([r2,c2])=>Math.abs(r2-r)+Math.abs(c2-c)===1)!;
    const result=e.swap({row:r,col:c},{row:neighbor[0],col:neighbor[1]}),step=result.steps[0];
    expect(step.created).toHaveLength(1);expect(step.created![0].tile.special).toBe(special);
    expect(step.removed).not.toContainEqual({row:step.created![0].row,col:step.created![0].col});
    expect(new Set(step.removed.map(p=>`${p.row},${p.col}`)).size).toBe(step.removed.length);
  });
  it('정사각의 기존 특수는 한 번 발동하고 새 꽃폭탄은 보호하며 낙엽을 중복 집계하지 않습니다',()=>{
    const {e}=board();put(e,square);e.board[2][2]!.special='row';e.setLeaves([{row:2,col:3,layers:2},{row:4,col:3,layers:2}]);
    const result=e.swap({row:3,col:2},{row:3,col:3}),step=result.steps[0];
    expect(step.effects?.filter(p=>p.row===2&&p.col===2)).toEqual([{row:2,col:2,special:'row'}]);
    expect(step.created?.[0].tile.special).toBe('bomb');expect(step.removed).not.toContainEqual({row:3,col:3});
    expect(step.leaves?.hits.filter(p=>p.row===2&&p.col===3)).toEqual([{row:2,col:3,before:2,after:0}]);
    expect(step.leaves?.hits.filter(p=>p.row===4&&p.col===3)).toEqual([{row:4,col:3,before:2,after:1}]);
    const counts=Array(6).fill(0);result.steps.forEach(s=>s.removed.forEach(p=>counts[s.before[p.row][p.col]!.kind]++));expect(result.collected).toEqual(counts);
  });
  it('독립된 정사각 두 그룹은 각각 하나를 만들고 낙하로 생긴 정사각도 다음 단계에서 해소합니다',()=>{
    const {e}=board();put(e,[[1,1],[1,2],[2,1],[2,2],[5,5],[5,6],[6,5],[6,6]]);
    const first=e.swap({row:1,col:1},{row:1,col:2}).steps[0];expect(first.created).toHaveLength(2);expect(first.created!.every(p=>p.tile.special==='bomb')).toBe(true);expect(first.removed).toHaveLength(6);
    const values=[0,0,.4],next=seededRng(57),initial:Tile[][]=[[0,0,1],[2,3,4],[3,4,5]].map(row=>row.map(kind=>({kind})));
    initial[2][2].special='row';
    const cascade=new BoardEngine(3,3,()=>values.length?values.shift()!:next(),{board:initial,leaves:Array.from({length:3},()=>[0,0,0]),ruleVersion:2});
    expect(cascade.findMatches()).toEqual([]);const result=cascade.activate({row:2,col:2});
    expect(result.steps[1].before.slice(0,2).map(row=>row.slice(0,2).map(t=>t!.kind))).toEqual([[0,0],[0,0]]);
    expect(result.steps[1].created).toEqual([{row:0,col:0,tile:{kind:0,special:'bomb'}}]);expect(result.steps[1].effects).toBeUndefined();expect(cascade.findMatches()).toEqual([]);
  });
  it('V2 섞기·연쇄는 안정 보드를 남기며 상수 RNG도 직선/정사각 없이 종료합니다',()=>{
    const {e}=board();put(e,square);e.board[0][0]!.special='rainbow';e.board[0][1]!.special='rainbow';
    const result=e.swap({row:0,col:0},{row:0,col:1});expect(result.valid).toBe(true);
    expect(e.findMatches()).toEqual([]);expect(e.hasMoves()).toBe(true);
    const signature=()=>e.board.flat().map(t=>`${t!.kind}:${t!.special??''}`).sort();const old=signature();e.shuffle();expect(signature()).toEqual(old);expect(e.findMatches()).toEqual([]);
    for(const value of [0,.5,.999999]){
      const constant=new BoardEngine(3,3,()=>value);expect(constant.findMatches()).toEqual([]);expect(constant.hasMoves()).toBe(true);
      constant.board[0][0]!.special='rainbow';constant.board[0][1]!.special='rainbow';
      const cleared=constant.swap({row:0,col:0},{row:0,col:1});expect(cleared.steps.length).toBeLessThan(60);expect(constant.findMatches()).toEqual([]);expect(constant.hasMoves()).toBe(true);
    }
  });
});
