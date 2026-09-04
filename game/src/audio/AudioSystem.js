// Lightweight procedural audio layer built on the Web Audio API -- no binary sound
// assets required, everything is synthesized, so it's dependable across hosts.
// Provides: a persistent fluorescent-hum ambient bed, footstep ticks (carpet/water
// aware), a soft "interact" chime, and a low drone that intensifies in dark/flooded
// zones for atmosphere. All nodes are created lazily after the first user gesture to
// respect browser autoplay policies.
export class AudioSystem {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.humGain = null;
    this.droneGain = null;
    this.started = false;
  }

  ensureStarted() {
    if (this.started) return;
    this.started = true;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(this.ctx.destination);

    this._buildHum();
    this._buildDrone();
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  _buildHum() {
    // fluorescent ballast hum: 60Hz + faint 120Hz harmonic, gently amplitude-modulated
    const ctx = this.ctx;
    const gain = ctx.createGain();
    gain.gain.value = 0.028;
    gain.connect(this.master);
    this.humGain = gain;

    const osc1 = ctx.createOscillator();
    osc1.type = 'sine'; osc1.frequency.value = 60;
    const osc2 = ctx.createOscillator();
    osc2.type = 'sine'; osc2.frequency.value = 120;
    const g2 = ctx.createGain(); g2.gain.value = 0.4;

    const lfo = ctx.createOscillator();
    lfo.type = 'sine'; lfo.frequency.value = 5.2;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 0.15;
    lfo.connect(lfoGain);
    lfoGain.connect(gain.gain);

    osc1.connect(gain);
    osc2.connect(g2); g2.connect(gain);
    osc1.start(); osc2.start(); lfo.start();
  }

  _buildDrone() {
    const ctx = this.ctx;
    const gain = ctx.createGain();
    gain.gain.value = 0.0;
    gain.connect(this.master);
    this.droneGain = gain;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 42;
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass'; filt.frequency.value = 180;
    osc.connect(filt); filt.connect(gain);
    osc.start();
  }

  setDroneIntensity(v) {
    if (!this.droneGain) return;
    const target = Math.max(0, Math.min(1, v)) * 0.09;
    this.droneGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.6);
  }

  playFootstep({ running = false, water = false } = {}) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const dur = water ? 0.22 : 0.09;

    const noiseBuf = this._noiseBuffer(dur);
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;

    const filt = ctx.createBiquadFilter();
    filt.type = water ? 'bandpass' : 'lowpass';
    filt.frequency.value = water ? 900 : 500;
    filt.Q.value = water ? 0.8 : 0.5;

    const gain = ctx.createGain();
    const vol = (running ? 0.16 : 0.1) * (water ? 1.4 : 1);
    gain.gain.setValueAtTime(vol, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    src.connect(filt); filt.connect(gain); gain.connect(this.master);
    src.start(now);
    src.stop(now + dur + 0.02);
  }

  playInteract() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(660, now);
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.12);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
    osc.connect(gain); gain.connect(this.master);
    osc.start(now); osc.stop(now + 0.3);
  }

  playFlicker() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = 180 + Math.random() * 60;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.03, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
    osc.connect(gain); gain.connect(this.master);
    osc.start(now); osc.stop(now + 0.1);
  }

  _noiseBuffer(duration) {
    const ctx = this.ctx;
    const len = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      data[i] = (Math.random() * 2 - 1) * (1 - t);
    }
    return buf;
  }
}
