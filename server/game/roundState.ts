/** 서버 내부 회차 계산. 공개 입력/응답과 RNG를 가진 영구 상태를 분리합니다. */
import {createHash} from 'node:crypto';
import {BoardEngine, seededRng, type BoardSnapshot, type Position} from '../../src/core/BoardEngine.ts';
import {levels, type Level} from '../../src/levels.ts';

// 엔진 변경 시 이 해시와 profile을 함께 갱신해야 하며 기존 DB는 migration 없이 열리지 않습니다.
export const ENGINE_PROFILE = 'pawblossom-board-v1';
export const ENGINE_SOURCE_SHA256 = 'f07d4d5ae190b9a0ff28150e2c392adf7810a3eb84b17e1de25c3493269c293e';
export type RoundStatus = 'active' | 'won' | 'failed' | 'abandoned';
export type Command = {type:'swap';a:Position;b:Position} | {type:'activate';at:Position} | {type:'shuffle'} | {type:'abandon'};
export type CommandOutcome = 'valid-swap' | 'invalid-swap' | 'valid-activation' | 'invalid-activation' | 'shuffled' | 'abandoned';
type Frozen<T> = T extends object ? {readonly [K in keyof T]:Frozen<T[K]>} : T;
export interface RoundState extends BoardSnapshot {
  level:Level;
  rngState:number;
  moves:number;
  collected:number[];
  score:number;
  shuffles:number;
  clearedLeaves:number;
  status:RoundStatus;
}
export type PublicRoundState = Frozen<Omit<RoundState,'rngState'>>;
const copy = <T>(v:T):T => JSON.parse(JSON.stringify(v));
export function freezeCopy<T>(v:T):Frozen<T> {
  const value=copy(v);
  const freeze=(x:unknown):void=>{if(x && typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}};
  freeze(value);return value as Frozen<T>;
}
/** getter·상속·추가 필드·symbol을 읽지 않고 거절합니다. Proxy 예외는 호출 경계에서 처리합니다. */
export function exactRecord(v:unknown,keys:readonly string[]):Record<string,unknown> {
  if(!v || typeof v!=='object' || ![Object.prototype,null].includes(Object.getPrototypeOf(v)))throw new Error('invalid-record');
  const own=Reflect.ownKeys(v);
  if(own.length!==keys.length || own.some(k=>typeof k!=='string'||!keys.includes(k)))throw new Error('invalid-record');
  const out:Record<string,unknown>={};
  for(const k of keys){const d=Object.getOwnPropertyDescriptor(v,k);if(!d || !('value' in d)||!d.enumerable)throw new Error('invalid-record');out[k]=d.value;}
  return out;
}
function array(v:unknown,size:number):unknown[] {
  if(!Array.isArray(v)||v.length!==size||Object.getPrototypeOf(v)!==Array.prototype)throw new Error('invalid-array');
  const descriptors=Object.getOwnPropertyDescriptors(v);
  if(Reflect.ownKeys(descriptors).length!==size+1)throw new Error('invalid-array');
  const out:unknown[]=[];
  for(let i=0;i<size;i++){const d=descriptors[String(i)];if(!d||!('value' in d)||!d.enumerable)throw new Error('invalid-array');out.push(d.value);}
  return out;
}
const integer=(v:unknown,min:number,max:number):v is number=>Number.isSafeInteger(v)&&Number(v)>=min&&Number(v)<=max;
const catalog=freezeCopy(levels);
export const CONTENT_HASH=createHash('sha256').update(JSON.stringify(catalog)).digest('hex');
export function levelSnapshot(id:number):Level {
  if(!integer(id,1,catalog.length)||catalog[id-1].id!==id)throw new Error('invalid-level');
  return copy(catalog[id-1]) as Level;
}
export const isLevelId=(id:unknown):id is number=>integer(id,1,catalog.length);
export function commandSnapshot(input:unknown):Command {
  if(!input||typeof input!=='object')throw new Error('invalid-command');
  const d=Object.getOwnPropertyDescriptor(input,'type');
  if(!d||!('value' in d))throw new Error('invalid-command');
  const point=(v:unknown):Position=>{const p=exactRecord(v,['row','col']);if(!integer(p.row,0,7)||!integer(p.col,0,7))throw new Error('invalid-point');return {row:p.row,col:p.col};};
  if(d.value==='shuffle'||d.value==='abandon'){const c=exactRecord(input,['type']);return {type:c.type as 'shuffle'|'abandon'};}
  if(d.value==='activate'){const c=exactRecord(input,['type','at']);return {type:'activate',at:point(c.at)};}
  const c=exactRecord(input,['type','a','b']);
  if(c.type!=='swap')throw new Error('invalid-command');
  const a=point(c.a),b=point(c.b);
  if(Math.abs(a.row-b.row)+Math.abs(a.col-b.col)!==1)throw new Error('invalid-point');
  return {type:'swap',a,b};
}
function trackedRng(state:Pick<RoundState,'rngState'>):()=>number {
  // seededRng(currentState) 호출마다 진행 상태를 저장합니다. 복원 시 초기 생성 난수를 소비하지 않습니다.
  const next=seededRng(state.rngState);
  return ()=>{const value=next();state.rngState=(state.rngState+0x6d2b79f5)>>>0;return value;};
}
export function startState(levelId:number,seed:number):RoundState {
  if(!integer(seed,0,0xffffffff))throw new Error('invalid-seed');
  const level=levelSnapshot(levelId);
  const state:RoundState={level,rngState:seed,moves:level.moves,collected:[0,0,0,0,0,0],score:0,shuffles:1,clearedLeaves:0,status:'active',board:[],leaves:[]};
  const engine=new BoardEngine(8,8,trackedRng(state));engine.setLeaves(level.leaves??[]);
  state.board=engine.board;state.leaves=engine.leaves;return state;
}
export function advanceState(input:RoundState,command:Command):{state:RoundState;outcome:CommandOutcome} {
  validateState(input);
  if(input.status!=='active'&&!(input.status==='failed'&&command.type==='abandon'))throw new Error('round-terminal');
  const state=copy(input), engine=new BoardEngine(8,8,trackedRng(state),state);
  let outcome:CommandOutcome;
  if(command.type==='abandon'){state.status='abandoned';outcome='abandoned';}
  else if(command.type==='shuffle'){
    if(!state.shuffles)throw new Error('shuffle-used');
    engine.shuffle();state.shuffles--;outcome='shuffled';
  }else{
    const result=command.type==='activate'?engine.activate(command.at):engine.swap(command.a,command.b);
    outcome=command.type==='activate'?(result.valid?'valid-activation':'invalid-activation'):(result.valid?'valid-swap':'invalid-swap');
    if(result.valid){state.moves--;state.score+=result.score;state.clearedLeaves+=result.leavesCleared??0;result.collected.forEach((n,i)=>state.collected[i]+=n);
      // 현재 main과 동일하게 마지막 이동의 목표 달성을 실패보다 우선합니다.
      if(state.level.goals.every(g=>state.collected[g.kind]>=g.count)&&state.clearedLeaves>=(state.level.leaves?.length??0))state.status='won';
      else if(!state.moves)state.status='failed';
    }
  }
  state.board=engine.board;state.leaves=engine.leaves;validateState(state);return {state,outcome};
}
export function publicState(state:RoundState):PublicRoundState {
  const {rngState:_,...visible}=state;return freezeCopy(visible);
}
/** HMAC 검증 뒤에도 구조·범위·콘텐츠·종료 상태의 일관성을 검사합니다. */
export function validateState(input:unknown):asserts input is RoundState {
  const s=exactRecord(input,['level','rngState','moves','collected','score','shuffles','clearedLeaves','status','board','leaves']);
  const id=Object.getOwnPropertyDescriptor(s.level??{},'id')?.value;
  if(!isLevelId(id))throw new Error('invalid-level');
  const expectedLevel=levelSnapshot(id);
  const lv=exactRecord(s.level,Object.keys(expectedLevel));
  if(lv.id!==id||lv.moves!==expectedLevel.moves)throw new Error('invalid-level');
  array(lv.goals,expectedLevel.goals.length).forEach((g,i)=>{const goal=exactRecord(g,['kind','count']),expected=expectedLevel.goals[i];if(goal.kind!==expected.kind||goal.count!==expected.count)throw new Error('invalid-level');});
  if(expectedLevel.leaves)array(lv.leaves,expectedLevel.leaves.length).forEach((p,i)=>{const pile=exactRecord(p,['row','col','layers']),expected=expectedLevel.leaves![i];if(pile.row!==expected.row||pile.col!==expected.col||pile.layers!==expected.layers)throw new Error('invalid-level');});
  const level=levelSnapshot(id), piles=level.leaves??[];
  if(!integer(s.rngState,0,0xffffffff)||!integer(s.moves,0,level.moves)||!integer(s.score,0,1_000_000_000)
    ||!integer(s.shuffles,0,1)||!integer(s.clearedLeaves,0,piles.length))throw new Error('invalid-state');
  const collected=array(s.collected,6);
  if(!collected.every(v=>integer(v,0,10_000_000)))throw new Error('invalid-state');
  const board=array(s.board,8).map(row=>array(row,8).map(tile=>{
    const keys=Reflect.ownKeys(tile as object),t=exactRecord(tile,keys.length===1?['kind']:['kind','special']);
    if(!integer(t.kind,0,5)||(keys.length===2&&(typeof t.special!=='string'||!['row','column','bomb','rainbow'].includes(t.special))))throw new Error('invalid-tile');
    return t;
  }));
  const leaves=array(s.leaves,8).map((row,r)=>array(row,8).map((v,c)=>{
    if(!integer(v,0,piles.find(p=>p.row===r&&p.col===c)?.layers??0))throw new Error('invalid-leaf');return v;
  }));
  const remaining=leaves.flat().filter(n=>n>0).length;
  if(piles.length-remaining!==s.clearedLeaves)throw new Error('invalid-leaf-count');
  const won=level.goals.every(g=>Number(collected[g.kind])>=g.count)&&s.clearedLeaves>=piles.length;
  if(typeof s.status!=='string'||!['active','won','failed','abandoned'].includes(s.status)||(s.status==='won'&&!won)||(s.status==='failed'&&(s.moves!==0||won))
    ||(s.status==='active'&&(s.moves===0||won))||(s.status==='abandoned'&&won))throw new Error('invalid-status');
  const engine=new BoardEngine(8,8,()=>{throw new Error('unexpected-rng');},{board:board as unknown as BoardSnapshot['board'],leaves});
  if(engine.findMatches().length||!engine.hasMoves())throw new Error('unsettled-board');
}
