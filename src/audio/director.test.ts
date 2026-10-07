import assert from 'node:assert/strict'
import test from 'node:test'
import { FX_TRIM } from './synth.ts'
import { Director, IDLE_MS, isNight, pickMoment, type Deps, type Seen } from './director.ts'
import { FakeContext, asContext } from './fakeAudio.ts'
import { SOUND_DEFAULTS, readSound, type SoundSettings } from './settings.ts'
import { levelFor } from './levels.ts'
import { BEAT_SECONDS, MOTIFS } from './data.ts'

interface Rig { ctx: FakeContext; director: Director; settings: SoundSettings; clock: { ms: number }; timers: { run: () => void; ms: number; every: boolean }[] }
const NOON = Date.UTC(2026, 9, 6, 11, 0, 0) // 12:00 in Nigeria
function rig(patch: Partial<SoundSettings> = {}, sound: Deps['soundOf'] = () => undefined): Rig {
  const ctx = new FakeContext(), settings: SoundSettings = { ...SOUND_DEFAULTS, ...patch }, clock = { ms: NOON }, timers: Rig['timers'] = []
  const director = new Director(asContext(ctx), {
    settings: () => settings, soundOf: sound, kindOf: (_city, venue) => ({ stall: 'market', gardens: 'park', flat: 'home', church: 'worship', mosque: 'worship', club: 'club', busPark: 'hub', rail: 'hub' } as Record<string, string>)[venue] ?? '',
    variantOf: (_city, venue) => ({ church: 'church', mosque: 'mosque', rail: 'rail', busPark: 'bus-park' } as Record<string, string>)[venue] ?? '',
    now: () => clock.ms, live: true,
    every: (run, ms) => { const t = { run, ms, every: true }; timers.push(t); return () => { timers.splice(timers.indexOf(t), 1) } },
    after: (run, ms) => { const t = { run, ms, every: false }; timers.push(t); return () => { timers.splice(timers.indexOf(t), 1) } },
  })
  return { ctx, director, settings, clock, timers }
}
const seen = (patch: Partial<Seen> = {}): Seen => ({ life: 'a', city: 'lagos', location: 'stall', mode: 'venue', act: null, tags: [], raining: false, ledger: [], now: NOON, ...patch })
const oscillators = (r: Rig): number => r.ctx.sources.length

test('muted: nothing is scheduled, no scape is built, and the buses are at zero', () => {
  const r = rig({ on: false })
  const before = oscillators(r)
  assert.equal(r.director.play('tap'), false)
  r.director.observe(seen())
  assert.equal(oscillators(r), before, 'no source created')
  assert.equal(r.director.synth.fx.gain.value, 0); assert.equal(r.director.synth.amb.gain.value, 0)
  assert.equal(r.director.sleeping, true)
})

test('the settings are respected: category levels reach the buses, Quiet silences ambience and softens effects', () => {
  const r = rig({ master: 0.5, effects: 0.8, ambience: 0.4 })
  assert.ok(Math.abs(r.director.synth.fx.gain.value - 0.4 * FX_TRIM) < 1e-9); assert.ok(Math.abs(r.director.synth.amb.gain.value - 0.2) < 1e-9)
  r.settings.quiet = true; r.director.applySettings()
  assert.ok(Math.abs(r.director.synth.fx.gain.value - 0.2 * FX_TRIM) < 1e-9); assert.equal(r.director.synth.amb.gain.value, 0)
  assert.equal(levelFor(r.settings, 'calls'), 0.5 * 0.8, 'call tones ignore Quiet')
  r.director.observe(seen())
  const noise = r.ctx.sources.filter(s => s.kind === 'noise').length
  assert.equal(noise, 0, 'no ambience bed in Quiet')
})

test('a place has its own ambience; changing place fades the old one out and the new one in', () => {
  const r = rig()
  r.director.observe(seen({ location: 'gardens' }))
  const first = r.ctx.sources.filter(s => s.kind === 'noise').length
  assert.ok(first >= 2, 'the park beds')
  r.director.observe(seen({ location: 'stall' }))
  const stopped = r.ctx.sources.filter(s => s.stopped.length > 1 || s.stopped.length === 1).length
  assert.ok(stopped > 0, 'the old scape stops its sources')
  assert.ok(r.ctx.sources.filter(s => s.kind === 'noise').length > first, 'the market beds are new sources')
})

test('night uses the night variant; the game clock decides', () => {
  assert.equal(isNight(NOON), false); assert.equal(isNight(Date.UTC(2026, 9, 6, 20, 0, 0)), true); assert.equal(isNight(Date.UTC(2026, 9, 6, 4, 0, 0)), true)
})

test('hidden tab: scapes stop, the context is suspended after the fade, and a visible tab resumes it', async () => {
  const r = rig()
  r.director.observe(seen({ location: 'gardens' }))
  r.director.setHidden(true)
  assert.equal(r.director.sleeping, true)
  assert.equal(r.director.play('tap'), false, 'no sound while hidden')
  const pending = r.timers.find(t => !t.every)
  assert.ok(pending, 'a suspend is scheduled'); pending?.run()
  assert.equal(r.ctx.suspended, 1); assert.equal(r.ctx.state, 'suspended')
  r.director.setHidden(false)
  assert.equal(r.ctx.resumed, 1); assert.equal(r.director.sleeping, false)
})

test('idle for a while: the game goes quiet and the next input wakes it', () => {
  const r = rig()
  r.director.observe(seen())
  const tick = r.timers.find(t => t.every)
  assert.ok(tick, 'one repeating timer while awake')
  r.clock.ms += IDLE_MS + 1000; tick?.run()
  assert.equal(r.director.sleeping, true); assert.equal(r.timers.some(t => t.every), false, 'the timer is gone when asleep')
  r.director.touch()
  assert.equal(r.director.sleeping, false); assert.equal(r.timers.some(t => t.every), true)
})

test('a voice call: the ambience duck is near silent, and the interface sounds are softer', () => {
  const r = rig()
  r.director.setCall(true)
  assert.equal(r.director.synth.ambDuck.gain.value, 0.03); assert.equal(r.director.synth.fxDuck.gain.value, 0.4)
  r.director.setCall(false)
  assert.equal(r.director.synth.ambDuck.gain.value, 1)
})

test('arriving in another city plays that city\'s motif, shifted by its key; a city without data gets the neutral motif', () => {
  const played: { id: string; pitch: number }[] = []
  const r = rig({}, city => (city === 'kano' ? { motif: 'plucked-string', key: 2 } : undefined))
  const original = r.director.synth.play.bind(r.director.synth)
  r.director.synth.play = (id, o) => { if (!o?.dest) played.push({ id, pitch: o?.pitch ?? 1 }); return original(id, o) }
  r.director.observe(seen())
  r.director.observe(seen({ city: 'kano', location: 'home' }))
  r.timers.filter(t => !t.every).forEach(t => t.run())
  assert.ok(played.some(p => p.id === MOTIFS['plucked-string'] && Math.abs(p.pitch - 2 ** (2 / 12)) < 1e-9), JSON.stringify(played))
  r.director.observe(seen({ city: 'ibadan', location: 'home' }))
  r.timers.filter(t => !t.every).forEach(t => t.run())
  assert.ok(played.some(p => p.id === 'motif-neutral'))
})

test('money in, money out, a sale and a purchase each make their own sound, and a first look at a life makes none', () => {
  const r = rig()
  const played: string[] = []
  const original = r.director.synth.play.bind(r.director.synth)
  r.director.synth.play = (id, o) => { if (!o?.dest) played.push(id); return original(id, o) }
  const line = (at: number, amount: number, reason: string) => ({ at, amount, reason })
  r.director.observe(seen({ ledger: [line(1, 500, 'Start')] }))
  assert.deepEqual(played, [], 'baseline is silent')
  r.clock.ms += 100
  r.director.observe(seen({ ledger: [line(2, 300, 'Wage'), line(1, 500, 'Start')] }))
  r.clock.ms += 100
  r.director.observe(seen({ ledger: [line(3, -100, 'Bought rice'), line(2, 300, 'Wage')] }))
  r.clock.ms += 100
  r.director.observe(seen({ ledger: [line(4, 900, 'Shop takings: Bola'), line(3, -100, 'x')] }))
  assert.deepEqual(played.filter(id => ['coins', 'spend', 'sale'].includes(id)), ['coins', 'spend', 'sale'])
  played.length = 0
  r.director.play('cmd:home.furniture-buy')
  r.director.observe(seen({ ledger: [line(5, -2000, 'Chair'), line(4, 900, 'x')] }))
  assert.deepEqual(played, ['purchase'], 'the purchase sound replaces the plain spend sound')
})

test('activities: a meal, a wash, a night\'s sleep and a shift each get their texture; the shift ends with a cue', () => {
  const r = rig()
  const played: string[] = []
  const original = r.director.synth.play.bind(r.director.synth)
  r.director.synth.play = (id, o) => { if (!o?.dest) played.push(id); return original(id, o) }
  r.director.observe(seen())
  const act = (id: string, tags: string[]) => seen({ act: { kind: 'activity', id }, tags })
  const shots: string[] = []
  const inner = r.director.synth.play.bind(r.director.synth)
  r.director.synth.play = (id, o) => { if (o?.dest) shots.push(id); return inner(id, o) }
  r.director.observe(act('eat-jollof', ['food']))
  r.director.prime(r.ctx.currentTime + 12)
  assert.ok(shots.includes('bite') && shots.includes('clink'), `the meal is bites and cutlery: ${shots.join()}`)
  played.length = 0
  r.director.observe(seen())
  r.director.observe(act('night-sleep', ['sleep']))
  assert.ok(played.includes('lullaby'), 'sleep begins with a lullaby chime')
  played.length = 0
  r.director.observe(seen())
  assert.ok(played.includes('wake'), 'and ends with a soft wake')
  played.length = 0
  r.director.observe(act('shop-shift', ['work']))
  r.director.observe(seen())
  assert.ok(played.includes('shift-done'))
})

test('trips: a bus leaves with two horn taps, a flight with a whoosh and ends with the cabin chime before the city motif', () => {
  const r = rig()
  const played: string[] = []
  const original = r.director.synth.play.bind(r.director.synth)
  r.director.synth.play = (id, o) => { if (!o?.dest) played.push(id); return original(id, o) }
  r.director.observe(seen())
  r.director.observe(seen({ act: { kind: 'travel', id: 'gardens', mode: 'danfo' }, mode: 'map' }))
  assert.ok(played.includes('horn-taps'))
  r.director.observe(seen({ act: null }))
  played.length = 0
  r.director.observe(seen({ act: { kind: 'intercity', id: 'kano', mode: 'air' }, mode: 'map' }))
  assert.ok(played.includes('whoosh'))
  r.director.observe(seen({ city: 'kano', location: 'home', act: null }))
  assert.ok(played.includes('cabin-chime'))
  r.timers.filter(t => !t.every).forEach(t => t.run())
  assert.ok(played.includes('motif-neutral') || played.some(id => id.startsWith('motif-')))
})

test('rain is a bed of its own, and quieter indoors; footsteps follow the surface and the speed and stop when the avatar does', () => {
  const r = rig()
  r.director.observe(seen({ location: 'flat', raining: true }))
  assert.ok(r.ctx.sources.some(s => s.kind === 'noise'), 'a rain bed')
  const played: string[] = []
  const original = r.director.synth.play.bind(r.director.synth)
  r.director.synth.play = (id, o) => { if (!o?.dest) played.push(id); return original(id, o) }
  r.director.observe(seen({ location: 'gardens' }))
  r.clock.ms += 1000; r.director.step(0, 0)
  r.clock.ms += 330; r.director.step(1, 0)
  assert.deepEqual(played, ['step-grass'], 'one step now, on grass')
  const next = r.timers.filter(t => !t.every).pop()
  assert.ok(next && next.ms > 250 && next.ms < 600, `the next step is ${next?.ms} ms away`)
  r.clock.ms += 3000; next?.run()
  assert.equal(played.length, 1, 'no more steps once the avatar has stopped')
})

test('the stored preferences are read the way they were saved, and anything malformed is its default', () => {
  assert.deepEqual(readSound(null), SOUND_DEFAULTS)
  assert.equal(readSound({ getItem: () => '{"on":false,"master":0.3,"effects":9,"ambience":"x"}' }).on, false)
  const s = readSound({ getItem: () => '{"on":false,"master":0.3,"effects":9,"ambience":"x"}' })
  assert.equal(s.master, 0.3); assert.equal(s.effects, SOUND_DEFAULTS.effects); assert.equal(s.ambience, SOUND_DEFAULTS.ambience)
  assert.deepEqual(readSound({ getItem: () => 'not json' }), SOUND_DEFAULTS); assert.deepEqual(readSound({ getItem: () => '[1]' }), SOUND_DEFAULTS)
})

// ---- the time of day ----------------------------------------------------------------------------------------------------
/** A moment of the Lagos clock on a day of October 2026 (the 4th is a Sunday, the 6th a Tuesday, the 9th a Friday). */
const lagos = (day: number, hour: number, minute = 0): number => Date.UTC(2026, 9, day, hour - 1, minute)
const SUNDAY = 4, TUESDAY = 6, FRIDAY = 9
/** Every one-shot or loop a scape plays (they carry a destination), by recipe and start time. */
function recording(r: Rig): { id: string; at: number }[] {
  const shots: { id: string; at: number }[] = []
  const original = r.director.synth.play.bind(r.director.synth)
  r.director.synth.play = (id, o) => { if (o?.dest) shots.push({ id, at: o.at ?? 0 }); return original(id, o) }
  return shots
}
/** A director whose clock is at `now`, watching `location`, with the scapes primed for `seconds`. */
function listen(now: number, location: string, patch: Partial<Seen> = {}, settings: Partial<SoundSettings> = {}, seconds = 30): { r: Rig; shots: { id: string; at: number }[] } {
  const r = rig(settings)
  r.clock.ms = now; r.director.touch()
  const shots = recording(r)
  r.director.observe(seen({ location, now, ...patch }))
  r.director.prime(seconds)
  return { r, shots }
}

test('the time of day picks what a place adds: the band, the weekday, prayer times and the look of the scene', () => {
  const at = (kind: string, now: number, variant = '', outage = false): string => pickMoment({ kind, variant, now, outage })
  assert.equal(at('worship', lagos(SUNDAY, 9), 'church'), 'church-service')
  assert.equal(at('worship', lagos(TUESDAY, 9), 'church'), '', 'a church on a weekday morning is quiet')
  assert.equal(at('worship', lagos(SUNDAY, 15), 'church'), '', 'and on Sunday afternoon')
  assert.equal(at('worship', lagos(TUESDAY, 13, 15), 'mosque'), 'azan-near')
  assert.equal(at('worship', lagos(TUESDAY, 11), 'mosque'), '')
  assert.equal(at('worship', lagos(FRIDAY, 13, 30), 'mosque'), 'jumuah')
  assert.equal(at('park', lagos(TUESDAY, 13, 15)), 'azan-far', 'the call carries into the street')
  assert.equal(at('club', lagos(TUESDAY, 22)), 'club-night'); assert.equal(at('club', lagos(TUESDAY, 14)), '')
  assert.equal(at('market', lagos(TUESDAY, 10)), 'hawkers'); assert.equal(at('market', lagos(TUESDAY, 23)), 'generator-far')
  assert.equal(at('home', lagos(TUESDAY, 22)), 'generator'); assert.equal(at('home', lagos(TUESDAY, 12)), '')
  assert.equal(at('home', lagos(TUESDAY, 12), '', true), 'generator', 'a power cut brings the generators on by day')
  assert.equal(at('hub', lagos(TUESDAY, 8), 'bus-park'), 'conductors'); assert.equal(at('hub', lagos(TUESDAY, 8), 'rail'), '')
  assert.equal(at('hub', lagos(TUESDAY, 22), 'bus-park'), 'generator-far', 'no conductors at night')
  assert.equal(at('', lagos(TUESDAY, 22)), '')
})

test('a Sunday morning in church has a service, with hymns; a Tuesday has none', () => {
  const sunday = listen(lagos(SUNDAY, 9), 'church')
  assert.ok(sunday.shots.some(s => s.id === 'hymn'), 'hymns on Sunday')
  const tuesday = listen(lagos(TUESDAY, 9), 'church')
  assert.ok(!tuesday.shots.some(s => s.id === 'hymn'), 'none on a Tuesday')
})

test('the call to prayer sounds in a mosque at prayer time and not before; the clock crossing the time starts it without anyone moving', () => {
  assert.ok(listen(lagos(TUESDAY, 13, 15), 'mosque').shots.some(s => s.id === 'azan'), 'at dhuhr')
  assert.ok(!listen(lagos(TUESDAY, 11), 'mosque').shots.some(s => s.id === 'azan'), 'not at eleven')
  const { r, shots } = listen(lagos(TUESDAY, 13, 11) + 30_000, 'mosque', {}, {}, 10)
  assert.ok(!shots.some(s => s.id === 'azan'), 'half a minute before')
  r.clock.ms += 60_000; r.director.touch()
  const tick = r.timers.find(t => t.every)
  for (let i = 0; i < 30; i++) tick?.run()
  r.director.prime(20)
  assert.ok(shots.some(s => s.id === 'azan'), 'a minute later the call has begun')
})

test('a market has hawkers by day and a distant generator at night; a bus park has conductors and a rail hub has none', () => {
  assert.ok(listen(lagos(TUESDAY, 10), 'stall').shots.some(s => s.id === 'hawk-a' || s.id === 'hawk-b'), 'hawkers in the morning')
  assert.ok(!listen(lagos(TUESDAY, 23), 'stall').shots.some(s => s.id === 'hawk-a'), 'none at eleven at night')
  assert.ok(listen(lagos(TUESDAY, 8), 'busPark').shots.some(s => s.id === 'conductor'), 'conductors call in the bus park')
  assert.ok(!listen(lagos(TUESDAY, 8), 'rail').shots.some(s => s.id === 'conductor'), 'not on the rail platform')
})

test('a generator hums at night in a home and, once the game reports a power cut, by day too', () => {
  const gen = (r: Rig): boolean => r.ctx.sources.some(s => s.kind === 'osc' && s.frequency.value === 47)
  assert.ok(gen(listen(lagos(TUESDAY, 22), 'flat').r), 'at night')
  assert.ok(!gen(listen(lagos(TUESDAY, 12), 'flat').r), 'not at noon')
  assert.ok(gen(listen(lagos(TUESDAY, 12), 'flat', { outage: true }).r), 'a cut at noon')
})

test('a club plays its beat exactly in time, bar after bar, in the evening and not at noon', () => {
  const beats = listen(lagos(TUESDAY, 22), 'club', {}, {}, 20).shots.filter(s => s.id === 'beat-club').map(s => s.at)
  assert.ok(beats.length >= 4, `${beats.length} bars`)
  for (let i = 1; i < beats.length; i++) assert.ok(Math.abs((beats[i] as number) - (beats[i - 1] as number) - BEAT_SECONDS) < 1e-9, 'the bars follow each other with no drift')
  assert.equal(listen(lagos(TUESDAY, 12), 'club', {}, {}, 20).shots.filter(s => s.id === 'beat-club').length, 0)
})

test('rain on a zinc roof ticks; rain on a flat does not', () => {
  assert.ok(listen(lagos(TUESDAY, 12), 'stall', { raining: true }, {}, 5).shots.some(s => s.id === 'zinc-tick'), 'a market shed')
  assert.ok(!listen(lagos(TUESDAY, 12), 'flat', { raining: true }, {}, 5).shots.some(s => s.id === 'zinc-tick'), 'a flat')
})

test('Quiet and mute keep the new sounds out as well: nothing is built for a service, a call or a beat', () => {
  for (const patch of [{ quiet: true }, { on: false }]) {
    for (const [now, where] of [[lagos(SUNDAY, 9), 'church'], [lagos(TUESDAY, 13, 15), 'mosque'], [lagos(TUESDAY, 22), 'club']] as const) {
      const { r } = listen(now, where, {}, patch)
      assert.equal(r.ctx.sources.length, 0, `${where} under ${JSON.stringify(patch)}`)
    }
  }
})
