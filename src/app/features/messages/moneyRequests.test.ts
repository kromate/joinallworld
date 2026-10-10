import test from 'node:test'
import assert from 'node:assert/strict'
import { createMoneyRequests } from './moneyRequests.ts'
import type { RequestHost } from './moneyRequests.ts'
import type { Message, MoneyRequestView } from '../../../types/social.ts'

const request: MoneyRequestView = { id: 'MR-1', amount: 500, state: 'open', mine: true, expiresAt: 9e12, payable: false }
const message = { seq: 3, id: 'c#3', conv: 'c', from: { id: 'ada', name: 'Ada' }, body: 'Asked for ₦500', at: 1, request } as Message
type Call = { path: string; body: Record<string, unknown> }
type Answer = Awaited<ReturnType<RequestHost['call']>>
function host(replies: Answer[]) {
  const calls: Call[] = [], toasts: string[] = [], applied: MoneyRequestView[] = []
  let n = 0, lives = 0
  const api: RequestHost = {
    async call(path, body) { calls.push({ path, body: body as Record<string, unknown> }); await Promise.resolve(); return replies.shift()! },
    newClientId: () => `id-${++n}`, cityId: () => 'lagos',
    apply: (_line, view) => { applied.push(view) }, toast: (text) => { toasts.push(text) }, refreshLife: () => { lives += 1 },
  }
  return { api, calls, toasts, applied, lives: () => lives }
}

test('asking sends the form once under one id, adds the card and clears the form', async () => {
  const h = host([{ ok: true, request, message }])
  const flow = createMoneyRequests(h.api)
  flow.openForm(); flow.ask.amount = '500'; flow.ask.note = ' lunch '
  const first = flow.submit('bola', {}), second = flow.submit('bola', {})
  assert.equal(await second, false, 'a second tap while the call is out does nothing')
  assert.equal(await first, true)
  assert.equal(h.calls.length, 1)
  assert.deepEqual(h.calls[0]!.body, { to: 'bola', amount: 500, note: 'lunch', clientId: 'id-1' })
  assert.equal(flow.ask.open, false); assert.equal(h.applied.length, 1)
})

test('a bad amount never leaves the device, and a refusal keeps the form with the server wording', async () => {
  const h = host([{ ok: false, code: 'request_open', reason: 'Bola already has a request from you waiting.' }])
  const flow = createMoneyRequests(h.api)
  flow.openForm(); flow.ask.amount = '12.5'
  assert.equal(await flow.submit('bola', {}), false); assert.equal(h.calls.length, 0); assert.match(flow.ask.error, /whole amount/)
  flow.ask.amount = '500'
  assert.equal(await flow.submit('bola', {}), false)
  assert.equal(flow.ask.open, true); assert.deepEqual(h.toasts, ['Bola already has a request from you waiting.'])
})

test('a call that never reached the server is retried under the same id; a refusal gets a new one', async () => {
  const h = host([{ ok: false, code: 'network', reason: 'Connection lost.', transport: true }, { ok: false, code: 'rate_limited', reason: 'Too many requests in a minute.' }, { ok: true, request: { ...request, mine: false, payable: true }, }])
  const flow = createMoneyRequests(h.api)
  await flow.answer('MR-1', 'pay', 'Ada', 500)
  await flow.answer('MR-1', 'pay', 'Ada', 500)
  await flow.answer('MR-1', 'pay', 'Ada', 500)
  assert.deepEqual(h.calls.map((call) => call.body.clientId), ['id-1', 'id-1', 'id-2'])
  assert.equal(h.calls[0]!.body.cityId, 'lagos')
  assert.equal(flow.busy.size, 0)
})

test('paying is one call while it is out, a refusal leaves the card as it was, and success refreshes the cash', async () => {
  const h = host([{ ok: false, code: 'recipient_limit', reason: 'Ada has received the most a player can be given in one day (₦50,000).' }, { ok: true, request: { ...request, state: 'paid' } }])
  const flow = createMoneyRequests(h.api)
  const a = flow.answer('MR-1', 'pay', 'Ada', 500), b = flow.answer('MR-1', 'pay', 'Ada', 500)
  assert.equal(flow.busy.has('MR-1'), true)
  await Promise.all([a, b])
  assert.equal(h.calls.length, 1); assert.equal(h.applied.length, 0); assert.match(h.toasts[0]!, /most a player/); assert.equal(h.lives(), 0)
  await flow.answer('MR-1', 'pay', 'Ada', 500)
  assert.equal(h.applied.at(-1)?.state, 'paid'); assert.equal(h.toasts.at(-1), 'Paid ₦500 to Ada'); assert.equal(h.lives(), 1)
})
