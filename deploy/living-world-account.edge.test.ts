// Worker account lifecycle + privacy continuity over SQLite and keyed storage layouts.
// Fake provider credentials and all controls are synthetic fixtures; this is not gameplay or payout evidence.
import test from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { claimsFor, makeKey, signToken } from '../server/accounts/test-tokens.ts'
import { TOKEN_KEYS_URL } from '../server/accounts/token.ts'
import { readStoredCollection } from '../server/testing/sqliteStorage.ts'

interface MiniflareResponse extends Response { webSocket?: unknown }
interface MiniflareInstance {
  ready: Promise<URL>
  dispose(): Promise<void>
  dispatchFetch(url: string, init?: RequestInit & { headers?: Record<string, string> }): Promise<MiniflareResponse>
  unsafeGetDurableObjectStorage(script: string, className: string, id: { name: string }): Promise<{ exec(query: string, ...bindings: (string | number | null)[]): Promise<Record<string, unknown>[]> }>
}
interface MiniflareTooling {
  Miniflare: new (options: Record<string, unknown>) => MiniflareInstance
  convertV4MiniflareOptions(options: Record<string, unknown>): Record<string, unknown>
}
const require = createRequire(resolve(process.env['JOINALLWORLD_TOOLS'] || 'deploy/tooling', 'package.json'))
const { Miniflare, convertV4MiniflareOptions } = require('miniflare') as MiniflareTooling
const { build } = require('esbuild') as { build(options: Record<string, unknown>): Promise<unknown> }

const PROJECT = 'allworld-edge-account-fixture'
const ORIGIN = 'https://joinallworld.test'
const MODERATOR = 'living-world-account-edge-fixture-token'
const ACCOUNT_BINDINGS = {
  BUILD_ID: 'living-world-account-edge-fixture', MODERATOR_TOKEN: MODERATOR, FOUNDER_EMAIL_SHA256: '',
  ACCOUNTS_FIREBASE_PROJECT_ID: PROJECT,
  ACCOUNTS_FIREBASE_API_KEY: 'edge-web-api-key-0000000000000000000000',
  ACCOUNTS_GOOGLE_CLIENT_ID: '1234567890-edgeclient.apps.googleusercontent.com',
}
const LOOK = { body: 'man', hair: 'low-cut', outfit: 'casual', fabric: 'plain', skin: 'skin-4', hairColor: 'black', outfitColor: 'blue', bottomsColor: 'navy' }
const BARBER = '/api/living-world/barber'
type Guest = { id: string; name: string; cookie: string }
type Json = Record<string, unknown>
type BarberResponse = { ok: boolean; code: string; error?: string; session?: { sessionId: string; revision: number; nextSequence: number; status: string }; [key: string]: unknown }

async function host(t: TestContext) {
  const folder = await mkdtemp(join(tmpdir(), 'joinallworld-account-edge-'))
  const outbound: string[] = []
  let mf: MiniflareInstance | null = null
  const handed: MiniflareResponse[] = []
  let client = 0, minted = 0
  const bounded = async <T>(name: string, work: Promise<T>, ms = 20_000): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${name} exceeded ${ms} ms`)), ms) })])
    } finally { if (timer) clearTimeout(timer) }
  }
  const cancelHandedBodies = async (): Promise<void> => {
    for (const response of handed.splice(0)) {
      if (!response.bodyUsed && response.body && !response.body.locked) await response.body.cancel().catch(() => {})
    }
  }
  t.after(async () => {
    try {
      await cancelHandedBodies()
      if (mf) await bounded('Miniflare final dispose', mf.dispose())
    } finally { await rm(folder, { recursive: true, force: true }) }
  })
  const bundle = join(folder, 'worker.mjs')
  await build({ entryPoints: [new URL('./cloudflare-worker.ts', import.meta.url).pathname], outfile: bundle, bundle: true, format: 'esm', platform: 'neutral', external: ['cloudflare:workers'] })
  const script = await readFile(bundle, 'utf8')
  const key = await makeKey('living-world-edge-key')
  const dispatch = async (path: string, init?: RequestInit & { headers?: Record<string, string> }): Promise<MiniflareResponse> => {
    const response = await bounded(`Worker ${path}`, (mf as MiniflareInstance).dispatchFetch(ORIGIN + path, init))
    handed.push(response)
    return response
  }
  const start = async (bindings: Record<string, string> = {}): Promise<void> => {
    if (mf) {
      await cancelHandedBodies()
      await bounded('Miniflare restart dispose', mf.dispose())
    }
    const fakeOutbound = async (request: Request): Promise<Response> => {
      outbound.push(new URL(request.url).origin + new URL(request.url).pathname)
      if (new URL(request.url).href.split('?')[0] === TOKEN_KEYS_URL) {
        return new Response(JSON.stringify({ keys: [key.jwk] }), { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600' } })
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    }
    const options = {
      name: 'joinallworld-account-edge', script, modules: true, compatibilityDate: '2026-10-01',
      durableObjects: { JOINALLWORLD: { className: 'JoinAllworldState', useSQLite: true } },
      durableObjectsPersist: join(folder, 'storage'), resourcePersistencePath: join(folder, 'storage'),
      unsafeInspectDurableObjects: true,
      bindings: { ...ACCOUNT_BINDINGS, ...bindings },
      outboundService: fakeOutbound,
      serviceBindings: { ASSETS: () => new Response('asset') },
      handleStructuredLogs: () => {},
    }
    mf = new Miniflare({ ...convertV4MiniflareOptions(options), resourcePersistencePath: join(folder, 'storage'), unsafeInspectDurableObjects: true, handleStructuredLogs: () => {} })
    await bounded('Miniflare ready', mf.ready)
  }
  const ip = () => `198.51.100.${(client++ % 240) + 1}`
  const send = (path: string, body?: object, cookie?: string | null, extra: Record<string, string> = {}) => dispatch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { origin: ORIGIN, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}), 'cf-connecting-ip': ip(), ...extra },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const json = async <T = Json>(response: Response): Promise<T> => response.json() as Promise<T>
  const guest = async (name: string): Promise<Guest> => {
    const response = await send('/api/session', { name, onboarding: true })
    assert.equal(response.status, 200)
    const body = await json<{ session: { id: string; name: string } }>(response)
    const cookie = (response.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
    assert.ok(cookie.startsWith('__Host-sid=') && body.session.id)
    const life = await send('/api/life?city=lagos', undefined, cookie); assert.equal(life.status, 200); await life.arrayBuffer()
    const quick = await send('/api/action', { actionId: `${Date.now()}:${randomUUID()}`, cityId: 'lagos', type: 'onboarding.quick-start', payload: { look: LOOK } }, cookie)
    assert.equal((await json<{ code: string }>(quick)).code, 'playing')
    return { id: body.session.id, name, cookie }
  }
  const state = async (cookie: string): Promise<Json> => {
    const response = await send('/api/account', undefined, cookie)
    assert.equal(response.status, 200)
    return json(response)
  }
  const token = (subject: string): Promise<string> => signToken(key, claimsFor(PROJECT, Date.now(), {
    subject, email: `${subject.toLowerCase()}@example.com`, n: ++minted,
  }))
  const change = async (path: string, body: Json, cookie: string, subject?: string): Promise<MiniflareResponse> => {
    const csrf = (await state(cookie)).csrf
    return send(path, { ...body, csrf, ...(subject ? { idToken: await token(subject) } : {}) }, cookie)
  }
  const storage = async () => (mf as MiniflareInstance).unsafeGetDurableObjectStorage('joinallworld-account-edge', 'JoinAllworldState', { name: 'joinallworld-v1' })
  const storedWorld = async (): Promise<Record<string, unknown>> => {
    const db = await storage()
    const text = await readStoredCollection((query, ...args) => db.exec(query, ...args), 'livingWorld')
    return text ? JSON.parse(text) as Record<string, unknown> : {}
  }
  const barberRow = async (publicId: string): Promise<Record<string, unknown> | null> => {
    const barber = (await storedWorld())['barber']
    if (!barber || typeof barber !== 'object' || Array.isArray(barber)) return null
    const row = (barber as Record<string, unknown>)[publicId]
    return row && typeof row === 'object' && !Array.isArray(row) ? structuredClone(row as Record<string, unknown>) : null
  }
  const operator = async (path: string, body?: object): Promise<{ status: number; json: Json }> => {
    const response = await send(path, body, undefined, { authorization: `Bearer ${MODERATOR}` })
    return { status: response.status, json: await json(response) }
  }
  async function practice(who: Guest): Promise<Record<string, unknown>> {
    const startResponse = await send(BARBER + '/start', { cityId: 'lagos', lessonId: 'basic', requestId: `${Date.now()}:${randomUUID()}` }, who.cookie)
    const started = await json<BarberResponse>(startResponse)
    assert.equal(startResponse.status, 200); assert.equal(started.ok, true, started.error); assert.ok(started.session)
    await delay(125)
    const inputResponse = await send(BARBER + '/input', {
      cityId: 'lagos', sessionId: started.session!.sessionId, revision: started.session!.revision,
      sequence: started.session!.nextSequence, frames: [{ tool: 'comb', x: 0.25, y: 0.4, pressed: true }],
    }, who.cookie)
    const input = await json<BarberResponse>(inputResponse)
    assert.equal(input.ok, true, input.error); assert.ok(input.session)
    const pauseResponse = await send(BARBER + '/pause', {
      cityId: 'lagos', sessionId: input.session!.sessionId, revision: input.session!.revision,
      requestId: `${Date.now()}:${randomUUID()}`,
    }, who.cookie)
    const paused = await json<BarberResponse>(pauseResponse)
    assert.equal(paused.ok, true, paused.error); assert.equal(paused.session?.status, 'paused')
    const row = await barberRow(who.id); assert.ok(row)
    return row!
  }
  const prove = (path: string, body: Json, cookie: string, subject: string) => change(path, body, cookie, subject)
  const rows = async (): Promise<Record<string, number>> => {
    const result = await operator('/api/mod/overview')
    assert.equal(result.status, 200)
    return (((result.json['store'] as Json)['rows'] as Json)['tables'] as Record<string, number>)
  }
  return { start, send, json, guest, state, token, change, prove, storage, storedWorld, barberRow, operator, practice, rows, outbound }
}

test('Worker account lifecycle preserves selected barber progress across SQLite layouts and removes parked progress', async t => {
  const h = await host(t)
  await h.start()
  const ada = await h.guest('Ada'), bola = await h.guest('Bola')
  const adaBefore = await h.practice(ada), bolaBefore = await h.practice(bola)

  const adoptedResponse = await h.change('/api/account/sign-in', { idToken: await h.token('UidAda') }, ada.cookie)
  assert.equal(adoptedResponse.status, 200)
  const adopted = await h.json<Json & { outcome: string; character: { id: string }; csrf: string }>(adoptedResponse)
  const adaCookie = (adoptedResponse.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
  assert.equal(adopted.outcome, 'linked'); assert.equal(adopted.character.id, ada.id); assert.ok(adaCookie)
  assert.deepEqual((await h.barberRow(ada.id))?.account, 'fb:UidAda')
  const parkedResponse = await h.change('/api/account/sign-in', { idToken: await h.token('UidAda') }, bola.cookie)
  assert.equal(parkedResponse.status, 200)
  const parked = await h.json<Json & { outcome: string; parked: { id: string } }>(parkedResponse)
  const accountCookie = (parkedResponse.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
  assert.deepEqual([parked.outcome, parked.parked.id], ['parked', bola.id])
  assert.deepEqual((await h.barberRow(bola.id))?.account, 'fb:UidAda')

  const switchResponse = await h.prove('/api/account/character', { use: bola.id }, accountCookie, 'UidAda')
  assert.equal(switchResponse.status, 200)
  const switchBody = await h.json<{ character: { id: string }; parked: Array<{ id: string }> }>(switchResponse)
  assert.deepEqual([switchBody.character.id, switchBody.parked.map(item => item.id)], [bola.id, [ada.id]])
  const switched = await h.send('/api/session', undefined, accountCookie)
  assert.equal((await h.json<{ session: { id: string } }>(switched)).session.id, bola.id)
  const exportResponse = await h.prove('/api/account/export', {}, accountCookie, 'UidAda')
  const exported = await h.json<Json & { character: { id: string }; setAside: Array<{ id: string }>; livingWorld: { version: number; actors: Array<Json> } }>(exportResponse)
  assert.equal(exportResponse.status, 200)
  assert.equal(exported.character.id, bola.id)
  assert.deepEqual(exported.setAside.map(item => item.id), [ada.id])
  assert.equal(exported.livingWorld.version, 1)
  assert.deepEqual(exported.livingWorld.actors.map(actor => actor.publicId).sort(), [ada.id, bola.id].sort())
  assert.ok(!JSON.stringify(exported).includes('UidAda') && !JSON.stringify(exported).includes(accountCookie.slice(11)))
  for (const actor of exported.livingWorld.actors) {
    assert.deepEqual(Object.keys(actor).sort(), ['barber', 'driving', 'publicId', 'qualification', 'starterRental'])
    assert.ok(!JSON.stringify(actor).match(/sessionId|nextSequence|packet|accountId|email|cookie/i))
  }
  const bolaOwned = await h.barberRow(bola.id), adaOwned = await h.barberRow(ada.id)
  assert.deepEqual(bolaOwned, { ...bolaBefore, account: 'fb:UidAda' })
  assert.deepEqual(adaOwned, { ...adaBefore, account: 'fb:UidAda' })

  // The persisted logical collection must remain readable and equal while storage moves legacy → shadow → entries,
  // including a full Worker restart with the same Durable Object SQLite file.
  const beforeRestartResponse = await h.send(BARBER + '?city=lagos', undefined, accountCookie)
  const beforeRestart = await h.json<BarberResponse>(beforeRestartResponse)
  assert.equal(beforeRestart.session?.status, 'paused')
  const logicalBefore = await h.storedWorld()
  await h.start({ STORE_LAYOUT: 'shadow' })
  let status = await h.operator('/api/mod/store')
  assert.equal(status.status, 200)
  const afterShadow = await h.storedWorld()
  assert.deepEqual(afterShadow, logicalBefore)
  const comparison = await h.operator('/api/mod/store/compare')
  assert.equal(comparison.status, 200)
  assert.equal(((comparison.json['collections'] as Json)['livingWorld'] as { equal: boolean }).equal, true)
  assert.equal((await h.operator('/api/mod/store/layout', { layout: 'entries' })).status, 200)
  await h.start()
  status = await h.operator('/api/mod/store')
  assert.equal(status.status, 200); assert.equal(status.json['requested'], 'entries')
  assert.deepEqual(await h.storedWorld(), logicalBefore)
  const afterRestart = await h.send(BARBER + '?city=lagos', undefined, accountCookie)
  assert.deepEqual((await h.json<BarberResponse>(afterRestart)).session, beforeRestart.session)

  // Switch back to Ada, then account deletion keeps only the active character as a guest.
  const back = await h.prove('/api/account/character', { use: ada.id }, accountCookie, 'UidAda')
  assert.equal(back.status, 200); await back.arrayBuffer()
  const deletion = await h.prove('/api/account/delete', { confirm: 'delete', erase: false }, accountCookie, 'UidAda')
  assert.equal(deletion.status, 200)
  const deleted = await h.json<{ kept: boolean }>(deletion)
  assert.equal(deleted.kept, true)
  const guestCookie = (deletion.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
  assert.ok(guestCookie.startsWith('__Host-sid='))
  const adaAfterDelete = await h.barberRow(ada.id), bolaAfterDelete = await h.barberRow(bola.id)
  assert.deepEqual(adaAfterDelete, adaBefore, 'active selected actor keeps exact paused progress and becomes guest-owned')
  assert.equal(bolaAfterDelete, null, 'parked actor progress is erased with the account')
  const current = await h.send(BARBER + '?city=lagos', undefined, guestCookie)
  assert.equal((await h.json<BarberResponse>(current)).session?.status, 'paused')
  assert.ok(h.outbound.length > 0 && h.outbound.every(url => url === TOKEN_KEYS_URL), 'the only outbound identity request was the fake public-key fetch')
  const tableCounts = await h.rows()
  assert.ok(tableCounts['entries'] !== undefined, 'layout migration and lifecycle finish against the actual SQLite-backed Worker')
})

test('Worker account erase deletes account actors only and leaves an unrelated guest practice untouched', async t => {
  const h = await host(t)
  await h.start()
  const player = await h.guest('Account Player'), unrelated = await h.guest('Unrelated Guest')
  const accountProgress = await h.practice(player), unrelatedProgress = await h.practice(unrelated)
  const signInResponse = await h.change('/api/account/sign-in', { idToken: await h.token('UidErase') }, player.cookie)
  assert.equal(signInResponse.status, 200)
  const signIn = await h.json<{ outcome: string }>(signInResponse)
  assert.equal(signIn.outcome, 'linked')
  const accountCookie = (signInResponse.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
  const erased = await h.prove('/api/account/delete', { confirm: 'delete', erase: true }, accountCookie, 'UidErase')
  assert.equal(erased.status, 200)
  const eraseBody = await h.json<{ ok: boolean; kept: boolean; serverTime: number }>(erased)
  assert.deepEqual([eraseBody.ok, eraseBody.kept], [true, false])
  assert.deepEqual(Object.keys(eraseBody).sort(), ['kept', 'ok', 'serverTime'])
  assert.ok(Number.isSafeInteger(eraseBody.serverTime) && eraseBody.serverTime > 0)
  assert.equal((erased.headers.get('set-cookie') ?? '').split(';')[0], '__Host-sid=')
  assert.equal(await h.barberRow(player.id), null)
  assert.deepEqual(await h.barberRow(unrelated.id), unrelatedProgress, 'unrelated guest row remains byte-for-byte equivalent')
  assert.notDeepEqual(unrelatedProgress, accountProgress)
  const layout = await h.storedWorld()
  assert.deepEqual(Object.keys((layout['barber'] ?? {}) as Record<string, unknown>), [unrelated.id])
})
