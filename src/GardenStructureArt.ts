import type {GardenSpace,GardenSpaceState} from './gardenSpaces';

const art=(name:string,x:number,y:number,width:number,height:number)=>`<image data-garden-structure-image="${name}" href="/assets/garden-structures-v1/${name}.webp" x="${x}" y="${y}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet"/>`;
const bridge=()=>art('bridge',151,110,296,148);

/** 성장·소유 상태를 표시만 하며 저장 객체를 변경하지 않습니다. */
export function paintedGardenSpace(space:GardenSpace,state:GardenSpaceState,includeForeground=true):string {
  if(state.phase===0)return art('site-empty',151,130,296,111);
  const shadow=space==='pond'?'<ellipse cx="299" cy="238" rx="134" ry="10" fill="#274c36" opacity=".17"/>':space==='arch'?'<g fill="#274c36" opacity=".17"><ellipse cx="209" cy="249" rx="27" ry="8"/><ellipse cx="391" cy="249" rx="27" ry="8"/></g>':'<ellipse cx="300" cy="251" rx="115" ry="13" fill="#274c36" opacity=".17"/>';
  if(space==='pond')return shadow+art(state.phase===1?'pond-foundation':'pond-base',151,110,296,148)+(state.phase===2?art('lily',210,168,50,37.5)+art('lily',346,149,44,33)+(state.style==='alt'&&includeForeground?bridge():''):'');
  return shadow+art(`${space}-${state.phase===1?'foundation':state.style}`,164,21,272,238);
}

/** 실제 본판은 교감 물결보다 다리를 앞에, 핍과44px 조작보다 뒤에 둡니다. */
export function paintedGardenForeground(space:GardenSpace,state:GardenSpaceState):string {
  return space==='pond'&&state.phase===2&&state.style==='alt'?`<svg class="garden-structure-foreground" viewBox="0 0 480 280" aria-hidden="true">${bridge()}</svg>`:'';
}

export const paintedGardenBench=()=>art('bench',-34,-9,68,34);
export const paintedGardenLantern=()=>art('lantern',-16,-43,32,64);
export const paintedGardenButterfly=()=>`<g class="garden-painted-butterfly">${art('butterfly',-20,-18,40,36)}</g>`;
