import {describe,it,expect,vi} from 'vitest';
import {TestAdsController,adCopy,type AdSnapshot,type TestAdsBridge} from '../src/testAds';

function harness(initial:Partial<AdSnapshot>={}){
  let state:AdSnapshot={bridgeVersion:3,receipt:null,format:'interstitial',rewardEvents:0,available:true,state:'idle',revision:0,error:'',privacyRequired:false,...initial};
  let event!:(value:AdSnapshot)=>void;
  const remove=vi.fn(async()=>{}),changed=vi.fn();
  const transition=(patch:Partial<AdSnapshot>)=>{state={...state,...patch,revision:state.revision+1};event?.({...state});return {...state};};
  const bridge:TestAdsBridge={
    getStatus:vi.fn(async()=>({...state})),
    prepare:vi.fn(async()=>transition({state:'consent'})),
    show:vi.fn(async()=>transition({state:'presenting'})),
    cancel:vi.fn(async()=>transition({state:'cancelled'})),
    privacyOptions:vi.fn(async()=>transition({state:'privacy'})),
    selectFormat:vi.fn(async({format})=>transition({format,state:'idle'})),
    addListener:vi.fn(async(_name,callback)=>{event=callback;return {remove};}),
  };
  const controller=new TestAdsController(bridge,changed);
  return {controller,bridge,remove,changed,transition,emit:(value:AdSnapshot)=>event(value),state:()=>({...state})};
}

describe('Android 시험 광고 상태 연결',()=>{
  it('연결은 상태만 읽고 광고를 자동 요청하지 않습니다',async()=>{
    const h=harness();await Promise.all([h.controller.connect(),h.controller.connect()]);
    expect(h.bridge.addListener).toHaveBeenCalledTimes(1);expect(h.bridge.getStatus).toHaveBeenCalledTimes(1);
    expect(h.bridge.prepare).not.toHaveBeenCalled();expect(h.bridge.show).not.toHaveBeenCalled();
    expect(h.controller.snapshot.state).toBe('idle');expect(h.controller.pausesGame).toBe(false);
  });
  it('네이티브 구성이 없으면 어떤 광고 명령도 호출하지 않습니다',async()=>{
    const h=harness({available:false});await h.controller.connect();
    await h.controller.command('prepare');await h.controller.command('show');await h.controller.command('cancel');
    expect(h.bridge.prepare).not.toHaveBeenCalled();expect(h.bridge.show).not.toHaveBeenCalled();expect(h.bridge.cancel).not.toHaveBeenCalled();
  });
  it('빠른 중복 탭과 로딩 중 재요청을 합치고 준비됨만으로 표시하지 않습니다',async()=>{
    const h=harness();await h.controller.connect();
    let finish!:(value:AdSnapshot)=>void;
    h.bridge.prepare=vi.fn(()=>new Promise<AdSnapshot>(resolve=>{finish=resolve;}));
    const first=h.controller.command('prepare');await h.controller.command('prepare');
    expect(h.bridge.prepare).toHaveBeenCalledTimes(1);expect(h.controller.pausesGame).toBe(true);
    finish(h.transition({state:'loading'}));await first;await h.controller.command('prepare');
    expect(h.bridge.prepare).toHaveBeenCalledTimes(1);
    h.transition({state:'ready'});expect(h.controller.pausesGame).toBe(false);expect(h.bridge.show).not.toHaveBeenCalled();
    await h.controller.command('show');await h.controller.command('show');
    expect(h.bridge.show).toHaveBeenCalledTimes(1);expect(h.controller.overlay).toBe(true);
  });
  it('동의 불명확/실패 이후에는 표시를 막고 명시적 재요청만 허용합니다',async()=>{
    const h=harness();await h.controller.connect();await h.controller.command('prepare');
    h.transition({state:'failed',error:'consent-blocked'});await h.controller.command('show');
    expect(h.bridge.show).not.toHaveBeenCalled();expect(h.controller.pausesGame).toBe(false);
    await h.controller.command('prepare');expect(h.bridge.prepare).toHaveBeenCalledTimes(2);
  });
  it('취소 뒤 도착한 이전 revision의 로딩/준비 응답은 버립니다',async()=>{
    const h=harness();await h.controller.connect();await h.controller.command('prepare');
    const old=h.state();await h.controller.command('cancel');h.emit({...old,state:'ready'});
    expect(h.controller.snapshot.state).toBe('cancelled');expect(h.controller.pausesGame).toBe(false);
  });
  it('동일·역순 표시/닫힘 이벤트는 한 번만 반영합니다',async()=>{
    const h=harness({state:'ready'});await h.controller.connect();await h.controller.command('show');
    const shown=h.transition({state:'showing'});h.transition({state:'closed'});
    const calls=h.changed.mock.calls.length;h.emit(h.state());h.emit(shown);
    expect(h.controller.snapshot.state).toBe('closed');expect(h.changed).toHaveBeenCalledTimes(calls);expect(h.controller.pausesGame).toBe(false);
  });
  it('실제 전면창은 JS 취소나 bridge 오류로 닫힌 상태로 만들지 않습니다',async()=>{
    const h=harness({state:'showing'});await h.controller.connect();
    await h.controller.command('cancel');expect(h.bridge.cancel).not.toHaveBeenCalled();
    h.bridge.getStatus=vi.fn(async()=>{throw Error('IPC');});await h.controller.refresh();
    expect(h.controller.overlay).toBe(true);expect(h.controller.pausesGame).toBe(true);
  });
  it('명령 거부 뒤 같은 revision의 실제 상태를 다시 받아 재시도할 수 있습니다',async()=>{
    const h=harness({state:'ready',revision:2});await h.controller.connect();
    h.bridge.show=vi.fn().mockRejectedValueOnce(Error('inactive')).mockImplementation(async()=>h.transition({state:'presenting'}));
    await h.controller.command('show');expect(h.controller.snapshot.state).toBe('ready');
    await h.controller.command('show');expect(h.bridge.show).toHaveBeenCalledTimes(2);expect(h.controller.snapshot.state).toBe('presenting');
  });
  it('필요한 개인정보 선택 양식만 열며 닫힘 후 광고를 요청하지 않습니다',async()=>{
    const h=harness();await h.controller.connect();await h.controller.command('privacyOptions');expect(h.bridge.privacyOptions).not.toHaveBeenCalled();
    h.transition({privacyRequired:true});await h.controller.command('privacyOptions');expect(h.controller.overlay).toBe(true);
    h.transition({state:'idle'});expect(h.bridge.prepare).not.toHaveBeenCalled();expect(h.bridge.show).not.toHaveBeenCalled();
  });
  it('리스너 등록 실패는 재연결하고 기존 리스너를 늘리지 않습니다',async()=>{
    const h=harness();const original=h.bridge.addListener;h.bridge.addListener=vi.fn().mockRejectedValueOnce(Error('IPC')).mockImplementation(original);
    await h.controller.connect();expect(h.controller.snapshot.state).toBe('failed');await h.controller.connect();
    expect(h.controller.snapshot.state).toBe('idle');await h.controller.connect();expect(h.bridge.addListener).toHaveBeenCalledTimes(2);
  });
  it('초기 상태 조회 실패 뒤 창 재진입은 기존 리스너로 재조회합니다',async()=>{
    const h=harness();h.bridge.getStatus=vi.fn().mockRejectedValueOnce(Error('IPC')).mockResolvedValue(h.state());
    await h.controller.connect();expect(h.controller.snapshot.available).toBe(false);
    await h.controller.connect();expect(h.controller.snapshot.available).toBe(true);expect(h.controller.snapshot.state).toBe('idle');
    expect(h.bridge.addListener).toHaveBeenCalledTimes(1);expect(h.bridge.getStatus).toHaveBeenCalledTimes(2);
  });
  it('종료 때 리스너를 한 번 제거하고 늦은 콜백을 무시합니다',async()=>{
    const h=harness();await h.controller.connect();await h.controller.dispose();await h.controller.dispose();
    const calls=h.changed.mock.calls.length;h.transition({state:'ready'});await h.controller.command('prepare');
    expect(h.remove).toHaveBeenCalledTimes(1);expect(h.changed).toHaveBeenCalledTimes(calls);expect(h.bridge.prepare).not.toHaveBeenCalled();
  });
  it('늦은 리스너 등록과 제거 실패도 정리하며 unhandled rejection을 만들지 않습니다',async()=>{
    const h=harness();let registered!:(value:{remove:()=>Promise<void>})=>void;
    h.bridge.addListener=vi.fn(()=>new Promise<{remove:()=>Promise<void>}>(resolve=>{registered=resolve;}));
    const connecting=h.controller.connect();await h.controller.dispose();h.remove.mockRejectedValueOnce(Error('destroyed'));
    registered({remove:h.remove});await connecting;expect(h.remove).toHaveBeenCalledTimes(1);expect(h.bridge.getStatus).not.toHaveBeenCalled();
  });
  it('KO/EN 모든 상태와 무보상·동의 한계를 안내합니다',()=>{
    for(const language of ['ko','en'] as const){const copy=adCopy(language);for(const text of Object.values(copy.states))expect(text.length).toBeGreaterThan(1);}
    expect(adCopy('ko').intro).toContain('보상 없음');expect(adCopy('en').intro).toContain('No reward');
    expect(adCopy('ko').notice).toContain('부모 동의');expect(adCopy('en').notice).toContain('parental consent');
  });
  it('형식은 네이티브 응답으로만 선택하며 준비/실행 중 변경하지 않습니다',async()=>{
    const h=harness();await h.controller.connect();await h.controller.selectFormat('rewarded');
    expect(h.controller.snapshot.format).toBe('rewarded');expect(h.bridge.prepare).not.toHaveBeenCalled();
    for(const state of ['consent','privacy','loading','ready','presenting','showing'] as const){
      h.transition({state});await h.controller.selectFormat('interstitial');
    }
    expect(h.bridge.selectFormat).toHaveBeenCalledTimes(1);
    h.transition({state:'closed'});await h.controller.selectFormat('interstitial');
    expect(h.controller.snapshot.format).toBe('interstitial');
  });
  it('빠른 형식 선택·종료 뒤 응답에도 pending/리스너 수명을 유지합니다',async()=>{
    const h=harness();await h.controller.connect();let finish!:(value:AdSnapshot)=>void;
    h.bridge.selectFormat=vi.fn(()=>new Promise<AdSnapshot>(resolve=>{finish=resolve;}));
    const pending=h.controller.selectFormat('rewarded');await h.controller.selectFormat('rewarded');
    expect(h.bridge.selectFormat).toHaveBeenCalledTimes(1);expect(h.controller.pausesGame).toBe(true);
    await h.controller.dispose();finish({...h.state(),revision:1,format:'rewarded'});await pending;
    expect(h.controller.snapshot.format).toBe('interstitial');
  });
  it('표시/클릭 대용/닫힘/실패/재요청은 JS에서 이벤트 수를 증가시키지 않습니다',async()=>{
    const h=harness({format:'rewarded'});await h.controller.connect();await h.controller.command('prepare');
    h.transition({state:'ready'});await h.controller.command('show');h.transition({state:'showing'});h.transition({state:'closed'});
    await h.controller.command('prepare');h.transition({state:'failed'});await h.controller.command('cancel');
    expect(h.controller.snapshot.rewardEvents).toBe(0);
    h.transition({state:'showing',rewardEvents:1});const old=h.state();h.transition({state:'closed'});h.emit(old);
    expect(h.controller.snapshot.rewardEvents).toBe(1);await h.controller.refresh();expect(h.controller.snapshot.rewardEvents).toBe(1);
    const another=harness();await another.controller.connect();expect(another.controller.snapshot.rewardEvents).toBe(0);
  });
  it.each([
    {bridgeVersion:undefined},{bridgeVersion:1},{bridgeVersion:2},{receipt:undefined},{receipt:{}},{format:undefined},{format:'video'},
    {rewardEvents:undefined},{rewardEvents:'1'},{rewardEvents:-1},{rewardEvents:0.5},{rewardEvents:NaN},
    {available:'true'},{privacyRequired:0},{error:null},{state:'unknown'},{revision:-1},{revision:'1'},
  ])('손상/구형 snapshot은 실패 안전하게 차단합니다: %j',async patch=>{
    const h=harness();await h.controller.connect();
    h.emit({...h.state(),revision:1,...patch} as AdSnapshot);await h.controller.command('prepare');
    expect(h.controller.snapshot.available).toBe(false);expect(h.bridge.prepare).not.toHaveBeenCalled();expect(h.controller.snapshot.rewardEvents).toBe(0);
    await h.controller.refresh();expect(h.controller.snapshot.available).toBe(true);
  });
  it('역순 이벤트 수는 무시하고 최신 감소는 차단하며 overlay를 조기 해제하지 않습니다',async()=>{
    const h=harness({format:'rewarded',state:'showing',revision:3,rewardEvents:2});await h.controller.connect();
    h.emit({...h.state(),revision:2,rewardEvents:1});expect(h.controller.snapshot.available).toBe(true);
    h.emit({...h.state(),revision:4,rewardEvents:1});expect(h.controller.snapshot.available).toBe(false);
    expect(h.controller.overlay).toBe(true);expect(h.controller.snapshot.rewardEvents).toBe(2);
    await h.controller.refresh();expect(h.controller.snapshot.available).toBe(true);
  });
  const requestId='round-request-00000001';
  const receipt=(patch:Partial<import('../src/testAds').AdReceipt>={})=>({requestId,attemptId:'17',earned:false,closed:false,...patch});
  async function showing(){
    const h=harness({state:'ready',format:'rewarded'});await h.controller.connect();
    h.bridge.show=vi.fn(async options=>h.transition({state:'presenting',receipt:receipt({requestId:options.requestId})}));
    await h.controller.command('show',requestId);return h;
  }
  it('이번 표시의 earned 단독은 지급하지 않고 같은 attempt 닫힘 뒤 한 번만 소비합니다',async()=>{
    const h=await showing();h.transition({state:'showing',rewardEvents:1,receipt:receipt({earned:true})});
    expect(h.controller.takeReward(requestId)).toBe(false);expect(h.controller.pausesGame).toBe(true);
    const close=h.transition({state:'closed',receipt:receipt({earned:true,closed:true})});
    expect(h.controller.takeReward(requestId)).toBe(true);h.emit(close);await h.controller.refresh();
    expect(h.controller.takeReward(requestId)).toBe(false);
    await h.controller.command('prepare');h.transition({state:'ready',receipt:null});await h.controller.command('show',requestId);
    expect(h.bridge.show).toHaveBeenCalledTimes(1);
  });
  it.each(['no-reward','wrong-request','wrong-attempt','format','cancelled','failed','abandoned'])('%s는 누적 횟수가 늘어도 지급하지 않습니다',async reason=>{
    const h=await showing();if(reason==='abandoned')h.controller.abandonReward();
    h.transition(reason==='format'?{format:'interstitial',state:'closed',rewardEvents:9,receipt:null}:
      reason==='cancelled'||reason==='failed'?{state:reason,receipt:null,rewardEvents:9}:
      {state:'closed',rewardEvents:9,receipt:receipt({earned:reason!=='no-reward',closed:true,requestId:reason==='wrong-request'?'manual-request-00001':requestId,attemptId:reason==='wrong-attempt'?'18':'17'})});
    expect(h.controller.takeReward(requestId)).toBe(false);
  });
  it('현재 show의 닫힘 조회가 이벤트보다 먼저 도착해도 복구하고 초기/새 컨트롤러 조회는 지급하지 않습니다',async()=>{
    const h=await showing(),closed={...h.state(),revision:4,state:'closed' as const,rewardEvents:1,receipt:receipt({earned:true,closed:true})};
    h.bridge.getStatus=vi.fn(async()=>closed);await h.controller.refresh();expect(h.controller.takeReward(requestId)).toBe(true);
    h.emit(closed);expect(h.controller.takeReward(requestId)).toBe(false);
    const other=harness(closed);await other.controller.connect();expect(other.controller.takeReward(requestId)).toBe(false);
  });
  it('show 응답 유실은 닫힘으로 간주하지 않고 일치 receipt 조회만 복구합니다',async()=>{
    const h=harness({state:'ready',format:'rewarded'});await h.controller.connect();
    h.bridge.show=vi.fn(async()=>{throw Error('lost response');});h.bridge.getStatus=vi.fn(async()=>{throw Error('offline');});
    await h.controller.command('show',requestId);expect(h.controller.pausesGame).toBe(true);expect(h.controller.takeReward(requestId)).toBe(false);
    h.bridge.getStatus=vi.fn(async()=>({...h.state(),revision:3,state:'closed' as const,rewardEvents:1,receipt:receipt({earned:true,closed:true})}));
    await h.controller.refresh();expect(h.controller.takeReward(requestId)).toBe(true);
  });
  it.each([{requestId:''},{attemptId:'0'},{earned:'true'},{closed:false}])('손상 closed receipt %j는 기존 overlay·지급 차단을 유지합니다',async patch=>{
    const h=await showing();h.emit({...h.state(),revision:5,state:'closed',receipt:receipt({earned:true,closed:true,...patch} as never)});
    expect(h.controller.overlay).toBe(true);expect(h.controller.takeReward(requestId)).toBe(false);
    h.transition({state:'closed',receipt:receipt({earned:true,closed:true})});await h.controller.refresh();expect(h.controller.takeReward(requestId)).toBe(false);
  });
  it('수동 표시와 종료 후 완료는 receipt가 있어도 게임 지급 대상이 아닙니다',async()=>{
    const h=harness({state:'ready',format:'rewarded'});await h.controller.connect();await h.controller.command('show');
    h.transition({state:'closed',rewardEvents:1,receipt:receipt({earned:true,closed:true})});expect(h.controller.takeReward(requestId)).toBe(false);
    const own=await showing();await own.controller.dispose();own.transition({state:'closed',receipt:receipt({earned:true,closed:true})});expect(own.controller.takeReward(requestId)).toBe(false);
  });
  it('닫힘 이벤트 뒤 show Promise가 늦게 끝나도 pending 해제 후 한 번만 지급합니다',async()=>{
    const h=harness({state:'ready',format:'rewarded'});await h.controller.connect();let resolve!:(value:AdSnapshot)=>void;
    h.bridge.show=vi.fn(()=>new Promise<AdSnapshot>(done=>{resolve=done;}));
    const pending=h.controller.command('show',requestId),shown=h.transition({state:'presenting',receipt:receipt()});
    h.transition({state:'closed',rewardEvents:1,receipt:receipt({earned:true,closed:true})});expect(h.controller.takeReward(requestId)).toBe(false);
    resolve(shown);await pending;expect(h.controller.snapshot.state).toBe('closed');expect(h.controller.takeReward(requestId)).toBe(true);expect(h.controller.takeReward(requestId)).toBe(false);
  });
  it('비활성 동안 보류한 완료도 이후 실패·사용 불가·다른 receipt가 오면 지급하지 않습니다',async()=>{
    for(const patch of [{state:'failed' as const,receipt:null},{available:false},{receipt:null}]){
      const h=await showing();h.transition({state:'closed',receipt:receipt({earned:true,closed:true})});h.transition(patch);
      expect(h.controller.takeReward(requestId)).toBe(false);
    }
  });
});
