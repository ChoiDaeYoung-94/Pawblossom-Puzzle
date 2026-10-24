import {gardenDesignFor,gardenProjects,gardenThemes,flowerDiversity,type GardenDesign} from './gardenDesign';
import {gardenSpacesFor,gardenSpaceSpecs,type GardenSpace} from './gardenSpaces';
import {careCost,freshPip,type PipCare} from './pipCare';
import {LEVEL_COUNT} from './levels';

export type GoalNeed='plots'|'growth'|'affection'|'diversity'|'clears'|'stars'|'coins'|'foundation';
export type GoalDestination='flowers'|'pip'|'map'|GardenSpace;
export interface GardenGoal {
  id:string;kind:'bed'|'project'|'theme'|'space';name:string;area:GoalDestination;done:boolean;
  needs:{kind:GoalNeed;current:number;required:number}[];
  firstClearRewardsExhausted?:boolean;
}
export interface GoalState {plots:number;pip:Pick<PipCare,'growth'|'affection'>;design?:GardenDesign;clears:number;stars:number;coins:number}
/** 소유·단계에서 읽은 계획입니다. 렌더링으로 새 저장 필드를 만들거나 소비하지 않습니다. */
export function gardenGoals(state:GoalState):GardenGoal[]{
  const {plots,pip,clears,stars,coins}=state,design=gardenDesignFor(state.design),spaces=gardenSpacesFor(design.spaces);
  const need=(kind:Exclude<GoalNeed,'foundation'>,required:number)=>({kind,current:({plots,growth:pip.growth,affection:pip.affection,diversity:flowerDiversity(design,plots),clears,stars,coins})[kind],required});
  const bed=(n:number):GardenGoal=>({id:`bed-${n}`,kind:'bed',name:String(n),area:'flowers',done:plots>=n,needs:[need('plots',n-1),need('stars',2)]});
  const projects=gardenProjects.map(p=>({id:p.id,kind:'project' as const,name:p.id,area:'flowers' as const,done:design.owned.includes(p.id),needs:[need('plots',p.plots),need('growth',p.growth),need('affection',p.affection),need('diversity',p.diversity),need('coins',p.cost)]}));
  const themes=gardenThemes.map(t=>({id:t.id,kind:'theme' as const,name:t.id,area:'flowers' as const,done:Boolean(design.ownedThemes?.includes(t.id)),needs:[need('clears',t.clears),need('plots',t.plots),need('growth',t.growth),need('affection',t.affection),need('coins',t.cost)]}));
  const spaceGoals=gardenSpaceSpecs.flatMap(s=>[1,2].map(phase=>({id:`${s.id}-${phase}`,kind:'space' as const,name:String(phase),area:s.id,done:spaces[s.id].phase>=phase,needs:[{kind:'foundation' as const,current:spaces[s.id].phase,required:phase-1},need('clears',s.clears[phase-1]),need('stars',s.stars)]})));
  return [bed(1),projects[0],bed(2),projects[1],bed(3),projects[2],bed(4),themes[0],bed(5),themes[1],...spaceGoals].map(goal=>{
    const needs:GardenGoal['needs']=goal.needs.slice();
    const careIndex=needs.findIndex(n=>(n.kind==='growth'||n.kind==='affection')&&n.current<n.required),cost=careCost({...freshPip(),...pip});
    if(careIndex>=0&&coins<cost)needs.splice(careIndex,0,need('coins',cost));
    const plotIndex=needs.findIndex(n=>n.kind==='plots'&&n.current<n.required);
    if(plotIndex>=0&&stars<2)needs.splice(plotIndex,0,need('stars',2));
    return {...goal,needs,firstClearRewardsExhausted:clears>=LEVEL_COUNT};
  });
}
export function goalNextStep(goal:GardenGoal){
  if(goal.done)return;
  const missing=goal.needs.find(n=>n.current<n.required);
  if(missing&&(missing.kind==='coins'||missing.kind==='stars')&&goal.firstClearRewardsExhausted)return {missing,destination:'flowers' as const,unavailableIncome:true};
  const destination:GoalDestination=!missing||missing.kind==='foundation'?goal.area:missing.kind==='growth'||missing.kind==='affection'?'pip':missing.kind==='clears'||missing.kind==='stars'||missing.kind==='coins'?'map':'flowers';
  return {missing,destination};
}
export function nextGardenGoal(goals:GardenGoal[]){return goals.find(goal=>!goal.done&&!goalNextStep(goal)?.missing)??goals.find(goal=>!goal.done);}
