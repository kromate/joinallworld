// The synth toolkit: a small voice pool over one AudioContext, built from oscillators, noise buffers, filters, envelopes and
// simple FM / AM. Every sound is a recipe (data, see data.ts) played through the same few functions; nothing is loaded from a file.
//
// Bus layout:  recipe voices -> effects bus --\
//                         \-> reverb send ----> mix -> compressor -> soft ceiling -> output (analyser tap)
//              ambience scapes -> ambience bus (own duck) --/
// The ceiling is a tanh shaper scaled to -1 dBFS, so the output cannot clip whatever the recipes add up to.

export type Wave = 'sine' | 'triangle' | 'square' | 'sawtooth' | 'noise'
export type Colour = 'white' | 'pink' | 'brown'
/** One layer of a sound. Time is in seconds, frequency in Hz, gain is a linear peak (0..1). */
export interface Layer {
  w: Wave
  /** Start frequency (oscillators). */
  f?: number
  /** Glide to this frequency over the layer's length. */
  f2?: number
  /** Start offset. */
  at?: number
  /** Attack (default 4 ms); the decay is exponential down to silence at `d`. */
  a?: number
  d: number
  g: number
  /** FM: [modulator ratio, index in multiples of f]; the index falls away with the note. */
  fm?: readonly [number, number]
  /** Filter: [type, hz, q?, hz at the end?]. */
  fl?: readonly [BiquadFilterType, number, number?, number?]
  /** AM: [rate Hz, depth 0..1]. */
  am?: readonly [number, number]
  pan?: number
  /** Reverb send, 0..1. */
  rv?: number
  /** Noise colour (default white). */
  c?: Colour
}
export interface Recipe {
  l: readonly Layer[]
  /** 0 = ambience-level (dropped first), 1 = normal, 2 = important (never stolen by a lower one). */
  pri?: number
  /** Random pitch spread, as a fraction. */
  j?: number
  /** Gain trim for the whole recipe. */
  g?: number
}
export interface PlayOptions { vel?: number; pitch?: number; at?: number; pan?: number; dest?: AudioNode }

/** Effects are mixed this far under full scale, so the default level is gentle. */
export const FX_TRIM = 0.6
export const MAX_VOICES = 16
/** Two plays of one recipe closer than this are one (a double tap must not stack). */
export const MIN_GAP = 0.035
const FLOOR = 0.0001
export const NOISE_RATE = 22050
const NOISE_SECONDS = 2.5

interface Voice { id: string; pri: number; end: number; stop: (now: number) => void }

export class Synth {
  readonly ctx: BaseAudioContext
  readonly recipes: Readonly<Record<string, Recipe>>
  readonly out: GainNode
  readonly fx: GainNode
  readonly amb: GainNode
  readonly ambDuck: GainNode
  readonly fxDuck: GainNode
  readonly verb: GainNode
  readonly analyser: AnalyserNode
  readonly voices = new Set<Voice>()
  private readonly noise: Record<Colour, AudioBuffer>
  private readonly last = new Map<string, number>()
  private baseDuck = 1
  played = 0

  constructor(ctx: BaseAudioContext, recipes: Readonly<Record<string, Recipe>>) {
    this.ctx = ctx
    this.recipes = recipes
    this.out = ctx.createGain()
    const mix = ctx.createGain()
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -14; comp.knee.value = 8; comp.ratio.value = 6; comp.attack.value = 0.004; comp.release.value = 0.2
    const ceiling = ctx.createWaveShaper()
    const curve = new Float32Array(2048)
    for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh((i / (curve.length - 1)) * 4 - 2) * 0.891
    ceiling.curve = curve
    this.analyser = ctx.createAnalyser()
    this.analyser.fftSize = 2048
    this.fx = ctx.createGain(); this.fxDuck = ctx.createGain()
    this.amb = ctx.createGain(); this.ambDuck = ctx.createGain()
    this.fx.connect(this.fxDuck).connect(mix)
    this.amb.connect(this.ambDuck).connect(mix)
    // Reverb without a convolver: three delay lines with a darkening feedback loop.
    this.verb = ctx.createGain()
    const wet = ctx.createGain(); wet.gain.value = 0.5
    for (const time of [0.029, 0.043, 0.061]) {
      const delay = ctx.createDelay(0.2); delay.delayTime.value = time
      const feedback = ctx.createGain(); feedback.gain.value = 0.42
      const tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 2800
      this.verb.connect(delay); delay.connect(tone); tone.connect(feedback); feedback.connect(delay); tone.connect(wet)
    }
    wet.connect(mix)
    mix.connect(comp); comp.connect(ceiling); ceiling.connect(this.out)
    this.out.connect(ctx.destination); this.out.connect(this.analyser)
    const rate = Math.min(ctx.sampleRate, NOISE_RATE)
    this.noise = { white: this.makeNoise('white', rate), pink: this.makeNoise('pink', rate), brown: this.makeNoise('brown', rate) }
  }

  private makeNoise(kind: Colour, rate: number): AudioBuffer {
    const buffer = this.ctx.createBuffer(1, Math.floor(rate * NOISE_SECONDS), rate)
    const data = buffer.getChannelData(0)
    let b0 = 0, b1 = 0, b2 = 0, last = 0
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1
      if (kind === 'white') data[i] = white * 0.6
      else if (kind === 'pink') { b0 = 0.99765 * b0 + white * 0.099046; b1 = 0.963 * b1 + white * 0.2965164; b2 = 0.57 * b2 + white * 1.0526913; data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.2 }
      else { last = (last + 0.02 * white) / 1.02; data[i] = last * 3.2 }
    }
    return buffer
  }

  noiseBuffer(colour: Colour): AudioBuffer { return this.noise[colour] }

  /** The levels of the two buses (0..1), from the settings. */
  setLevels(effects: number, ambience: number): void {
    const t = this.ctx.currentTime
    for (const [bus, level] of [[this.fx, effects * FX_TRIM], [this.amb, ambience]] as const) {
      bus.gain.cancelScheduledValues(t)
      bus.gain.setTargetAtTime(level, t, 0.05)
      // An exponential approach never quite arrives: a muted bus is set to exactly zero once the fade is over.
      if (level === 0) bus.gain.setValueAtTime(0, t + 0.5)
    }
  }

  /** A voice call: ambience nearly silent, interface sounds softened. */
  setCall(on: boolean): void {
    const t = this.ctx.currentTime
    this.baseDuck = on ? 0.03 : 1
    this.ambDuck.gain.cancelScheduledValues(t); this.ambDuck.gain.setTargetAtTime(this.baseDuck, t, 0.2)
    this.fxDuck.gain.setTargetAtTime(on ? 0.4 : 1, t, 0.1)
  }

  /** Ambience steps back for a moment while an effect plays. */
  private duck(t: number, length: number): void {
    const g = this.ambDuck.gain
    g.cancelScheduledValues(t)
    g.setTargetAtTime(this.baseDuck * 0.55, t, 0.03)
    g.setTargetAtTime(this.baseDuck, t + length + 0.1, 0.35)
  }

  /** How many voices are sounding right now. */
  count(): number {
    const now = this.ctx.currentTime
    let n = 0
    for (const voice of this.voices) if (voice.end > now) n++
    return n
  }

  /** Play a recipe. Returns false when it was dropped (unknown, too soon after itself, or no free voice). */
  play(id: string, o: PlayOptions = {}): boolean {
    const recipe = this.recipes[id]
    if (!recipe) return false
    const c = this.ctx, now = c.currentTime, t0 = Math.max(now, o.at ?? now)
    const gap = this.last.get(id)
    if (gap !== undefined && t0 - gap < MIN_GAP) return false
    const pri = recipe.pri ?? 1
    if (this.voices.size >= MAX_VOICES) {
      for (const voice of [...this.voices]) if (voice.end <= now) this.voices.delete(voice)
      if (this.voices.size >= MAX_VOICES) {
        let victim: Voice | null = null
        for (const voice of this.voices) if (!victim || voice.pri < victim.pri || (voice.pri === victim.pri && voice.end < victim.end)) victim = voice
        if (!victim || victim.pri > pri) return false
        victim.stop(now); this.voices.delete(victim)
      }
    }
    this.last.set(id, t0)
    const jitter = recipe.j ? 1 + (Math.random() * 2 - 1) * recipe.j : 1
    const pitch = (o.pitch ?? 1) * jitter, vel = (o.vel ?? 1) * (recipe.g ?? 1)
    const dest = o.dest ?? this.fx
    const sources: AudioScheduledSourceNode[] = [], nodes: AudioNode[] = [], envs: GainNode[] = []
    let end = t0
    for (const layer of recipe.l) end = Math.max(end, this.layer(layer, t0, dest, pitch, vel, o.pan, sources, nodes, envs))
    let left = sources.length
    const voice: Voice = {
      id, pri, end,
      stop: (at) => { for (const env of envs) { env.gain.cancelScheduledValues(at); env.gain.setTargetAtTime(0, at, 0.01) }; for (const s of sources) { try { s.stop(at + 0.03) } catch { /* already stopped */ } } },
    }
    this.voices.add(voice)
    for (const s of sources) s.onended = () => { if (--left <= 0) { for (const node of nodes) node.disconnect(); this.voices.delete(voice) } }
    if (pri >= 1 && dest === this.fx) this.duck(t0, end - t0)
    this.played++
    return true
  }

  private layer(L: Layer, t0: number, dest: AudioNode, pitch: number, vel: number, pan: number | undefined, sources: AudioScheduledSourceNode[], nodes: AudioNode[], envs: GainNode[]): number {
    const c = this.ctx, t = t0 + (L.at ?? 0), end = t + L.d, a = Math.min(L.a ?? 0.004, L.d * 0.5)
    let node: AudioNode
    if (L.w === 'noise') {
      const s = c.createBufferSource(); s.buffer = this.noise[L.c ?? 'white']; s.loop = true
      s.start(t, Math.random() * (NOISE_SECONDS - 0.5)); s.stop(end + 0.02); sources.push(s); node = s
    } else {
      const f = (L.f ?? 440) * pitch, o = c.createOscillator()
      o.type = L.w; o.frequency.setValueAtTime(f, t)
      if (L.f2) o.frequency.exponentialRampToValueAtTime(L.f2 * pitch, end)
      if (L.fm) {
        const m = c.createOscillator(), depth = c.createGain()
        m.frequency.value = f * L.fm[0]
        depth.gain.setValueAtTime(f * L.fm[1], t); depth.gain.exponentialRampToValueAtTime(Math.max(1, f * L.fm[1] * 0.04), end)
        m.connect(depth).connect(o.frequency); m.start(t); m.stop(end + 0.02); sources.push(m); nodes.push(m, depth)
      }
      o.start(t); o.stop(end + 0.02); sources.push(o); node = o
    }
    nodes.push(node)
    if (L.fl) {
      const filter = c.createBiquadFilter(); filter.type = L.fl[0]
      filter.frequency.setValueAtTime(L.fl[1], t); filter.Q.value = L.fl[2] ?? 0.8
      if (L.fl[3]) filter.frequency.exponentialRampToValueAtTime(L.fl[3], end)
      node.connect(filter); node = filter; nodes.push(filter)
    }
    if (L.am) {
      const shaped = c.createGain(), lfo = c.createOscillator(), depth = c.createGain()
      shaped.gain.value = 1 - L.am[1] * 0.5; depth.gain.value = L.am[1] * 0.5; lfo.frequency.value = L.am[0]
      lfo.connect(depth).connect(shaped.gain); lfo.start(t); lfo.stop(end + 0.02); sources.push(lfo)
      node.connect(shaped); node = shaped; nodes.push(shaped, lfo, depth)
    }
    const env = c.createGain(), peak = Math.max(FLOOR * 2, L.g * vel)
    env.gain.setValueAtTime(0, t); env.gain.linearRampToValueAtTime(peak, t + a); env.gain.exponentialRampToValueAtTime(FLOOR, end)
    node.connect(env); nodes.push(env); envs.push(env)
    const where = pan ?? L.pan
    if (where && 'createStereoPanner' in c) {
      const p = c.createStereoPanner(); p.pan.value = where
      env.connect(p); p.connect(dest); nodes.push(p)
    } else env.connect(dest)
    if (L.rv && dest === this.fx) { const send = c.createGain(); send.gain.value = L.rv; env.connect(send); send.connect(this.verb); nodes.push(send) }
    return end + 0.02
  }
}
