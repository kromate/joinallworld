import { loadCityContent as preloadCityContent } from '../../../game/cities/registry.ts';
await Promise.all(['lagos', 'ibadan'].map(preloadCityContent));
// The Community store, against a fake game and a fake controller: loading with the bounded retry and
// what it says while it fails, opening and the rules for when it may not open, the room following the
// life, member positions for the scene, and the refusal toast, now taken from state.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ref, shallowRef, nextTick } from 'vue'
import { createCommunityStore, loadStatusLine, notConnected, positionsOf, recoveryNext } from './communityStore.ts'
import type { CommunityDeps, CommunityStore } from './communityStore.ts'
import { communityState, fakeController } from './communityFixtures.ts'
import type { FakeController } from './communityFixtures.ts'
import type { MembersEvent } from '../../../types/community.ts'
import type { LifeState } from '../../../types/life.ts'

interface Timer { fn: () => void; ms: number; live: boolean }
const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

function rig(options: { fail?: number; connected?: boolean; location?: string; startFails?: boolean } = {}) {
  const location = options.location ?? 'park'
  const game = {
    state: shallowRef({ location, activeAction: null } as unknown as LifeState),
    cityId: ref('lagos'), connected: ref(options.connected ?? true), link: ref('online'),
    handlers: {} as Record<string, ((...args: never[]) => void)[]>,
    on(event: string, handler: (...args: never[]) => void) { (this.handlers[event] ??= []).push(handler); return () => {} },
    emit(event: string, ...args: unknown[]) { for (const handler of this.handlers[event] ?? []) (handler as (...values: unknown[]) => void)(...args) },
  }
  const log = { status: [] as [string, boolean | undefined][], toasts: [] as [string, string | undefined][], members: [] as MembersEvent[], chunk: [] as unknown[], captured: [] as unknown[] }
  const timers: Timer[] = []
  const made: FakeController[] = []
  let failures = options.fail ?? 0
  const deps: CommunityDeps = {
    game: game as unknown as CommunityDeps['game'],
    venueLabel: (venueId) => `Venue ${venueId}`,
    status: (text, error) => log.status.push([text, error]),
    toast: (text, kind) => log.toasts.push([text, kind]),
    onMembers: (event) => log.members.push(event),
    walkBy: () => true,
    telemetry: { chunkFailed: (name, error) => log.chunk.push([name, error]), captureError: (error, context) => log.captured.push([error, context]) },
    loadModule: async () => {
      if (failures > 0) { failures--; throw new Error('Failed to fetch dynamically imported module') }
      return { createCommunity: async (opts) => { if (options.startFails) throw new Error('boom'); const controller = fakeController(opts); made.push(controller); return controller } }
    },
    lazy: { setTimeout: (fn, ms) => { const timer = { fn, ms, live: true }; timers.push(timer); return timer }, clearTimeout: (timer) => { (timer as Timer).live = false } },
    reload: () => { log.status.push(['reload', undefined]) },
  }
  const store: CommunityStore = createCommunityStore(deps)
  const fire = async (): Promise<void> => { const timer = timers.filter((item) => item.live).at(-1) as Timer; timer.live = false; timer.fn(); await settle() }
  return { game, store, log, made, timers, fire }
}

test('the controller starts once the game is connected, with the venue the life is in, and nothing is asked of the microphone', async () => {
  const { store, made, log, game } = rig()
  await store.ensure(); await store.start()
  assert.equal(made.length, 1, 'safe to call any number of times')
  const controller = made[0] as FakeController
  assert.equal(controller.options.cityId, 'lagos')
  assert.equal(controller.options.venueId, 'park')
  assert.equal(controller.options.venueName?.('library', 'lagos'), 'Venue library')
  assert.equal(controller.options.onStep?.(0, -2), true)
  controller.options.onStatus?.({ connected: true, session: null, status: 'online' })
  controller.options.onStatus?.({ connected: false, session: null, status: 'offline' })
  assert.deepEqual(log.status, [['Connected · progress saved', undefined], ['Community disconnected · reconnect in panel', true]])
  assert.equal(store.running.value, true)
  assert.equal(store.state.value?.roomText, 'Lagos · The Park')
  assert.equal(controller.calls.includes('joinVoice'), false)
  void game
})

test('nothing starts while the game is not connected', async () => {
  const { store, made, game } = rig({ connected: false })
  await store.start()
  assert.equal(made.length, 0)
  game.connected.value = true
  await store.start()
  assert.equal(made.length, 1)
})

test('member positions feed the scene, self excluded, and the game is told as well', async () => {
  const { store, made, log } = rig()
  await store.start()
  const event: MembersEvent = { self: 'a', members: [{ id: 'a', name: 'Alex', position: { x: 1, z: 1 } }, { id: 'b', name: 'Bea', position: { x: 6, z: -2 } }, { id: 'c', name: 'Cy', position: null }] }
  ;(made[0] as FakeController).options.onMembers?.(event)
  assert.deepEqual(store.positions.value, { b: { x: 6, z: -2 } })
  assert.deepEqual(log.members.at(-1), event)
  assert.deepEqual(positionsOf({ self: null, members: [] }), {})
  assert.equal(store.moveTo(3, 4), true)
  assert.ok((made[0] as FakeController).calls.includes('moveTo 3,4'))
})

test('a chunk that fails is retried 1, 2, 4 s, said so on the status line, and comes up by itself when it arrives', async () => {
  const { store, log, fire, made, timers } = rig({ fail: 2 })
  await store.start()
  assert.equal(store.load.value.status, 'retrying')
  assert.deepEqual(log.status.at(-1), ['Community did not load · retrying in 1 s (attempt 2 of 6)', true])
  assert.equal(store.recovery.value?.heading, 'Community could not load')
  assert.equal(store.recovery.value?.next, 'Trying again by itself in 1 s (attempt 2 of 6).')
  assert.equal(timers.at(-1)?.ms, 1000)
  await fire()
  assert.equal(timers.at(-1)?.ms, 2000)
  assert.equal(made.length, 0)
  await fire()
  await settle()
  assert.equal(made.length, 1, 'a retry that succeeded by itself starts it, without waiting for the player')
  assert.equal(store.recovery.value, null)
  assert.equal(store.load.value.status, 'ready')
})

test('a chunk that never arrives ends in failed with telemetry, and the recovery says to reload', async () => {
  const { store, log, fire } = rig({ fail: 99 })
  await store.start()
  for (let i = 0; i < 5; i++) await fire()
  assert.equal(store.load.value.status, 'failed')
  assert.deepEqual(log.status.at(-1), ['Community is unavailable · it did not load. Open Community to retry', true])
  assert.deepEqual(log.chunk, [['community', 'Failed to fetch dynamically imported module']])
  assert.equal(store.recovery.value?.next, 'It was tried several times and is no longer being retried. Reload to try again.')
  store.toggle()
  assert.equal(store.open.value, true, 'with the recovery showing, the panel opens to say so')
  store.reload()
  assert.deepEqual(log.status.at(-1), ['reload', undefined])
})

test('code that loaded but could not start says so and reports it', async () => {
  const { store, log } = rig({ startFails: true })
  const quiet = console.error
  console.error = () => {}
  try { await store.start() } finally { console.error = quiet }
  assert.equal(log.captured.length, 1)
  assert.deepEqual((log.captured[0] as unknown[])[1], { chunk: 'community' })
  assert.deepEqual(log.status.at(-1), ['Community is unavailable · it could not start. Open Community to retry', true])
  assert.equal(store.recovery.value?.next, 'Its code loaded but it could not start.')
})

test('opening: private at home, honest when offline, a wait while the first load is in flight', async () => {
  const home = rig({ location: 'home' })
  home.store.toggle()
  assert.deepEqual(home.log.toasts.at(-1), ['Your home is private. Visit a public venue to meet people.', undefined])
  assert.equal(home.store.open.value, false)

  const offline = rig({ connected: false })
  offline.game.link.value = 'offline'
  offline.store.toggle()
  assert.equal(offline.log.toasts.at(-1)?.[0], notConnected('offline', 'open the community'))
  assert.equal(offline.log.toasts.at(-1)?.[1], 'error')
  assert.match(offline.log.toasts.at(-1)?.[0] ?? '', /no internet/i)

  const early = rig()
  early.store.toggle()
  assert.deepEqual(early.log.toasts.at(-1), ['Community is still loading. Try again in a moment.', undefined])
  assert.equal(early.store.open.value, false)
  await settle()
  assert.equal(early.made.length, 1, 'asking started it')
  early.store.toggle()
  assert.equal(early.store.open.value, true)
  early.store.toggle(false)
  assert.equal(early.store.open.value, false)
  early.store.toggle(true)
  assert.equal(early.store.open.value, true)
  early.store.close()
  assert.equal(early.store.open.value, false)
})

test('"Try again" asks the loader at once, and says why it cannot when the game is offline', async () => {
  const { store, game, log, made } = rig({ fail: 1 })
  await store.start()
  game.connected.value = false
  game.link.value = 'unreachable'
  store.retry()
  assert.equal(log.toasts.at(-1)?.[1], 'error')
  game.connected.value = true
  store.retry()
  await settle(); await settle()
  assert.equal(made.length, 1)
})

test('the room follows the life: arrival, a new city, home closes the panel', async () => {
  const { store, game, made } = rig()
  await store.start()
  const controller = made[0] as FakeController
  const park = game.state.value
  game.state.value = { ...park, location: 'library' } as LifeState
  game.emit('accepted', game.state.value, park)
  assert.deepEqual(controller.calls.filter((c) => c.startsWith('join')), ['join lagos,library'])
  game.emit('accepted', game.state.value, game.state.value)
  assert.equal(controller.calls.filter((c) => c.startsWith('join')).length, 1, 'same place: no join')
  game.cityId.value = 'ibadan'
  await nextTick()
  assert.equal(controller.calls.at(-1), 'join ibadan,library')
  store.toggle(true)
  const library = game.state.value
  game.state.value = { ...library, location: 'home' } as LifeState
  game.emit('accepted', game.state.value, library)
  assert.equal(store.open.value, false, 'home is private')
})

test('a session that ended destroys the controller and empties the scene crowd', async () => {
  const { store, game, made, log } = rig()
  await store.start()
  ;(made[0] as FakeController).options.onMembers?.({ self: 'a', members: [{ id: 'b', name: 'Bea', position: { x: 1, z: 2 } }] })
  assert.deepEqual(store.positions.value, { b: { x: 1, z: 2 } })
  game.emit('expired')
  assert.equal((made[0] as FakeController).destroyed, true)
  assert.deepEqual(store.positions.value, {})
  assert.deepEqual(log.members.at(-1), { self: 'a', members: [] })
  assert.equal(store.running.value, false)
  game.emit('session', { id: 'z', name: 'Z' }, false)
  await store.start()
  assert.equal(made.length, 2, 'it can start again for the next life')
  game.emit('session', { id: 'y', name: 'Y' }, true)
  assert.equal((made[1] as FakeController).destroyed, true)
})

test('a refused venue chat line is repeated as a toast once, from state', async () => {
  const { store, made, log } = rig()
  await store.start()
  const options = (made[0] as FakeController).options
  options.onChange?.(communityState({ chat: [{ key: 'k', author: 'Alex', body: 'bad', delivery: 'Not sent', canRetry: true }], feedback: 'That wording is not allowed here.', refusal: { seq: 1, text: 'That wording is not allowed here.' } }))
  options.onChange?.(communityState({ refusal: { seq: 1, text: 'That wording is not allowed here.' } }))
  assert.deepEqual(log.toasts, [['That wording is not allowed here.', 'error']], 'the same refusal is not announced twice')
  options.onChange?.(communityState({ refusal: { seq: 2, text: 'You are muted.' } }))
  assert.deepEqual(log.toasts.at(-1), ['You are muted.', 'error'])
})

test('the words are the old shell’s', () => {
  const base = { status: 'loading', attempt: 1, attempts: 6, retryInMs: null, error: null } as const
  assert.equal(recoveryNext(base, false), 'Trying again now…')
  assert.equal(recoveryNext({ ...base, status: 'retrying', retryInMs: 4000, attempt: 3 }, false), 'Trying again by itself in 4 s (attempt 4 of 6).')
  assert.equal(loadStatusLine({ ...base, status: 'retrying', retryInMs: 2000, attempt: 2 }), 'Community did not load · retrying in 2 s (attempt 3 of 6)')
  assert.equal(loadStatusLine({ ...base, status: 'ready' }), null)
  assert.equal(notConnected('online', 'open the community'), 'You are not connected yet, so you cannot open the community. Try again in a moment.')
})
