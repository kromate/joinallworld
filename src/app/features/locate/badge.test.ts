// The badge feed and the badge words: who is asked about, when, and that the wording is honest.
import assert from 'node:assert/strict'
import test from 'node:test'
import type { WorldBadge } from '../../../types/world.ts'
import { BADGE_BATCH, REFRESH_MS, createBadgeFeed } from './badgeFeed.ts'
import { BADGE_NOTE, badgeLong, badgeShort } from './badgeWords.ts'

/** A clock the test turns by hand. */
function clock() {
  const timers: { fn: () => void; at: number; every: number | null; live: boolean }[] = []
  let now = 0
  return {
    setTimeout: (fn: () => void, ms: number) => { const timer = { fn, at: now + ms, every: null, live: true }; timers.push(timer); return timer },
    setInterval: (fn: () => void, ms: number) => { const timer = { fn, at: now + ms, every: ms, live: true }; timers.push(timer); return timer },
    clearInterval: (timer: unknown) => { (timer as { live: boolean }).live = false },
    advance(ms: number) {
      const end = now + ms
      for (;;) {
        const next = timers.filter((timer) => timer.live && timer.at <= end).sort((a, b) => a.at - b.at)[0]
        if (!next) break
        now = next.at
        if (next.every) next.at += next.every; else next.live = false
        next.fn()
      }
      now = end
    },
    running: () => timers.filter((timer) => timer.live && timer.every).length,
  }
}
const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

test('the players on a screen are asked about in one request, and again on a timer, so a switched-off badge goes without a reload', async () => {
  const time = clock()
  const asked: string[][] = []
  let live: Record<string, WorldBadge> = { a: { lga: 'ikeja', name: 'Ikeja' }, b: { lga: null, name: null } }
  const cache: Record<string, WorldBadge | null> = {}
  const feed = createBadgeFeed({
    fetchJson: (async (path: string, options?: { body?: { ids: string[] } }) => { assert.equal(path, '/api/world/badges'); asked.push(options?.body?.ids ?? []); return { badges: Object.fromEntries((options?.body?.ids ?? []).filter((id) => id in live).map((id) => [id, live[id]])) } }) as never,
    connected: () => true, visible: () => true, ...time,
  }, cache)
  const releases = ['a', 'b', 'c'].map((id) => feed.want(id))
  assert.deepEqual(asked, [], 'nothing is asked while the list is still being drawn')
  time.advance(100); await settle()
  assert.deepEqual(asked, [['a', 'b', 'c']])
  assert.deepEqual(cache, { a: { lga: 'ikeja', name: 'Ikeja' }, b: { lga: null, name: null }, c: null })
  live = { b: { lga: null, name: null } }
  time.advance(REFRESH_MS); await settle()
  assert.equal(cache.a, null, 'the badge was switched off: it is gone at the next round')
  assert.equal(asked.length, 2)
  feed.want('a')()
  time.advance(100); await settle()
  assert.equal(asked.length, 2, 'a player already known is not asked about again at once')
  for (const release of releases) release()
  assert.equal(time.running(), 0, 'nothing on screen: no timer')
})

test('the timer stops when no badge is on screen, and does not run in a hidden tab or offline', async () => {
  const time = clock()
  let asked = 0, connected = true, visible = true
  const feed = createBadgeFeed({ fetchJson: (async () => { asked += 1; return { badges: {} } }) as never, connected: () => connected, visible: () => visible, ...time }, {})
  const release = feed.want('x')
  time.advance(100); await settle()
  assert.equal(asked, 1)
  visible = false; time.advance(REFRESH_MS); await settle(); assert.equal(asked, 1)
  visible = true; connected = false; time.advance(REFRESH_MS); await settle(); assert.equal(asked, 1)
  connected = true; time.advance(REFRESH_MS); await settle(); assert.equal(asked, 2)
  release(); release()
  assert.equal(time.running(), 0)
  assert.equal(feed.shown(), 0)
})

test('a long list is asked in batches the server accepts, and a failed round keeps the last answer', async () => {
  const time = clock()
  const sizes: number[] = []
  let failing = false
  const cache: Record<string, WorldBadge | null> = { old: { lga: 'ikeja', name: 'Ikeja' } }
  const feed = createBadgeFeed({ fetchJson: (async (_path: string, options?: { body?: { ids: string[] } }) => { if (failing) throw new Error('offline'); sizes.push(options?.body?.ids.length ?? 0); return { badges: {} } }) as never, connected: () => true, visible: () => true, ...time }, cache)
  for (let i = 0; i < BADGE_BATCH + 5; i++) feed.want(`p${i}`)
  feed.want('old')
  time.advance(100); await settle()
  assert.deepEqual(sizes, [BADGE_BATCH, 5], 'BADGE_BATCH at most per request')
  failing = true
  await feed.refresh()
  assert.deepEqual(cache.old, { lga: 'ikeja', name: 'Ikeja' }, 'a failure changes nothing')
})

test('the wording says what a device can say, and never "verified"', () => {
  const named: WorldBadge = { lga: 'ikeja', name: 'Ikeja' }, generic: WorldBadge = { lga: null, name: null }
  assert.equal(badgeLong(named), 'Lives in Ikeja · confirmed by their device')
  assert.equal(badgeLong(named, true), 'Lives in Ikeja · confirmed by your device')
  assert.equal(badgeLong(generic), 'Location-confirmed · confirmed by their device')
  assert.equal(badgeShort(named), 'Ikeja')
  assert.equal(badgeShort(generic), 'Location-confirmed')
  assert.equal(BADGE_NOTE, 'Optional. You can live anywhere in Allworld wherever you are in the real world.')
  for (const text of [badgeLong(named), badgeLong(generic), badgeShort(generic), BADGE_NOTE]) assert.ok(!/verif|identity|nearby|distance|km\b|last seen/i.test(text), text)
})
