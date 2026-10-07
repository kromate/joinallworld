import { decodeStreetTile, MAX_RAW_TILE_BYTES, tileKey, tileWindow } from './frame.ts'
import type { StreetTile, TileCoord } from './types.ts'

export interface TileWindowOptions { city: string; version: string; load(tile: TileCoord, signal: AbortSignal): Promise<unknown>; concurrency?: 1 | 2; onTile?(tile: StreetTile): void; onEvict?(tile: StreetTile): void }
/** The loader must honour AbortSignal; dropped responses are never admitted, even if it does not. */
export function createTileWindow(options: TileWindowOptions) {
  const ready = new Map<string, StreetTile>(), active = new Map<string, { abort: AbortController; generation: number }>(), desired = new Map<string, TileCoord>(), generations = new Map<string, number>(), failures = new Map<string, string>()
  let closed = false, serial = 0
  function pump(): void {
    if (closed) return
    for (const [key, tile] of desired) {
      if (active.size >= (options.concurrency === 1 ? 1 : 2)) break
      if (ready.has(key) || active.has(key) || failures.has(key)) continue
      const abort = new AbortController(), generation = generations.get(key) ?? ++serial
      generations.set(key, generation); active.set(key, { abort, generation })
      void Promise.resolve().then(() => { if (abort.signal.aborted) throw Error('Street tile request retired'); return options.load(tile, abort.signal) }).then(value => {
        if (closed || abort.signal.aborted || !desired.has(key) || generations.get(key) !== generation) return
        const decoded = decodeStreetTile(value, { city: options.city, version: options.version, tile }); ready.set(key, decoded); options.onTile?.(decoded)
      }).catch(error => { if (!closed && !abort.signal.aborted && desired.has(key) && generations.get(key) === generation) failures.set(key, String(error)) }).finally(() => { if (active.get(key)?.generation === generation) active.delete(key); if (!desired.has(key)) generations.delete(key); pump() })
    }
  }
  return {
    setCentre(centre: TileCoord): void {
      if (closed) throw Error('Street tile window is disposed')
      if (!Number.isSafeInteger(centre.x) || !Number.isSafeInteger(centre.z) || Math.abs(centre.x) >= 1000000 || Math.abs(centre.z) >= 1000000) throw Error('Invalid street tile centre')
      const wanted = tileWindow(centre), keys = new Set(wanted.map(tileKey))
      for (const [key, tile] of ready) if (!keys.has(key)) { ready.delete(key); options.onEvict?.(tile) }
      for (const [key, request] of active) if (!keys.has(key)) { request.abort.abort(); generations.set(key, ++serial) }
      for (const key of failures.keys()) if (!keys.has(key)) failures.delete(key)
      for (const key of generations.keys()) if (!keys.has(key) && !active.has(key)) generations.delete(key)
      desired.clear(); for (const tile of wanted) desired.set(tileKey(tile), tile); pump()
    },
    retry(tile: TileCoord): void { failures.delete(tileKey(tile)); pump() },
    snapshot() { return { resident: ready.size, pending: active.size, queued: [...desired.keys()].filter(key => !ready.has(key) && !active.has(key) && !failures.has(key)).length, tiles: [...ready.values()], errors: [...failures.entries()] } },
    dispose(): void { closed = true; for (const request of active.values()) request.abort.abort(); for (const tile of ready.values()) options.onEvict?.(tile); ready.clear(); desired.clear(); generations.clear(); failures.clear() },
  }
}

/** JSON text is deliberate: release policy permits .txt, and this never evaluates tile contents. */
export async function loadPublicStreetTile(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal })
  if (!response.ok || response.headers.get('content-type')?.includes('text/html')) throw Error('Street tile unavailable')
  const reader = response.body?.getReader(); if (!reader) throw Error('Street tile has no body')
  const parts: Uint8Array[] = []; let length = 0
  try { while (true) { const next = await reader.read(); if (next.done) break; length += next.value.byteLength; if (length > MAX_RAW_TILE_BYTES) throw Error('Street tile body exceeds byte budget'); parts.push(next.value) } }
  catch (error) { await reader.cancel(); throw error }
  const bytes = new Uint8Array(length); let at = 0; for (const part of parts) { bytes.set(part, at); at += part.length }
  const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes)); return parsed
}
