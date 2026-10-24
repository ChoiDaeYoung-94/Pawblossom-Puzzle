export type PipAccessoryKind='ribbon'|'wateringCan';
interface PipAccessoryArt {setActive(active:boolean):void;dispose():void}
const owners=new WeakMap<HTMLElement,PipAccessoryArt>();
const paths:Record<PipAccessoryKind,string>={ribbon:'/assets/pip-accessories-v1/ribbon.webp',wateringCan:'/assets/pip-accessories-v1/watering-can.webp'};

/** 소유·가격을 모르며, 기존 SVG 슬롯에 해독한 표시 그림만 추가합니다. */
export function createPipAccessoryArt(slot:HTMLElement,kind:PipAccessoryKind,createImage:()=>HTMLImageElement=()=>new Image()):PipAccessoryArt{
  owners.get(slot)?.dispose();
  let disposed=false,image:HTMLImageElement|undefined,painted:HTMLImageElement|undefined;
  const current=()=>!disposed&&owners.get(slot)===art;
  const clearLoad=()=>{if(image)image.onload=image.onerror=null;};
  const art:PipAccessoryArt={
    setActive(active){if(current())slot.dataset.artActive=String(active);},
    dispose(){
      if(disposed)return;
      disposed=true;clearLoad();painted?.remove();painted=undefined;image=undefined;
      if(owners.get(slot)===art){owners.delete(slot);delete slot.dataset.artReady;delete slot.dataset.artActive;}
    },
  };
  owners.set(slot,art);
  void new Promise<HTMLImageElement>((resolve,reject)=>{
    const candidate=createImage();image=candidate;candidate.alt='';candidate.decoding='async';candidate.className='pip-accessory-painted';
    candidate.onload=()=>{
      candidate.onload=candidate.onerror=null;
      void Promise.resolve().then(()=>{
        if(!current()||!slot.isConnected)throw new Error('pip-accessory-inactive-owner');
        return candidate.decode();
      }).then(()=>resolve(candidate),reject);
    };
    candidate.onerror=()=>{candidate.onload=candidate.onerror=null;reject(new Error('pip-accessory-image-failed'));};
    candidate.src=paths[kind];
  }).then(candidate=>{
    if(!current()||!slot.isConnected)return;
    painted=candidate;slot.append(candidate);slot.dataset.artReady='true';
  }).catch(()=>{
    clearLoad();painted?.remove();painted=undefined;
    if(current())delete slot.dataset.artReady;
  });
  return art;
}
