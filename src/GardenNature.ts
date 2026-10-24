interface GardenNature {setActive(active:boolean):void;dispose():void}
const owners=new WeakMap<HTMLElement,GardenNature>();
const svgNamespace='http://www.w3.org/2000/svg',basePath='/assets/garden-structures-v1/';
let nextNature=0;
// #288의 실제40×36/120×108 시제품에서 확인한128좌표입니다. 원본 bitmap은 바꾸지 않습니다.
const fixedBody='M47 91L48 84L51 78L53 73L55 69L54 65L55 62L58 60L59 56L60 49L58 44L55 43L53 41L51 38L51 35L53 32L57 31L60 33L63 36L64 40L63 44L64 48L64 54L63 58L66 55L69 51L72 49L73 46L75 43L79 41L83 42L85 45L84 48L81 50L77 50L74 52L69 57L66 61L66 63L66 67L64 70L63 75L61 79L58 83L57 88L53 91Z';
const axisAngle=24.443954780416536;
function butterflyRig(document:Document,id:string){
  const rig=document.createElementNS(svgNamespace,'svg');
  for(const [key,value] of Object.entries({class:'garden-nature-butterfly',x:'-20',y:'-18',width:'40',height:'36',viewBox:'0 0 128 128',preserveAspectRatio:'xMidYMid meet','aria-hidden':'true',focusable:'false'}))rig.setAttribute(key,value);
  rig.innerHTML=`<defs><image id="${id}-bitmap" href="${basePath}butterfly.webp" width="128" height="128"/>
    <clipPath id="${id}-left" clipPathUnits="userSpaceOnUse"><path d="M0 0H90L31.8181818182 128H0Z"/></clipPath>
    <clipPath id="${id}-right" clipPathUnits="userSpaceOnUse"><path d="M90 0H128V128H31.8181818182Z"/></clipPath>
    <clipPath id="${id}-fixed" clipPathUnits="userSpaceOnUse"><path d="${fixedBody}"/></clipPath>
    <clipPath id="${id}-not-fixed" clipPathUnits="userSpaceOnUse"><path clip-rule="evenodd" d="M0 0H128V128H0Z ${fixedBody}"/></clipPath></defs>
    ${(['left','right'] as const).map(side=>`<g transform="translate(60 66) rotate(${axisAngle})"><g class="garden-nature-wing"><g transform="rotate(${-axisAngle}) translate(-60 -66)"><g clip-path="url(#${id}-${side})"><use href="#${id}-bitmap" clip-path="url(#${id}-not-fixed)"/></g></g></g></g>`).join('')}
    <use data-garden-nature-fixed="body-and-antennae" href="#${id}-bitmap" clip-path="url(#${id}-fixed)"/>`;
  return rig;
}
type Slot={source:SVGImageElement;parent:Element;art:SVGSVGElement;attributes:(string|null)[]};
type Mounted={slot:Slot;node:SVGElement;marker?:string};
const sourceAttributes=['href','x','y','width','height','preserveAspectRatio'];

/** 실제 정원 그림 하나의 표시만 소유합니다. 미리보기·저장·입력·게임 시간에는 관여하지 않습니다. */
export function createGardenNature(picture:HTMLElement,createImage:()=>HTMLImageElement=()=>new Image()):GardenNature {
  owners.get(picture)?.dispose();
  const id=`garden-nature-${++nextNature}`,mounted:Mounted[]=[];
  let disposed=false,image:HTMLImageElement|undefined;
  const owned=()=>!disposed&&owners.get(picture)===nature;
  const current=()=>owned()&&picture.isConnected;
  const art=picture.querySelector<SVGSVGElement>('.garden-art[data-renderer="painted-v4"]');
  const pond=art?.getAttribute('data-space')==='pond'&&art.getAttribute('data-phase')==='2';
  const sources=pond?Array.from(art!.querySelectorAll<SVGImageElement>('image[data-garden-structure-image="pond-base"]')).slice(0,1)
    :art&&!art.hasAttribute('data-space')?Array.from(art.querySelectorAll<SVGImageElement>('image[data-garden-structure-image="butterfly"]')).slice(0,3):[];
  const path=basePath+(pond?'pond-base.webp':'butterfly.webp');
  const expected=pond?['151','110','296','148']:['-20','-18','40','36'];
  const slots:Slot[]=sources.filter(source=>source.parentElement&&source.getAttribute('href')===path&&!source.hasAttribute('data-garden-nature-source')
    &&['x','y','width','height'].every((key,index)=>source.getAttribute(key)===expected[index])&&source.getAttribute('preserveAspectRatio')==='xMidYMid meet')
    .map(source=>({source,parent:source.parentElement!,art:art!,attributes:sourceAttributes.map(key=>source.getAttribute(key))}));
  const valid=(slot:Slot)=>current()&&picture.querySelector('.garden-art[data-renderer="painted-v4"]')===slot.art&&picture.contains(slot.art)&&slot.art.contains(slot.source)&&slot.source.parentElement===slot.parent
    &&slot.art.getAttribute('data-renderer')==='painted-v4'&&(pond?slot.art.getAttribute('data-space')==='pond'&&slot.art.getAttribute('data-phase')==='2':!slot.art.hasAttribute('data-space'))
    &&(slot.source.getAttribute('data-garden-nature-source')===null||mounted.some(entry=>entry.slot===slot&&entry.marker===slot.source.getAttribute('data-garden-nature-source')))
    &&sourceAttributes.every((key,index)=>slot.source.getAttribute(key)===slot.attributes[index]);
  const clearLoad=()=>{if(image)image.onload=image.onerror=null;image=undefined;};
  const remove=(entry:Mounted)=>{
    // 생성한 node와 동일 값의 표시는 부모가 옮겨져도 자신의 소유입니다.
    entry.node.remove();
    if(entry.marker&&entry.slot.source.getAttribute('data-garden-nature-source')===entry.marker)entry.slot.source.removeAttribute('data-garden-nature-source');
  };
  const prune=()=>{
    for(let i=mounted.length-1;i>=0;i--){const entry=mounted[i];if(!valid(entry.slot)||entry.node.parentElement!==entry.slot.parent||(entry.marker?entry.node.nextSibling!==entry.slot.source:entry.slot.source.nextSibling!==entry.node)){remove(entry);mounted.splice(i,1);}}
    if(current()&&!mounted.length)delete picture.dataset.natureReady;
  };
  const nature:GardenNature={
    setActive(active){if(!current())return;prune();picture.dataset.natureActive=String(active&&slots.some(valid));},
    dispose(){
      if(disposed)return;disposed=true;clearLoad();for(const entry of mounted)remove(entry);mounted.length=0;
      if(owners.get(picture)===nature){owners.delete(picture);delete picture.dataset.natureReady;delete picture.dataset.natureActive;}
    },
  };
  owners.set(picture,nature);
  delete picture.dataset.natureReady;picture.dataset.natureActive='false';
  // 해독 전·대상이 없는 구역은 정지 원본 그대로입니다. 현재 구역의 자산 하나만 준비합니다.
  if(!slots.some(valid))return nature;
  void new Promise<void>((resolve,reject)=>{
    const candidate=createImage();image=candidate;candidate.alt='';candidate.decoding='async';
    candidate.onload=()=>{
      candidate.onload=candidate.onerror=null;
      void Promise.resolve().then(()=>{if(!slots.some(valid))throw new Error('garden-nature-inactive-owner');return candidate.decode();}).then(()=>resolve(),reject);
    };
    candidate.onerror=()=>{candidate.onload=candidate.onerror=null;reject(new Error('garden-nature-image-failed'));};
    candidate.src=path;
  }).then(()=>{
    clearLoad();if(!current())return;
    for(const [index,slot] of slots.entries()){
      if(!valid(slot))continue;
      const marker=pond?undefined:`${id}-${index}`,node=pond?picture.ownerDocument.createElementNS(svgNamespace,'g'):butterflyRig(picture.ownerDocument,marker!);
      if(marker)node.setAttribute('style',`--garden-nature-delay:${-index*.37}s`);
      if(pond){node.setAttribute('class','garden-nature-water');node.setAttribute('aria-hidden','true');node.innerHTML='<ellipse cx="355" cy="193" rx="18" ry="4"/><ellipse cx="355" cy="193" rx="18" ry="4"/>';}
      const entry={slot,node,marker};
      try{slot.parent.insertBefore(node,marker?slot.source:slot.source.nextSibling);if(marker)slot.source.setAttribute('data-garden-nature-source',marker);mounted.push(entry);}
      catch{remove(entry);}
    }
    if(mounted.length)picture.dataset.natureReady='true';
  }).catch(()=>{clearLoad();if(current())delete picture.dataset.natureReady;});
  return nature;
}
