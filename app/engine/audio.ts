/**
 * Procedural horror soundscape. Everything is synthesised with Web Audio —
 * no downloads — and positional sounds use HRTF panning in world metres.
 */
type Vec = { x: number; y: number; z: number };
type PlayOptions = { pos?: Vec; volume?: number; variant?: number; from?: Vec };

export type Mood = {
  inside: boolean;
  tension: number;      // 0..1 general dread (monster proximity, low battery)
  chase: boolean;       // revealed creature hunting the visitor nearby
  heart: number;        // 0..1 heartbeat intensity
  powered: boolean;     // alarm + mains hum after the breaker
  car: number;          // 0..1 engine during the arrival
  hidden: boolean;      // muffled inside a locker
  monster: boolean;     // creature player's darker palette
  buzz: Vec | null;     // nearest flickering tube
  buzzLevel: number;
};

export class HorrorAudio {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private amb!: GainNode;
  private music!: GainNode;
  private muffle!: BiquadFilterNode;
  private reverb!: ConvolverNode;
  private send!: GainNode;
  private white!: AudioBuffer;
  private pink!: AudioBuffer;
  private brown!: AudioBuffer;
  private volume = .8;
  private muted = false;
  private mood: Mood = { inside: false, tension: 0, chase: false, heart: 0, powered: false, car: 0, hidden: false, monster: false, buzz: null, buzzLevel: 0 };
  private layers: Record<string, { gain: GainNode; stop: () => void }> = {};
  private nextHeart = 0;
  private nextAmbient = 0;
  private nextChase = 0;
  private chaseLevel = 0;
  private duckUntil = 0;
  private buzzPanner: PannerNode | null = null;
  private buzzGain: GainNode | null = null;
  listener: Vec = { x: 0, y: 0, z: 0 };

  unlock() {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor({ latencyHint: "interactive" });
      this.ctx = ctx;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.knee.value = 12; comp.ratio.value = 4; comp.attack.value = .004; comp.release.value = .25;
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      this.muffle = ctx.createBiquadFilter();
      this.muffle.type = "lowpass"; this.muffle.frequency.value = 20000;
      this.muffle.connect(this.master);
      this.master.connect(comp); comp.connect(ctx.destination);
      this.sfx = ctx.createGain(); this.sfx.connect(this.muffle);
      this.amb = ctx.createGain(); this.amb.gain.value = .9; this.amb.connect(this.muffle);
      this.music = ctx.createGain(); this.music.gain.value = .8; this.music.connect(this.master);
      this.reverb = ctx.createConvolver();
      this.reverb.buffer = this.impulse(3.2, 2.6);
      this.send = ctx.createGain(); this.send.gain.value = .55;
      this.send.connect(this.reverb); this.reverb.connect(this.muffle);
      this.white = this.noise("white"); this.pink = this.noise("pink"); this.brown = this.noise("brown");
      this.startAmbience();
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  setVolume(v: number) { this.volume = v; if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : v, this.ctx!.currentTime, .05); }
  setMuted(m: boolean) { this.muted = m; this.setVolume(this.volume); }
  get isMuted() { return this.muted; }
  get level() { return this.volume; }

  /** Cuts everything for a moment — used by the fake freeze. */
  duck(seconds: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.duckUntil = t + seconds;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(0, t, .01);
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, t + seconds, .02);
  }

  setListener(pos: Vec, forward: Vec) {
    this.listener = pos;
    const l = this.ctx?.listener;
    if (!l) return;
    if (l.positionX) {
      const t = this.ctx!.currentTime;
      l.positionX.setTargetAtTime(pos.x, t, .02); l.positionY.setTargetAtTime(pos.y, t, .02); l.positionZ.setTargetAtTime(pos.z, t, .02);
      l.forwardX.setTargetAtTime(forward.x, t, .02); l.forwardY.setTargetAtTime(forward.y, t, .02); l.forwardZ.setTargetAtTime(forward.z, t, .02);
      l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
    } else {
      (l as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(pos.x, pos.y, pos.z);
      (l as unknown as { setOrientation(...v: number[]): void }).setOrientation(forward.x, forward.y, forward.z, 0, 1, 0);
    }
  }

  setMood(m: Partial<Mood>) {
    Object.assign(this.mood, m);
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.muffle.frequency.setTargetAtTime(this.mood.hidden ? 900 : 20000, t, .15);
    const L = this.layers;
    L.wind?.gain.gain.setTargetAtTime(this.mood.inside ? .015 : .16, t, .8);
    L.drone?.gain.gain.setTargetAtTime(this.mood.inside ? .05 + this.mood.tension * .06 : .02, t, 1.5);
    L.high?.gain.gain.setTargetAtTime(this.mood.inside ? .006 + this.mood.tension * .012 : 0, t, 2);
    L.room?.gain.gain.setTargetAtTime(this.mood.inside ? .035 : .01, t, 1);
    L.hum?.gain.gain.setTargetAtTime(this.mood.powered ? .03 : 0, t, .8);
    L.alarm?.gain.gain.setTargetAtTime(this.mood.powered ? .05 : 0, t, .6);
    L.engine?.gain.gain.setTargetAtTime(this.mood.car * .16, t, .3);
    if (this.buzzGain && this.buzzPanner) {
      this.buzzGain.gain.setTargetAtTime(this.mood.buzz ? this.mood.buzzLevel * .05 : 0, t, .03);
      if (this.mood.buzz) this.place(this.buzzPanner, this.mood.buzz);
    }
  }

  /** Scheduling tick: heartbeat, chase pulse, random distant sounds. */
  update() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running") return;
    const t = ctx.currentTime;
    if (this.mood.heart > .05 && t >= this.nextHeart) {
      const bpm = 62 + this.mood.heart * 88;
      this.heartbeat(this.mood.heart);
      this.nextHeart = t + 60 / bpm;
    }
    this.chaseLevel += ((this.mood.chase ? 1 : 0) - this.chaseLevel) * .04;
    if (this.chaseLevel > .05 && t >= this.nextChase) {
      this.chasePulse(this.chaseLevel);
      this.nextChase = t + .42 - this.chaseLevel * .1;
    }
    if (t >= this.nextAmbient) {
      this.nextAmbient = t + 6 + Math.random() * 12;
      if (t > 4 && t > this.duckUntil) this.ambientEvent();
    }
  }

  /* ------------------------------ building blocks ------------------------------ */
  private noise(kind: "white" | "pink" | "brown") {
    const ctx = this.ctx!;
    const len = ctx.sampleRate * 3;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === "white") d[i] = w;
      else if (kind === "pink") {
        b0 = .99886 * b0 + w * .0555179; b1 = .99332 * b1 + w * .0750759; b2 = .969 * b2 + w * .153852;
        b3 = .8665 * b3 + w * .3104856; b4 = .55 * b4 + w * .5329522; b5 = -.7616 * b5 - w * .016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * .5362) * .11; b6 = w * .115926;
      } else { last = (last + .02 * w) / 1.02; d[i] = last * 3.5; }
    }
    return buf;
  }
  private impulse(seconds: number, decay: number) {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (i < 90 ? i / 90 : 1);
      }
    }
    return buf;
  }
  private place(p: PannerNode, pos: Vec) {
    const t = this.ctx!.currentTime;
    if (p.positionX) { p.positionX.setTargetAtTime(pos.x, t, .015); p.positionY.setTargetAtTime(pos.y, t, .015); p.positionZ.setTargetAtTime(pos.z, t, .015); }
    else (p as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(pos.x, pos.y, pos.z);
  }
  private panner(pos: Vec, ref = 1.6) {
    const p = this.ctx!.createPanner();
    p.panningModel = "HRTF"; p.distanceModel = "inverse"; p.refDistance = ref; p.rolloffFactor = 1.25; p.maxDistance = 60;
    if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; }
    else (p as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(pos.x, pos.y, pos.z);
    return p;
  }
  /** Routes a voice to the mix (optionally positioned) with a reverb send. */
  private out(node: AudioNode, opts: { pos?: Vec; send?: number; bus?: GainNode; ref?: number } = {}) {
    const bus = opts.bus ?? this.sfx;
    let tail: AudioNode = node;
    if (opts.pos) { const p = this.panner(opts.pos, opts.ref); node.connect(p); tail = p; }
    tail.connect(bus);
    if ((opts.send ?? .3) > 0) { const g = this.ctx!.createGain(); g.gain.value = opts.send ?? .3; tail.connect(g); g.connect(this.send); }
    return tail;
  }
  private env(g: GainNode, at: number, attack: number, peak: number, release: number, hold = 0) {
    g.gain.setValueAtTime(.0001, at);
    g.gain.exponentialRampToValueAtTime(Math.max(.0002, peak), at + attack);
    if (hold) g.gain.setValueAtTime(Math.max(.0002, peak), at + attack + hold);
    g.gain.exponentialRampToValueAtTime(.0001, at + attack + hold + release);
    return at + attack + hold + release;
  }
  private tone(type: OscillatorType, from: number, to: number, at: number, dur: number, peak: number, opts: { pos?: Vec; send?: number; attack?: number; filter?: number; bus?: GainNode } = {}) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(from, at);
    o.frequency.exponentialRampToValueAtTime(Math.max(15, to), at + dur);
    let head: AudioNode = o;
    if (opts.filter) { const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = opts.filter; o.connect(f); head = f; }
    head.connect(g);
    const end = this.env(g, at, opts.attack ?? .01, peak, Math.max(.02, dur - (opts.attack ?? .01)));
    this.out(g, opts);
    o.start(at); o.stop(end + .05);
    return o;
  }
  private burst(buf: AudioBuffer, at: number, dur: number, peak: number, filter: { type: BiquadFilterType; freq: number; q?: number; to?: number }, opts: { pos?: Vec; send?: number; attack?: number; rate?: number; bus?: GainNode; ref?: number } = {}) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = buf; src.loop = true; src.playbackRate.value = opts.rate ?? 1;
    f.type = filter.type; f.frequency.setValueAtTime(filter.freq, at); f.Q.value = filter.q ?? .8;
    if (filter.to) f.frequency.exponentialRampToValueAtTime(filter.to, at + dur);
    src.connect(f); f.connect(g);
    const end = this.env(g, at, opts.attack ?? .005, peak, Math.max(.02, dur - (opts.attack ?? .005)));
    this.out(g, opts);
    src.start(at, Math.random() * 2); src.stop(end + .05);
    return { src, filter: f, gain: g };
  }
  private loop(name: string, build: (out: GainNode) => () => void, bus: GainNode) {
    const g = this.ctx!.createGain();
    g.gain.value = 0;
    g.connect(bus);
    const stop = build(g);
    this.layers[name] = { gain: g, stop };
  }

  private startAmbience() {
    const ctx = this.ctx!;
    this.loop("drone", g => {
      const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 150; f.Q.value = 3;
      const lfo = ctx.createOscillator(), lfoGain = ctx.createGain();
      lfo.frequency.value = .05; lfoGain.gain.value = 60; lfo.connect(lfoGain); lfoGain.connect(f.frequency);
      const oscs = [43.65, 44.2, 65.4].map(freq => { const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = freq; o.connect(f); o.start(); return o; });
      f.connect(g); lfo.start();
      return () => { oscs.forEach(o => o.stop()); lfo.stop(); };
    }, this.amb);
    this.loop("high", g => {
      const o = ctx.createOscillator(), o2 = ctx.createOscillator(), trem = ctx.createOscillator(), tg = ctx.createGain(), mix = ctx.createGain();
      o.type = "sine"; o.frequency.value = 1864; o2.type = "sine"; o2.frequency.value = 1975;
      trem.frequency.value = .3; tg.gain.value = .5; mix.gain.value = .5;
      trem.connect(tg); tg.connect(mix.gain);
      o.connect(mix); o2.connect(mix); mix.connect(g);
      o.start(); o2.start(); trem.start();
      return () => { o.stop(); o2.stop(); trem.stop(); };
    }, this.amb);
    this.loop("room", g => {
      const s = ctx.createBufferSource(), f = ctx.createBiquadFilter();
      s.buffer = this.brown; s.loop = true; f.type = "lowpass"; f.frequency.value = 380;
      s.connect(f); f.connect(g); s.start();
      return () => s.stop();
    }, this.amb);
    this.loop("wind", g => {
      const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), lfo = ctx.createOscillator(), lg = ctx.createGain();
      s.buffer = this.pink; s.loop = true; f.type = "bandpass"; f.frequency.value = 500; f.Q.value = 1.4;
      lfo.frequency.value = .09; lg.gain.value = 320; lfo.connect(lg); lg.connect(f.frequency);
      s.connect(f); f.connect(g); s.start(); lfo.start();
      return () => { s.stop(); lfo.stop(); };
    }, this.amb);
    this.loop("hum", g => {
      const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 400;
      const oscs = [50, 100, 150].map((freq, i) => { const o = ctx.createOscillator(); o.type = i ? "sine" : "sawtooth"; o.frequency.value = freq; o.connect(f); o.start(); return o; });
      f.connect(g);
      return () => oscs.forEach(o => o.stop());
    }, this.amb);
    this.loop("alarm", g => {
      const o = ctx.createOscillator(), lfo = ctx.createOscillator(), lg = ctx.createGain(), f = ctx.createBiquadFilter();
      o.type = "square"; o.frequency.value = 780; lfo.type = "square"; lfo.frequency.value = .8; lg.gain.value = 150;
      lfo.connect(lg); lg.connect(o.frequency); f.type = "bandpass"; f.frequency.value = 900; f.Q.value = 2;
      o.connect(f); f.connect(g);
      const s = ctx.createGain(); s.gain.value = .6; g.connect(s); s.connect(this.send);
      o.start(); lfo.start();
      return () => { o.stop(); lfo.stop(); };
    }, this.amb);
    this.loop("engine", g => {
      const o = ctx.createOscillator(), o2 = ctx.createOscillator(), f = ctx.createBiquadFilter(), n = ctx.createBufferSource(), nf = ctx.createBiquadFilter(), ng = ctx.createGain();
      o.type = "sawtooth"; o.frequency.value = 38; o2.type = "square"; o2.frequency.value = 76.5;
      f.type = "lowpass"; f.frequency.value = 220;
      n.buffer = this.brown; n.loop = true; nf.type = "lowpass"; nf.frequency.value = 500; ng.gain.value = .6;
      o.connect(f); o2.connect(f); f.connect(g); n.connect(nf); nf.connect(ng); ng.connect(g);
      o.start(); o2.start(); n.start();
      return () => { o.stop(); o2.stop(); n.stop(); };
    }, this.amb);
    // Buzzing fluorescent tube near the listener.
    this.buzzPanner = this.panner({ x: 0, y: 3, z: 0 }, 1);
    this.buzzGain = ctx.createGain(); this.buzzGain.gain.value = 0;
    const bz = ctx.createOscillator(), bf = ctx.createBiquadFilter();
    bz.type = "sawtooth"; bz.frequency.value = 100; bf.type = "bandpass"; bf.frequency.value = 1200; bf.Q.value = 1.5;
    bz.connect(bf); bf.connect(this.buzzGain); this.buzzGain.connect(this.buzzPanner); this.buzzPanner.connect(this.amb);
    bz.start();
  }

  private heartbeat(k: number) {
    const t = this.ctx!.currentTime + .01;
    for (const [d, a] of [[0, 1], [.16, .7]] as const) {
      this.tone("sine", 62, 38, t + d, .16, .28 * k * a, { send: 0, bus: this.music });
      this.burst(this.brown, t + d, .08, .06 * k * a, { type: "lowpass", freq: 120 }, { send: 0, bus: this.music });
    }
  }
  private chasePulse(k: number) {
    const t = this.ctx!.currentTime + .01;
    this.tone("sine", 70, 32, t, .3, .35 * k, { send: .05, bus: this.music });
    this.burst(this.white, t, .06, .04 * k, { type: "highpass", freq: 5000 }, { send: .1, bus: this.music });
    if (Math.random() < .5) for (const f of [233, 247, 349]) this.tone("sawtooth", f, f * .98, t, .4, .018 * k, { filter: 1400, send: .5, bus: this.music, attack: .05 });
  }
  private ambientEvent() {
    const L = this.listener;
    const a = Math.random() * Math.PI * 2, d = 8 + Math.random() * 14;
    const pos = { x: L.x + Math.cos(a) * d, y: 1 + Math.random() * 2, z: L.z + Math.sin(a) * d };
    const t = this.ctx!.currentTime + .05;
    const roll = Math.random();
    if (!this.mood.inside) { this.tone("sine", 900, 850, t, 1.3, .015, { pos, send: .8, attack: .3 }); return; }
    if (roll < .2) { // metal clang
      for (const f of [310, 467, 733]) this.tone("triangle", f, f * .97, t, 1.6, .04, { pos, send: .9 });
      this.burst(this.white, t, .08, .08, { type: "bandpass", freq: 1500 }, { pos, send: .9 });
    } else if (roll < .38) { // drips
      for (let i = 0; i < 4; i++) this.tone("sine", 1400 + Math.random() * 600, 700, t + i * (.5 + Math.random()), .08, .03, { pos, send: .9 });
    } else if (roll < .55) { // door creak
      const c = this.tone("sawtooth", 180 + Math.random() * 80, 120, t, 1.6, .025, { pos, send: .9, attack: .2, filter: 900 });
      c.detune.setValueAtTime(0, t); c.detune.linearRampToValueAtTime(300, t + .8); c.detune.linearRampToValueAtTime(-200, t + 1.6);
    } else if (roll < .7) { // footsteps somewhere else
      for (let i = 0; i < 5; i++) this.step({ x: pos.x + i * .5, y: 0, z: pos.z }, false, .45, t + i * .52);
    } else if (roll < .82) { // thud
      this.tone("sine", 70, 35, t, .5, .12, { pos, send: .9 });
      this.burst(this.brown, t, .3, .1, { type: "lowpass", freq: 300 }, { pos, send: .8 });
    } else if (roll < .93) { // distant whisper
      this.whisper(pos, .5, 1.6);
    } else { // far scream
      const o = this.tone("sawtooth", 740, 520, t, 1.4, .018, { pos, send: 1, attack: .1, filter: 1800 });
      o.frequency.setValueAtTime(740, t); o.frequency.linearRampToValueAtTime(880, t + .3); o.frequency.exponentialRampToValueAtTime(400, t + 1.4);
    }
  }

  step(pos: Vec | null, heavy: boolean, volume = 1, at?: number) {
    if (!this.ctx) return;
    const t = at ?? this.ctx.currentTime + .005;
    const opts = { pos: pos ?? undefined, send: pos ? .35 : .12, bus: this.sfx };
    const pitch = .85 + Math.random() * .3;
    if (heavy) {
      this.tone("sine", 60 * pitch, 32, t, .22, .45 * volume, opts);
      this.burst(this.brown, t, .18, .3 * volume, { type: "lowpass", freq: 420 }, opts);
      if (Math.random() < .35) this.burst(this.white, t + .02, .12, .05 * volume, { type: "bandpass", freq: 2400, q: 4 }, opts);
    } else {
      this.burst(this.white, t, .07, .11 * volume, { type: "bandpass", freq: 900 * pitch, q: 1.2 }, opts);
      this.tone("sine", 95 * pitch, 50, t, .07, .16 * volume, opts);
    }
  }

  private whisper(pos: Vec | undefined, volume: number, dur = 2.2) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + .02;
    const src = ctx.createBufferSource(); src.buffer = this.white; src.loop = true;
    const g = ctx.createGain(); g.gain.value = 0;
    const bands = [700, 1500, 2600].map(freq => { const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = freq; f.Q.value = 6; src.connect(f); f.connect(g); return f; });
    // Syllable gating with jumping formants reads as unintelligible speech.
    let time = t;
    while (time < t + dur) {
      const len = .07 + Math.random() * .16;
      const peak = volume * (.08 + Math.random() * .12);
      g.gain.setTargetAtTime(peak, time, .015);
      g.gain.setTargetAtTime(peak * .1, time + len, .02);
      bands.forEach((f, i) => f.frequency.setTargetAtTime([500, 1200, 2400][i] * (.7 + Math.random() * .8), time, .02));
      time += len + Math.random() * .08;
    }
    g.gain.setTargetAtTime(0, time, .05);
    this.out(g, { pos, send: .5, ref: 1.2 });
    src.start(t); src.stop(time + .4);
  }

  private scream(volume: number, pos?: Vec, long = false) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + .005;
    const dur = long ? 2.1 : 1.3;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * 6); }
    shaper.curve = curve;
    const g = ctx.createGain();
    shaper.connect(g);
    for (const [base, detune] of [[620, 0], [930, 15], [455, -20], [1240, 8]] as const) {
      const o = ctx.createOscillator(), vib = ctx.createOscillator(), vg = ctx.createGain();
      o.type = "sawtooth"; o.detune.value = detune;
      o.frequency.setValueAtTime(base * .6, t); o.frequency.exponentialRampToValueAtTime(base * 1.15, t + .12); o.frequency.exponentialRampToValueAtTime(base * .7, t + dur);
      vib.frequency.value = 23 + Math.random() * 9; vg.gain.value = base * .06; vib.connect(vg); vg.connect(o.frequency);
      const og = ctx.createGain(); og.gain.value = .25;
      o.connect(og); og.connect(shaper);
      o.start(t); vib.start(t); o.stop(t + dur + .05); vib.stop(t + dur + .05);
    }
    this.env(g, t, .01, volume * .5, dur - .01, .1);
    this.out(g, { pos, send: .4 });
    this.burst(this.white, t, dur * .8, volume * .35, { type: "bandpass", freq: 2200, q: .6, to: 900 }, { pos, send: .4 });
    this.tone("sine", 90, 30, t, dur, volume * .6, { pos, send: .2 });
  }

  play(type: string, opts: PlayOptions = {}) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + .01;
    const pos = opts.pos, v = opts.volume ?? 1;
    switch (type) {
      case "whisper": this.whisper(pos, 1.1 * v, 2.4); break;
      case "breath": {
        for (const [d, f] of [[0, 500], [1.1, 380]] as const) this.burst(this.pink, t + d, 1.0, .14 * v, { type: "bandpass", freq: f, q: 1.2, to: f * 1.6 }, { pos, send: .15, attack: .35 });
        break;
      }
      case "footsteps": {
        if (!pos) { for (let i = 0; i < 7; i++) this.step(null, false, .6 * v, t + i * .46); break; }
        const from = opts.from ?? pos;
        for (let i = 0; i < 7; i++) {
          const k = i / 6;
          this.step({ x: from.x + (pos.x - from.x) * k, y: 0, z: from.z + (pos.z - from.z) * k }, opts.variant === 1, .9 * v, t + i * .46);
        }
        break;
      }
      case "doorSlam": {
        this.burst(this.white, t, .45, .5 * v, { type: "lowpass", freq: 1600, to: 200 }, { pos, send: 1 });
        this.tone("sine", 75, 30, t, .6, .7 * v, { pos, send: .8 });
        for (const f of [340, 525, 810]) this.tone("triangle", f, f * .96, t, .9, .05 * v, { pos, send: 1 });
        break;
      }
      case "knock": {
        for (let i = 0; i < 3; i++) {
          this.tone("sine", 130, 70, t + i * .24, .12, .4 * v, { pos, send: .6 });
          this.burst(this.brown, t + i * .24, .08, .3 * v, { type: "bandpass", freq: 380, q: 2 }, { pos, send: .6 });
        }
        break;
      }
      case "laugh": {
        // A music box winding down.
        const notes = [659, 587, 523, 494, 523, 440, 494, 392, 440, 330, 349, 330];
        let at = t;
        notes.forEach((n, i) => {
          const slow = 1 + i * .09;
          this.tone("triangle", n, n * .995, at, .6, .09 * v, { pos, send: .9 });
          this.tone("sine", n * 2.01, n * 2, at, .4, .025 * v, { pos, send: .9 });
          at += .26 * slow;
        });
        break;
      }
      case "phone": {
        for (let ring = 0; ring < 3; ring++) {
          const start = t + ring * 2.1;
          const o = ctx.createOscillator(), am = ctx.createOscillator(), amg = ctx.createGain(), g = ctx.createGain();
          o.type = "triangle"; o.frequency.value = 880; am.type = "square"; am.frequency.value = 22; amg.gain.value = .5;
          am.connect(amg); amg.connect(g.gain);
          o.connect(g); this.env(g, start, .01, .09 * v, .1, 1.0);
          this.out(g, { pos, send: .7 });
          o.start(start); am.start(start); o.stop(start + 1.3); am.stop(start + 1.3);
        }
        break;
      }
      case "scare": this.scream(1.1 * v); break;
      case "caught": this.scream(1.3 * v, undefined, true); this.burst(this.white, t, .3, .5, { type: "lowpass", freq: 3000 }, { send: .5 }); break;
      case "reveal": {
        for (let i = 0; i < 14; i++) this.burst(this.white, t + i * .045 + Math.random() * .02, .03, .2 * v, { type: "bandpass", freq: 1800 + Math.random() * 1500, q: 3 }, { pos, send: .4 });
        const g = this.tone("sawtooth", 55, 90, t + .3, 1.1, .35 * v, { pos, send: .6, filter: 500, attack: .2 });
        g.detune.setValueAtTime(0, t);
        this.scream(.55 * v, pos);
        break;
      }
      case "growl": {
        const o = this.tone("sawtooth", 58 + Math.random() * 10, 48, t, 1.4, .3 * v, { pos, send: .5, filter: 420, attack: .25 });
        const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 9; lg.gain.value = 18; lfo.connect(lg); lg.connect(o.frequency); lfo.start(t); lfo.stop(t + 1.5);
        this.burst(this.brown, t, 1.3, .15 * v, { type: "lowpass", freq: 600 }, { pos, send: .4, attack: .3 });
        break;
      }
      case "lunge": this.burst(this.white, t, .35, .3 * v, { type: "bandpass", freq: 800, to: 3000 }, { pos, send: .3 }); this.play("growl", { pos, volume: v }); break;
      case "flare": {
        this.tone("sine", 1800, 7000, t, .5, .07 * v, { send: .2, attack: .4 });
        this.burst(this.white, t + .5, .25, .35 * v, { type: "highpass", freq: 1200 }, { send: .6 });
        this.tone("sine", 120, 40, t + .5, .3, .3 * v, { send: .3 });
        break;
      }
      case "stun": this.scream(.6 * v, pos); break;
      case "clue": {
        for (let i = 0; i < 5; i++) this.burst(this.white, t + i * .05, .06, .06 * v, { type: "bandpass", freq: 3200, q: 1 }, { send: .1 });
        this.tone("sine", 110, 108, t + .1, 2.2, .12 * v, { send: .8, attack: .05 });
        this.tone("sine", 116.5, 115, t + .1, 2.2, .09 * v, { send: .8, attack: .05 });
        this.tone("triangle", 880, 870, t + .1, 1.6, .03 * v, { send: .9 });
        break;
      }
      case "allClues": for (const f of [98, 104, 147, 156]) this.tone("sawtooth", f, f, t, 3, .04 * v, { filter: 900, send: 1, attack: .6 }); break;
      case "battery": this.burst(this.white, t, .03, .2 * v, { type: "bandpass", freq: 2000, q: 3 }, { send: .1 }); this.tone("sine", 1320, 1320, t + .05, .25, .05 * v, { send: .3 }); break;
      case "power": {
        this.burst(this.brown, t, .25, .8 * v, { type: "lowpass", freq: 900 }, { send: .8 });
        this.tone("sine", 60, 40, t, .4, .7 * v, { send: .6 });
        this.tone("sawtooth", 30, 100, t + .2, 2.4, .12 * v, { filter: 600, send: .8, attack: 1.4 });
        break;
      }
      case "escape": {
        this.burst(this.pink, t, 3, .3 * v, { type: "bandpass", freq: 600, to: 300 }, { send: .4, attack: .4 });
        for (const f of [196, 247, 294, 392]) this.tone("triangle", f, f, t + .3, 4, .04 * v, { send: 1, attack: 1 });
        break;
      }
      case "glitch": {
        for (let i = 0; i < 9; i++) this.tone("square", 80 + Math.random() * 1600, 60 + Math.random() * 400, t + i * .035, .05, .06 * v, { send: 0 });
        this.burst(this.white, t, .25, .2 * v, { type: "highpass", freq: 3000 }, { send: 0 });
        break;
      }
      case "unglitch": this.burst(this.white, t, .18, .25 * v, { type: "bandpass", freq: 1500 }, { send: .2 }); this.scream(.35 * v); break;
      case "blackout": {
        this.tone("sawtooth", 140, 25, t, 1.4, .1 * v, { filter: 700, send: .7 });
        this.burst(this.white, t, .05, .2 * v, { type: "bandpass", freq: 2500 }, { send: .3 });
        break;
      }
      case "flicker": {
        for (let i = 0; i < 8; i++) this.burst(this.white, t + i * (.08 + Math.random() * .12), .02, .12 * v, { type: "bandpass", freq: 3000, q: 2 }, { send: .1 });
        break;
      }
      case "torch": this.burst(this.white, t, .025, .18 * v, { type: "bandpass", freq: 2600, q: 3 }, { send: .05 }); break;
      case "shadow": {
        this.tone("sine", 70, 24, t, 1.6, .5 * v, { send: .7 });
        this.burst(this.pink, t, .9, .2 * v, { type: "lowpass", freq: 300, to: 3000 }, { send: .6, attack: .8 });
        break;
      }
      case "phantom": {
        this.tone("sine", 880, 1170, t, .35, .05 * v, { pos, send: .8, attack: .05 });
        this.tone("sine", 1170, 880, t + .42, .45, .05 * v, { pos, send: .8, attack: .05 });
        break;
      }
      case "radio": {
        this.tone("sine", 1000, 1000, t, .08, .06 * v, { send: 0 });
        this.burst(this.white, t + .08, .5, .12 * v, { type: "bandpass", freq: 2000, q: .7 }, { send: 0 });
        break;
      }
      case "radioEnd": this.burst(this.white, t, .25, .1 * v, { type: "bandpass", freq: 1800, q: .7 }, { send: 0 }); this.tone("sine", 800, 800, t + .25, .07, .05 * v, { send: 0 }); break;
      case "lock": {
        for (let i = 0; i < 3; i++) this.burst(this.white, t + i * .12, .1, .25 * v, { type: "bandpass", freq: 1800 + i * 300, q: 4 }, { pos, send: .8 });
        this.tone("sine", 90, 40, t, .4, .5 * v, { pos, send: .8 });
        break;
      }
      case "search": {
        const s = this.tone("sawtooth", 500, 900, t, .35, .12 * v, { pos, send: .6, filter: 3000 });
        s.detune.value = 30;
        this.burst(this.white, t + .3, .2, .45 * v, { type: "lowpass", freq: 2200 }, { pos, send: .9 });
        this.tone("sine", 80, 40, t + .3, .3, .5 * v, { pos, send: .8 });
        break;
      }
      case "hide": case "unhide": {
        const c = this.tone("sawtooth", 260, 200, t, .5, .03 * v, { pos, send: .4, filter: 1500, attack: .1 });
        c.detune.value = 10;
        this.burst(this.white, t + .45, .1, .2 * v, { type: "bandpass", freq: 1400, q: 2 }, { pos, send: .5 });
        break;
      }
      case "creak": {
        const c = this.tone("sawtooth", 210 + Math.random() * 60, 150, t, 1.1, .03 * v, { pos, send: .7, filter: 1100, attack: .15 });
        c.detune.setValueAtTime(-100, t); c.detune.linearRampToValueAtTime(250, t + 1.1);
        break;
      }
      case "stinger": {
        for (const f of [110, 116.5, 155.6, 233, 311]) this.tone("sawtooth", f, f * .98, t, 2.2, .06 * v, { filter: 2400, send: 1, bus: this.music });
        this.burst(this.white, t, .5, .25 * v, { type: "highpass", freq: 2500 }, { send: 1, bus: this.music });
        this.tone("sine", 55, 30, t, 1.8, .6 * v, { send: .5, bus: this.music });
        break;
      }
      case "separate": {
        this.burst(this.brown, t, .5, 1 * v, { type: "lowpass", freq: 700 }, { send: 1 });
        this.tone("sine", 50, 25, t, 1.2, .9 * v, { send: .8 });
        this.tone("sawtooth", 120, 20, t + .1, 1.6, .1 * v, { filter: 500, send: 1 });
        break;
      }
      case "wake": this.tone("sine", 3800, 3600, t, 3.5, .03 * v, { send: .3, attack: .1 }); this.tone("sine", 60, 50, t, 2, .2 * v, { send: .5 }); break;
      case "hurt": this.burst(this.brown, t, .4, .6 * v, { type: "lowpass", freq: 500 }, { send: .3 }); break;
      case "start": this.tone("sine", 72, 43, t, 2.4, .1 * v, { send: .8, attack: .6 }); break;
      case "ui": this.tone("sine", 660, 660, t, .06, .03 * v, { send: 0 }); break;
      case "pant": {
        this.burst(this.pink, t, .32, .09 * v, { type: "bandpass", freq: 900, q: 1.3, to: 1300 }, { send: .05, attack: .08 });
        this.burst(this.pink, t + .42, .3, .07 * v, { type: "bandpass", freq: 700, q: 1.3, to: 500 }, { send: .05, attack: .06 });
        break;
      }
      case "candle": {
        for (let i = 0; i < 3; i++) this.burst(this.white, t + Math.random() * .6, .015, .05 * v, { type: "highpass", freq: 3500 }, { pos, send: .2, ref: .8 });
        this.burst(this.pink, t, .9, .012 * v, { type: "bandpass", freq: 900, q: .6 }, { pos, send: .1, attack: .3, ref: .8 });
        break;
      }
      case "write": this.burst(this.pink, t, 1.2, .1 * v, { type: "bandpass", freq: 700, q: 2, to: 400 }, { pos, send: .6, attack: .2 }); this.tone("sine", 60, 40, t, 1.2, .2 * v, { send: .5 }); break;
      default: break;
    }
  }

  /** Browser speech, pitched down and slowed; the creature's "voice" trick. */
  speak(text: string) {
    if (typeof speechSynthesis === "undefined" || this.muted) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "ru-RU"; u.pitch = .05; u.rate = .72; u.volume = Math.min(1, this.volume * .9);
      const voice = speechSynthesis.getVoices().find(v => v.lang.startsWith("ru"));
      if (voice) u.voice = voice;
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    } catch { /* speech is optional */ }
  }

  dispose() {
    for (const layer of Object.values(this.layers)) { try { layer.stop(); } catch { /* already stopped */ } }
    void this.ctx?.close();
    this.ctx = null;
  }
}
