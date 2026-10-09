/** Server-only immutable asset verification for the game-authored Marina depot overlay. */
import { createStreetAssets } from '../street/assets.ts'
import type { StreetAssetReader } from '../street/types.ts'
import { inspectPinnedMarinaDepotTile, MARINA_DEPOT_SOURCE_PINS } from '../../src/game/living-world/depot-site.ts'
import type { DepotSiteDescriptor } from '../../src/game/living-world/depot-site.ts'
import { tileKey } from '../../src/street/frame.ts'

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isPinnedManifest(value: unknown): boolean {
  return object(value) && value.v === 1 && value.city === MARINA_DEPOT_SOURCE_PINS.city && value.version === MARINA_DEPOT_SOURCE_PINS.version
}

async function shaCanonical(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

/** Resolve after the retained source manifest, pack and logical tile verify. */
export async function resolveMarinaDepotSite(reader?: StreetAssetReader): Promise<DepotSiteDescriptor | null> {
  if (!reader) return null
  try {
    let retainedRaw: unknown
    const pins = MARINA_DEPOT_SOURCE_PINS
    const captured: StreetAssetReader = {
      async readManifest(city, version) {
        const raw = await reader.readManifest(city, version)
        if (city === pins.city && (version === pins.version || version === undefined && isPinnedManifest(raw))) retainedRaw = raw
        return raw
      },
      readTile: (city, version, file) => reader.readTile(city, version, file),
    }
    const assets = createStreetAssets(captured)
    if ((await assets.manifest(pins.city)).version !== pins.version) return null
    const manifest = await assets.manifest(pins.city, pins.version)
    if (manifest.version !== pins.version || await shaCanonical(retainedRaw) !== pins.manifestCanonicalSha256) return null
    const entry = manifest.tiles.get(tileKey(pins.tile))
    if (!entry || entry.sha256 !== pins.tileSha256 || entry.packKey !== tileKey(pins.tile) || entry.packSha256 !== pins.packSha256) return null
    const { decoded } = await assets.tile(pins.city, pins.version, pins.tile)
    const candidate = inspectPinnedMarinaDepotTile(decoded)
    if (!candidate) return null
    return Object.freeze({ ...candidate, checks: Object.freeze({ ...candidate.checks, pinnedAsset: 'verified' }) })
  } catch { return null }
}
