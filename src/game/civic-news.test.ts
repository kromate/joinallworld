// The city, state and national news a life is told: every new item is remembered, and the five most recent are posted to Updates.
import assert from 'node:assert/strict'
import test from 'node:test'
import { loadCityContent } from './cities/registry.ts'
import { createLife } from '../life.ts'
import { postNews } from './systems/civic.ts'

await loadCityContent('lagos')
const NOW = Date.UTC(2026, 0, 5, 9)

const items = (count: number, from = 0) => Array.from({ length: count }, (_, index) => ({ id: `state-result-${from + index}`, title: `News ${from + index}`, text: 'Elected', at: NOW + index * 1000 }))

test('with more than five new items the five newest are posted, oldest of them first, and all are remembered', () => {
  const state = createLife(null, { cityId: 'lagos', now: NOW })
  state.civic.since = NOW - 86400000
  const outcome = postNews(state, { items: items(9) }, { now: NOW + 60000, cityId: 'lagos', rng: () => 0.5 })
  assert.equal(outcome.ok && outcome.code, 'posted')
  const posted = state.social.notices.filter((notice) => notice.text.startsWith('News')).map((notice) => notice.text)
  assert.deepEqual(posted, ['News 4: Elected', 'News 5: Elected', 'News 6: Elected', 'News 7: Elected', 'News 8: Elected'])
  assert.equal(state.civic.news.length, 9)
  const again = postNews(state, { items: items(9) }, { now: NOW + 120000, cityId: 'lagos', rng: () => 0.5 })
  assert.equal(again.ok && again.code, 'nothing_new', 'told once')
})

test('news from before the life began is remembered as seen, not replayed', () => {
  const state = createLife(null, { cityId: 'lagos', now: NOW })
  state.civic.since = NOW + 500
  const outcome = postNews(state, { items: items(3) }, { now: NOW + 60000, cityId: 'lagos', rng: () => 0.5 })
  assert.deepEqual([outcome.ok && outcome.code, state.civic.news.length, state.social.notices.filter((notice) => notice.text.startsWith('News')).length], ['posted', 3, 2], 'only items from after the life began are shown')
})
