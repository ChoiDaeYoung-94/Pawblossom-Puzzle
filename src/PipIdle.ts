/** 표시 전용입니다. 늦게 도착한 그림이 게임 상태나 매치 반응을 바꾸지 않습니다. */
export function createPipIdle(pip:HTMLElement,createImage:()=>HTMLImageElement=()=>new Image()){
  let disposed=false;
  const image=createImage();
  image.alt='';image.decoding='async';
  image.onload=()=>{
    image.onload=image.onerror=null;
    void Promise.resolve().then(()=>image.decode()).then(()=>{
      if(!disposed&&pip.isConnected)pip.dataset.idleReady='true';
    },()=>{});
  };
  image.onerror=()=>{image.onload=image.onerror=null;};
  image.src='/assets/pip-idle-blink-v2.webp';
  return {
    setActive(active:boolean){if(!disposed)pip.dataset.idleActive=String(active);},
    dispose(){disposed=true;image.onload=image.onerror=null;delete pip.dataset.idleReady;delete pip.dataset.idleActive;},
  };
}
