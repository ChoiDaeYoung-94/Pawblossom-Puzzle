import {describe,it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {BoardEngine,seededRng,type BoardMask,type Cell,type ResolveStep} from '../src/core';
import {levels,chapterForLevel} from '../src/levels';
import {levelSignature,validateCheckpoint} from '../src/state';
import {startState,validateState,advanceState,publicState} from '../server/game/roundState';
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const golden=JSON.parse(readFileSync(new URL('./helpers/board-v2-golden.json',import.meta.url),'utf8'));
const masked=levels.slice(30,35);
const make=(mask:BoardMask,rng=seededRng(42))=>new BoardEngine(8,8,rng,undefined,2,mask);
function checkFalls(step:ResolveStep,mask:BoardMask){
  const seen=new Set<string>(),removed=new Set(step.removed.map(p=>`${p.row},${p.col}`));
  for(const f of step.falls!){
    expect(mask[f.to.row][f.to.col]).toBe(true);const key=`${f.to.row},${f.to.col}`;
    expect(seen.has(key)).toBe(false);seen.add(key);
    if(f.from){
      expect(f.from.col).toBe(f.to.col);expect(f.to.row).toBeGreaterThanOrEqual(f.from.row);
      expect(removed.has(`${f.from.row},${f.from.col}`)).toBe(false);
      for(let r=f.from.row;r<=f.to.row;r++)expect(mask[r][f.to.col]).toBe(true);
      const created=step.created?.find(p=>p.row===f.from!.row&&p.col===f.from!.col);
      const before=created?.tile??step.before[f.from.row][f.from.col];
      // rainbow 조합은 발동 전에 같은 색 타일에 특수를 부여할 수 있습니다.
      expect(step.after[f.to.row][f.to.col]?.kind).toBe(before?.kind);
      if(created)expect(step.after[f.to.row][f.to.col]).toEqual(created.tile);
    }else{
      let top=f.to.row;while(top>0&&mask[top-1][f.to.col])top--;
      expect(f.startRow).toBeLessThanOrEqual(f.to.row);if(top>0)expect(f.startRow).toBe(top);
    }
  }
  expect(seen.size).toBe(mask.flat().filter(Boolean).length);
}
describe('canonical mask·구간별 낙하와 전체 판 호환',()=>{
  it('기존 1–30 콘텐츠 JSON과 mask 없는 checkpoint 서명은 그대로입니다',()=>{
    expect(hash(levels.slice(0,30))).toBe('54bf864a67ebd33c3e1647b059b2964ef2ff3f76895f0e38d11bbbdbf249204d');
    for(const l of levels.slice(0,30))expect(levelSignature(l)).toBe(JSON.stringify([l.id,l.moves,l.goals.map(g=>[g.kind,g.count]),(l.leaves??[]).map(p=>[p.row,p.col,p.layers])]));
    expect(masked.map(l=>l.id)).toEqual([31,32,33,34,35]);expect(chapterForLevel(31)).toMatchObject({id:4,last:35});
  });
  it('동결 V2 golden의 기존 행동 결과·RNG는 falls projection을 제외하고 불변입니다',()=>{
    expect(golden.sourceLfSha256).toBe('c02c8278090d332b3d56f05636158d360947d55e8ef84cddff20aa81c7fd3778');
    for(const run of golden.runs){
      let calls=0;const next=seededRng(run.seed),e=new BoardEngine(8,8,()=>{calls++;return next();});
      e.setLeaves([{row:2,col:2,layers:2},{row:5,col:5,layers:1}]);
      expect({digest:hash({board:e.board,leaves:e.leaves}),calls}).toEqual(run.initial);
      for(const step of run.steps){
        const c=step.command;let result;
        if(c.type==='shuffle'){e.shuffle();result=null;}else result=c.type==='activate'?e.activate(c.at):e.swap(c.a,c.b);
        result?.steps.filter(s=>s.removed.length).forEach(s=>checkFalls(s,e.mask));
        const projection=result?{...result,steps:result.steps.map(({falls,...legacy})=>legacy)}:null;
        expect({calls,result:hash(projection),state:hash({board:e.board,leaves:e.leaves})}).toEqual({calls:step.calls,result:step.result,state:step.state});
      }
    }
  });
  it.each(masked)('레벨 $id: 생성·조회·교환·섞기·낙하·상수 RNG가 활성 칸만 사용합니다',level=>{
    for(const value of [0,.5,.999999]){
      const e=make(level.mask!,()=>value);expect(e.findMatches()).toEqual([]);expect(e.hasMoves()).toBe(true);
      const before=JSON.stringify(e.board),rng=vi.fn(()=>value),restored=new BoardEngine(8,8,rng,{board:e.board,leaves:e.leaves,ruleVersion:2},undefined,level.mask);
      restored.legalMoves();restored.hasMoves();expect(rng).not.toHaveBeenCalled();expect(JSON.stringify(restored.board)).toBe(before);
      const at=e.legalMoves()[0].a;e.board[at.row][at.col]!.special='rainbow';
      const result=e.activate(at);expect(result.steps.length).toBeLessThan(60);result.steps.filter(s=>s.removed.length).forEach(s=>checkFalls(s,e.mask));
      e.shuffle();expect(e.findMatches()).toEqual([]);expect(e.hasMoves()).toBe(true);
      e.board.forEach((row,r)=>row.forEach((tile,c)=>expect(tile===null).toBe(!level.mask![r][c])));
    }
  });
  it('구멍에서 일반 줄·정사각은 끊기고 입력·낙엽은 거절하지만 줄 특수는 건너편에 닿습니다',()=>{
    const l=levels[31],e=make(l.mask!);e.board=e.mask.map((row,r)=>row.map((active,c)=>active?{kind:(r*2+c)%6}:null));
    for(const c of [1,2,5,6])e.board[3][c]={kind:5};
    expect(e.findMatches()).toEqual([]);const before=JSON.stringify(e.board);
    expect(e.swap({row:3,col:2},{row:3,col:3}).valid).toBe(false);expect(e.activate({row:3,col:3}).valid).toBe(false);
    expect(JSON.stringify(e.board)).toBe(before);expect(()=>e.setLeaves([{row:3,col:3,layers:1}])).toThrow();
    e.board[3][0]!.special='row';const s=e.activate({row:3,col:0}).steps[0];
    expect(s.removed).toEqual([0,1,2,5,6,7].map(col=>({row:3,col})));
    checkFalls(s,e.mask);expect(s.falls!.some(f=>f.from?.row===2&&f.to.row>=5&&f.to.col===3)).toBe(false);
  });
  it('활성 정사각에서 만든 꽃폭탄도 from/to를 따라 내려오며 보호 칸을 수집하지 않습니다',()=>{
    const e=make(levels[31].mask!);e.board=e.mask.map((line,r)=>line.map((active,c)=>active?{kind:(r*2+c)%6}:null));
    for(const [r,c] of [[0,0],[0,1],[1,0],[1,1]])e.board[r][c]={kind:5};
    const first=e.swap({row:0,col:0},{row:0,col:1}).steps[0],created=first.created![0];
    expect(created.tile.special).toBe('bomb');expect(first.removed).not.toContainEqual({row:created.row,col:created.col});checkFalls(first,e.mask);
  });
  it.each([['row','column'],['bomb','row'],['bomb','bomb'],['rainbow','row'],['rainbow','rainbow']] as const)('구멍 있는 판의 %s+%s 조합은 활성 칸만 한 번 수집합니다',(x,y)=>{
    const e=make(levels[31].mask!);e.board=e.mask.map((line,r)=>line.map((active,c)=>active?{kind:(r*2+c)%6}:null));
    e.board[3][1]!.special=x;e.board[3][2]!.special=y;
    const result=e.swap({row:3,col:1},{row:3,col:2}),counts=Array(6).fill(0);
    expect(result.valid).toBe(true);
    for(const step of result.steps.filter(s=>s.removed.length)){
      expect(new Set(step.removed.map(p=>`${p.row},${p.col}`)).size).toBe(step.removed.length);
      step.removed.forEach(p=>{expect(e.mask[p.row][p.col]).toBe(true);counts[step.before[p.row][p.col]!.kind]++;});checkFalls(step,e.mask);
    }
    expect(result.collected).toEqual(counts);expect(e.findMatches()).toEqual([]);expect(e.hasMoves()).toBe(true);
    if(x==='rainbow'&&y==='rainbow')expect(result.steps[0].removed).toHaveLength(60);
  });
  it('mask 변경·구멍 타일/낙엽·활성 null·masked V1을 checkpoint/서버에서 거절합니다',()=>{
    const l=levels[30],e=make(l.mask!),base={schema:1 as const,ruleVersion:2 as const,levelId:31,levelSignature:levelSignature(l),board:e.board,leaves:e.leaves,moves:l.moves,score:0,collected:[0,0,0,0,0,0],shuffles:1,clearedLeaves:0};
    expect(validateCheckpoint(base,31)).toEqual(base);
    for(const patch of [(x:any)=>x.board[0][0]={kind:0},(x:any)=>x.leaves[0][0]=1,(x:any)=>x.board[0][2]=null,(x:any)=>x.ruleVersion=1,(x:any)=>x.levelSignature+='x']){
      const x=structuredClone(base);patch(x);expect(validateCheckpoint(x,31)).toBeUndefined();
    }
    const state=startState(32,42);validateState(state);expect(publicState(state).level.mask).toEqual(levels[31].mask);
    const invalid=advanceState(state,{type:'swap',a:{row:3,col:2},b:{row:3,col:3}});expect(invalid).toEqual({state,outcome:'invalid-swap'});
    for(const patch of [(x:any)=>x.level.mask[0][0]=false,(x:any)=>x.board[3][3]={kind:0},(x:any)=>x.leaves[3][3]=1,(x:any)=>x.board[0][0]=null]){
      const x=structuredClone(state);patch(x);expect(()=>validateState(x)).toThrow();
    }
  });
});
