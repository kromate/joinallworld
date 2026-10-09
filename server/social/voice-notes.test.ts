import test from 'node:test'
import assert from 'node:assert/strict'
import { access, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fixture } from '../test-fixture.ts'
import { createFileVoices } from './voice-files.ts'
import { runVoiceJourney, syntheticWebmOpus, type VoiceAnswer, type VoiceJourneyHost } from '../testing/voiceJourney.ts'

interface PinVoiceMessage { seq: number; version?: number; voice?: { id: string; state?: string } }
interface PinVoiceReply {
  status: number; code?: string; conv?: { id: string }; message?: PinVoiceMessage; messages?: PinVoiceMessage[]
  pins?: { scope: string; revision: number; items: { message: PinVoiceMessage }[] }
}
const required = <T>(value: T | null | undefined): T => { if (value === null || value === undefined) throw new TypeError('Expected response field'); return value }

test('Node voice-note HTTP journey enforces private playback, retry identity, revocation, reports, and deletion cleanup', async t => {
  const f = await fixture(t)
  const request = (path: string, body: unknown | null, who?: { cookie: string }, expectedActor?: string): Promise<Response> => expectedActor === undefined
    ? f.request(path, body ?? undefined, who?.cookie)
    : fetch(f.base + path, {
      method: body ? 'POST' : 'GET',
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(who ? { cookie: who.cookie } : {}), 'X-Allworld-Actor': expectedActor },
      body: body ? JSON.stringify(body) : undefined,
    })
  const host: VoiceJourneyHost = {
    async actor(name) {
      const actor = await f.device(name)
      assert.equal((await f.request('/api/social/me', undefined, actor.cookie)).status, 200)
      return actor
    },
    async json(path, body, who, expectedActor) {
      const response = await request(path, body, who, expectedActor)
      return { ...await response.json() as Omit<VoiceAnswer, 'status'>, status: response.status }
    },
    async media(path, who, expectedActor) {
      const response = await request(path, null, who, expectedActor)
      return { status: response.status, bytes: new Uint8Array(await response.arrayBuffer()), cache: response.headers.get('cache-control') }
    },
    async hasVoice(id) {
      try { await access(join(f.dir, 'chat-voice-notes', `${id}.voice`)); return true } catch { return false }
    },
    async voiceCount() { return (await createFileVoices(join(f.dir, 'chat-voice-notes')).stats()).count },
    id: f.id,
  }
  await runVoiceJourney(host)
})

test('Node shared voice pins refresh for blocks and reports, then reconcile at expiry', async t => {
  const f = await fixture(t)
  const json = async (path: string, body: unknown | null, who: { cookie: string }) => {
    const response = await f.request(path, body ?? undefined, who.cookie)
    return { status: response.status, ...await response.json() as object } as PinVoiceReply
  }
  const actors = await Promise.all(['Pin Ada', 'Pin Bola', 'Pin Chi'].map(async name => {
    const actor = await f.device(name); await json('/api/life?city=lagos', null, actor); await json('/api/social/me', null, actor); return actor
  }))
  const [ada, bola, chi] = actors as [typeof actors[number], typeof actors[number], typeof actors[number]]
  for (const other of [bola, chi]) {
    assert.equal((await json('/api/social/friends/request', { to: other.id, cityId: 'lagos' }, ada)).code, 'requested')
    assert.equal((await json('/api/social/friends/answer', { from: ada.id, accept: true, cityId: 'lagos' }, other)).code, 'accepted')
  }
  const group = await json('/api/social/groups', { name: 'Pinned voices', members: [bola.id, chi.id], clientId: f.id() }, ada)
  const conv = required(group.conv).id, data = Buffer.from(syntheticWebmOpus()).toString('base64')
  const sent = await json('/api/social/voice', { conv, clientId: f.id(), data }, ada)
  const opened = await json(`/api/social/conversations/${conv}`, null, ada)
  const sentMessage = required(sent.message), sentVoice = required(sentMessage.voice), openedPins = required(opened.pins)
  const pin = await json(`/api/social/conversations/${conv}/pins`, { scope: openedPins.scope, pinRevision: 0, clientId: f.id(), op: 'set', seq: sentMessage.seq, messageVersion: sentMessage.version ?? 0, pinned: true }, ada)
  assert.equal(required(required(required(pin.pins).items[0]).message.voice).id, sentVoice.id)

  const chiSocket = await f.socket(chi), adaSocket = await f.socket(ada)
  const nextPins = async (peer: Awaited<ReturnType<typeof f.socket>>) => {
    for (let attempt = 0; attempt < 10; attempt += 1) { const frame = await peer.next(); if (frame.type === 'message-pins') return frame.pins }
    throw new Error('Expected message-pins frame')
  }
  assert.equal((await json('/api/social/block', { id: ada.id, cityId: 'lagos' }, chi)).code, 'blocked')
  assert.equal((await nextPins(chiSocket)).items.length, 0)
  assert.equal(required((await json(`/api/social/conversations/${conv}`, null, chi)).pins).items.length, 0)
  assert.equal((await json('/api/social/unblock', { id: ada.id }, chi)).code, 'unblocked')
  assert.equal((await nextPins(chiSocket)).items.length, 1)
  assert.equal(required(required(required(required((await json(`/api/social/conversations/${conv}`, null, chi)).pins).items[0]).message.voice).id), sentVoice.id)
  assert.equal((await json('/api/social/reports', { conv, voice: sentVoice.id, reason: 'other' }, chi)).code, 'reported')
  assert.equal((await nextPins(chiSocket)).items.length, 0)
  assert.deepEqual([required((await json(`/api/social/conversations/${conv}`, null, chi)).pins).items.length, required((await json(`/api/social/conversations/${conv}`, null, bola)).pins).items.length], [0, 1])
  assert.equal((await json('/api/social/reports', { conv, voice: sentVoice.id, reason: 'other' }, bola)).code, 'reported')
  assert.deepEqual([(await nextPins(adaSocket)).revision, (await nextPins(chiSocket)).revision], [2, 2])
  assert.deepEqual([required((await json(`/api/social/conversations/${conv}`, null, ada)).pins).revision, required((await json(`/api/social/conversations/${conv}`, null, ada)).pins).items.length], [2, 0])

  const fresh = await json('/api/social/voice', { conv, clientId: f.id(), data }, ada)
  const freshMessage = required(fresh.message)
  const repinned = await json(`/api/social/conversations/${conv}/pins`, { scope: openedPins.scope, pinRevision: 2, clientId: f.id(), op: 'set', seq: freshMessage.seq, messageVersion: freshMessage.version ?? 0, pinned: true }, ada)
  assert.equal(required(repinned.pins).revision, 3)
  assert.deepEqual([(await nextPins(adaSocket)).revision, (await nextPins(chiSocket)).revision], [3, 3])
  f.advance(15 * 86400000)
  for (const actor of [ada, chi]) assert.equal((await f.request('/api/session', undefined, actor.cookie)).status, 200, 'the same authenticated actor renews through the normal session route')
  f.advance(15 * 86400000 + 1)
  const expired = await json(`/api/social/conversations/${conv}`, null, ada)
  assert.deepEqual([required(expired.pins).revision, required(expired.pins).items.length, expired.messages?.find(message => message.seq === freshMessage.seq)?.voice?.state], [4, 0, 'expired'])
  assert.deepEqual([(await nextPins(adaSocket)).revision, (await nextPins(chiSocket)).revision], [4, 4], 'history reconciliation clears every active viewer after commit')
  const replacement = await json('/api/social/messages', { conv, body: 'replacement pin', clientId: f.id() }, ada), replacementMessage = required(replacement.message)
  const reused = await json(`/api/social/conversations/${conv}/pins`, { scope: openedPins.scope, pinRevision: 4, clientId: f.id(), op: 'set', seq: replacementMessage.seq, messageVersion: replacementMessage.version ?? 0, pinned: true }, ada)
  assert.deepEqual([required(reused.pins).revision, required(reused.pins).items[0]?.message.seq], [5, replacementMessage.seq], 'expired voice no longer consumes shared capacity')
})

test('Node voice files survive a store restart and retention trimming removes old private bytes', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'joinallworld-voice-files-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }))
  const bytes = syntheticWebmOpus(), id = 'a'.repeat(32)
  const voice = { id, conv: 'dm.ada.bola', at: 1000, size: bytes.length, durationMs: 200, type: 'webm-opus' as const }
  await createFileVoices(dir).put(voice, bytes)

  const afterRestart = createFileVoices(dir)
  const stored = await afterRestart.get(id)
  assert.ok(stored, 'fresh store instance reloads the persisted metadata and bytes')
  assert.deepEqual(stored.bytes, bytes)
  assert.deepEqual(await afterRestart.trim(2000, 512_000), [id])
  assert.equal(await afterRestart.get(id), null)
  assert.deepEqual(await afterRestart.stats(), { count: 0, bytes: 0 })
})

test('Node voice startup reconciliation removes invalid owned pairs and stale temps only', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'joinallworld-voice-reconcile-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }))
  const bytes = syntheticWebmOpus()
  const ids = {
    valid: '1'.repeat(32), corrupt: '2'.repeat(32), missing: '3'.repeat(32),
    sizeMismatch: '4'.repeat(32), idMismatch: '5'.repeat(32), staleTemp: '6'.repeat(32),
  }
  const facts = (id: string, size: number) => JSON.stringify({ id, conv: 'dm.ada.bola', at: 1000, size, durationMs: 200, type: 'webm-opus' })
  const put = (name: string, value: string | Uint8Array) => writeFile(join(dir, name), value)

  await put(`${ids.valid}.json`, facts(ids.valid, bytes.length))
  await put(`${ids.valid}.voice`, bytes)
  await put(`${ids.corrupt}.json`, '{not valid json')
  await put(`${ids.corrupt}.voice`, bytes)
  await put(`${ids.missing}.json`, facts(ids.missing, bytes.length))
  await put(`${ids.sizeMismatch}.json`, facts(ids.sizeMismatch, bytes.length + 1))
  await put(`${ids.sizeMismatch}.voice`, bytes)
  await put(`${ids.idMismatch}.json`, facts(ids.valid, bytes.length))
  await put(`${ids.idMismatch}.voice`, bytes)
  await put(`${ids.staleTemp}.voice.tmp`, bytes)
  await put(`${ids.staleTemp}.json.tmp`, facts(ids.staleTemp, bytes.length))
  await put('keep.txt', 'unrelated')
  await put('custom.voice', bytes)
  await put('unrelated.json.tmp.backup', 'unrelated')

  const afterRestart = createFileVoices(dir)
  const stored = await afterRestart.get(ids.valid)
  assert.ok(stored, 'a complete, matching pair survives startup')
  assert.deepEqual(stored.bytes, bytes)
  for (const id of [ids.corrupt, ids.missing, ids.sizeMismatch, ids.idMismatch, ids.staleTemp]) {
    assert.equal(await afterRestart.get(id), null, `${id} is not indexed after startup`)
  }
  assert.deepEqual(await afterRestart.stats(), { count: 1, bytes: bytes.length })
  assert.deepEqual(new Set(await readdir(dir)), new Set([
    `${ids.valid}.json`, `${ids.valid}.voice`,
    'keep.txt', 'custom.voice', 'unrelated.json.tmp.backup',
  ]))
})
