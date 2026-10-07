/** Reservations and wallet commits have separate stores. Tokens fence every late retry. */
import { requireCharacterCity } from '../character.ts';
import { emptyCivic } from '../civic/data.ts';
import { boundedFingerprint } from '../routes/once.ts';
import { UUID_PATTERN } from '../protocol.ts';
import { LAND, landPrice } from '../../src/game/land.ts';
import { PLOTS_PER_ESTATE } from '../../src/game/content/world.ts';
import { loadCityContent } from '../../src/game/cities/registry.ts';
import { isRecord } from '../../src/game/util.ts';
import { worldOf } from './service.ts';
import { readPlot, samePlot } from './street.ts';
import * as registry from './registry.ts';
import type { RegistryRecord, RegistryState } from './registry.ts';
import type { ShardStoreOn } from './shard-core.ts';
import type { Db, RouteContext, RouteRequest } from '../types.ts';
import type { CityId, TimedId } from '../../src/types/protocol.ts';
import type { LandBuyRequest, LandPurchase, LandView } from '../../src/types/land.ts';

type Result = { ok: boolean; code: string; duplicate?: true; pending?: true; owned?: boolean };
const services = new WeakMap<RouteContext, ReturnType<typeof buildLand>>();
const shardOf = (purchase: Pick<LandPurchase, 'city' | 'anchor'>) => `${purchase.city}.${purchase.anchor.lga}`;
const fingerprint = (request: LandBuyRequest) => JSON.stringify([request.cityId, request.anchor.lga, request.anchor.estate, request.anchor.plot, request.plot, request.price]);
function isTimedId(value: string): value is TimedId {
  const [head = '', tail = '', ...rest] = value.split(':');
  return rest.length === 0 && /^\d{1,16}$/.test(head) && Number.isSafeInteger(Number(head)) && UUID_PATTERN.test(tail);
}

function savedPurchase(ctx: RouteContext, db: Db, owner: string): LandPurchase | null {
  const p = db.civic?.landPurchases?.[owner];
  if (!p) return null;
  if (p.owner !== owner || !ctx.cityIds.includes(p.city) || !readPlot(p.anchor, p.city) || typeof p.token !== 'string' || !p.token || p.token.length > 128 || typeof p.id !== 'string' || p.id.length > 128 || !isTimedId(p.id) || typeof p.fingerprint !== 'string' || p.fingerprint.length > 512 || !Number.isInteger(p.plot) || p.plot < 0 || p.plot >= PLOTS_PER_ESTATE || !Number.isSafeInteger(p.price) || p.price <= 0 || !Number.isSafeInteger(p.at) || p.at < 0 || !['intent', 'paid', 'finalized', 'cancelled'].includes(p.phase)) throw ctx.fail(503, 'land_recovery_required');
  return p;
}

export function landOf(ctx: RouteContext) {
  let service = services.get(ctx);
  if (!service) { service = buildLand(ctx); services.set(ctx, service); }
  return service;
}

function buildLand(ctx: RouteContext) {
  // The host constructs this shared shard with registry.ts (as world/service.ts does).
  const shards = ctx.shards as ShardStoreOn<RegistryState, RegistryRecord> | undefined;
  const world = worldOf(ctx), queues = new Map<string, Promise<void>>();
  const recoveryOwners = new Set<string>();
  let recoverySeeded = false, draining: Promise<void> | null = null;
  const ready = () => { if (!shards || !world.enabled) throw ctx.fail(503, 'world_unavailable'); return shards; };
  function serial<T>(owner: string, task: () => Promise<T>): Promise<T> {
    const before = queues.get(owner) ?? Promise.resolve(), run = before.then(task), tail = run.then(() => {}, () => {});
    queues.set(owner, tail);
    void tail.then(() => { if (queues.get(owner) === tail) queues.delete(owner); });
    return run;
  }
  const pending = (owner: string) => ctx.store.read((db) => savedPurchase(ctx, db, owner));
  function removeJournal(db: Db, p: LandPurchase): void {
    const current = savedPurchase(ctx, db, p.owner);
    if (current?.token !== p.token) return;
    delete db.civic!.landPurchases![p.owner];
  }
  async function reconcileNow(owner: string): Promise<Result> {
    const p = await pending(owner);
    if (!p) return { ok: true, code: 'land_idle' };
    if (p.phase === 'paid') {
      const result = await ready().transact(shardOf(p), (state) => {
        const finished = registry.finalizeLand(state, owner, p.anchor.estate, p.plot, p.token);
        return { records: finished.records, result: finished.code };
      });
      world.touch(p.city, p.anchor.lga);
      if (result !== 'land_owned') throw ctx.fail(503, 'land_recovery_required');
      await ctx.store.transact((db) => {
        const current = savedPurchase(ctx, db, owner);
        if (current?.token === p.token && current.phase === 'paid') current.phase = 'finalized';
      });
      return reconcileNow(owner);
    }
    if (p.phase === 'finalized') {
      // Stale cleanup waits for this acknowledgement. Once finalized, later release is valid:
      // clearing a remaining proof must never recreate a compound the owner already left.
      await ready().transact(shardOf(p), (state) => ({ records: registry.acknowledgeLand(state, owner, p.anchor.estate, p.plot, p.token), result: undefined }));
      world.touch(p.city, p.anchor.lga);
      await ctx.store.transact((db) => removeJournal(db, p));
      return { ok: true, code: 'land_owned' };
    }
    // Durable cancellation is a fence: a late payment must find this exact intent token.
    const fenced = await ctx.store.transact((db) => {
      const current = savedPurchase(ctx, db, owner);
      if (!current || current.token !== p.token) return null;
      if (current.phase === 'paid' || current.phase === 'finalized') return current;
      current.phase = 'cancelled';
      return current;
    });
    if (fenced?.phase === 'paid' || fenced?.phase === 'finalized') return reconcileNow(owner);
    if (!fenced) return { ok: true, code: 'land_idle' };
    await ready().transact(shardOf(fenced), (state) => ({ records: registry.releaseLandReservation(state, owner, fenced.anchor.estate, fenced.plot, fenced.token), result: undefined }));
    world.touch(fenced.city, fenced.anchor.lga);
    await ctx.store.transact((db) => removeJournal(db, fenced));
    return { ok: true, code: 'land_cancelled' };
  }
  async function viewNow(request: RouteRequest, city: CityId): Promise<LandView> {
    const who = await ctx.store.read((db) => {
      const session = request.requireSession(db); requireCharacterCity(session, city);
      const state = session.cities?.[city]?.state;
      return { owner: session.publicId, anchor: state?.estate?.plot ?? null, own: state?.estate?.living === 'own', pending: savedPurchase(ctx, db, session.publicId) };
    });
    let extras: number[] = [], candidates: number[] = [];
    if (who.anchor) {
      const anchor = who.anchor;
      const found = await ready().read(`${city}.${anchor.lga}`, (state) => ({ extras: registry.landOf(state, who.owner).filter((claim) => claim.kind === 'owned' && claim.estate === anchor.estate && claim.anchor === anchor.plot).map((claim) => claim.plot), candidates: who.own ? registry.landCandidates(state, who.owner) : [] }));
      extras = found.extras; candidates = found.candidates;
    }
    const price = who.anchor ? landPrice(city, who.anchor.lga) : null;
    return { city, anchor: who.anchor, extras, candidates: price === null ? [] : candidates.map((plot) => ({ plot, price })), pending: who.pending ? { phase: who.pending.phase, plot: who.pending.plot, price: who.pending.price } : null, maxExtras: LAND.maxExtras, beta: true };
  }
  async function buyNow(request: RouteRequest, body: LandBuyRequest, owner: string): Promise<Result> {
    ready();
    const fp = fingerprint(body), old = await pending(owner);
    if (old?.id === body.clientId && old.fingerprint !== fp) throw ctx.fail(409, 'client_id_conflict');
    const clientId = body.clientId;
    ctx.onceId(clientId);
    if (!isTimedId(clientId)) throw ctx.fail(400, 'invalid_client_id');
    if (old && (old.id !== body.clientId || old.phase !== 'intent')) {
      const finished = await reconcileNow(owner);
      if (old.id === body.clientId && (old.phase === 'paid' || old.phase === 'finalized')) return { ...finished, duplicate: true };
    }
    const prior = await ctx.store.read((db) => {
      const session = request.requireSession(db), receipt = session.once?.[clientId];
      if (!receipt) return null;
      if (receipt.kind !== 'land-buy' || receipt.fp !== boundedFingerprint(fp)) throw ctx.fail(409, 'client_id_conflict');
      if (!isRecord(receipt.result) || typeof receipt.result.ok !== 'boolean' || typeof receipt.result.code !== 'string') throw ctx.fail(503, 'land_recovery_required');
      return { ok: receipt.result.ok, code: receipt.result.code, duplicate: true as const };
    });
    if (prior) {
      const owned = prior.ok && await ready().read(`${body.cityId}.${body.anchor.lga}`, (state) => {
        const claim = state.land.get(body.anchor.estate)?.get(body.plot);
        return claim?.kind === 'owned' && claim.owner === owner && claim.id === body.clientId && claim.anchor === body.anchor.plot && claim.price === body.price;
      });
      return { ...prior, owned };
    }
    await world.sync(owner, body.cityId);
    const p = await ctx.store.transact((db) => {
      const session = request.requireSession(db, { renew: true }); requireCharacterCity(session, body.cityId);
      const state = ctx.settle(session, body.cityId), existing = savedPurchase(ctx, db, owner);
      if (existing) {
        if (existing.id === body.clientId && existing.fingerprint === fp && existing.phase === 'intent') return existing;
        throw ctx.fail(409, 'land_pending');
      }
      if (state.estate.living !== 'own' || !samePlot(state.estate.plot, body.anchor)) throw ctx.fail(409, 'not_owned_home');
      if (body.price !== landPrice(body.cityId, body.anchor.lga)) throw ctx.fail(409, 'land_price_changed');
      const next: LandPurchase = { owner, id: body.clientId, fingerprint: fp, token: ctx.randomId(), city: body.cityId, anchor: { ...body.anchor }, plot: body.plot, price: body.price, at: ctx.now(), phase: 'intent' };
      const civic = ctx.collection(db, 'civic', emptyCivic());
      (civic.landPurchases ??= {})[owner] = next;
      recoveryOwners.add(owner);
      return next;
    });
    const reserved = await ready().transact(shardOf(p), (state) => {
      const held = registry.reserveLand(state, owner, { estate: p.anchor.estate, plot: p.anchor.plot }, p.plot, p.token, p.id, p.price, p.at);
      return { records: held.records, result: held.code };
    });
    world.touch(p.city, p.anchor.lga);
    if (reserved !== 'reserved') { await reconcileNow(owner); return { ok: false, code: 'land_unavailable' }; }
    const payment = await ctx.store.transact((db) => {
      const session = request.requireSession(db, { renew: true }); requireCharacterCity(session, p.city);
      const current = savedPurchase(ctx, db, owner);
      if (!current || current.token !== p.token || current.phase !== 'intent') throw ctx.fail(409, 'land_intent_changed');
      return ctx.once(db, session, { id: p.id, kind: 'land-buy', fingerprint: p.fingerprint }, () => {
        const state = ctx.settle(session, p.city);
        const result = ctx.act(state, { type: 'estate.land-pay', cityId: p.city, payload: { anchor: p.anchor, plot: p.plot, price: p.price } });
        current.phase = result.ok ? 'paid' : 'cancelled';
        return { ok: result.ok, code: result.code };
      });
    });
    const finished = await reconcileNow(owner);
    return payment.ok ? finished : payment;
  }
  async function drain(limit: number): Promise<void> {
    if (!recoverySeeded) {
      // One startup inventory of unfinished transactions, never a scan of residents/lives.
      await Promise.all(ctx.cityIds.map(loadCityContent));
      const owners = await ctx.store.read((db) => Object.keys(db.civic?.landPurchases ?? {}));
      for (const owner of owners) recoveryOwners.add(owner);
      recoverySeeded = true;
    }
    const count = Math.min(recoveryOwners.size, Math.min(16, Math.max(1, Math.floor(limit))));
    for (let index = 0; index < count; index++) {
      const owner = recoveryOwners.values().next().value;
      if (owner === undefined) break;
      recoveryOwners.delete(owner);
      try { await serial(owner, () => reconcileNow(owner)); }
      catch (error) {
        // Reinsert at the tail: one broken proof must never starve unrelated owners.
        recoveryOwners.add(owner);
        const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'recovery_failed';
        (ctx.core.log ?? console.error)(`Land recovery deferred: ${code}`);
      }
    }
  }
  const service = {
    async view(request: RouteRequest, city: CityId) {
      const owner = await ctx.store.read((db) => request.requireSession(db).publicId);
      return serial(owner, async () => { ready(); await reconcileNow(owner); await world.sync(owner, city); return viewNow(request, city); });
    },
    async buy(request: RouteRequest, body: LandBuyRequest) {
      const owner = await ctx.store.read((db) => request.requireSession(db).publicId);
      return serial(owner, () => buyNow(request, body, owner));
    },
    reconcile: (owner: string) => serial(owner, () => reconcileNow(owner)),
    /** Parent calls before estate moves; the DB guard also fences moves racing an in-flight buy. */
    assertMovable(db: Db, owner: string): void { if (savedPurchase(ctx, db, owner)) throw ctx.fail(409, 'land_pending'); },
    reconcilePending(limit = 8): Promise<void> {
      if (!draining) {
        draining = drain(limit).finally(() => { draining = null; });
      }
      return draining;
    },
  };
  if (shards) {
    const recover = () => service.reconcilePending().catch(() => { (ctx.core.log ?? console.error)('Land recovery deferred: storage_unavailable'); });
    ctx.startup.push(recover());
    ctx.on('heartbeat', () => { void recover(); });
    ctx.closing?.push(async () => { await draining; });
  }
  return service;
}
