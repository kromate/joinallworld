import type { StreetJourney } from './types.ts'
import type { MetrePoint, TileCoord } from './types.ts'
import { MAX_RAW_TILE_BYTES } from './frame.ts'

export type StreetRequest = (path: string, body?: object, signal?: AbortSignal) => Promise<unknown>
export class StreetError extends Error { readonly code: string; constructor(code: string, message: string) { super(message); this.code = code; this.name = 'StreetError' } }
const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const token = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9:_-]{1,200}$/.test(v)
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 128000000
export function parseStreetJourney(v: unknown): StreetJourney {
  if (!object(v) || !token(v.id) || !token(v.city) || !token(v.version) || !object(v.anchor) || !token(v.anchor.lga) || !Number.isSafeInteger(v.anchor.estate) || !Number.isSafeInteger(v.anchor.plot) || typeof v.anchor.estate !== 'number' || typeof v.anchor.plot !== 'number' || !object(v.point) || !finite(v.point.x) || !finite(v.point.z) || typeof v.seq !== 'number' || !Number.isSafeInteger(v.seq) || v.seq < 0 || (typeof v.acceptedAt !== 'number' || !Number.isFinite(v.acceptedAt)) || typeof v.credit !== 'number' || !Number.isFinite(v.credit) || v.credit < 0 || v.credit > 8.4) throw new StreetError('invalid_street_response', 'The street response could not be read.')
  const base = { id: v.id, city: v.city, version: v.version, anchor: { lga: v.anchor.lga, estate: v.anchor.estate, plot: v.anchor.plot }, point: { x: v.point.x, z: v.point.z }, seq: v.seq, acceptedAt: v.acceptedAt, credit: v.credit }
  if (v.kind === 'walking') return { ...base, kind: 'walking' }
  if (v.kind === 'venue' && token(v.venue) && token(v.door)) return { ...base, kind: 'venue', venue: v.venue, door: v.door }
  if (v.kind === 'estate' && object(v.estatePosition) && finite(v.estatePosition.x) && finite(v.estatePosition.z)) return { ...base, kind: 'estate', estatePosition: { x: v.estatePosition.x, z: v.estatePosition.z } }
  throw new StreetError('invalid_street_response', 'The street journey could not be read.')
}
export const requestStreet: StreetRequest = async (path, body, signal) => {
  const response = await fetch(path, { method: body ? 'POST' : 'GET', credentials: 'same-origin', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000), ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) })
  const reader = response.body?.getReader(); if (!reader) throw new StreetError('street_unavailable', 'The street could not be loaded. You can still travel using the map.')
  const parts: Uint8Array[] = []; let size = 0
  try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > MAX_RAW_TILE_BYTES) throw Error('Street response exceeds its byte limit'); parts.push(part.value) } } catch (error) { await reader.cancel(); throw error }
  const bytes = new Uint8Array(size); let at = 0; for (const part of parts) { bytes.set(part, at); at += part.length }
  const value: unknown = JSON.parse(new TextDecoder().decode(bytes))
  if (!response.ok || (object(value) && value.ok === false)) throw new StreetError(object(value) && typeof value.code === 'string' ? value.code : 'street_unavailable', object(value) && typeof value.reason === 'string' ? value.reason : 'The street could not be loaded. You can still travel using the map.')
  return value
}
export function createStreetClient({ request = requestStreet, journey, now = Date.now, onJourneyChanged }: { request?: StreetRequest; journey?: StreetJourney; now?: () => number; onJourneyChanged?(journey: StreetJourney): void } = {}) {
  let current = journey ? parseStreetJourney(journey) : null, closed = false
  let chain: Promise<unknown> = Promise.resolve()
  const abort = new AbortController(), receipts = new Map<string, string>()
  async function operation(path: string, key: string, body: object = {}): Promise<StreetJourney> {
    let clientId = receipts.get(key)
    if (!clientId) { clientId = `${Math.floor(now())}:${crypto.randomUUID()}`; receipts.set(key, clientId) }
    let value: unknown
    try { value = await request(path, { ...body, clientId }, abort.signal) }
    catch (error) { if (error instanceof StreetError) receipts.delete(key); throw error }
    // A definite response completes this attempt. A transport failure above retains its receipt
    // so the next caller resolves the same command instead of submitting another one.
    receipts.delete(key); return accept(value)
  }
  function accept(value: unknown): StreetJourney { if (closed) throw new StreetError('street_disposed', 'Street closed'); if (!object(value) || value.ok !== true) throw new StreetError(object(value) && typeof value.code === 'string' ? value.code : 'street_unavailable', object(value) && typeof value.reason === 'string' ? value.reason : 'The street request failed.'); current = parseStreetJourney(value.journey); onJourneyChanged?.(current); return current }
  function serial(task: () => Promise<StreetJourney>): Promise<StreetJourney> { const next = chain.then(() => { if (closed) throw new StreetError('street_disposed', 'Street closed'); return task() }); chain = next.catch(() => undefined); return next }
  return {
    get journey() { return current },
    refresh: () => serial(async () => accept(await request('/api/street/me', undefined, abort.signal))),
    begin: () => serial(() => operation('/api/street/begin', 'begin')),
    exit: () => serial(() => operation('/api/street/exit', 'exit')),
    move: (point: MetrePoint) => serial(async () => { if (!current || current.kind !== 'walking') throw new StreetError('street_journey_missing', 'Reconnect the street.'); return accept(await request('/api/street/move', { journeyId: current.id, seq: current.seq + 1, x: Math.round(point.x * 100) / 100, z: Math.round(point.z * 100) / 100 }, abort.signal)) }),
    enter: (doorId: string) => serial(async () => { if (!current) throw new StreetError('street_journey_missing', 'Reconnect the street.'); return operation('/api/street/enter', `enter:${current.id}:${doorId}`, { journeyId: current.id, doorId }) }),
    tile: (tile: TileCoord, signal: AbortSignal) => request(`/api/street/tile?x=${tile.x}&z=${tile.z}`, undefined, signal),
    dispose() { closed = true; abort.abort() },
  }
}
