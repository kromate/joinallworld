/** Pure geographic tile selection and an injected, bounded tile loading scheduler. */
import type { Bounds, Position, TileRef, WorldManifest } from '../types.ts';
import { WORLD_LIMITS } from '../types.ts';
import { ByteLru } from './cache.ts';

export interface TileRenderCost { triangles: number; drawCalls: number; residentBytes: number }
export interface TileShadowOverhead { triangles: number; drawCalls: number }
export interface VisibleTileCaps {
  maxTriangles: number;
  maxDrawCalls: number;
  maxResidentBytes: number;
  maxTiles: number;
  /** Fixed per-tile shadow-pass cost; by default it repeats the render-cost triangles and calls. */
  shadowOverhead?: TileShadowOverhead;
  /** Override manifest costs when the renderer has a more accurate tile cost model. */
  renderCost?: (ref: TileRef) => Partial<TileRenderCost>;
}
export type TileDeferralReason = 'triangle-cap' | 'draw-call-cap' | 'resident-byte-cap' | 'tile-cap';
export interface DeferredTile { ref: TileRef; reason: TileDeferralReason; cost: TileRenderCost }
export interface VisibleTileSelection {
  selected: TileRef[];
  deferred: DeferredTile[];
  overbudget: DeferredTile[];
  outsideView: TileRef[];
  cost: TileRenderCost;
}

function validLimit(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label} must be a non-negative safe integer`);
}
function validCoordinate(point: Position, label: string): void {
  const [longitude, latitude] = point;
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180 || !Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw new RangeError(`${label} must be a WGS84 [longitude, latitude] position`);
  }
}
function longitudeParts(bounds: Bounds): [number, number][] {
  const [west, , east] = bounds;
  if (west <= east) return [[west, east]];
  return [[west, 180], [-180, east]];
}
function intersects(a: Bounds, b: Bounds): boolean {
  if (a[3] < b[1] || a[1] > b[3]) return false;
  // At either pole every longitude is the same point, so a tile whose bounds reach a
  // pole is visible there even when its longitude interval does not overlap the view.
  if (a[3] === 90 && b[3] === 90 || a[1] === -90 && b[1] === -90) return true;
  const first = longitudeParts(a), second = longitudeParts(b);
  return first.some(([aw, ae]) => second.some(([bw, be]) => aw <= be && bw <= ae));
}
function normalizedLongitude(longitude: number): number {
  const value = ((longitude + 180) % 360 + 360) % 360 - 180;
  return value === -180 && longitude > 0 ? 180 : value;
}
function boundsCenter(bounds: Bounds): Position {
  const [west, south, east, north] = bounds;
  const span = west <= east ? east - west : 360 - west + east;
  return [normalizedLongitude(west + span / 2), (south + north) / 2];
}
/** Great-circle center distance, with a wrapped longitude delta and a stable pole limit. */
function distanceToCenter(a: Position, b: Position): number {
  const radians = Math.PI / 180, lat1 = a[1] * radians, lat2 = b[1] * radians;
  const dLat = lat2 - lat1;
  const rawLon = (b[0] - a[0]) * radians;
  const dLon = Math.atan2(Math.sin(rawLon), Math.cos(rawLon));
  const sinLat = Math.sin(dLat / 2), sinLon = Math.sin(dLon / 2);
  const h = Math.min(1, Math.max(0, sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon));
  return 2 * Math.asin(Math.sqrt(h));
}
function checkedCost(ref: TileRef, caps: VisibleTileCaps): TileRenderCost {
  const override = caps.renderCost?.(ref) ?? {};
  if (override.triangles !== undefined) validLimit(override.triangles, 'renderer tile triangles');
  if (override.drawCalls !== undefined) validLimit(override.drawCalls, 'renderer tile draw calls');
  if (override.residentBytes !== undefined) validLimit(override.residentBytes, 'renderer tile resident bytes');
  const baseTriangles = override.triangles ?? ref.triangles, baseDrawCalls = override.drawCalls ?? ref.drawCalls;
  const overhead = caps.shadowOverhead ?? { triangles: baseTriangles, drawCalls: baseDrawCalls };
  const triangles = baseTriangles + overhead.triangles;
  const drawCalls = baseDrawCalls + overhead.drawCalls;
  const residentBytes = override.residentBytes ?? ref.bytes;
  for (const [value, label] of [[triangles, 'tile triangles'], [drawCalls, 'tile draw calls'], [residentBytes, 'tile resident bytes']] as const) validLimit(value, label);
  return { triangles, drawCalls, residentBytes };
}
function reasonFor(cost: TileRenderCost, caps: VisibleTileCaps): TileDeferralReason | null {
  if (cost.triangles > caps.maxTriangles) return 'triangle-cap';
  if (cost.drawCalls > caps.maxDrawCalls) return 'draw-call-cap';
  if (cost.residentBytes > caps.maxResidentBytes) return 'resident-byte-cap';
  return null;
}

/**
 * Selects visible refs nearest the focus first. Longitude intervals are split at the dateline;
 * pole-crossing views work when represented by the caller's conservative geographic bounds.
 * Distances use each tile bounds' center as a deterministic priority heuristic.
 */
export function selectVisibleTiles(
  refs: readonly TileRef[], geographicBounds: Bounds, focus: Position, caps: VisibleTileCaps,
): VisibleTileSelection {
  validCoordinate(focus, 'focus');
  validCoordinate([geographicBounds[0], geographicBounds[1]], 'geographicBounds southwest');
  validCoordinate([geographicBounds[2], geographicBounds[3]], 'geographicBounds northeast');
  if (geographicBounds[1] >= geographicBounds[3]) throw new RangeError('geographicBounds latitude order is invalid');
  validLimit(caps.maxTriangles, 'maxTriangles'); validLimit(caps.maxDrawCalls, 'maxDrawCalls');
  validLimit(caps.maxResidentBytes, 'maxResidentBytes'); validLimit(caps.maxTiles, 'maxTiles');
  const overhead = caps.shadowOverhead ?? { triangles: 0, drawCalls: 1 };
  validLimit(overhead.triangles, 'shadow triangles'); validLimit(overhead.drawCalls, 'shadow draw calls');

  const outsideView: TileRef[] = [], candidates: { ref: TileRef; cost: TileRenderCost; distance: number }[] = [];
  for (const ref of refs) {
    if (!intersects(ref.bounds, geographicBounds)) { outsideView.push(ref); continue; }
    candidates.push({ ref, cost: checkedCost(ref, caps), distance: distanceToCenter(focus, boundsCenter(ref.bounds)) });
  }
  candidates.sort((a, b) => a.distance - b.distance || (a.ref.id < b.ref.id ? -1 : a.ref.id > b.ref.id ? 1 : a.ref.sha256 < b.ref.sha256 ? -1 : a.ref.sha256 > b.ref.sha256 ? 1 : 0));
  const selected: TileRef[] = [], deferred: DeferredTile[] = [], overbudget: DeferredTile[] = [];
  const cost: TileRenderCost = { triangles: 0, drawCalls: 0, residentBytes: 0 };
  for (const candidate of candidates) {
    const { ref, cost: next } = candidate;
    const individualReason = reasonFor(next, caps);
    if (individualReason) { overbudget.push({ ref, reason: individualReason, cost: next }); continue; }
    if (selected.length >= caps.maxTiles) { deferred.push({ ref, reason: 'tile-cap', cost: next }); continue; }
    const reason: TileDeferralReason | null = cost.triangles + next.triangles > caps.maxTriangles ? 'triangle-cap'
      : cost.drawCalls + next.drawCalls > caps.maxDrawCalls ? 'draw-call-cap'
        : cost.residentBytes + next.residentBytes > caps.maxResidentBytes ? 'resident-byte-cap' : null;
    if (reason) { deferred.push({ ref, reason, cost: next }); continue; }
    selected.push(ref); cost.triangles += next.triangles; cost.drawCalls += next.drawCalls; cost.residentBytes += next.residentBytes;
  }
  return { selected, deferred, overbudget, outsideView, cost };
}

export interface PinnedManifest { identity: string; value: WorldManifest }
export interface TileLoadContext { manifestIdentity: string; regionId: string; sourceIds: ReadonlySet<string> }
export interface LoadedTile<Payload> { manifestIdentity: string; regionId: string; tileId: string; sha256: string; cacheBytes: number; payload: Payload }
export interface ActiveTile<Active> { ref: TileRef; value: Active }
export interface StreamingSnapshot<Active> {
  manifestIdentity: string | null;
  active: readonly ActiveTile<Active>[];
  pendingIds: readonly string[];
  failed: readonly { id: string; message: string }[];
  deferred: readonly DeferredTile[];
  overbudget: readonly DeferredTile[];
  outsideView: readonly TileRef[];
}
export interface TileStreamSchedulerOptions<Payload, Active> {
  maxConcurrent?: number;
  maxCacheEntries: number;
  maxCacheBytes: number;
  load: (ref: TileRef, context: TileLoadContext, signal: AbortSignal) => Promise<LoadedTile<Payload>>;
  activate: (payload: Payload, ref: TileRef) => Active;
  disposeActive: (value: Active, ref: TileRef) => void;
  onChange?: (snapshot: StreamingSnapshot<Active>) => void;
}

interface Pending { ref: TileRef; key: string; controller: AbortController; queued: boolean }
interface CacheEntry<Payload> { payload: Payload; bytes: number }
const EMPTY_SELECTION: VisibleTileSelection = { selected: [], deferred: [], overbudget: [], outsideView: [], cost: { triangles: 0, drawCalls: 0, residentBytes: 0 } };

/**
 * Loads only the selected refs, with at most two injected requests in flight. Manifest identity
 * scopes cache keys and every publication; changing packs clears active values and aborts old work.
 */
export class TileStreamScheduler<Payload, Active> {
  private readonly options: TileStreamSchedulerOptions<Payload, Active>;
  private readonly maxConcurrent: number;
  private readonly cache: ByteLru<string, CacheEntry<Payload>>;
  private readonly cacheOrder = new Map<string, number>();
  private cacheBytes = 0;
  private manifest: PinnedManifest | null = null;
  private refsById = new Map<string, TileRef>();
  private desired: TileRef[] = [];
  private readonly pending = new Map<string, Pending>();
  private readonly active = new Map<string, ActiveTile<Active>>();
  private readonly failed = new Map<string, string>();
  private inFlight = 0;
  private deferred: DeferredTile[] = [];
  private overbudget: DeferredTile[] = [];
  private outsideView: TileRef[] = [];

  constructor(options: TileStreamSchedulerOptions<Payload, Active>) {
    this.options = options;
    this.maxConcurrent = options.maxConcurrent ?? WORLD_LIMITS.maxFetches;
    if (!Number.isSafeInteger(this.maxConcurrent) || this.maxConcurrent < 1 || this.maxConcurrent > WORLD_LIMITS.maxFetches) throw new RangeError(`maxConcurrent must be between 1 and ${WORLD_LIMITS.maxFetches}`);
    validLimit(options.maxCacheEntries, 'maxCacheEntries'); validLimit(options.maxCacheBytes, 'maxCacheBytes');
    this.cache = new ByteLru(options.maxCacheBytes);
  }

  setManifest(manifest: PinnedManifest | null): void {
    if (manifest?.identity === this.manifest?.identity) return;
    if (manifest && !/^[a-f0-9]{64}$/.test(manifest.identity)) throw new TypeError('manifest identity must be a lowercase SHA-256 hash');
    if (manifest && new Set(manifest.value.tiles.map((ref) => ref.id)).size !== manifest.value.tiles.length) throw new TypeError('pinned manifest has duplicate tile IDs');
    this.cancelPending(); this.clearActive();
    this.manifest = manifest;
    this.refsById = new Map((manifest?.value.tiles ?? []).map((ref) => [ref.id, ref]));
    this.desired = []; this.failed.clear(); this.deferred = []; this.overbudget = []; this.outsideView = [];
    this.publish();
  }

  setSelection(selection: VisibleTileSelection): void {
    if (!this.manifest) throw new Error('setManifest must be called before setSelection');
    const refs = selection.selected.map((requested) => {
      const ref = this.refsById.get(requested.id);
      if (!ref || ref.sha256 !== requested.sha256 || ref.path !== requested.path) throw new Error(`selected tile ${requested.id} is outside the pinned manifest`);
      return ref;
    });
    const wanted = new Map(refs.map((ref) => [ref.id, ref]));
    for (const [id, request] of this.pending) {
      const keep = wanted.get(id);
      if (!keep || keep.sha256 !== request.ref.sha256) { request.controller.abort(); this.pending.delete(id); }
    }
    for (const [id, entry] of this.active) {
      const keep = wanted.get(id);
      if (!keep || keep.sha256 !== entry.ref.sha256) this.removeActive(id);
    }
    this.desired = refs;
    this.deferred = [...selection.deferred]; this.overbudget = [...selection.overbudget]; this.outsideView = [...selection.outsideView];
    for (const id of this.failed.keys()) if (!wanted.has(id)) this.failed.delete(id);
    const manifest = this.manifest;
    for (const ref of refs) {
      if (this.active.has(ref.id) || this.pending.has(ref.id) || this.failed.has(ref.id)) continue;
      const key = `${manifest.identity}:${ref.sha256}`;
      const cached = this.getCached(key);
      if (cached) {
        try { this.activate(ref, cached.payload); this.failed.delete(ref.id); }
        catch (error) { this.failed.set(ref.id, error instanceof Error ? error.message : String(error)); }
        continue;
      }
      this.pending.set(ref.id, { ref, key, controller: new AbortController(), queued: true });
    }
    this.publish(); this.pump();
  }

  /** Explicitly retries failed tiles that are still selected; a camera update never retries by itself. */
  retryFailed(ids?: readonly string[]): number {
    if (!this.manifest) return 0;
    const requested = ids ? new Set(ids) : new Set(this.failed.keys());
    let retried = 0;
    for (const ref of this.desired) {
      if (!requested.has(ref.id) || !this.failed.has(ref.id) || this.pending.has(ref.id) || this.active.has(ref.id)) continue;
      this.failed.delete(ref.id);
      this.pending.set(ref.id, { ref, key: `${this.manifest.identity}:${ref.sha256}`, controller: new AbortController(), queued: true });
      retried += 1;
    }
    if (retried) { this.publish(); this.pump(); }
    return retried;
  }

  snapshot(): StreamingSnapshot<Active> {
    return {
      manifestIdentity: this.manifest?.identity ?? null,
      active: [...this.active.values()],
      pendingIds: this.desired.filter((ref) => this.pending.has(ref.id)).map((ref) => ref.id),
      failed: [...this.failed].map(([id, message]) => ({ id, message })),
      deferred: [...this.deferred], overbudget: [...this.overbudget], outsideView: [...this.outsideView],
    };
  }

  dispose(): void {
    this.cancelPending(); this.clearActive(); this.cache.clear(); this.cacheOrder.clear(); this.cacheBytes = 0;
    this.manifest = null; this.refsById.clear(); this.desired = []; this.failed.clear(); this.publish();
  }

  private getCached(key: string): CacheEntry<Payload> | undefined {
    const value = this.cache.get(key);
    if (!value) { this.cacheOrder.delete(key); return undefined; }
    this.cacheOrder.delete(key); this.cacheOrder.set(key, value.bytes);
    return value;
  }

  private setCached(key: string, value: CacheEntry<Payload>): void {
    const maxEntries = this.options.maxCacheEntries;
    if (maxEntries === 0 || value.bytes > this.options.maxCacheBytes) return;
    const previousBytes = this.cacheOrder.get(key);
    if (previousBytes !== undefined) { this.cache.delete(key); this.cacheOrder.delete(key); this.cacheBytes -= previousBytes; }
    while (this.cacheOrder.size >= maxEntries || this.cacheBytes + value.bytes > this.options.maxCacheBytes) {
      const oldest = this.cacheOrder.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.cacheBytes -= this.cacheOrder.get(oldest)!; this.cacheOrder.delete(oldest); this.cache.delete(oldest);
    }
    this.cache.set(key, value, value.bytes);
    this.cacheOrder.set(key, value.bytes); this.cacheBytes += value.bytes;
  }

  private pump(): void {
    const manifest = this.manifest;
    if (!manifest) return;
    for (const ref of this.desired) {
      if (this.inFlight >= this.maxConcurrent) break;
      const request = this.pending.get(ref.id);
      if (!request?.queued) continue;
      request.queued = false; this.inFlight += 1;
      const context: TileLoadContext = { manifestIdentity: manifest.identity, regionId: manifest.value.region.id, sourceIds: new Set(manifest.value.sources.map((source) => source.id)) };
      void this.loadOne(request, context);
    }
  }

  private async loadOne(request: Pending, context: TileLoadContext): Promise<void> {
    let changed = false;
    try {
      const loaded = await this.options.load(request.ref, context, request.controller.signal);
      if (loaded.manifestIdentity !== context.manifestIdentity || loaded.regionId !== context.regionId || loaded.tileId !== request.ref.id || loaded.sha256 !== request.ref.sha256) {
        throw new Error(`loaded tile ${request.ref.id} does not match its pinned manifest reference`);
      }
      validLimit(loaded.cacheBytes, 'loaded cacheBytes');
      if (this.isCurrent(request)) {
        const manifest = this.manifest!;
        if (loaded.cacheBytes <= this.options.maxCacheBytes) this.setCached(request.key, { payload: loaded.payload, bytes: loaded.cacheBytes });
        this.activate(request.ref, loaded.payload);
        this.failed.delete(request.ref.id);
        changed = this.manifest === manifest;
      }
    } catch (error) {
      if (this.isCurrent(request) && !request.controller.signal.aborted) {
        this.failed.set(request.ref.id, error instanceof Error ? error.message : String(error)); changed = true;
      }
    } finally {
      this.inFlight -= 1;
      if (this.pending.get(request.ref.id) === request) this.pending.delete(request.ref.id);
      this.pump();
      if (changed) this.publish();
    }
  }

  private isCurrent(request: Pending): boolean {
    return !request.controller.signal.aborted && this.manifest !== null && request.key === `${this.manifest.identity}:${request.ref.sha256}`
      && this.pending.get(request.ref.id) === request && this.desired.some((ref) => ref.id === request.ref.id && ref.sha256 === request.ref.sha256);
  }

  private activate(ref: TileRef, payload: Payload): void {
    const value = this.options.activate(payload, ref);
    this.active.set(ref.id, { ref, value });
  }

  private removeActive(id: string): void {
    const old = this.active.get(id); if (!old) return;
    this.active.delete(id); this.options.disposeActive(old.value, old.ref);
  }

  private clearActive(): void { for (const id of [...this.active.keys()]) this.removeActive(id); }

  private cancelPending(): void {
    for (const request of this.pending.values()) request.controller.abort();
    this.pending.clear();
  }

  private publish(): void { this.options.onChange?.(this.snapshot()); }
}
