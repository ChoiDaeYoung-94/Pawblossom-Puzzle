import {MAP_PROP_ATLAS,MAP_PROP_FRAMES} from './CampaignProps';
import type {JourneyProject} from './journeyGarden';

/** 지도에서 본 풍경을 나중에 정원으로 가져옵니다. 해금/소유/보상은 바꾸지 않습니다. */
const memories:readonly {project:JourneyProject;alt:boolean}[]=[
  {project:'conservatory',alt:false},{project:'conservatory',alt:true},
  {project:'lotus',alt:false},{project:'lotus',alt:true},
  {project:'reading',alt:false},{project:'reading',alt:true},
  {project:'moonbridge',alt:true},{project:'moonbridge',alt:false},
  {project:'teanook',alt:false},{project:'teanook',alt:true},
  {project:'fountain',alt:false},{project:'fountain',alt:true},
  {project:'crystal',alt:false},{project:'crystal',alt:true},
  {project:'flowerwalk',alt:false},{project:'flowerwalk',alt:true},
  {project:'waterwheel',alt:false},{project:'waterwheel',alt:true},
  {project:'starstage',alt:false},{project:'starstage',alt:true},
];
export function campaignMemory(index:number){return memories[index-5];}
export function campaignMemoryArt(index:number,chapter:number,placement=''){
  const memory=campaignMemory(index),prop=MAP_PROP_FRAMES[index-5];if(!memory||!prop)return '';
  const [x,y,width,height]=prop.crop,clip=`map-prop-${chapter}`;
  const fallback=[7,8,11,15].includes(index)?'<ellipse cx="60" cy="76" rx="36" ry="10" fill="none" stroke="#c4e5e0" stroke-width="3"/><path d="M30 72Q60 44 89 74Q61 94 30 72Z" fill="#a1c7b0"/>':'<ellipse cx="60" cy="87" rx="35" ry="6" fill="#5c6f6424"/><path d="M58 84Q20 78 31 45Q61 49 58 84M61 84Q56 45 83 32Q102 62 61 84Z" fill="#9dbb9c"/><ellipse cx="69" cy="83" rx="19" ry="11" fill="#d6ccc0"/>';
  return `<svg class="map-memory"${placement} data-map-memory="${memory.project}" data-memory-style="${memory.alt?'alt':'base'}" data-map-prop="${prop.world}" data-prop-chapter="${chapter}" viewBox="0 0 120 110" aria-hidden="true"><g class="map-memory-fallback">${fallback}</g><g class="map-memory-painted"><svg width="120" height="110" viewBox="${x} ${y} ${width} ${height}" preserveAspectRatio="xMidYMid meet" overflow="hidden"><defs><clipPath id="${clip}" clipPathUnits="userSpaceOnUse"><rect x="${x}" y="${y}" width="${width}" height="${height}"/></clipPath></defs><image class="map-painted-image" data-map-src="${MAP_PROP_ATLAS.path}" width="${MAP_PROP_ATLAS.width}" height="${MAP_PROP_ATLAS.height}" clip-path="url(#${clip})"/></svg></g></svg>`;
}
