export interface CarrierPageView {dispose():void;setActive(active:boolean):void}
export interface CarrierNativeLifecycle {
  listen(callback:(active:boolean)=>void):Promise<{remove():void|Promise<void>}>;
  active():Promise<boolean>;
}
/** BFCache는 메모리 체험을 새로 시작하고 이전 세대의 Native 응답은 폐기합니다. */
export function bindCarrierPage(target:EventTarget,mount:()=>CarrierPageView,native?:CarrierNativeLifecycle){
  let generation=0,disposed=false,current:CarrierPageView|undefined;
  let handle:{remove():void|Promise<void>}|undefined;
  const remove=(listener:{remove():void|Promise<void>})=>{try{void Promise.resolve(listener.remove()).catch(()=>{});}catch{/* 이미 해제된 Native 수명 */}};
  function stop(){
    generation++;const previous=current;current=undefined;previous?.dispose();
    const listener=handle;handle=undefined;if(listener)remove(listener);
  }
  function start(){
    if(disposed)return;stop();
    const activeGeneration=generation,view=mount();current=view;
    if(!native)return;
    view.setActive(false);let revision=0;
    const owned=()=>!disposed&&generation===activeGeneration&&current===view;
    const registering=async()=>native.listen(active=>{if(!owned())return;revision++;view.setActive(active);});
    void registering().then(listener=>{
      if(owned())handle=listener;else remove(listener);
    }).catch(()=>{/* 초기 상태 조회/브라우저 수명은 별도로 유지합니다. */});
    const loading=async()=>native.active();
    void loading().then(active=>{if(owned()&&revision===0)view.setActive(active);}).catch(()=>{if(owned()&&revision===0)view.setActive(true);});
  }
  const hide=()=>stop();
  const show=(event:Event)=>{if((event as PageTransitionEvent).persisted)start();};
  target.addEventListener('pagehide',hide);target.addEventListener('pageshow',show);start();
  return {dispose(){if(disposed)return;disposed=true;stop();target.removeEventListener('pagehide',hide);target.removeEventListener('pageshow',show);}};
}
