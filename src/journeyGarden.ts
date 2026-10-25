import {LEVEL_COUNT} from './levels';

/** 두 풍경의 추억을 한 작품으로 잇습니다. 기본 복원은 코인/육성 수치가 필요 없습니다. */
export const journeyProjectSpecs=[
  {id:'conservatory',clears:[120,140],altCoins:280},
  {id:'lotus',clears:[160,180],altCoins:320},
  {id:'reading',clears:[200,220],altCoins:360},
  {id:'moonbridge',clears:[240,260],altCoins:400},
  {id:'teanook',clears:[280,300],altCoins:440},
  {id:'fountain',clears:[320,340],altCoins:480},
  {id:'crystal',clears:[360,380],altCoins:520},
  {id:'flowerwalk',clears:[400,420],altCoins:560},
  {id:'waterwheel',clears:[440,460],altCoins:600},
  {id:'starstage',clears:[480,500],altCoins:640},
] as const;
export const JOURNEY_STAR_COSTS=[15,25] as const;
export type JourneyProject=typeof journeyProjectSpecs[number]['id'];
export type JourneyStyle='base'|'alt';
export interface JourneyProjectState {phase:0|1|2;altOwned:boolean;style:JourneyStyle}
/** 실제로 선택/복원한 작품만 저장합니다. 구 저장의 필드 부재는 그대로 유지합니다. */
export type JourneyProjects=Partial<Record<JourneyProject,JourneyProjectState>>;
export type JourneyAction={kind:'restore';project:JourneyProject}|{kind:'style';project:JourneyProject;style:JourneyStyle};
const count=(n:number)=>Number.isInteger(n)&&n>=0&&n<=LEVEL_COUNT;
const record=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&Object.prototype.toString.call(v)==='[object Object]';
export const freshJourneyProject=():JourneyProjectState=>({phase:0,altOwned:false,style:'base'});
export function cloneJourneyProjects(value:JourneyProjects):JourneyProjects {
  return Object.fromEntries(Object.entries(value).map(([id,state])=>[id,{...state}]));
}
export function journeyProjectFor(value:JourneyProjects|undefined,id:JourneyProject):JourneyProjectState{const state=value?.[id];return state?{...state}:freshJourneyProject();}
export function validateJourneyProjects(value:unknown,completed:number):JourneyProjects|undefined {
  if(!count(completed)||!record(value)||Object.keys(value).length>journeyProjectSpecs.length)return;
  const projects:JourneyProjects={};
  for(const id of Object.keys(value)){
    const spec=journeyProjectSpecs.find(spec=>spec.id===id),state=value[id];
    if(!spec||!record(state)||Object.keys(state).length!==3||Object.keys(state).some(key=>!['phase','altOwned','style'].includes(key))
      ||!Number.isInteger(state.phase)||![0,1,2].includes(state.phase as number)||typeof state.altOwned!=='boolean'||!['base','alt'].includes(state.style as string))return;
    const phase=state.phase as 0|1|2;
    if(phase>0&&completed<spec.clears[(phase-1) as 0|1]||phase!==2&&(state.altOwned||state.style!=='base')||state.style==='alt'&&!state.altOwned)return;
    projects[spec.id]={phase,altOwned:state.altOwned,style:state.style as JourneyStyle};
  }
  return projects;
}
/** 미리보기는 조건이 부족해도 만듭니다. 저장과 재화는 변경하지 않습니다. */
export function previewJourneyAction(current:JourneyProjects|undefined,action:JourneyAction,completed:number){
  if(!count(completed)||!record(action))return;
  const spec=journeyProjectSpecs.find(spec=>spec.id===action.project);
  if(!spec||!['restore','style'].includes(action.kind)||Object.keys(action).some(key=>!['kind','project',...(action.kind==='style'?['style']:[])].includes(key)))return;
  const projects:JourneyProjects|undefined=current===undefined?{}:validateJourneyProjects(current,completed);if(!projects)return;
  const before=journeyProjectFor(projects,spec.id),after={...before};let costStars=0,costCoins=0,requiredClears=spec.clears[1] as number;
  if(action.kind==='restore'){
    if(before.phase===2)return;
    costStars=JOURNEY_STAR_COSTS[before.phase];requiredClears=spec.clears[before.phase];after.phase=(before.phase+1) as 1|2;
  }else{
    if(before.phase!==2||!['base','alt'].includes(action.style)||before.style===action.style)return;
    if(action.style==='alt'&&!before.altOwned){costCoins=spec.altCoins;after.altOwned=true;}
    after.style=action.style;
  }
  projects[spec.id]=after;return {projects,before,after,costStars,costCoins,requiredClears};
}
/** 확정 시에는 현재 고유 완료 수·잔액·단계·소유를 다시 검사합니다. 입력 객체는 변경하지 않습니다. */
export function prepareJourneyAction(stars:number,coins:number,current:JourneyProjects|undefined,action:JourneyAction,completed:number){
  if(!Number.isInteger(stars)||stars<0||stars>LEVEL_COUNT||!Number.isInteger(coins)||coins<0||coins>1_000_000)return;
  const result=previewJourneyAction(current,action,completed);
  if(!result||completed<result.requiredClears||stars<result.costStars||coins<result.costCoins)return;
  return {...result,stars:stars-result.costStars,coins:coins-result.costCoins};
}
export function nextJourneyProject(current:JourneyProjects|undefined){return journeyProjectSpecs.find(spec=>(current?.[spec.id]?.phase??0)<2);}
