export const pipTendingPosePath='/assets/pip-tend-held-v1.png';
interface TendingPose {dispose():void}
const owners=new WeakMap<HTMLElement,TendingPose>();
/** 현재 반응의 해독된 자체 포즈만 공개합니다. 행동·타이머·장착·저장은 소유하지 않습니다. */
export function createPipTendingPose(portrait:HTMLElement,stage:HTMLElement,valid:()=>boolean,createImage:()=>HTMLImageElement=()=>new Image()):TendingPose {
  owners.get(portrait)?.dispose();
  let disposed=false,pending:HTMLImageElement|undefined,painted:HTMLImageElement|undefined;
  const current=()=>{try{return !disposed&&owners.get(portrait)===pose&&portrait.isConnected&&stage.isConnected&&portrait.contains(stage)&&valid();}catch{return false;}};
  const clearLoad=()=>{if(pending)pending.onload=pending.onerror=null;pending=undefined;};
  const pose:TendingPose={dispose(){
    if(disposed)return;disposed=true;clearLoad();painted?.remove();painted=undefined;
    if(owners.get(portrait)===pose){owners.delete(portrait);delete portrait.dataset.tendArtReady;}
  }};
  owners.set(portrait,pose);
  void new Promise<HTMLImageElement>((resolve,reject)=>{
    const image=pending=createImage();image.alt='';image.setAttribute('aria-hidden','true');image.className='pip-tending-pose';image.decoding='async';
    image.onload=()=>{image.onload=image.onerror=null;void Promise.resolve().then(()=>{if(!current())throw Error('pip-tend-inactive');return image.decode();}).then(()=>resolve(image),reject);};
    image.onerror=()=>reject(Error('pip-tend-image-failed'));image.src=pipTendingPosePath;
  }).then(image=>{
    clearLoad();if(!current())return;
    painted=image;stage.append(image);portrait.dataset.tendArtReady='true';
  }).catch(()=>{clearLoad();painted?.remove();painted=undefined;if(owners.get(portrait)===pose)delete portrait.dataset.tendArtReady;});
  return pose;
}
