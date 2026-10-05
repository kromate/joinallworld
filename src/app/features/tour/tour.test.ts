// The walkthrough's pure parts: where the card goes, which steps show, when the tour is due and how "seen" is kept,
// and that every key the shortcuts sheet lists has a handler.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { SHORTCUTS, shortcutFor } from '../../../ui/keys.ts'
import { placeCard, spotlightOf } from './placement.ts'
import type { Rect, Size } from './placement.ts'
import { shortcutGroups, keysOf } from './shortcutsModel.ts'
import { STEPS, isDone, playlist, seek, showable, wordsOf } from './tourModel.ts'
import type { StepContext } from './tourModel.ts'
import { TOUR_KEY, markTourSeen, tourDue, tourSeen } from './tourSeen.ts'
import type { TourFacts } from './tourSeen.ts'

const here = (path: string): string => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const inside = (box: { left: number; top: number }, card: Size, view: Size, margin = 12): boolean => box.left >= margin && box.top >= margin && box.left + card.width <= view.width - margin && box.top + card.height <= view.height - margin
const overlap = (a: Rect, b: Rect): boolean => a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height

const VIEWS: Size[] = [{ width: 390, height: 844 }, { width: 1280, height: 800 }, { width: 3440, height: 1440 }]

test('the card is always on screen and clear of the target, at a phone and at an ultra-wide display, with the target on every edge', () => {
  for (const view of VIEWS) {
    const card: Size = { width: Math.min(360, view.width - 24), height: 220 }
    const small = { width: 90, height: 48 }
    const spots: Rect[] = [
      { left: 0, top: 0, ...small }, { left: view.width - small.width, top: 0, ...small }, { left: 0, top: view.height - small.height, ...small }, { left: view.width - small.width, top: view.height - small.height, ...small },
      { left: (view.width - small.width) / 2, top: 0, ...small }, { left: (view.width - small.width) / 2, top: view.height - small.height, ...small },
      { left: 0, top: (view.height - small.height) / 2, ...small }, { left: view.width - small.width, top: (view.height - small.height) / 2, ...small },
      { left: (view.width - small.width) / 2, top: (view.height - small.height) / 2, ...small },
    ]
    for (const target of spots) {
      const put = placeCard(target, card, view)
      assert.ok(inside(put, card, view), `${view.width}x${view.height} target ${target.left},${target.top}: card at ${put.left},${put.top}`)
      assert.equal(put.overlaps, false)
      assert.ok(!overlap({ left: put.left, top: put.top, ...card }, target), 'the card does not cover the target')
      if (put.arrow !== null) assert.ok(put.arrow >= 0 && put.arrow <= (put.side === 'left' || put.side === 'right' ? card.height : card.width))
    }
  }
})

test('with no target the card is centred; with a target as big as the screen it sits on screen and says it overlaps', () => {
  for (const view of VIEWS) {
    const card = { width: Math.min(360, view.width - 24), height: 220 }
    const middle = placeCard(null, card, view)
    assert.deepEqual([middle.side, middle.arrow], ['center', null])
    assert.equal(Math.round(middle.left + card.width / 2), Math.round(view.width / 2))
    const huge = placeCard({ left: 0, top: 0, width: view.width, height: view.height }, card, view)
    assert.equal(huge.overlaps, true)
    assert.ok(inside(huge, card, view))
  }
})

test('the card prefers the roomier vertical side, honours a preference that fits, and falls back to the side', () => {
  const view = VIEWS[1] as Size, card = { width: 360, height: 200 }
  assert.equal(placeCard({ left: 100, top: 20, width: 100, height: 40 }, card, view).side, 'bottom')
  assert.equal(placeCard({ left: 100, top: 700, width: 100, height: 40 }, card, view).side, 'top')
  assert.equal(placeCard({ left: 100, top: 300, width: 100, height: 40 }, card, view, { prefer: 'top' }).side, 'top')
  const tall = placeCard({ left: 20, top: 10, width: 200, height: 780 }, card, view)
  assert.equal(tall.side, 'right')
  assert.ok(tall.left >= 20 + 200)
})

test('the spotlight is the target plus padding, kept on screen, with rounded corners that never exceed half the box', () => {
  const view = VIEWS[0] as Size
  const edge = spotlightOf({ left: 2, top: 2, width: 100, height: 40 }, view)
  assert.deepEqual([edge.left, edge.top], [0, 0])
  assert.equal(edge.width, 110)
  assert.ok(edge.radius <= Math.min(edge.width, edge.height) / 2)
  const pill = spotlightOf({ left: 20, top: 20, width: 200, height: 40 }, view, { radius: 999 })
  assert.equal(pill.radius, pill.height / 2)
})

const context = (present: string[], extra: Partial<StepContext> = {}): StepContext => ({ home: false, touch: false, has: (id) => present.includes(id), ...extra })
const ALL = ['needs', 'hud', 'goal', 'place', 'nav-map', 'nav-phone', 'map-card', 'phone-apps', 'community']
const titles = (steps: readonly { title: string }[]): string[] => steps.map((step) => step.title)

test('the tour is short, starts with a welcome and ends with the set card', () => {
  assert.ok(STEPS.length >= 7 && STEPS.length <= 10)
  assert.equal(STEPS[0]?.id, 'welcome'); assert.equal(STEPS.at(-1)?.id, 'done')
  assert.match(wordsOf(STEPS[0]!, context([]), false).text, /show you around.*skip any time/)
  assert.match(wordsOf(STEPS.at(-1)!, context([]), false).text, /Phone, then Help, then Take the tour.*\?/)
})

test('steps whose target is missing are skipped, in both directions, and the optional people step needs one of its targets', () => {
  const noGoal = context(ALL.filter((id) => id !== 'goal'))
  const list = playlist(STEPS, noGoal)
  const at = (title: string): number => list.findIndex((step) => step.title === title)
  assert.equal(seek(list, at('Time, mood and cash'), 1, noGoal), at('Spots and activities'))
  assert.equal(seek(list, at('Spots and activities'), -1, noGoal), at('Time, mood and cash'))
  assert.equal(seek(list, list.length - 1, 1, noGoal), -1, 'past the end')
  assert.equal(seek(list, 0, -1, noGoal), -1, 'before the start')
  const home = playlist(STEPS, context(ALL.filter((id) => id !== 'community')))
  assert.ok(!titles(home).includes('People'), 'no online pill, community or invite on screen: no people step')
  assert.ok(titles(playlist(STEPS, context(['invite']))).includes('People'), 'the invite button alone lights it once that build is merged')
  assert.ok(showable(STEPS[0]!, context([])), 'a step with no target always shows')
  const nothing = context([])
  assert.deepEqual(titles(playlist(STEPS, nothing)).filter((_, i, all) => i === 0 || i === all.length - 1), ['Welcome to Allworld', 'You’re set'])
})

test('the people step says only what is on screen', () => {
  const people = STEPS.find((step) => step.id === 'people')!
  const say = (present: string[]): string => wordsOf(people, context(present), false).text
  assert.doesNotMatch(say(['community']), /Call|Invite/)
  assert.match(say(['community', 'call']), /Call a friend/)
  assert.match(say(['online', 'invite']), /Invite to bring a friend with your link/)
})

test('the activity step speaks of the home when the player lands there; interactive steps change their words when done', () => {
  const place = STEPS.find((step) => step.id === 'place')!
  assert.match(wordsOf(place, context([], { home: true }), false).text, /Your home has spots/)
  assert.match(wordsOf(place, context([]), false).text, /Every place has spots/)
  assert.ok(wordsOf(place, context([]), false).task)
  assert.equal(wordsOf(place, context([]), true).task, null)
  const map = STEPS.find((step) => step.id === 'map')!
  assert.match(wordsOf(map, context([]), true).text, /atlas/)
  assert.deepEqual(map.doneTargets, ['map-card'])
  for (const step of STEPS) assert.ok(!/\b(Google|Apple|Duolingo|Shepherd|Intro\.js|Driver\.js)\b/.test(JSON.stringify(wordsOf(step, context(ALL), false))))
})

test('what each waiting step waits for', () => {
  const facts = { activeAction: false, mode: 'venue', sheet: null as string | null }
  assert.equal(isDone('activity', facts), false); assert.equal(isDone('activity', { ...facts, activeAction: true }), true)
  assert.equal(isDone('map', facts), false); assert.equal(isDone('map', { ...facts, mode: 'map' }), true)
  assert.equal(isDone('phone', { ...facts, sheet: 'sim' }), false); assert.equal(isDone('phone', { ...facts, sheet: 'phone' }), true)
  assert.equal(isDone(undefined, { ...facts, mode: 'map' }), false)
})

const memory = (): Pick<Storage, 'getItem' | 'setItem'> & { data: Map<string, string> } => { const data = new Map<string, string>(); return { data, getItem: (key) => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value) } } }
const fresh: TourFacts = { connected: true, creating: false, who: 'p1', activities: 0, firstAt: null, seen: false, hintsOff: false, busy: false, hudReady: true }

test('"seen" is kept per player and survives a reload, and a broken store is just "not seen"', () => {
  const store = memory()
  assert.equal(tourSeen(store, 'p1'), false)
  markTourSeen(store, 'p1'); markTourSeen(store, 'p1'); markTourSeen(store, 'p2')
  assert.deepEqual(JSON.parse(store.data.get(TOUR_KEY) ?? '[]'), ['p1', 'p2'])
  assert.equal(tourSeen(store, 'p1'), true); assert.equal(tourSeen(store, 'p3'), false)
  assert.equal(tourSeen({ getItem: () => '{not json' }, 'p1'), false)
  assert.equal(tourSeen(null, 'p1'), false)
  assert.doesNotThrow(() => markTourSeen({ getItem: () => null, setItem: () => { throw new Error('full') } }, 'p1'))
  for (let n = 0; n < 40; n++) markTourSeen(store, `x${n}`)
  assert.ok(JSON.parse(store.data.get(TOUR_KEY) ?? '[]').length <= 24)
})

test('the tour is due once, after landing, and never over anything', () => {
  assert.equal(tourDue(fresh), 'start')
  assert.equal(tourDue({ ...fresh, creating: true }), 'wait', 'never over the creator')
  assert.equal(tourDue({ ...fresh, busy: true }), 'wait', 'never over an activity, a call, a sheet or the map')
  assert.equal(tourDue({ ...fresh, hudReady: false }), 'wait', 'deferred until the HUD is drawn')
  assert.equal(tourDue({ ...fresh, connected: false }), 'wait')
  assert.equal(tourDue({ ...fresh, seen: true }), 'never', 'once per player, skip counts')
  assert.equal(tourDue({ ...fresh, activities: 1 }), 'never', 'a life that has played is not new, on any device')
  assert.equal(tourDue({ ...fresh, firstAt: 5 }), 'never')
  assert.equal(tourDue({ ...fresh, hintsOff: true }), 'never', 'Hints off: no tour by itself')
})

test('the tour keeps the attention ring, the coach line and the settle-in offer quiet, and they resume', () => {
  const attention = here('../hud/useAttention.ts'), chip = here('../life/GoalChip.vue')
  assert.match(attention, /if \(tour\.active\) \{[^}]*attention\?\.clear\(\)[^}]*return/, 'no ring or bubble while the tour is up')
  assert.match(attention, /\(\) => tour\.active\]/, 'they are drawn again when it ends')
  assert.match(attention, /if \(tour\.active\) \{ lastCash/, 'the money pill waits too')
  assert.match(chip, /!now\.connected \|\| tour\.active/); assert.match(chip, /!tour\.active\n?/)
  assert.match(chip, /watch\(\(\) => tour\.active, \(on\) => \{ if \(!on\) bookkeeping\(\) \}/, 'the offer is looked at again after the tour')
})

test('every key the shortcuts sheet lists has a handler, and the gestures are only on the touch list', () => {
  const shell = here('../../App.vue')
  const verbs = new Set<string>()
  for (const group of shortcutGroups(false)) for (const row of group.rows) {
    if (row.native || !row.runs.length) { assert.ok(row.native || !keysOf(row).length); continue }
    assert.ok(keysOf(row).length > 0, row.text)
    for (const run of row.runs) assert.ok(SHORTCUTS.some((shortcut) => shortcut.run === run), `${run} is bound`)
    for (const key of keysOf(row)) {
      const found = shortcutFor({ key })
      assert.ok(found, `${key} (${row.text}) has a binding`)
      verbs.add(found.run.split(':')[0] as string)
    }
  }
  for (const verb of verbs) assert.ok(verb === 'key' ? shell.includes("verb === 'key'") : new RegExp(`verb === '${verb}'|verb === '${verb}' \\|\\||'${verb}'`).test(shell), `the shell handles ${verb}`)
  assert.ok(shortcutGroups(false).every((group) => group.rows.length))
  assert.ok(shortcutGroups(true).every((group) => group.rows.every((row) => !row.runs.length)), 'touch rows are gestures')
  assert.deepEqual(shortcutGroups(false).map((group) => group.id), ['move', 'camera', 'map', 'panels', 'chat', 'general'])
  const caps = shortcutGroups(false).flatMap((group) => group.rows.flatMap((row) => row.caps))
  for (const cap of ['W', 'A', 'S', 'D', 'M', 'P', 'I', 'H', '?', 'Esc', 'Shift']) assert.ok(caps.includes(cap), cap)
})
