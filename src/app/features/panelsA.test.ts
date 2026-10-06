// Tests of the panels converted in this batch: Jobs, Career, Statement, Invest, Houses, Cars,
// Groceries, Health, Goals, Boutique, the Sim tabs, Settings, Buy mode and the HUD chips.
//
// The logic each one decides is tested directly (the model modules, no browser). The components are
// rendered to a string with Vue's server renderer against the real store and the fake server that
// runs the real rules, and what is asserted is what a player reads: words, roles and labels, every
// disabled control and its reason. What a click does is tested where the logic lives.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { createSSRApp, h } from 'vue'
import type { Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { App } from '../state/app.ts'
import { createFakeServer } from '../testing/fakeServer.ts'
import { glyphParts } from './kit/glyphText.ts'
import { autoWords, chipWords, jobControl, jobsRules, openNow, otherJobs, validAsk } from './jobs/jobsModel.ts'
import { percent, promotionLine, stepLine } from './jobs/careerModel.ts'
import { changes, dayLabel, failedVerdict, sameStatement, verdictOf } from './money/statementModel.ts'
import { investRules, pickAmount } from './money/investModel.ts'
import { housesRules, moveReason, nextHouse, ownedReason, buyReason, quicker, savedPercent } from './home/homeModel.ts'
import { carArt, houseArt } from './home/artModel.ts'
import { lineTotal, orderReason, orderedLine, quickBuy, quoteOf, split } from './home/groceriesModel.ts'
import { blockedReason, placementReason, roomStatus, selectedReason, starsNote, storedReason } from './home/buyModel.ts'
import { cureLine, resistanceOf, summaryOf, toneOf } from './life/healthModel.ts'
import { alertOf, trayOf, warningLabel } from './life/healthChips.ts'
import { loanLine, offlineWhy, perkReason, perkState, rerollLine, wishProgress } from './life/goalsModel.ts'
import { chipAction, chipLabel, lagosDay, newFeed, rememberSeq } from './life/goalChipModel.ts'
import { itemControl, nextTrying, triedItem } from './life/boutiqueModel.ts'
import { feelingsTotal, needLevel, skillRow } from './sim/simModel.ts'
import { nameProblem, saveFailure, saveState } from './sim/profileModel.ts'
import { hintsOn } from './sim/settingsModel.ts'
import { money } from '../ui/format.ts'
import type { BoutiqueItem, CareerView, JobListing } from '../../types/view.ts'

const root = fileURLToPath(new URL('../../..', import.meta.url))
const server = createFakeServer()
let vite: ViteDevServer
let app: App
const realFetch = globalThis.fetch
const load = async <T = { default: Component }>(path: string): Promise<T> => await vite.ssrLoadModule(path) as T
const text = (html: string): string => html.replace(/<!--.*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, '\'').replace(/\s+/g, ' ').trim()
async function render(path: string, props: Record<string, unknown> = {}): Promise<string> {
  const component = (await load(path)).default
  return renderToString(createSSRApp({ render: () => h(component, props) }))
}

before(async () => {
  globalThis.fetch = server.fetch
  vite = await createServer({ root, configFile: `${root}vite.config.ts`, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } })
  const cityLoader = await vite.ssrLoadModule('/src/game/cities/registry.ts') as typeof import('../../game/cities/registry.ts')
  await cityLoader.loadCityContent('lagos')
  app = (await load<{ useApp: () => App }>('/src/app/state/app.ts')).useApp()
  assert.equal(await app.game.connect(), true)
  app.game.stop()
})
after(async () => { app?.game.stop(); await vite?.close(); globalThis.fetch = realFetch })

// ---- models -----------------------------------------------------------------------------------

const job = (extra: Partial<Omit<JobListing, 'id'>> & { id?: string }): JobListing => ({ id: 'tech', label: 'Tech', icon: '', track: true, beta: false, current: false, entryRole: 'Intern', pay: 3600, topRole: 'CTO', summary: '', schedule: '', hours: '', skill: 'coding', duration: 40, workplace: 'CcHub', blocked: null, venue: 'cchub', openNow: true, switchWarning: 'You lose your level.', transfer: false, ...extra }) as unknown as JobListing

test('jobs: open workplaces come first, the player\'s own job is the card at the top, and a question that no longer applies is dropped', () => {
  const list = [job({ id: 'a', openNow: false }), job({ id: 'b' }), job({ id: 'c', current: true }), job({ id: 'd', venue: null, openNow: false })]
  assert.deepEqual(otherJobs(list).map((item) => item.id), ['b', 'd', 'a'], 'open first (a workplace not in this build counts as open), closed last, own job left out')
  assert.equal(openNow(job({ venue: null, openNow: false })), null)
  const career = { employed: true, id: 'tech' } as Pick<CareerView, 'employed' | 'id'>
  assert.equal(validAsk('quit', career), 'quit')
  assert.equal(validAsk('tech', career), null, 'asking about the job already held')
  assert.equal(validAsk('quit', { employed: false, id: null }), null)
  assert.equal(validAsk('bank', { employed: false, id: null }), null, 'no job: no switching to ask about')
  assert.equal(validAsk('bank', career), 'bank')
})

test('jobs: a card offers one control, or the one reason there is none', () => {
  const employed = { employed: true }, free = { employed: false }
  assert.deepEqual(jobControl(job({ current: true }), employed, null, null), { kind: 'current' })
  assert.deepEqual(jobControl(job({ blocked: 'Finish your action.' }), free, null, null), { kind: 'blocked', label: 'Apply', why: 'Finish your action.' })
  assert.deepEqual(jobControl(job({}), employed, 'No internet. Read-only until that is resolved.', null), { kind: 'blocked', label: 'Switch to this job', why: 'No internet. Read-only until that is resolved.' })
  assert.deepEqual(jobControl(job({}), free, null, null), { kind: 'apply' })
  assert.deepEqual(jobControl(job({ id: 'x' }), employed, null, 'x'), { kind: 'confirm', warning: 'You lose your level.' })
  assert.deepEqual(jobControl(job({ id: 'x' }), employed, null, null), { kind: 'switch' })
  assert.ok(autoWords(true).startsWith('On:') && autoWords(false).startsWith('Off:'))
  assert.equal(jobsRules(['One.']).length, 4)
  assert.equal(chipWords({ name: 'Monday', work: true, today: true }), 'Monday: work day, today')
  assert.equal(chipWords({ name: 'Sunday', work: false, today: false }), 'Sunday: day off')
})

test('career: the promotion card says what is still needed, and the step line does not repeat the status', () => {
  const cap = (id: string): string => `${id[0]?.toUpperCase() ?? ''}${id.slice(1)}`
  assert.deepEqual(promotionLine({ isTrack: false, next: null }, cap), { kind: 'starter' })
  assert.deepEqual(promotionLine({ isTrack: true, next: null }, cap), { kind: 'top' })
  const line = promotionLine({ isTrack: true, next: { role: 'Dev', pay: 1, level: 2, skill: 'coding', skillLevel: 3, have: 2, performanceMet: true, skillMet: false, text: 'Next: Dev.' } }, cap)
  assert.deepEqual(line, { kind: 'next', text: 'Next: Dev.', checks: [{ met: true, text: 'Performance 100%' }, { met: false, text: 'Coding level 3 (yours: 2)' }] })
  const today = { code: 'day_off' as const, canWork: false, text: 'Day off.', weekday: 'Sunday' }
  assert.equal(stepLine({ step: { kind: 'wait', text: 'Day off.' }, today, nextShift: 'Next shift: Monday' }), 'Next shift: Monday')
  assert.equal(stepLine({ step: { kind: 'wait', text: 'Rest.' }, today, nextShift: 'Next shift: Monday' }), 'Rest.')
  assert.equal(percent(140), 100); assert.equal(percent(null), 0)
})

test('statement: day labels in Nigerian time, whether the two statements agree, and what is said when they do not', () => {
  assert.equal(dayLabel(Math.floor((Date.UTC(2026, 9, 4, 12) + 3600000) / 86400000)), 'Sun 4 Oct')
  assert.equal(changes(1), '1 change'); assert.equal(changes(3), '3 changes')
  const totals = { in: 10, out: 4, changes: 2, net: 6 }
  const server = { reconciled: true, closing: 106, opening: { balance: 100, day: 1 }, totals }
  assert.equal(sameStatement(server, { opening: { balance: 100, day: 1 }, totals }, 106), true)
  assert.equal(sameStatement(server, { opening: { balance: 100, day: 1 }, totals }, 105), false, 'the balance differs')
  assert.equal(sameStatement({ ...server, reconciled: false }, { opening: { balance: 100, day: 1 }, totals }, 106), false)
  assert.ok(verdictOf('lagos', server, true).text.startsWith('The server’s own statement agrees: closing balance ₦106, 2 changes'))
  assert.ok(verdictOf('lagos', server, false).text.includes('closes at ₦106'))
  assert.equal(failedVerdict('lagos', 429).text, 'You have checked several times this minute. Try again shortly.')
  assert.ok(failedVerdict('lagos', undefined).text.startsWith('The server could not be reached'))
})

test('invest and houses and cars: the amount chosen, the reasons a control is disabled', () => {
  const savings = { amounts: [{ amount: 1000, payouts: { '1d': 1, '3d': 2, '7d': 3 }, blocked: null }, { amount: 5000, payouts: { '1d': 1, '3d': 2, '7d': 3 }, blocked: 'You need ₦5,000.' }] }
  assert.equal(pickAmount(savings as never, 5000)?.amount, 5000)
  assert.equal(pickAmount(savings as never, 123)?.amount, 1000, 'an amount that is not offered falls back to the first')
  assert.equal(investRules({ maxOpen: 3, cap: 100000 }, money)[1], 'Limits: up to 3 deposits at once, and at most ₦100,000 locked in total.')
  assert.equal(moveReason({ current: true, blocked: 'x' }, ''), '')
  assert.equal(moveReason({ current: false, blocked: 'You need ₦9 more.' }, ''), 'You need ₦9 more.')
  assert.equal(moveReason({ current: false, blocked: null }, 'No internet — moving needs the server'), 'No internet — moving needs the server')
  assert.equal(savedPercent(500, 1000), 50); assert.equal(savedPercent(5000, 1000), 100)
  assert.equal(nextHouse({ houses: [{ id: 'a' }, { id: 'b' }] as never, nextHouse: 'b' as never })?.id, 'b')
  assert.ok(housesRules(3)[0]?.includes('3 weeks of rent'))
  assert.equal(ownedReason('', { id: 'x' }), 'Finish your current action first')
  assert.equal(ownedReason('Offline', null), 'Offline')
  assert.equal(buyReason({ blocked: 'Need ₦1' }, ''), 'Need ₦1')
  assert.equal(quicker(0.75), 25)
})

test('house and car drawings: the tier sets the size of the building, the sky and the palms; a car is drawn by kind', () => {
  const [low, high] = [houseArt(0), houseArt(4)]
  assert.ok(high.wall.width > low.wall.width && high.wall.height > low.wall.height)
  assert.equal(low.roof.kind, 'pitched'); assert.equal(high.roof.kind, 'flat')
  assert.deepEqual(low.palms, []); assert.deepEqual(houseArt(3).palms, [52, 278])
  assert.equal(low.panes.filter((pane) => pane.door).length, 1, 'one door')
  assert.equal(carArt('agama-150', 0).kind, 'bike'); assert.equal(carArt('chief-suv', 1).kind, 'suv'); assert.equal(carArt('anything', 2).kind, 'saloon')
  assert.equal(carArt('agama-150', 0).seat, true)
  assert.equal(carArt('x', 9).paint, carArt('x', 0).paint, 'the paint cycles through nine colours')
})

test('groceries: packs are quoted as threes then ones; one tap says why it cannot be sent', () => {
  assert.deepEqual(split(7), [3, 3, 1]); assert.deepEqual(split(0), [])
  const groceries = { rice: { 1: { price: 500, list: 600 }, 3: { price: 1400, list: 1800 } } }
  assert.deepEqual(quoteOf(groceries, { id: 'rice', price: 600 }, 3), { price: 1400, list: 1800 })
  assert.deepEqual(quoteOf(groceries, { id: 'eggs', price: 900 }, 2), { price: 1800, list: 1800 }, 'no quote: the catalogue price')
  assert.equal(lineTotal(groceries, { id: 'rice', price: 600 }, 4), 1400 + 500)
  assert.deepEqual(quickBuy({ quote: { price: 500 }, cash: 1000, connected: true }), { price: 500, blocked: '' })
  assert.equal(quickBuy({ quote: { price: 500 }, cash: 100, connected: true }).blocked, 'Need ₦400 more')
  assert.equal(quickBuy({ quote: { price: 500 }, cash: 1000, connected: false }).blocked, 'Not connected — ordering needs the server')
  assert.equal(quickBuy({ quote: { price: 500 }, cash: 1000, connected: true, busy: true }).blocked, 'Ordering…')
  assert.equal(quickBuy({ quote: null, cash: 1000, connected: true, label: 'Rice' }).blocked, 'No price for Rice yet')
  assert.equal(orderReason({ units: 0, offline: '', short: '', ordering: false, buying: false }), 'Add something with +')
  assert.equal(orderReason({ units: 2, offline: '', short: 'Need ₦5 more', ordering: false, buying: false }), 'Need ₦5 more')
  assert.equal(orderedLine(0, true), ''); assert.equal(orderedLine(3, false), '3 items delivered to your kitchen.'); assert.equal(orderedLine(1, true), '1 item delivered. The rest is still in your basket.')
})

test('buy mode: why a piece cannot be bought or placed, and what the room says about itself', () => {
  assert.equal(blockedReason({ connected: false, short: 'No internet', busy: false, cash: 0, price: 5 }, money), 'No internet — cannot buy right now')
  assert.equal(blockedReason({ connected: true, short: '', busy: true, cash: 0, price: 5 }, money), 'Finish your current action first')
  assert.equal(blockedReason({ connected: true, short: '', busy: false, cash: 2, price: 5 }, money), 'Need ₦3 more')
  assert.equal(blockedReason({ connected: true, short: '', busy: false, cash: 9, price: 5 }, money), '')
  assert.equal(storedReason(false, 'Server unreachable', false), 'Server unreachable — cannot place it right now')
  assert.equal(placementReason({ refusal: { code: 'blocked', reason: 'That spot overlaps your Radio.' }, connected: true, short: '', busy: false, paying: true, price: 5, cash: 0 }, money), 'That spot overlaps your Radio.')
  assert.equal(placementReason({ refusal: null, connected: true, short: '', busy: false, paying: true, price: 5, cash: 2 }, money), 'Need ₦3 more.')
  assert.equal(placementReason({ refusal: null, connected: true, short: '', busy: false, paying: false, price: 5, cash: 2 }, money), '', 'moving or placing from storage is free')
  assert.equal(selectedReason(true, '', true), 'Finish your current action first.')
  assert.equal(roomStatus({ sceneStatus: 'error', connected: true, short: '', placed: 3, grid: 6 }).retry, true)
  assert.equal(roomStatus({ sceneStatus: 'ready', connected: true, short: '', placed: 0, grid: 6 }).text, 'Your room is empty. Open Buy to furnish it.')
  assert.equal(roomStatus({ sceneStatus: 'ready', connected: true, short: '', placed: 4, grid: 6 }).text, '6 × 6 room · 4 objects · tap one to use it')
  assert.ok(roomStatus({ sceneStatus: 'ready', connected: false, short: 'No internet', placed: 4, grid: 6 }).text.startsWith('No internet — showing the last copy'))
  assert.equal(starsNote([0.8, 1, 1.25]), 'no stars ×0.8 · 1 star ×1 · 2 stars ×1.25')
})

test('health: the status, the cure prices and where they are, and the chips that open it', () => {
  assert.equal(toneOf({ sick: true, rundown: true }), 'is-sick'); assert.equal(toneOf({ sick: false, rundown: true }), 'is-rundown'); assert.equal(toneOf({ sick: false, rundown: false }), 'is-well')
  assert.equal(resistanceOf(0.25), 75)
  assert.equal(summaryOf({ sick: false, rundown: false, immune: false, immuneMinutes: 0, cause: null, healsInMinutes: null }), 'Nothing is wrong.')
  assert.ok(summaryOf({ sick: true, rundown: false, immune: false, immuneMinutes: 0, cause: 'rain', healsInMinutes: 90 }).includes('about 2h'))
  const venues = { clinic: { spots: { ward: { activities: [{ id: 'see-nurse', cost: 1500, duration: 12 }] } } } }
  const cure = { id: 'c', label: 'See a nurse', where: 'clinic', activity: 'see-nurse', text: 'Fast.' }
  assert.deepEqual(cureLine(cure as never, 1000, venues), { id: 'c', label: 'See a nurse', price: '₦1,500', time: ' · 12s', short: true, text: 'Fast.', place: 'clinic' })
  assert.equal(cureLine({ id: 'w', label: 'Wait', where: null, text: 'Rest.' } as never, 0, venues).price, 'Free')
  assert.equal(alertOf({ warning: { level: 'rain', icon: '', text: 'Rain' } }), null, 'rain is information for the tray')
  assert.equal(alertOf({ warning: { level: 'sick', icon: '', text: 'You are sick' } })?.text, 'You are sick')
  assert.equal(trayOf({ warning: { level: 'rain', icon: '', text: 'Rain' }, weather: { id: 'rain', label: 'Rain', icon: '', text: '', raining: true, minutesLeft: 3 } })?.kind, 'warning')
  assert.deepEqual(trayOf({ warning: null, weather: { id: 'clear', label: 'Dry', icon: 'x', text: '', raining: false, minutesLeft: 3 } }), { kind: 'weather', id: 'clear', label: 'Dry', icon: 'x' })
  assert.equal(trayOf(undefined), null)
  assert.equal(warningLabel({ text: 'You are sick' }), 'You are sick. Open the Health app.')
})

test('goals: the reasons, the loan card, and the goal chip\'s action, label and toasts', () => {
  assert.equal(offlineWhy(true, 'No internet'), ''); assert.equal(offlineWhy(false, 'No internet'), 'No internet — nothing can change right now')
  assert.equal(perkReason({ owned: true, blocked: 'x' }, 'off'), ''); assert.equal(perkReason({ owned: false, blocked: 'Need 2 more stars' }, ''), 'Need 2 more stars'); assert.equal(perkReason({ owned: false, blocked: null }, 'off'), 'off')
  assert.equal(perkState({ owned: true }, ''), 'is-owned'); assert.equal(perkState({ owned: false }, 'x'), 'is-locked'); assert.equal(perkState({ owned: false }, ''), 'is-ready')
  assert.equal(rerollLine('', { left: 2, max: 3 }), 'Re-rolls left today: 2 of 3')
  assert.equal(wishProgress({ target: 15000, progress: 300, money: true }, money), '₦300 of ₦15,000'); assert.equal(wishProgress({ target: 3, progress: 1, money: false }, money), '1 of 3'); assert.equal(wishProgress({ target: 1, progress: 0, money: false }, money), '')
  assert.deepEqual(loanLine({ left: 72000, weekly: 12000 } as never), { label: 'Loan', left: 72000, weekly: 12000 })
  assert.equal(loanLine({ left: 0 } as never), null); assert.equal(loanLine(null), null)
  assert.deepEqual(chipAction({ kind: 'create', icon: '', title: '', hint: '', open: 'onboarding' }), { kind: 'open', id: 'onboarding' })
  assert.deepEqual(chipAction({ kind: 'goal', id: 'a', icon: '', title: '', hint: '', reward: '', step: 1, of: 2, go: ['park', 'bench'] } as never), { kind: 'go', venue: 'park', spot: 'bench' })
  assert.deepEqual(chipAction({ kind: 'goal', id: 'a', icon: '', title: '', hint: '', reward: '', step: 1, of: 2, open: 'bank', params: { a: 1 } } as never), { kind: 'open', id: 'bank', params: { a: 1 } })
  assert.deepEqual(chipAction({ kind: 'guide', icon: '', title: '', hint: '' }), { kind: 'community' })
  assert.equal(chipLabel({ kind: 'goal', title: 'Freshen up', hint: 'Tap Bathroom.' }), 'Current goal: Freshen up. Tap Bathroom.')
  assert.equal(chipLabel({ kind: 'guide', title: 'Explore', hint: 'Go.' }), 'Next step: Explore. Go.')
  const feed = [{ n: 1, text: 'a' }, { n: 2, text: 'b' }, { n: 3, text: 'c' }]
  assert.deepEqual(newFeed(feed, 1).map((item) => item.text), ['b', 'c']); assert.deepEqual(newFeed(feed, null), [], 'the first look toasts nothing')
  assert.equal(rememberSeq(5, null), 5); assert.equal(rememberSeq(2, 5), 2, 'a different life starts again'); assert.equal(rememberSeq(7, 5), 5)
  assert.equal(lagosDay(Date.UTC(2026, 0, 5, 22, 59)) + 1, lagosDay(Date.UTC(2026, 0, 5, 23, 0)), 'the day turns at 23:00 UTC')
})

test('boutique: trying on is a preview of an item still on offer; each item has one control and one reason', () => {
  const item = (extra: Partial<BoutiqueItem>): BoutiqueItem => ({ kind: 'hair', id: 'afro', label: 'Afro', price: 2000, owned: false, wearing: false, blocked: null, ...extra })
  const shelf = [item({}), item({ id: 'bun', wearing: true })]
  assert.equal(triedItem(shelf, { kind: 'hair', id: 'afro' })?.id, 'afro')
  assert.equal(triedItem(shelf, { kind: 'hair', id: 'bun' }), null, 'what is already worn is not tried on')
  assert.equal(triedItem(shelf, null), null)
  assert.equal(nextTrying({ kind: 'hair', id: 'afro' }, { kind: 'hair', id: 'afro' }), null, 'pressing Try on again takes it off')
  assert.deepEqual(nextTrying(null, { kind: 'hair', id: 'afro' }), { kind: 'hair', id: 'afro' })
  assert.deepEqual(itemControl(item({}), { offline: '', done: true }), { kind: 'buy', why: '' })
  assert.deepEqual(itemControl(item({ blocked: 'Need ₦1,000 more' }), { offline: '', done: true }), { kind: 'buy', why: 'Need ₦1,000 more' })
  assert.deepEqual(itemControl(item({ owned: true }), { offline: '', done: false }), { kind: 'wear', why: 'Finish creating your Sim first.' })
  assert.deepEqual(itemControl(item({ wearing: true }), { offline: '', done: true }), { kind: 'worn' })
  assert.deepEqual(itemControl(item({ kind: 'accessories', wearing: true }), { offline: 'No internet — you cannot shop right now', done: true }), { kind: 'take-off', why: 'No internet — you cannot shop right now' })
})

test('sim tabs: need levels, the feelings total, skill segments, the name rules and the save button', () => {
  assert.equal(needLevel(60), 'high'); assert.equal(needLevel(59), 'mid'); assert.equal(needLevel(29), 'low')
  assert.equal(feelingsTotal([{ value: -10 }, { value: 4 }]).text, '−6'); assert.equal(feelingsTotal([]).text, '+0')
  assert.deepEqual(skillRow({ level: 2, progress: 0.5, next: 300 }), { segments: [100, 100, 50, 0, 0, 0, 0, 0, 0, 0], detail: '50% to level 3' })
  assert.equal(skillRow({ level: 10, progress: 1, next: null }).detail, 'Maxed out')
  assert.equal(nameProblem('ab'), 'A display name needs at least 3 characters.'); assert.equal(nameProblem('a'.repeat(25)), 'A display name can be at most 24 characters.'); assert.equal(nameProblem(' abc '), '')
  const ok = { connected: true, short: '', pending: false, done: true, guest: false, unchanged: false, name: 'Kunle' }
  assert.deepEqual(saveState(ok), { disabled: false, label: 'Save changes' })
  assert.equal(saveState({ ...ok, connected: false, short: 'No internet' }).label, 'No internet — cannot save right now')
  assert.equal(saveState({ ...ok, pending: true }).label, 'Saving…')
  assert.equal(saveState({ ...ok, done: false, guest: true }).label, 'Settle in to change your look')
  assert.equal(saveState({ ...ok, done: false }).label, 'Finish creating your Sim first')
  assert.equal(saveState({ ...ok, unchanged: true }).label, 'No changes yet')
  assert.equal(saveState({ ...ok, name: 'ab' }).disabled, true)
  assert.equal(saveFailure({ reason: 'Not allowed.' }), 'Not allowed.'); assert.ok(saveFailure({ code: 'muted' }).startsWith('A moderator has muted you'))
  assert.equal(saveFailure({ message: 'boom' }), 'Your name could not be saved: boom. Try again.')
})

test('settings: hints are on unless switched off', () => {
  assert.equal(hintsOn({ getItem: () => '1' }), false); assert.equal(hintsOn({ getItem: () => null }), true)
})

test('text with emoji: only an emoji that has a glyph is drawn as one', () => {
  const drawable = (emoji: string): boolean => emoji === '✨'
  assert.deepEqual(glyphParts('+₦500 +1✨ now', drawable), [{ text: '+₦500 +1' }, { emoji: '✨' }, { text: ' now' }])
  assert.deepEqual(glyphParts('plain', drawable), [{ text: 'plain' }])
  assert.deepEqual(glyphParts('🙂 stays', drawable), [{ text: '🙂 stays' }], 'no glyph: left as text')
  assert.deepEqual(glyphParts(null, drawable), [])
})

// ---- components -------------------------------------------------------------------------------

test('Jobs: with no job it leads with the next step and offers a free Apply on every card', async () => {
  const html = await render('/src/app/features/jobs/JobsApp.vue')
  const words = text(html)
  const career = app.game.view.value.career
  assert.ok(!career.employed)
  assert.ok(words.startsWith('No job yet Find work today'), words.slice(0, 60))
  assert.ok(words.includes('Pick a job') && words.includes('How work works'))
  for (const listing of career.jobs) assert.ok(words.includes(listing.label), `${listing.label} is listed`)
  assert.ok((html.match(/Apply — free, hired at once/g) ?? []).length >= 1)
  assert.match(html, /<details[^>]*class="how is-page"/)
})

test('Career: with no job it says where to find one', async () => {
  const words = text(await render('/src/app/features/jobs/CareerTab.vue'))
  assert.ok(words.includes('No job yet') && words.includes('Open Jobs'), words)
})

test('Statement: the closing balance, the sums that add up, every change with its reason', async () => {
  const html = await render('/src/app/features/money/StatementApp.vue')
  const words = text(html), view = app.game.view.value
  assert.match(html, /<section[^>]*aria-label="Closing balance"/)
  assert.ok(words.includes(`Closing balance · ${changes(view.wallet.statement.totals.changes)} ${money(view.wallet.statement.closing)}`), words.slice(0, 120))
  assert.ok(words.includes('Every naira is accounted for.') && words.includes('Check with the server') && words.includes('Something here looks wrong'))
  for (const line of view.wallet.ledger) assert.ok(words.includes(line.reason))
})

test('Invest: the hero, the amounts with the chosen one pressed, and one button per term', async () => {
  const html = await render('/src/app/features/money/InvestApp.vue')
  const savings = app.game.view.value.economy.savings
  assert.match(html, /<section[^>]*aria-label="Locked savings"/)
  assert.match(html, /role="group" aria-label="Deposit amount"/)
  assert.equal((html.match(/class="invest-term"/g) ?? []).length, savings.terms.length)
  assert.match(html, /aria-pressed="true"[^>]*>₦5,000</, 'the amount chosen at first is ₦5,000, and only that one is pressed')
  assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 1)
  assert.ok(text(html).includes('No open deposits'))
})

test('Houses and Cars: every card says its price, and a disabled Move or Buy says why', async () => {
  const houses = await render('/src/app/features/home/HousesApp.vue')
  const property = app.game.view.value.property
  const words = text(houses)
  assert.ok(property && words.includes('Homes to rent') && words.includes('How moving works'))
  for (const house of property.houses) assert.ok(words.includes(house.label), house.label)
  assert.ok(!/<button(?![^>]*disabled)[^>]*>\s*Move in/.test(houses.replace(/<button[^>]*disabled[^>]*>/g, '<button disabled>')) || property.houses.some((house) => !house.current && !house.blocked))
  const cars = await render('/src/app/features/home/CarsApp.vue')
  assert.ok(text(cars).includes('Public transport'), 'no car yet')
  for (const car of property?.cars ?? []) assert.ok(text(cars).includes(car.label))
  assert.match(cars, /role="img" aria-label="A drawing of the /)
})

test('Groceries: a card per ingredient, the price on the one-tap button, an empty basket that cannot be ordered', async () => {
  const html = await render('/src/app/features/home/GroceriesApp.vue')
  const words = text(html)
  assert.ok(words.startsWith('Balance ₦') && words.includes('delivered to your kitchen at once.'))
  assert.match(html, /aria-label="Buy one pack of [^"]+ \(\d+\) now for ₦[\d,]+"/)
  assert.ok(words.includes('Basket is empty'))
  assert.match(html, /<button[^>]*class="ui-button is-primary"[^>]*disabled[^>]*title="Add something with \+"/)
  assert.match(html, /role="group" aria-label="[^"]+: packs in the basket"/)
})

test('Health: how you are, resistance as a meter, advice and every cure with its price', async () => {
  const html = await render('/src/app/features/life/HealthApp.vue')
  const health = app.game.view.value.health
  const words = text(html)
  assert.ok(words.includes(health.status) && words.includes('What to do'))
  assert.match(html, new RegExp(`role="meter" aria-label="Resistance" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${resistanceOf(health.strain)}"`))
  for (const cure of health.cures) assert.ok(words.includes(cure.label))
})

test('Goals: the star count, the current goal, the dream choice, wishes with re-roll buttons, perks that say why not', async () => {
  const html = await render('/src/app/features/life/GoalsTab.vue')
  const goals = app.game.view.value.goals, words = text(html)
  assert.ok(words.includes(`${goals.stars} stars`) || words.includes(`${goals.stars} star`))
  assert.ok(words.includes('Wishes') && words.includes('Perks'))
  assert.equal((html.match(/class="goals-reroll"/g) ?? []).length, goals.wishes.length)
  for (const perk of goals.perks) assert.ok(words.includes(perk.label))
  assert.match(html, /aria-label="Re-roll wish: /)
})

test('Sim tabs: Needs has a meter per need, Skills ten segments per skill, Settings its switches', async () => {
  const needs = await render('/src/app/features/sim/NeedsTab.vue')
  for (const need of app.game.view.value.needs.order) assert.match(needs, new RegExp(`role="meter" aria-label="${need[0]?.toUpperCase()}${need.slice(1)}"`))
  assert.ok(text(needs).includes('Feelings') && text(needs).includes('Mood score'))
  const skills = await render('/src/app/features/sim/SkillsTab.vue')
  assert.match(skills, /aria-valuetext="Level \d+ of 10, /)
  const settings = await render('/src/app/features/sim/SettingsTab.vue')
  assert.equal((settings.match(/role="switch"/g) ?? []).length, 4, 'hints, sound effects, music, and the location-confirmed badge')
  assert.match(settings, /role="group" aria-label="Phone wallpaper"/)
  assert.ok(text(settings).includes('device session') && text(settings).includes('Report a problem'))
})

test('Boutique: the wallet, a section per kind and a Try on button on what is not worn', async () => {
  const html = await render('/src/app/features/life/BoutiqueApp.vue')
  const words = text(html)
  assert.ok(words.includes('Hairstyles') && words.includes('Outfits') && words.includes('Fabrics') && words.includes('Accessories'))
  assert.ok(words.includes(`Wallet ${money(app.game.state.value.cash)}`))
  assert.match(html, /class="ui-button boutique-try"[^>]*aria-pressed="false"/)
})

test('HUD chips: the goal chip carries the step and its reward; nothing is drawn for a healthy life', async () => {
  const goal = await render('/src/app/features/life/GoalChip.vue')
  const chip = app.game.view.value.goals.chip
  assert.match(goal, new RegExp(`aria-label="${chip.kind === 'goal' ? 'Current goal' : 'Next step'}: `))
  assert.ok(text(goal).includes(chip.title))
  assert.equal(text(await render('/src/app/features/life/HealthChip.vue')), '', 'nothing to act on: no chip')
  assert.match(await render('/src/app/features/life/WeatherChip.vue'), /aria-label="Weather: [^"]+\. Open the Health app\."/)
})

test('registry: the converted panels keep the metadata of the panels they replace', async () => {
  const { NATIVE_PANELS } = await load<{ NATIVE_PANELS: { id: string; placement: string; order?: number; group?: string }[] }>('/src/app/features/panels.ts')
  const meta = Object.fromEntries(NATIVE_PANELS.map((panel) => [panel.id, `${panel.placement}/${panel.order ?? ''}/${panel.group ?? ''}`]))
  assert.deepEqual({ jobs: meta.jobs, bank: meta.bank, groceries: meta.groceries, houses: meta.houses, boutique: meta.boutique, cars: meta.cars, invest: meta.invest, statement: meta.statement, health: meta.health },
    { jobs: 'phone/10/money', bank: 'phone/14/money', groceries: 'phone/16/life', houses: 'phone/30/life', boutique: 'phone/32/life', cars: 'phone/34/life', invest: 'phone/50/money', statement: 'phone/15/money', health: 'phone/22/life' })
  assert.deepEqual({ profile: meta.profile, needs: meta.needs, goals: meta.goals, skills: meta.skills, career: meta.career, settings: meta.settings },
    { profile: 'sim-tab/10/', needs: 'sim-tab/20/', goals: 'sim-tab/30/life', skills: 'sim-tab/40/', career: 'sim-tab/60/money', settings: 'sim-tab/70/life' })
  assert.deepEqual({ buy: meta.buy, 'goal-chip': meta['goal-chip'], 'home-chip': meta['home-chip'], 'health-chip': meta['health-chip'], 'weather-chip': meta['weather-chip'] },
    { buy: 'nav//', 'goal-chip': 'hud/10/', 'home-chip': 'hud/20/', 'health-chip': 'hud/6/', 'weather-chip': 'hud/6/' })
})
