import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { driver, object } from './cityJourney.ts'
import type { JourneyDevice, JourneyHost } from './cityJourney.ts'

/**
 * A player-owned shop, played against a real host through its routes: the same run on the Node server
 * (server/business.test.ts) and on the Worker (deploy/business.edge.test.ts).
 *
 * What it proves: a stall is opened and paid for once however often the request is repeated; stock and prices are the
 * owner's and are refused outside their rules; another player standing in the market sees the stall, buys, is charged
 * once and rates once; the owner is told; two players racing for the last item end with one sale; passers-by buy while
 * nobody is looking and the owner collects the box once, also when two of their devices press at the same moment; rent
 * is taken from the box, and a stall nobody stocks is wound up and pays out what is left.
 */
export interface BusinessHost extends Pick<JourneyHost, 'now' | 'request' | 'elapse'> {
  funding: {
    credit(device: JourneyDevice, amount: number, reason: string, clientId: string): Promise<Record<string, unknown>>
    debit(device: JourneyDevice, amount: number, reason: string, clientId: string): Promise<Record<string, unknown>>
    need(device: JourneyDevice, need: 'hunger' | 'energy', value: number, clientId: string): Promise<Record<string, unknown>>
    receipt(clientId: string): Promise<string | null>
    audit(device: JourneyDevice): Promise<Record<string, unknown>[]>
  }
  /** Let `ms` pass for every shop: the host's clock moves, or the stored shops are moved back in time. */
  age(ms: number): Promise<void>
  /** Force one durable receipt write to abort before it is stored. */
  failPersistence(requestId: string): Promise<void>
  recoverPersistence(): Promise<void>
  /** Reopen the real host over its existing durable store. */
  restart(): Promise<void>
  /** Move the shared fixture clock beyond one operator-write window. */
  advanceAdminWindow(): Promise<void>
  hasReceipt(device: JourneyDevice, requestId: string): Promise<boolean>
}
/** Only these authenticated founder operations are available to the shared fixture. */
export function businessFunding(request: BusinessHost['request'], cookie: string, receipt: BusinessHost['funding']['receipt']): BusinessHost['funding'] {
  type Intent = { target: string; original: object; body: Record<string, unknown> }
  const intents = new Map<string, Intent>()
  const read = async (path: string, readerCookie: string) => {
    const response = await request(path, undefined, readerCookie)
    assert.equal(response.status, 200)
    return object(await response.json())
  }
  const audit = async (device: JourneyDevice) => {
    const page = await read(`/api/admin/audit?target=${encodeURIComponent(device.id)}`, cookie)
    const lines = list(page.lines)
    assert.equal(page.next, null, 'the disposable fixture must fit in one complete target audit page')
    assert.equal(page.total, lines.length)
    return lines
  }
  const observeIdleDebit = async (device: JourneyDevice, clientId: string) => {
    const state = object((await read('/api/life?city=lagos', device.cookie)).state)
    assert.equal(state.activeAction, null, 'confirmation observation is only for this idle Lagos fixture')
    return { cash: state.cash, ledger: state.ledger, ledgerDays: state.ledgerDays,
      earned: object(state.social).earned, free: object(state.social).free ?? 0,
      journal: list((await read('/api/support/history', device.cookie)).entries),
      audit: await audit(device), receipt: await receipt(clientId) }
  }
  const send = async (device: JourneyDevice, input: Record<string, unknown> & { clientId: string; action: 'credit' | 'debit' | 'need' }) => {
    const saved = intents.get(input.clientId)
    const intent: Intent = saved ?? { target: device.id, original: { ...input }, body: { ...input } }
    if (!saved) intents.set(input.clientId, intent)
    assert.equal(intent.target, device.id)
    assert.deepEqual(intent.original, input, 'fixture replay retains the original intent')
    const post = async () => {
      const response = await request(`/api/admin/players/${device.id}/act`, intent.body, cookie)
      const result = object(await response.json())
      assert.equal(response.status, 200)
      return result
    }
    const beforeConfirmation = !saved && input.action === 'debit' ? await observeIdleDebit(device, input.clientId) : null
    let result = await post()
    if (beforeConfirmation) {
      assert.equal(result.code, 'confirmation_required', 'the controlled debit must pass the real confirmation boundary')
      assert.equal(beforeConfirmation.receipt, null)
      assert.deepEqual(await observeIdleDebit(device, input.clientId), beforeConfirmation, 'requesting confirmation changes no target money, journal, audit or founder receipt')
    }
    if (result.code === 'confirmation_required') {
      assert.equal(input.action, 'debit')
      assert.ok(typeof result.token === 'string')
      intent.body.confirm = result.token
      result = await post()
    }
    assert.equal(result.ok, true)
    assert.equal(result.code, input.action === 'credit' ? 'credited' : input.action === 'debit' ? 'debited' : 'set')
    return result
  }
  return {
    credit: (device, amount, reason, clientId) => send(device, { clientId, action: 'credit', amount, reason, restricted: true }),
    debit: (device, amount, reason, clientId) => send(device, { clientId, action: 'debit', amount, reason }),
    need: (device, need, value, clientId) => send(device, { clientId, action: 'need', need, value }),
    receipt,
    audit,
  }
}

export interface BusinessResult { setup: number; bought: number; collected: number; raced: string[]; closed: boolean }

const HOUR = 3600000, DAY = 86400000
const number = (value: unknown): number => { assert.ok(typeof value === 'number' && Number.isFinite(value), `a number, not ${String(value)}`); return value }
const list = (value: unknown): Record<string, unknown>[] => { assert.ok(Array.isArray(value)); return value.map(object) }

export async function businessJourney(host: BusinessHost): Promise<BusinessResult> {
  const { id, life, start, action, finish, conserved } = driver(host)
  const post = async (path: string, body: object, device: JourneyDevice): Promise<Record<string, unknown>> => {
    const response = await host.request(path, body, device.cookie)
    return { ...object(await response.json()), status: response.status }
  }
  const get = async (path: string, device?: JourneyDevice): Promise<Record<string, unknown>> => {
    const response = await host.request(path, undefined, device?.cookie)
    return { ...object(await response.json()), status: response.status }
  }
  const mine = async (device: JourneyDevice): Promise<Record<string, unknown> | null> => { const found = (await get('/api/business/mine?city=lagos', device)).mine; return found ? object(found) : null }
  const market = (device?: JourneyDevice) => get('/api/business/venue?city=lagos&venue=market', device)
  const item = (shop: Record<string, unknown>, product: string) => { const found = list(shop.items).find((entry) => entry.id === product); assert.ok(found, product); return found }
  const quote = (shop: Record<string, unknown>, product: string, units: number) => {
    const found = list(item(shop, product).quotes).find((entry) => entry.units === units)
    assert.ok(found, `${product} × ${units} quote`)
    return found
  }
  const buyBodies = new Map<string, Record<string, unknown>>()
  async function buy(shopId: string, product: string, units: number, requestId: string, device: JourneyDevice): Promise<Record<string, unknown>> {
    let body = buyBodies.get(requestId)
    if (!body) {
      body = { cityId: 'lagos', shop: shopId, product, units, requestId }
      if (typeof shopId === 'string' && product && Number.isSafeInteger(units) && units >= 1 && units <= 3) {
        const view = await market(device)
        const shop = list(view.shops).find((entry) => entry.id === shopId || object(entry.owner).id === shopId)
        const found = shop && list(shop.items).find((entry) => entry.id === product)
        const quote = found && list(found.quotes).find((entry) => entry.units === units)
        if (found && quote) {
          Object.assign(body, { expectedPrice: number(found.price), expectedTotal: number(quote.total) })
        }
      }
      buyBodies.set(requestId, body)
    }
    return post('/api/business/buy', body, device)
  }
  const journal = async (device: JourneyDevice) => list((await get('/api/support/history', device)).entries)
  const moneyState = (state: Record<string, unknown>) => ({ cash: state.cash, ledger: state.ledger, ledgerDays: state.ledgerDays,
    earned: object(state.social).earned, free: object(state.social).free ?? 0 })
  const fundingReplays: (() => Promise<void>)[] = []
  async function fund(device: JourneyDevice, op: 'credit' | 'debit', amount: number, reason: string): Promise<void> {
    const before = await life(device, 'lagos'), intent = id()
    const call = () => host.funding[op](device, amount, reason, intent)
    const result = await call(), after = await life(device, 'lagos')
    const delta = op === 'credit' ? amount : -amount
    assert.deepEqual([result.before, result.after, result.applied, result.duplicate === true], [before.cash, number(before.cash) + delta, amount, false])
    assert.equal(after.cash, number(before.cash) + delta)
    assert.deepEqual(list(after.ledger).slice(0, list(before.ledger).length), list(before.ledger))
    const lines = list(after.ledger).slice(list(before.ledger).length)
    assert.equal(lines.length, 1)
    const label = `Admin ${op}: ${reason}`
    assert.deepEqual([lines[0]?.amount, lines[0]?.balance, lines[0]?.reason], [delta, after.cash, label])
    assert.equal(object(after.social).earned, object(before.social).earned, 'admin funding is not paid work')
    assert.equal(object(after.social).free ?? 0, 0, 'restricted fixture funding cannot bypass the work allowance')
    conserved(after)
    const effects = (await journal(device)).filter(entry => entry.reason === label)
    assert.equal(effects.length, 1)
    assert.deepEqual([effects[0]?.amount, effects[0]?.balanceAfter], [delta, after.cash])
    const receipt = await host.funding.receipt(intent)
    assert.ok(receipt)
    const audit = (await host.funding.audit(device)).filter(line => line.n === result.line)
    assert.equal(audit.length, 1)
    assert.deepEqual([audit[0]?.action, audit[0]?.target, audit[0]?.amount, audit[0]?.reason], [op, device.id, delta, reason])
    if (op === 'credit') assert.equal(object(audit[0]?.params).restricted, 1)
    const replay = async () => {
      const current = await life(device, 'lagos'), entries = await journal(device)
      const beforeReplayAudit = await host.funding.audit(device)
      const repeated = await call()
      assert.deepEqual([repeated.duplicate, repeated.line, repeated.after], [true, result.line, result.after])
      assert.deepEqual(moneyState(await life(device, 'lagos')), moneyState(current))
      assert.deepEqual(await journal(device), entries)
      assert.equal(await host.funding.receipt(intent), receipt, 'funding receipt contents survive replay and restart')
      const afterReplayAudit = await host.funding.audit(device)
      assert.deepEqual(afterReplayAudit, beforeReplayAudit, 'funding replay cannot append an audit row')
      assert.deepEqual(afterReplayAudit.filter(line => line.n === result.line), audit)
    }
    await replay()
    fundingReplays.push(replay)
  }
  async function setNeed(device: JourneyDevice, need: 'hunger' | 'energy', value: number): Promise<void> {
    const before = await life(device, 'lagos'), entries = await journal(device), intent = id()
    const first = await host.funding.need(device, need, value, intent)
    const beforeReplayAudit = await host.funding.audit(device)
    const audit = beforeReplayAudit.filter(line => line.n === first.line)
    assert.equal(audit.length, 1)
    assert.deepEqual([audit[0]?.action, audit[0]?.target, object(audit[0]?.params).need, object(audit[0]?.params).value], ['need', device.id, need, value])
    const receipt = await host.funding.receipt(intent)
    assert.ok(receipt)
    const repeated = await host.funding.need(device, need, value, intent)
    assert.deepEqual([repeated.duplicate, repeated.line], [true, first.line])
    const after = await life(device, 'lagos')
    assert.equal(object(after.needs)[need], value)
    assert.deepEqual(moneyState(after), moneyState(before), 'controlled need setup cannot change wealth or work history')
    assert.deepEqual(await journal(device), entries)
    assert.equal(await host.funding.receipt(intent), receipt, 'need replay preserves the original receipt bytes')
    const afterReplayAudit = await host.funding.audit(device)
    assert.deepEqual(afterReplayAudit, beforeReplayAudit, 'need replay cannot append an audit row')
    assert.deepEqual(afterReplayAudit.filter(line => line.n === first.line), audit)
  }
  /** Normal onboarding and paid work, followed by explicitly restricted fixture funding. */
  async function trader(name: string): Promise<JourneyDevice> {
    const device = await start(`${name}${randomUUID().slice(0, 4)}`, 'lagos', 'ikeja')
    await action(device, 'lagos', 'career.auto', { on: false })
    await action(device, 'lagos', 'apply-job', { id: 'trading' })
    const journey = await action(device, 'lagos', 'travel', { id: 'market', mode: 'trek' })
    assert.equal((await finish(device, 'lagos', object(journey.state))).location, 'market')
    await action(device, 'lagos', 'spot', { id: 'work' })
    const before = await life(device, 'lagos'), workId = id()
    assert.ok(number(object(before.needs).energy) >= 30 && number(object(before.needs).hunger) >= 25)
    const started = await action(device, 'lagos', 'activity', { id: 'trading-shift' }, workId)
    const working = object(started.state)
    assert.equal(object(working.activeAction).duration, 40)
    assert.deepEqual(moneyState(working), moneyState(before), 'starting a shift does not pay its wage')
    await host.elapse(device, 'lagos', 39000)
    const nearly = await life(device, 'lagos')
    assert.ok(nearly.activeAction)
    assert.deepEqual(moneyState(nearly), moneyState(before), '39 seconds cannot pay a 40-second shift')
    const paid = await finish(device, 'lagos', nearly)
    assert.deepEqual(list(paid.ledger).slice(0, list(before.ledger).length), list(before.ledger))
    const newLines = list(paid.ledger).slice(list(before.ledger).length)
    const wages = newLines.filter(line => line.reason === 'Trading shift')
    assert.equal(wages.length, 1)
    assert.equal(wages[0]?.amount, 3000)
    assert.equal(number(object(paid.social).earned) - number(object(before.social).earned), 3000)
    assert.equal(number(paid.cash) - number(before.cash), newLines.reduce((sum, line) => sum + number(line.amount), 0))
    conserved(paid)
    const wageEffects = (await journal(device)).filter(entry => entry.reason === 'Trading shift')
    assert.equal(wageEffects.length, 1)
    assert.deepEqual([wageEffects[0]?.amount, wageEffects[0]?.balanceAfter], [3000, wages[0]?.balance])
    const repeated = await action(device, 'lagos', 'activity', { id: 'trading-shift' }, workId)
    assert.equal(repeated.duplicate, true)
    assert.deepEqual(moneyState(await life(device, 'lagos')), moneyState(paid))
    assert.deepEqual((await journal(device)).filter(entry => entry.reason === 'Trading shift'), wageEffects)
    assert.equal(object(paid.social).free ?? 0, 0)
    assert.ok(number(object(paid.social).earned) - number(object(object(paid.social).transfer).total) - number(object(paid.business).spent) >= 1600)
    // Approved controlled QA reserve: exercise the confirmed debit without changing the business starting balance.
    const target = name === 'Ada' ? 101000 : 100000
    const difference = target - number(paid.cash)
    if (difference) await fund(device, difference > 0 ? 'credit' : 'debit', Math.abs(difference), `Business fixture ${name}`)
    if (name === 'Ada') await fund(device, 'debit', 1000, 'Business fixture reserve removal')
    await setNeed(device, 'hunger', 30)
    await setNeed(device, 'energy', 80)
    assert.equal((await get('/api/social/me', device)).status, 200)
    const ready = await life(device, 'lagos')
    assert.deepEqual([ready.cash, ready.location, ready.activeAction], [100000, 'market', null])
    return device
  }
  const ada = await trader('Ada'), bola = await trader('Bola'), chi = await trader('Chi')
  await host.restart()
  for (const replay of fundingReplays) await replay()
  await host.advanceAdminWindow()

  // ---- the market before anyone trades ---------------------------------------------------------------------------------
  const empty = await market(ada)
  assert.deepEqual([empty.hosts, list(empty.shops).length, empty.openWhy, empty.mine], [true, 0, '', null])
  assert.deepEqual(list(empty.types).map((type) => type.id), ['food', 'provisions', 'fabric', 'crafts'])
  assert.equal((await market()).status, 200, 'the stalls of a market are public')
  assert.equal((await get('/api/business/venue?city=lagos&venue=park', ada)).hosts, false)

  // ---- opening ---------------------------------------------------------------------------------------------------------
  const order = { cityId: 'lagos', venue: 'market', type: 'food', name: 'Mama Put', colour: 'gold', icon: '🍲' }
  for (const [change, code] of [[{ name: 'x' }, 'text_too_short'], [{ name: 'visit shop.com' }, 'links_not_allowed'], [{ type: 'casino' }, 'unknown_type'], [{ colour: 'url(x)' }, 'invalid_colour'], [{ icon: '💣' }, 'invalid_icon'], [{ venue: 'park' }, 'no_stalls_here']] as const) {
    const refused = await post('/api/business/open', { ...order, ...change, requestId: id() }, ada)
    assert.deepEqual([refused.ok, refused.code, object(refused.state).cash], [false, code, 100000], code)
  }
  assert.equal((await post('/api/business/open', order, ada)).status, 400, 'a paid request needs its id')
  const request = id()
  const opened = await post('/api/business/open', { ...order, requestId: request }, ada)
  assert.deepEqual([opened.ok, opened.code, object(opened.state).cash], [true, 'opened', 85000])
  const again = await post('/api/business/open', { ...order, requestId: request }, ada)
  assert.deepEqual([again.ok, again.duplicate, object(again.state).cash], [true, true, 85000], 'the same request again charges nothing')
  assert.equal((await post('/api/business/open', { ...order, name: 'Second', requestId: id() }, ada)).code, 'cannot_open', 'one business per player')
  assert.equal(object((await life(ada, 'lagos')).business).opened, 1)

  // ---- stock and prices ------------------------------------------------------------------------------------------------
  assert.equal((await post('/api/business/stock', { cityId: 'lagos', items: { jollof: 99 }, requestId: id() }, ada)).code, 'no_room')
  assert.equal((await post('/api/business/stock', { cityId: 'lagos', items: { adire: 1 }, requestId: id() }, ada)).code, 'unknown_product')
  assert.equal((await post('/api/business/stock', { cityId: 'lagos', items: { jollof: 2 }, requestId: id() }, bola)).code, 'no_shop')
  const stocked = await post('/api/business/stock', { cityId: 'lagos', items: { jollof: 12, 'local-plate': 8, 'puff-puff': 1 }, requestId: id() }, ada)
  assert.deepEqual([stocked.code, object(stocked.state).cash], ['stocked', 85000 - 12 * 360 - 8 * 300 - 120])
  assert.equal((await post('/api/business/price', { cityId: 'lagos', prices: { jollof: 9000 } }, ada)).code, 'price_outside_band')
  const priced = await post('/api/business/price', { cityId: 'lagos', prices: { jollof: 700 } }, ada)
  assert.equal(priced.code, 'priced')
  assert.equal(list(object(priced.mine).products).find((entry) => entry.id === 'jollof')?.price, 700)

  // ---- another player buys ---------------------------------------------------------------------------------------------
  const seen = list((await market(bola)).shops)
  assert.equal(seen.length, 1)
  const stall = seen[0] ?? {}
  assert.deepEqual([stall.name, stall.mine, stall.blocked, object(stall.owner).id, item(stall, 'jollof').price, stall.stars], ['Mama Put', false, false, ada.id, 700, 3])
  const shop = String(stall.id)
  const twoQuote = quote(stall, 'jollof', 2)
  assert.deepEqual([twoQuote.total, twoQuote.tax], [1400, 0], 'the listed total includes the zero sale tax')
  const unchangedBuyerCash = number((await life(bola, 'lagos')).cash)
  const unchangedSellerTill = number(object(await mine(ada)).till)
  const quoteFailures = [
    { expectedPrice: 699, expectedTotal: 1400 },
    {},
    { expectedPrice: 700 },
    { expectedTotal: 1400 },
    { expectedPrice: '700', expectedTotal: 1400 },
    { expectedPrice: 700, expectedTotal: '1400' },
  ]
  for (const invalid of quoteFailures) {
    const refused = await post('/api/business/buy', { cityId: 'lagos', shop, product: 'jollof', units: 2, requestId: id(), ...invalid }, bola)
    assert.equal(refused.code, invalid.expectedPrice === 699 ? 'quote_changed' : 'quote_required')
    assert.equal(object(refused.state).cash, unchangedBuyerCash, 'a refused quote does not debit the buyer')
  }
  assert.equal(number(object(await mine(ada)).till), unchangedSellerTill, 'refused quotes do not credit the seller')
  assert.equal((await buy(shop, 'jollof', 1, id(), ada)).code, 'own_shop')
  assert.equal((await buy(shop, 'jollof', 9, id(), bola)).code, 'invalid_units')
  assert.equal((await post('/api/business/rate', { cityId: 'lagos', shop, stars: 5 }, bola)).code, 'nothing_to_rate')
  const buying = id(), stockBefore = number(item(list((await market(bola)).shops)[0] ?? {}, 'jollof').stock)
  const buyerCashBefore = number((await life(bola, 'lagos')).cash)
  const sellerTillBefore = number(object(await mine(ada)).till)
  await host.failPersistence(buying)
  const failedBuy = await buy(shop, 'jollof', 2, buying, bola)
  const failedBody = { ...(buyBodies.get(buying) ?? {}) }
  assert.ok(failedBody.expectedPrice && failedBody.expectedTotal, 'the failed purchase retains its exact quote payload')
  assert.deepEqual([failedBuy.status, failedBuy.error], [503, 'storage_unavailable'], 'an aborted durable receipt write is reported as unavailable')
  assert.deepEqual([number(object(await life(bola, 'lagos')).cash), number(object(await mine(ada)).till), number(item(list((await market(bola)).shops)[0] ?? {}, 'jollof').stock)], [buyerCashBefore, sellerTillBefore, stockBefore], 'a failed commit leaves buyer, seller and stock unchanged')
  assert.equal(await host.hasReceipt(bola, buying), false, 'a failed buy leaves no receipt')
  await host.recoverPersistence()
  const bought = await buy(shop, 'jollof', 2, buying, bola)
  assert.deepEqual([bought.ok, bought.code, bought.amount, object(bought.state).cash], [true, 'bought', 1400, 98600])
  assert.equal(buyerCashBefore - number(object(bought.state).cash), 1400, 'the buyer pays the exact tax-inclusive quote')
  assert.equal(number(object(await mine(ada)).till) - sellerTillBefore, 1400, 'the seller receives the base amount exactly once')
  assert.ok(number(object(object(bought.state).needs).hunger) > 30, 'the buyer ate')
  const changedQuote = await post('/api/business/buy', { cityId: 'lagos', shop, product: 'jollof', units: 2, expectedPrice: 701, expectedTotal: 1400, requestId: buying }, bola)
  assert.deepEqual([changedQuote.status, changedQuote.error], [409, 'client_id_conflict'], 'a successful request id cannot be reused with another quote')
  assert.equal((await post('/api/business/price', { cityId: 'lagos', prices: { jollof: 701 } }, ada)).code, 'priced')
  const stalePriceId = id()
  const buyerBeforeStalePrice = number((await life(bola, 'lagos')).cash)
  const sellerBeforeStalePrice = number(object(await mine(ada)).till)
  const staleMarketBefore = await market(bola)
  const staleShopBefore = list(staleMarketBefore.shops).find((entry) => entry.id === shop)
  assert.ok(staleShopBefore)
  const stockBeforeStalePrice = number(item(staleShopBefore, 'jollof').stock)
  const stalePrice = await post('/api/business/buy', {
    cityId: 'lagos', shop, product: 'jollof', units: 2,
    expectedPrice: number(item(stall, 'jollof').price), expectedTotal: number(twoQuote.total), requestId: stalePriceId,
  }, bola)
  assert.equal(stalePrice.code, 'quote_changed', 'a fresh request with the previously shown price is refused after the seller reprices')
  assert.equal(number(object(stalePrice.state).cash), buyerBeforeStalePrice, 'a stale price does not debit the buyer')
  assert.equal(number(object(await mine(ada)).till), sellerBeforeStalePrice, 'a stale price does not credit the seller')
  const refreshedStall = list(object(stalePrice.market).shops).find((entry) => entry.id === shop)
  assert.ok(refreshedStall)
  const refreshedTwoQuote = quote(refreshedStall, 'jollof', 2)
  assert.deepEqual([number(item(refreshedStall, 'jollof').price), number(refreshedTwoQuote.total)], [701, 1402], 'the refusal returns the current unit price and two-unit total')
  assert.equal(number(item(refreshedStall, 'jollof').stock), stockBeforeStalePrice, 'a stale price leaves stock unchanged')
  const replay = await buy(shop, 'jollof', 2, buying, bola)
  assert.deepEqual([replay.duplicate, object(replay.state).cash], [true, 98600])
  assert.equal(number(object(await mine(ada)).till) - sellerTillBefore, 1400, 'the old successful quote replays once after the menu price changes')
  const stockAfterPurchase = number(item(list((await market(bola)).shops)[0] ?? {}, 'jollof').stock)
  await host.restart()
  assert.equal(await host.hasReceipt(bola, buying), true, 'the successful quote receipt is still stored after restart')
  const restartedReplay = await post('/api/business/buy', failedBody, bola)
  assert.deepEqual([restartedReplay.duplicate, object(restartedReplay.state).cash], [true, 98600], 'the exact successful quote receipt survives a host restart')
  assert.equal(number(object(await mine(ada)).till) - sellerTillBefore, 1400, 'restart replay does not credit the seller again')
  assert.equal(item(list((await market(bola)).shops)[0] ?? {}, 'jollof').stock, stockAfterPurchase, 'restart replay does not alter stock')
  assert.ok(number(item(list(object(replay.market).shops)[0] ?? {}, 'jollof').stock) >= stockBefore - 2 - 3, 'two left the shelf for the player, whatever passers-by took meanwhile')
  assert.equal(list(object(bought.market).shops)[0]?.canRate, true)
  // The owner is told, in Messages → Updates, whether or not they are looking.
  const updates = list((await get('/api/social/me', ada)).updates).filter((update) => update.kind === 'business')
  assert.equal(updates.length, 1)
  assert.match(String(updates[0]?.text), /^Bola\w* bought 2 × Jollof rice & chicken at Mama Put \(₦1,400\)\.$/)
  // One rating for the purchase.
  const rated = await post('/api/business/rate', { cityId: 'lagos', shop, stars: 5 }, bola)
  assert.deepEqual([rated.code, list(object(rated.market).shops)[0]?.ratings, list(object(rated.market).shops)[0]?.stars], ['rated', 1, 3.2])
  assert.equal((await post('/api/business/rate', { cityId: 'lagos', shop, stars: 1 }, bola)).code, 'nothing_to_rate')
  // A full buyer is not sold a meal.
  await setNeed(chi, 'hunger', 100)
  assert.equal((await buy(shop, 'jollof', 1, id(), chi)).code, 'not_needed')
  await setNeed(chi, 'hunger', 20)
  await setNeed(bola, 'hunger', 20)

  // ---- two players, one item left --------------------------------------------------------------------------------------
  const last = number(item(list((await market(chi)).shops)[0] ?? {}, 'puff-puff').stock)
  assert.equal(last, 1, 'one puff-puff on the shelf')
  const race = await Promise.all([bola, chi].map((who) => buy(shop, 'puff-puff', 1, id(), who)))
  const raced = race.map((answer) => String(answer.code)).sort()
  assert.deepEqual(raced, ['bought', 'sold_out'])
  assert.equal(item(list((await market(chi)).shops)[0] ?? {}, 'puff-puff').stock, 0)

  // ---- passers-by, and the cash box ------------------------------------------------------------------------------------
  const before = object(await mine(ada))
  await host.age(4 * HOUR)
  const after = object(await mine(ada))
  assert.ok(number(after.till) > number(before.till) && number(after.units) < number(before.units), `passers-by bought while nobody looked (${String(before.till)} → ${String(after.till)})`)
  assert.equal(number(after.till) - number(before.till), number(object(after.total).takings) - number(object(before.total).takings), 'the cash box reflects the exact settled takings')
  const cash = number((await life(ada, 'lagos')).cash)
  // Two of the owner's devices press Collect at the same moment: the box is paid out once.
  const both = await Promise.all([id(), id()].map((requestId) => post('/api/business/collect', { cityId: 'lagos', requestId }, ada)))
  assert.deepEqual(both.map((answer) => String(answer.code)).sort(), ['collected', 'nothing_to_collect'])
  const collected = number(both.find((answer) => answer.code === 'collected')?.amount)
  assert.ok(collected >= number(after.till))
  assert.equal((await life(ada, 'lagos')).cash, cash + collected)
  assert.ok(number(object((await life(ada, 'lagos')).business).sales) >= 3)

  // ---- rent, and a stall nobody stocks ----------------------------------------------------------------------------------
  await host.age(8 * DAY)
  const week = object(await mine(ada))
  assert.equal(week.units, 0, 'sold out or spoiled days ago')
  assert.ok(number(week.owed) > 0 || number(object(week.total).rent) > 0, 'the rent fell due: taken from the box, or overdue')
  assert.ok(number(week.stars) < 3.2, 'an empty stall loses its stars')
  await host.age(12 * DAY)
  const gone = object(await mine(ada))
  assert.deepEqual([gone.status, gone.units], ['closed', 0])
  assert.equal(list((await market(bola)).shops).length, 0, 'a closed stall is no longer in the market')
  const told = list((await get('/api/social/me', ada)).updates).filter((update) => update.kind === 'business').map((update) => String(update.text))
  assert.ok(told.some((line) => /closed by the market for unpaid rent/.test(line)), told.join(' | '))
  const final = number((await life(ada, 'lagos')).cash)
  const paid = await post('/api/business/collect', { cityId: 'lagos', requestId: id() }, ada)
  assert.deepEqual([paid.code, paid.mine, object(paid.state).cash], ['collected', null, final + number(gone.till)])
  assert.equal((await market(ada)).openWhy, '', 'and the owner may rent a stall again')
  return { setup: 15000, bought: 1400, collected, raced, closed: true }
}
