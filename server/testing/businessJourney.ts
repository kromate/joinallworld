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
  /** Change the stored life of a character (a test's way to give it money, work history and a place to stand). */
  edit(device: JourneyDevice, city: string, change: (state: Record<string, unknown>) => void): Promise<void>
  /** Let `ms` pass for every shop: the host's clock moves, or the stored shops are moved back in time. */
  age(ms: number): Promise<void>
  /** Force one durable receipt write to abort before it is stored. */
  failPersistence(requestId: string): Promise<void>
  recoverPersistence(): Promise<void>
  /** Reopen the real host over its existing durable store. */
  restart(): Promise<void>
  hasReceipt(device: JourneyDevice, requestId: string): Promise<boolean>
}
export interface BusinessResult { setup: number; bought: number; collected: number; raced: string[]; closed: boolean }

const HOUR = 3600000, DAY = 86400000
const number = (value: unknown): number => { assert.ok(typeof value === 'number' && Number.isFinite(value), `a number, not ${String(value)}`); return value }
const list = (value: unknown): Record<string, unknown>[] => { assert.ok(Array.isArray(value)); return value.map(object) }

export async function businessJourney(host: BusinessHost): Promise<BusinessResult> {
  const { id, life, start } = driver(host)
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
  /** A settled player standing in the Lagos market with money they worked for. */
  async function trader(name: string): Promise<JourneyDevice> {
    const device = await start(`${name}${randomUUID().slice(0, 4)}`, 'lagos', 'ikeja')
    await host.edit(device, 'lagos', (state) => {
      state.cash = 100000; state.ledger = []; state.ledgerDays = []; state.location = 'market'; state.spot = null; state.activeAction = null
      object(state.social).earned = 30000
      Object.assign(object(state.needs), { hunger: 30, energy: 80 })
    })
    assert.equal((await get('/api/social/me', device)).status, 200)
    assert.deepEqual([(await life(device, 'lagos')).cash, (await life(device, 'lagos')).location], [100000, 'market'])
    return device
  }
  const ada = await trader('Ada'), bola = await trader('Bola'), chi = await trader('Chi')

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
  await host.edit(chi, 'lagos', (state) => { object(state.needs).hunger = 100 })
  assert.equal((await buy(shop, 'jollof', 1, id(), chi)).code, 'not_needed')
  await host.edit(chi, 'lagos', (state) => { object(state.needs).hunger = 20 })
  await host.edit(bola, 'lagos', (state) => { object(state.needs).hunger = 20 })

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
  assert.equal(number(after.till) % 10, 0)
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
