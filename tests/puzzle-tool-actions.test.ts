import {describe,it,expect,vi} from 'vitest';
import {BoardEngine,seededRng,type Position} from '../src/core';
import {levels,levelSignature,validateCheckpoint,type RoundCheckpoint,type SaveData,SaveStore,SAVE_KEY} from '../src/state';
import {preparePuzzleTool,puzzleToolArea,puzzleToolOutcome} from '../src/puzzleToolActions';
import {freshToolProgress,puzzleTool,type PuzzleToolId} from '../src/puzzleTools';

const copy=<T>(value:T):T=>JSON.parse(JSON.stringify(value)) as T;
function roundAt(id=6,started=true){
  const level=levels[id-1],e=new BoardEngine(8,8,seededRng(42),undefined,2,level.mask,level.crates);e.setLeaves(level.leaves??[]);
  const round:RoundCheckpoint={schema:2,actionProfile:'tools-v2',toolsUsed:[],toolsStarted:started,ruleVersion:2,levelId:id,levelSignature:levelSignature(level),board:copy(e.board),leaves:copy(e.leaves),moves:level.moves,score:0,collected:Array(6).fill(0),shuffles:1,clearedLeaves:0,...(e.hasCrates?{crates:copy(e.crates),clearedCrates:0}:{})};
  return {round,e,level,at:e.mask.flatMap((line,row)=>line.flatMap((_,col)=>e.isPlayable({row,col})?[{row,col}]:[]))[0]};
}
function saveFor(round:RoundCheckpoint):SaveData{return {version:2,puzzleTools:freshToolProgress(),language:'ko',highestLevel:100,completed:[1,2,3,4,5],stars:5,coins:200,garden:1,music:true,sfx:true,tutorialSeen:true,inProgress:copy(round)};}
describe('공개 엔진 API를 후보 사본에 조합하는 도구',()=>{
  it.each([6,8,12,20,41,65].flatMap(id=>(['trowel','broom','bell','seeds'] as const).map(tool=>[id,tool] as const)))('%s번 %s 생성은 한 칸·무난수이며 이후 발동은 보드 특수와 같다',(id,tool)=>{
    const {round,level,at}=roundAt(id),before=copy(round),rng=vi.fn(seededRng(17));
    const plan=preparePuzzleTool(round,tool,at,undefined,rng)!;expect(plan).toBeDefined();expect(round).toEqual(before);
    const reference=new BoardEngine(8,8,seededRng(17),before,2,level.mask,level.crates),definition=puzzleTool(tool);
    if(!('special'in definition))throw Error('fixture');reference.board[at.row][at.col]!.special=definition.special;
    expect(plan.result).toBeUndefined();expect(plan.after).toEqual({board:reference.board,leaves:reference.leaves,ruleVersion:2,...(reference.hasCrates?{crates:reference.crates}:{})});
    expect(puzzleToolArea(round,tool,at)).toEqual([at]);expect(rng).not.toHaveBeenCalled();
    const generated=new BoardEngine(8,8,seededRng(17),plan.after,2,level.mask,level.crates);
    expect(generated.activate(at)).toEqual(reference.activate(at));expect(round).toEqual(before);
  });
  it('폭탄 생성은 이웃 특수와 두 겹 낙엽을 보존하고 실제 발동 때만 처리한다',()=>{
    const {round,level}=roundAt(),at=level.leaves![0],near={row:at.row,col:at.col+1};
    round.board[near.row][near.col]!.special='row';const before=copy(round),preview=puzzleToolArea(round,'trowel',at);
    expect(preview).toEqual([at]);expect(round).toEqual(before);const plan=preparePuzzleTool(round,'trowel',at,undefined,seededRng(91))!;
    expect(plan.after.leaves).toEqual(round.leaves);expect(plan.after.board[near.row][near.col]).toEqual(round.board[near.row][near.col]);
    const e=new BoardEngine(8,8,seededRng(91),plan.after,2),result=e.activate(at);
    expect(result.steps[0].effects!.length).toBeGreaterThan(1);expect(result.steps[0].leaves!.hits.find(p=>p.row===at.row&&p.col===at.col)).toMatchObject({before:2,after:0});expect(round).toEqual(before);
  });
  it.each([{row:-1,col:0},{row:8,col:0},{row:1.5,col:0},{row:NaN,col:0}])('무효 좌표 %#는 난수를 한 번도 호출하지 않는다',at=>{
    const {round}=roundAt(),before=copy(round),rng=vi.fn(()=>.5);expect(preparePuzzleTool(round,'trowel',at,undefined,rng)).toBeUndefined();expect(rng).not.toHaveBeenCalled();expect(round).toEqual(before);
  });
  it('구schema1/룰1·이미 쓴 도구·판당2회·원래특수·빈칸/상자 대상을 거절한다',()=>{
    const {round,at}=roundAt(),rng=vi.fn(()=>.5);
    for(const changed of [{schema:1},{ruleVersion:1},{actionProfile:undefined},{actionProfile:'tools-v1'},{toolsUsed:['trowel']},{toolsUsed:['broom','bell']}])expect(preparePuzzleTool({...round,...changed} as RoundCheckpoint,'trowel',at,undefined,rng)).toBeUndefined();
    const special=copy(round);special.board[at.row][at.col]!.special='bomb';expect(preparePuzzleTool(special,'trowel',at,undefined,rng)).toBeUndefined();
    for(const level of [levels.find(l=>l.mask)!,levels.find(l=>l.crates?.length)!]){
      const context=roundAt(level.id),blocked:Position=level.crates?.[0]??context.e.mask.flatMap((line,row)=>line.flatMap((active,col)=>!active?[{row,col}]:[]))[0];
      expect(preparePuzzleTool(context.round,'trowel',blocked,undefined,rng)).toBeUndefined();
    }
    expect(rng).not.toHaveBeenCalled();
  });
  it('장갑은 유효 인접 매치의 교환후 before와 실제 결과를 보존하고 다른 교환은 거절한다',()=>{
    const {round,e,level}=roundAt(),move=e.legalMoves()[0],before=copy(round),plan=preparePuzzleTool(round,'gloves',move.a,move.b,seededRng(11))!;
    const reference=new BoardEngine(8,8,seededRng(11),before,2,level.mask,level.crates),result=reference.swap(move.a,move.b);
    expect(plan.swap).toEqual(move.b);expect(plan.result).toEqual(result);expect(plan.result!.steps[0].before).not.toEqual(round.board);expect(round).toEqual(before);
    const rng=vi.fn(()=>.5);expect(preparePuzzleTool(round,'gloves',move.a,{row:7,col:7},rng)).toBeUndefined();expect(preparePuzzleTool(round,'gloves',move.a,move.a,rng)).toBeUndefined();expect(rng).not.toHaveBeenCalled();
  });
  it('기존 씨앗 ID는 첫 행동 이후에도 세로 특수 한 칸을 만들고 RNG/연쇄를 호출하지 않는다',()=>{
    const {round,at}=roundAt(6,false),before=copy(round),rng=vi.fn(()=>.5),plan=preparePuzzleTool(round,'seeds',at,undefined,rng)!;
    expect(plan.result).toBeUndefined();const expected=copy(before.board);expected[at.row][at.col]!.special='column';expect(plan.after.board).toEqual(expected);expect(plan.after.leaves).toEqual(round.leaves);expect(rng).not.toHaveBeenCalled();expect(round).toEqual(before);
    expect(preparePuzzleTool({...round,toolsStarted:true},'seeds',at,undefined,rng)?.after.board).toEqual(expected);
  });
});
describe('도구 비용·체험·판·보상을 함께 준비한다',()=>{
  it('첫 무료 체험은 소개/사용/판/수집과 한 payload이며 동일 계획 재확정은 거절한다',()=>{
    const {round,at}=roundAt(),save=saveFor(round),before=copy(save),plan=preparePuzzleTool(round,'trowel',at,undefined,seededRng(8))!,outcome=puzzleToolOutcome(save,plan)!;
    expect(outcome.cost).toBe(0);expect(outcome.save!.coins).toBe(save.coins);expect(outcome.save!.puzzleTools).toEqual({schema:2,introduced:['trowel'],trialUsed:['trowel']});
    expect(outcome).toMatchObject({won:false,score:round.score,collected:round.collected,clearedLeaves:round.clearedLeaves,tools:{profile:'tools-v2'}});
    expect(outcome.save!.inProgress).toMatchObject({moves:round.moves,toolsUsed:['trowel'],toolsStarted:true,board:plan.after.board,score:outcome.score,collected:outcome.collected});expect(validateCheckpoint(outcome.save!.inProgress,100)).toEqual(outcome.save!.inProgress);
    expect(puzzleToolOutcome(outcome.save!,plan)).toBeUndefined();expect(save).toEqual(before);
  });
  it('이미 체험한 사용은 현재 잔액에서만 차감하고 저장 실패는 원본/무료기록을 바꾸지 않는다',()=>{
    const {round,at}=roundAt(),save=saveFor(round);save.puzzleTools={schema:2,introduced:['trowel'],trialUsed:['trowel']};const raw=JSON.stringify(save),plan=preparePuzzleTool(round,'trowel',at,undefined,seededRng(8))!,outcome=puzzleToolOutcome(save,plan)!;
    expect(outcome.cost).toBe(30);expect(outcome.save!.coins).toBe(170);expect(puzzleToolOutcome({...save,coins:29},plan)).toBeUndefined();
    const values=new Map([[SAVE_KEY,raw]]),store=new SaveStore(()=>({getItem:k=>values.get(k)??null,setItem:()=>{throw Error('write');},removeItem:()=>{}}));store.load();expect(store.save(outcome.save!)).toBe(false);expect(values.get(SAVE_KEY)).toBe(raw);expect(JSON.stringify(save)).toBe(raw);
  });
  it('승리의 기존 +1별/+40코인만 같은 저장에서 주고 결과 재사용은 거절한다',()=>{
    const {round,level}=roundAt(),goal=level.goals[0];
    // 생성 도구는 승리하지 않습니다. 기존 실제 교환 도구의 승리 정산을 고정 매치로 검증합니다.
    round.board=round.board.map((line,r)=>line.map((_,c)=>({kind:(r+c*2)%6})));
    for(const at of [{row:0,col:0},{row:0,col:2},{row:1,col:1}])round.board[at.row][at.col]={kind:goal.kind};
    round.board[0][1]={kind:(goal.kind+1)%6};
    round.leaves=round.leaves.map(line=>line.map(()=>0));round.clearedLeaves=level.leaves!.length;for(const g of level.goals)round.collected[g.kind]=g.count-(g.kind===goal.kind?1:0);
    const save=saveFor(round),plan=preparePuzzleTool(round,'gloves',{row:0,col:1},{row:1,col:1},seededRng(10))!,outcome=puzzleToolOutcome(save,plan)!;
    expect(outcome.won).toBe(true);expect(outcome.firstReward).toBe(true);expect(outcome.save!.stars).toBe(save.stars+1);expect(outcome.save!.coins).toBe(save.coins+40);expect(outcome.save!.completed.filter(id=>id===6)).toHaveLength(1);expect(outcome.save!.inProgress).toBeUndefined();expect(puzzleToolOutcome(outcome.save!,plan)).toBeUndefined();
  });
  it('정상 해금은 최고 도달에서만 읽고 시험 체험은 일반 저장/체험 지급을 만들지 않는다',()=>{
    const {round,at}=roundAt(),save=saveFor(round),before=copy(save),plan=preparePuzzleTool(round,'trowel',at,undefined,seededRng(8))!;
    expect(puzzleToolOutcome({...save,highestLevel:8},plan)).toBeUndefined();const trial=puzzleToolOutcome({...save,highestLevel:1},plan,true)!;expect(trial.save).toBeUndefined();expect(trial.cost).toBe(0);expect(trial.firstReward).toBe(false);expect(trial.tools.used).toEqual(['trowel']);expect(save).toEqual(before);
  });
});
