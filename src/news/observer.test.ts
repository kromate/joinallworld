// The city news observer: the rate limit, the ordinals, no line twice in an hour, the quiet-hour colour and the outage line.
import test from 'node:test'
import assert from 'node:assert/strict'
import { COOLDOWN_S, FRESH_MS, HOUR_MS, OUTAGE_NEWS_MS, createObserver, hourIndex } from './observer.ts'
import type { GistItem, Observation } from './observer.ts'
import { WEIGHT, bankOf, fill, ordinal, registerFor } from './banks.ts'
import type { Register, Topic } from './banks.ts'

// 14:00 on a Tuesday in Lagos (UTC+1): the afternoon band, a few minutes after the hour starts.
const T0 = Date.UTC(2026, 9, 20, 13, 5)
const view = (more: Partial<Observation> = {}): Observation => ({ now: T0, city: 'lagos', cityName: 'Lagos', register: 'lagos', gist: [], life: null, outages: [], ...more })
const stall = (n: number, at: number, where = 'Tejuosho Market', what = 'food stall'): GistItem => ({ n, at, kind: 'business', text: `Ada opened a ${what} in ${where}` })

test('the cooldown is 7 seconds plus the story\'s weight, and a story that has to wait is told when the board is free', () => {
  const observer = createObserver(() => 0)
  const first = observer.observe(view({ gist: [stall(1, T0 - 1000)] }))
  assert.equal(first?.topic, 'stall-first')
  const wait = (COOLDOWN_S + WEIGHT['stall-first']) * 1000
  // A second story one second later waits: it is queued, not lost.
  assert.equal(observer.observe(view({ now: T0 + 1000, gist: [stall(1, T0 - 1000), stall(2, T0, 'Yaba Market', 'tailor shop')] })), null)
  assert.equal(observer.observe(view({ now: T0 + wait - 1 })), null, 'still quiet one millisecond early')
  const second = observer.observe(view({ now: T0 + wait }))
  assert.equal(second?.topic, 'stall-first')
  assert.match(second!.text, /tailor shop/)
})

test('a heavier story is told first, and a heavy one holds the board longer than a light one', () => {
  const observer = createObserver(() => 0)
  const gist: GistItem[] = [stall(1, T0 - 5000), { n: 2, at: T0 - 4000, kind: 'election', text: 'Tunde was elected governor of Lagos' }]
  const line = observer.observe(view({ gist }))
  assert.equal(line?.topic, 'news', 'the election before the stall')
  assert.match(line!.text, /elected governor of Lagos/)
  assert.equal(line!.text.includes('..'), false)
  assert.ok(WEIGHT.news > WEIGHT['stall-first'])
  assert.equal(observer.observe(view({ now: T0 + (COOLDOWN_S + WEIGHT.news) * 1000 - 1, gist })), null)
  assert.equal(observer.observe(view({ now: T0 + (COOLDOWN_S + WEIGHT.news) * 1000, gist }))?.topic, 'stall-first')
})

test('ordinals count the stalls of one place in the city clock\'s hour, and a new hour starts again', () => {
  const observer = createObserver(() => 0)
  const said: string[] = []
  let now = T0
  const gist: GistItem[] = []
  for (let n = 1; n <= 3; n++) {
    gist.push(stall(n, now - 1000))
    const line = observer.observe(view({ now, gist: [...gist] }))
    said.push(line!.text)
    now += 20000
  }
  assert.match(said[0]!, /A new food stall|Fresh food stall|open food stall/, 'the first is just a new stall')
  assert.match(said[1]!, /2nd food stall/)
  assert.match(said[2]!, /3rd food stall/)
  assert.ok(said[1]!.includes('Tejuosho Market') && said[1]!.includes('this hour'))
  // Another place has its own count.
  gist.push(stall(4, now - 1000, 'Yaba Market'))
  const other = observer.observe(view({ now, gist: [...gist] }))
  assert.equal(other!.topic, 'stall-first')
  // The next hour of the clock starts the count again.
  const later = T0 + HOUR_MS
  assert.notEqual(hourIndex(later), hourIndex(T0))
  gist.push(stall(5, later - 1000))
  const again = observer.observe(view({ now: later, gist: [...gist] }))
  assert.equal(again!.topic, 'stall-first', 'first of the new hour')
})

test('an old stall is counted but not announced: the next one in the same hour is the 2nd', () => {
  const observer = createObserver(() => 0)
  const now = Date.UTC(2026, 9, 20, 13, 50) // 14:50 Lagos
  const old = stall(1, Date.UTC(2026, 9, 20, 13, 5)), fresh = stall(2, now - 1000)
  const line = observer.observe(view({ now, gist: [old, fresh] }))
  assert.equal(line?.topic, 'stall-nth')
  assert.match(line!.text, /2nd food stall/)
})

test('no line is repeated within an hour: a bank line is not reused while another is free, and the same words are not posted twice', () => {
  const observer = createObserver(() => 0) // always picks the first free line
  const crowd = bankOf('lagos').crowd
  const said: string[] = []
  let now = T0
  const gist: GistItem[] = []
  for (let n = 1; n <= crowd.length; n++) {
    gist.push({ n, at: now - 1000, kind: 'busy', text: `Lagos is buzzing: ${10 + n} people out right now` })
    said.push(observer.observe(view({ now, gist: [...gist] }))!.text)
    now += 30000
  }
  const templates = said.map((text, i) => crowd.findIndex((template) => text === fill(template, { text: `Lagos is buzzing: ${11 + i} people out right now` })))
  assert.deepEqual(templates, crowd.map((_, i) => i), 'the crowd templates take turns before either repeats')
  // The very same gist words again and again: once every template has been used, the words would repeat, so the line is dropped.
  const same = createObserver(() => 0)
  const told: (string | undefined)[] = []
  for (let n = 1; n <= crowd.length + 1; n++) {
    const at = T0 + n * 30000
    told.push(same.observe(view({ now: at, gist: [{ n, at: at - 1000, kind: 'busy', text: 'The Square is packed right now' }] }))?.text)
  }
  assert.ok(told.slice(0, crowd.length).every(Boolean))
  assert.equal(told[crowd.length], undefined, 'the same words are not posted twice within the hour')
  assert.equal(new Set(told.filter(Boolean)).size, crowd.length)
})

test('the life topics (cash, goal, level) post at most once an hour each', () => {
  const observer = createObserver(() => 0)
  const life = (cash: number, level: number, goals: number) => ({ cash, level, goals })
  assert.equal(observer.observe(view({ life: life(2000, 1, 0) }))?.topic, 'afternoon', 'the first look only sets the baseline; the quiet hour is coloured')
  let now = T0 + 20000
  assert.equal(observer.observe(view({ now, life: life(2000, 2, 0) }))?.topic, 'level')
  now += 20000
  assert.equal(observer.observe(view({ now, life: life(2000, 3, 0) })), null, 'a second level in the hour is not a second line')
  now += 20000
  assert.equal(observer.observe(view({ now, life: life(2000, 3, 1) }))?.topic, 'goal')
  now += 20000
  assert.equal(observer.observe(view({ now, life: life(9000, 3, 1) }))?.topic, 'cash')
  now += 20000
  assert.equal(observer.observe(view({ now, life: life(9100, 3, 1) })), null, 'a small rise is nothing')
  assert.equal(observer.observe(view({ now: now + 1, life: life(4000, 3, 1) })), null, 'neither is a fall')
})

test('the outage line: told once when the district\'s light has just gone, with the district\'s name, not told for an old cut, not told twice', () => {
  const observer = createObserver(() => 0)
  const out = [{ district: 'Yaba', from: T0 - 2 * 60000 }]
  const line = observer.observe(view({ outages: out }))
  assert.equal(line?.topic, 'outage')
  assert.match(line!.text, /Yaba/)
  assert.match(line!.text, /generators/i)
  // Still out a minute later, the cooldown over: not told again.
  const next = T0 + (COOLDOWN_S + WEIGHT.outage) * 1000 + 1
  assert.notEqual(observer.observe(view({ now: next, outages: out }))?.topic, 'outage')
  // A cut that began long ago is no news.
  const fresh = createObserver(() => 0)
  assert.notEqual(fresh.observe(view({ outages: [{ district: 'Surulere', from: T0 - OUTAGE_NEWS_MS - 1 }] }))?.topic, 'outage')
  // The outage does not wait behind another story for ever: it is told once the board is free if it is still fresh.
  const busy = createObserver(() => 0)
  busy.observe(view({ gist: [{ n: 1, at: T0 - 1000, kind: 'election', text: 'Tunde was elected governor of Lagos' }] }))
  assert.equal(busy.observe(view({ now: T0 + 1000, outages: [{ district: 'Ikeja', from: T0 }] })), null)
  assert.equal(busy.observe(view({ now: T0 + (COOLDOWN_S + WEIGHT.news) * 1000, outages: [{ district: 'Ikeja', from: T0 }] }))?.topic, 'outage')
})

test('only one outage line an hour, even when several districts go dark together', () => {
  const observer = createObserver(() => 0)
  const outages = [{ district: 'Yaba', from: T0 - 1000 }, { district: 'Ikeja', from: T0 - 1000 }, { district: 'Lekki', from: T0 - 1000 }]
  let told = 0
  for (let step = 0; step < 6; step++) if (observer.observe(view({ now: T0 + step * 20000, outages }))?.topic === 'outage') told++
  assert.equal(told, 1)
})

test('quiet hours get one line of colour: only when nothing is happening, once an hour, in the band of the day', () => {
  const observer = createObserver(() => 0)
  const first = observer.observe(view())
  assert.equal(first?.topic, 'afternoon')
  assert.equal(observer.observe(view({ now: T0 + 30 * 60000 })), null, 'not again in the same hour')
  const evening = Date.UTC(2026, 9, 20, 17, 30) // 18:30 Lagos
  assert.equal(observer.observe(view({ now: evening }))?.topic, 'evening')
  // News first: with a story waiting the colour does not run.
  const busy = createObserver(() => 0)
  const line = busy.observe(view({ gist: [{ n: 1, at: T0 - 1000, kind: 'law', text: 'The City House passed a law: no noise after 11pm' }] }))
  assert.equal(line?.topic, 'news')
  // And no colour right after a line: 90 seconds of nothing are needed.
  assert.equal(busy.observe(view({ now: T0 + 60000 })), null)
})

test('the board forgets the lines of an old hour (recent() is the last hour only) and recent() is newest first', () => {
  const observer = createObserver(() => 0)
  observer.observe(view())
  observer.observe(view({ now: T0 + 60000, gist: [{ n: 1, at: T0 + 59000, kind: 'busy', text: 'Lagos is buzzing: 12 people out right now' }] }))
  const recent = observer.recent(T0 + 61000)
  assert.equal(recent.length, 2)
  assert.equal(recent[0]!.topic, 'crowd')
  assert.equal(observer.recent(T0 + HOUR_MS + 61000).length, 0)
})

test('every bank has every topic in every register, with only the placeholders its topic is given and no money or name in the words', () => {
  const allowed: Record<Topic, string[]> = {
    'stall-first': ['what', 'where'], 'stall-nth': ['what', 'where', 'ord'], news: ['text'], arrest: ['text'], crowd: ['text'], plain: ['text'],
    outage: ['district', 'city'], cash: ['city'], goal: ['city'], level: ['city'], dawn: ['city'], morning: ['city'], afternoon: ['city'], evening: ['city'], night: ['city'],
  }
  for (const register of ['lagos', 'kano', 'english'] as Register[]) {
    const bank = bankOf(register)
    for (const topic of Object.keys(allowed) as Topic[]) {
      assert.ok(bank[topic].length >= 2, `${register}/${topic} has lines`)
      assert.equal(new Set(bank[topic]).size, bank[topic].length, `${register}/${topic} has no twins`)
      for (const line of bank[topic]) {
        const used = [...line.matchAll(/\{(\w+)\}/g)].map((match) => match[1]!)
        assert.ok(used.every((name) => allowed[topic].includes(name)), `${register}/${topic}: ${line}`)
        assert.ok(line.length <= 100, `${register}/${topic} is short: ${line}`)
        assert.doesNotMatch(line, /[₦$£€]|naira|kobo/i, 'no money in a line')
        const filled = fill(line, { what: 'food stall', where: 'Yaba Market', ord: '2nd', text: 'x'.repeat(120), district: 'Yaba', city: 'Lagos' })
        assert.doesNotMatch(filled, /\{\w+\}/, `${register}/${topic} is filled: ${line}`)
      }
    }
  }
})

test('registers: Lagos pidgin-light for Nigeria, Kano for the north, plain English elsewhere; ordinals read right', () => {
  assert.equal(registerFor('lagos', 'ng'), 'lagos')
  assert.equal(registerFor('ibadan', 'ng'), 'lagos')
  assert.equal(registerFor('kano', 'ng'), 'kano')
  assert.equal(registerFor('accra', 'gh'), 'english')
  assert.equal(registerFor('paris', undefined), 'english')
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map(ordinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st', '111th'])
})

test('a different register speaks in its own words', () => {
  const lagos = createObserver(() => 0).observe(view({ outages: [{ district: 'Yaba', from: T0 }] }))
  const kano = createObserver(() => 0).observe(view({ register: 'kano', outages: [{ district: 'Fagge', from: T0 }] }))
  const english = createObserver(() => 0).observe(view({ register: 'english', outages: [{ district: 'Osu', from: T0 }] }))
  assert.match(lagos!.text, /don take light/)
  assert.match(kano!.text, /NEPA has taken light in Fagge/)
  assert.match(english!.text, /power is out in Osu/)
})
