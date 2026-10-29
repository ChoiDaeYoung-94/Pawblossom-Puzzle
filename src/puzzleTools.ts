/** 저장 호환용 안정 ID입니다. 표시/생성 특수와 이름이 달라도 소비 기록은 보존합니다. */
export const puzzleToolIds=['trowel','gloves','broom','bell','seeds'] as const;
export type PuzzleToolId=typeof puzzleToolIds[number];
export type PuzzleToolProfile='tools-v1'|'tools-v2';
export interface PuzzleToolProgress {schema:2;introduced:PuzzleToolId[];trialUsed:PuzzleToolId[]}
export interface PuzzleToolRound {profile:PuzzleToolProfile;used:PuzzleToolId[];started:boolean}
export const puzzleToolCatalog=[
  {id:'trowel',unlock:9,coins:30,mode:'create',special:'bomb'},
  {id:'gloves',unlock:19,coins:20,mode:'swap'},
  {id:'broom',unlock:29,coins:40,mode:'create',special:'row'},
  {id:'bell',unlock:49,coins:60,mode:'create',special:'rainbow'},
  {id:'seeds',unlock:69,coins:35,mode:'create',special:'column'},
] as const;
export const puzzleTool=(id:PuzzleToolId)=>puzzleToolCatalog.find(tool=>tool.id===id)!;
export const freshToolProgress=():PuzzleToolProgress=>({schema:2,introduced:[],trialUsed:[]});
const record=(value:unknown):value is Record<string,unknown>=>typeof value==='object'&&value!==null&&!Array.isArray(value);
export function validateToolIds(value:unknown,max:number=puzzleToolIds.length):PuzzleToolId[]|undefined {
  if(!Array.isArray(value)||value.length>max||Array.from(value).some(id=>!puzzleToolIds.includes(id))||new Set(value).size!==value.length)return;
  return value.slice() as PuzzleToolId[];
}
/** 손상된 소비 기록을 기본값으로 지워 무료 체험을 다시 주지 않습니다. */
export function validateToolProgress(value:unknown):PuzzleToolProgress|undefined {
  if(!record(value)||(value.schema!==1&&value.schema!==2)||Object.keys(value).some(k=>!['schema','introduced','trialUsed'].includes(k)))return;
  const introduced=validateToolIds(value.introduced),trialUsed=validateToolIds(value.trialUsed);
  if(!introduced||!trialUsed||trialUsed.some(id=>!introduced.includes(id)))return;
  return {schema:2,introduced,trialUsed};
}
