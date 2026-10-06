// Every sound of the game as data. Recipes are lists of layers (see synth.ts); scapes are beds plus sparse one-shots (scape.ts).
// The family: struck wooden bars and soft clicks for the interface, pentatonic phrases for rewards, filtered noise for the world.
// Nothing is a recording, a melody that exists, or a voice. A few helpers below build the layers that repeat.
import type { Layer, Recipe } from './synth.ts'
import type { ScapeSpec } from './scape.ts'

const hz = (m: number): number => 440 * 2 ** ((m - 69) / 12)
/** A struck wooden bar at MIDI note `m`: a sine, a quick overtone and a faint click. */
const bar = (m: number, at = 0, g = 0.4, d = 0.24, rv = 0.2): Layer[] => [
  { w: 'sine', f: hz(m), at, a: 0.002, d, g, rv },
  { w: 'sine', f: hz(m) * 3.9, at, a: 0.001, d: d * 0.22, g: g * 0.22 },
  { w: 'noise', at, a: 0.001, d: 0.014, g: g * 0.25, fl: ['bandpass', 2600, 1.4] },
]
/** A glassy tinkle: two-operator FM. */
const tink = (m: number, at = 0, g = 0.22, d = 0.3, rv = 0.25): Layer[] => [{ w: 'sine', f: hz(m), at, a: 0.001, d, g, fm: [2.76, 1.4], rv }]
/** A dull knock. */
const knock = (f: number, at = 0, g = 0.3, d = 0.07): Layer[] => [
  { w: 'sine', f, f2: f * 0.6, at, a: 0.001, d, g },
  { w: 'noise', at, a: 0.001, d: 0.012, g: g * 0.3, fl: ['bandpass', 1800, 1] },
]
/** A short burst of filtered noise. */
const puff = (hzc: number, d: number, g: number, at = 0, q = 0.8, type: BiquadFilterType = 'bandpass', end?: number): Layer => ({ w: 'noise', at, a: Math.min(0.01, d / 3), d, g, fl: end ? [type, hzc, q, end] : [type, hzc, q] })
const seq = (notes: readonly number[], step: number, make: (m: number, at: number, i: number) => Layer[]): Layer[] => notes.flatMap((m, i) => make(m, i * step, i))
const pent = [0, 2, 4, 7, 9]
void pent

export const RECIPES: Readonly<Record<string, Recipe>> = {
  // ---- interface: wood and soft clicks --------------------------------------------------------------------------
  tap: { l: [{ w: 'sine', f: 760, f2: 520, a: 0.001, d: 0.05, g: 0.32 }, puff(3000, 0.012, 0.08, 0, 1.2)], pri: 0, j: 0.03 },
  open: { l: [...bar(72, 0, 0.3, 0.16), ...bar(79, 0.06, 0.3, 0.2)] },
  close: { l: [...bar(79, 0, 0.26, 0.14), ...bar(72, 0.06, 0.26, 0.18)] },
  tab: { l: bar(76, 0, 0.26, 0.09, 0.05), pri: 0 },
  'toggle-on': { l: [...knock(420, 0, 0.26, 0.05), ...bar(79, 0.035, 0.26, 0.12, 0.1)] },
  'toggle-off': { l: [...knock(360, 0, 0.26, 0.05), ...bar(72, 0.035, 0.22, 0.12, 0.1)] },
  success: { l: seq([72, 76, 79], 0.07, (m, at) => bar(m, at, 0.3, 0.18)), pri: 2 },
  refused: { l: [...knock(230, 0, 0.34, 0.09), ...knock(190, 0.09, 0.3, 0.12)], pri: 2 },
  notify: { l: [...bar(79, 0, 0.3, 0.32, 0.3), ...bar(86, 0.12, 0.26, 0.4, 0.3)], pri: 2 },
  message: { l: [{ w: 'sine', f: 480, f2: 900, a: 0.004, d: 0.08, g: 0.3 }, { w: 'sine', f: 720, f2: 1200, at: 0.09, a: 0.004, d: 0.1, g: 0.26, rv: 0.1 }], pri: 2 },
  online: { l: [...tink(88, 0, 0.16, 0.34, 0.3)], pri: 1 },
  toast: { l: bar(74, 0, 0.18, 0.1, 0.05), pri: 0 },
  // a piece or a tile set down on a board, and a capture
  'wood-tap': { l: [...knock(520, 0, 0.22, 0.05), puff(2400, 0.01, 0.06, 0, 1.2)], pri: 0, j: 0.03 },
  'wood-clack': { l: [...knock(380, 0, 0.3, 0.06), ...knock(560, 0.045, 0.22, 0.05)], pri: 1, j: 0.03 },
  goal: { l: [...seq([60, 64, 67, 72], 0.085, (m, at) => bar(m, at, 0.3, 0.22, 0.25)), ...bar(76, 0.37, 0.34, 0.6, 0.4), ...bar(84, 0.37, 0.14, 0.6, 0.4)], pri: 2 },
  coins: { l: [...tink(88, 0, 0.2), ...tink(91, 0.055, 0.18), ...tink(95, 0.11, 0.16, 0.34)], pri: 1 },
  spend: { l: [...tink(91, 0, 0.14, 0.2), ...tink(84, 0.07, 0.14, 0.24)], pri: 1 },
  purchase: { l: [puff(2200, 0.1, 0.12, 0, 0.8, 'bandpass', 4200), ...tink(86, 0.09, 0.2, 0.3), ...tink(93, 0.15, 0.16, 0.34)], pri: 2 },
  gift: { l: [...seq([79, 83, 86, 91], 0.07, (m, at) => [{ w: 'triangle', f: hz(m), at, a: 0.002, d: 0.3, g: 0.2, rv: 0.4 } as Layer]), puff(5000, 0.3, 0.03, 0.05, 0.6, 'highpass')], pri: 2 },
  sale: { l: [...tink(93, 0, 0.2, 0.28), ...tink(100, 0.1, 0.14, 0.3), ...knock(260, 0, 0.12, 0.05)], pri: 2 },
  stock: { l: [...knock(300, 0, 0.3, 0.07), ...knock(250, 0.1, 0.28, 0.08), puff(900, 0.08, 0.05, 0.02)], pri: 1 },
  stamp: { l: [...knock(150, 0, 0.5, 0.1), puff(700, 0.05, 0.14, 0, 1.2, 'bandpass'), ...bar(67, 0.08, 0.12, 0.12)], pri: 2 },
  // ---- the world ----------------------------------------------------------------------------------------------------
  'step-floor': { l: [{ w: 'sine', f: 130, f2: 70, a: 0.002, d: 0.06, g: 0.5 }, puff(900, 0.04, 0.12, 0, 0.7, 'lowpass')], pri: 0, j: 0.12, g: 0.4 },
  'step-grass': { l: [puff(1700, 0.09, 0.3, 0, 0.5, 'bandpass', 900), puff(300, 0.05, 0.2, 0, 0.7, 'lowpass')], pri: 0, j: 0.12, g: 0.4 },
  'step-path': { l: [puff(1300, 0.07, 0.3, 0, 0.9, 'bandpass'), puff(3400, 0.03, 0.12, 0.01, 1.2), { w: 'sine', f: 110, f2: 70, a: 0.002, d: 0.05, g: 0.3 }], pri: 0, j: 0.12, g: 0.4 },
  'step-sand': { l: [puff(900, 0.12, 0.3, 0, 0.5, 'bandpass', 500), puff(2400, 0.05, 0.06, 0, 0.7)], pri: 0, j: 0.12, g: 0.4 },
  door: { l: [...knock(95, 0, 0.5, 0.16), puff(500, 0.14, 0.1, 0, 0.6, 'lowpass'), puff(2100, 0.015, 0.14, 0.12, 1.5)], pri: 1 },
  bite: { l: [puff(1900, 0.03, 0.34, 0, 1.4), puff(1100, 0.04, 0.3, 0.05, 1.2), puff(2600, 0.025, 0.2, 0.1, 1.4), { w: 'sine', f: 180, f2: 120, at: 0.12, a: 0.01, d: 0.09, g: 0.12 }], pri: 0, j: 0.08, g: 0.7 },
  sip: { l: [puff(500, 0.22, 0.2, 0, 2.5, 'bandpass', 1100), { w: 'sine', f: 190, f2: 110, at: 0.24, a: 0.01, d: 0.12, g: 0.2 }], pri: 0, j: 0.06, g: 0.7 },
  clink: { l: [...tink(96, 0, 0.14, 0.16, 0.1), ...tink(100, 0.03, 0.08, 0.12, 0.1)], pri: 0, j: 0.05 },
  sizzle: { l: [puff(6200, 0.05, 0.16, 0, 0.5, 'highpass'), puff(3800, 0.03, 0.14, 0.02, 1.5)], pri: 0, j: 0.2, g: 0.6 },
  splash: { l: [puff(2800, 0.14, 0.14, 0, 0.5, 'bandpass', 1600)], pri: 0, j: 0.2, g: 0.6 },
  breath: { l: [{ w: 'noise', c: 'pink', a: 1.1, d: 2.4, g: 0.13, fl: ['lowpass', 360, 0.6, 520] }], pri: 0 },
  lullaby: { l: seq([79, 76, 72, 69], 0.32, (m, at) => [{ w: 'sine', f: hz(m), at, a: 0.01, d: 0.7, g: 0.2, rv: 0.5 } as Layer]), pri: 1 },
  wake: { l: [...bar(72, 0, 0.24, 0.3, 0.3), ...bar(79, 0.18, 0.24, 0.4, 0.3)], pri: 1 },
  key: { l: [puff(3400, 0.012, 0.26, 0, 1.6), { w: 'sine', f: 1700, a: 0.001, d: 0.012, g: 0.08 }], pri: 0, j: 0.15, g: 0.6 },
  keys: { l: [0, 0.09, 0.17, 0.31, 0.4, 0.5].flatMap(at => [puff(3400, 0.012, 0.24, at, 1.6), { w: 'sine', f: 1700, at, a: 0.001, d: 0.012, g: 0.07 } as Layer]), pri: 0, g: 0.5 },
  tool: { l: [...knock(320, 0, 0.3, 0.06), puff(2600, 0.01, 0.1, 0, 1.4)], pri: 0, j: 0.1, g: 0.7 },
  tick: { l: [{ w: 'triangle', f: 1300, a: 0.001, d: 0.025, g: 0.16 }, puff(2800, 0.01, 0.06, 0, 1.2)], pri: 0, j: 0.06 },
  'shift-done': { l: [...seq([67, 72, 76], 0.09, (m, at) => bar(m, at, 0.28, 0.2)), ...tink(95, 0.3, 0.14, 0.4)], pri: 2 },
  seed: { l: [{ w: 'sine', f: 560, f2: 400, a: 0.001, d: 0.04, g: 0.2 }, puff(2200, 0.02, 0.14, 0, 1.2), { w: 'sine', f: 620, f2: 430, at: 0.07, a: 0.001, d: 0.04, g: 0.16 }], pri: 0, j: 0.15 },
  card: { l: [puff(4200, 0.07, 0.2, 0, 0.5, 'bandpass', 1800), ...knock(280, 0.06, 0.12, 0.04)], pri: 0, j: 0.08 },
  'crowd-swell': { l: [{ w: 'noise', c: 'pink', a: 1.6, d: 3.4, g: 0.12, fl: ['bandpass', 650, 0.5, 900], am: [5, 0.5] }, { w: 'noise', c: 'pink', at: 0.4, a: 1.3, d: 3, g: 0.07, fl: ['bandpass', 1500, 0.6] }], pri: 0 },
  // ---- vehicles -------------------------------------------------------------------------------------------------------
  'horn-taps': { l: [0, 0.24].flatMap(at => [{ w: 'sawtooth', f: 392, at, a: 0.01, d: 0.14, g: 0.12, fl: ['lowpass', 1100, 0.7] }, { w: 'sawtooth', f: 494, at, a: 0.01, d: 0.14, g: 0.1, fl: ['lowpass', 1100, 0.7] }] as Layer[]), pri: 1 },
  clack: { l: [...knock(120, 0, 0.5, 0.06), ...knock(135, 0.13, 0.4, 0.06)], pri: 0, j: 0.05, g: 0.8 },
  whoosh: { l: [{ w: 'noise', c: 'pink', a: 1.4, d: 2.6, g: 0.32, fl: ['bandpass', 260, 0.8, 2800] }, { w: 'sawtooth', f: 70, f2: 150, a: 1.5, d: 2.6, g: 0.06, fl: ['lowpass', 300, 0.7] }], pri: 1 },
  'cabin-chime': { l: [...tink(83, 0, 0.18, 0.7, 0.4), ...tink(79, 0.4, 0.18, 0.9, 0.4)], pri: 2 },
  lap: { l: [puff(700, 0.3, 0.2, 0, 0.8, 'bandpass', 380), puff(1500, 0.1, 0.06, 0.05)], pri: 0, j: 0.15, g: 0.6 },
  // ---- ambience one-shots ---------------------------------------------------------------------------------------------
  'bird-a': { l: [{ w: 'sine', f: 3300, f2: 4300, a: 0.01, d: 0.09, g: 0.12, fm: [0.5, 0.06] }, { w: 'sine', f: 4100, f2: 3000, at: 0.11, a: 0.01, d: 0.12, g: 0.1, fm: [0.5, 0.06] }, { w: 'sine', f: 3600, f2: 4600, at: 0.26, a: 0.01, d: 0.08, g: 0.08 }], pri: 0, j: 0.12 },
  'bird-b': { l: [0, 0.13, 0.26].map(at => ({ w: 'sine', f: 2500, f2: 3200, at, a: 0.005, d: 0.08, g: 0.1, fm: [2, 0.25] }) as Layer), pri: 0, j: 0.1 },
  cricket: { l: [0, 0.07, 0.14, 0.21].map(at => ({ w: 'sine', f: 4300, at, a: 0.004, d: 0.05, g: 0.05, am: [60, 0.8] }) as Layer), pri: 0, j: 0.03 },
  murmur: { l: [{ w: 'noise', c: 'pink', a: 0.12, d: 0.5, g: 0.2, fl: ['bandpass', 620, 3.5, 880], am: [4.5, 0.7] }, { w: 'noise', c: 'pink', at: 0.04, a: 0.1, d: 0.4, g: 0.1, fl: ['bandpass', 1700, 4, 1300], am: [6, 0.6] }], pri: 0, j: 0.35 },
  'seller-bell': { l: [...tink(91, 0, 0.14, 0.5, 0.3), ...tink(91, 0.17, 0.1, 0.4, 0.3)], pri: 0, j: 0.04 },
  'campus-bell': { l: [...tink(67, 0, 0.12, 1.4, 0.5), { w: 'sine', f: hz(67) * 2, a: 0.002, d: 1, g: 0.05, rv: 0.4 }], pri: 0 },
  announce: { l: [...bar(84, 0, 0.14, 0.4, 0.5), ...bar(79, 0.42, 0.14, 0.4, 0.5), ...bar(72, 0.84, 0.16, 0.7, 0.5)], pri: 0 },
  'car-horn': { l: [{ w: 'square', f: 420, a: 0.02, d: 0.28, g: 0.04, fl: ['lowpass', 900, 0.7] }], pri: 0, j: 0.15 },
  // ---- arrival motifs (one per kind of instrument; a city's key shifts them) -----------------------------------------------
  'motif-drum': { l: [[0, 57, 0.4], [0.17, 64, 0.36], [0.34, 60, 0.36], [0.51, 69, 0.4], [0.9, 64, 0.5]].flatMap(([at, m, g]) => {
    const f = hz(m as number)
    return [
      { w: 'triangle', f, f2: f * 1.38, at, a: 0.004, d: (at as number) > 0.8 ? 0.7 : 0.26, g: g as number, rv: 0.2 },
      { w: 'sine', f: f * 0.5, f2: f * 0.6, at, a: 0.004, d: 0.18, g: (g as number) * 0.6 },
      puff(1200, 0.03, 0.12, at as number, 1.2),
    ] as Layer[]
  }), pri: 2 },
  'motif-pluck': { l: [57, 60, 64, 67, 64, 69, 76].flatMap((m, i) => {
    const at = i * 0.16, f = hz(m)
    return [
      { w: 'triangle', f, at, a: 0.002, d: i === 6 ? 1.1 : 0.55, g: 0.26, rv: 0.35, fl: ['lowpass', 5200, 0.7, 1100] },
      { w: 'sine', f: f * 2, at, a: 0.001, d: 0.3, g: 0.08 },
    ] as Layer[]
  }), pri: 2 },
  'motif-guitar': { l: [[0, 64], [0.14, 67], [0.28, 71], [0.5, 69], [0.64, 72], [0.84, 76]].flatMap(([at, m], i) => [
    { w: 'sawtooth', f: hz(m as number), at, a: 0.002, d: i === 5 ? 0.9 : 0.34, g: 0.12, fl: ['lowpass', 3600, 0.9, 700], rv: 0.25 },
    { w: 'sawtooth', f: hz((m as number) - 12) * 1.003, at, a: 0.002, d: 0.3, g: 0.06, fl: ['lowpass', 1400, 0.7, 500] },
  ] as Layer[]), pri: 2 },
  'motif-mallet': { l: [...bar(67, 0, 0.3, 0.5, 0.4), ...bar(72, 0.3, 0.28, 0.5, 0.4), ...bar(76, 0.6, 0.28, 0.6, 0.4), ...bar(79, 1.0, 0.3, 1.2, 0.5)], pri: 2 },
  'motif-neutral': { l: [...bar(72, 0, 0.26, 0.4, 0.4), ...bar(76, 0.25, 0.26, 0.4, 0.4), ...bar(79, 0.5, 0.28, 0.9, 0.5)], pri: 2 },
}

/** Discrete events: the names the game uses (play('tap'), …) and the recipe each plays. */
export const EVENTS: Readonly<Record<string, string>> = {
  tap: 'tap', open: 'open', close: 'close', tab: 'tab', 'toggle-on': 'toggle-on', 'toggle-off': 'toggle-off',
  success: 'success', refused: 'refused', notify: 'notify', message: 'message', online: 'online', toast: 'toast',
  goal: 'goal', coins: 'coins', spend: 'spend', purchase: 'purchase', gift: 'gift', sale: 'sale', stock: 'stock', stamp: 'stamp',
  door: 'door', sleep: 'lullaby', wake: 'wake', 'shift-done': 'shift-done', 'trip-bus': 'horn-taps', 'trip-air': 'whoosh', 'arrive-air': 'cabin-chime',
  card: 'card', 'table-place': 'wood-tap', 'table-capture': 'wood-clack',
}
/** What a board or the word puzzle announces (window event `jaw:table`, detail { game, event }) and the event it plays. */
export const TABLE_SOUNDS: Readonly<Record<string, string>> = {
  'chess:move': 'table-place', 'chess:castle': 'table-place', 'chess:promote': 'success', 'chess:capture': 'table-capture', 'chess:check': 'notify', 'chess:end': 'goal',
  'weave:play': 'table-place', 'weave:bingo': 'goal', 'weave:exchange': 'card', 'weave:pass': 'tab', 'weave:end': 'goal',
  'oro:guess': 'table-place', 'oro:win': 'goal', 'oro:lose': 'refused',
}
/** What the guide announces (window event `jaw:companion`, detail { kind, mood? }) and the event it plays. */
export const COMPANION_SOUNDS: Readonly<Record<string, string>> = { speak: 'toast', celebrate: 'success' }
/** The footstep recipe for each surface. */
export const STEPS: Readonly<Record<string, string>> = { floor: 'step-floor', grass: 'step-grass', path: 'step-path', sand: 'step-sand' }
/** The arrival motif of each instrument. A city names one in its content (`sound.motif`). */
export const MOTIFS: Readonly<Record<string, string>> = { 'talking-drum': 'motif-drum', 'plucked-string': 'motif-pluck', highlife: 'motif-guitar', mallet: 'motif-mallet', neutral: 'motif-neutral' }
/** Commands that, when the server accepts them, make an interface sound. */
export const COMMANDS: Readonly<Record<string, string>> = {
  'civic.vote': 'stamp', 'transfer-out': 'gift', 'property.car-buy': 'purchase', 'home.furniture-buy': 'purchase', 'home.grocery-buy': 'purchase',
  'goals.buy-perk': 'purchase', 'onboarding.boutique-buy': 'purchase', 'estate.upgrade': 'purchase', 'missions.claim': 'success', 'civic.hunt-claim': 'success',
}

/** Beds for the same everywhere: vehicles, weather, places. */
const city: ScapeSpec = { beds: [{ c: 'brown', fl: ['lowpass', 420, 0.7], g: 0.55, v: 0.35, lfo: [0.07, 0.25] }, { c: 'pink', fl: ['bandpass', 1400, 0.6], g: 0.06, v: 0.6 }], shots: [['car-horn', 9, 24, 0.35]] }
export const SCAPES: Readonly<Record<string, ScapeSpec>> = {
  // places (ambience bus)
  city,
  harmattan: { beds: [{ c: 'brown', fl: ['lowpass', 380, 0.7], g: 0.3, v: 0.3 }, { c: 'pink', fl: ['bandpass', 520, 0.5], g: 0.2, v: 0.9, lfo: [0.1, 0.55] }], shots: [['car-horn', 14, 34, 0.3]] },
  harbour: { beds: [{ c: 'brown', fl: ['lowpass', 380, 0.7], g: 0.3, v: 0.3 }, { c: 'brown', fl: ['lowpass', 700, 0.5], g: 0.32, lfo: [0.13, 0.7] }, { c: 'pink', fl: ['bandpass', 2400, 0.4], g: 0.04, lfo: [0.13, 0.8] }], shots: [['car-horn', 16, 40, 0.28]] },
  calm: { beds: [{ c: 'brown', fl: ['lowpass', 300, 0.7], g: 0.3, v: 0.3 }, { c: 'pink', fl: ['bandpass', 3000, 0.5], g: 0.04, v: 0.8 }], shots: [['bird-a', 4, 11, 0.5, 'day'], ['cricket', 0.8, 2, 0.4, 'night']] },
  market: { beds: [{ c: 'pink', fl: ['bandpass', 650, 0.6], g: 0.3, v: 0.5, night: 0.6 }, { c: 'pink', fl: ['bandpass', 1800, 0.4], g: 0.05, v: 0.6 }], shots: [['murmur', 0.25, 0.9, 0.5], ['seller-bell', 9, 22, 0.4, 'day']] },
  park: { beds: [{ c: 'pink', fl: ['bandpass', 3200, 0.5], g: 0.05, v: 0.8 }, { c: 'brown', fl: ['lowpass', 300, 0.7], g: 0.2, v: 0.3 }], shots: [['bird-a', 2.5, 7, 0.6, 'day'], ['bird-b', 4, 11, 0.5, 'day'], ['cricket', 0.7, 1.8, 0.5, 'night']] },
  water: { beds: [{ c: 'brown', fl: ['lowpass', 650, 0.6], g: 0.6, lfo: [0.13, 0.6] }, { c: 'pink', fl: ['bandpass', 2500, 0.4], g: 0.07, lfo: [0.13, 0.8] }], shots: [['splash', 3, 8, 0.4]] },
  campus: { beds: [{ c: 'pink', fl: ['bandpass', 700, 0.6], g: 0.12, v: 0.5 }, { c: 'brown', fl: ['lowpass', 300, 0.7], g: 0.2, v: 0.3 }], shots: [['step-path', 2.2, 6, 0.4], ['campus-bell', 28, 60, 0.4, 'day'], ['bird-a', 5, 14, 0.4, 'day'], ['cricket', 1, 2.4, 0.3, 'night']] },
  worship: { beds: [{ c: 'brown', fl: ['lowpass', 220, 0.7], g: 0.22, v: 0.15 }] },
  office: { beds: [{ c: 'brown', fl: ['lowpass', 700, 0.7], g: 0.25, v: 0.1 }, { hum: 120, fl: ['lowpass', 400], g: 0.025 }], shots: [['keys', 2.5, 8, 0.5, 'day']] },
  hall: { beds: [{ c: 'brown', fl: ['lowpass', 600, 0.7], g: 0.2, v: 0.1 }, { hum: 110, fl: ['lowpass', 400], g: 0.02 }] },
  home: { beds: [{ c: 'brown', fl: ['lowpass', 240, 0.7], g: 0.22, v: 0.15 }, { hum: 50, fl: ['lowpass', 300], g: 0.035 }, { hum: 100, fl: ['lowpass', 300], g: 0.012 }], shots: [['cricket', 0.8, 2, 0.3, 'night']] },
  transit: { beds: [{ c: 'brown', fl: ['lowpass', 160, 0.7], g: 0.6, v: 0.2, lfo: [0.9, 0.15] }, { c: 'pink', fl: ['bandpass', 900, 0.6], g: 0.06, v: 0.6 }], shots: [['announce', 24, 55, 0.5], ['car-horn', 12, 30, 0.3]] },
  industry: { beds: [{ c: 'brown', fl: ['lowpass', 200, 0.7], g: 0.5, v: 0.15 }, { hum: 60, w: 'triangle', fl: ['lowpass', 300], g: 0.05 }] },
  rain: { beds: [{ c: 'pink', fl: ['bandpass', 2800, 0.4], g: 0.5, v: 0.25 }, { c: 'white', fl: ['highpass', 3500, 0.5], g: 0.05, v: 0.3 }, { c: 'brown', fl: ['lowpass', 250, 0.7], g: 0.2 }] },
  // vehicles (effects bus)
  'ride-bus': { beds: [{ hum: 46, w: 'sawtooth', fl: ['lowpass', 200], g: 0.16, lfo: [23, 0.35] }, { c: 'brown', fl: ['lowpass', 260, 0.7], g: 0.5, v: 0.15 }] },
  'ride-keke': { beds: [{ hum: 75, w: 'sawtooth', fl: ['lowpass', 420], g: 0.12, lfo: [11, 0.6] }, { c: 'brown', fl: ['lowpass', 300, 0.7], g: 0.3, v: 0.2 }] },
  'ride-okada': { beds: [{ hum: 110, w: 'sawtooth', fl: ['lowpass', 600], g: 0.1, lfo: [17, 0.5] }, { c: 'pink', fl: ['bandpass', 1600, 0.5], g: 0.04, v: 0.5 }] },
  'ride-car': { beds: [{ hum: 62, w: 'sawtooth', fl: ['lowpass', 200], g: 0.1, lfo: [8, 0.15] }, { c: 'pink', fl: ['highpass', 600, 0.5], g: 0.03 }, { c: 'brown', fl: ['lowpass', 250, 0.7], g: 0.25 }] },
  'ride-boat': { beds: [{ c: 'brown', fl: ['lowpass', 520, 0.6], g: 0.45, lfo: [0.35, 0.6] }, { hum: 52, w: 'sawtooth', fl: ['lowpass', 220], g: 0.08, lfo: [9, 0.5] }], shots: [['lap', 0.5, 1.4, 0.5]] },
  'ride-rail': { beds: [{ c: 'brown', fl: ['lowpass', 200, 0.7], g: 0.45, lfo: [0.5, 0.3] }], shots: [['clack', 0.58, 0.64, 0.7]] },
  'ride-air': { beds: [{ c: 'pink', fl: ['lowpass', 700, 0.6], g: 0.3, v: 0.1 }, { c: 'brown', fl: ['lowpass', 180, 0.7], g: 0.3 }] },
  'ride-walk': { shots: [['step-path', 0.46, 0.52, 0.8]] },
  // activities (effects bus)
  'act-food': { shots: [['bite', 0.9, 1.6, 0.6], ['clink', 2.5, 5, 0.5]] },
  'act-food-kitchen': { beds: [{ c: 'white', fl: ['highpass', 4500, 0.5], g: 0.03, v: 0.8 }], shots: [['bite', 1.1, 1.8, 0.5], ['sizzle', 0.08, 0.24, 0.5], ['clink', 3, 6, 0.4]] },
  'act-cook': { beds: [{ c: 'white', fl: ['highpass', 4500, 0.5], g: 0.035, v: 0.8 }], shots: [['sizzle', 0.06, 0.2, 0.6], ['tool', 2, 4.5, 0.4]] },
  'act-drink': { shots: [['sip', 1.6, 2.6, 0.6]] },
  'act-wash': { beds: [{ c: 'pink', fl: ['bandpass', 3200, 0.5], g: 0.1, v: 0.2 }], shots: [['splash', 0.08, 0.2, 0.5]] },
  'act-sleep': { shots: [['breath', 3.4, 4.4, 0.5]] },
  'act-keys': { shots: [['key', 0.09, 0.3, 0.6], ['keys', 3, 7, 0.4]] },
  'act-tool': { shots: [['tool', 0.5, 1.0, 0.7]] },
  'act-work': { shots: [['tick', 0.55, 0.9, 0.4]] },
  'act-move': { shots: [['step-floor', 0.42, 0.52, 0.9]] },
  'act-seed': { shots: [['seed', 0.6, 1.3, 0.7]] },
  'act-card': { shots: [['card', 0.8, 1.7, 0.7]] },
  'act-crowd': { shots: [['crowd-swell', 4, 9, 0.7]] },
}

/** Scene kind (SceneKind in the content types) -> the place scape. Unlisted kinds use the city. */
export const PLACES: Readonly<Record<string, string>> = {
  market: 'market', mall: 'market', buka: 'market', park: 'park', rooftop: 'city', walk: 'city', beach: 'water', unilag: 'campus',
  worship: 'worship', shrine: 'worship', office: 'office', statehouse: 'office', police: 'hall', hospital: 'hall', radio: 'hall', polling: 'hall',
  salon: 'hall', gym: 'hall', club: 'hall', viewing: 'hall', home: 'home', hub: 'transit', airport: 'transit', refinery: 'industry',
}
/** Kinds where a footstep is on grass / sand / a path; every other kind is a floor. */
export const SURFACES: Readonly<Record<string, string>> = { park: 'grass', walk: 'path', rooftop: 'floor', beach: 'sand', hub: 'path', unilag: 'path', market: 'path', shrine: 'path' }
/** Enclosed kinds: weather is quieter inside, and a door is heard on arriving. */
export const INDOORS: ReadonlySet<string> = new Set(['buka', 'club', 'gym', 'hospital', 'home', 'mall', 'office', 'police', 'polling', 'radio', 'salon', 'statehouse', 'viewing', 'worship'])
/** How a trip sounds, by travel mode (trips inside a city) or link mode (trips between cities). */
export const RIDES: Readonly<Record<string, { scape: string; start?: string; end?: string }>> = {
  trek: { scape: 'ride-walk' }, keke: { scape: 'ride-keke' }, danfo: { scape: 'ride-bus', start: 'trip-bus' }, okada: { scape: 'ride-okada' },
  cab: { scape: 'ride-car' }, car: { scape: 'ride-car' }, boat: { scape: 'ride-boat' },
  road: { scape: 'ride-bus', start: 'trip-bus' }, rail: { scape: 'ride-rail' }, air: { scape: 'ride-air', start: 'trip-air', end: 'arrive-air' },
}
/** What an activity sounds like, first match wins: by id pattern, then by tag. */
export const ACTIVITIES: readonly { id?: string; tag?: string; scape: string; start?: string; end?: string; kitchen?: string }[] = [
  { id: 'ayo', scape: 'act-seed' },
  { id: 'whot|card', scape: 'act-card' },
  { id: 'cook|fry|grill|suya|bake|stove', scape: 'act-cook' },
  { tag: 'sleep', scape: 'act-sleep', start: 'sleep', end: 'wake' },
  { tag: 'hygiene', scape: 'act-wash' },
  { tag: 'cooking', scape: 'act-cook' },
  { tag: 'food', scape: 'act-food', kitchen: 'act-food-kitchen' },
  { tag: 'drink', scape: 'act-drink' },
  { tag: 'workout', scape: 'act-move' },
  { tag: 'work', scape: 'act-work', end: 'shift-done' },
  { tag: 'gig', scape: 'act-work', end: 'shift-done' },
]
/** Where the work sounds are keys rather than tools. */
export const KEY_KINDS: ReadonlySet<string> = new Set(['office', 'radio', 'statehouse', 'polling', 'police'])
