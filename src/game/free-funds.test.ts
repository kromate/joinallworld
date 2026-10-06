import { loadCityContent as preloadCityContent } from './cities/registry.ts'
await preloadCityContent('lagos')
// UNRESTRICTED FUNDS: money an admin credited can be gifted and spent at players' stalls without the gift rules (docs/ADMIN.md). The rules are
// systems/social.ts (transferBlock, giftRoom, sendable), systems/business.ts (buyBlock) and systems/wallet.ts (freeOf, the clamp, `wallet.admin`).
import assert from 'node:assert/strict'
import test from 'node:test'
import { createLife, dispatch, viewLife } from '../life.ts'
import { makeContext } from './util.ts'
import { sendable, serverOp } from './systems/social.ts'
import { TRANSFER_LIMITS } from './content/npcs.ts'
import type { LifeContextInit, LifeState } from '../types/life.ts'

const NOW = Date.UTC(2026, 0, 5, 9), PLAYER = '11111111-2222-4333-8444-555555555555'
let seq = 0
const ctxAt = (now = NOW, extra: LifeContextInit = {}) => { const actionId = `f-${++seq}`; return makeContext({ now, cityId: 'lagos', seed: actionId, actionId, ...extra }) }
const internal = { internal: true as const }
const life = (saved: Record<string, unknown> = {}): LifeState => { const state = createLife({ cash: 50000, ...saved }, ctxAt()); state.t = NOW; return state }
const credit = (state: LifeState, amount: number, unrestricted = true) => dispatch(state, { type: 'wallet.admin', payload: { op: 'credit', amount, reason: 'test', ...(unrestricted ? { unrestricted: true } : {}) } }, { ...ctxAt(), ...internal })
const send = (state: LifeState, amount: number) => serverOp(state, 'transfer-out', { to: PLAYER, name: 'Bola', amount }, ctxAt())
const buy = (state: LifeState, amount: number) => dispatch(state, { type: 'business.server', payload: { op: 'buy', amount, units: 1, label: 'Jollof', shop: 'Mama Put', effects: { hunger: 20 }, need: 'hunger' } }, { ...ctxAt(), ...internal })

test('an unrestricted admin credit is tracked as one additive counter; a restricted one, and the launch bonus, are not', () => {
  const a = life({ cash: 12000 })
  assert.equal(a.social.free, undefined, 'absent on a life that never had one')
  assert.equal(credit(a, 276200).code, 'credited')
  assert.equal(a.social.free, 276200)
  const b = life(); credit(b, 5000, false)
  assert.equal(b.social.free, undefined, 'a restricted credit is ordinary money')
  const c = life(); dispatch(c, { type: 'wallet.bonus', payload: { amount: 1_000_000, reason: 'Launch bonus: one of the first 10,000 players' } }, { ...ctxAt(), ...internal })
  assert.equal(c.social.free, undefined, 'the launch bonus is a mass faucet and stays restricted')
  // A saved life loads with it; a legacy one without it loads unchanged.
  const saved = createLife(JSON.parse(JSON.stringify(a)), ctxAt())
  assert.equal(saved.social.free, 276200)
  const legacy = JSON.parse(JSON.stringify(life())); delete legacy.social.free
  assert.equal('free' in createLife(legacy, ctxAt()).social, false)
  assert.equal(createLife({ cash: 100, social: { free: -5 } }, ctxAt()).social.free, undefined, 'a bad value is dropped')
})

test('a gift wholly from unrestricted funds skips every sender rule: earned, per-gift cap, gifts a day, amount a day, minimum earned', () => {
  const state = life({ cash: 12000 }); credit(state, 276200)
  assert.equal(state.social.earned, 0)
  const L = TRANSFER_LIMITS
  assert.ok(100_000 > L.maxPerTransfer && state.cash >= 100_000)
  const before = state.cash
  assert.equal(send(state, 100_000).code, 'sent')
  assert.equal(state.cash, before - 100_000)
  assert.deepEqual([state.social.free, state.social.transfer.sent, state.social.transfer.count, state.social.transfer.total], [276200 - 100_000, 0, 0, 0], 'none of it is counted against the ordinary allowance')
  for (let i = 0; i < 5; i++) assert.equal(send(state, 20_000).code, 'sent', `gift ${i + 2}: no gifts-a-day limit`)
  assert.equal(state.social.free, 276200 - 200_000)
})

test('a mixed gift is the unrestricted part plus an ordinary part under the ordinary rules; if the ordinary part is refused, the whole gift is refused with the exact most that can be sent', () => {
  const state = life({ cash: 20000, social: { earned: 3000 } }); credit(state, 4000)
  // ₦4,000 unrestricted + ₦3,000 earned room: ₦7,000 is fine, ₦7,001 is not.
  assert.equal(state.social.free, 4000)
  const refused = send(state, 7500)
  assert.equal(refused.ok, false)
  assert.equal(refused.code, 'gift_exceeds_earned')
  assert.match(String(refused.reason), /You can send up to ₦7,000 now \(₦4,000 of it has no gift limits\)/)
  assert.equal(state.cash, 24000, 'nothing was charged')
  const cash = state.cash
  assert.equal(send(state, 7000).code, 'sent')
  assert.equal(state.cash, cash - 7000)
  assert.deepEqual([state.social.free, state.social.transfer.sent, state.social.transfer.count, state.social.transfer.total], [undefined, 3000, 1, 3000], 'only the ordinary part counts')
  assert.equal(sendable(state, ctxAt()), 0, 'allowance spent, no unrestricted left')
})

test('what the view says can be sent now includes the unrestricted part', () => {
  const state = life({ cash: 288200, social: { earned: 0 } }); state.cash = 12000; credit(state, 276200)
  assert.equal(viewLife(state, ctxAt()).social.transfer.free, 276200, 'the view carries it; the card adds what the ordinary rules allow (personModel sendNow)')
  assert.equal(sendable(state, ctxAt()), 276200, 'nothing earned: only the unrestricted part')
  state.social.earned = 12000
  assert.equal(sendable(state, ctxAt()), 276200 + TRANSFER_LIMITS.maxPerTransfer, 'plus what the ordinary rules allow in one gift')
})

test('the counter never exceeds the cash: spending brings it down, and a debit too', () => {
  const state = life({ cash: 1000 }); credit(state, 9000)
  assert.equal(state.cash, 10000); assert.equal(state.social.free, 9000)
  assert.equal(server(state, { op: 'open', amount: 500, name: 'Stall', city: 'lagos', venue: 'market' }).ok, true)
  assert.equal(state.social.free, 9000, 'cash 9,500 still covers it')
  assert.equal(server(state, { op: 'spend', what: 'stock', amount: 6000, name: 'Stall' }).ok, true)
  assert.deepEqual([state.cash, state.social.free], [3500, 3500], 'free = min(free, cash) after a spend')
  dispatch(state, { type: 'wallet.admin', payload: { op: 'debit', amount: 3500, reason: 'x' } }, { ...ctxAt(), ...internal })
  assert.deepEqual([state.cash, state.social.free], [0, undefined])
})
const server = (state: LifeState, payload: unknown) => dispatch(state, { type: 'business.server', payload } as never, { ...ctxAt(), ...internal })

test('a stall purchase from unrestricted funds skips the buyer\'s earned rule; the stall\'s own daily limits still apply', () => {
  const none = life({ cash: 50000, social: { earned: 0 }, needs: { hunger: 40, energy: 60, fun: 40, social: 40, hygiene: 40, bladder: 60 } })
  assert.equal(buy(none, 600).code, 'earn_first', 'ordinary money: the earned rule')
  credit(none, 3000)
  assert.equal(buy(none, 600).code, 'bought')
  assert.equal(none.social.free, 2400); assert.equal(none.business.spent, 0, 'not counted as passed on from earnings')
  // Beyond the unrestricted part the ordinary rule still decides.
  const mixed = life({ cash: 50000, social: { earned: 0 }, needs: { hunger: 40, energy: 60, fun: 40, social: 40, hygiene: 40, bladder: 60 } }); credit(mixed, 500)
  assert.equal(buy(mixed, 600).code, 'earn_first')
  // The stall's own daily limits are kept.
  const big = life({ cash: 50000, social: { earned: 0 }, needs: { hunger: 40, energy: 60, fun: 40, social: 40, hygiene: 40, bladder: 60 } }); credit(big, 40000)
  const refused = buy(big, 40000)
  assert.equal(refused.ok, false); assert.equal(refused.code, 'daily_shop_limit')
})

test('what the recipient gets is ordinary money: it does not become unrestricted, and it follows the normal rules for them', () => {
  const receiver = life({ cash: 1000 })
  assert.equal(serverOp(receiver, 'transfer-in', { from: PLAYER, name: 'Ada', amount: 200_000 }, ctxAt()).code, 'received')
  assert.equal(receiver.social.free, undefined)
  assert.equal(send(receiver, 3000).code, 'earn_first')
})
