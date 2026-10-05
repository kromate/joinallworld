import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { boatJourney } from './testing/boatJourney.ts'
import { createServer } from './server.ts'
import type { AllworldServer } from './server.ts'
import { loadCityContent } from '../src/game/cities/registry.ts'
import { contentFor } from '../src/game/cities/runtime.ts'
import { object } from './testing/cityJourney.ts'

const CITY = 'port-harcourt'

test('Rivers boat action receipts charge once through HTTP, persist on restart and complete both directions', { timeout: 30000 }, async t => {
  await loadCityContent(CITY)
  const route = contentFor(CITY).localRoutes?.[0]
  assert.ok(route)
  const folder = await mkdtemp(join(tmpdir(), 'rivers-boat-'))
  let now = Date.UTC(2026, 0, 5, 9), base = '', cookie = ''
  async function start(): Promise<AllworldServer> {
    const server = await createServer({ dataDir: folder, now: () => now })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    base = `http://127.0.0.1:${address.port}`
    return server
  }
  let server = await start()
  async function stop(): Promise<void> {
    for (const socket of server.wss.clients) socket.terminate()
    server.closeAllConnections()
    if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    await server.store.close?.()
  }
  t.after(async () => { await stop(); await rm(folder, { recursive: true, force: true }) })
  async function request(path: string, body?: object): Promise<Record<string, unknown>> {
    const response = await fetch(base + path, {
      method: body ? 'POST' : 'GET', headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    const answer = object(await response.json())
    assert.equal(response.status, 200, JSON.stringify(answer))
    cookie ||= response.headers.get('set-cookie')?.split(';')[0] ?? ''
    return answer
  }
  await boatJourney({
    now: () => now,
    request,
    elapse: async ms => { now += ms },
    restart: async () => { await stop(); server = await start() },
    seed: async (location, cash) => {
      await server.store.transact(db => {
        const state = db.sessions[cookie.slice(4)]?.cities[CITY]?.state
        assert.ok(state)
        state.location = location
        state.activeAction = null
        state.cash = cash
      })
    },
  }, route)
})
