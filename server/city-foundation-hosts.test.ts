import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { WebSocket } from 'ws'
import { createServer } from './server.ts'
import type { AllworldServer } from './server.ts'
import { cityJourney, legacyJourney, JOURNEY_TIME, qualifyState, seedLegacyRecords } from './testing/cityJourney.ts'
import { registerCityForTest, loadCityContent } from '../src/game/cities/registry.ts'
import { fictionalCity, fictionalNeighbourCity } from '../src/game/cities/testing/fictionalCity.test-fixture.ts'

test('Node city modules: complete city journey and lossless legacy switches survive restart', { timeout: 30000 }, async t => {
  const installed = [fictionalCity, fictionalNeighbourCity].map(module => registerCityForTest(module))
  await Promise.all([fictionalCity, fictionalNeighbourCity].map(city => loadCityContent(city.id)))
  const folder = await mkdtemp(join(tmpdir(), 'city-foundation-node-'))
  let time = JOURNEY_TIME, base = ''
  const sockets: WebSocket[] = []
  async function start(): Promise<AllworldServer> {
    const next = await createServer({ dataDir: folder, now: () => time })
    next.listen(0, '127.0.0.1')
    await once(next, 'listening')
    const address = next.address()
    assert.ok(address && typeof address !== 'string')
    base = `http://127.0.0.1:${address.port}`
    return next
  }
  let server = await start()
  async function stop(): Promise<void> {
    for (const socket of sockets.splice(0)) socket.terminate()
    for (const socket of server.wss.clients) socket.terminate()
    server.closeAllConnections()
    if (server.listening) await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()) })
    await server.store.close?.()
  }
  t.after(async () => {
    await stop()
    for (const city of installed) city.dispose()
    await rm(folder, { recursive: true, force: true })
  })
  const host = {
    now: () => time,
    request: (path: string, body?: object, cookie?: string) => fetch(base + path, {
      method: body ? 'POST' : 'GET', headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
    elapse: async (_device: { cookie: string }, _city: string, ms: number) => { time += ms },
    qualify: async (device: { cookie: string }, city: string) => {
      await server.store.transact(db => { const state = db.sessions[device.cookie.slice(4)]?.cities[city]?.state; assert.ok(state); qualifyState(state) })
    },
    seedLegacy: async (device: { cookie: string }) => {
      await server.store.transact(db => { const session = db.sessions[device.cookie.slice(4)]; assert.ok(session); seedLegacyRecords(session, time) })
    },
    session: (device: { cookie: string }) => server.store.read(db => { const session = db.sessions[device.cookie.slice(4)]; assert.ok(session); return session }),
    restart: async () => { await stop(); server = await start() },
    socket: async (device: { cookie: string }) => {
      const socket = new WebSocket(base.replace('http', 'ws') + '/socket', { headers: { cookie: device.cookie, origin: base } })
      sockets.push(socket)
      const queue: unknown[] = [], waiting: ((frame: unknown) => void)[] = []
      socket.on('message', data => { const frame: unknown = JSON.parse(data.toString()); const resolve = waiting.shift(); if (resolve) resolve(frame); else queue.push(frame) })
      await once(socket, 'open')
      return {
        send: (value: object) => socket.send(JSON.stringify(value)),
        next: (): Promise<unknown> => queue.length ? Promise.resolve(queue.shift()) : new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Socket frame timed out')), 3000)
          waiting.push(frame => { clearTimeout(timer); resolve(frame) })
        }),
      }
    },
  }
  const device = await cityJourney(host)
  await legacyJourney(host, device)
})
