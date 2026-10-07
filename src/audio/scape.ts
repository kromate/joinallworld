// A soundscape: slowly varying noise and hum beds plus sparse random one-shots, scheduled ahead on the audio clock.
// The beds are loops of shared noise, so what keeps them from sounding looped is the drift: every couple of seconds the level
// and the filter of each bed take a new random target. One-shots come at random intervals. Nothing runs per frame.
import type { Colour, Synth } from './synth.ts'

export interface Bed {
  /** Noise colour, or omit for a hum. */
  c?: Colour
  /** Hum frequency (when there is no noise colour) and its wave. */
  hum?: number
  w?: OscillatorType
  fl: readonly [BiquadFilterType, number, number?]
  g: number
  /** Drift: 0..1, how far level and filter wander. */
  v?: number
  /** Slow level modulation: [Hz, depth]. */
  lfo?: readonly [number, number]
  /** Level multiplier at night (default 1). */
  night?: number
}
/** A one-shot recipe at random intervals: [recipe, min s, max s, level, only 'day' | 'night']. */
export type Shot = readonly [string, number, number, number, ('day' | 'night')?]
/** A pattern that repeats on the beat, exactly and without the random level, pan and pitch of a shot (music): [recipe, length s, level, only 'day' | 'night']. */
export type Loop = readonly [string, number, number, ('day' | 'night')?]
export interface ScapeSpec { beds?: readonly Bed[]; shots?: readonly Shot[]; loops?: readonly Loop[] }

/** Beds sit well under the interface sounds: they are the room, not the event. */
const BED_GAIN = 0.3
const DRIFT_STEP = 2.2
const rand = (a: number, b: number): number => a + Math.random() * (b - a)

export class Scape {
  readonly out: GainNode
  private readonly synth: Synth
  private readonly spec: ScapeSpec
  private readonly night: boolean
  private readonly beds: { gain: GainNode; filter: BiquadFilterNode | null; base: number; hz: number; bed: Bed }[] = []
  private readonly sources: AudioScheduledSourceNode[] = []
  private readonly nodes: AudioNode[] = []
  private readonly next: number[]
  private readonly nextLoop: number[]
  private driftAt: number
  private stopped = false

  constructor(synth: Synth, spec: ScapeSpec, dest: AudioNode, night: boolean, fadeIn = 1.5, now = synth.ctx.currentTime) {
    this.synth = synth; this.spec = spec; this.night = night
    const c = synth.ctx
    this.out = c.createGain(); this.out.gain.setValueAtTime(0, now); this.out.gain.linearRampToValueAtTime(1, now + fadeIn)
    this.out.connect(dest)
    for (const bed of spec.beds ?? []) this.addBed(bed, now)
    this.next = (spec.shots ?? []).map(shot => now + rand(0.2, Math.min(shot[2], 4)))
    this.nextLoop = (spec.loops ?? []).map(() => now + 0.15)
    this.driftAt = now + DRIFT_STEP
  }

  private addBed(bed: Bed, now: number): void {
    const c = this.synth.ctx
    let src: AudioScheduledSourceNode
    if (bed.c) {
      const buffer = this.synth.noiseBuffer(bed.c), s = c.createBufferSource()
      s.buffer = buffer; s.loop = true; s.start(now, Math.random() * 1.5); src = s
    } else { const o = c.createOscillator(); o.type = bed.w ?? 'sine'; o.frequency.value = bed.hum ?? 100; o.start(now); src = o }
    this.sources.push(src); this.nodes.push(src)
    const filter = c.createBiquadFilter(); filter.type = bed.fl[0]; filter.frequency.value = bed.fl[1]; filter.Q.value = bed.fl[2] ?? 0.7
    const gain = c.createGain(), base = bed.g * BED_GAIN * (this.night ? bed.night ?? 1 : 1)
    gain.gain.value = base
    src.connect(filter); filter.connect(gain); gain.connect(this.out); this.nodes.push(filter, gain)
    if (bed.lfo) {
      const lfo = c.createOscillator(), depth = c.createGain()
      lfo.frequency.value = bed.lfo[0]; depth.gain.value = base * bed.lfo[1]
      lfo.connect(depth); depth.connect(gain.gain); lfo.start(now); this.sources.push(lfo); this.nodes.push(lfo, depth)
      gain.gain.value = base * (1 - bed.lfo[1] * 0.5)
    }
    this.beds.push({ gain, filter, base, hz: bed.fl[1], bed })
  }

  /** Schedule everything that falls before `until` (audio-clock seconds). */
  fill(until: number): void {
    if (this.stopped) return
    while (this.driftAt < until) {
      for (const b of this.beds) {
        const v = b.bed.v ?? 0
        if (!v || b.bed.lfo) continue
        b.gain.gain.setTargetAtTime(b.base * (1 + (Math.random() * 2 - 1) * v * 0.6), this.driftAt, DRIFT_STEP * 0.5)
        b.filter?.frequency.setTargetAtTime(b.hz * (1 + (Math.random() * 2 - 1) * v * 0.35), this.driftAt, DRIFT_STEP * 0.5)
      }
      this.driftAt += DRIFT_STEP
    }
    const shots = this.spec.shots ?? []
    for (let i = 0; i < shots.length; i++) {
      const shot = shots[i] as Shot, when = shot[4]
      while ((this.next[i] as number) < until) {
        const at = this.next[i] as number
        this.next[i] = at + rand(shot[1], shot[2])
        if (when && (when === 'night') !== this.night) continue
        this.synth.play(shot[0], { at, vel: shot[3] * rand(0.6, 1), pan: rand(-0.6, 0.6), pitch: rand(0.94, 1.06), dest: this.out })
      }
    }
    const loops = this.spec.loops ?? []
    for (let i = 0; i < loops.length; i++) {
      const loop = loops[i] as Loop, when = loop[3]
      while ((this.nextLoop[i] as number) < until) {
        const at = this.nextLoop[i] as number
        this.nextLoop[i] = at + loop[1]
        // A context that was suspended comes back with the beat far behind: skip those bars rather than stack them.
        if (at < this.synth.ctx.currentTime - 0.05) continue
        if (when && (when === 'night') !== this.night) continue
        this.synth.play(loop[0], { at, vel: loop[2], dest: this.out })
      }
    }
  }

  /** Fade out and release everything. */
  stop(fade = 1.2): void {
    if (this.stopped) return
    this.stopped = true
    const c = this.synth.ctx, t = c.currentTime
    this.out.gain.cancelScheduledValues(t); this.out.gain.setValueAtTime(this.out.gain.value, t); this.out.gain.linearRampToValueAtTime(0, t + fade)
    for (const s of this.sources) { try { s.stop(t + fade + 0.05) } catch { /* already stopped */ } }
    const last = this.sources[this.sources.length - 1]
    const release = (): void => { for (const n of this.nodes) n.disconnect(); this.out.disconnect() }
    if (last) last.onended = release; else release()
  }

  get alive(): boolean { return !this.stopped }
}
