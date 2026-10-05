import { loadCityContent as preloadCityContent } from '../../../game/cities/registry.ts';
await Promise.all(['lagos', 'ibadan'].map(preloadCityContent));
// The Tables app's words and rules, without a browser: the rows of the list, the split between
// "where you are" and "elsewhere", the result sentence with its paid-win line, the turn clock, the
// rules select's values, the back button's rule and the static registration of both panels.
import assert from 'node:assert/strict'
import test from 'node:test'
import type { TableStateFrame, TableSummary } from './tablesBoundary.ts'
import {
  botCounts, botLabel, clockBar, heroFigure, heroNote, hostNote, leavesOnBack, listIsStale, nameAt, openLabel, optionKey, outcomeNote, outcomeTitle,
  parseOption, partition, ratingLine, rowSub, rowWho, startNote, tableParam, tableTitle,
} from './tablesModel.ts'
import { chipGames } from './tablesChipModel.ts'

const table = (patch: Partial<TableSummary> = {}): TableSummary => ({
  id: 'buka-corner', venue: 'amala-shitta', venueLabel: 'Amala Shitta', game: 'whot', gameLabel: 'Whot', label: 'Corner table', status: 'open', max: 4, min: 2, options: {}, seats: [], watching: 0, ...patch,
})

test('a row says who is at the table, whether a game is on and how many watch', () => {
  assert.equal(tableTitle(table()), 'Whot · Corner table')
  assert.equal(rowWho(table()), 'Empty: sit down and start')
  assert.equal(rowWho(table({ seats: [{ name: 'Ada', bot: false }, { name: 'Mama Put', bot: true }] })), 'Ada waiting for players')
  assert.equal(rowWho(table({ status: 'playing', seats: [{ name: 'Ada', bot: false }, { name: 'Mama Put', bot: true }] })), 'Game on · Ada, Mama Put')
  assert.equal(rowSub(table({ watching: 2 })), 'Amala Shitta · Empty: sit down and start · 2 watching')
  assert.equal(openLabel(table({ status: 'playing' }), true), 'Watch')
  assert.equal(openLabel(table(), true), 'Sit')
  assert.equal(openLabel(table(), false), 'Look')
})

test('the list is split into the tables where the Sim is and the others; a trip has none "here"', () => {
  const list = [table({ id: 'a', venue: 'park' }), table({ id: 'b', venue: 'beach' }), table({ id: 'c', venue: 'park' })]
  const { mine, other } = partition(list, 'park')
  assert.deepEqual(mine.map((row) => row.id), ['a', 'c'])
  assert.deepEqual(other.map((row) => row.id), ['b'])
  assert.equal(partition(list, null).mine.length, 0)
  assert.equal(heroFigure(0), 'No table where you are')
  assert.equal(heroFigure(1), '1 table where you are')
  assert.equal(heroFigure(2), '2 tables where you are')
  assert.equal(heroNote(null), 'Play with whoever is here, or with a bot.')
  assert.equal(heroNote({ win: 1500, paidLeft: 3, perDay: 4 }), 'A win against a real player pays ₦1,500 · 3 of 4 paid wins left today')
  assert.equal(ratingLine('Whot', { rating: 1212, played: 6, won: 3, provisional: true }), 'Your Whot rating: 1212 (provisional) · 3 won of 6 rated games.')
})

test('the start buttons: bots up to the free seats, and the note that goes with them', () => {
  assert.deepEqual(botCounts(0), [])
  assert.deepEqual(botCounts(2), [1, 2])
  assert.deepEqual(botCounts(4), [1, 2, 3])
  assert.equal(botLabel(1), '+ 1 bot')
  assert.equal(botLabel(3), '+ 3 bots')
  assert.match(startNote({ min: 2, seats: [{}] }), /Nobody else here yet/)
  assert.match(startNote({ min: 2, seats: [{}, {}] }), /Everyone seated plays/)
  assert.equal(hostNote(true), 'You sat down first, so you choose.')
})

test('the result: title, and the line about pay (a win against a real player, a bot, a fun game)', () => {
  const won = { won: true, draw: false, human: true, counted: true, rating: 1220, change: 20 }
  assert.equal(outcomeTitle({ calledOff: false, mine: won }), 'You won')
  assert.equal(outcomeTitle({ calledOff: false, mine: { won: false, draw: true } }), 'A draw')
  assert.equal(outcomeTitle({ calledOff: false, mine: { won: false, draw: false } }), 'You lost this one')
  assert.equal(outcomeTitle({ calledOff: false, mine: null }), 'Game over')
  assert.equal(outcomeTitle({ calledOff: true, mine: won }), 'Called off')
  const paid = { game: 'whot', label: 'Whot', won: true, code: 'paid' }
  assert.equal(outcomeNote({ calledOff: false, mine: won }, paid, 1500), '+₦1,500 paid. Rating 1220 (+20).')
  assert.equal(outcomeNote({ calledOff: false, mine: won }, { ...paid, code: 'for_fun' }, 1500), 'Counted for your missions. Today’s paid wins are used up. Rating 1220 (+20).')
  assert.equal(outcomeNote({ calledOff: false, mine: { ...won, change: undefined, rating: undefined } }, null, 1500), 'Collecting your win…')
  assert.equal(outcomeNote({ calledOff: false, mine: { won: true, draw: false, human: false, counted: false } }, null, 1500), 'A game against bots pays nothing.')
  assert.equal(outcomeNote({ calledOff: false, mine: { won: false, draw: false, human: true, counted: false } }, null, 0), 'You two have played your three counted games today: this one was for fun.')
  assert.equal(outcomeNote({ calledOff: false, mine: { won: false, draw: false, human: true, counted: true, rating: 1190, change: -10 } }, null, 0), 'It counts for your missions. Rating 1190 (-10).')
  assert.equal(outcomeNote({ calledOff: true, mine: won }, null, 0), null)
  assert.equal(outcomeNote({ calledOff: false, mine: null }, null, 0), null)
})

test('opening on a table, the back button, the stale list and the rules select', () => {
  assert.equal(tableParam({ table: 'park-goal' }), 'park-goal')
  assert.equal(tableParam({ table: '' }), null)
  assert.equal(tableParam({ table: 5 }), null)
  assert.equal(tableParam(null), null)
  assert.equal(tableParam(undefined), null)
  // Back gives up the seat unless a game is on; as the existing panel did, also while the table has not loaded.
  const state = (you: number | null, status: TableSummary['status']): Pick<TableStateFrame, 'you' | 'table'> => ({ you, table: table({ status }) })
  assert.equal(leavesOnBack(state(0, 'open')), true)
  assert.equal(leavesOnBack(state(0, 'playing')), false)
  assert.equal(leavesOnBack(state(null, 'open')), false)
  assert.equal(leavesOnBack(null), true)
  assert.equal(listIsStale(true, 0, true, 20001), true)
  assert.equal(listIsStale(true, 0, true, 20000), false)
  assert.equal(listIsStale(true, 0, false, 99999), false)
  assert.equal(listIsStale(false, 0, true, 99999), false)
  for (const value of [5, 3, true, 'fast'] as const) assert.equal(parseOption(optionKey(value)), value)
  assert.equal(parseOption('{'), undefined)
  assert.equal(parseOption('null'), undefined)
})

test('the turn clock starts where the turn really is and is absent when no game is on', () => {
  const state = (clock: TableStateFrame['clock'], status: TableSummary['status'] = 'playing') => ({ clock, n: 7, table: table({ status }) })
  assert.equal(clockBar(state(null), 0), null)
  assert.equal(clockBar(state({ deadline: 1000, now: 0, seconds: 30 }, 'over'), 0), null)
  assert.deepEqual(clockBar(state({ deadline: 31000, now: 1000, seconds: 30 }), 1000), { seconds: 30, from: '1.00', key: '7|30|1.00' })
  assert.deepEqual(clockBar(state({ deadline: 31000, now: 1000, seconds: 30 }), 16000), { seconds: 15, from: '0.50', key: '7|15|0.50' })
  assert.equal(clockBar(state({ deadline: 31000, now: 1000, seconds: 30 }), 99000)?.seconds, 1)
  assert.equal(nameAt([{ name: 'Ada' }], 0), 'Ada')
  assert.equal(nameAt([{ name: 'Ada' }], null, 'Next'), 'Next')
  assert.equal(chipGames([{ game: 'whot' }, { game: 'penalty' }, { game: 'whot' }]), 'Whot, Penalties')
})
