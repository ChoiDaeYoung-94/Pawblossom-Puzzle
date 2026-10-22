import {LEVEL_COUNT} from './levels';

export const gardenSpaceSpecs=[
  {id:'pond',clears:[50,60],stars:12,altCoins:240},
  {id:'shelter',clears:[70,80],stars:14,altCoins:360},
  {id:'arch',clears:[90,100],stars:16,altCoins:480},
] as const;
export type GardenSpace=typeof gardenSpaceSpecs[number]['id'];
export type GardenArea='flowers'|GardenSpace;
export type SpaceStyle='base'|'alt';
export interface GardenSpaceState {phase:0|1|2;altOwned:boolean;style:SpaceStyle;}
export type GardenSpaces=Record<GardenSpace,GardenSpaceState>;
export type SpaceAction={kind:'restore';space:GardenSpace}|{kind:'style';space:GardenSpace;style:SpaceStyle};
export const freshGardenSpaces=():GardenSpaces=>({pond:{phase:0,altOwned:false,style:'base'},shelter:{phase:0,altOwned:false,style:'base'},arch:{phase:0,altOwned:false,style:'base'}});
export const gardenSpacesFor=(value?:GardenSpaces):GardenSpaces=>value?{pond:{...value.pond},shelter:{...value.shelter},arch:{...value.arch}}:freshGardenSpaces();
const record=(v:unknown):v is Record<string,unknown>=>Boolean(v)&&typeof v==='object'&&!Array.isArray(v);
const validCount=(n:number)=>Number.isInteger(n)&&n>=0&&n<=LEVEL_COUNT;
/** 필드 부재는 GardenDesign에서 보존하며, 존재하는 필드는 전체 구조를 엄격하게 검증합니다. */
export function validateGardenSpaces(value:unknown,completed:number):GardenSpaces|undefined {
  if(!validCount(completed)||!record(value)||Object.keys(value).length!==3||Object.keys(value).some(k=>!gardenSpaceSpecs.some(s=>s.id===k)))return;
  const spaces=freshGardenSpaces();
  for(const spec of gardenSpaceSpecs){
    const v=value[spec.id];
    if(!Object.hasOwn(value,spec.id)||!record(v)||Object.keys(v).length!==3||Object.keys(v).some(k=>!['phase','altOwned','style'].includes(k))
      ||!Number.isInteger(v.phase)||![0,1,2].includes(v.phase as number)||typeof v.altOwned!=='boolean'||!['base','alt'].includes(v.style as string))return;
    const phase=v.phase as 0|1|2;
    if(phase>0&&completed<spec.clears[(phase-1) as 0|1]||phase!==2&&(v.altOwned||v.style!=='base')||v.style==='alt'&&!v.altOwned)return;
    spaces[spec.id]={phase,altOwned:v.altOwned,style:v.style as SpaceStyle};
  }
  return spaces;
}
/** 미리보기는 완료/잔액 조건이 부족해도 만들며 저장하거나 재화를 사용하지 않습니다. */
export function previewSpaceAction(current:GardenSpaces|undefined,action:SpaceAction,completed:number){
  const spaces=current===undefined?validCount(completed)?freshGardenSpaces():undefined:validateGardenSpaces(current,completed);
  const spec=gardenSpaceSpecs.find(s=>s.id===action.space);if(!spaces||!spec)return;
  const state=spaces[spec.id];let costStars=0,costCoins=0,requiredClears=spec.clears[1] as number;
  if(action.kind==='restore'){
    if(state.phase===2)return;
    requiredClears=spec.clears[state.phase];state.phase=(state.phase+1) as 1|2;costStars=spec.stars;
  }else if(action.kind==='style'){
    if(state.phase!==2||!['base','alt'].includes(action.style)||state.style===action.style)return;
    if(action.style==='alt'&&!state.altOwned){costCoins=spec.altCoins;state.altOwned=true;}
    state.style=action.style;
  }else return;
  return {spaces,costStars,costCoins,requiredClears};
}
/** 확정할 때 현재 잔액과 고유 완료 조건을 다시 검사합니다. */
export function prepareSpaceAction(stars:number,coins:number,current:GardenSpaces|undefined,action:SpaceAction,completed:number){
  if(!Number.isInteger(stars)||stars<0||stars>LEVEL_COUNT||!Number.isInteger(coins)||coins<0||coins>1_000_000)return;
  const result=previewSpaceAction(current,action,completed);
  if(!result||completed<result.requiredClears||stars<result.costStars||coins<result.costCoins)return;
  return {...result,stars:stars-result.costStars,coins:coins-result.costCoins};
}
