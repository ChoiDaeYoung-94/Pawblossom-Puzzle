import {describe,it,expect,vi} from 'vitest';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {BoardEngine,seededRng,type Position,type ResolveStep} from '../src/core';
import {levels} from '../src/levels';
import {levelSignature,validateCheckpoint,SaveStore,SAVE_KEY} from '../src/state';
import {prepareShuffle} from '../src/puzzleHelp';
import {startState,advanceState,validateState,publicState} from '../server/game/roundState';
import {RoundLedger} from '../server/game/roundLedger';
const hash=(x:unknown)=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const before=JSON.parse(readFileSync(new URL('./helpers/board-mask-v2-golden.json',import.meta.url),'utf8'));
const crateLevels=levels.slice(35,40);
const make=(crates:Position[]=[{row:3,col:3},{row:3,col:5}])=>{
  const e=new BoardEngine(8,8,seededRng(42),undefined,2,undefined,crates);
  e.board=e.mask.map((line,row)=>line.map((_,col)=>e.isPlayable({row,col})?{kind:(row*2+col)%5}:null));return e;
};
const cp=(id=36)=>{const s=startState(id,42);return {schema:1 as const,ruleVersion:2 as const,levelId:id,levelSignature:levelSignature(levels[id-1]),board:s.board,leaves:s.leaves,crates:s.crates!,clearedCrates:0,moves:s.moves,score:0,collected:s.collected,shuffles:1,clearedLeaves:0};};
function falls(step:ResolveStep,engine:BoardEngine){
  const crate=step.crates?.after??engine.crates,seen=new Set<string>(),removed=new Set(step.removed.map(p=>`${p.row},${p.col}`));
  for(const f of step.falls!){
    const key=`${f.to.row},${f.to.col}`;expect(seen.has(key)).toBe(false);seen.add(key);
    expect(engine.mask[f.to.row][f.to.col]).toBe(true);expect(crate[f.to.row][f.to.col]).toBe(0);
    if(f.from){expect(step.before[f.from.row][f.from.col]).not.toBeNull();expect(removed.has(`${f.from.row},${f.from.col}`)).toBe(false);
      expect(f.from.col).toBe(f.to.col);expect(f.from.row).toBeLessThanOrEqual(f.to.row);
      for(let r=f.from.row;r<=f.to.row;r++)expect(crate[r][f.to.col]).toBe(0);
    }
  }
  expect(seen.size).toBe(engine.mask.flat().filter(Boolean).length-crate.flat().filter(Boolean).length);
}
describe('고정 나무상자와 기존 엔진 호환',()=>{
  it('재설계 전 실제30 checkpoint는 primary의 회차만 버리고 영구기록을 유지하며 backup은 엄격히 거절합니다',()=>{
    const old=before.levels[29] as typeof levels[number],e=new BoardEngine(8,8,seededRng(42),undefined,2);e.setLeaves(old.leaves??[]);
    const progress={schema:1,ruleVersion:2,levelId:30,levelSignature:levelSignature(old),board:e.board,leaves:e.leaves,moves:24,score:0,collected:[0,0,0,0,0,0],shuffles:1,clearedLeaves:0};
    const pip={growth:34,affection:22,owned:[],equipped:'none'},data={version:1,language:'ko',highestLevel:40,completed:Array.from({length:40},(_,i)=>i+1),stars:7,coins:240,garden:2,music:true,sfx:true,tutorialSeen:true,pip,inProgress:progress};
    const raw=JSON.stringify(data),disk=new Map([[SAVE_KEY,raw]]),access=()=>({getItem:(k:string)=>disk.get(k)??null,setItem:(k:string,v:string)=>{disk.set(k,v);},removeItem:(k:string)=>{disk.delete(k);}}),store=new SaveStore(access),loaded=store.load();
    expect(loaded).toMatchObject({highestLevel:41,stars:7,coins:240,garden:2,pip});expect(loaded.completed).toHaveLength(40);expect(loaded.inProgress).toBeUndefined();expect(disk.get(SAVE_KEY)).toBe(raw);
    disk.set(SAVE_KEY,'{');disk.set(SAVE_KEY+'.backup',raw);const recovered=new SaveStore(access);expect(recovered.load().completed).toEqual([]);expect(recovered.status.load).toBe('corrupt');
  });
  it('동결1–35 fixture의 엔진 행동·서명 형식과 RNG를 보존합니다',()=>{
    expect(hash(before.levels)).toBe(before.contentHash);
    for(const run of before.runs){
      const level=before.levels[run.id-1] as typeof levels[number];let calls=0;const next=seededRng(level.id*9876543),e=new BoardEngine(8,8,()=>{calls++;return next();},undefined,2,level.mask);e.setLeaves(level.leaves??[]);
      expect(levelSignature(level)).toBe(JSON.stringify([level.id,level.moves,level.goals.map(g=>[g.kind,g.count]),(level.leaves??[]).map(p=>[p.row,p.col,p.layers]),...(level.mask?[level.mask]:[])]));
      expect({calls,digest:hash({board:e.board,leaves:e.leaves})}).toEqual(run.initial);
      for(const step of run.steps){const r=e.swap(step.command.a,step.command.b);expect({calls,result:hash(r),state:hash({board:e.board,leaves:e.leaves})}).toEqual({calls:step.calls,result:step.result,state:step.state});}
    }
  });
  it.each(crateLevels)('레벨 $id의 canonical 상자·상수 RNG·생성·복원·섞기가 안정적입니다',level=>{
    for(const value of [0,.5,.999999]){
      const e=new BoardEngine(8,8,()=>value,undefined,2,level.mask,level.crates);
      expect(e.findMatches()).toEqual([]);expect(e.hasMoves()).toBe(true);expect(e.remainingCrates()).toBe(level.crates!.length);
      const saved={board:e.board,leaves:e.leaves,crates:e.crates,ruleVersion:2 as const},rng=vi.fn(()=>value);
      const restored=new BoardEngine(8,8,rng,saved,undefined,level.mask,level.crates);restored.legalMoves();expect(rng).not.toHaveBeenCalled();
      const original=structuredClone(e.crates);e.shuffle();expect(e.crates).toEqual(original);expect(e.findMatches()).toEqual([]);expect(e.hasMoves()).toBe(true);
      e.board.forEach((line,r)=>line.forEach((tile,c)=>expect(tile===null).toBe(!e.mask[r][c]||e.crates[r][c]===1)));
    }
  });
  it('열린 3×3이 없는 2×3에서도 유한 fallback이 매치 없는 합법 교환을 만듭니다',()=>{
    const e=new BoardEngine(3,3,()=>0,undefined,2,undefined,[{row:2,col:0},{row:2,col:1},{row:2,col:2}]);
    (e as unknown as {generateCrateFallback():void}).generateCrateFallback();expect(e.findMatches()).toEqual([]);expect(e.hasMoves()).toBe(true);expect(e.remainingCrates()).toBe(3);
  });
  it.each(['row','cell'] as const)('엔진 직접 복원도 sparse 상자 %s를 RangeError로 거절합니다',hole=>{
    const s=startState(36,42);if(hole==='row')delete (s.crates as unknown as Record<number,unknown>)[0];else delete (s.crates![0] as unknown as Record<number,unknown>)[0];s.board[0][0]=null;
    expect(()=>new BoardEngine(8,8,()=>{throw Error('unexpected-rng');},s,undefined,undefined,levels[35].crates)).toThrow(RangeError);
  });
  it('직교 매치는 중복 한 번만 치우며 대각선 상자·색 수집·점수는 구분합니다',()=>{
    const e=make();for(const col of [2,3,4])e.board[2][col]={kind:5};for(const col of [0,1,2])e.board[3][col]={kind:5};
    const result=e.swap({row:2,col:2},{row:2,col:3}),step=result.steps[0];
    expect(step.crates!.hits).toEqual([{row:3,col:3}]);expect(step.crates!.before[3][3]).toBe(1);expect(step.crates!.after[3][3]).toBe(0);expect(step.crates!.after[3][5]).toBe(1);
    expect(step.removed).not.toContainEqual({row:3,col:3});
    const collected=Array(6).fill(0);result.steps.forEach(s=>s.removed.forEach(p=>collected[s.before[p.row][p.col]!.kind]++));expect(result.collected).toEqual(collected);
    expect(result.score).toBe(result.steps.reduce((sum,s,i)=>sum+s.removed.length*10*(i+1),0));falls(step,e);
    expect(step.falls!.some(f=>f.to.row===3&&f.to.col===3)).toBe(true);
    expect(step.falls!.some(f=>f.from?.row===1&&f.to.row===3&&f.to.col===3)).toBe(true);
    expect(step.falls!.some(f=>f.from&&f.from.row<3&&f.to.row>3&&f.to.col===5)).toBe(false);
  });
  it.each(['row','column','bomb'] as const)('%s는 직접 범위 상자를 치우고 제거 목록에 넣지 않습니다',special=>{
    const e=make([{row:3,col:3}]),at=special==='column'?{row:0,col:3}:{row:3,col:special==='bomb'?2:0};e.board[at.row][at.col]!.special=special;
    const r=e.activate(at),s=r.steps[0];expect(s.crates!.hits).toEqual([{row:3,col:3}]);expect(r.cratesCleared).toBe(1);expect(s.removed).not.toContainEqual({row:3,col:3});falls(s,e);
    if(special==='row')expect(s.removed).toContainEqual({row:3,col:7});
  });
  it('일반 rainbow는 색 없는 상자에 닿지 않고 rainbow 두 개는 전체 상자를 치웁니다',()=>{
    const e=make();e.board[0][0]!.special='rainbow';const r=e.activate({row:0,col:0});expect(r.steps[0].crates).toBeUndefined();
    const pair=make();pair.board[0][0]!.special='rainbow';pair.board[0][1]!.special='rainbow';
    const all=pair.swap({row:0,col:0},{row:0,col:1});expect(all.steps[0].crates!.hits).toHaveLength(2);expect(all.steps[0].removed).toHaveLength(62);expect(all.collected.reduce((a,b)=>a+b)).toBeGreaterThanOrEqual(62);
  });
  it('상자 입력·겹친 낙엽은 무효이고 코인 후보는 남은 상자/타일 inventory를 보존합니다',()=>{
    const e=make(),snapshot={board:e.board,leaves:e.leaves,crates:e.crates,ruleVersion:2 as const},original=structuredClone(snapshot);
    expect(e.isActive({row:3,col:3})).toBe(true);expect(e.isPlayable({row:3,col:3})).toBe(false);
    expect(e.swap({row:3,col:2},{row:3,col:3}).valid).toBe(false);expect(e.activate({row:3,col:3}).valid).toBe(false);expect(snapshot).toEqual(original);
    expect(()=>e.setLeaves([{row:3,col:3,layers:1}])).toThrow();
    const candidate=prepareShuffle(snapshot,seededRng(123),e.mask);expect(candidate).toBeDefined();expect(candidate!.crates).toEqual(original.crates);expect(candidate!.board[3][3]).toBeNull();
    expect(hash(candidate!.board.flat().filter(Boolean).map(t=>JSON.stringify(t)).sort())).toBe(hash(snapshot.board.flat().filter(Boolean).map(t=>JSON.stringify(t)).sort()));
  });
});
describe('상자 저장·서버와 원본 DB 실패 폐쇄',()=>{
  it.each(crateLevels)('레벨 $id checkpoint/서버 공개 상태는 상자 null과 별도 목표를 왕복합니다',level=>{
    const checkpoint=cp(level.id);expect(validateCheckpoint(checkpoint,40)).toEqual(checkpoint);
    const s=startState(level.id,42);validateState(s);expect(publicState(s)).not.toHaveProperty('rngState');expect(publicState(s).level.crates).toEqual(level.crates);
    const e=new BoardEngine(8,8,()=>{throw Error('rng');},s,undefined,level.mask,level.crates);
    const next=advanceState(s,{type:'swap',...e.legalMoves()[0]}).state;validateState(next);expect(next.clearedCrates).toBe(level.crates!.length-next.crates!.flat().filter(Boolean).length);
  });
  it.each(['missing-grid','missing-count','null','two','negative','fraction','moved','crate-tile','crate-leaf','active-null','count','legacy-rules','canonical'] as const)('변조 %s를 로컬·서버에서 거절합니다',field=>{
    const c:any=cp(),s:any=startState(36,42);
    for(const x of [c,s]){
      if(field==='missing-grid')delete x.crates;if(field==='missing-count')delete x.clearedCrates;
      if(field==='null')x.crates[2][2]=null;if(field==='two')x.crates[2][2]=2;if(field==='negative')x.crates[2][2]=-1;if(field==='fraction')x.crates[2][2]=.5;
      if(field==='moved'){x.crates[0][0]=1;x.board[0][0]=null;}if(field==='crate-tile')x.board[2][2]={kind:0};if(field==='crate-leaf')x.leaves[2][2]=1;
      if(field==='active-null')x.board[0][0]=null;if(field==='count')x.clearedCrates=1;if(field==='legacy-rules')x.ruleVersion=1;
      if(field==='canonical'){if(x.level)x.level.crates[0].row=1;else x.levelSignature+='x';}
    }
    expect(validateCheckpoint(c,40)).toBeUndefined();expect(()=>validateState(s)).toThrow();
  });
  it('마지막 이동에도 색/상자 목표를 함께 완료해야 승리합니다',()=>{
    const s=startState(36,42);s.moves=1;s.collected=Array(6).fill(1000);s.crates=s.crates!.map(line=>line.map(()=>0));s.crates[2][2]=1;s.clearedCrates=3;
    const engine=make([{row:2,col:2}]);s.board=engine.board;s.board[2][1]!.special='row';validateState(s);
    expect(advanceState(s,{type:'activate',at:{row:2,col:1}}).state).toMatchObject({moves:0,clearedCrates:4,status:'won'});
    const pending=startState(36,42);pending.moves=1;pending.collected=Array(6).fill(1000);pending.board=make(levels[35].crates).board;pending.board[7][0]!.special='row';validateState(pending);
    expect(advanceState(pending,{type:'activate',at:{row:7,col:0}}).state.status).toBe('failed');
  });
  it('35 완료 저장은 보상·재화·핍을 재지급하지 않고 36으로 이어집니다',()=>{
    const value={version:1,highestLevel:35,completed:Array.from({length:35},(_,i)=>i+1),stars:35,coins:777,garden:5,language:'ko',music:true,sfx:true,tutorialSeen:true};
    const storage={getItem:(key:string)=>key===SAVE_KEY?JSON.stringify(value):null,setItem(){},removeItem(){}};
    expect(new SaveStore(()=>storage).load()).toMatchObject({...value,highestLevel:36});
  });
  it.each(['ledger-v1-fixture.json','ledger-square-v2-baseline.json','ledger-mask-v2-baseline.json'])('실제 원본 %s의 DDL/행/profile을 변경하지 않고 거절합니다',name=>{
    const source=JSON.parse(readFileSync(new URL('./helpers/'+name,import.meta.url),'utf8')),directory=mkdtempSync(join(tmpdir(),'pawblossom-crates-old-')),path=join(directory,'round.sqlite');
    const db=new DatabaseSync(path);const dump=()=>db.prepare("SELECT name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all().map(t=>({...t,rows:db.prepare('SELECT * FROM '+t.name+' ORDER BY 1').all()}));
    try{
      for(const table of source.round)db.exec(table.sql);
      const order=['round_meta','round_rounds','round_ops','round_rewards'];
      for(const name of order){const table=source.round.find((t:{name:string})=>t.name===name);for(const row of table?.rows??[]){const keys=Object.keys(row);db.prepare('INSERT INTO '+name+' ('+keys.join(',')+') VALUES ('+keys.map(()=>'?').join(',')+')').run(...Object.values(row) as (string|number|null)[]);}}
      const original=dump();expect(()=>new RoundLedger({databasePath:path,serverKey:new Uint8Array(32).fill(67),environment:'test',now:()=>1792620000000})).toThrow('round-ledger-open-failed');expect(dump()).toEqual(original);
    }finally{db.close();rmSync(directory,{recursive:true,force:true});}
  });
});
