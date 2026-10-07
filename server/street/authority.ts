import { characterCity } from '../character.ts'
import { samePlot } from '../world/street.ts'
import { hasPlace } from '../../src/game/systems/estate.ts'
import { venueFor } from '../../src/game/cities/runtime.ts'
import { isOpen } from '../../src/game/clock.ts'
import { globalPoint, localPoint, tileGroundAt, tileKey, tileOf, tileWindow } from '../../src/street/frame.ts'
import { createStreetAssets } from './assets.ts'
import { ESTATE_GATE_POINT } from './gate.ts'
import type { Db, RouteRequest, SessionRecord } from '../types.ts'
import type { LifeState } from '../../src/types/life.ts'
import type { MetrePoint } from '../../src/street/types.ts'
import type { StreetContext, StreetJourney } from './types.ts'

const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) < 128000000
const no = (code: string, reason: string) => ({ ok: false as const, code, reason })
function readJourney(value: unknown): StreetJourney | null {
  if (!object(value) || typeof value.id !== 'string' || typeof value.city !== 'string' || typeof value.version !== 'string' || !object(value.anchor) || typeof value.anchor.lga !== 'string' || typeof value.anchor.estate !== 'number' || typeof value.anchor.plot !== 'number' || !object(value.point) || !finite(value.point.x) || !finite(value.point.z) || typeof value.seq !== 'number' || !Number.isSafeInteger(value.seq) || typeof value.acceptedAt !== 'number' || !Number.isFinite(value.acceptedAt)) return null
  const base = { id: value.id, city: value.city, version: value.version, anchor: { lga: value.anchor.lga, estate: value.anchor.estate, plot: value.anchor.plot }, point: { x: value.point.x, z: value.point.z }, seq: value.seq, acceptedAt: value.acceptedAt, credit: typeof value.credit === 'number' && Number.isFinite(value.credit) ? Math.max(0, Math.min(8.4, value.credit)) : 0.75 }
  if (value.kind === 'walking') return { ...base, kind: 'walking' }
  if (value.kind === 'venue' && typeof value.venue === 'string' && typeof value.door === 'string') return { ...base, kind: 'venue', venue: value.venue, door: value.door }
  if (value.kind === 'estate' && object(value.estatePosition) && finite(value.estatePosition.x) && finite(value.estatePosition.z)) return { ...base, kind: 'estate', estatePosition: { x: value.estatePosition.x, z: value.estatePosition.z } }
  return null
}
const services = new WeakMap<StreetContext, ReturnType<typeof build>>()
export function streetOf(ctx: StreetContext) { const known = services.get(ctx); if (known) return known; const service = build(ctx); services.set(ctx, service); return service }
function build(ctx: StreetContext) {
  const assets = ctx.streetAssets ? createStreetAssets(ctx.streetAssets) : null
  const unavailable = () => { throw Object.assign(ctx.fail(503, 'street_unavailable'), { reason: 'City walking is unavailable here. The map and timed trips still work.' }) }
  async function asset<T>(work: Promise<T>): Promise<T> { try { return await work } catch { return unavailable() } }
  let sweep = 0, nextSweep = 0
  function journeys(db: Db): Record<string, unknown> { const name: string = 'street', root = ctx.collection(db, name, { journeys: {} }), saved = root.journeys; if (object(saved)) return saved; const empty: Record<string, unknown> = {}; root.journeys = empty; return empty }
  function tidy(book: Record<string, unknown>): void { const now = ctx.now(); if (now < nextSweep && now >= nextSweep - 60000) return; nextSweep = now + 60000; const keys: string[] = []; for (const key in book) { keys.push(key); if (keys.length >= 4096) break } if (!keys.length) return; for (let i = 0; i < Math.min(32, keys.length); i++) { const key = keys[(sweep + i) % keys.length]; if (!key) continue; const entry = readJourney(book[key]); if (!entry || entry.acceptedAt < ctx.now() - 30 * 86400000 || entry.acceptedAt > ctx.now() + 30000) delete book[key] } sweep = (sweep + 32) % keys.length }
  function roomFor(book: Record<string, unknown>, id: string): boolean { if (book[id] !== undefined) return true; let count = 0; for (const key in book) { if (key && ++count >= 4096) return false } return true }
  function actor(db: Db, request: RouteRequest) { const session = request.requireSession(db, { renew: true }), city = ctx.cityIds.find(id => id === characterCity(session)); if (!city) throw ctx.fail(409, 'city_moved'); const state = ctx.settle(session, city); return { session, state, city, id: session.publicId } }
  function valid(journey: StreetJourney, state: LifeState, city: string): boolean { return journey.city === city && state.estate.city === city && samePlot(state.estate.plot, journey.anchor) && (journey.kind === 'walking' ? state.location === 'city-street' : journey.kind === 'venue' ? state.location === journey.venue : state.location === 'neighbourhood') }
  async function current(request: RouteRequest) { const result = await ctx.store.transact(db => { const who = actor(db, request), book = journeys(db); tidy(book); const journey = readJourney(book[who.id]); if (!journey || !valid(journey, who.state, who.city)) { if (journey) delete book[who.id]; return null } return { ...who, journey } }, { durable: false }); if (!result) throw ctx.fail(409, 'street_journey_missing'); return result }
  async function traversable(city: string, version: string, from: MetrePoint, to: MetrePoint): Promise<boolean> {
    if (!assets) return false
    const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / 0.5))
    if (steps > 24) return false
    for (let i = 0; i <= steps; i++) { const point = { x: from.x + (to.x - from.x) * i / steps, z: from.z + (to.z - from.z) * i / steps }, coordinate = tileOf(point), tile = await assets.tile(city, version, coordinate); if (!tileGroundAt(tile.decoded, localPoint(point, coordinate))) return false }
    return true
  }
  function placed(state: LifeState, city: string, to: string, guard: string) { const known = ctx.cityIds.find(id => id === city); if (!known) throw ctx.fail(400, 'invalid_city'); return ctx.act(state, { type: 'street.place', cityId: known, payload: { from: state.location, to }, stateGuard: guard }) }
  return {
    async me(request: RouteRequest) { const who = await current(request); return { ok: true, code: 'street', journey: who.journey } },
    async begin(request: RouteRequest, body: Record<string, unknown>) {
      if (!assets) return unavailable()
      ctx.onceId(body.clientId)
      const before = await ctx.store.transact(db => actor(db, request), { durable: false })
      if (!hasPlace(before.state) || !before.state.estate.plot) return no('plot_required', 'Settle into your home before using the estate gate.')
      const anchor = { ...before.state.estate.plot }, manifest = await asset(assets.manifest(before.city)), id = `estate:${before.city}:${anchor.lga}:${anchor.estate}`, door = manifest.doors.has(id) ? await asset(assets.door(before.city, manifest.version, id)) : null
      if (!door) throw Object.assign(ctx.fail(503, 'estate_gate_unavailable'), { reason: 'This virtual estate has no supported city walking gate. The map and timed trips still work.' })
      return ctx.store.transact(db => {
        const who = actor(db, request)
        return ctx.once(db, who.session, { id: body.clientId, kind: 'interact', fingerprint: ['street-begin', before.city, anchor.lga, anchor.estate, anchor.plot] }, () => {
          if (who.id !== before.id || who.city !== before.city || !samePlot(who.state.estate.plot, anchor) || who.state.location !== 'neighbourhood' || who.state.activeAction) return no('street_location_changed', 'Your location changed. Return to your estate gate.')
          if (!ctx.checks?.streetGateReached?.(db, who.session)) return no('gate_required', 'Walk to the estate gate before exploring the city.')
          const book = journeys(db); tidy(book); if (!roomFor(book, who.id)) return no('street_capacity', 'City walking is busy. The map and timed trips still work.')
          const result = placed(who.state, who.city, 'city-street', `Street begin ${String(body.clientId)}`); if (!result.ok) return no(result.code, result.reason ?? 'The gate could not be used.')
          const journey: StreetJourney = { kind: 'walking', id: ctx.randomId(), city: who.city, version: manifest.version, anchor, point: { ...door.approach }, seq: 0, acceptedAt: ctx.now(), credit: 0.75 }; book[who.id] = journey
          return { ok: true, code: 'started', journey }
        })
      })
    },
    async tile(request: RouteRequest, x: number, z: number) { if (!assets) return unavailable(); const who = await current(request); if (who.journey.kind !== 'walking' || !tileWindow(tileOf(who.journey.point)).some(tile => tile.x === x && tile.z === z)) throw ctx.fail(403, 'street_tile_out_of_range'); return await asset(assets.projectedTile(who.city, who.journey.version, { x, z }, who.journey.anchor)) },
    async move(request: RouteRequest, body: Record<string, unknown>) {
      if (!finite(body.x) || !finite(body.z) || typeof body.seq !== 'number' || !Number.isSafeInteger(body.seq) || body.seq < 1 || body.seq > 1000000000) throw ctx.fail(400, 'invalid_street_position')
      const seq = body.seq
      const before = await current(request), journey = before.journey, point = { x: Math.round(body.x * 100) / 100, z: Math.round(body.z * 100) / 100 }
      if (!ctx.allow(`street:move:${before.id}`, 240, 60000)) throw ctx.fail(429, 'street_rate_limited')
      if (journey.kind !== 'walking' || body.journeyId !== journey.id || before.state.activeAction) return no('not_walking', 'Your street walk is not active.')
      if (body.seq === journey.seq && point.x === journey.point.x && point.z === journey.point.z) return { ok: true, code: 'moved', journey, duplicate: true }
      if (body.seq !== journey.seq + 1) return no('street_sequence_changed', 'Your position changed. Reconnect the street.')
      const distance = Math.hypot(point.x - journey.point.x, point.z - journey.point.z), permitted = Math.min(8.4, journey.credit + 4.2 * Math.max(0, (ctx.now() - journey.acceptedAt) / 1000))
      if (distance > permitted || !await asset(traversable(journey.city, journey.version, journey.point, point))) return no('street_move_refused', 'That step is too far or crosses an obstacle.')
      return ctx.store.transact(db => { const who = actor(db, request), latest = readJourney(journeys(db)[who.id]); if (!latest || !valid(latest, who.state, who.city) || latest.kind !== 'walking' || latest.id !== journey.id || who.state.activeAction) return no('street_sequence_changed', 'Your position changed. Reconnect the street.'); if (latest.seq === seq && latest.point.x === point.x && latest.point.z === point.z) return { ok: true, code: 'moved', journey: latest, duplicate: true }; if (latest.seq !== journey.seq) return no('street_sequence_changed', 'Your position changed. Reconnect the street.'); const next: StreetJourney = { ...latest, point, seq, acceptedAt: ctx.now(), credit: Math.max(0, permitted - distance) }; journeys(db)[who.id] = next; return { ok: true, code: 'moved', journey: next } }, { durable: false })
    },
    async enter(request: RouteRequest, body: Record<string, unknown>) {
      if (!assets) return unavailable(); ctx.onceId(body.clientId)
      if (typeof body.doorId !== 'string' || body.doorId.length > 160) throw ctx.fail(400, 'invalid_street_door')
      const before = await current(request), index = await asset(assets.manifest(before.city, before.journey.version)), indexed = index.doors.get(body.doorId)
      if (!indexed || !tileWindow(tileOf(before.journey.point)).some(tile => tileKey(tile) === tileKey(indexed.tile))) return no('door_out_of_range', 'Walk closer to this entrance.')
      const door = await asset(assets.door(before.city, before.journey.version, body.doorId))
      return ctx.store.transact(db => { const who = actor(db, request); return ctx.once(db, who.session, { id: body.clientId, kind: 'interact', fingerprint: ['street-enter', body.doorId] }, () => {
        const latest = readJourney(journeys(db)[who.id]); if (!latest || !valid(latest, who.state, who.city) || latest.kind !== 'walking' || latest.id !== body.journeyId || latest.version !== before.journey.version || who.state.activeAction) return no('not_walking', 'Your street walk is not active.')
        if (Math.hypot(latest.point.x - door.approach.x, latest.point.z - door.approach.z) > 1.25) return no('door_out_of_range', 'Walk to the entrance before going inside.')
        let to: string
        if (door.target.kind === 'estate') { if (door.target.lga !== latest.anchor.lga || door.target.estate !== latest.anchor.estate) return no('other_estate', 'This gate leads to another estate. Use your own gate.'); to = 'neighbourhood' }
        else { to = door.target.venue; const venue = venueFor(who.city, to); if (!venue || ['home', 'neighbourhood', 'city-street'].includes(to) || !isOpen(venue.hours, ctx.now())) return no('venue_unavailable', 'This venue is unavailable or closed.') }
        const result = placed(who.state, who.city, to, `Street entrance ${String(body.clientId)}`); if (!result.ok) return no(result.code, result.reason ?? 'This entrance could not be used.')
        const journey: StreetJourney = to === 'neighbourhood' ? { ...latest, kind: 'estate', estatePosition: { ...ESTATE_GATE_POINT }, acceptedAt: ctx.now() } : { ...latest, kind: 'venue', venue: to, door: door.id, acceptedAt: ctx.now() }; journeys(db)[who.id] = journey
        return { ok: true, code: 'entered', location: to, journey }
      }) })
    },
    async exit(request: RouteRequest, body: Record<string, unknown>) { ctx.onceId(body.clientId); return ctx.store.transact(db => { const who = actor(db, request); return ctx.once(db, who.session, { id: body.clientId, kind: 'interact', fingerprint: ['street-exit'] }, () => { const latest = readJourney(journeys(db)[who.id]); if (!latest || !valid(latest, who.state, who.city) || latest.kind !== 'venue' || who.state.activeAction) return no('street_journey_missing', 'This visit did not start from the city street. Use the map to travel.'); const result = placed(who.state, who.city, 'city-street', `Street exit ${String(body.clientId)}`); if (!result.ok) return no(result.code, result.reason ?? 'You could not leave yet.'); const journey: StreetJourney = { kind: 'walking', id: latest.id, city: latest.city, version: latest.version, anchor: latest.anchor, point: latest.point, seq: latest.seq, acceptedAt: ctx.now(), credit: 0.75 }; journeys(db)[who.id] = journey; return { ok: true, code: 'exited', journey } }) }) },
  }
}
