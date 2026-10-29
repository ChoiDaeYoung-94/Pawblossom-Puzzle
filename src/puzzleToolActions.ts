import {BoardEngine,seededRng,type BoardSnapshot,type Position,type SwapResult} from './core';
import {levels,validateCheckpoint,type RoundCheckpoint,type SaveData} from './state';
import {cloneSnapshot} from './puzzleHelp';
import {puzzleTool,puzzleToolIds,type PuzzleToolId,type PuzzleToolRound} from './puzzleTools';

export interface PuzzleToolPlan {id:PuzzleToolId;round:RoundCheckpoint;target:Position;swap?:Position;after:BoardSnapshot;result?:SwapResult}
export interface PuzzleToolOutcome {save?:SaveData;checkpoint?:RoundCheckpoint;tools:PuzzleToolRound;score:number;collected:number[];clearedLeaves:number;clearedCrates:number;won:boolean;firstReward:boolean;cost:number}
const copy=<T>(value:T):T=>JSON.parse(JSON.stringify(value)) as T;
const same=(a:Position,b:Position)=>a.row===b.row&&a.col===b.col;
const integerPosition=(at:Position)=>at&&Number.isInteger(at.row)&&Number.isInteger(at.col);
function source(round:RoundCheckpoint,id:PuzzleToolId){
  if(!puzzleToolIds.includes(id)||round.schema!==2||round.ruleVersion!==2||round.actionProfile!=='tools-v2')return;
  const valid=validateCheckpoint(round,round.levelId);if(!valid||valid.toolsUsed!.length>=2||valid.toolsUsed!.includes(id))return;
  const level=levels[valid.levelId-1];
  const engine=new BoardEngine(8,8,()=>{throw Error('도구 미리보기의 난수 사용');},valid,2,level.mask,level.crates);
  return {round:valid,level,engine};
}
function ordinary(engine:BoardEngine,at:Position){return integerPosition(at)&&engine.isPlayable(at)&&!engine.board[at.row][at.col]!.special;}
export function validPuzzleToolTarget(round:RoundCheckpoint,id:PuzzleToolId,at:Position,other?:Position):boolean {
  try{const c=source(round,id);return Boolean(c&&ordinary(c.engine,at)&&(id!=='gloves'||other&&ordinary(c.engine,other)&&c.engine.legalMoves().some(move=>same(move.a,at)&&same(move.b,other)||same(move.b,at)&&same(move.a,other))));}catch{return false;}
}

/** 생성 대상 한 칸 또는 교환할 두 칸만 읽습니다. 아직 특수를 발동하지 않습니다. 난수0. */
export function puzzleToolArea(round:RoundCheckpoint,id:PuzzleToolId,at:Position,other?:Position):Position[] {
  try{
    const context=source(round,id);if(!context||!ordinary(context.engine,at))return [];
    const {engine}=context;
    if(id==='gloves')return other&&ordinary(engine,other)&&Math.abs(at.row-other.row)+Math.abs(at.col-other.col)===1?[{...at},{...other}]:[{...at}];
    return [{...at}];
  }catch{return [];}
}

/** 공개 엔진 API를 후보 사본에서 조합합니다. 원래 판/엔진 RNG는 읽거나 소비하지 않습니다. */
export function preparePuzzleTool(round:RoundCheckpoint,id:PuzzleToolId,at:Position,other?:Position,rng?:()=>number):PuzzleToolPlan|undefined {
  try{
    const context=source(round,id);if(!context||!ordinary(context.engine,at))return;
    if(id==='gloves'&&(!other||!ordinary(context.engine,other)||Math.abs(at.row-other.row)+Math.abs(at.col-other.col)!==1||!context.engine.legalMoves().some(move=>same(move.a,at)&&same(move.b,other)||same(move.b,at)&&same(move.a,other))))return;
    let candidateRng=rng;
    const nextRandom=()=>{if(!candidateRng){const seed=new Uint32Array(1);globalThis.crypto.getRandomValues(seed);candidateRng=seededRng(seed[0]);}return candidateRng();};
    const engine=new BoardEngine(8,8,nextRandom,context.round,2,context.level.mask,context.level.crates);
    const definition=puzzleTool(id);let result:SwapResult|undefined;
    if(id==='gloves')result=engine.swap(at,other!);
    else{
      if(!('special' in definition))return;
      engine.board[at.row][at.col]!.special=definition.special;
    }
    if(result&&!result.valid||engine.findMatches().length||!engine.hasMoves())return;
    const after:BoardSnapshot={board:engine.board,leaves:engine.leaves,ruleVersion:2,...(engine.hasCrates?{crates:engine.crates}:{})};
    return copy({id,round:context.round,target:{...at},...(id==='gloves'?{swap:{...other!}}:{}),after,...(result?{result}:{})});
  }catch{return;}
}

/** 비용·체험·사용 제한·보드·첫 보상을 같은 payload로 준비합니다. 쓰기는 호출자 한 번뿐입니다. */
export function puzzleToolOutcome(save:SaveData,plan:PuzzleToolPlan,testing=false):PuzzleToolOutcome|undefined {
  const {id,round,result}=plan,definition=puzzleTool(id);
  if(!definition||!source(round,id)||!testing&&save.highestLevel<definition.unlock)return;
  if(!testing&&JSON.stringify(validateCheckpoint(save.inProgress,save.highestLevel))!==JSON.stringify(round))return;
  const free=testing||!save.puzzleTools.trialUsed.includes(id),cost=free?0:definition.coins;if(!testing&&save.coins<cost)return;
  const next=copy(save),level=levels[round.levelId-1],collected=round.collected.map((n,i)=>n+(result?.collected[i]??0)),score=round.score+(result?.score??0);
  const clearedLeaves=round.clearedLeaves+(result?.leavesCleared??0),clearedCrates=(round.clearedCrates??0)+(result?.cratesCleared??0);
  const tools:PuzzleToolRound={profile:'tools-v2',used:[...round.toolsUsed!,id],started:true};
  const won=level.goals.every(goal=>collected[goal.kind]>=goal.count)&&clearedLeaves>=(level.leaves?.length??0)&&clearedCrates>=(level.crates?.length??0);
  const firstReward=won&&!testing&&!next.completed.includes(level.id);
  const checkpoint:RoundCheckpoint={...copy(round),...cloneSnapshot(plan.after),toolsUsed:tools.used,toolsStarted:true,collected,score,clearedLeaves,...(level.crates?{clearedCrates}:{})};
  if(!won&&!validateCheckpoint(checkpoint,level.id))return;
  if(!testing){
    next.coins-=cost;if(!next.puzzleTools.introduced.includes(id))next.puzzleTools.introduced.push(id);
    if(free)next.puzzleTools.trialUsed.push(id);
    if(won){delete next.inProgress;if(firstReward){next.completed.push(level.id);next.stars++;next.coins+=40;next.highestLevel=Math.min(levels.length,Math.max(next.highestLevel,level.id+1));}}
    else next.inProgress=checkpoint;
  }
  return {...(!testing?{save:next}:{}),...(!won?{checkpoint}:{}),tools,collected,score,clearedLeaves,clearedCrates,won,firstReward,cost};
}
