export class GameAudio {
  private ctx?: AudioContext;
  private master?: GainNode;
  private ambience?: GainNode;
  private noiseBuf?: AudioBuffer;
  private volume = 0.6;
  private muted = false;
  private lastCannon = 0;

  setVolume(v: number) {
    this.volume = v;
    if (this.master) this.master.gain.value = this.muted ? 0 : v;
  }
  setMuted(m: boolean) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : this.volume;
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * .5;
    this.noiseBuf = buf;
    // 持续海浪
    const src = this.ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = 420; filter.Q.value = .7;
    const g = this.ctx.createGain(); g.gain.value = .16;
    const lfo = this.ctx.createOscillator(); lfo.frequency.value = .16;
    const lfoGain = this.ctx.createGain(); lfoGain.gain.value = .09;
    lfo.connect(lfoGain); lfoGain.connect(g.gain);
    src.connect(filter); filter.connect(g); g.connect(this.master);
    src.start(); lfo.start();
    this.ambience = g;
  }

  private noise(duration: number, filterFreq: number, gain: number, type: BiquadFilterType = 'lowpass', slide = 0) {
    if (!this.ctx || !this.master || !this.noiseBuf) return;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = .8 + Math.random() * .5;
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.setValueAtTime(filterFreq, now);
    if (slide) f.frequency.exponentialRampToValueAtTime(Math.max(40, filterFreq + slide), now + duration);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, now);
    g.gain.exponentialRampToValueAtTime(.0001, now + duration);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(now); src.stop(now + duration + .02);
  }

  private tone(freq: number, duration: number, gain: number, type: OscillatorType = 'sine', slideTo?: number) {
    if (!this.ctx || !this.master) return;
    const now = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = type; o.frequency.setValueAtTime(freq, now);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, now + duration);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, now);
    g.gain.exponentialRampToValueAtTime(.0001, now + duration);
    o.connect(g); g.connect(this.master);
    o.start(now); o.stop(now + duration + .02);
  }

  cannon() {
    if (!this.ctx || this.ctx.currentTime - this.lastCannon < .12) return;
    this.lastCannon = this.ctx.currentTime;
    this.noise(.42, 900, .8, 'lowpass', -700);
    this.tone(95, .35, .45, 'sine', 38);
  }
  hit() { this.noise(.3, 1600, .4, 'bandpass', -1000); this.tone(180, .2, .15, 'triangle', 60); }
  explosion() {
    this.noise(1.1, 1200, .9, 'lowpass', -1000);
    this.tone(110, .8, .5, 'sawtooth', 32);
  }
  splash() { this.noise(.55, 2600, .3, 'highpass', -1600); }
  pickup() { this.tone(660, .12, .2, 'sine'); setTimeout(() => this.tone(990, .18, .18, 'sine'), 90); }
  dash() { this.noise(.7, 1800, .35, 'bandpass', -1200); }
  repair() { this.tone(330, .15, .16, 'sine'); setTimeout(() => this.tone(495, .25, .14, 'sine'), 110); }
  end(win: boolean) {
    const notes = win ? [523, 659, 784, 1047] : [523, 440, 349];
    notes.forEach((n, i) => setTimeout(() => this.tone(n, .35, .2, 'triangle'), i * 150));
  }
}
