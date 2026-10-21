/**
 * OWNER: scenes (unique places)
 * The shared place models on the Worker host: GET /assets/places/<sha256>.glb, read from the R2 bucket `allworld` (binding MODELS) at
 * key `places/<sha256>.glb`. The address names the SHA-256 of the file, so the answer never changes: it is cached for a year as
 * immutable, kept in the edge cache (caches.default) so most reads never reach R2, and answered 304 to a validator that matches.
 * A malformed address, an absent binding and an absent object are a 404 that nothing keeps (no-store). The atlas
 * (/assets/places/trim-<sha256>.webp) is a static asset and does not come through here.
 *
 * The handler takes the bucket, the cache and a waiter as plain parameters, so the unit test needs no Workers runtime.
 */
import { PLACE_MODEL_CACHE_CONTROL, PLACE_MODEL_CONTENT_TYPE, isPlaceModelRoute, placeModelHash, placeObjectKey } from '../src/scene/places/paths.ts'
import type { R2Models } from './r2-models.ts'

export type PlaceBucket = Pick<R2Models, 'get'>
/** The part of the Workers Cache this uses. */
export interface PlaceCache { match(request: Request): Promise<Response | undefined>; put(request: Request, response: Response): Promise<void> }

const notFound = (head: boolean): Response => new Response(head ? null : 'Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } })

/** True when this request is one the place route answers for (any .glb under /assets/places/). */
export const isPlaceRequest = (url: URL): boolean => isPlaceModelRoute(url.pathname)

function modelHeaders(hash: string, size?: number): Headers {
  const headers = new Headers({
    'content-type': PLACE_MODEL_CONTENT_TYPE, 'cache-control': PLACE_MODEL_CACHE_CONTROL, etag: `"${hash}"`,
    'x-content-type-options': 'nosniff', 'cross-origin-resource-policy': 'same-origin',
  })
  if (size !== undefined) headers.set('content-length', String(size))
  return headers
}
/** An If-None-Match that names this model (or `*`). */
const validates = (header: string | null, hash: string): boolean => header !== null && header.split(',').some(tag => { const t = tag.trim().replace(/^W\//, ''); return t === '*' || t === `"${hash}"` })

export async function servePlaceModel(request: Request, bucket: PlaceBucket | undefined, cache: PlaceCache | null, wait: (work: Promise<unknown>) => void = () => {}): Promise<Response> {
  const head = request.method === 'HEAD', url = new URL(request.url), hash = placeModelHash(url.pathname)
  if (!hash) return notFound(head)
  if (validates(request.headers.get('if-none-match'), hash)) return new Response(null, { status: 304, headers: modelHeaders(hash) })
  // One cache entry per hash, whatever the query string or the host header says.
  const key = new Request(`${url.origin}/assets/places/${hash}.glb`, { method: 'GET' })
  const cached = cache ? await cache.match(key).catch(() => undefined) : undefined
  if (cached) return new Response(head ? null : cached.body, { status: 200, headers: modelHeaders(hash, Number(cached.headers.get('content-length')) || undefined) })
  if (!bucket) return notFound(head)
  const found = await bucket.get(placeObjectKey(hash))
  if (!found) return notFound(head)
  const body = found.body ?? new Uint8Array(await found.arrayBuffer())
  const response = new Response(head ? null : body, { status: 200, headers: modelHeaders(hash, found.size) })
  if (cache && !head) wait(cache.put(key, response.clone()).catch(() => {}))
  return response
}
