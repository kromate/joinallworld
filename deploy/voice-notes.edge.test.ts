import test from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { layoutBindings } from '../server/testing/sqliteStorage.ts'
import { runVoiceJourney, type VoiceAnswer, type VoiceJourneyHost } from '../server/testing/voiceJourney.ts'

interface MiniflareInstance {
  ready: Promise<URL>
  dispose(): Promise<void>
  dispatchFetch(url: string, init?: RequestInit): Promise<Response>
  unsafeGetDurableObjectStorage(script: string, className: string, id: { name: string }): Promise<{ exec(query: string, ...bindings: (string | number | null)[]): Promise<{ id: string }[]> }>
}
interface MiniflareTooling { Miniflare: new (options: Record<string, unknown>) => MiniflareInstance; convertV4MiniflareOptions(options: Record<string, unknown>): Record<string, unknown> }
interface BundleOptions { entryPoints: string[]; outfile: string; bundle: boolean; format: string; platform: string; external: string[] }
const require = createRequire(resolve(process.env['JOINALLWORLD_TOOLS'] || 'deploy/tooling', 'package.json'))
const { Miniflare, convertV4MiniflareOptions } = require('miniflare') as MiniflareTooling
const { build } = require('esbuild') as { build(options: BundleOptions): Promise<unknown> }

interface Actor { id: string; name: string; cookie: string }
const within = <T>(step: string, work: Promise<T>, ms = 30000): Promise<T> => {
  let timer: NodeJS.Timeout
  return Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error(`${step} did not finish within ${ms} ms`)), ms) })]).finally(() => clearTimeout(timer))
}

async function fixture(t: TestContext) {
  const folder = await mkdtemp(join(tmpdir(), 'joinallworld-voice-edge-'))
  const bundle = join(folder, 'worker.mjs'), storagePath = join(folder, 'storage')
  await build({ entryPoints: [new URL('./cloudflare-worker.ts', import.meta.url).pathname], outfile: bundle, bundle: true, format: 'esm', platform: 'neutral', external: ['cloudflare:workers'] })
  const options = {
    name: 'joinallworld-voice-notes', script: await readFile(bundle, 'utf8'), modules: true, compatibilityDate: '2026-10-01',
    durableObjects: { JOINALLWORLD: { className: 'JoinAllworldState', useSQLite: true } }, durableObjectsPersist: storagePath,
    bindings: { ...layoutBindings(), BUILD_ID: 'local-voice-notes', FOUNDER_EMAIL_SHA256: '', CHAT_VOICE_NOTES: 'friends' },
  }
  const make = () => new Miniflare({ ...convertV4MiniflareOptions(options), resourcePersistencePath: storagePath, unsafeInspectDurableObjects: true, handleStructuredLogs: () => {} })
  let mf = make()
  const origin = 'https://joinallworld.test', handed: Response[] = []
  const send = async (path: string, init?: RequestInit): Promise<Response> => { const response = await mf.dispatchFetch(origin + path, init); handed.push(response); return response }
  async function stop(): Promise<void> {
    for (const response of handed.splice(0)) if (!response.bodyUsed && response.body && !response.body.locked) await response.body.cancel().catch(() => {})
    await within('Miniflare dispose', mf.dispose())
  }
  t.after(async () => { await stop(); await rm(folder, { recursive: true, force: true }) })
  await mf.ready

  const request = (path: string, body: unknown | null, who?: Pick<Actor, 'cookie'>, expectedActor?: string): Promise<Response> => send(path, {
    method: body ? 'POST' : 'GET',
    headers: { origin, ...(body ? { 'content-type': 'application/json' } : {}), ...(who ? { cookie: who.cookie } : {}), ...(expectedActor !== undefined ? { 'X-Allworld-Actor': expectedActor } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const host: VoiceJourneyHost = {
    async actor(name) {
      const response = await request('/api/session', { name })
      assert.equal(response.status, 200)
      const session = await response.json() as { session: { id: string; name: string } }
      const actor = { ...session.session, cookie: (response.headers.get('set-cookie') ?? '').split(';')[0] ?? '' }
      assert.notEqual(actor.cookie, '', 'session creation sets an authenticated cookie')
      for (const path of ['/api/life?city=lagos', '/api/social/me']) assert.equal((await request(path, null, actor)).status, 200)
      return actor
    },
    async json(path, body, who, expectedActor) {
      const response = await request(path, body, who, expectedActor)
      return { ...await response.json() as Omit<VoiceAnswer, 'status'>, status: response.status }
    },
    async media(path, who, expectedActor) {
      const response = await send(path, { headers: { origin, ...(who ? { cookie: who.cookie } : {}), ...(expectedActor !== undefined ? { 'X-Allworld-Actor': expectedActor } : {}) } })
      return { status: response.status, bytes: new Uint8Array(await response.arrayBuffer()), cache: response.headers.get('cache-control') }
    },
    async hasVoice(id) {
      const store = await mf.unsafeGetDurableObjectStorage('joinallworld-voice-notes', 'JoinAllworldState', { name: 'joinallworld-v1' })
      return (await store.exec('SELECT id FROM chat_voice_notes WHERE id = ?', id)).length > 0
    },
    async voiceCount() {
      const store = await mf.unsafeGetDurableObjectStorage('joinallworld-voice-notes', 'JoinAllworldState', { name: 'joinallworld-v1' })
      return (await store.exec('SELECT id FROM chat_voice_notes')).length
    },
    id: () => `${Date.now()}:${randomUUID()}`,
    async restart() {
      await stop()
      mf = make()
      await within('Miniflare restart', mf.ready)
    },
  }
  return host
}

test('Worker voice-note HTTP journey keeps SQLite blobs private through restart, revocation, reports, and deletion cleanup', { timeout: 120000 }, async t => {
  await runVoiceJourney(await fixture(t))
})
