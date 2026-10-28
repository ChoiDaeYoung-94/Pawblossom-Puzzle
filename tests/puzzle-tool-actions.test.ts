import {describe,it,expect,vi} from 'vitest';
import {BoardEngine,seededRng,type Position} from '../src/core';
import {levels,levelSignature,validateCheckpoint,type RoundCheckpoint,type SaveData,SaveStore,SAVE_KEY} from '../src/state';
import {preparePuzzleTool,puzzleToolArea,puzzleToolOutcome} from '../src/puzzleToolActions';
import {freshToolProgress,puzzleTool,type PuzzleToolId} from '../src/puzzleTools';

const copy=<T>(value:T):T=>JSON.parse(JSON.stringify(value)) as T;
function roundAt(id=6,started=true){
  const level=levels[id-1],e=new BoardEngine(8,8,seededRng(42),undefined,2,level.mask,level.crates);e.setLeaves(level.leaves??[]);
  const round:RoundCheckpoint={schema:2,actionProfile:'tools-v1',toolsUsed:[],toolsStarted:started,ruleVersion:2,levelId:id,levelSignature:levelSignature(level),board:copy(e.board),leaves:copy(e.leaves),moves:level.moves,score:0,collected:Array(6).fill(0),shuffles:1,clearedLeaves:0,...(e.hasCrates?{crates:copy(e.crates),clearedCrates:0}:{})};
  return {round,e,level,at:e.mask.flatMap((line,row)=>line.flatMap((_,col)=>e.isPlayable({row,col})?[{row,col}]:[]))[0]};
}
function saveFor(round:RoundCheckpoint):SaveData{return {version:2,puzzleTools:freshToolProgress(),language:'ko',highestLevel:100,completed:[1,2,3,4,5],stars:5,coins:200,garden:1,music:true,sfx:true,tutorialSeen:true,inProgress:copy(round)};}
describe('공개 엔진 API를 후보 사본에 조합하는 도구',()=>{
  it.each([6,8,12,20,41,65].flatMap(id=>(['trowel','broom','bell'] as const).map(tool=>[id,tool] as const)))('%s번 %s는 같은 공개 special 결과이고 입력/원래 RNG를 바꾸지 않는다',(id,tool)=>{
    const {round,level,at}=roundAt(id),before=copy(round),rng=vi.fn(seededRng(17));
    const plan=preparePuzzleTool(round,tool,at,undefined,rng)!;expect(plan).toBeDefined();expect(round).toEqual(before);
    const reference=new BoardEngine(8,8,seededRng(17),before,2,level.mask,level.crates),definition=puzzleTool(tool);
    if(!('special'in definition))throw Error('fixture');reference.board[at.row][at.col]!.special=definition.special;
    const result=reference.activate(at);result.steps[0].before[at.row][at.col]=copy(before.board[at.row][at.col]!);
    expect(plan.result).toEqual(result);expect(plan.after).toEqual({board:reference.board,leaves:reference.leaves,ruleVersion:2,...(reference.hasCrates?{crates:reference.crates}:{})});
    expect(reference.findMatches()).toEqual([]);expect(reference.hasMoves()).toBe(true);expect(rng).toHaveBeenCalled();expect(plan.result!.steps.at(-1)!.after).toEqual(plan.after.board);
  });
  it('범위 안 기존 특수/두 겹 낙엽도 실제 연쇄와 집계를 사용하고 미리보기는 기본 범위만 읽는다',()=>{
    const {round,level}=roundAt(),at=level.leaves![0],near={row:at.row,col:at.col+1};
    round.board[near.row][near.col]!.special='row';const before=copy(round),preview=puzzleToolArea(round,'trowel',at);
    expect(preview).toHaveLength(9);expect(round).toEqual(before);const plan=preparePuzzleTool(round,'trowel',at,undefined,seededRng(91))!;
    expect(plan.result!.steps[0].effects!.length).toBeGreaterThan(1);expect(plan.result!.steps[0].leaves!.hits.find(p=>p.row===at.row&&p.col===at.col)).toMatchObject({before:2,after:0});expect(round).toEqual(before);
  });
  it.each([{row:-1,col:0},{row:8,col:0},{row:1.5,col:0},{row:NaN,col:0}])('무효 좌표 %#는 난수를 한 번도 호출하지 않는다',at=>{
    const {round}=roundAt(),before=copy(round),rng=vi.fn(()=>.5);expect(preparePuzzleTool(round,'trowel',at,undefined,rng)).toBeUndefined();expect(rng).not.toHaveBeenCalled();expect(round).toEqual(before);
  });
  it('구schema1/룰1·이미 쓴 도구·판당2회·원래특수·빈칸/상자 대상을 거절한다',()=>{
    const {round,at}=roundAt(),rng=vi.fn(()=>.5);
    for(const changed of [{schema:1},{ruleVersion:1},{actionProfile:undefined},{toolsUsed:['trowel']},{toolsUsed:['broom','bell']}])expect(preparePuzzleTool({...round,...changed} as RoundCheckpoint,'trowel',at,undefined,rng)).toBeUndefined();
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
  it('씨앗은 시작 전 일반블록 한 곳만 특수로 바꾸고 RNG/연쇄를 호출하지 않는다',()=>{
    const {round,at}=roundAt(6,false),before=copy(round),rng=vi.fn(()=>.5),plan=preparePuzzleTool(round,'seeds',at,undefined,rng)!;
    expect(plan.result).toBeUndefined();const expected=copy(before.board);expected[at.row][at.col]!.special='bomb';expect(plan.after.board).toEqual(expected);expect(plan.after.leaves).toEqual(round.leaves);expect(rng).not.toHaveBeenCalled();expect(round).toEqual(before);
    expect(preparePuzzleTool({...round,toolsStarted:true},'seeds',at,undefined,rng)).toBeUndefined();
  });
});
describe('도구 비용·체험·판·보상을 함께 준비한다',()=>{
  it('첫 무료 체험은 소개/사용/판/수집과 한 payload이며 동일 계획 재확정은 거절한다',()=>{
    const {round,at}=roundAt(),save=saveFor(round),before=copy(save),plan=preparePuzzleTool(round,'trowel',at,undefined,seededRng(8))!,outcome=puzzleToolOutcome(save,plan)!;
    expect(outcome.cost).toBe(0);expect(outcome.save!.coins).toBe(save.coins);expect(outcome.save!.puzzleTools).toEqual({schema:1,introduced:['trowel'],trialUsed:['trowel']});
    expect(outcome.save!.inProgress).toMatchObject({moves:round.moves,toolsUsed:['trowel'],toolsStarted:true,board:plan.after.board,score:outcome.score,collected:outcome.collected});expect(validateCheckpoint(outcome.save!.inProgress,100)).toEqual(outcome.save!.inProgress);
    expect(puzzleToolOutcome(outcome.save!,plan)).toBeUndefined();expect(save).toEqual(before);
  });
  it('이미 체험한 사용은 현재 잔액에서만 차감하고 저장 실패는 원본/무료기록을 바꾸지 않는다',()=>{
    const {round,at}=roundAt(),save=saveFor(round);save.puzzleTools={schema:1,introduced:['trowel'],trialUsed:['trowel']};const raw=JSON.stringify(save),plan=preparePuzzleTool(round,'trowel',at,undefined,seededRng(8))!,outcome=puzzleToolOutcome(save,plan)!;
    expect(outcome.cost).toBe(30);expect(outcome.save!.coins).toBe(170);expect(puzzleToolOutcome({...save,coins:29},plan)).toBeUndefined();
    const values=new Map([[SAVE_KEY,raw]]),store=new SaveStore(()=>({getItem:k=>values.get(k)??null,setItem:()=>{throw Error('write');},removeItem:()=>{}}));store.load();expect(store.save(outcome.save!)).toBe(false);expect(values.get(SAVE_KEY)).toBe(raw);expect(JSON.stringify(save)).toBe(raw);
  });
  it('승리의 기존 +1별/+40코인만 같은 저장에서 주고 결과 재사용은 거절한다',()=>{
    const {round,level}=roundAt(),goal=level.goals[0],at=round.board.flatMap((line,row)=>line.flatMap((tile,col)=>tile?.kind===goal.kind?[{row,col}]:[]))[0];
    round.leaves=round.leaves.map(line=>line.map(()=>0));round.clearedLeaves=level.leaves!.length;for(const g of level.goals)round.collected[g.kind]=g.count-(g.kind===goal.kind?1:0);
    const save=saveFor(round),plan=preparePuzzleTool(round,'trowel',at,undefined,seededRng(10))!,outcome=puzzleToolOutcome(save,plan)!;
    expect(outcome.won).toBe(true);expect(outcome.firstReward).toBe(true);expect(outcome.save!.stars).toBe(save.stars+1);expect(outcome.save!.coins).toBe(save.coins+40);expect(outcome.save!.completed.filter(id=>id===6)).toHaveLength(1);expect(outcome.save!.inProgress).toBeUndefined();expect(puzzleToolOutcome(outcome.save!,plan)).toBeUndefined();
  });
  it('정상 해금은 최고 도달에서만 읽고 시험 체험은 일반 저장/체험 지급을 만들지 않는다',()=>{
    const {round,at}=roundAt(),save=saveFor(round),before=copy(save),plan=preparePuzzleTool(round,'trowel',at,undefined,seededRng(8))!;
    expect(puzzleToolOutcome({...save,highestLevel:8},plan)).toBeUndefined();const trial=puzzleToolOutcome({...save,highestLevel:1},plan,true)!;expect(trial.save).toBeUndefined();expect(trial.cost).toBe(0);expect(trial.firstReward).toBe(false);expect(trial.tools.used).toEqual(['trowel']);expect(save).toEqual(before);
  });
});
