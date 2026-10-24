import {freshGardenDesign,gardenDesignFor,validateGardenDesign,type GardenDesign,type FlowerStyle,type GardenTheme} from './gardenDesign';

export const gardenPresetIds=['sunny','butterfly','starlight'] as const;
export type GardenPresetId=typeof gardenPresetIds[number];
export type PresetNeed='plot'|'butterflies'|'starlight'|'lantern';
export interface GardenPresetPreview {id:GardenPresetId;missing:PresetNeed[];design?:GardenDesign;changed:boolean;}
const recipes:Record<GardenPresetId,{theme:GardenTheme;flowers:readonly FlowerStyle[]}>= {
  sunny:{theme:'meadow',flowers:['daisy','meadow']},
  butterfly:{theme:'meadow',flowers:['daisy','violet']},
  starlight:{theme:'starlight',flowers:['violet','daisy']},
};
/** 이미 소유한 선택만 조합합니다. 조회/취소는 저장을 만들지 않으며 획득·구매·재화 지급은 없습니다. */
export function previewGardenPreset(id:GardenPresetId,current:GardenDesign|undefined,plots:number,pip:{growth:number;affection:number},completed:number):GardenPresetPreview|undefined {
  if(!gardenPresetIds.includes(id))return;
  const before=validateGardenDesign(current??freshGardenDesign(),plots,pip,completed);if(!before)return;
  const missing:PresetNeed[]=[];
  if(plots===0)missing.push('plot');
  if(id==='butterfly'&&!before.owned.includes('butterflies'))missing.push('butterflies');
  if(id==='starlight'){
    if(!before.ownedThemes?.includes('starlight'))missing.push('starlight');
    if(!before.owned.includes('lantern'))missing.push('lantern');
  }
  if(missing.length)return {id,missing,changed:false};
  const next=gardenDesignFor(before),recipe=recipes[id];
  for(let i=0;i<plots;i++)next.flowers[i]=recipe.flowers[i%recipe.flowers.length];
  // 의미가 같은 구 저장에 선택적 기본 필드를 삽입하지 않습니다.
  if((next.theme??'meadow')!==recipe.theme)next.theme=recipe.theme;
  const decoration=id==='butterfly'?'butterflies':id==='starlight'?'lantern':undefined;
  if(decoration&&!next.placed.includes(decoration))next.placed.push(decoration);
  if(id==='starlight')next.lanternPlot=plots-1;
  const design=validateGardenDesign(next,plots,pip,completed);if(!design)return;
  return {id,missing,design,changed:JSON.stringify(before)!==JSON.stringify(design)};
}
