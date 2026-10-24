const bodyUrl=new URL('./assets/carrier-trial-parcel-body-v1.webp',import.meta.url).href;
const leftUrl=new URL('./assets/carrier-trial-parcel-left-leaf-v1.webp',import.meta.url).href;
const rightUrl=new URL('./assets/carrier-trial-parcel-right-leaf-v1.webp',import.meta.url).href;

const owners=new WeakMap<HTMLElement,()=>void>();

/** 세 부품이 모두 준비된 현재 조각에만 그림을 공개합니다. 실패 시 기존 벡터를 유지합니다. */
export function mountCarrierParcelArt(owner:HTMLElement,isCurrent:()=>boolean){
  owners.get(owner)?.();
  const layer=owner.ownerDocument.createElement('span');layer.className='parcel-illustrated';layer.setAttribute('aria-hidden','true');
  const parts=[['parcel-leaf parcel-leaf-left',leftUrl],['parcel-leaf parcel-leaf-right',rightUrl],['parcel-body',bodyUrl]].map(([className,src])=>{
    const image=owner.ownerDocument.createElement('img');image.className=className;image.alt='';image.draggable=false;image.src=src;layer.append(image);return image;
  });
  owner.append(layer);
  let disposed=false;
  const dispose=()=>{
    if(disposed)return;disposed=true;for(const part of parts)part.remove();layer.remove();
    if(owners.get(owner)===dispose){owners.delete(owner);owner.removeAttribute('data-parcel-illustrated');}
  };
  owners.set(owner,dispose);
  void Promise.all(parts.map(image=>Promise.resolve().then(()=>image.decode()))).then(()=>{
    if(disposed||owners.get(owner)!==dispose||!owner.isConnected||!isCurrent()||layer.parentElement!==owner)return;
    if(!parts.every(image=>image.parentElement===layer&&image.naturalWidth>0&&image.naturalHeight>0))return;
    owner.setAttribute('data-parcel-illustrated','');
  }).catch(()=>{});
  return dispose;
}
