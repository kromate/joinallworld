// The lazy list's engine and the numbers its component draws with (docs/LISTS.md): cursor paging that keeps each row once, a read dropped
// when the query changes, a failure that waits for its retry, the prefetch distance, the window of a long list and the chunks of a chat.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { OVERSCAN, PREFETCH_SCREENS, WINDOW_AFTER, chunkStart, chunkedView, createLazyList, farFromTop, keepPosition, keptList, keptPosition, moreShown, nearEnd, prefetchMargin, shouldWindow, windowSlice } from './lazyList.ts'
import type { Fetched } from './lazyList.ts'

interface Row { id: string }
const rows = (...ids: string[]): Row[] => ids.map((id) => ({ id }))
/** A server of `count` rows read `size` at a time by a cursor that is the id of the last row held. */
function server(count: number, size: number, log: (string | null)[] = []) {
  const all = Array.from({ length: count }, (_, index) => ({ id: `r${String(index).padStart(4, '0')}` }))
  return async (cursor: string | null): Promise<Fetched<Row>> => {
    log.push(cursor)
    const from = cursor ? all.findIndex((row) => row.id > cursor) : 0
    const page = from < 0 ? [] : all.slice(from, from + size)
    return { ok: true, items: page, next: from >= 0 && from + page.length < count ? page.at(-1)?.id ?? null : null, total: count }
  }
}

test('pages are read by cursor, one at a time, each row kept once, and it stops at the end', async () => {
  const log: (string | null)[] = []
  const list = createLazyList<Row>({ key: (row) => row.id, label: 'players', fetchPage: server(95, 40, log) })
  await list.reset()
  assert.deepEqual([list.items.value.length, list.hasMore.value, list.total.value, list.announcement.value], [40, true, 95, ''])
  const both = [list.loadMore(), list.loadMore()]
  await Promise.all(both)
  assert.equal(list.items.value.length, 80, 'two asks at once read one page')
  assert.equal(list.announcement.value, 'Loaded 40 more players')
  await list.loadMore()
  assert.deepEqual([list.items.value.length, list.hasMore.value, list.announcement.value], [95, false, 'Loaded 15 more players'])
  await list.loadMore()
  assert.equal(log.length, 3, 'nothing is asked for after the end')
  assert.deepEqual(log, [null, 'r0039', 'r0079'])
})

test('a row that comes twice is shown once, and rows can be added at the top or taken out', async () => {
  const pages: Fetched<Row>[] = [{ ok: true, items: rows('a', 'b'), next: 'b' }, { ok: true, items: rows('b', 'c'), next: null }]
  const list = createLazyList<Row>({ key: (row) => row.id, fetchPage: async () => pages.shift() ?? { ok: false, reason: 'none' } })
  await list.reset(); await list.loadMore()
  assert.deepEqual(list.items.value.map((row) => row.id), ['a', 'b', 'c'])
  assert.equal(list.announcement.value, 'Loaded 1 more rows')
  list.upsert({ id: 'z' }); list.upsert({ id: 'b' }, true)
  assert.deepEqual(list.items.value.map((row) => row.id), ['z', 'a', 'b', 'c'])
  list.remove('a')
  assert.deepEqual(list.items.value.map((row) => row.id), ['z', 'b', 'c'])
})

test('a failure is kept with its reason, nothing is asked for by itself until Try again, and the first page can fail too', async () => {
  let fail = true, asked = 0
  const list = createLazyList<Row>({ key: (row) => row.id, fetchPage: async () => { asked += 1; return fail ? { ok: false, reason: 'No signal.' } : { ok: true, items: rows('a'), next: null } } })
  await list.reset()
  assert.deepEqual([list.error.value, list.items.value.length, list.loading.value], ['No signal.', 0, false])
  await list.loadMore(); await list.loadMore()
  assert.equal(asked, 1, 'a failed list waits to be told')
  fail = false
  await list.retry()
  assert.deepEqual([list.error.value, list.items.value.length, asked], [null, 1, 2])
  // A reader that throws is a failure too, not an exception for the screen.
  const thrown = createLazyList<Row>({ key: (row) => row.id, fetchPage: async () => { throw new Error('boom') } })
  await thrown.reset()
  assert.equal(thrown.error.value, 'boom')
})

test('changing the query drops the read still on its way: its rows are never shown', async () => {
  const waiting: ((value: Fetched<Row>) => void)[] = []
  const signals: AbortSignal[] = []
  let query = 'first'
  const list = createLazyList<Row>({ key: (row) => row.id, fetchPage: (_cursor, signal) => { signals.push(signal); const mine = query; return new Promise<Fetched<Row>>((resolve) => { waiting.push((value) => resolve(mine === 'first' ? { ...(value as { ok: true; items: Row[]; next: null }), items: rows('old') } : value)) }) } })
  const first = list.reset()
  query = 'second'
  const second = list.reset()
  assert.equal(signals[0]?.aborted, true, 'the old read is told to stop')
  waiting[1]?.({ ok: true, items: rows('new'), next: null }); await second
  waiting[0]?.({ ok: true, items: rows('old'), next: null }); await first
  assert.deepEqual(list.items.value.map((row) => row.id), ['new'])
  assert.equal(list.loading.value, false)
})

test('the next page is asked for while the reader is still one and a half screens from the end', () => {
  assert.equal(PREFETCH_SCREENS, 1.5)
  // A viewport of 800 over a list 5000 tall: 1200 from the end is the line.
  assert.equal(nearEnd(2999, 800, 5000), false)
  assert.equal(nearEnd(3000, 800, 5000), true)
  assert.equal(nearEnd(4200, 800, 5000), true)
  assert.equal(nearEnd(0, 800, 900), true, 'a short list is already near its end')
  assert.equal(nearEnd(0, 0, 900), false, 'a list with no height yet asks for nothing')
  assert.equal(prefetchMargin(800), 1200)
  assert.equal(prefetchMargin(-5), 0)
  assert.equal(farFromTop(2399, 800), false)
  assert.equal(farFromTop(2401, 800), true)
})

test('a long list of one row height draws only the rows near the viewport, and the scroll height is the real one', () => {
  assert.equal(shouldWindow(WINDOW_AFTER, 60), false)
  assert.equal(shouldWindow(WINDOW_AFTER + 1, 60), true)
  assert.equal(shouldWindow(5000, undefined), false, 'rows of unknown height are not windowed')
  const top = windowSlice(10000, 60, 0, 800)
  assert.deepEqual(top, { start: 0, end: Math.ceil(800 / 60) + OVERSCAN, height: 600000 })
  const middle = windowSlice(10000, 60, 60 * 5000, 800)
  assert.deepEqual([middle.start, middle.end], [5000 - OVERSCAN, 5000 + Math.ceil(800 / 60) + OVERSCAN])
  assert.ok(middle.end - middle.start < 40, 'a handful of rows out of ten thousand')
  const bottom = windowSlice(10000, 60, 600000 - 800, 800)
  assert.equal(bottom.end, 10000)
  // A list that starts below a heading: scrolling is measured from the list's own top.
  assert.deepEqual(windowSlice(1000, 50, 400, 500, 400), windowSlice(1000, 50, 0, 500, 0))
  assert.deepEqual(windowSlice(0, 60, 100, 800), { start: 0, end: 0, height: 0 })
  // Never past the ends, whatever the scroll position says.
  assert.deepEqual(windowSlice(20, 60, 99999, 800).end, 20)
  assert.equal(windowSlice(20, 60, -50, 800).start, 0)
})

test('a conversation draws its newest lines first and more as the reader goes up', () => {
  assert.equal(chunkStart(200, 60), 140)
  assert.equal(chunkStart(30, 60), 0)
  assert.equal(moreShown(60, 200, 40), 100)
  assert.equal(moreShown(180, 200, 40), 200)
})

test('a list already in memory is drawn a chunk at a time', () => {
  const all = Array.from({ length: 100 }, (_, index) => index)
  const view = chunkedView(() => all, 40)
  assert.deepEqual([view.visible.value.length, view.hasMore.value], [40, true])
  view.more(); view.more()
  assert.deepEqual([view.visible.value.length, view.hasMore.value], [100, false])
  view.reset()
  assert.equal(view.visible.value.length, 40)
})

test('a list left and shown again keeps its rows and its place, and the kept ones are bounded', async () => {
  let made = 0
  const make = () => { made += 1; return createLazyList<Row>({ key: (row) => row.id, fetchPage: server(10, 5) }) }
  const first = keptList('lists-test', make)
  await first.reset()
  assert.equal(keptList('lists-test', make), first)
  assert.equal(made, 1)
  keepPosition('lists-test', 640)
  assert.equal(keptPosition('lists-test'), 640)
  assert.equal(keptPosition('never-seen'), 0)
  for (let i = 0; i < 60; i++) keepPosition(`bound-${i}`, i)
  assert.equal(keptPosition('bound-59'), 59)
})
