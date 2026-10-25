import {journeyArtSource} from './JourneyGardenArt';
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
export function campaignMemoryArt(index:number,chapter:number){
  const memory=campaignMemory(index);if(!memory)return '';
  const source=journeyArtSource(memory.project,memory.alt),clip=`map-memory-${chapter}`;
  return `<svg class="map-memory" data-map-memory="${memory.project}" data-memory-style="${memory.alt?'alt':'base'}" viewBox="0 0 120 110" aria-hidden="true"><ellipse cx="60" cy="99" rx="43" ry="7" fill="#4c325e" opacity=".14"/><g class="map-memory-fallback"><path d="M21 91V46L60 20L99 46V91Z" fill="#fff4db" stroke="#c1a27e" stroke-width="2"/><path d="M15 47L60 15L105 47" fill="none" stroke="#c6a8cb" stroke-width="6"/><path d="M51 93V74Q60 58 69 74V93" fill="#b9c6d0"/><path d="M32 55H44V68H32M77 55H89V68H77" fill="#e8d5a9"/></g><g class="map-memory-painted"><svg width="120" height="110" viewBox="${source.x} ${source.y} ${source.width} ${source.height}" preserveAspectRatio="xMidYMid meet"><defs><clipPath id="${clip}" clipPathUnits="userSpaceOnUse"><rect x="${source.x}" y="${source.y}" width="${source.width}" height="${source.height}"/></clipPath></defs><image class="map-painted-image" data-map-src="${source.path}" width="1254" height="1254" clip-path="url(#${clip})"/></svg></g></svg>`;
}
