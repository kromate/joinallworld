import type { TileCoord } from './types.ts'

export interface TileOverlayView<Parent = unknown> {
  attach(parent: Parent): void
  rebase(originTile: TileCoord): void
  dispose(): void
}

export interface TileOverlayAsset<Parent = unknown> { readonly view: TileOverlayView<Parent> }

export interface TileOverlayWindowOptions<Parent, Asset extends TileOverlayAsset<Parent>> {
  parent: Parent
  create(tile: Readonly<TileCoord>): Promise<Asset>
  onError?(tile: Readonly<TileCoord>, error: unknown): void
}

export interface TileOverlayWindow {
  /** Offer a tile selected by the host. Returns false when closed, invalid, full, or already resident. */
  onTile(tile: TileCoord): boolean
  /** Evict a resident tile synchronously, including an in-flight import/build. */
  onEvict(tile: TileCoord): boolean
  /** Move accepted views to a new local map origin without rebuilding their assets. */
  rebase(originTile: TileCoord): void
  /** Close once; pending creations that finish later are disposed without attachment. */
  dispose(): void
  diagnostics(): { resident: number; pending: number; failed: number; closed: boolean }
}

const MAX_RESIDENT = 9
const validTile = (value: unknown): value is TileCoord => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype &&
  Object.keys(value).length === 2 && Object.hasOwn(value, 'x') && Object.hasOwn(value, 'z') &&
  Number.isSafeInteger(Reflect.get(value, 'x')) && Number.isSafeInteger(Reflect.get(value, 'z')) &&
  Math.abs(Reflect.get(value, 'x') as number) <= 1_000_000 && Math.abs(Reflect.get(value, 'z') as number) <= 1_000_000
const keyOf = (tile: TileCoord): string => `${tile.x}_${tile.z}`
const copyTile = (tile: TileCoord): TileCoord => ({ x: tile.x, z: tile.z })

type Entry<Parent, Asset extends TileOverlayAsset<Parent>> = {
  readonly tile: Readonly<TileCoord>
  status: 'pending' | 'ready' | 'failed'
  asset?: Asset
}

function disposeAsset<Parent, Asset extends TileOverlayAsset<Parent>>(asset: Asset): void {
  asset.view.dispose()
}

/**
 * Owns only overlay residency and lifecycle. The host chooses tiles and supplies the opaque parent;
 * imports, scene resources, map geometry and authority stay outside this module.
 */
export function createTileOverlayWindow<Parent, Asset extends TileOverlayAsset<Parent>>(options: TileOverlayWindowOptions<Parent, Asset>): TileOverlayWindow {
  const residents = new Map<string, Entry<Parent, Asset>>()
  let origin: TileCoord = { x: 0, z: 0 }
  let closed = false

  function report(tile: Readonly<TileCoord>, error: unknown): void {
    try { options.onError?.(tile, error) } catch { /* Observability cannot break resource cleanup. */ }
  }

  function fail(entry: Entry<Parent, Asset>, key: string, error: unknown): void {
    if (residents.get(key) !== entry) return
    entry.status = 'failed'
    if (entry.asset) {
      try { disposeAsset(entry.asset) } catch { /* Continue to report and retain a failed, non-retrying slot. */ }
      delete entry.asset
    }
    report(entry.tile, error)
  }

  function begin(entry: Entry<Parent, Asset>, key: string): void {
    // Deferring factory invocation also catches synchronous throws at this async resource boundary.
    void Promise.resolve().then(async () => {
      if (closed || residents.get(key) !== entry) return
      let asset: Asset
      try { asset = await options.create(entry.tile) } catch (error) { fail(entry, key, error); return }
      if (closed || residents.get(key) !== entry) {
        try { disposeAsset(asset) } catch (error) { report(entry.tile, error) }
        return
      }
      entry.asset = asset
      try {
        asset.view.rebase(copyTile(origin))
        asset.view.attach(options.parent)
        entry.status = 'ready'
      } catch (error) { fail(entry, key, error) }
    }).catch((error: unknown) => fail(entry, key, error))
  }

  return {
    onTile(tile) {
      if (closed || !validTile(tile)) return false
      const key = keyOf(tile)
      if (residents.has(key) || residents.size >= MAX_RESIDENT) return false
      const entry: Entry<Parent, Asset> = { tile: Object.freeze(copyTile(tile)), status: 'pending' }
      residents.set(key, entry)
      begin(entry, key)
      return true
    },
    onEvict(tile) {
      if (closed || !validTile(tile)) return false
      const key = keyOf(tile), entry = residents.get(key)
      if (!entry) return false
      // Removing the exact entry before disposal fences any creation still in flight for this key.
      residents.delete(key)
      if (entry.asset) {
        try { disposeAsset(entry.asset) } catch (error) { report(entry.tile, error) }
        delete entry.asset
      }
      return true
    },
    rebase(next) {
      if (closed) return
      if (!validTile(next)) throw Error('Invalid overlay window origin')
      origin = copyTile(next)
      for (const [key, entry] of residents) if (entry.status === 'ready' && entry.asset) {
        try { entry.asset.view.rebase(copyTile(origin)) } catch (error) { fail(entry, key, error) }
      }
    },
    dispose() {
      if (closed) return
      closed = true
      for (const entry of residents.values()) if (entry.asset) {
        try { disposeAsset(entry.asset) } catch (error) { report(entry.tile, error) }
      }
      residents.clear()
    },
    diagnostics() {
      let pending = 0, failed = 0
      for (const entry of residents.values()) { if (entry.status === 'pending') pending++; else if (entry.status === 'failed') failed++ }
      return { resident: residents.size, pending, failed, closed }
    },
  }
}
