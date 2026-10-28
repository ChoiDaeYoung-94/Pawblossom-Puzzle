import type {StudioIntroTask} from './StudioIntro';

interface StudioGuard {ready:Promise<boolean>;release():void}
export function createStudioBoot(options:{intro:()=>StudioIntroTask;load:()=>Promise<unknown>;failed:(error:unknown)=>void;guard?:(finish:()=>void)=>StudioGuard}) {
  let started:Promise<void>|undefined;
  return ()=>started??=(async()=>{
    let intro:StudioIntroTask|undefined,guard:StudioGuard|undefined,stopped=false;
    const stop=()=>{stopped=true;intro?.finish();};
    try{
      guard=options.guard?.(stop);
      if((!guard||await guard.ready)&&!stopped){intro=options.intro();await intro.finished;}
    }
    catch{intro?.finish();}
    finally{try{guard?.release();}catch{/* 정리 실패도 게임 진입을 막지 않습니다. */}}
    try{await options.load();}catch(error){options.failed(error);}
  })();
}

interface ListenerHandle {remove():Promise<void>}
export interface StudioLifecycle {
  back(listener:()=>void):Promise<ListenerHandle>;
  active(listener:(active:boolean)=>void):Promise<ListenerHandle>;
  current():Promise<boolean>;
}
/** 개별 handle만 해제하며 뒤에 등록되는 실제 게임 리스너는 건드리지 않습니다. */
export function bindStudioLifecycle(bridge:StudioLifecycle,finish:()=>void) {
  let live=true,settled=false,stopped=false,revision=0,lastActive=false,resolve!:(active:boolean)=>void;
  const handles:Promise<ListenerHandle>[]=[];
  const ready=new Promise<boolean>(yes=>{resolve=yes;});
  const stop=()=>{if(!stopped){stopped=true;finish();}};
  const settle=(active:boolean)=>{if(settled)return;settled=true;clearTimeout(timer);if(!active)stop();resolve(active);};
  const timer=setTimeout(()=>settle(false),1500);
  const register=(add:()=>Promise<ListenerHandle>)=>{
    try{const handle=add();handles.push(handle);void handle.catch(()=>{if(live)settle(false);});}
    catch{settle(false);}
  };
  register(()=>bridge.back(()=>{if(live){stop();settle(false);}}));
  register(()=>bridge.active(active=>{if(!live)return;revision++;lastActive=active;if(!active){stop();settle(false);}}));
  void Promise.all(handles).then(async()=>{
    if(!live||settled)return;
    const observed=revision;
    try{const active=await bridge.current();if(live&&!settled)settle(observed===revision?active:lastActive);}
    catch{if(live)settle(false);}
  }).catch(()=>{if(live)settle(false);});
  return {ready,release:()=>{if(!live)return;live=false;settle(false);for(const handle of handles)void handle.then(value=>value.remove()).catch(()=>{});}};
}
