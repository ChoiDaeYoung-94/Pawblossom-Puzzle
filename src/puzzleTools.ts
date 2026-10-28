/** 직접 쓰는 도구의 안정 ID입니다. 매치로 생성하는 특수/무료 섞기와 별개입니다. */
export const puzzleToolIds=['trowel','gloves','broom','bell','seeds'] as const;
export type PuzzleToolId=typeof puzzleToolIds[number];
export interface PuzzleToolProgress {schema:1;introduced:PuzzleToolId[];trialUsed:PuzzleToolId[]}
export interface PuzzleToolRound {used:PuzzleToolId[];started:boolean}
export const puzzleToolCatalog=[
  {id:'trowel',unlock:9,coins:30,mode:'target',special:'bomb'},
  {id:'gloves',unlock:19,coins:20,mode:'swap'},
  {id:'broom',unlock:29,coins:40,mode:'target',special:'row'},
  {id:'bell',unlock:49,coins:60,mode:'target',special:'rainbow'},
  {id:'seeds',unlock:69,coins:35,mode:'start',special:'bomb'},
] as const;
export const puzzleTool=(id:PuzzleToolId)=>puzzleToolCatalog.find(tool=>tool.id===id)!;
export const freshToolProgress=():PuzzleToolProgress=>({schema:1,introduced:[],trialUsed:[]});
const record=(value:unknown):value is Record<string,unknown>=>typeof value==='object'&&value!==null&&!Array.isArray(value);
export function validateToolIds(value:unknown,max:number=puzzleToolIds.length):PuzzleToolId[]|undefined {
  if(!Array.isArray(value)||value.length>max||Array.from(value).some(id=>!puzzleToolIds.includes(id))||new Set(value).size!==value.length)return;
  return value.slice() as PuzzleToolId[];
}
/** 손상된 소비 기록을 기본값으로 지워 무료 체험을 다시 주지 않습니다. */
export function validateToolProgress(value:unknown):PuzzleToolProgress|undefined {
  if(!record(value)||value.schema!==1||Object.keys(value).some(k=>!['schema','introduced','trialUsed'].includes(k)))return;
  const introduced=validateToolIds(value.introduced),trialUsed=validateToolIds(value.trialUsed);
  if(!introduced||!trialUsed||trialUsed.some(id=>!introduced.includes(id)))return;
  return {schema:1,introduced,trialUsed};
}
