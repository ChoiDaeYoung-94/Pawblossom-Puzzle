import {journeyProjectSpecs,type JourneyProject,type JourneyProjectState} from './journeyGarden';

const boundaries=[590,610,632,600,622];
let nextArt=0;
export function journeyArtSource(project:JourneyProject,alt=false){
  const index=journeyProjectSpecs.findIndex(spec=>spec.id===project),atlas=Math.floor(index/2),row=index%2,y=row?boundaries[atlas]:0;
  return {path:`/assets/journey-garden/works-${String.fromCharCode(97+atlas)}-v1.png`,x:alt?627:0,y,width:627,height:row?1254-y:boundaries[atlas]};
}
/** 작품의 원본은 변형하지 않고 실제 투명 경계를 기준으로 SVG 안에서만 자릅니다. */
export function journeyGardenArt(project:JourneyProject,state:JourneyProjectState){
  const source=journeyArtSource(project,state.style==='alt');
  const clip=`journey-work-${++nextArt}`;
  const foundation='<ellipse cx="160" cy="199" rx="118" ry="25" fill="#eadccc"/><path d="M63 184 157 151 260 181 165 222Z" fill="#f8ebdb" stroke="#cfb4a0" stroke-width="4"/><path d="m80 180 76-26 87 27-79 30Z" fill="#d9c9b9"/><g fill="#f4d4a3" stroke="#ba9473" stroke-width="3"><path d="M84 178v-72l10-4v73Z"/><path d="M231 179v-72l10-3v72Z"/><path d="m88 106 76-28 73 28-4 10-69-25-72 26Z"/></g><g fill="#f5e8cc" stroke="#c1a382" stroke-width="2"><path d="m109 210 10-10 25 8-9 10Z"/><path d="m191 201 8-12 25 7-8 12Z"/></g>';
  return `<svg class="journey-work-art" data-project="${project}" data-phase="${state.phase}" viewBox="0 0 320 240" aria-hidden="true"><ellipse cx="160" cy="211" rx="119" ry="19" fill="#a18ab8" opacity=".14"/>${state.phase===0?'<ellipse cx="160" cy="190" rx="115" ry="32" fill="#f8edda" stroke="#d4bda4" stroke-dasharray="7 8" stroke-width="3"/><g fill="#b8cda6"><path d="M79 193q-17-23-12-24 18 6 18 23q1-26 12-21 2 11-9 24Z"/><path d="M232 192q-10-24-18-16 1 14 15 20 9-24 16-15-1 8-13 16Z"/></g>':state.phase===1?foundation:`<g class="journey-work-fallback">${foundation}</g><svg x="0" y="0" width="320" height="240" viewBox="${source.x} ${source.y} ${source.width} ${source.height}" preserveAspectRatio="xMidYMid meet"><defs><clipPath id="${clip}" clipPathUnits="userSpaceOnUse"><rect x="${source.x}" y="${source.y}" width="${source.width}" height="${source.height}"/></clipPath></defs><image data-journey-source="${source.path}" width="1254" height="1254" clip-path="url(#${clip})"/></svg><g class="journey-work-lights" fill="#fff3af"><circle cx="73" cy="109" r="3"/><circle cx="247" cy="124" r="3"/><circle cx="211" cy="70" r="2"/></g>`}</svg>`;
}
type ArtOwner={setActive(active:boolean):void;dispose():void};
const owners=new WeakMap<HTMLElement,ArtOwner>();
/** 보이는 작품 한 장만 해독합니다. 숨김·교체 뒤 늦은 응답은 DOM을 바꾸지 않습니다. */
export function createJourneyGardenArt(host:HTMLElement,makeImage:()=>HTMLImageElement=()=>new Image()):ArtOwner{
  owners.get(host)?.dispose();let active=false,disposed=false,revision=0,image:HTMLImageElement|undefined,assigned:string|undefined,failed=false;
  const slot=host.querySelector<SVGImageElement>('image[data-journey-source]'),path=slot?.getAttribute('data-journey-source');
  const validPath=path&&/^\/assets\/journey-garden\/works-[a-e]-v1\.png$/.test(path)?path:undefined;
  const current=()=>!disposed&&owners.get(host)===owner&&host.isConnected&&slot?.isConnected&&host.querySelector('image[data-journey-source]')===slot&&slot.getAttribute('data-journey-source')===validPath;
  const clear=()=>{revision++;if(image)image.onload=image.onerror=null;image=undefined;if(assigned&&slot?.getAttribute('href')===assigned)slot.removeAttribute('href');assigned=undefined;if(owners.get(host)===owner){delete host.dataset.journeyReady;host.dataset.journeyActive='false';}};
  const load=()=>{
    if(!active||!current()||!validPath||image||assigned||failed||slot!.hasAttribute('href'))return;
    const token=++revision,candidate=makeImage();image=candidate;candidate.alt='';candidate.decoding='async';
    const owned=()=>active&&current()&&revision===token&&image===candidate&&!slot!.hasAttribute('href');
    candidate.onload=()=>{candidate.onload=candidate.onerror=null;void Promise.resolve().then(()=>{if(!owned())throw Error('inactive');return candidate.decode();}).then(()=>{if(!owned())return;slot!.setAttribute('href',validPath);assigned=validPath;image=undefined;host.dataset.journeyReady='true';host.dataset.journeyActive='true';},()=>{if(revision===token&&current()){image=undefined;failed=true;}});};
    candidate.onerror=()=>{candidate.onload=candidate.onerror=null;if(revision===token&&current()){image=undefined;failed=true;}};candidate.src=validPath;
  };
  const owner:ArtOwner={setActive(value){if(disposed||owners.get(host)!==owner)return;active=value;if(!active){clear();return;}if(!current()||assigned&&slot!.getAttribute('href')!==assigned){clear();return;}host.dataset.journeyActive=String(Boolean(assigned));load();},dispose(){if(disposed)return;clear();disposed=true;if(owners.get(host)===owner){owners.delete(host);delete host.dataset.journeyActive;}}};
  owners.set(host,owner);return owner;
}
