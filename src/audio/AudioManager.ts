export type SoundName = 'tap' | 'swap' | 'invalid' | 'match' | 'special' | 'win' | 'lose' | 'reward';

type Bus = 'music' | 'sfx';
interface Voice {
  bus: Bus;
  end: number;
  envelope: GainNode;
  sources: AudioScheduledSourceNode[];
  nodes: AudioNode[];
}

// Original eight-bar motif: C-major pentatonic, arranged below in 4/4 at 112 BPM.
// Each row is a bar of eighth notes; null is a rest.
const MELODY: readonly (readonly (number | null)[])[] = [
  [72, null, 76, 79, null, 76, 74, null],
  [69, null, 72, null, 76, 74, 72, null],
  [74, null, 76, 79, null, 81, 79, null],
  [76, null, 74, null, 72, null, null, null],
  [79, null, 81, 79, 76, null, 74, null],
  [76, null, 72, 69, null, 72, 74, null],
  [74, null, 79, null, 76, 74, 72, null],
  [76, null, 74, null, 72, null, null, null],
];
const BASS = [48, 45, 55, 48, 48, 45, 55, 48] as const;

export type MusicTheme='meadow'|'brook'|'orchard'|'woodland'|'lantern'|'garden'|'pip'|'winter'|'tide'|'dream'|'clockwork'|'festival';
type MusicTimbre='bell'|'soft'|'wood';
interface MusicScore {readonly melody:readonly (readonly (number|null)[])[];readonly bass:readonly number[];readonly fifths:readonly number[];readonly timbre:MusicTimbre}
// 자체16마디 동기는 공통112BPM/4박자·32마디 편곡으로 다음 마디에서 테마를 전환합니다.
// 질문8마디+응답8마디 동기는 보존하고 뒤16마디에서 반주·종지 강도를 달리합니다.
const ANSWER_ORDER=[4,5,0,1,2,6,3,7] as const;
const score=(melody:readonly (readonly (number|null)[])[],bass:readonly number[],timbre:MusicTimbre):MusicScore=>({
  melody:[...melody,...ANSWER_ORDER.map((index,bar)=>bar===7?[76,null,74,null,72,null,null,null]:melody[index]!.map(pitch=>pitch===null?null:bar<2&&pitch<=76?pitch+12:pitch))],
  bass:[...bass,...ANSWER_ORDER.map((index,bar)=>bar===7?48:bass[index]!)],fifths:[...bass,...ANSWER_ORDER.map((index,bar)=>bar===7?48:bass[index]!)].map(pitch=>pitch+7),timbre,
});
// 여정 곡은16마디 전체를 별도로 적고 같은32마디 편곡·자원 예산을 공유합니다.
const journeyScore=(melody:readonly (readonly (number|null)[])[],bass:readonly number[],timbre:MusicTimbre):MusicScore=>({melody,bass,fifths:bass.map(pitch=>pitch+7),timbre});
const MUSIC_SCORES:Readonly<Record<MusicTheme,MusicScore>>={
  meadow:score(MELODY,BASS,'bell'),
  brook:score([
    [76,null,79,null,81,79,76,null],[74,null,76,79,null,76,74,null],
    [72,null,74,76,79,null,76,null],[74,72,null,null,67,null,72,null],
    [81,null,79,76,null,79,81,null],[79,null,76,74,72,null,74,null],
    [74,null,79,76,null,74,72,null],[76,null,74,null,72,null,null,null],
  ],[48,53,45,55,48,53,55,48],'soft'),
  orchard:score([
    [72,76,null,79,null,76,72,null],[74,77,null,81,null,77,74,null],
    [76,79,null,84,null,79,76,null],[79,null,76,null,74,72,null,null],
    [77,81,null,84,null,81,77,null],[76,79,null,81,null,79,76,null],
    [74,79,null,81,79,null,74,null],[76,null,74,null,72,null,null,null],
  ],[48,53,48,55,53,45,55,48],'wood'),
  woodland:score([
    [69,null,null,72,null,76,72,null],[67,null,71,null,74,null,null,null],
    [65,null,null,69,null,72,69,null],[67,null,72,null,76,null,null,null],
    [72,null,76,null,null,79,76,null],[69,null,72,null,76,null,72,null],
    [67,null,74,null,71,null,67,null],[72,null,null,null,72,null,null,null],
  ],[45,43,41,48,48,45,43,48],'soft'),
  lantern:score([
    [79,null,84,83,null,79,76,null],[77,null,81,79,null,77,74,null],
    [76,null,79,84,null,83,81,null],[79,null,76,null,74,null,72,null],
    [81,null,84,86,null,84,81,null],[79,null,83,84,null,79,76,null],
    [77,null,81,79,77,null,74,null],[76,null,74,null,72,null,null,null],
  ],[48,53,45,55,53,48,55,48],'bell'),
  garden:score([
    [65,null,69,null,72,null,69,null],[64,null,67,72,null,67,64,null],
    [62,null,65,null,69,null,65,null],[67,null,71,null,74,null,null,null],
    [69,null,72,null,77,null,72,null],[67,null,72,76,null,72,67,null],
    [65,null,69,null,67,65,62,null],[64,null,67,null,72,null,null,null],
  ],[41,48,50,43,53,48,55,48],'wood'),
  pip:score([
    [72,null,79,null,76,72,null,null],[74,null,81,null,77,74,null,null],
    [76,null,84,null,79,76,74,null],[72,null,76,null,79,null,null,null],
    [81,null,79,null,76,74,72,null],[77,null,76,null,74,72,69,null],
    [74,null,79,null,81,79,76,null],[74,null,76,null,72,null,null,null],
  ],[48,53,48,48,45,53,55,48],'wood'),
  winter:journeyScore([
    [84,null,null,79,null,76,null,null],[81,null,79,null,76,null,74,null],
    [79,null,null,76,null,72,null,null],[74,null,76,null,79,null,null,null],
    [81,null,null,84,null,81,79,null],[76,null,79,null,74,null,null,null],
    [77,null,null,76,null,74,null,null],[76,null,74,null,72,null,null,null],
    [84,null,86,null,null,84,79,null],[81,null,null,79,null,76,null,null],
    [79,null,81,null,76,null,72,null],[74,null,null,79,null,76,null,null],
    [81,null,84,null,79,null,76,null],[77,null,null,76,null,72,null,null],
    [74,null,79,null,76,null,74,null],[72,null,null,null,72,null,null,null],
  ],[48,53,48,55,45,48,53,48,48,53,45,55,53,48,55,48],'soft'),
  tide:journeyScore([
    [67,null,72,null,76,null,79,null],[77,null,76,72,null,69,72,null],
    [74,null,76,null,79,76,null,74],[72,null,67,null,72,null,null,null],
    [69,null,72,null,77,null,81,null],[79,76,null,72,null,76,74,null],
    [74,null,79,null,77,74,null,71],[72,null,76,null,72,null,null,null],
    [76,null,79,84,null,79,76,null],[77,null,81,null,79,null,76,null],
    [74,76,null,79,null,76,72,null],[74,null,67,null,71,null,74,null],
    [77,null,76,72,null,69,72,null],[76,null,79,null,74,72,null,67],
    [74,null,77,null,76,74,null,71],[72,null,76,null,72,null,null,null],
  ],[48,41,45,48,53,48,43,48,48,53,45,43,53,48,55,48],'wood'),
  dream:journeyScore([
    [69,null,72,null,76,null,null,null],[71,null,null,74,null,79,null,null],
    [72,null,76,null,null,79,76,null],[69,null,null,67,null,64,null,null],
    [65,null,69,null,72,null,null,null],[67,null,null,71,null,74,null,null],
    [72,null,71,null,69,null,67,null],[69,null,null,null,69,null,null,null],
    [76,null,79,null,81,null,null,null],[79,null,null,76,null,74,null,null],
    [76,null,72,null,71,null,69,null],[67,null,null,64,null,67,null,null],
    [69,null,72,null,77,null,76,null],[74,null,null,71,null,67,null,null],
    [72,null,71,null,69,null,68,null],[69,null,null,null,69,null,null,null],
  ],[45,43,48,45,41,43,48,45,45,43,48,40,41,43,40,45],'soft'),
  clockwork:journeyScore([
    [72,79,76,null,74,null,79,null],[71,null,74,79,77,null,74,null],
    [69,76,72,null,71,null,76,null],[72,null,76,79,null,76,72,null],
    [77,81,79,null,77,null,72,null],[76,null,79,84,81,null,76,null],
    [74,79,77,null,74,null,71,null],[72,null,76,null,72,null,null,null],
    [79,84,81,null,79,null,76,null],[77,null,81,79,76,null,74,null],
    [76,81,79,null,76,null,72,null],[74,null,79,77,null,74,71,null],
    [77,81,84,null,81,null,77,null],[76,null,79,76,72,null,67,null],
    [74,77,79,null,77,null,71,null],[72,null,76,null,72,null,null,null],
  ],[48,43,45,48,53,48,55,48,48,53,45,43,53,48,55,48],'wood'),
  festival:journeyScore([
    [79,null,79,81,84,null,81,null],[79,null,76,72,76,null,79,null],
    [77,null,77,79,81,null,84,null],[83,null,81,79,74,null,null,null],
    [81,null,84,86,84,null,81,null],[79,null,84,83,79,null,76,null],
    [77,null,81,79,77,null,74,null],[76,null,74,null,72,null,null,null],
    [84,null,84,86,88,null,86,null],[84,null,81,79,76,null,79,null],
    [81,null,84,81,77,null,79,null],[83,null,81,79,74,null,79,null],
    [81,null,84,86,84,null,81,null],[79,null,76,72,76,null,79,null],
    [77,null,74,79,76,null,74,null],[72,null,79,null,72,null,null,null],
  ],[48,48,53,55,45,48,53,48,48,45,53,55,53,48,55,48],'bell'),
};
export function musicScore(theme:MusicTheme):MusicScore{return MUSIC_SCORES[theme];}
export const MUSIC_THEMES=Object.freeze(Object.keys(MUSIC_SCORES) as MusicTheme[]);

export const MUSIC_TIMING=Object.freeze({bpm:112,pulsesPerBar:8,barsPerLoop:32} as const);
const EIGHTH = 60 / MUSIC_TIMING.bpm / 2;
export const MUSIC_LOOP_SECONDS=EIGHTH*MUSIC_TIMING.pulsesPerBar*MUSIC_TIMING.barsPerLoop;
const PENTATONIC = [0, 2, 4, 7, 9] as const;
export const AUDIO_LEVELS={music:4,sfx:3.4,master:1,makeup:1.12} as const;

// 최종 출력의 급격한 잘림을 피하면서 큰 동시 신호를 부드럽게 제한합니다.
export function outputCurve():Float32Array<ArrayBuffer> {
  return Float32Array.from({length:4097},(_,i)=>{
    const x=(i/4096)*2-1,magnitude=Math.abs(x);
    return Math.sign(x)*(magnitude<=0.65?magnitude:0.65+0.25*Math.tanh((magnitude-0.65)/0.25));
  });
}

/** Owns one lazy Web Audio context. Call unlock directly from a user gesture.
 * No samples, remote assets, Phaser audio, or Capacitor dependency required.
 */
export class AudioManager {
  private context?: AudioContext;
  private musicBus?: GainNode;
  private percussionBuffer?: AudioBuffer;
  private sfxBus?: GainNode;
  private outputNodes: AudioNode[] = [];
  private voices = new Set<Voice>();
  private timer?: ReturnType<typeof setInterval>;
  private nextNote = 0;
  private step = 0;
  private music = true;
  private requestedTheme:MusicTheme='meadow';
  private playingTheme:MusicTheme='meadow';
  private sfx = true;
  private unlocked = false;
  private paused = false;
  private destroyed = false;
  private resuming?: { context: AudioContext };
  private suspending?: AudioContext;
  private lastSfx = new Map<SoundName, number>();

  constructor(private readonly manageVisibility=true) {
    if (manageVisibility && typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibility);
    }
  }

  get musicEnabled(): boolean { return this.music; }
  get sfxEnabled(): boolean { return this.sfx; }

  async unlock(): Promise<void> {
    if (this.destroyed || typeof window === 'undefined') return;
    // A closed context cannot resume. Only an explicit gesture creates its replacement.
    if (this.context?.state === 'closed') this.disposeContext();
    if (!this.context) {
      const AudioCtor = window.AudioContext ??
        (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtor) return;
      let ctx: AudioContext | undefined;
      const nodes: AudioNode[] = [];
      // Register each node immediately, including failures in later property setters/connects.
      const own = <T extends AudioNode>(node: T): T => { nodes.push(node); return node; };
      try {
        ctx = new AudioCtor({ latencyHint: 'interactive' });
        const musicBus = own(ctx.createGain());
        const sfxBus = own(ctx.createGain());
        const master = own(ctx.createGain());
        const compressor = own(ctx.createDynamicsCompressor());
        const makeup = own(ctx.createGain());
        const limiter = own(ctx.createWaveShaper());
        const peakGuard = own(ctx.createWaveShaper());
        musicBus.gain.value = this.music ? AUDIO_LEVELS.music : 0;
        sfxBus.gain.value = this.sfx ? AUDIO_LEVELS.sfx : 0;
        master.gain.value = AUDIO_LEVELS.master;
        compressor.threshold.value = -9;
        compressor.knee.value = 6;
        compressor.ratio.value = 6;
        compressor.attack.value = 0.004;
        compressor.release.value = 0.16;
        makeup.gain.value = AUDIO_LEVELS.makeup;
        musicBus.connect(master);
        sfxBus.connect(master);
        master.connect(compressor);
        limiter.curve = outputCurve();
        limiter.oversample = '4x';
        // 오버샘플링 필터의 순간 오버슈트도 최종 출력에서 제한합니다.
        peakGuard.curve = Float32Array.from({length:4097},(_,i)=>Math.max(-0.95,Math.min(0.95,i/4096*2-1)));
        peakGuard.oversample = 'none';
        compressor.connect(makeup);
        makeup.connect(limiter);
        limiter.connect(peakGuard);
        peakGuard.connect(ctx.destination);
        const readyContext = ctx;
        ctx.onstatechange = () => this.onStateChange(readyContext);
        this.context = ctx;
        this.musicBus = musicBus;
        this.sfxBus = sfxBus;
        this.outputNodes = nodes;
      } catch {
        this.disposeGraph(ctx, nodes);
        // Audio is optional: unsupported/restricted WebViews still run the game.
        return;
      }
    }
    this.unlocked = true;
    await this.activate(true);
  }

  setMusicEnabled(enabled: boolean): void {
    const restarting=enabled&&!this.music;
    this.music = enabled;
    if(restarting)this.stopVoices('music');
    this.setBus(this.musicBus, enabled ? AUDIO_LEVELS.music : 0);
    if (!enabled) this.stopMusic(true);
    else this.startMusic();
  }

  /** 마지막 요청만 다음 미예약 마디에 반영합니다. 음량·context·타이머는 만들지 않습니다. */
  setMusicTheme(theme:MusicTheme):void {
    if(this.destroyed||!MUSIC_THEMES.includes(theme)||this.requestedTheme===theme)return;
    this.requestedTheme=theme;
    if(this.timer===undefined)this.playingTheme=theme;
  }

  setSfxEnabled(enabled: boolean): void {
    this.sfx = enabled;
    this.setBus(this.sfxBus, enabled ? AUDIO_LEVELS.sfx : 0);
    if (!enabled) this.stopVoices('sfx', true);
  }

  play(name: SoundName, chain = 1): void {
    const ctx = this.context;
    if (!ctx || !this.sfx || !this.canPlay() || this.suspending === ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    // Collapse repeated calls from the same cascade/frame; never replay a backlog.
    if (now - (this.lastSfx.get(name) ?? -Infinity) < 0.045) return;
    this.lastSfx.set(name, now);
    const level = Math.max(1, Math.min(8, Math.floor(Number.isFinite(chain) ? chain : 1)));
    const degree = level - 1;
    const matchNote = 72 + PENTATONIC[degree % 5]! + Math.floor(degree / 5) * 12;
    let notes: readonly number[];
    let gap = 0.065;
    let duration = 0.24;
    let amplitude = 0.09;
    switch (name) {
      case 'tap': notes = [76]; duration = 0.09; amplitude = 0.055; break;
      case 'swap': notes = [72, 76]; duration = 0.13; break;
      case 'invalid': notes = [64, 60]; gap = 0.085; amplitude = 0.055; break;
      case 'match': notes = [matchNote, matchNote + 7]; break;
      case 'special': notes = [72, 76, 79, 84]; gap = 0.05; duration = 0.34; break;
      case 'win': notes = [72, 76, 79, 81, 84]; gap = 0.12; duration = 0.48; break;
      case 'lose': notes = [69, 67, 64, 60]; gap = 0.14; amplitude = 0.055; break;
      case 'reward': notes = [79, 81, 84]; gap = 0.095; duration = 0.38; break;
      default: return;
    }
    notes.forEach((note, index) => this.note('sfx', note, now + 0.006 + index * gap, duration, amplitude));
  }

  /** Explicit pause for native app lifecycle, full-screen ads, and game pause. */
  suspend(): void {
    this.paused = true;
    this.pauseContext();
  }

  resume(): void {
    this.paused = false;
    void this.activate();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.manageVisibility && typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibility);
    this.disposeContext();
  }

  private disposeContext(): void {
    const ctx = this.context;
    const nodes = this.outputNodes;
    this.stopMusic();
    this.stopVoices();
    this.context = undefined;
    this.musicBus = undefined;
    this.percussionBuffer = undefined;
    this.sfxBus = undefined;
    this.outputNodes = [];
    this.resuming = undefined;
    this.suspending = undefined;
    this.lastSfx.clear();
    this.disposeGraph(ctx, nodes);
  }

  private disposeGraph(ctx: AudioContext | undefined, nodes: AudioNode[]): void {
    if (ctx) ctx.onstatechange = null;
    for (const node of nodes) {
      try { node.disconnect(); } catch { /* Continue cleaning the remaining nodes. */ }
    }
    try {
      if (ctx && ctx.state !== 'closed') void ctx.close().catch(() => undefined);
    } catch { /* Restricted implementations may also throw synchronously. */ }
  }

  private canPlay(): boolean {
    return !this.destroyed && this.unlocked && !this.paused &&
      (typeof document === 'undefined' || !document.hidden);
  }

  private async activate(explicitUnlock = false): Promise<void> {
    const ctx = this.context;
    if (!ctx || !this.canPlay() || ctx.state === 'closed' ||
        (!explicitUnlock && (this.suspending === ctx || this.resuming?.context === ctx))) return;
    const attempt = { context: ctx };
    try {
      // Invoked synchronously before the first await to preserve gesture activation.
      // Autoplay may leave an older resume pending indefinitely. A new explicit
      // gesture must call resume again, even while an automatic request is pending.
      if (ctx.state !== 'running') {
        this.resuming = attempt;
        await ctx.resume();
      }
      if (this.context !== ctx || this.destroyed) return;
      if (this.canPlay()) this.startMusic();
      else this.pauseContext();
    } catch {
      // Some mobile interruptions need another gesture. A later unlock retries.
    } finally {
      if (this.resuming === attempt) this.resuming = undefined;
    }
  }

  private pauseContext(): void {
    this.stopMusic();
    this.stopVoices();
    this.lastSfx.clear();
    const ctx = this.context;
    if (ctx && ctx.state !== 'closed' && this.suspending !== ctx &&
        (ctx.state === 'running' || this.resuming?.context === ctx)) {
      this.suspending = ctx;
      // Also queue suspend when an earlier resume is still pending.
      try { void ctx.suspend().then(() => {
        if (this.context !== ctx || this.destroyed) return;
        this.suspending = undefined;
        // Resume may have been called while suspend was in flight.
        if (this.canPlay()) void this.activate();
      }).catch(() => {
        if (this.suspending === ctx) this.suspending = undefined;
      }); } catch {
        if (this.suspending === ctx) this.suspending = undefined;
      }
    }
  }

  private readonly onVisibility = (): void => {
    if (document.hidden) this.pauseContext();
    else void this.activate();
  };

  private onStateChange(ctx: AudioContext): void {
    if (this.context !== ctx || this.destroyed) return;
    if (ctx.state === 'running') {
      if (this.canPlay() && this.suspending !== ctx) this.startMusic();
      else this.pauseContext();
    } else {
      this.stopMusic();
      this.stopVoices();
      this.lastSfx.clear();
    }
  }

  private setBus(bus: GainNode | undefined, value: number): void {
    const ctx = this.context;
    if (!ctx || !bus || ctx.state === 'closed') return;
    bus.gain.cancelScheduledValues(ctx.currentTime);
    bus.gain.setTargetAtTime(value, ctx.currentTime, 0.015);
  }

  private startMusic(): void {
    const ctx = this.context;
    if (!ctx || !this.music || !this.canPlay() || ctx.state !== 'running' || this.suspending === ctx || this.timer !== undefined) return;
    this.playingTheme=this.requestedTheme;
    this.step = 0;
    this.nextNote = ctx.currentTime + 0.05;
    this.scheduleMusic();
    this.timer = setInterval(() => { if (this.context === ctx) this.scheduleMusic(); }, 25);
  }

  private scheduleMusic(): void {
    const ctx = this.context;
    if (!ctx || ctx.state !== 'running' || !this.canPlay() || !this.music) return;
    const now = ctx.currentTime;
    if (this.nextNote < now) {
      // Skip missed notes after a busy frame, instead of emitting them together.
      const skipped = Math.ceil((now + 0.02 - this.nextNote) / EIGHTH);
      this.step = (this.step + skipped) % (MUSIC_TIMING.pulsesPerBar*MUSIC_TIMING.barsPerLoop);
      this.nextNote += skipped * EIGHTH;
    }
    while (this.nextNote < now + 0.18) {
      if(this.step%8===0&&this.playingTheme!==this.requestedTheme){this.playingTheme=this.requestedTheme;this.step=0;}
      const score=MUSIC_SCORES[this.playingTheme];
      const phraseBar=Math.floor(this.step / 8),bar=phraseBar%score.melody.length,chorus=phraseBar>=score.melody.length;
      const beat = this.step % 8;
      const quiet=['garden','pip','dream','winter'].includes(this.playingTheme),root=score.bass[bar]!,time=this.nextNote;
      const pitch=score.melody[bar]![beat]??(chorus&&bar%4===3&&beat===7?root+24:null);
      const accent=[1,.82,.92,.86,1,.84,.96,.82][beat];
      if(pitch!==null)this.musicTone('lead',pitch,time,.18,.06*accent*(chorus?1.04:1));
      // Each eighth reserves at most three voices. No future offbeat chord can steal the lead slot.
      if(beat%2===0){
        this.musicTone('bass',root+[0,7,12,7][beat/2],time,.145,quiet?.033:.043);
        this.musicPercussion(beat%4===0?'kick':'snare',time,quiet?.55:1);
      }else{
        this.musicTone('comp',root+12,time,.065,quiet?.011:.018);
        const fill=chorus&&bar%4===3&&beat===7;
        if(!quiet||beat===3||beat===7)this.musicPercussion(fill?'snare':'hat',time,fill?.8:quiet?.45:.65);
      }
      this.nextNote += EIGHTH;
      this.step = (this.step + 1) % (MUSIC_TIMING.pulsesPerBar*MUSIC_TIMING.barsPerLoop);
    }
  }

  private musicReservation(): {ctx:AudioContext;output:GainNode}|undefined {
    const ctx=this.context,output=this.musicBus;
    if(!ctx||!output||ctx.state!=='running'||!this.canPlay()||!this.music)return;
    for(const voice of this.voices)if(voice.end<=ctx.currentTime)this.release(voice);
    let count=0;for(const voice of this.voices)if(voice.bus==='music')count++;
    return count<6?{ctx,output}:undefined;
  }

  /** Short pitched parts use one owned voice, including a root/fifth comp voicing. */
  private musicTone(part:'lead'|'bass'|'comp',midi:number,time:number,duration:number,amplitude:number):boolean {
    const reservation=this.musicReservation();if(!reservation)return false;
    const {ctx,output}=reservation,nodes:AudioNode[]=[],sources:AudioScheduledSourceNode[]=[];
    const own=<T extends AudioNode>(node:T):T=>{nodes.push(node);return node;};let voice:Voice|undefined;
    try{
      const envelope=own(ctx.createGain()),fundamental=own(ctx.createOscillator()),overtone=own(ctx.createOscillator()),partial=own(ctx.createGain());
      sources.push(fundamental,overtone);
      const hz=440*2**((midi-69)/12),timbre=MUSIC_SCORES[this.playingTheme].timbre;
      fundamental.type=part==='comp'?'triangle':'sine';overtone.type='sine';fundamental.frequency.value=hz;
      overtone.frequency.value=part==='comp'?hz*2**(7/12):hz*(part==='bass'?2:timbre==='wood'?3:2.002);
      partial.gain.value=part==='comp'?.55:part==='bass'?.12:timbre==='soft'?.16:timbre==='wood'?.3:.26;
      fundamental.connect(envelope);overtone.connect(partial);partial.connect(envelope);envelope.connect(output);
      envelope.gain.setValueAtTime(0,time);envelope.gain.linearRampToValueAtTime(amplitude,time+.004);
      envelope.gain.setValueAtTime(amplitude,time+(part==='lead'?.022:.012));
      if(part==='comp')envelope.gain.exponentialRampToValueAtTime(.0001,time+duration);else envelope.gain.linearRampToValueAtTime(.0001,time+duration);envelope.gain.linearRampToValueAtTime(0,time+duration+.015);
      voice={bus:'music',end:time+duration+.018,envelope,sources,nodes};this.voices.add(voice);
      const current=voice;fundamental.onended=()=>this.release(current);
      for(const source of sources){source.start(time);source.stop(current.end);}return true;
    }catch{
      if(voice)this.release(voice);else this.discardMusicNodes(sources,nodes);
      return false;
    }
  }

  private musicPercussion(kind:'kick'|'snare'|'hat',time:number,strength:number):boolean {
    const reservation=this.musicReservation();if(!reservation)return false;
    const {ctx,output}=reservation,nodes:AudioNode[]=[],sources:AudioScheduledSourceNode[]=[];
    const own=<T extends AudioNode>(node:T):T=>{nodes.push(node);return node;};let voice:Voice|undefined;
    try{
      const envelope=own(ctx.createGain()),duration=kind==='kick'?.08:kind==='snare'?.06:.035;
      if(kind==='kick'){
        const kick=own(ctx.createOscillator());sources.push(kick);kick.type='sine';kick.frequency.setValueAtTime(130,time);kick.frequency.exponentialRampToValueAtTime(52,time+.065);kick.connect(envelope);
      }else{
        if(!this.percussionBuffer){
          const buffer=ctx.createBuffer(1,Math.ceil(ctx.sampleRate*.08),ctx.sampleRate),data=buffer.getChannelData(0);let seed=0x4f1bbcdc;
          // A private fixed noise texture never consumes the board's RNG.
          for(let i=0;i<data.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;data[i]=seed/4294967295*2-1;}
          this.percussionBuffer=buffer;
        }
        const noise=own(ctx.createBufferSource()),filter=own(ctx.createBiquadFilter());sources.push(noise);noise.buffer=this.percussionBuffer;
        filter.type=kind==='hat'?'highpass':'bandpass';filter.frequency.value=kind==='hat'?5600:1700;filter.Q.value=.5;noise.connect(filter);filter.connect(envelope);
        if(kind==='snare'){const body=own(ctx.createOscillator()),bodyLevel=own(ctx.createGain());sources.push(body);body.type='sine';body.frequency.value=185;bodyLevel.gain.value=.14;body.connect(bodyLevel);bodyLevel.connect(envelope);}
      }
      const amplitude=(kind==='kick'?.04:kind==='snare'?.017:.007)*strength;
      envelope.connect(output);envelope.gain.setValueAtTime(0,time);envelope.gain.linearRampToValueAtTime(amplitude,time+.003);envelope.gain.exponentialRampToValueAtTime(.0001,time+duration);envelope.gain.linearRampToValueAtTime(0,time+duration+.015);
      voice={bus:'music',end:time+duration+.018,envelope,sources,nodes};this.voices.add(voice);
      const current=voice;sources[0].onended=()=>this.release(current);for(const source of sources){source.start(time);source.stop(current.end);}return true;
    }catch{
      if(voice)this.release(voice);else this.discardMusicNodes(sources,nodes);
      return false;
    }
  }

  private discardMusicNodes(sources:AudioScheduledSourceNode[],nodes:AudioNode[]):void {
    for(const source of sources){source.onended=null;try{source.stop();}catch{/* Not started or already ended. */}}
    for(const node of nodes)try{node.disconnect();}catch{/* Continue releasing the remaining owned nodes. */}
  }

  private stopMusic(fade = false): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    this.stopVoices('music', fade);
  }

  private note(bus: Bus, midi: number, time: number, duration: number, amplitude: number): void {
    const ctx = this.context;
    const output = bus === 'music' ? this.musicBus : this.sfxBus;
    if (!ctx || !output || ctx.state !== 'running') return;
    // Reservations include scheduled notes; bounds are independent per bus.
    for (const voice of this.voices) if (voice.end <= ctx.currentTime) this.release(voice);
    let count = 0;
    for (const voice of this.voices) if (voice.bus === bus) count++;
    if (count >= (bus === 'music' ? 6 : 14)) return;
    const fundamental = ctx.createOscillator();
    const overtone = ctx.createOscillator();
    const envelope = ctx.createGain();
    const partial = ctx.createGain();
    const hz = 440 * 2 ** ((midi - 69) / 12);
    fundamental.type = 'sine';
    overtone.type = 'sine';
    fundamental.frequency.value = hz;
    const timbre=bus==='music'?MUSIC_SCORES[this.playingTheme].timbre:'bell';
    overtone.frequency.value = hz * (timbre==='wood'?3:2);
    partial.gain.value = timbre==='soft'?.10:timbre==='wood'?.14:.18;
    fundamental.connect(envelope);
    overtone.connect(partial);
    partial.connect(envelope);
    envelope.connect(output);
    envelope.gain.setValueAtTime(0, time);
    envelope.gain.linearRampToValueAtTime(amplitude, time + 0.008);
    // 즉시 지수 감쇠하던 소리는 평균 음량이 지나치게 낮았습니다.
    envelope.gain.setValueAtTime(amplitude, time + (bus==='music'?0.10:0.025));
    envelope.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    envelope.gain.linearRampToValueAtTime(0, time + duration + 0.015);
    const end = time + duration + 0.02;
    const voice: Voice = { bus, end, envelope, sources: [fundamental, overtone], nodes: [fundamental, overtone, partial, envelope] };
    this.voices.add(voice);
    fundamental.onended = () => this.release(voice);
    voice.sources.forEach(source => { source.start(time); source.stop(end); });
  }

  private release(voice: Voice): void {
    if (!this.voices.delete(voice)) return;
    voice.sources.forEach(source => {
      source.onended = null;
      try { source.stop(); } catch { /* Already ended. */ }
    });
    voice.nodes.forEach(node => {try{node.disconnect();}catch{/* Continue releasing the remaining owned nodes. */}});
  }

  private stopVoices(bus?: Bus, fade = false): void {
    const ctx = this.context;
    for (const voice of this.voices) {
      if (bus && voice.bus !== bus) continue;
      if (fade && ctx?.state === 'running') {
        const now = ctx.currentTime;
        const gain = voice.envelope.gain;
        // Cancel even future attack envelopes before fading, so toggles cannot
        // accidentally bring a queued note back after the bus is re-enabled.
        if (typeof gain.cancelAndHoldAtTime === 'function') gain.cancelAndHoldAtTime(now);
        else {
          const value = gain.value;
          gain.cancelScheduledValues(now);
          gain.setValueAtTime(value, now);
        }
        gain.linearRampToValueAtTime(0, now + 0.02);
        voice.end = now + 0.025;
        voice.sources.forEach(source => source.stop(voice.end));
      } else this.release(voice);
    }
  }
}
