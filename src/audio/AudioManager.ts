export type SoundName = 'tap' | 'swap' | 'invalid' | 'match' | 'special' | 'win' | 'lose' | 'reward';

type Bus = 'music' | 'sfx';
interface Voice {
  bus: Bus;
  end: number;
  envelope: GainNode;
  sources: OscillatorNode[];
  nodes: AudioNode[];
}

// Original eight-bar tune: C-major pentatonic, 4/4, 72 BPM.
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
const FIFTHS = [55, 52, 62, 55, 55, 52, 62, 55] as const;
const EIGHTH = 60 / 72 / 2;
const PENTATONIC = [0, 2, 4, 7, 9] as const;

/** Owns one lazy Web Audio context. Call unlock directly from a user gesture.
 * No samples, remote assets, Phaser audio, or Capacitor dependency required.
 */
export class AudioManager {
  private context?: AudioContext;
  private musicBus?: GainNode;
  private sfxBus?: GainNode;
  private outputNodes: AudioNode[] = [];
  private voices = new Set<Voice>();
  private timer?: ReturnType<typeof setInterval>;
  private nextNote = 0;
  private step = 0;
  private music = true;
  private sfx = true;
  private unlocked = false;
  private paused = false;
  private destroyed = false;
  private lastSfx = new Map<SoundName, number>();

  constructor() {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibility);
    }
  }

  get musicEnabled(): boolean { return this.music; }
  get sfxEnabled(): boolean { return this.sfx; }

  async unlock(): Promise<void> {
    if (this.destroyed || typeof window === 'undefined') return;
    if (!this.context) {
      const AudioCtor = window.AudioContext ??
        (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtor) return;
      try {
        const ctx = new AudioCtor({ latencyHint: 'interactive' });
        this.context = ctx;
        this.musicBus = ctx.createGain();
        this.sfxBus = ctx.createGain();
        const master = ctx.createGain();
        const compressor = ctx.createDynamicsCompressor();
        this.musicBus.gain.value = this.music ? 0.32 : 0;
        this.sfxBus.gain.value = this.sfx ? 0.65 : 0;
        master.gain.value = 0.65;
        compressor.threshold.value = -12;
        compressor.knee.value = 12;
        compressor.ratio.value = 8;
        compressor.attack.value = 0.004;
        compressor.release.value = 0.16;
        this.musicBus.connect(master);
        this.sfxBus.connect(master);
        master.connect(compressor);
        compressor.connect(ctx.destination);
        this.outputNodes = [this.musicBus, this.sfxBus, master, compressor];
        ctx.onstatechange = this.onStateChange;
      } catch {
        // Audio is optional: unsupported/restricted WebViews still run the game.
        return;
      }
    }
    this.unlocked = true;
    await this.activate();
  }

  setMusicEnabled(enabled: boolean): void {
    this.music = enabled;
    this.setBus(this.musicBus, enabled ? 0.32 : 0);
    if (!enabled) this.stopMusic(true);
    else this.startMusic();
  }

  setSfxEnabled(enabled: boolean): void {
    this.sfx = enabled;
    this.setBus(this.sfxBus, enabled ? 0.65 : 0);
    if (!enabled) this.stopVoices('sfx', true);
  }

  play(name: SoundName, chain = 1): void {
    const ctx = this.context;
    if (!ctx || !this.sfx || !this.canPlay() || ctx.state !== 'running') return;
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
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibility);
    this.stopMusic();
    this.stopVoices();
    const ctx = this.context;
    if (ctx) {
      ctx.onstatechange = null;
      if (ctx.state !== 'closed') void ctx.close().catch(() => undefined);
    }
    this.outputNodes.forEach(node => node.disconnect());
    this.outputNodes = [];
    this.context = undefined;
    this.musicBus = undefined;
    this.sfxBus = undefined;
    this.lastSfx.clear();
  }

  private canPlay(): boolean {
    return !this.destroyed && this.unlocked && !this.paused &&
      (typeof document === 'undefined' || !document.hidden);
  }

  private async activate(): Promise<void> {
    const ctx = this.context;
    if (!ctx || !this.canPlay() || ctx.state === 'closed') return;
    try {
      // Invoked synchronously before the first await to preserve gesture activation.
      if (ctx.state !== 'running') await ctx.resume();
      if (this.context !== ctx || !this.canPlay()) return;
      this.startMusic();
    } catch {
      // Some mobile interruptions need another gesture. A later unlock retries.
    }
  }

  private pauseContext(): void {
    this.stopMusic();
    this.stopVoices();
    this.lastSfx.clear();
    const ctx = this.context;
    if (ctx && ctx.state !== 'closed') {
      void ctx.suspend().then(() => {
        // Resume may have been called while suspend was in flight.
        if (this.canPlay()) void this.activate();
      }).catch(() => undefined);
    }
  }

  private readonly onVisibility = (): void => {
    if (document.hidden) this.pauseContext();
    else void this.activate();
  };

  private readonly onStateChange = (): void => {
    if (this.context?.state === 'running') {
      if (this.canPlay()) this.startMusic();
      else this.pauseContext();
    } else {
      this.stopMusic();
      this.stopVoices();
    }
  };

  private setBus(bus: GainNode | undefined, value: number): void {
    const ctx = this.context;
    if (!ctx || !bus || ctx.state === 'closed') return;
    bus.gain.cancelScheduledValues(ctx.currentTime);
    bus.gain.setTargetAtTime(value, ctx.currentTime, 0.015);
  }

  private startMusic(): void {
    const ctx = this.context;
    if (!ctx || !this.music || !this.canPlay() || ctx.state !== 'running' || this.timer !== undefined) return;
    this.step = 0;
    this.nextNote = ctx.currentTime + 0.05;
    this.scheduleMusic();
    this.timer = setInterval(() => this.scheduleMusic(), 25);
  }

  private scheduleMusic(): void {
    const ctx = this.context;
    if (!ctx || ctx.state !== 'running' || !this.canPlay() || !this.music) return;
    const now = ctx.currentTime;
    if (this.nextNote < now) {
      // Skip missed notes after a busy frame, instead of emitting them together.
      const skipped = Math.ceil((now + 0.02 - this.nextNote) / EIGHTH);
      this.step = (this.step + skipped) % 64;
      this.nextNote += skipped * EIGHTH;
    }
    while (this.nextNote < now + 0.18) {
      const bar = Math.floor(this.step / 8);
      const beat = this.step % 8;
      const pitch = MELODY[bar]![beat];
      if (pitch != null) this.note('music', pitch, this.nextNote, 0.52, 0.065);
      if (beat === 0 || beat === 4) {
        this.note('music', beat === 0 ? BASS[bar]! : FIFTHS[bar]!, this.nextNote, 0.85, 0.055);
      }
      this.nextNote += EIGHTH;
      this.step = (this.step + 1) % 64;
    }
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
    overtone.frequency.value = hz * 2;
    partial.gain.value = 0.18;
    fundamental.connect(envelope);
    overtone.connect(partial);
    partial.connect(envelope);
    envelope.connect(output);
    envelope.gain.setValueAtTime(0, time);
    envelope.gain.linearRampToValueAtTime(amplitude, time + 0.008);
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
    voice.nodes.forEach(node => node.disconnect());
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
