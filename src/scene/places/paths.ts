// OWNER: scenes (unique places)
// Where a place model lives, for the client, the Worker and the Node host. No imports: a Worker bundle and a browser chunk can both read it.
//
// A model is content-addressed: /assets/places/<sha256>.glb names the SHA-256 of the file's own bytes, so the address can be cached for
// ever and the client can check what it received against the address alone. The Worker serves it from R2 key `places/<sha256>.glb`
// (binding MODELS); the Node host serves it from a folder (PLACES_DIR, default scripts/places/out/store). The shared atlas is a hashed
// static file next to them (public/assets/places/trim-<sha256>.webp, trim-1024-<sha256>.webp), served by the asset binding as any other.

export const PLACE_ASSET_PREFIX = '/assets/places/'
const HASH = '[0-9a-f]{64}'
const MODEL_PATH = new RegExp(`^/assets/places/(${HASH})\\.glb$`)
const ATLAS_PATH = new RegExp(`^/assets/places/trim(?:-1024)?-(${HASH})\\.webp$`)
export const PLACE_MODEL_CACHE_CONTROL = 'public, max-age=31536000, immutable'
export const PLACE_MODEL_CONTENT_TYPE = 'model/gltf-binary'

export const isSha256 = (value: unknown): value is string => typeof value === 'string' && new RegExp(`^${HASH}$`).test(value)
/** The public address of a model. */
export const placeModelPath = (sha256: string): string => `${PLACE_ASSET_PREFIX}${sha256}.glb`
/** The R2 object key (and the file name in the Node host's folder is `<sha256>.glb`). */
export const placeObjectKey = (sha256: string): string => `places/${sha256}.glb`
/** The hash in a model address, or null when the path is not an exact model address. */
export const placeModelHash = (pathname: string): string | null => MODEL_PATH.exec(pathname)?.[1] ?? null
/** True for any path the model route answers for (a .glb under /assets/places/): a malformed one is a 404, never the single-page fallback. */
export const isPlaceModelRoute = (pathname: string): boolean => pathname.startsWith(PLACE_ASSET_PREFIX) && pathname.endsWith('.glb')
export const isPlaceAtlasPath = (pathname: string): boolean => ATLAS_PATH.test(pathname)
