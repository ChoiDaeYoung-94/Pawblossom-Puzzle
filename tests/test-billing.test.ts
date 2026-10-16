import {describe,it,expect,vi} from 'vitest';
import {TestBillingController,billingCopy,type BillingSnapshot,type TestBillingBridge} from '../src/testBilling';

function harness(initial:Partial<BillingSnapshot>={}){
  let value:BillingSnapshot={available:true,configured:true,state:'idle',entitlement:'not-owned',revision:0,error:'',price:'',overlay:false,adsBlocked:false,preparingPurchase:false,...initial};
  let callback!:(state:BillingSnapshot)=>void;
  const remove=vi.fn(async()=>{}),changed=vi.fn();
  const emit=(patch:Partial<BillingSnapshot>)=>{value={...value,...patch,revision:value.revision+1};callback?.({...value});return {...value};};
  const bridge:TestBillingBridge={getStatus:vi.fn(async()=>({...value})),queryProduct:vi.fn(async()=>emit({state:'products'})),purchase:vi.fn(async()=>emit({state:'purchasing',overlay:true})),restore:vi.fn(async()=>emit({state:'querying'})),addListener:vi.fn(async(_name,listener)=>{callback=listener;return {remove};})};
  const controller=new TestBillingController(bridge,changed);
  return {controller,bridge,remove,changed,emit,raw:(state:BillingSnapshot)=>callback(state),value:()=>({...value})};
}
describe('광고 제거 네이티브 결과 연결',()=>{
  it('연결·재연결은 리스너 하나와 상태 조회만 사용합니다',async()=>{
    const h=harness();await Promise.all([h.controller.connect(),h.controller.connect()]);await h.controller.connect();
    expect(h.bridge.addListener).toHaveBeenCalledTimes(1);expect(h.bridge.getStatus).toHaveBeenCalledTimes(2);
    expect(h.bridge.purchase).not.toHaveBeenCalled();expect(h.bridge.queryProduct).not.toHaveBeenCalled();expect(h.bridge.restore).not.toHaveBeenCalled();
  });
  it('구성 미완료는 가격·구매·복원 요청을 만들지 않습니다',async()=>{
    const h=harness({configured:false});await h.controller.connect();
    for(const action of ['queryProduct','purchase','restore'] as const)await h.controller.command(action);
    expect(h.bridge.queryProduct).not.toHaveBeenCalled();expect(h.bridge.purchase).not.toHaveBeenCalled();expect(h.bridge.restore).not.toHaveBeenCalled();
    expect(h.controller.canPurchase).toBe(false);expect(h.controller.blocksAds).toBe(false);
  });
  it('Play 가격과 확인된 미구매 상태가 있어야 구매하며 중복 탭은 한 번만 보냅니다',async()=>{
    const h=harness();await h.controller.connect();await h.controller.command('purchase');expect(h.bridge.purchase).not.toHaveBeenCalled();
    h.emit({price:'Play localized price'});await Promise.all([h.controller.command('purchase'),h.controller.command('purchase')]);
    expect(h.bridge.purchase).toHaveBeenCalledTimes(1);expect(h.controller.snapshot.entitlement).toBe('not-owned');expect(h.controller.pausesGame).toBe(true);
  });
  it('대기 구매와 권한 불명확 상태는 광고를 보류하고 구매를 막습니다',async()=>{
    const h=harness({price:'Play localized price'});await h.controller.connect();
    for(const entitlement of ['pending','unknown','owned'] as const){h.emit({entitlement,adsBlocked:true});await h.controller.command('purchase');expect(h.controller.canPurchase).toBe(false);expect(h.controller.blocksAds).toBe(true);}
    expect(h.bridge.purchase).not.toHaveBeenCalled();
  });
  it('전체 조회 중에는 광고만 보류하며 일반 보드 진행을 막지 않습니다',async()=>{
    const h=harness({state:'querying',entitlement:'unknown',adsBlocked:true});await h.controller.connect();
    expect(h.controller.busy).toBe(true);expect(h.controller.pausesGame).toBe(false);expect(h.controller.blocksAds).toBe(true);
    h.emit({state:'idle',entitlement:'not-owned',adsBlocked:false});expect(h.controller.blocksAds).toBe(false);
  });
  it('구매 버튼 직후 IPC 응답 전부터 준비 완료/실패까지 진행을 멈춥니다',async()=>{
    const h=harness({price:'Play localized price'});await h.controller.connect();let finish!:(value:BillingSnapshot)=>void;
    h.bridge.purchase=vi.fn(()=>new Promise<BillingSnapshot>(resolve=>{finish=resolve;}));const command=h.controller.command('purchase');
    expect(h.controller.pausesGame).toBe(true);
    finish(h.emit({state:'connecting',preparingPurchase:true}));await command;expect(h.controller.pausesGame).toBe(true);
    h.emit({state:'products',preparingPurchase:true});expect(h.controller.pausesGame).toBe(true);
    h.emit({state:'failed',preparingPurchase:false,error:'timeout'});expect(h.controller.pausesGame).toBe(false);
    h.emit({state:'products',preparingPurchase:false});expect(h.controller.pausesGame).toBe(false);
  });
  it('pending→구매 검증→승인 실패→재시도→복원/권한 해제를 네이티브 상태로 반영합니다',async()=>{
    const h=harness();await h.controller.connect();h.emit({entitlement:'pending',adsBlocked:true});expect(h.controller.snapshot.entitlement).toBe('pending');
    h.emit({entitlement:'owned',adsBlocked:true,error:'ack:2'});expect(h.controller.snapshot.entitlement).toBe('owned');
    await h.controller.command('restore');expect(h.bridge.restore).toHaveBeenCalledTimes(1);
    h.emit({state:'idle',entitlement:'owned',error:''});expect(h.controller.snapshot.entitlement).toBe('owned');
    h.emit({entitlement:'not-owned',adsBlocked:false});expect(h.controller.blocksAds).toBe(false);
  });
  it('실패·검증 거부를 구매 완료로 바꾸지 않습니다',async()=>{
    const h=harness();await h.controller.connect();h.emit({state:'failed',entitlement:'unknown',error:'verification',adsBlocked:true});
    expect(h.controller.snapshot.entitlement).toBe('unknown');expect(h.controller.blocksAds).toBe(true);
    h.emit({state:'cancelled',error:''});expect(h.controller.snapshot.entitlement).toBe('unknown');
  });
  it('역순·손상 응답과 게임 저장 값은 권한을 바꾸지 않습니다',async()=>{
    const h=harness();await h.controller.connect();const old=h.value();h.emit({entitlement:'owned',adsBlocked:true});
    h.raw({...old,entitlement:'not-owned'});h.raw({...h.value(),revision:99,overlay:'false'} as unknown as BillingSnapshot);
    expect(h.controller.snapshot.entitlement).toBe('owned');
  });
  it('IPC 실패는 네이티브창을 닫힌 것으로 위장하지 않고 상태 재조회로 회복합니다',async()=>{
    const h=harness({state:'purchasing',overlay:true});await h.controller.connect();h.bridge.getStatus=vi.fn().mockRejectedValueOnce(Error('IPC')).mockResolvedValue(h.value());
    await h.controller.refresh();expect(h.controller.pausesGame).toBe(true);expect(h.controller.blocksAds).toBe(true);
    h.emit({state:'idle',overlay:false,entitlement:'not-owned'});await h.controller.refresh();expect(h.controller.pausesGame).toBe(false);
  });
  it('응답 없는 IPC는 타임아웃 후 종료 가능하며 늦은 반환이 권한을 지급하지 않습니다',async()=>{
    vi.useFakeTimers();try{
      const h=harness();await h.controller.connect();h.bridge.restore=vi.fn(()=>new Promise<BillingSnapshot>(()=>{}));
      const command=h.controller.command('restore');await vi.advanceTimersByTimeAsync(12000);await command;
      expect(h.controller.pending).toBe(false);expect(h.controller.pausesGame).toBe(false);expect(h.controller.snapshot.entitlement).toBe('not-owned');
    }finally{vi.useRealTimers();}
  });
  it('종료 후 콜백을 버리고 리스너를 한 번 제거합니다',async()=>{
    const h=harness();await h.controller.connect();await h.controller.dispose();await h.controller.dispose();h.emit({entitlement:'owned'});
    expect(h.remove).toHaveBeenCalledTimes(1);expect(h.controller.snapshot.entitlement).toBe('not-owned');
  });
  it('KO/EN에서 미완료 구성·시험 서비스·권한 불명확 상태를 정확히 안내합니다',()=>{
    expect(billingCopy('ko').intro).toContain('운영 서비스가 아닙니다');expect(billingCopy('en').intro).toContain('Not a live service');
    for(const lang of ['ko','en'] as const){const copy=billingCopy(lang);expect(copy.unconfigured.length).toBeGreaterThan(10);for(const text of Object.values(copy.entitlement))expect(text.length).toBeGreaterThan(10);}
  });
});
