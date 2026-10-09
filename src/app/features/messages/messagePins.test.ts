import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { FetchOptions } from '../../types/client.ts'
import type { Conversation, HistoryResult, Message, MessagePinsChangedFrame, MessagePinsView } from '../../../types/social.ts'
import { createMessagePins } from './messagePins.ts'
import { isMessagePinsFrame } from './messagePinsFrame.ts'

interface Request {
  path: string
  options?: FetchOptions
  resolve(value: unknown): void
  reject(error: unknown): void
}

const message = (seq = 1, body = `Message ${seq}`): Message => ({ seq, id: `g.1#${seq}`, conv: 'g.1', from: { id: 'a', name: 'Ada' }, body, at: seq, version: 0 })
const conversation = (owner = 'a'): Conversation => ({ id: 'g.1', kind: 'group', name: 'Group', members: [{ id: 'a', name: 'Ada' }, { id: 'b', name: 'Bola' }], owner, with: null, last: null, unread: 0 })
const view = (revision: number, seqs: number[] = [], canManage = true, scope = 'scope-1'): MessagePinsView => ({ scope, revision, canManage, items: seqs.map((seq) => ({ message: message(seq) })) })
const history = (pins: MessagePinsView, conv = conversation()): HistoryResult => ({ ok: true, code: 'ok', conv, messages: [], read: 0, pins })
const frame = (pins: MessagePinsView): MessagePinsChangedFrame => ({ type: 'message-pins', conv: conversation(), pins })
const turn = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

function fixture() {
  let actor: string | null = 'a', id = 0
  const requests: Request[] = []
  async function fetchJson<T = Record<string, unknown>>(path: string, options?: FetchOptions): Promise<T> {
    return new Promise<T>((resolve, reject) => requests.push({ path, options, resolve: (value) => resolve(value as T), reject }))
  }
  const pins = createMessagePins({ fetchJson, newId: () => `pin-${++id}`, actor: () => actor, connected: () => true })
  const take = (part: string): Request => { const at = requests.findIndex((request) => request.path.includes(part)); assert.notEqual(at, -1, `missing request ${part}`); return requests.splice(at, 1)[0]! }
  return { pins, requests, take, actor: (next: string | null) => { actor = next } }
}

test('a stale load and an older reconnect response cannot overwrite a newer socket projection', async () => {
  const f = fixture()
  f.pins.setContext('a', conversation())
  const first = f.take('?limit=1')
  f.pins.receive(frame(view(2, [2])))
  first.resolve(history(view(1, [1])))
  await turn()
  assert.deepEqual([f.pins.state.view?.revision, f.pins.state.view?.items[0]?.message.seq], [2, 2])

  void f.pins.load(); const older = f.take('?limit=1')
  f.pins.reconnect(); const newer = f.take('?limit=1')
  newer.resolve(history(view(4, [4]))); await turn()
  older.resolve(history(view(3, [3]))); await turn()
  assert.deepEqual([f.pins.state.view?.revision, f.pins.state.view?.items[0]?.message.seq], [4, 4])
})

test('an unrelated socket revision does not finish a pending mutation or get overwritten by its older response', async () => {
  const f = fixture()
  f.pins.setContext('a', conversation()); f.take('?limit=1').resolve(history(view(1))); await turn()
  f.pins.change({ message: message(1), pinned: true })
  const mutation = f.take('/pins')
  f.pins.receive(frame(view(2, [2])))
  assert.equal(f.pins.state.pending, true)
  mutation.resolve({ ok: true, code: 'updated', pins: view(2, [1]) })
  await turn()
  assert.equal(f.pins.state.pending, false)
  assert.equal(f.pins.state.view?.items[0]?.message.seq, 2, 'same-revision HTTP projection started earlier than the socket stays stale')
})

test('an ambiguous change keeps its exact client id across socket reconciliation and explicit retry', async () => {
  const f = fixture()
  f.pins.setContext('a', conversation()); f.take('?limit=1').resolve(history(view(1))); await turn()
  f.pins.change({ message: message(1), pinned: true })
  const first = f.take('/pins'), original = first.options?.body
  first.reject(new Error('offline')); await turn()
  assert.equal(f.pins.state.retryable, true)
  f.pins.receive(frame(view(2, [2])))
  assert.equal(f.pins.state.retryable, true)
  f.pins.change({ message: message(2), pinned: false })
  assert.equal(f.requests.length, 0, 'a new intent is blocked while the original outcome is unresolved')
  f.pins.retryChange()
  const retry = f.take('/pins')
  assert.deepEqual(retry.options?.body, original)
  retry.resolve({ ok: false, code: 'pins_changed', reason: 'Shared pins changed.' }); await turn()
  assert.equal(f.pins.state.retryable, false)
  f.take('?limit=1').resolve(history(view(2, [2]))); await turn()
})

test('A to B to A and role removal synchronously fence every earlier load and mutation', async () => {
  const f = fixture()
  f.pins.setContext('a', conversation()); const oldA = f.take('?limit=1')
  f.actor('b'); f.pins.setContext('b', conversation()); const loadB = f.take('?limit=1')
  f.actor('a'); f.pins.setContext('a', conversation()); const newA = f.take('?limit=1')
  oldA.resolve(history(view(7, [7]))); loadB.resolve(history(view(8, [8]))); await turn()
  assert.equal(f.pins.state.view, null)
  newA.resolve(history(view(1))); await turn()

  f.pins.change({ message: message(1), pinned: true }); const oldMutation = f.take('/pins')
  f.pins.setContext('a', conversation('b'))
  assert.deepEqual([f.pins.state.view, f.pins.state.pending, f.pins.state.retryable], [null, false, false])
  const roleLoad = f.take('?limit=1')
  oldMutation.resolve({ ok: true, code: 'updated', pins: view(2, [1]) }); await turn()
  assert.equal(f.pins.state.view, null)
  roleLoad.resolve(history(view(1, [], false), conversation('b'))); await turn()
  assert.equal(f.pins.state.view?.canManage, false)
})

test('history for a new scope drops an ambiguous old-incarnation retry before showing the fresh projection', async () => {
  const f = fixture()
  f.pins.setContext('a', conversation()); f.take('?limit=1').resolve(history(view(1))); await turn()
  f.pins.change({ message: message(1), pinned: true })
  f.take('/pins').reject(new Error('offline')); await turn()
  assert.equal(f.pins.state.retryable, true)
  void f.pins.load()
  f.take('?limit=1').reject(new Error('offline')); await turn()
  assert.deepEqual([f.pins.state.view, f.pins.state.retryable], [null, true])
  void f.pins.load()
  f.take('?limit=1').resolve(history(view(0, [], true, 'scope-2'))); await turn()
  assert.deepEqual([f.pins.state.view?.scope, f.pins.state.pending, f.pins.state.retryable], ['scope-2', false, false])
  f.pins.retryChange()
  assert.equal(f.requests.length, 0, 'the old incarnation has no retry control or retained request')
})

test('management loss survives a transient empty view and clears the old ambiguous intent', async () => {
  const f = fixture()
  f.pins.setContext('a', conversation()); f.take('?limit=1').resolve(history(view(1))); await turn()
  f.pins.change({ message: message(1), pinned: true }); f.take('/pins').reject(new Error('offline')); await turn()
  void f.pins.load(); f.take('?limit=1').reject(new Error('offline')); await turn()
  assert.deepEqual([f.pins.state.view, f.pins.state.retryable], [null, true])
  void f.pins.load(); f.take('?limit=1').resolve(history(view(1, [], false))); await turn()
  assert.deepEqual([f.pins.state.view?.canManage, f.pins.state.pending, f.pins.state.retryable], [false, false, false])
  f.pins.retryChange(); assert.equal(f.requests.length, 0)
})

test('a definitive history denial fences an older pending mutation, including HTTP authority errors', async () => {
  for (const denial of [{ response: { ok: false, code: 'not_a_member', reason: 'You are not in that conversation.' } }, { error: { status: 403, code: 'blocked', reason: 'This chat is blocked.' } }]) {
    const f = fixture()
    f.pins.setContext('a', conversation()); f.take('?limit=1').resolve(history(view(1))); await turn()
    f.pins.change({ message: message(1), pinned: true }); const mutation = f.take('/pins')
    void f.pins.load(); const authority = f.take('?limit=1')
    if (denial.response) authority.resolve(denial.response); else authority.reject(denial.error)
    await turn()
    assert.deepEqual([f.pins.state.view, f.pins.state.pending, f.pins.state.retryable], [null, false, false])
    mutation.resolve({ ok: true, code: 'updated', pins: view(2, [1]) }); await turn()
    assert.deepEqual([f.pins.state.view, f.pins.state.retryable], [null, false])
  }
})

test('history without an authorized pins projection fences an older pending mutation', async () => {
  const f = fixture()
  f.pins.setContext('a', conversation()); f.take('?limit=1').resolve(history(view(1))); await turn()
  f.pins.change({ message: message(1), pinned: true }); const mutation = f.take('/pins')
  void f.pins.load(); const authority = f.take('?limit=1')
  authority.resolve({ ok: true, code: 'ok', conv: conversation(), messages: [], read: 0 })
  await turn()
  assert.deepEqual([f.pins.state.view, f.pins.state.pending, f.pins.state.retryable], [null, false, false])
  mutation.resolve({ ok: true, code: 'updated', pins: view(2, [1]) }); await turn()
  assert.equal(f.pins.state.view, null)
})

test('a mutation authority error clears its intent while a transport error preserves the exact retry', async () => {
  const denied = fixture()
  denied.pins.setContext('a', conversation()); denied.take('?limit=1').resolve(history(view(1))); await turn()
  denied.pins.change({ message: message(1), pinned: true }); denied.take('/pins').reject({ status: 403, code: 'blocked', reason: 'This chat is blocked.' }); await turn()
  assert.deepEqual([denied.pins.state.view, denied.pins.state.pending, denied.pins.state.retryable], [null, false, false])
  denied.pins.retryChange(); assert.equal(denied.requests.length, 0)

  const uncertain = fixture()
  uncertain.pins.setContext('a', conversation()); uncertain.take('?limit=1').resolve(history(view(1))); await turn()
  uncertain.pins.change({ message: message(1), pinned: true }); const first = uncertain.take('/pins'), body = first.options?.body
  first.reject(new Error('offline')); await turn(); uncertain.pins.retryChange()
  assert.deepEqual(uncertain.take('/pins').options?.body, body)
})

test('socket role loss cancels a pending mutation and its late result cannot restore pins or retry controls', async () => {
  const f = fixture()
  f.pins.setContext('a', conversation()); f.take('?limit=1').resolve(history(view(1))); await turn()
  f.pins.change({ message: message(1), pinned: true })
  const mutation = f.take('/pins')
  f.pins.receive({ type: 'message-pins', conv: conversation('b'), pins: view(1, [], false) })
  assert.deepEqual([f.pins.state.view?.canManage, f.pins.state.view?.items.length, f.pins.state.pending, f.pins.state.retryable], [false, 0, false, false])
  mutation.resolve({ ok: true, code: 'updated', pins: view(2, [1], true) }); await turn()
  assert.deepEqual([f.pins.state.view?.canManage, f.pins.state.view?.items.length, f.pins.state.retryable], [false, 0, false])
  f.pins.retryChange()
  assert.equal(f.requests.length, 0)
})

test('socket pin guards reject enum arrays instead of coercing them to valid strings', () => {
  const valid = frame(view(1, [1]))
  assert.equal(isMessagePinsFrame(valid), true)
  assert.equal(isMessagePinsFrame({ ...valid, conv: { ...valid.conv, kind: ['group'] } }), false)
  const pictured = frame({ ...view(1), items: [{ message: { ...message(1), image: { id: 'picture', width: 10, height: 10, state: ['hidden'] } } }] } as never)
  assert.equal(isMessagePinsFrame(pictured), false)
  const voiced = frame({ ...view(1), items: [{ message: { ...message(1), voice: { id: 'voice', durationMs: 1000, state: ['reported'] } } }] } as never)
  assert.equal(isMessagePinsFrame(voiced), false)
})
