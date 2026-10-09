import test from 'node:test'
import assert from 'node:assert/strict'
import { access, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fixture } from '../test-fixture.ts'
import { createFileVoices } from './voice-files.ts'
import { runVoiceJourney, syntheticWebmOpus, type VoiceAnswer, type VoiceJourneyHost } from '../testing/voiceJourney.ts'

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
