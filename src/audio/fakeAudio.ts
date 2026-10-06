// A recording stand-in for the Web Audio API, for tests: every node knows its parameters' scheduled calls, so a test can check
// what was scheduled without a browser. Only what the synth uses is modelled.
export class FakeParam {
  value = 0
  calls: [string, ...number[]][] = []
  setValueAtTime(v: number, t: number): this { this.value = v; this.calls.push(['set', v, t]); return this }
  linearRampToValueAtTime(v: number, t: number): this { this.calls.push(['lin', v, t]); return this }
  exponentialRampToValueAtTime(v: number, t: number): this { this.calls.push(['exp', v, t]); return this }
  setTargetAtTime(v: number, t: number, k: number): this { this.value = v; this.calls.push(['target', v, t, k]); return this }
  cancelScheduledValues(t: number): this { this.calls.push(['cancel', t]); return this }
}
export class FakeNode {
  readonly out: FakeNode[] = []
  disconnected = false
  connect<T>(to: T): T { this.out.push(to as unknown as FakeNode); return to }
  disconnect(): void { this.disconnected = true }
}
export class FakeGain extends FakeNode { gain = new FakeParam(); constructor(ctx: FakeContext) { super(); ctx.made.push(this) } }
export class FakeSource extends FakeNode {
  type = 'sine'; loop = false; buffer: unknown = null
  frequency = new FakeParam()
  started: number[] = []
  stopped: number[] = []
  onended: (() => void) | null = null
  readonly kind: string
  constructor(kind: string, ctx: FakeContext) { super(); this.kind = kind; ctx.made.push(this) }
  start(t = 0): void { this.started.push(t) }
  stop(t = 0): void { this.stopped.push(t) }
  /** End the source now (the test plays the part of the audio clock). */
  end(): void { this.onended?.() }
}
export class FakeFilter extends FakeNode { type = 'lowpass'; frequency = new FakeParam(); Q = new FakeParam(); constructor(ctx: FakeContext) { super(); ctx.made.push(this) } }
export class FakeContext {
  currentTime = 0
  sampleRate = 48000
  state = 'running'
  destination = new FakeNode()
  made: FakeNode[] = []
  suspended = 0
  resumed = 0
  createGain(): FakeGain { return new FakeGain(this) }
  createOscillator(): FakeSource { return new FakeSource('osc', this) }
  createBufferSource(): FakeSource { return new FakeSource('noise', this) }
  createBiquadFilter(): FakeFilter { return new FakeFilter(this) }
  createDelay(): FakeNode & { delayTime: FakeParam } { const n = Object.assign(new FakeNode(), { delayTime: new FakeParam() }); this.made.push(n); return n }
  createDynamicsCompressor(): FakeNode & Record<string, FakeParam> { return Object.assign(new FakeNode(), { threshold: new FakeParam(), knee: new FakeParam(), ratio: new FakeParam(), attack: new FakeParam(), release: new FakeParam() }) }
  shapers: { curve: Float32Array | null }[] = []
  createWaveShaper(): FakeNode & { curve: Float32Array | null } { const n = Object.assign(new FakeNode(), { curve: null as Float32Array | null }); this.shapers.push(n); return n }
  createAnalyser(): FakeNode & { fftSize: number } { return Object.assign(new FakeNode(), { fftSize: 0 }) }
  createBuffer(_channels: number, length: number): { getChannelData(): Float32Array } { const data = new Float32Array(length); return { getChannelData: () => data } }
  resume(): Promise<void> { this.state = 'running'; this.resumed++; return Promise.resolve() }
  suspend(): Promise<void> { this.state = 'suspended'; this.suspended++; return Promise.resolve() }
  get sources(): FakeSource[] { return this.made.filter((n): n is FakeSource => n instanceof FakeSource) }
  get gains(): FakeGain[] { return this.made.filter((n): n is FakeGain => n instanceof FakeGain) }
}
export const asContext = (ctx: FakeContext): BaseAudioContext => ctx as unknown as BaseAudioContext
