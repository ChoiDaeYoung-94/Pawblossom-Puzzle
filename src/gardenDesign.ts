export const flowerStyles=['meadow','daisy','violet'] as const;
export type FlowerStyle=typeof flowerStyles[number];
export const gardenProjects=[
  {id:'bench',plots:1,growth:20,affection:20,diversity:1,cost:0},
  {id:'butterflies',plots:2,growth:60,affection:40,diversity:2,cost:0},
  {id:'lantern',plots:3,growth:80,affection:80,diversity:3,cost:20},
] as const;
export type GardenProject=typeof gardenProjects[number]['id'];
export interface GardenDesign {schema:1;flowers:FlowerStyle[];owned:GardenProject[];placed:GardenProject[];lanternPlot?:number;}
type Care={growth:number;affection:number};
export type GardenAction={kind:'flower';plot:number;flower:FlowerStyle}|{kind:'claim'|'toggle';project:GardenProject}|{kind:'placeLantern';plot:number};
export const freshGardenDesign=():GardenDesign=>({schema:1,flowers:Array(5).fill('meadow') as FlowerStyle[],owned:[],placed:[]});
export const gardenDesignFor=(design?:GardenDesign):GardenDesign=>design?{...design,flowers:design.flowers.slice(),owned:design.owned.slice(),placed:design.placed.slice()}:freshGardenDesign();
export const flowerDiversity=(design:GardenDesign,plots:number)=>new Set(design.flowers.slice(0,plots)).size;
export function projectReady(project:typeof gardenProjects[number],plots:number,pip:Care,design:GardenDesign):boolean {
  return plots>=project.plots&&pip.growth>=project.growth&&pip.affection>=project.affection&&flowerDiversity(design,plots)>=project.diversity;
}
/** 소유는 영구적입니다. 꽃 다양성은 첫 획득 때만 확인하고 이후 교체로 취소하지 않습니다. */
export function validateGardenDesign(value:unknown,plots:number,pip:Care):GardenDesign|undefined {
  if(!value||typeof value!=='object'||Array.isArray(value)||!Number.isInteger(plots)||plots<0||plots>5
    ||![pip.growth,pip.affection].every(n=>Number.isInteger(n)&&n>=0&&n<=100))return;
  const v=value as Record<string,unknown>;
  if(Object.keys(v).some(k=>!['schema','flowers','owned','placed','lanternPlot'].includes(k))||v.schema!==1
    ||!Array.isArray(v.flowers)||v.flowers.length!==5||!Array.isArray(v.owned)||v.owned.length>3||!Array.isArray(v.placed)||v.placed.length>3)return;
  const flowers:FlowerStyle[]=[],owned:GardenProject[]=[],placed:GardenProject[]=[],sourceOwned=v.owned;
  for(let i=0;i<5;i++){if(!flowerStyles.includes(v.flowers[i] as FlowerStyle)||i>=plots&&v.flowers[i]!=='meadow')return;flowers.push(v.flowers[i] as FlowerStyle);}
  for(let i=0;i<v.owned.length;i++){
    const project=gardenProjects.find(p=>p.id===sourceOwned[i]);
    if(!project||owned.includes(project.id)||plots<project.plots||pip.growth<project.growth||pip.affection<project.affection)return;
    owned.push(project.id);
  }
  for(let i=0;i<v.placed.length;i++){const id=v.placed[i] as GardenProject;if(!owned.includes(id)||placed.includes(id))return;placed.push(id);}
  if(v.lanternPlot!==undefined&&(typeof v.lanternPlot!=='number'||!Number.isInteger(v.lanternPlot)||v.lanternPlot<0||v.lanternPlot>=plots||!owned.includes('lantern')))return;
  return {schema:1,flowers,owned,placed,...(v.lanternPlot===undefined?{}:{lanternPlot:v.lanternPlot as number})};
}
/** 재화와 선택을 함께 계산하고 입력 객체/배열은 바꾸지 않습니다. */
export function prepareGardenAction(coins:number,plots:number,pip:Care,current:GardenDesign|undefined,action:GardenAction):{coins:number;design:GardenDesign;cost:number}|undefined {
  if(!Number.isInteger(coins)||coins<0||coins>1_000_000||!Number.isInteger(plots)||plots<0||plots>5)return;
  const design=validateGardenDesign(current??freshGardenDesign(),plots,pip);if(!design)return;
  let cost=0;
  if(action.kind==='flower'){
    if(!Number.isInteger(action.plot)||action.plot<0||action.plot>=plots||!flowerStyles.includes(action.flower)||design.flowers[action.plot]===action.flower)return;
    design.flowers[action.plot]=action.flower;
  }else if(action.kind==='placeLantern'){
    if(!design.owned.includes('lantern')||!Number.isInteger(action.plot)||action.plot<0||action.plot>=plots
      ||design.lanternPlot===action.plot&&design.placed.includes('lantern'))return;
    design.lanternPlot=action.plot;
    if(!design.placed.includes('lantern'))design.placed.push('lantern');
  }else{
    const project=gardenProjects.find(p=>p.id===action.project);if(!project)return;
    if(action.kind==='claim'){
      if(design.owned.includes(project.id)||!projectReady(project,plots,pip,design))return;
      cost=project.cost;if(coins<cost)return;
      design.owned.push(project.id);design.placed.push(project.id);
    }else if(action.kind==='toggle'){
      if(!design.owned.includes(project.id))return;
      if(design.placed.includes(project.id))design.placed=design.placed.filter(id=>id!==project.id);else design.placed.push(project.id);
    }else return;
  }
  return {coins:coins-cost,design,cost};
}
