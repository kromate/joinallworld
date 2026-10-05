import { loadCityContent as preloadCityContent } from '../../game/cities/registry.ts';
await preloadCityContent('lagos');
// The typed game store over the real client model, against a server that runs the real rules.
// Runs in Node without a DOM: the store is Vue reactivity and the client model only.
import assert from 'node:assert/strict'
import test from 'node:test'
import { watch } from 'vue'
import { createGame } from './game.ts'
import type { ToastKind } from '../types/panel.ts'
import { LINK_STATES } from '../types/client.ts'
import { createFakeServer, memoryStorage } from '../testing/fakeServer.ts'
import { createToasts, toastLifetime } from './toasts.ts'

function setup(options: Parameters<typeof createFakeServer>[0] = {}) {
  const server = createFakeServer(options)
  const said: { text: string; kind: ToastKind }[] = []
  let online = true
  const game = createGame({
    fetch: server.fetch, storage: memoryStorage(), now: () => server.now(), isOnline: () => online,
    // No polling in tests: nothing may keep the process alive.
    setTimeout: () => 0, clearTimeout: () => {},
    toast: (text, kind = 'info') => { said.push({ text: String(text), kind }) },
  })
  return { server, game, said, setOnline: (value: boolean) => { online = value } }
}

test('connect: the store publishes the server life, the session and the link', async () => {
  const { game, server } = setup()
  assert.equal(game.link.value, 'connecting')
  assert.equal(game.connected.value, false)
  assert.equal(await game.connect(), true)
  assert.equal(game.link.value, 'online')
  assert.equal(game.connected.value, true)
  assert.deepEqual(game.session.value, server.session())
  assert.equal(game.state.value.cash, server.life().cash)
  assert.equal(game.view.value.connected, true)
  assert.equal(game.view.value.wallet.cash, game.state.value.cash, 'the view is the engine\'s, for the published state')
  assert.equal(game.view.value.city.name, 'Lagos')
  assert.match(game.net.value.text, /Connected/)
})

test('command: a typed action changes nothing until the server answers, then publishes its state', async () => {
  const { game, server } = setup()
  await game.connect()
  const seen: number[] = []
  const stop = watch(game.state, (state) => { seen.push(state.cash) }, { flush: 'sync' })
  const before = game.state.value
  const pending = game.command('spot', { id: 'bedroom' })
  assert.equal(game.saving.value, 1, 'the store says an action is on its way')
  assert.equal(game.state.value, before, 'nothing is applied locally')
  const result = await pending
  assert.equal(game.saving.value, 0)
  assert.equal(result.ok, true)
  assert.equal(game.state.value.spot, 'bedroom')
  assert.notEqual(game.state.value, before, 'the state object is replaced, never mutated')
  assert.equal(seen.length, 1, 'one published state for one accepted answer')
  const sent = server.requests.at(-1)
  assert.equal(sent?.path, '/api/action')
  assert.match(String(sent?.body?.actionId), /^\d+:[0-9a-f-]{36}$/, 'a timed action id: <server ms>:<uuid>')
  assert.deepEqual([sent?.body?.type, sent?.body?.cityId, sent?.body?.payload], ['spot', 'lagos', { id: 'bedroom' }])
  stop()
})

test('command: a refusal comes back with its code and the server\'s sentence, and is shown once', async () => {
  const { game, said } = setup()
  await game.connect()
  const result = await game.command('economy.pay-rent')
  assert.equal(result.ok, false)
  assert.equal(result.code, 'nothing_due')
  assert.ok(result.reason, 'a refusal always carries its reason')
  assert.deepEqual(said.filter((item) => item.kind === 'error').map((item) => item.text), [result.reason])
})

test('command: offline, nothing is sent and nothing changes', async () => {
  const { game, server, setOnline } = setup()
  await game.connect()
  server.fault.offline = true; setOnline(false)
  const lost = await game.command('spot', { id: 'bedroom' })
  assert.equal(lost.ok, false)
  assert.equal(game.link.value, 'offline', 'the device itself has no network')
  assert.equal(game.connected.value, false)
  const sent = server.requests.length
  const refused = await game.command('spot', { id: 'bedroom' })
  assert.deepEqual([refused.ok, refused.code], [false, 'offline'])
  assert.equal(server.requests.length, sent, 'while offline the action is not even attempted')
  assert.notEqual(game.state.value.spot, 'bedroom')
})

test('the link says why the game is not playable: unreachable, expired, new', async () => {
  const down = setup()
  await down.game.connect()
  down.server.fault.status = 502
  await down.game.refresh()
  assert.equal(down.game.link.value, 'unreachable', 'the device is online but the server did not answer')

  const reset = setup()
  await reset.game.connect()
  reset.server.dropSession()
  let expired = 0
  reset.game.on('expired', () => { expired += 1 })
  await reset.game.refresh()
  assert.equal(reset.game.link.value, 'expired', 'the server is up but no longer knows this session')
  assert.equal(expired, 1)

  const fresh = setup({ onboarded: false })
  let asked = 0
  fresh.game.on('needName', () => { asked += 1 })
  assert.equal(await fresh.game.connect(), false)
  assert.equal(fresh.game.link.value, 'new')
  assert.equal(asked, 1)
  assert.equal(await fresh.game.connect(true, 'Amaka'), true)
  assert.equal(fresh.game.state.value.name, 'Amaka')
  assert.equal(fresh.game.view.value.onboarding.required, true, 'a new life is held until its look is confirmed')
  for (const link of [down.game.link.value, reset.game.link.value, fresh.game.link.value]) assert.ok((LINK_STATES as readonly string[]).includes(link))
})

test('a new life is a guest of the quick start: held for its look, then playing; a resent Play is applied once', async () => {
  const { game, server, said } = setup({ onboarded: false })
  await game.connect()
  assert.equal(await game.connect(true, 'Amaka'), true)
  const held = game.view.value.onboarding
  assert.deepEqual([held.stage, held.guest, held.required, held.done], ['guest', true, true, false])
  const refused = await game.command('spot', { id: 'trees' })
  assert.deepEqual([refused.ok, refused.code], [false, 'onboarding_required'], 'nothing but onboarding.* is accepted until the look is confirmed')

  // The id is made once and kept by the caller, so a retry is the same action to the server.
  const id = game.newId()
  const look = { body: 'woman', hair: 'braids', outfit: 'casual', fabric: 'plain', skin: 'skin-4', hairColor: 'black', outfitColor: 'green', bottomsColor: 'navy' } as const
  const toasts = said.length
  const played = await game.resend(id, 'onboarding.quick-start', { look })
  assert.deepEqual([played.ok, played.code], [true, 'playing'])
  const playedAt = server.life().onboarding.playedAt
  server.tick(5000)
  assert.equal((await game.resend(id, 'onboarding.quick-start', { look })).ok, true)
  assert.equal(server.life().onboarding.playedAt, playedAt, 'the repeat was answered from the receipt, not applied again')
  assert.deepEqual(server.requests.filter((request) => request.body?.type === 'onboarding.quick-start').map((request) => request.body?.actionId), [id, id])
  assert.equal(said.length, toasts + 1, 'resend leaves a refusal to its caller; only the server\'s welcome line was announced')

  const playing = game.view.value
  assert.deepEqual([playing.onboarding.stage, playing.onboarding.guest, playing.onboarding.required], ['guest', true, false])
  assert.deepEqual(game.state.value.onboarding.look, look)
  assert.equal(playing.goals.chip.kind, 'goal', 'a guest follows the starter chain from the first moment')
  assert.equal(typeof playing.missions.locked, 'string', 'missions open once the life has settled in')
  assert.equal(playing.estate.placed, false, 'a guest has no local government and no house yet')
  const home = await game.command('travel', { id: 'home', mode: 'trek' })
  assert.deepEqual([home.ok, home.code], [false, 'settle_required'])
  assert.deepEqual([game.state.value.location, game.state.value.spot], ['park', 'trees'], 'it stands at the venue\'s welcome spot')
  const other = playing.activities.spots.find((spot) => spot.id !== game.state.value.spot)
  assert.ok(other)
  assert.equal((await game.command('spot', { id: other.id })).ok, true, 'and plays in the venue it arrived in')
})

test('storage failing: still connected, and the store says nothing is being kept', async () => {
  const { game, server } = setup()
  await game.connect()
  server.fault.storageFailing = true
  await game.refresh()
  assert.equal(game.connected.value, true)
  assert.ok(game.storage.value?.reason)
  server.fault.storageFailing = false
  await game.refresh()
  assert.equal(game.storage.value, null)
})

test('server time: the offset follows the server, so action ids are stamped with its clock', async () => {
  const { game, server } = setup()
  await game.connect()
  server.tick(90_000)
  await game.refresh()
  assert.equal(game.serverNow(), server.now())
  assert.equal(Number(game.newId().split(':')[0]), server.now())
})

test('toasts: at most two, never the same text twice, a stronger kind recolours', () => {
  const timers: { run: () => void; ms: number }[] = []
  const { items, toast } = createToasts((run, ms) => { timers.push({ run, ms }) })
  toast('Saved'); toast('Saved', 'good'); toast('')
  assert.deepEqual(items.value.map((item) => [item.text, item.kind]), [['Saved', 'good']])
  toast('+₦500 from your shift', 'good'); toast('Rent is due', 'error')
  assert.deepEqual(items.value.map((item) => item.kind), ['earn', 'error'], 'the oldest gave way; a credit reads as earned')
  assert.equal(timers[0]?.ms, toastLifetime('Saved'))
  timers.at(-1)?.run()
  assert.deepEqual(items.value.map((item) => item.text), ['+₦500 from your shift'])
})
