import {createPipRig,pipIdleImages} from './PipRig';

interface PipIdle {setActive(active:boolean):void;dispose():void}
const owners=new WeakMap<HTMLElement,PipIdle>();

/** 표시만 소유하며 반응 슬롯·게임 상태·타이머는 건드리지 않습니다. */
export function createPipIdle(pip:HTMLElement,createImage:()=>HTMLImageElement=()=>new Image(),alignment:'center'|'bottom'='center'):PipIdle{
  owners.get(pip)?.dispose();
  let disposed=false,rig:HTMLElement|undefined;
  const images:HTMLImageElement[]=[];
  const current=()=>!disposed&&owners.get(pip)===idle;
  const clearLoads=()=>{for(const image of images)image.onload=image.onerror=null;images.length=0;};
  const idle:PipIdle={
    setActive(active){if(current())pip.dataset.idleActive=String(active);},
    dispose(){
      if(disposed)return;
      disposed=true;clearLoads();rig?.remove();rig=undefined;
      if(owners.get(pip)===idle){owners.delete(pip);delete pip.dataset.idleReady;delete pip.dataset.idleActive;}
    },
  };
  owners.set(pip,idle);
  const load=(src:string)=>new Promise<void>((resolve,reject)=>{
    const image=createImage();images.push(image);image.alt='';image.decoding='async';
    image.onload=()=>{
      image.onload=image.onerror=null;
      void Promise.resolve().then(()=>{
        if(!current()||!pip.isConnected)throw new Error('pip-idle-inactive-owner');
        return image.decode();
      }).then(()=>resolve(),reject);
    };
    image.onerror=()=>{image.onload=image.onerror=null;reject(new Error('pip-idle-image-failed'));};
    image.src=src;
  });
  void Promise.all(pipIdleImages.map(load)).then(()=>{
    clearLoads();
    if(!current()||!pip.isConnected)return;
    rig=createPipRig(pip.ownerDocument,alignment);pip.append(rig);pip.dataset.idleReady='true';
  }).catch(()=>{
    clearLoads();rig?.remove();rig=undefined;
    if(current())delete pip.dataset.idleReady;
  });
  return idle;
}
