// Real price levels (docs/PRICE-LEVELS.md): the table, the scaling, Nigeria unchanged, London dear, Accra near Lagos, ratios sane, old saves.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PRICE_LEVEL_DATA } from './price-levels-data.ts'
import { LEVEL_MAX, LEVEL_MIN, priceLevelOf, scaleCityContent, scaleNaira } from './price-levels.ts'
import { loadCityContent, cachedCityContent } from './cities/registry.ts'
import { LAGOS_CONTENT } from './cities/lagos/content.ts'
import { INGREDIENTS } from './content/food.ts'
import { advanceLife, createLife, dispatch, viewLife } from '../life.ts'
import { groceryPrice } from './systems/home.ts'
import { makeContext } from './util.ts'
import { CURRENCY_COUNTRIES } from './currency.ts'
import type { CityContent } from '../types/content.ts'

const level = (country: string): number => priceLevelOf(PRICE_LEVEL_DATA, country)
const json = (value: unknown): string => JSON.stringify(value)

test('the table: a year, a source, a licence and one level per country', () => {
  assert.ok(Number.isInteger(PRICE_LEVEL_DATA.year) && PRICE_LEVEL_DATA.year >= 2021)
  assert.match(PRICE_LEVEL_DATA.url, /^https:\/\/data\.worldbank\.org\//)
  assert.equal(PRICE_LEVEL_DATA.licence, 'CC BY 4.0')
  const rows = Object.entries(PRICE_LEVEL_DATA.levels)
  assert.ok(rows.length >= 150, `${rows.length} countries`)
  for (const [code, [value, year]] of rows) {
    assert.match(code, /^[a-z]{2}$/)
    assert.ok(value > 0.05 && value < 3, `${code} ${value}`)
    assert.ok(year <= PRICE_LEVEL_DATA.year && year >= PRICE_LEVEL_DATA.year - 3, `${code} ${year}`)
  }
  assert.equal(PRICE_LEVEL_DATA.levels['us']?.[0], 1, 'the United States is the base of the World Bank series')
  assert.ok(PRICE_LEVEL_DATA.levels['ng'], 'Nigeria is in the table: every level is against it')
})

test('the loader: Nigeria is 1, London dear, Accra near Lagos, junk and unknown are 1, everything is inside the range', () => {
  assert.equal(level('ng'), 1)
  assert.equal(priceLevelOf(PRICE_LEVEL_DATA), 1)
  assert.equal(priceLevelOf(PRICE_LEVEL_DATA, 'nigeria'), 1)
  assert.equal(level('zz'), 1)
  assert.equal(level('GB'), level('gb'), 'any case')
  assert.ok(level('gb') > 2 && level('gb') <= LEVEL_MAX, `London ${level('gb')}`)
  assert.ok(level('gh') > 0.8 && level('gh') < 1.25, `Accra ${level('gh')}`)
  assert.ok(level('ke') > 0.8 && level('ke') < 1.3, `Nairobi ${level('ke')}`)
  assert.ok(level('us') > level('gb') || level('us') >= 2, 'the United States is dear too')
  assert.ok(level('in') < 1 && level('in') >= LEVEL_MIN, `India ${level('in')}`)
  assert.equal(level('kas'), level('in'), 'a map entry reads as the country whose money it uses')
  for (const country of CURRENCY_COUNTRIES) assert.ok(level(country) >= LEVEL_MIN && level(country) <= LEVEL_MAX, country)
  const wild = { ...PRICE_LEVEL_DATA, levels: { ng: [0.1, 2021], aa: [9, 2021], bb: [0.0001, 2021] } as const }
  assert.equal(priceLevelOf(wild, 'aa'), LEVEL_MAX)
  assert.equal(priceLevelOf(wild, 'bb'), LEVEL_MIN)
  assert.equal(priceLevelOf({ ...PRICE_LEVEL_DATA, levels: {} }, 'gb'), 1, 'no Nigeria row: no scaling')
})

test('scaleNaira: rounds like the game writes money, never to zero, level 1 untouched', () => {
  assert.equal(scaleNaira(2400, 1), 2400)
  assert.equal(scaleNaira(2400, 2.5), 6000)
  assert.equal(scaleNaira(2450, 2.51), 6100)
  assert.equal(scaleNaira(250, 2.5), 630)
  assert.equal(scaleNaira(30, 2.5), 75)
  assert.equal(scaleNaira(1, 0.5), 1)
  assert.equal(scaleNaira(0, 3), 0)
})

test('Nigerian cities are unchanged byte for byte; foreign ones carry their level', async () => {
  assert.equal(scaleCityContent(LAGOS_CONTENT, 1), LAGOS_CONTENT)
  for (const id of ['lagos', 'ibadan', 'abuja', 'kano']) {
    const content = await loadCityContent(id)
    assert.equal(content.priceLevel, undefined, id)
  }
  assert.equal(await loadCityContent('lagos'), LAGOS_CONTENT, 'the very same object')
  const prices = (content: CityContent) => json([content.housing.map((h) => [h.definition.rent, h.definition.moveIn]), content.workplaces.map((w) => [w.definition.shift, w.definition.track ? w.definition.ladder : null]), content.venues.map((v) => v.definition.spots)])
  assert.equal(prices(await loadCityContent('lagos')), prices(LAGOS_CONTENT))
  const london = await loadCityContent('london'), accra = await loadCityContent('accra')
  assert.equal(london.priceLevel, level('gb'))
  assert.equal(accra.priceLevel, level('gh'))
})

const entryRents = (content: CityContent) => content.housing.map((h) => h.definition.rent)
const entryPays = (content: CityContent) => content.workplaces.map((w) => w.definition.track ? w.definition.ladder[0]!.pay : w.definition.shift.reward ?? 0)

test('London is dear and pays more; Accra is close to Lagos (rent, wages, shop prices)', async () => {
  await Promise.all([loadCityContent('accra'), loadCityContent('london')])
  const { CONTENT: rawLondon } = await import('./cities/london/content.ts')
  const london = await loadCityContent('london'), accra = await loadCityContent('accra')
  const rawRents = entryRents(rawLondon), rents = entryRents(london)
  assert.ok(rents.length > 0)
  rents.forEach((rent, index) => assert.ok(rent >= (rawRents[index] ?? 0) * 2, `rent ${rent} vs ${rawRents[index]}`))
  const rawPays = entryPays(rawLondon), pays = entryPays(london)
  pays.forEach((pay, index) => assert.ok(pay >= (rawPays[index] ?? 0) * 2, `pay ${pay} vs ${rawPays[index]}`))
  const { CONTENT: rawAccra } = await import('./cities/accra/content.ts')
  const near = (a: number[], b: number[]) => a.forEach((value, index) => { const base = b[index] ?? 0; assert.ok(value >= base * 0.8 && value <= base * 1.25, `${value} vs ${base}`) })
  near(entryRents(accra), entryRents(rawAccra)); near(entryPays(accra), entryPays(rawAccra))
  assert.ok(london.workplaces.length === rawLondon.workplaces.length && london.venues.length === rawLondon.venues.length, 'nothing lost')
  // activity prices and rewards are scaled, and the original content is not mutated
  const sum = (content: CityContent) => content.venues.flatMap((v) => Object.values(v.definition.spots).flatMap((s) => s.activities)).reduce((total, a) => total + (a.cost ?? 0) + (a.reward ?? 0), 0)
  assert.ok(sum(london) >= sum(rawLondon))
  assert.equal(sum(rawLondon), sum(await import('./cities/london/content.ts').then((m) => m.CONTENT)))
  // shop prices go through the 'shop.price' modifier with the city's level
  const at = Date.UTC(2026, 0, 5, 9), lagosCtx = makeContext({ now: at, cityId: 'lagos' }), londonCtx = makeContext({ now: at, cityId: 'london' })
  const rice = INGREDIENTS['rice']!
  assert.equal(groceryPrice(createLife(null, lagosCtx), rice, 1, lagosCtx), rice.price, 'Lagos groceries cost what they always did')
  assert.equal(groceryPrice(createLife(null, londonCtx), rice, 1, londonCtx), scaleNaira(rice.price, level('gb')))
  assert.ok(groceryPrice(createLife(null, londonCtx), rice, 1, londonCtx) >= rice.price * 2)
  const accraCtx = makeContext({ now: at, cityId: 'accra' })
  const inAccra = groceryPrice(createLife(null, accraCtx), rice, 1, accraCtx)
  assert.ok(inAccra >= rice.price * 0.8 && inAccra <= rice.price * 1.25, `Accra rice ${inAccra}`)
})

test('wages stay in step with prices in every country: a shift still buys a day of food, rent keeps its share of pay', () => {
  const base = LAGOS_CONTENT
  const food = Object.values(INGREDIENTS).map((item) => item.price).sort((a, b) => a - b).slice(0, 3)
  const entry = (content: CityContent) => Math.min(...content.workplaces.filter((w) => w.definition.track).map((w) => (w.definition as { ladder: { pay: number }[] }).ladder[0]!.pay))
  const baseRatio = base.housing[0]!.definition.rent / entry(base)
  for (const country of Object.keys(PRICE_LEVEL_DATA.levels)) {
    const at = level(country), scaled = scaleCityContent(base, at)
    const day = food.reduce((total, price) => total + scaleNaira(price, at), 0)
    assert.ok(entry(scaled) >= day, `${country}: a shift pays ${entry(scaled)}, three packs cost ${day}`)
    const ratio = scaled.housing[0]!.definition.rent / entry(scaled)
    assert.ok(Math.abs(ratio - baseRatio) / baseRatio < 0.15, `${country}: rent/pay ${ratio} vs ${baseRatio}`)
    const helper = scaled.workplaces.find((w) => !w.definition.track)
    if (helper) assert.ok((helper.definition.shift.reward ?? 0) * 3 >= scaleNaira(Math.min(...Object.values(INGREDIENTS).map((i) => i.price)), at), country)
  }
})

test('old saves load: nothing stored is rewritten', async () => {
  await loadCityContent('london')
  const at = Date.UTC(2026, 0, 5, 9)
  const old = createLife(null, makeContext({ now: at, cityId: 'london', isNew: true }))
  old.cash = 123456
  const saved = JSON.parse(json(old)) as typeof old
  const loaded = createLife(saved, makeContext({ now: at, cityId: 'london' }))
  assert.equal(loaded.cash, 123456)
  assert.equal(json(loaded.economy), json(old.economy))
  assert.equal(json(createLife(JSON.parse(json(loaded)), makeContext({ now: at, cityId: 'london' }))), json(loaded), 'a second load changes nothing')
  assert.ok(cachedCityContent('london'))
  const lagos = createLife(null, makeContext({ now: at, cityId: 'lagos', isNew: true }))
  assert.equal(json(createLife(JSON.parse(json(lagos)), makeContext({ now: at, cityId: 'lagos' }))), json(lagos))
})

// ---- Starting money (docs/PRICE-LEVELS.md "Starting money") ----
import { BOUTIQUE_PRICES, LOTTERY } from './content/traits.ts'
import { LOAN, LOAN_LATE_FEE, loanTerms } from './systems/economy.ts'
import { STARTING_CASH } from './systems/wallet.ts'
import { dreamFor, lotteryBulletsFor } from './cities/characterContent.ts'
import { cityRules, linksFrom } from './cities/registry.ts'
import { linksPriced } from './systems/estate.ts'
import { lifeLevel, restateNaira } from './price-levels.ts'
import type { LifeState } from '../types/life.ts'
import type { ActionBody } from '../types/actions.ts'

const LONDON_UNIT = (): string => cityRules('london')?.districts.find((district) => district.localUnitId)?.localUnitId ?? ''
const LOOK = { body: 'man', hair: 'low-cut', outfit: 'casual', fabric: 'plain', skin: 'skin-4', hairColor: 'black', outfitColor: 'blue', bottomsColor: 'navy' }
const MONDAY = Date.UTC(2026, 0, 5, 8)
const act = (state: LifeState, type: string, payload: object, seed = 'start') => dispatch(state, { type, payload } as unknown as ActionBody, makeContext({ now: MONDAY, cityId: state.estate.city, seed }))
/** A brand-new life in `city`, through the creator, rolling the wanted lottery outcome, settled in a local government. */
function start(city: string, lga: string, lottery: keyof typeof LOTTERY): LifeState {
  const state = createLife(null, makeContext({ now: MONDAY, cityId: city, seed: 'new', isNew: true, requireOnboarding: true }))
  for (const [type, payload] of [['onboarding.look', { look: LOOK }], ['onboarding.traits', { traits: ['musical', 'tech-bro-or-sis'] }], ['onboarding.dream', { dream: 'lekki-landlord' }]] as const) assert.equal(act(state, type, payload).ok, true, type)
  for (let i = 0; i < 400; i++) {
    const copy = createLife(structuredClone(state), makeContext({ now: MONDAY, cityId: city }))
    act(copy, 'onboarding.lottery', {}, `roll-${i}`)
    if (copy.onboarding.lottery?.id === lottery) { assert.equal(act(state, 'onboarding.lottery', {}, `roll-${i}`).ok, true); break }
  }
  assert.equal(state.onboarding.lottery?.id, lottery)
  assert.equal(act(state, 'onboarding.home', { lga, via: 'manual' }).ok, true)
  return state
}

test('a Nigerian start is exactly what it was: purse, loan, no level stored', async () => {
  await loadCityContent('ibadan')
  assert.equal(loanTerms().total, LOAN.total); assert.equal(loanTerms({}).fee, LOAN_LATE_FEE); assert.equal(loanTerms({ level: 1 }).weekly, LOAN.weekly)
  const fresh = createLife(null, makeContext({ now: MONDAY, cityId: 'ibadan', isNew: true }))
  assert.equal(fresh.cash, STARTING_CASH)
  const lapo = start('ibadan', 'ibadan-north', 'lapo-baby')
  assert.equal(lapo.onboarding.level, undefined, 'a Nigerian life stores nothing new')
  assert.equal(lapo.cash, LOTTERY['lapo-baby'].ownCash + 1000, 'the purse and Settle in’s ₦1,000, paid on moving home')
  assert.deepEqual(lapo.economy.loan, { left: LOAN.total, prepaid: 0, fees: 0 })
  assert.equal(lifeLevel(lapo), 1)
  const grant = lapo.ledger.find((line) => line.reason.startsWith('Start cash'))
  assert.match(grant?.reason ?? '', /includes ₦60,000 LAPO loan/)
})

test('a London start has the purse, the loan, the dream and the Boutique in London prices; buying power is about the same as in Lagos', async () => {
  await loadCityContent('london'); await loadCityContent('ibadan')
  const factor = level('gb')
  assert.ok(factor > 2)
  const london = start('london', LONDON_UNIT(), 'lapo-baby')
  assert.equal(london.onboarding.level, factor)
  // Settle in is paid on moving home, at the city's level like every reward.
  const settled = london.cash - scaleNaira(LOTTERY['lapo-baby'].ownCash, factor)
  assert.equal(settled, scaleNaira(1000, factor))
  assert.ok(Math.abs((london.cash - settled) / LOTTERY['lapo-baby'].ownCash - factor) < 0.01, 'the purse is the Lagos purse times the level')
  const terms = loanTerms({ level: factor })
  assert.deepEqual(london.economy.loan, { left: terms.total, prepaid: 0, fees: 0, level: factor })
  assert.equal(terms.weekly, scaleNaira(LOAN.weekly, factor))
  assert.match(london.ledger.find((line) => line.reason.startsWith('Start cash'))?.reason ?? '', new RegExp(`includes ₦${terms.principal.toLocaleString('en-NG')} LAPO loan`))
  // The loan is collected at the scaled instalment and cleared at the scaled total.
  const before = london.cash
  advanceLife(london, 8 * 86400, makeContext({ now: MONDAY + 8 * 86400000, cityId: 'london' }))
  assert.ok(london.economy.loan && london.economy.loan.left < terms.total, 'an instalment was collected')
  assert.equal(terms.total - london.economy.loan.left, terms.weekly * Math.round((terms.total - london.economy.loan.left) / terms.weekly), 'in whole instalments of the scaled weekly amount')
  assert.ok(before > 0)
  // The same roll in Lagos-priced Ibadan: London's purse buys about the same (cash over the cheapest pack).
  const home = start('ibadan', 'ibadan-north', 'lapo-baby')
  const pack = (city: string, factor2: number) => scaleNaira(Math.min(...Object.values(INGREDIENTS).map((item) => item.price)), factor2)
  const londonPacks = start('london', LONDON_UNIT(), 'civil-servant').cash / pack('london', factor), lagosPacks = start('ibadan', 'ibadan-north', 'civil-servant').cash / pack('ibadan', 1)
  assert.ok(Math.abs(londonPacks / lagosPacks - 1) < 0.05, `${londonPacks} packs against ${lagosPacks}`)
  assert.ok(home.cash > 0)
  // Words that name an amount are restated at the level; at 1 they are the text itself.
  assert.match(dreamFor('london', 'lekki-landlord', factor).goal, new RegExp(`₦${scaleNaira(1000000, factor).toLocaleString('en-NG')}`))
  assert.equal(dreamFor('ibadan', 'lekki-landlord', 1).goal, dreamFor('ibadan', 'lekki-landlord').goal)
  assert.ok(lotteryBulletsFor('london', 'lapo-baby', factor).some((line) => line.includes(`₦${terms.principal.toLocaleString('en-NG')}`)))
  assert.equal(restateNaira('₦60,000 loan, ₦12,000 a week', 1), '₦60,000 loan, ₦12,000 a week')
  // The Boutique is dearer by the same level.
  const priceOf = (state: LifeState) => viewLife(state, makeContext({ now: MONDAY, cityId: state.estate.city })).onboarding.boutique.find((item) => item.kind === 'hair' && item.price > 0)
  const londonHair = priceOf(london), lagosHair = priceOf(home)
  assert.ok(londonHair && lagosHair)
  assert.equal(londonHair.price, scaleNaira(BOUTIQUE_PRICES.hair[londonHair.id]!, factor))
  assert.equal(lagosHair.price, BOUTIQUE_PRICES.hair[lagosHair.id], 'Nigeria: the catalogue price')
})

test('the dream reward and a loan by level; an old life without a level reads as 1 and is not rewritten', async () => {
  await loadCityContent('london')
  const old = createLife(null, makeContext({ now: MONDAY, cityId: 'london', isNew: true }))
  old.cash = 77777
  const loaded = createLife(JSON.parse(json(old)), makeContext({ now: MONDAY, cityId: 'london' }))
  assert.equal(loaded.onboarding.level, undefined); assert.equal(lifeLevel(loaded), 1); assert.equal(loaded.cash, 77777)
  const bad = JSON.parse(json(old)); bad.onboarding.level = 99
  assert.equal(createLife(bad, makeContext({ now: MONDAY, cityId: 'london' })).onboarding.level, undefined, 'a level outside the range is dropped')
  const withLoan = JSON.parse(json(start('london', LONDON_UNIT(), 'lapo-baby')))
  const again = createLife(withLoan, makeContext({ now: MONDAY, cityId: 'london' }))
  assert.equal(json(again.economy.loan), json(withLoan.economy.loan), 'a scaled loan survives a load')
  assert.equal(again.onboarding.level, withLoan.onboarding.level)
})

test('a new life in London begins with a London-sized guest purse; Nigeria keeps 5,000', async () => {
  await loadCityContent('london')
  assert.equal(createLife(null, makeContext({ now: MONDAY, cityId: 'london', isNew: true })).cash, scaleNaira(STARTING_CASH, level('gb')))
  assert.equal(createLife(null, makeContext({ now: MONDAY, cityId: 'lagos', isNew: true })).cash, STARTING_CASH)
})

test('a ticket is in the prices of the city the life started in; Nigerian lives and old lives pay the fare as written', async () => {
  await loadCityContent('london'); await loadCityContent('ibadan')
  const base = linksFrom('ibadan'), london = start('london', LONDON_UNIT(), 'civil-servant'), home = start('ibadan', 'ibadan-north', 'civil-servant')
  assert.ok(base.length > 0)
  linksPriced(london, 'ibadan').forEach((link, i) => assert.equal(link.fare, scaleNaira(base[i]!.fare, level('gb')), `${link.label} costs the London amount`))
  assert.deepEqual(linksPriced(home, 'ibadan'), base, 'a Nigerian start: exactly as written')
  const old = createLife(JSON.parse(json(london)), makeContext({ now: MONDAY, cityId: 'london' })); delete old.onboarding.level
  assert.deepEqual(linksPriced(old, 'ibadan'), base, 'a life without a level reads as 1')
  // The fare is charged, and shown, at the scaled amount.
  london.estate.city = 'ibadan'
  const shown = viewLife(london, makeContext({ now: MONDAY, cityId: 'ibadan' })).estate.links?.find((link) => link.fare > 0)
  assert.equal(shown?.fare, scaleNaira(base.find((link) => link.to === shown?.to && link.mode === shown?.mode)!.fare, level('gb')))
})
