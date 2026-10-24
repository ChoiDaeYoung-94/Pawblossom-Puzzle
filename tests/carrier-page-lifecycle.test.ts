import {describe,expect,it,vi} from 'vitest';
import {bindCarrierPage,type CarrierNativeLifecycle,type CarrierPageView} from '../src/experimental/carrier/CarrierPageLifecycle';

function fixture(){
  const target=new EventTarget(),views:{dispose:ReturnType<typeof vi.fn>;setActive:ReturnType<typeof vi.fn>}[]=[];
  const mount=()=>{const view={dispose:vi.fn(),setActive:vi.fn()};views.push(view);return view as CarrierPageView;};
  const event=(type:string,persisted=false)=>target.dispatchEvent(Object.assign(new Event(type),{persisted}));
  return {target,views,mount,event};
}
const flush=async()=>{await Promise.resolve();await Promise.resolve();await Promise.resolve();};
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(reason:Error)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}

describe('운반 시험 페이지 세대 수명',()=>{
  it('초기 pageshow는 중복 mount하지 않고 BFCache 복귀는 새 입력 세대를 만듭니다',()=>{
    const f=fixture(),page=bindCarrierPage(f.target,f.mount);
    expect(f.views).toHaveLength(1);f.event('pageshow');expect(f.views).toHaveLength(1);
    f.event('pagehide',true);expect(f.views[0].dispose).toHaveBeenCalledTimes(1);
    f.event('pageshow',true);expect(f.views).toHaveLength(2);
    f.event('pagehide',true);f.event('pageshow',true);expect(f.views).toHaveLength(3);
    expect(f.views[1].dispose).toHaveBeenCalledTimes(1);page.dispose();expect(f.views[2].dispose).toHaveBeenCalledTimes(1);
  });
  it('영구 해제 뒤에는 반복 Back 이벤트도 입력/리스너를 재생성하지 않습니다',()=>{
    const f=fixture(),page=bindCarrierPage(f.target,f.mount);page.dispose();page.dispose();
    f.event('pageshow',true);f.event('pagehide',true);expect(f.views).toHaveLength(1);expect(f.views[0].dispose).toHaveBeenCalledTimes(1);
  });
  it('Native의 오래된 초기 active 응답이 더 최신 비활성 이벤트를 덮지 않습니다',async()=>{
    const f=fixture(),state=deferred<boolean>(),remove=vi.fn();let callback!:(active:boolean)=>void;
    const native:CarrierNativeLifecycle={listen:async cb=>{callback=cb;return {remove};},active:()=>state.promise};
    const page=bindCarrierPage(f.target,f.mount,native);
    expect(f.views[0].setActive).toHaveBeenLastCalledWith(false);
    callback(false);state.resolve(true);await flush();expect(f.views[0].setActive.mock.calls).toEqual([[false],[false]]);
    callback(true);expect(f.views[0].setActive).toHaveBeenLastCalledWith(true);page.dispose();expect(remove).toHaveBeenCalledTimes(1);
  });
  it('이탈 뒤 늦게 등록된 Native handle은 바로 해제하며 이전 callback은 새 화면을 바꾸지 않습니다',async()=>{
    const f=fixture(),pending=deferred<{remove():void}>(),state=deferred<boolean>(),oldRemove=vi.fn(),newRemove=vi.fn();
    const callbacks:((active:boolean)=>void)[]=[];let generation=0;
    const native:CarrierNativeLifecycle={listen:cb=>{callbacks.push(cb);return generation++===0?pending.promise:Promise.resolve({remove:newRemove});},active:()=>state.promise};
    const page=bindCarrierPage(f.target,f.mount,native);f.event('pagehide',true);f.event('pageshow',true);
    callbacks[0](true);expect(f.views[1].setActive.mock.calls).toEqual([[false]]);
    pending.resolve({remove:oldRemove});await flush();expect(oldRemove).toHaveBeenCalledTimes(1);
    callbacks[1](false);state.resolve(true);await flush();expect(f.views[1].setActive).toHaveBeenLastCalledWith(false);
    page.dispose();expect(newRemove).toHaveBeenCalledTimes(1);
  });
  it('Native API 미지원 오류는 미처리 rejection 없이 브라우저 수명으로 돌아갑니다',async()=>{
    const f=fixture();const native:CarrierNativeLifecycle={listen:async()=>{throw new Error('unavailable');},active:async()=>{throw new Error('unavailable');}};
    const page=bindCarrierPage(f.target,f.mount,native);await flush();expect(f.views[0].setActive).toHaveBeenLastCalledWith(true);page.dispose();
  });
  it('리스너 등록 실패가 확인된 Native 비활성 상태를 다시 켜지 않습니다',async()=>{
    const f=fixture();const native:CarrierNativeLifecycle={listen:async()=>{throw new Error('listener unavailable');},active:async()=>false};
    const page=bindCarrierPage(f.target,f.mount,native);await flush();expect(f.views[0].setActive).toHaveBeenLastCalledWith(false);page.dispose();
  });
});
