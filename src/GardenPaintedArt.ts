import type {FlowerStyle,GardenTheme} from './gardenDesign';

/** 표시 선택만 버전으로 나눕니다. 저장/성장/경제에는 새 필드를 넣지 않습니다. */
export type GardenArtRenderer='legacy'|'painted-v4';
export function paintedGardenBackdrop(theme:GardenTheme){
  // 이미지가 늦거나 실패해도 선택한 시간대의 바탕은 남깁니다. 비동기 재렌더/저장은 없습니다.
  const [sky,hill,grass]=theme==='starlight'?['#393654','#577078','#769083']:theme==='sunset'?['#f5d2b0','#b6ac85','#d4c08f']:['#f2edcf','#98b57d','#bdd196'];
  return `<g data-garden-layer="backdrop"><rect width="480" height="280" fill="${sky}"/><path d="M0 95Q100 40 210 98T480 86V280H0Z" fill="${hill}"/><path d="M0 139Q130 97 267 137T480 126V280H0Z" fill="${grass}"/><image${theme==='meadow'?'':` data-sky="${theme}"`} href="/assets/garden-v4/backdrop-${theme}.webp" x="0" y="0" width="480" height="280" preserveAspectRatio="xMidYMid slice"/></g>`;
}
export const paintedGardenBed=()=>`<g data-garden-layer="bed"><ellipse cy="22" rx="56" ry="10" fill="#3d5937" opacity=".18"/><ellipse cy="10" rx="49" ry="13" fill="#765331"/><image href="/assets/garden-v4/bed-empty.webp" x="-59" y="-23" width="118" height="59" preserveAspectRatio="xMidYMid meet"/></g>`;
export const paintedGardenFlowers=(style:FlowerStyle)=>`<g data-garden-layer="flowers"><path d="M-19 8Q-27-9-9-3L0 9Q10-10 22-4Q25 10 0 13Z" fill="#537d3c"/><image href="/assets/garden-v4/flowers-${style}.webp" x="-54" y="-57" width="108" height="72" preserveAspectRatio="xMidYMid meet"/></g>`;
