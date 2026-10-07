// The director turns what the game reports into sound: it owns the synth, the soundscapes (place, weather, vehicle, activity),
// the footsteps and the rules of the mix. It knows nothing about the browser beyond the audio context it is given, so the same
// code plays live and renders offline (the sound board and the measurements use that).
import type { CitySound } from '../types/content.ts'
import { lagosTime } from '../game/clock.ts'
import { timeBand } from '../game/world-time.ts'
import { levelFor } from './levels.ts'
import type { SoundSettings } from './settings.ts'
import { ACTIVITIES, COMMANDS, EVENTS, INDOORS, KEY_KINDS, MOMENTS, MOTIFS, PLACES, RECIPES, RIDES, SCAPES, STEPS, SURFACES, ZINC, type Moment } from './data.ts'
import { Scape, type ScapeSpec } from './scape.ts'
import { Synth, type PlayOptions } from './synth.ts'

/** What the game looks like to the director: plain values, copied out of the life and its view. */
export interface Seen {
  /** Identity of the life (a different one resets the baselines silently). */
  life: string
  city: string
  location: string
  /** 'venue' or 'map' (a trip is watched on the map). */
  mode: string
  act: { kind: string; id: string; mode?: string } | null
  tags: readonly string[]
  raining: boolean
  /** The power is out here (a NEPA cut): the generators come on by day too. Absent until the game reports it. */
  outage?: boolean
  /** Newest first. */
  ledger: readonly { at: number; amount: number; reason: string }[]
  /** Server time, ms. */
  now: number
}
export interface Deps {
  settings: () => SoundSettings
  soundOf: (city: string) => CitySound | undefined
  /** The scene kind of a venue ('market', 'park', …), or '' when unknown. */
  kindOf: (city: string, venue: string) => string
  /** The look of a venue's scene ('church', 'mosque', 'bus-park', …), or '' when it has none. */
  variantOf?: (city: string, venue: string) => string
  /** Wall clock, ms. */
  now: () => number
  every: (run: () => void, ms: number) => () => void
  after: (run: () => void, ms: number) => () => void
  /** True for a live context (it can be suspended); false when rendering offline. */
  live: boolean
}
type Chan = 'place' | 'moment' | 'rain' | 'ride' | 'act'
const CHANNELS: readonly Chan[] = ['place', 'moment', 'rain', 'ride', 'act']
const AMBIENT: ReadonlySet<Chan> = new Set<Chan>(['place', 'moment', 'rain'])
export const IDLE_MS = 180_000
const TICK_MS = 1000
const AHEAD = 2.6
const FADE = 1.4
const hourOf = (ms: number): number => new Date(ms + 3_600_000).getUTCHours()
const monthOf = (ms: number): number => new Date(ms + 3_600_000).getUTCMonth()
/** Dark between 19:00 and 06:00 in Nigeria. */
export const isNight = (ms: number): boolean => { const h = hourOf(ms); return h >= 19 || h < 6 }

/** What a place is like right now, for the time of day. */
export interface PlaceNow { kind: string; variant: string; now: number; outage: boolean }
/** The scape the time of day adds to a place (see MOMENTS), or '' when it adds none: the first rule that fits. */
export function pickMoment(at: PlaceNow, rules: readonly Moment[] = MOMENTS): string {
  if (!at.kind) return ''
  const t = lagosTime(at.now), band = timeBand(at.now), hour = t.minuteOfDay / 60
  for (const rule of rules) {
    if (!rule.kinds.includes(at.kind)) continue
    if (rule.variants && !rule.variants.includes(at.variant)) continue
    if (rule.except?.includes(at.variant)) continue
    if (rule.bands && !rule.bands.includes(band)) continue
    if (rule.days && !rule.days.includes(t.weekday)) continue
    if (rule.hours && !rule.hours.some(([from, to]) => hour >= from && hour < to)) continue
    if (rule.outage && !at.outage) continue
    return rule.scape
  }
  return ''
}

export class Director {
  readonly synth: Synth
  private readonly ctx: BaseAudioContext
  private readonly deps: Deps
  private readonly trims = {} as Record<Chan, GainNode>
  private readonly cur: Record<Chan, { key: string; scape: Scape } | null> = { place: null, moment: null, rain: null, ride: null, act: null }
  private seen: Seen | null = null
  private hidden = false
  private idle = false
  private lastInput: number
  private awake = true
  private stopTick: (() => void) | null = null
  private ticks = 0
  private night = false
  private ledgerAt = 0
  private muteSpendUntil = 0
  private actEnd: string | undefined
  private actKey = ''
  private actScape = ''
  private tripKey = ''
  private tripMode = ''
  // footsteps
  private at: { x: number; z: number; t: number } | null = null
  private speed = 0
  private movingUntil = 0
  private stepping = false
  private foot = 1
  private stopStep: (() => void) | null = null

  constructor(ctx: BaseAudioContext, deps: Deps) {
    this.ctx = ctx; this.deps = deps
    this.synth = new Synth(ctx, RECIPES)
    this.lastInput = deps.now()
    for (const chan of CHANNELS) { const trim = ctx.createGain(); trim.connect(AMBIENT.has(chan) ? this.synth.amb : this.synth.fx); this.trims[chan] = trim }
    this.applySettings()
  }

  // ---- settings, sleep ---------------------------------------------------------------------------------------------------
  /** Read the settings again: levels of the buses, and whether anything should be sounding at all. */
  applySettings(): void {
    const s = this.deps.settings()
    this.synth.setLevels(levelFor(s, 'effects'), levelFor(s, 'ambience'))
    this.refresh()
  }
  setCall(on: boolean): void { this.synth.setCall(on) }
  setHidden(on: boolean): void { this.hidden = on; this.refresh() }
  /** The player did something: not idle. */
  touch(): void { this.lastInput = this.deps.now(); if (this.idle) { this.idle = false; this.refresh() } }
  get sleeping(): boolean { return !this.awake }

  private refresh(): void {
    const s = this.deps.settings()
    const audible = levelFor(s, 'effects') > 0 || levelFor(s, 'ambience') > 0
    const awake = !this.hidden && !this.idle && audible
    if (awake !== this.awake) {
      this.awake = awake
      if (awake) { this.resume(); this.startTick() }
      else { this.stopTick?.(); this.stopTick = null; this.stopSteps(); if (this.deps.live) this.deps.after(() => { if (!this.awake) this.suspend() }, 600) }
    }
    if (awake && !this.stopTick) this.startTick()
    this.sync()
  }
  private resume(): void { const c = this.ctx as AudioContext; if (this.deps.live && c.state !== 'running') c.resume().catch(() => undefined) }
  private suspend(): void { const c = this.ctx as AudioContext; if (c.state === 'running') c.suspend().catch(() => undefined) }
  private startTick(): void { this.stopTick ??= this.deps.every(() => this.tick(), TICK_MS) }

  private tick(): void {
    const now = this.deps.now()
    if (now - this.lastInput > IDLE_MS) { this.idle = true; this.refresh(); return }
    // Twice a minute: the clock may have crossed into another part of the day (a call to prayer, the evening, a Sunday service).
    if (++this.ticks % 30 === 0) { this.night = isNight(now); this.sync() }
    const until = this.ctx.currentTime + AHEAD
    for (const chan of CHANNELS) this.cur[chan]?.scape.fill(until)
  }

  // ---- discrete events ---------------------------------------------------------------------------------------------------
  /** Play a named event (`tap`, `coins`, … see EVENTS) or `cmd:<command type>` for an accepted command. */
  play(name: string, o: PlayOptions = {}): boolean {
    if (name.startsWith('cmd:')) {
      const mapped = COMMANDS[name.slice(4)]
      if (!mapped) return false
      if (mapped === 'purchase') this.muteSpendUntil = this.deps.now() + 1500
      return this.play(mapped, o)
    }
    const id = EVENTS[name]
    return id && this.awake ? this.synth.play(id, o) : false
  }

  // ---- the world ---------------------------------------------------------------------------------------------------------
  observe(s: Seen): void {
    const p = this.seen
    this.seen = s
    this.night = isNight(this.deps.now())
    if (!p || p.life !== s.life) {
      this.ledgerAt = s.ledger[0]?.at ?? 0
      this.actKey = s.act?.kind === 'activity' ? s.act.id : ''
      this.tripKey = tripOf(s); this.tripMode = s.act?.mode ?? ''
      this.sync()
      return
    }
    const trip = tripOf(s)
    if (s.city !== p.city) this.arrive(s)
    else {
      if (trip && trip !== this.tripKey) { const start = RIDES[s.act?.mode ?? '']?.start; if (start) this.play(start) }
      else if (!trip && this.tripKey) { const end = RIDES[this.tripMode]?.end; if (end) this.play(end) }
      if (s.location !== p.location && !trip && INDOORS.has(this.kind(s))) this.play('door')
    }
    if (trip) this.tripMode = s.act?.mode ?? ''
    this.tripKey = trip
    this.activity(s)
    this.money(s)
    this.sync()
  }

  private arrive(s: Seen): void {
    const end = RIDES[this.tripMode]?.end
    if (end) this.play(end)
    const sound = this.deps.soundOf(s.city)
    const motif = MOTIFS[sound?.motif ?? 'neutral'] ?? 'motif-neutral'
    const shift = 2 ** ((sound?.key ?? 0) / 12)
    this.deps.after(() => { if (this.awake) this.synth.play(motif, { pitch: shift }) }, end ? 1100 : 0)
  }

  private kind(s: Seen): string { return this.deps.kindOf(s.city, s.location) }
  private variant(s: Seen): string { return this.deps.variantOf?.(s.city, s.location) ?? '' }

  private activity(s: Seen): void {
    const key = s.act?.kind === 'activity' ? s.act.id : ''
    if (key === this.actKey) return
    if (this.actKey && this.actEnd) this.play(this.actEnd)
    this.actKey = key; this.actEnd = undefined
    if (!key) return
    const kind = this.kind(s)
    for (const rule of ACTIVITIES) {
      if (rule.id ? !new RegExp(rule.id).test(key) : !s.tags.includes(rule.tag ?? '')) continue
      const work = rule.scape === 'act-work'
      this.actScape = work ? (KEY_KINDS.has(kind) ? 'act-keys' : kind === 'market' || kind === 'hub' || kind === 'walk' ? 'act-tool' : 'act-work') : kind === 'buka' && rule.kitchen ? rule.kitchen : rule.scape
      this.actEnd = rule.end
      if (rule.start) this.play(rule.start)
      return
    }
    this.actScape = /stadium|sports|pitch/.test(s.location) && (s.tags.includes('fun') || s.tags.includes('performance') || s.tags.includes('show')) ? 'act-crowd' : ''
  }

  private money(s: Seen): void {
    const fresh = s.ledger.filter(line => line.at > this.ledgerAt)
    if (s.ledger[0]) this.ledgerAt = Math.max(this.ledgerAt, s.ledger[0].at)
    if (!fresh.length) return
    const sold = fresh.some(l => l.amount > 0 && /^Shop takings/.test(l.reason))
    const stocked = fresh.some(l => l.amount < 0 && /^Shop /.test(l.reason))
    if (sold) this.play('sale')
    else if (stocked) this.play('stock')
    else if (fresh.some(l => l.amount > 0)) this.play('coins')
    else if (this.deps.now() > this.muteSpendUntil) this.play('spend')
  }

  /** Desired scape per channel, as [key, spec]; null for none. */
  private want(chan: Chan): [string, ScapeSpec] | null {
    const s = this.seen
    if (!s) return null
    const night = this.night
    let name = ''
    if (chan === 'place') {
      const kind = s.mode === 'map' ? '' : this.kind(s)
      name = PLACES[kind] ?? this.cityScape(s)
    } else if (chan === 'moment') {
      name = s.mode === 'map' ? '' : pickMoment({ kind: this.kind(s), variant: this.variant(s), now: this.deps.now(), outage: s.outage === true })
    } else if (chan === 'rain') name = s.raining ? (ZINC.has(this.kind(s)) ? 'rain-zinc' : 'rain') : ''
    else if (chan === 'ride') name = s.act?.kind === 'travel' || s.act?.kind === 'intercity' ? RIDES[s.act.mode ?? '']?.scape ?? '' : ''
    else name = this.actScape && this.actKey ? this.actScape : ''
    const spec = SCAPES[name]
    return spec ? [`${name}:${night ? 'n' : 'd'}`, spec] : null
  }
  private cityScape(s: Seen): string {
    const id = this.deps.soundOf(s.city)?.ambience
    if (id === 'harmattan' && ![10, 11, 0, 1].includes(monthOf(s.now))) return 'city'
    return id && SCAPES[id] ? id : 'city'
  }

  /** Make the running scapes match what is wanted: fade the old out, the new in. */
  private sync(): void {
    const s = this.deps.settings()
    for (const chan of CHANNELS) {
      const level = levelFor(s, AMBIENT.has(chan) ? 'ambience' : 'effects')
      const wanted = this.awake && level > 0 ? this.want(chan) : null
      const have = this.cur[chan]
      if (have && have.key === wanted?.[0]) continue
      have?.scape.stop(FADE)
      this.cur[chan] = null
      if (!wanted) continue
      const trim = this.trims[chan]
      const kind = this.seen ? this.kind(this.seen) : ''
      trim.gain.value = chan === 'rain' && !ZINC.has(kind) && INDOORS.has(kind) ? 0.45 : 1
      const scape = new Scape(this.synth, wanted[1], trim, wanted[0].endsWith('n'), FADE)
      scape.fill(this.ctx.currentTime + AHEAD)
      this.cur[chan] = { key: wanted[0], scape }
    }
  }

  /** Start a scape by name on its own channel (the sound board and the measurements). */
  preview(name: string, night = false): void {
    const spec = SCAPES[name]
    if (!spec) return
    const chan: Chan = name.startsWith('ride-') ? 'ride' : name.startsWith('act-') ? 'act' : name.startsWith('rain') ? 'rain' : MOMENTS.some(m => m.scape === name) ? 'moment' : 'place'
    this.cur[chan]?.scape.stop(0.1)
    const scape = new Scape(this.synth, spec, this.trims[chan], night, 0.3)
    this.cur[chan] = { key: `${name}:${night ? 'n' : 'd'}`, scape }
    scape.fill(this.ctx.currentTime + AHEAD)
  }

  /** Render-time helper: fill every running scape up to `seconds` (offline contexts have no timer). */
  prime(seconds: number): void { for (const chan of CHANNELS) this.cur[chan]?.scape.fill(seconds) }

  // ---- footsteps ---------------------------------------------------------------------------------------------------------
  /** The avatar moved to (x, z). A few of these per second while walking; the rate of the steps follows the speed. */
  step(x: number, z: number): void {
    const t = this.deps.now(), p = this.at
    this.at = { x, z, t }
    if (!p || t - p.t > 1500) return
    const d = Math.hypot(x - p.x, z - p.z), dt = (t - p.t) / 1000
    if (d < 0.02 || dt <= 0) return
    this.speed = d / dt
    this.movingUntil = t + 700
    if (!this.stepping && this.awake) { this.stepping = true; this.nextStep() }
  }
  private nextStep(): void {
    if (!this.awake || this.deps.now() > this.movingUntil) { this.stepping = false; return }
    const s = this.seen, surface = SURFACES[s && s.mode !== 'map' ? this.kind(s) : ''] ?? 'floor'
    this.foot = -this.foot
    this.synth.play(STEPS[surface] ?? 'step-floor', { pan: this.foot * 0.15 })
    const rate = Math.min(3.6, Math.max(1.7, 1.7 + this.speed * 0.45))
    this.stopStep = this.deps.after(() => this.nextStep(), 1000 / rate)
  }
  private stopSteps(): void { this.stopStep?.(); this.stopStep = null; this.stepping = false }

  dispose(): void {
    this.stopTick?.(); this.stopTick = null; this.stopSteps()
    for (const chan of CHANNELS) { this.cur[chan]?.scape.stop(0.1); this.cur[chan] = null }
  }
}

function tripOf(s: Seen): string { return s.act && (s.act.kind === 'travel' || s.act.kind === 'intercity') ? `${s.act.kind}:${s.act.id}:${s.act.mode ?? ''}` : '' }
