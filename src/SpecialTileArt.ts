/** 같은 자체 원본을 보드·첫 안내·실습에서 사용합니다. 룰과 타일 색은 바꾸지 않습니다. */
export const specialArtKinds=['row','column','bomb','rainbow'] as const;
export type SpecialArtKind=typeof specialArtKinds[number];
export const specialBodyKey=(kind:SpecialArtKind)=>`special-art-${kind}`;
export const specialBodyPath=(kind:SpecialArtKind)=>`/assets/specials-v4/${kind}.webp`;

const arrows:Record<'row'|'column',string>={
  row:'M-15-16h30M-15 16h30M-21 0l6-6m-6 6 6 6M21 0l-6-6m6 6-6 6',
  column:'M-16-15v30M16-15v30M0-21l-6 6m6-6 6 6M0 21l-6-6m6 6 6-6',
};
/** 장식은 접근성 이름을 중복하지 않으며 상위 버튼의 실제 종류 안내를 유지합니다. */
export function specialTileArt(kind:string,special:SpecialArtKind):string {
  const directions=special==='row'||special==='column'?`<svg class="special-art-mark" viewBox="-28 -28 56 56"><path d="${arrows[special]}" class="special-art-arrow-edge"/><path d="${arrows[special]}" class="special-art-arrow"/></svg>`:'';
  return `<span class="special-tile-art special-tile-art-${special}" data-special="${special}" aria-hidden="true"><span class="special-art-body" style="background-image:url('${specialBodyPath(special)}')"></span><img class="special-art-kind" src="/assets/tiles-v3/${kind}.webp" alt=""/>${directions}</span>`;
}
