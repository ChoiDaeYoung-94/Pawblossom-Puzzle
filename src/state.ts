import type { Language } from './i18n';
import { LEVEL_COUNT, levels, type Level } from './levels';
import { BoardEngine, type BoardSnapshot, type Tile, type Special } from './core';
export interface RoundCheckpoint extends BoardSnapshot {
  schema: 1; levelId: number; levelSignature: string; moves: number; score: number;
  collected: number[]; shuffles: number; clearedLeaves: number;
}
export interface SaveData { version: 1; language: Language; highestLevel: number; completed: number[]; stars: number; coins: number; garden: number; music: boolean; sfx: boolean; tutorialSeen: boolean; inProgress?: RoundCheckpoint; }
const key = 'pawblossom.save.v1';
const defaults = (): SaveData => ({version:1, language:'ko', highestLevel:1, completed:[], stars:0, coins:0, garden:0, music:true, sfx:true, tutorialSeen:false});
const safeNumber = (x: unknown, fallback: number, max: number) => typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= max ? x : fallback;
// 기존 ID·목표·이동 수·고정 낙엽 구성이 달라진 저장은 복원하지 않습니다.
export function levelSignature(level:Level):string {
  return JSON.stringify([level.id,level.moves,level.goals.map(g=>[g.kind,g.count]),(level.leaves??[]).map(p=>[p.row,p.col,p.layers])]);
}
const integer=(x:unknown,max:number):x is number=>typeof x==='number'&&Number.isInteger(x)&&x>=0&&x<=max;
const record=(x:unknown):x is Record<string,unknown>=>typeof x==='object'&&x!==null&&!Array.isArray(x);
const grid=(x:unknown):x is unknown[][]=>Array.isArray(x)&&x.length===8&&x.every(row=>Array.isArray(row)&&row.length===8);
/** 작은 고정 크기만 순회하며 진행 중 회차가 손상돼도 영구 기록은 보존합니다. */
export function validateCheckpoint(value:unknown,highestLevel:number):RoundCheckpoint|undefined {
  if(!record(value)||value.schema!==1||!integer(value.levelId,LEVEL_COUNT)||value.levelId<1||value.levelId>highestLevel)return;
  const level=levels[value.levelId-1];
  if(value.levelSignature!==levelSignature(level)||!integer(value.moves,level.moves)||value.moves<1||!integer(value.score,100_000_000)||!integer(value.shuffles,1))return;
  if(!Array.isArray(value.collected)||value.collected.length!==6||!value.collected.every(n=>integer(n,1_000_000)))return;
  if(!grid(value.board)||!grid(value.leaves))return;
  const board:Tile[][]=[];
  const leafMax=Array.from({length:8},()=>Array(8).fill(0));
  for(const pile of level.leaves??[])leafMax[pile.row][pile.col]=pile.layers;
  let remaining=0;
  for(let row=0;row<8;row++){
    board[row]=[];
    for(let col=0;col<8;col++){
      const tile=value.board[row][col],layers=value.leaves[row][col];
      if(!record(tile)||!integer(tile.kind,5)||(tile.special!==undefined&&!['row','column','bomb','rainbow'].includes(tile.special as string)))return;
      board[row][col]={kind:tile.kind,...(tile.special!==undefined?{special:tile.special as Special}:{})};
      if(!integer(layers,leafMax[row][col]))return;
      if(layers>0)remaining++;
    }
  }
  const total=level.leaves?.length??0;
  if(value.clearedLeaves!==total-remaining||level.goals.every(g=>(value.collected as number[])[g.kind]>=g.count)&&remaining===0)return;
  const leaves=(value.leaves as number[][]).map(row=>row.slice());
  // 초기 생성 없이 조회하므로 실제 게임의 보충 난수를 소비하지 않습니다.
  const engine=new BoardEngine(8,8,()=>{throw Error('저장 검증 중 난수 사용');},{board,leaves});
  if(engine.findMatches().length||!engine.hasMoves())return;
  return {schema:1,levelId:level.id,levelSignature:levelSignature(level),board,leaves,moves:value.moves,score:value.score,
    collected:value.collected.slice() as number[],shuffles:value.shuffles,clearedLeaves:total-remaining};
}
export function loadSave(): SaveData {
  try {
    const x = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (!x || x.version !== 1) return defaults();
    const completed:number[]=Array.isArray(x.completed)? [...new Set<number>(x.completed.slice(0,LEVEL_COUNT*4).filter((n: unknown): n is number => typeof n==='number'&&Number.isInteger(n)&&n>=1&&n<=LEVEL_COUNT))]:[];
    // 기존 마지막 스테이지까지 완료한 저장도 새 콘텐츠의 첫 미완료 스테이지로 이어집니다.
    let frontier=1;while(frontier<LEVEL_COUNT&&completed.includes(frontier))frontier++;
    const highestLevel=Math.max(frontier,safeNumber(x.highestLevel,1,LEVEL_COUNT));
    const inProgress=validateCheckpoint(x.inProgress,highestLevel);
    return {version:1,language:x.language==='en'?'en':'ko', highestLevel,completed,
      stars:safeNumber(x.stars,0,LEVEL_COUNT), coins:safeNumber(x.coins,0,1000000), garden:safeNumber(x.garden,0,5),
      music:x.music!==false,sfx:x.sfx!==false,tutorialSeen:typeof x.tutorialSeen==='boolean'?x.tutorialSeen:completed.length>0,...(inProgress?{inProgress}:{})};
  } catch { return defaults(); }
}
export function saveData(data: SaveData): boolean { try {localStorage.setItem(key, JSON.stringify(data)); return true;}catch{return false;} }
export function clearSave(): SaveData { const data = defaults(); saveData(data); return data; }
export { levels, LEVEL_COUNT, chapters, chapterForLevel } from './levels';
