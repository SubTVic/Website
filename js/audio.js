// Stadium atmosphere and audio playback via the Web Audio API.
// The crowd is synthesized (filtered noise), so no sound files are needed.

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.crowdLevel = 0.5; // volume setting 0 … 1
    this.ducked = false;
  }

  // Must be called from a click (browser autoplay policy)
  async start() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.buildCrowd();
      this.speech = this.ctx.createGain();
      this.speech.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }

  buildCrowd() {
    const ctx = this.ctx;
    const noise = ctx.createBuffer(2, ctx.sampleRate * 4, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      // Pink noise (Paul Kellet filter) sounds warmer than white noise
      const d = noise.getChannelData(ch);
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < d.length; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99765 * b0 + w * 0.099046;
        b1 = 0.963 * b1 + w * 0.2965164;
        b2 = 0.57 * b2 + w * 1.0526913;
        d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.12;
      }
    }

    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);

    // Crowd murmur: several slowly moving 'voice bands'
    this.murmur = ctx.createGain();
    this.murmur.gain.value = 0.35;
    this.murmur.connect(this.master);
    for (const f of [350, 650, 1100, 1800]) {
      const src = ctx.createBufferSource();
      src.buffer = noise;
      src.loop = true;
      src.playbackRate.value = 0.9 + Math.random() * 0.2;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f;
      bp.Q.value = 1.2;
      const g = ctx.createGain();
      g.gain.value = 0.5;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.15 + Math.random() * 0.4;
      const depth = ctx.createGain();
      depth.gain.value = 0.25;
      lfo.connect(depth).connect(g.gain);
      src.connect(bp).connect(g).connect(this.murmur);
      src.start(0, Math.random() * 3);
      lfo.start();
    }

    // Reaction layer: 'oooh', cheering, goal roar
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    this.reactFilter = ctx.createBiquadFilter();
    this.reactFilter.type = 'bandpass';
    this.reactFilter.frequency.value = 800;
    this.reactFilter.Q.value = 0.7;
    this.react = ctx.createGain();
    this.react.gain.value = 0;
    src.connect(this.reactFilter).connect(this.react).connect(this.master);
    src.start();
  }

  setCrowd(level) {
    this.crowdLevel = level;
    if (this.ctx) this.applyMaster();
  }

  applyMaster() {
    const target = this.crowdLevel * (this.ducked ? 0.45 : 1);
    this.master.gain.setTargetAtTime(target, this.ctx.currentTime, 0.25);
  }

  // Lower the crowd while commentary is playing
  duck(on) {
    if (!this.ctx || this.ducked === on) return;
    this.ducked = on;
    this.applyMaster();
  }

  swell({ peak, attack, hold, release, freqFrom, freqTo }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const g = this.react.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(peak, t + attack);
    g.setValueAtTime(peak, t + attack + hold);
    g.linearRampToValueAtTime(0, t + attack + hold + release);
    const f = this.reactFilter.frequency;
    f.cancelScheduledValues(t);
    f.setValueAtTime(freqFrom, t);
    f.exponentialRampToValueAtTime(freqTo, t + attack + hold + release);
  }

  // Rising tension on a shot
  rise() {
    this.swell({ peak: 0.7, attack: 0.25, hold: 0.3, release: 1.2, freqFrom: 700, freqTo: 1100 });
  }

  // Impressed 'oooh' after a save (falling pitch)
  ooh() {
    this.swell({ peak: 0.9, attack: 0.15, hold: 0.5, release: 1.6, freqFrom: 1100, freqTo: 450 });
  }

  // Goal roar
  roar() {
    this.swell({ peak: 1.6, attack: 0.12, hold: 2.6, release: 4.5, freqFrom: 1400, freqTo: 900 });
  }

  whistle(blasts = [0.35]) {
    if (!this.ctx) return;
    let t = this.ctx.currentTime + 0.02;
    for (const len of blasts) {
      const osc = this.ctx.createOscillator();
      osc.frequency.value = 2900;
      const trill = this.ctx.createOscillator();
      trill.frequency.value = 38;
      const trillDepth = this.ctx.createGain();
      trillDepth.gain.value = 140;
      trill.connect(trillDepth).connect(osc.frequency);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.18, t + 0.02);
      g.gain.setValueAtTime(0.18, t + len - 0.04);
      g.gain.linearRampToValueAtTime(0, t + len);
      osc.connect(g).connect(this.ctx.destination);
      osc.start(t);
      trill.start(t);
      osc.stop(t + len);
      trill.stop(t + len);
      t += len + 0.15;
    }
  }

  async decode(arrayBuffer) {
    return this.ctx.decodeAudioData(arrayBuffer);
  }

  // Plays a decoded speech clip; returns { done, stop }
  play(buffer) {
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.speech);
    const done = new Promise((resolve) => (src.onended = resolve));
    src.start();
    return { done, stop: () => { try { src.stop(); } catch {} } };
  }
}
