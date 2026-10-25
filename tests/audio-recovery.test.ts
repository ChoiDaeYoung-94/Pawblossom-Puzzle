import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {AudioManager,AUDIO_LEVELS,MUSIC_THEMES,musicScore,type MusicTheme} from '../src/audio/AudioManager';

function deferred() {
  let resolve!:()=>void, reject!:(reason?:unknown)=>void;
  const promise=new Promise<void>((yes,no)=>{resolve=yes;reject=no;});
  return {promise,resolve,reject};
}
class Param {
  value=0;
  cancelScheduledValues=vi.fn(); setTargetAtTime=vi.fn(); setValueAtTime=vi.fn();
  linearRampToValueAtTime=vi.fn(); exponentialRampToValueAtTime=vi.fn(); cancelAndHoldAtTime=vi.fn();
}
class Node {
  gain=new Param();frequency=new Param();threshold=new Param();knee=new Param();ratio=new Param();attack=new Param();release=new Param();
  onended:(()=>void)|null=null;
  disconnect=vi.fn(); start=vi.fn();stop=vi.fn();
  constructor(readonly ctx:Context){}
  connect=vi.fn(()=>{if(this.ctx.failure==='connect')throw Error('connect');});
  set curve(_:unknown){if(this.ctx.failure==='curve')throw Error('curve');}
}
class Context {
  static instances:Context[]=[];
  static failure:string|number|undefined;
  state='suspended';currentTime=0;onstatechange:(()=>void)|null=null;
  nodes:Node[]=[];destination={};failure=Context.failure;
  resumeGate?:ReturnType<typeof deferred>;suspendGate?:ReturnType<typeof deferred>;closeGate?:ReturnType<typeof deferred>;
  constructor(){if(this.failure==='constructor')throw Error('constructor');Context.instances.push(this);}
  private create(){if(this.failure===this.nodes.length+1)throw Error('create');const node=new Node(this);this.nodes.push(node);return node;}
  createGain=()=>this.create();createDynamicsCompressor=()=>this.create();createWaveShaper=()=>this.create();createOscillator=()=>this.create();
  change(state:string){this.state=state;this.onstatechange?.();}
  resume=vi.fn(async()=>{if(this.resumeGate)await this.resumeGate.promise;this.change('running');});
  suspend=vi.fn(async()=>{if(this.suspendGate)await this.suspendGate.promise;this.change('suspended');});
  close=vi.fn(async()=>{if(this.closeGate)await this.closeGate.promise;this.change('closed');});
}
// Observe owned resources without adding test hooks to production code.
const owned=(audio:AudioManager)=>audio as unknown as {
  context?:Context;timer?:unknown;voices:Set<{bus:string;sources:Node[];nodes:Node[];end:number}>;outputNodes:Node[];
  requestedTheme:MusicTheme;playingTheme:MusicTheme;step:number;nextNote:number;scheduleMusic:()=>void;
  note:(bus:string,midi:number,time:number,duration:number,amplitude:number)=>void;
};
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
let managers:AudioManager[]=[];
let hidden=false;
let visibility:()=>void;
const make=(manageVisibility=true)=>{const a=new AudioManager(manageVisibility);managers.push(a);return a;};
const hide=(value:boolean)=>{hidden=value;visibility();};

beforeEach(()=>{
  vi.useFakeTimers();Context.instances=[];Context.failure=undefined;hidden=false;
  vi.stubGlobal('window',{AudioContext:Context});
  vi.stubGlobal('document',{get hidden(){return hidden;},addEventListener:vi.fn((_:string,fn:()=>void)=>{visibility=fn;}),removeEventListener:vi.fn()});
});
afterEach(()=>{managers.forEach(a=>a.destroy());managers=[];vi.useRealTimers();vi.unstubAllGlobals();});

describe('오디오 그래프 소유권과 명시적 복구',()=>{
  it.each(['constructor',1,2,3,4,5,6,7,'curve','connect'])('부분 초기화 %s 실패를 정리하고 다음 unlock에서 재시도합니다',async failure=>{
    Context.failure=failure;const a=make();await a.unlock();
    expect(owned(a).context).toBeUndefined();expect(owned(a).outputNodes).toEqual([]);expect(vi.getTimerCount()).toBe(0);
    for(const ctx of Context.instances){expect(ctx.close).toHaveBeenCalledOnce();expect(ctx.onstatechange).toBeNull();ctx.nodes.forEach(n=>expect(n.disconnect).toHaveBeenCalledOnce());}
    Context.failure=undefined;await a.unlock();expect(owned(a).context?.state).toBe('running');expect(vi.getTimerCount()).toBe(1);
  });
  it('실패한 이전 그래프의 지연 close와 disconnect 예외가 재시도 자원에 간섭하지 않습니다',async()=>{
    const close=deferred();
    // close is an instance field, so intercept the first node creation instead.
    const create=Context.prototype['create'];
    const spy=vi.spyOn(Context.prototype as any,'create').mockImplementation(function(this:Context){this.closeGate=close;const n=create.call(this);n.disconnect.mockImplementation(()=>{throw Error('disconnect');});return n;});
    Context.failure='curve';const a=make();await a.unlock();const old=Context.instances[0]!;
    expect(old.nodes.every(n=>n.disconnect.mock.calls.length===1)).toBe(true);
    spy.mockRestore();Context.failure=undefined;await a.unlock();const current=owned(a).context;
    close.resolve();await flush();expect(owned(a).context).toBe(current);expect(vi.getTimerCount()).toBe(1);
  });
  it('closed는 resume/설정만으로 생성하지 않고 다음 unlock에서 OFF 설정을 보존합니다',async()=>{
    const a=make();await a.unlock();const old=owned(a).context!,stale=old.onstatechange!;
    a.play('win');a.setMusicEnabled(false);a.setSfxEnabled(false);old.change('closed');
    a.resume();await flush();expect(Context.instances).toHaveLength(1);expect(owned(a).voices.size).toBe(0);expect(vi.getTimerCount()).toBe(0);
    await a.unlock();const current=owned(a).context!;expect(current).not.toBe(old);
    expect(current.nodes[0]!.gain.value).toBe(0);expect(current.nodes[1]!.gain.value).toBe(0);
    expect(a.musicEnabled).toBe(false);expect(a.sfxEnabled).toBe(false);expect(vi.getTimerCount()).toBe(0);
    a.setMusicEnabled(true);a.setSfxEnabled(true);a.play('win');expect(owned(a).voices.size).toBe(7);
    old.state='suspended';stale();expect(owned(a).voices.size).toBe(7);expect(vi.getTimerCount()).toBe(1);
    old.nodes.forEach(n=>expect(n.disconnect).toHaveBeenCalled());
  });
});

describe('비동기 중단과 재개 경계',()=>{
  it('중복 unlock도 그래프와 음악 타이머를 하나만 유지합니다',async()=>{
    const a=make();a.suspend();await a.unlock();const ctx=owned(a).context!;ctx.resumeGate=deferred();
    a.resume();const work=Promise.all([a.unlock(),a.unlock()]);expect(ctx.resume).toHaveBeenCalledTimes(3);
    ctx.resumeGate.resolve();await work;await flush();expect(vi.getTimerCount()).toBe(1);expect(owned(a).voices.size).toBe(2);
  });
  it('자동 resume가 계속 pending이어도 새 gesture unlock은 즉시 resume를 재요청합니다',async()=>{
    const a=make();a.suspend();await a.unlock();const ctx=owned(a).context!,first=deferred();
    ctx.resume.mockImplementationOnce(()=>first.promise);a.resume();
    await a.unlock();expect(ctx.resume).toHaveBeenCalledTimes(2);expect(ctx.state).toBe('running');expect(vi.getTimerCount()).toBe(1);
    first.resolve();await flush();expect(vi.getTimerCount()).toBe(1);expect(owned(a).voices.size).toBe(2);
  });
  it('resume→suspend의 늦은 resume 완료도 중단 상태를 유지합니다',async()=>{
    const a=make();a.suspend();await a.unlock();const ctx=owned(a).context!;ctx.resumeGate=deferred();
    a.resume();a.suspend();await flush();ctx.resumeGate.resolve();await flush();
    expect(ctx.state).toBe('suspended');expect(vi.getTimerCount()).toBe(0);expect(owned(a).voices.size).toBe(0);
  });
  it('suspend→resume 순서 역전에서 중복 suspend 없이 최신 재개를 적용합니다',async()=>{
    const a=make();await a.unlock();const ctx=owned(a).context!;ctx.suspendGate=deferred();
    a.suspend();a.suspend();a.resume();a.play('win');expect(owned(a).voices.size).toBe(0);expect(ctx.suspend).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0);
    ctx.suspendGate.resolve();await flush();expect(ctx.state).toBe('running');expect(vi.getTimerCount()).toBe(1);
  });
  it('resume→suspend→resume에서 suspend가 먼저 완료되어도 최신 재개를 잃지 않습니다',async()=>{
    const a=make();a.suspend();await a.unlock();const ctx=owned(a).context!;
    ctx.resumeGate=deferred();a.resume();a.suspend();a.resume();await flush();
    ctx.resumeGate.resolve();await flush();expect(ctx.state).toBe('running');expect(vi.getTimerCount()).toBe(1);
  });
  it('resume·suspend가 같은 microtask 묶음에서 완료되어도 최종 suspended 상태를 재개합니다',async()=>{
    const a=make();a.suspend();await a.unlock();const ctx=owned(a).context!;
    const first=deferred();ctx.resumeGate=first;ctx.suspendGate=deferred();
    a.resume();a.suspend();a.resume();first.resolve();ctx.suspendGate.resolve();await flush();
    expect(ctx.state).toBe('running');expect(vi.getTimerCount()).toBe(1);
  });
  it('resume 거부 후 다음 gesture로 재시도하고 과거 효과음을 재생하지 않습니다',async()=>{
    const a=make();a.suspend();await a.unlock();a.setMusicEnabled(false);const ctx=owned(a).context!;
    ctx.resumeGate=deferred();a.resume();a.play('win');ctx.resumeGate.reject(Error('restricted'));await flush();
    expect(owned(a).voices.size).toBe(0);ctx.resumeGate=undefined;await a.unlock();expect(owned(a).voices.size).toBe(0);
    a.play('tap');expect(owned(a).voices.size).toBe(1);
  });
  it.each(['resume','suspend'] as const)('이전 세대 pending %s·statechange는 새 세대와 destroy 이후에 간섭하지 않습니다',async operation=>{
    const a=make();await a.unlock();const old=owned(a).context!,stale=old.onstatechange!;
    const gate=deferred();if(operation==='resume'){old.change('suspended');old.resumeGate=gate;void a.unlock();}else{old.suspendGate=gate;a.suspend();a.resume();}
    old.change('closed');await a.unlock();const current=owned(a).context!;expect(current).not.toBe(old);
    gate.resolve();await flush();stale();expect(owned(a).context).toBe(current);expect(vi.getTimerCount()).toBe(1);
    a.destroy();stale();await flush();expect(vi.getTimerCount()).toBe(0);expect(owned(a).context).toBeUndefined();
  });
  it.each(['resume','suspend','close'] as const)('destroy 후 pending %s 완료·이벤트·재호출로 자원이 부활하지 않습니다',async operation=>{
    const a=make();await a.unlock();const ctx=owned(a).context!,stale=ctx.onstatechange!,gate=deferred();
    if(operation==='resume'){ctx.change('suspended');ctx.resumeGate=gate;void a.unlock();}
    if(operation==='suspend'){ctx.suspendGate=gate;a.suspend();}
    if(operation==='close')ctx.closeGate=gate;
    a.destroy();a.destroy();a.resume();await a.unlock();gate.resolve();await flush();stale();vi.advanceTimersByTime(2000);
    expect(vi.getTimerCount()).toBe(0);expect(owned(a).voices.size).toBe(0);expect(ctx.close).toHaveBeenCalledOnce();
    expect(document.removeEventListener).toHaveBeenCalledOnce();ctx.nodes.forEach(n=>expect(n.disconnect).toHaveBeenCalled());
  });
  it('visibility와 explicit pause가 겹쳐도 두 조건이 풀리기 전까지 예약 음을 없앱니다',async()=>{
    const a=make();await a.unlock();a.play('win');hide(true);a.suspend();hide(false);await flush();
    expect(vi.getTimerCount()).toBe(0);expect(owned(a).voices.size).toBe(0);
    hide(true);a.resume();await flush();expect(vi.getTimerCount()).toBe(0);hide(false);await flush();
    expect(vi.getTimerCount()).toBe(1);expect([...owned(a).voices].every(v=>v.bus==='music')).toBe(true);
  });
});

describe('예약 음과 노드 정리',()=>{
  it('잠금/중단 호출을 버리고 버스별 상한·자연 종료·동일 프레임 제한을 유지합니다',async()=>{
    const a=make();a.play('win');expect(Context.instances).toHaveLength(0);await a.unlock();const ctx=owned(a).context!;
    for(let i=0;i<40;i++){owned(a).note('music',72,1,.5,.05);owned(a).note('sfx',72,1,.5,.05);}
    expect([...owned(a).voices].filter(v=>v.bus==='music')).toHaveLength(6);expect([...owned(a).voices].filter(v=>v.bus==='sfx')).toHaveLength(14);
    const voice=[...owned(a).voices].find(v=>v.bus==='sfx')!;voice.sources[0]!.onended!();expect(owned(a).voices.size).toBe(19);voice.nodes.forEach(n=>expect(n.disconnect).toHaveBeenCalledOnce());
    a.suspend();a.play('win');await flush();expect(owned(a).voices.size).toBe(0);a.setMusicEnabled(false);a.resume();await flush();
    a.play('tap');a.play('tap');expect(owned(a).voices.size).toBe(1);ctx.currentTime+=.05;a.play('tap');expect(owned(a).voices.size).toBe(2);
    ctx.currentTime=5;a.play('swap');expect(owned(a).voices.size).toBe(2);
    expect(AUDIO_LEVELS).toEqual({music:4,sfx:3.4,master:1,makeup:1.12});
  });
  it('OFF는 미래 엔벌로프를 취소하고 25ms 뒤 음을 정리하며 다른 버스 설정을 보존합니다',async()=>{
    const a=make();await a.unlock();a.play('win');const ctx=owned(a).context!,voices=[...owned(a).voices];
    a.setSfxEnabled(false);expect(a.musicEnabled).toBe(true);expect(a.sfxEnabled).toBe(false);
    for(const v of voices.filter(v=>v.bus==='sfx')){expect(v.sources[0]!.stop).toHaveBeenLastCalledWith(.025);}
    ctx.currentTime=.03;voices.filter(v=>v.bus==='sfx').forEach(v=>v.sources[0]!.onended!());
    expect([...owned(a).voices].every(v=>v.bus==='music')).toBe(true);a.setSfxEnabled(true);expect(owned(a).voices.size).toBe(2);
    a.setMusicEnabled(false);expect(vi.getTimerCount()).toBe(0);expect(a.sfxEnabled).toBe(true);
  });
});

describe('자체 구간 음악과 미예약 마디 전환',()=>{
  it('서로 다른 일곱 곡이16마디·128박자 칸과 대응 베이스를 가지며 원래 초원 도입부를 보존합니다',()=>{
    expect(MUSIC_THEMES).toHaveLength(7);expect(new Set(MUSIC_THEMES.map(k=>JSON.stringify(musicScore(k).melody))).size).toBe(7);
    for(const theme of MUSIC_THEMES){const score=musicScore(theme);expect(score.melody).toHaveLength(16);expect(score.bass).toHaveLength(16);expect(score.fifths).toHaveLength(16);for(const bar of score.melody){expect(bar).toHaveLength(8);expect(bar.every(n=>n===null||Number.isInteger(n)&&n>=48&&n<=96)).toBe(true);}}
    expect(musicScore('meadow').melody[0]).toEqual([72,null,76,79,null,76,74,null]);expect(musicScore('meadow').bass.slice(0,8)).toEqual([48,45,55,48,48,45,55,48]);
  });
  it('잠금 상태의 요청과 잘못된 외부 키는 context나 타이머를 만들지 않습니다',async()=>{
    const a=make();a.setMusicTheme('brook');a.setMusicTheme('toString' as MusicTheme);a.setMusicTheme('invalid' as MusicTheme);
    expect(Context.instances).toHaveLength(0);expect(vi.getTimerCount()).toBe(0);expect(owned(a).requestedTheme).toBe('brook');await a.unlock();expect(owned(a).playingTheme).toBe('brook');expect(vi.getTimerCount()).toBe(1);
  });
  it('현재곡→다른곡→현재곡 요청은 아직 예약하지 않은 변경을 취소합니다',async()=>{
    const a=make();await a.unlock();const ctx=owned(a).context!;a.setMusicTheme('brook');a.setMusicTheme('meadow');ctx.currentTime=3.25;vi.advanceTimersByTime(25);
    expect(owned(a).playingTheme).toBe('meadow');expect(owned(a).requestedTheme).toBe('meadow');expect(vi.getTimerCount()).toBe(1);expect(Context.instances).toHaveLength(1);
  });
  it('연속 구간 요청은 기존 음을 끊지 않고 다음 미예약 마디에 최종 곡 하나로 반영합니다',async()=>{
    const a=make();await a.unlock();const ctx=owned(a).context!,first=[...owned(a).voices];a.setMusicTheme('brook');a.setMusicTheme('orchard');
    expect(owned(a).playingTheme).toBe('meadow');expect([...owned(a).voices]).toEqual(first);first.forEach(v=>expect(v.sources[0]!.stop).toHaveBeenCalledTimes(1));
    ctx.currentTime=3.25;vi.advanceTimersByTime(25);expect(owned(a).playingTheme).toBe('orchard');expect(owned(a).step).toBe(1);expect(vi.getTimerCount()).toBe(1);expect([...owned(a).voices].filter(v=>v.bus==='music').length).toBeLessThanOrEqual(6);
  });
  it('OFF/숨김 동안 최종 곡만 보존하고 재개·context 교체는 그 곡으로 한 번 시작합니다',async()=>{
    const a=make();await a.unlock();a.setMusicEnabled(false);a.setMusicTheme('woodland');expect(vi.getTimerCount()).toBe(0);a.setMusicEnabled(true);expect(owned(a).playingTheme).toBe('woodland');
    hide(true);a.setMusicTheme('garden');expect(vi.getTimerCount()).toBe(0);hide(false);await flush();expect(owned(a).playingTheme).toBe('garden');expect(vi.getTimerCount()).toBe(1);
    const old=owned(a).context!,stale=old.onstatechange!;old.change('closed');a.setMusicTheme('pip');await a.unlock();stale();expect(owned(a).playingTheme).toBe('pip');expect(vi.getTimerCount()).toBe(1);
    a.destroy();a.setMusicTheme('lantern');expect(owned(a).requestedTheme).toBe('pip');expect(vi.getTimerCount()).toBe(0);
  });
  it('긴 프레임 지연은 놓친 음을 건너뛰고 다음 미예약 마디에서 요청을 반영합니다',async()=>{
    const a=make();await a.unlock();const ctx=owned(a).context!,spy=vi.spyOn(owned(a),'note');a.setMusicTheme('lantern');ctx.currentTime=1000;vi.advanceTimersByTime(25);
    expect(spy.mock.calls.length).toBeLessThanOrEqual(3);expect(spy.mock.calls.every(c=>c[2]>=1000)).toBe(true);
    for(let i=1;i<=40;i++){ctx.currentTime=1000+i*.1;vi.advanceTimersByTime(25);}expect(owned(a).playingTheme).toBe('lantern');expect(vi.getTimerCount()).toBe(1);
  });
  it.each(MUSIC_THEMES)('%s의16마디를 예약해도 음악 음성 상한과 단일 타이머를 유지합니다',async theme=>{
    const a=make();a.setMusicTheme(theme);await a.unlock();const ctx=owned(a).context!;
    for(let i=1;i<=535;i++){ctx.currentTime=i*.1;vi.advanceTimersByTime(25);expect([...owned(a).voices].filter(v=>v.bus==='music').length).toBeLessThanOrEqual(6);}
    expect(owned(a).nextNote).toBeGreaterThan(53.5);expect(vi.getTimerCount()).toBe(1);expect(owned(a).playingTheme).toBe(theme);
  });
});
