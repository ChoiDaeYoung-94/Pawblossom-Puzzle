export const PIP_WALK_SOURCE='/assets/pip-walk-atlas-v1.png';
// 원본은 수정하지 않습니다. 실제 행 사이 여백과 발 기준을 SVG에서 정렬합니다.
export const PIP_WALK_FRAMES=Object.freeze([
  {crop:[0,0,627,600],bounds:[150,22,577,577]},
  {crop:[627,0,627,600],bounds:[733,24,1162,578]},
  {crop:[0,600,627,654],bounds:[162,617,594,1189]},
  {crop:[627,600,627,654],bounds:[726,628,1163,1192]},
] as const);
export function pipWalkArt(instance:number){
  const scope=Number.isSafeInteger(instance)&&instance>=0?instance:0;
  return `<svg class="pip-walk-art" viewBox="0 0 627 627" aria-hidden="true"><defs>${PIP_WALK_FRAMES.map((frame,index)=>{const [x,y,width,height]=frame.crop;return `<clipPath id="pip-walk-${scope}-${index}" clipPathUnits="userSpaceOnUse"><rect x="${x}" y="${y}" width="${width}" height="${height}"/></clipPath>`;}).join('')}</defs>${PIP_WALK_FRAMES.map((frame,index)=>{
    const [left,top,right,bottom]=frame.bounds,scale=560/(bottom-top),x=313.5-(left+right)/2*scale,y=600-bottom*scale;
    return `<g data-walk-frame="${index}" transform="translate(${x.toFixed(4)} ${y.toFixed(4)}) scale(${scale.toFixed(6)})" clip-path="url(#pip-walk-${scope}-${index})"><image data-walk-image="true" width="1254" height="1254"/></g>`;
  }).join('')}</svg>`;
}
