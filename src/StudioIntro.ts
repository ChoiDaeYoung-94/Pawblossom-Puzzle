import {SaveStore} from './state';

export interface StudioPreferences {language:'ko'|'en';sound:boolean}
export interface StudioIntroTask {finished:Promise<void>;finish():void}

/** 별도 읽기 전용 probe로 실제 게임의 저장 singleton/복구 상태를 건드리지 않습니다. */
export function studioPreferences(store=new SaveStore()):StudioPreferences {
  const save=store.load(),status=store.status;
  return {language:save.language,sound:['new','loaded','recovered'].includes(status.load)&&save.sfx};
}

export function showStudioIntro(host:HTMLElement,prefs:StudioPreferences,reduce=false):StudioIntroTask {
  const doc=host.ownerDocument;
  if(doc.hidden||!host.isConnected)return {finished:Promise.resolve(),finish:()=>{}};
  const root=doc.createElement('section'),video=doc.createElement('video'),poster=doc.createElement('img');
  root.className='studio-intro';root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');root.setAttribute('aria-label','Quad D');
  video.className='studio-intro-film';
  video.playsInline=true;video.preload='auto';video.muted=!prefs.sound;video.setAttribute('aria-hidden','true');video.tabIndex=-1;
  poster.className='studio-intro-film';poster.src='/assets/brand/quad-d-intro-poster.png';poster.alt='Quad D';
  const startup=host.querySelector<HTMLElement>('#app-startup');
  const wasHidden=startup?.hidden??false,oldAria=startup?.getAttribute('aria-hidden');
  if(startup){startup.hidden=true;startup.setAttribute('aria-hidden','true');}
  let done=false,resolve!:()=>void;
  let frameCallback:number|undefined,watchProgress=false;
  const timers:ReturnType<typeof setTimeout>[]=[];
  const finished=new Promise<void>(value=>{resolve=value;});
  const finish=()=>{
    if(done)return;done=true;
    for(const timer of timers)clearTimeout(timer);
    root.removeEventListener('keydown',onKey);
    video.removeEventListener('ended',finish);video.removeEventListener('error',finish);
    if(watchProgress)video.removeEventListener('timeupdate',onProgress);
    if(frameCallback!==undefined){try{video.cancelVideoFrameCallback(frameCallback);}catch{/* 종료한 미디어의 콜백 취소 실패는 무시합니다. */}frameCallback=undefined;}
    doc.removeEventListener('visibilitychange',onVisibility);doc.defaultView?.removeEventListener('pagehide',finish);
    video.muted=true;
    try{video.pause();}catch{/* 깨진 미디어도 게임 진입을 막지 않습니다. */}
    video.removeAttribute('src');
    try{video.load();}catch{/* 미디어 자원 해제가 실패해도 종료합니다. */}
    root.remove();
    if(startup){startup.hidden=wasHidden;if(oldAria===null)startup.removeAttribute('aria-hidden');else if(oldAria!==undefined)startup.setAttribute('aria-hidden',oldAria);}
    resolve();
  };
  const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();finish();}};
  const onVisibility=()=>{if(doc.hidden)finish();};
  const reveal=()=>{if(!done)video.setAttribute('data-frame-ready','true');};
  const onProgress=()=>{if(!video.paused&&video.readyState>=2&&video.currentTime>0)reveal();};
  root.addEventListener('keydown',onKey);
  video.addEventListener('ended',finish);video.addEventListener('error',finish);
  doc.addEventListener('visibilitychange',onVisibility);doc.defaultView?.addEventListener('pagehide',finish);
  try {
    root.append(poster,video);host.append(root);
    timers.push(setTimeout(finish,6500));
    root.tabIndex=-1;root.focus({preventScroll:true});
    const staticOnly=reduce||!video.canPlayType('video/mp4');
    poster.hidden=!staticOnly;video.hidden=staticOnly;
    if(staticOnly)timers.push(setTimeout(finish,1200));
    else {
      if(typeof video.requestVideoFrameCallback==='function')frameCallback=video.requestVideoFrameCallback(()=>{frameCallback=undefined;reveal();});
      else {watchProgress=true;video.addEventListener('timeupdate',onProgress);}
      video.src='/assets/brand/quad-d-intro.mp4';
      const play=(mutedRetry=false)=>{
        if(done)return;
        let result:Promise<void>|undefined;
        try{result=video.play();}catch{if(!done)finish();return;}
        void Promise.resolve(result).then(()=>{if(done){try{video.pause();}catch{/* 늦은 재생 완료도 무시합니다. */}}},()=>{
          if(done)return;
          if(!mutedRetry&&!video.muted){video.muted=true;play(true);}else finish();
        });
      };
      play();
    }
  }catch{finish();}
  return {finished,finish};
}
