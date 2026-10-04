/**
 * OWNER: world
 * THE WORLD SERVICE — keeps the per-local-government registry (server/world/registry.js, stored in
 * shards: server/world/shards.js) in step with the lives in the main store, gives every life its
 * plot, and answers the map's and the directory's questions without ever scanning residents.
 *
 * TWO STORES, ONE TRUTH EACH
 *   The LIFE (main store) is the truth about a player: their local government, the look and size
 *   of their house, the plot they were told is theirs.
 *   The SHARD of a local government is the truth about its plots: which player holds which one.
 *   Nothing is ever written to both in one step, so every step is made safe to repeat instead:
 *     1. settleIn    (shard)  the player gets a plot, or keeps the one they have — keyed by their
 *                             public id, so however often it runs there is exactly one
 *     2. estate.assign (life) the plot is recorded in the life — the same plot again changes nothing
 *     3. moveOut     (shard)  the plot in the local government they left is freed — nothing if absent
 *     4. estate.released (life)
 *   A crash between any two steps is healed by the next sync of that player: sync() is run whenever
 *   a life is settled and looks different from what was last synced (watchLives), i.e. on the first
 *   poll after a restart, after creation, after a change of local government, style or upgrade.
 *   A sync whose main-store write fails is simply run again by the next poll.
 *
 * WHAT ONE REQUEST READS AND WRITES
 *   sync            reads one stored life; appends ≤ 2 records to one shard (≤ 4 over two shards when
 *                   the player changed local government); at most one life is rewritten
 *   city summary    reads 20 in-memory summaries (no resident record); writes nothing
 *   estates/houses  reads ≤ 512 counters, or ≤ 98 plots of one estate; writes nothing
 *   directory       one binary search + ≤ 200 index entries of one shard; presence is joined for the
 *                   ≤ 25 rows of the page from the sockets the host holds; writes nothing
 * A cold shard is read from its file once (bounded by the shard's 100,352 plots and its residents)
 * and stays open; at most 8 are open at a time.
 *
 * GROWTH. A resident is one record (~75 bytes) and a house one (~60 bytes): 100,000 of each is about
 * 13.5 MB in one shard file. A resident not seen for 45 days leaves with their plot (their device
 * session expired after 30), so a shard holds at most the players active in that window.
 *
 * PRIVACY. Only public ids, names and house styles are stored. A player hidden from the directory
 * (the existing civic preference) keeps their house on the map, without their name or id.
 *
 * Portable: no Node imports. One service per server context (worldOf).
 */
import { lagosTime } from '../../src/game/clock.js';
import { ESTATE, PLOTS_PER_ESTATE, cityRules, lgaOf, lgasOf, packStyle } from '../../src/game/content/world.js';
import { hasPlace } from '../../src/game/systems/estate.js';
import { watchLives } from '../life-service.js';
import * as registry from './registry.js';

const services = new WeakMap();
const PRUNE_DAYS = 45;
const b64 = (bytes) => { let text = ''; for (let i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]); return btoa(text); };
const shardOf = (cityId, lga) => `${cityId}.${lga}`;

/** Sessions stored before "one character" existed get a `character` record; nothing else of theirs is touched. */
export function migrateCharacters(db) {
  const keys = db.$store ? db.$store.scanSessions((session) => !session.character) : Object.entries(db.sessions).filter(([, session]) => !session.character).map(([key]) => key);
  for (const key of keys) {
    const session = db.sessions[key];
    session.character = { v: 1, city: currentCity(session) };
  }
  return keys.length;
}
/** The city a session is in: the life played most recently (Lagos when there is none, or a tie). */
export function currentCity(session) {
  const lives = Object.entries(session.cities || {}).filter(([id, entry]) => cityRules(id) && entry?.state);
  if (!lives.length) return 'lagos';
  return lives.reduce((best, item) => ((item[1].updatedAt ?? 0) > (best[1].updatedAt ?? 0) ? item : best), lives.find(([id]) => id === 'lagos') ?? lives[0])[0];
}

export function worldOf(ctx) {
  let service = services.get(ctx);
  if (service) return service;
  const shards = ctx.shards ?? null;
  const boot = String(ctx.randomId?.() ?? '0').slice(0, 8);
  const sigs = new Map(), known = new Map(), running = new Map(), dirty = new Set();   // keyed `${publicId}:${cityId}`
  const hidden = new Set();
  const sockets = new Map();           // public id → open sockets
  const onlineIn = new Map();          // shard name → Set<public id>
  const summaries = new Map();         // shard name → { residents, houses, rev, occ, bytes, stale, seeded }
  let version = 0, metaDirty = false, metaWriting = false;
  const log = (line) => (ctx.core?.log ?? console.error)(line);
  const today = () => lagosTime(ctx.now()).day;

  // The service's own writes settle lives too; those must not ask for another sync, or a write that
  // keeps failing (a full disk) would retry itself in a loop. A failed sync waits for the player's next poll.
  let quiet = false;
  const quietly = (fn) => { const was = quiet; quiet = true; try { return fn(); } finally { quiet = was; } };
  const sigOf = (cityId, state) => { const e = state.estate; return [cityId, e.city, state.name, e.lga, e.plot ? `${e.plot.lga}/${e.plot.estate}/${e.plot.plot}` : '', e.old ? e.old.lga : '', packStyle(e.style, e.tier), e.upgrade?.doneAt ?? 0, e.living, state.property?.house, hasPlace(state), today()].join('|'); };
  // A resident is a life with a place in the city: it has settled in and has a local government (src/game/systems/estate.js hasPlace).
  const inCity = (state) => hasPlace(state);

  function touch(name) {
    const state = shards.peek(name);
    if (!state) return;
    const old = summaries.get(name);
    if (old && old.rev === state.rev && !old.stale) return;
    summaries.set(name, { residents: state.residents.size, houses: state.houseCount, rev: state.rev, occ: null, bytes: 0, stale: false });
    version += 1; metaDirty = true;
  }
  const summaryOf = (name) => summaries.get(name) ?? { residents: 0, houses: 0, rev: 0, occ: null, stale: false };
  function occOf(name) {
    const summary = summaryOf(name);
    if (summary.occ === null) { const state = shards.peek(name); summary.occ = state ? b64(state.occ) : b64(new Uint8Array(ESTATE.estates)); }
    return summary.occ;
  }
  function setOnline(id, name, on) {
    let set = onlineIn.get(name);
    if (on) { if (!set) onlineIn.set(name, set = new Set()); set.add(id); } else if (set) { set.delete(id); if (!set.size) onlineIn.delete(name); }
  }
  /** Where a player is known to live, in every city: [shard name]. */
  const homesOf = (id) => ctx.cityIds.map((cityId) => { const at = known.get(`${id}:${cityId}`); return at ? shardOf(cityId, at.lga) : null; }).filter(Boolean);

  /** Bring one player's registry entries in line with their stored life. Safe to repeat; see the header. */
  async function syncNow(publicId, cityId) {
    const key = `${publicId}:${cityId}`;
    const snap = await ctx.store.read((db) => {
      const session = ctx.core.sessionByPublicId(db, publicId);
      const state = session && session.expiresAt > ctx.now() ? session.cities?.[cityId]?.state : null;
      if (!state?.estate) return null;
      return { name: session.name, resident: inCity(state), estate: state.estate, house: state.property?.house ?? null, sig: sigOf(cityId, state) };
    });
    if (!snap) return null;
    // The character arrived in another city: its life is filed under that city (and nothing else here applies yet).
    if (snap.estate.city !== cityId) { await rekey(publicId, cityId, snap.estate.city); return null; }
    const e = snap.estate, unit = lgaOf(cityId, e.lga);
    if (!snap.resident || !unit) { sigs.set(key, snap.sig); return null; }
    const name = shardOf(cityId, unit.id);
    const who = { id: publicId, name: snap.name, day: today(), hidden: hidden.has(publicId), home: e.living === 'own' ? 'own' : snap.house, style: packStyle(e.style, e.tier), until: e.upgrade?.doneAt ?? 0 };
    const placed = await shards.transact(name, (state) => { const result = registry.settleIn(state, who); return { records: result.records, result: { plot: result.plot, full: result.full } }; });
    touch(name);
    if (placed.full) log(`World: ${name} is full (${registry.counts(shards.peek(name)).houses} houses); ${publicId} has no plot.`);
    let old = e.old;
    if (placed.plot && (!e.plot || e.plot.lga !== unit.id || e.plot.estate !== placed.plot.estate || e.plot.plot !== placed.plot.plot)) {
      const assigned = await ctx.store.transact((db) => {
        const session = ctx.core.sessionByPublicId(db, publicId);
        if (!session || session.expiresAt <= ctx.now() || !session.cities?.[cityId]) return null;
        return quietly(() => {
          const life = ctx.settle(session, cityId);
          if (life.estate.lga !== unit.id) return null;   // changed again meanwhile: the next sync deals with it
          ctx.act(life, { type: 'estate.assign', cityId, payload: { lga: unit.id, estate: placed.plot.estate, plot: placed.plot.plot }, stateGuard: 'assigning the plot a life already has changes nothing' });
          return life.estate.old;
        });
      });
      old = assigned ?? old;
    }
    // The local government(s) left behind: the plot there is freed and the player is taken off its list.
    const before = known.get(key);
    const left = new Set([old?.lga, e.plot?.lga, before?.lga].filter((lga) => lga && lga !== unit.id && lgaOf(cityId, lga)));
    for (const lga of left) {
      await shards.transact(shardOf(cityId, lga), (state) => ({ records: registry.moveOut(state, publicId).records }));
      touch(shardOf(cityId, lga)); setOnline(publicId, shardOf(cityId, lga), false);
    }
    if (old) {
      await ctx.store.transact((db) => {
        const session = ctx.core.sessionByPublicId(db, publicId);
        if (!session || session.expiresAt <= ctx.now() || !session.cities?.[cityId]) return;
        quietly(() => {
          const life = ctx.settle(session, cityId);
          if (life.estate.old) ctx.act(life, { type: 'estate.released', cityId, payload: life.estate.old, stateGuard: 'clearing the remembered old plot twice changes nothing' });
        });
      });
    }
    known.set(key, { lga: unit.id });
    // The life may have been changed by this very sync (its plot): the next poll's signature settles it with one idle pass.
    sigs.set(key, snap.sig);
    if (sockets.has(publicId)) setOnline(publicId, name, true);
    return placed.plot ? { lga: unit.id, ...placed.plot } : null;
  }
  /** One sync at a time per player; a change noticed meanwhile runs one more afterwards. */
  function sync(publicId, cityId) {
    const key = `${publicId}:${cityId}`;
    if (!shards || !cityRules(cityId)) return Promise.resolve(null);
    const current = running.get(key);
    if (current) { dirty.add(key); return current; }
    const work = syncNow(publicId, cityId).catch((error) => { sigs.delete(key); if (error?.code !== 'storage_unavailable') log(`World sync failed: ${String(error?.message ?? error).split('\n')[0]}`); return null; })
      .finally(() => { running.delete(key); if (dirty.delete(key)) void sync(publicId, cityId); });
    running.set(key, work);
    return work;
  }

  /** A life arrived in another city: file it under that city. A separate life already kept there is put aside, never lost. */
  async function rekey(publicId, from, to) {
    if (!ctx.cityIds.includes(to)) { log(`World: ${to} is not a city this server keeps lives for; the life stays filed under ${from}.`); return; }
    await ctx.store.transact((db) => {
      const session = ctx.core.sessionByPublicId(db, publicId);
      const entry = session?.cities?.[from];
      if (!entry || entry.state?.estate?.city !== to) return;
      if (session.cities[to]) { session.legacyLives ||= {}; session.legacyLives[`${to}:${ctx.now()}`] = session.cities[to]; }
      session.cities[to] = entry;
      delete session.cities[from];
      session.character = { v: 1, city: to, movedAt: ctx.now(), from };
    });
  }

  // Told (synchronously, inside whatever transaction is running) each time a life is settled or acted on.
  // Only a look: the stored life is read again by sync(), so an undone transaction costs one idle sync.
  const onLife = (publicId, cityId, state) => {
    if (!shards || !state?.estate || quiet) return;
    const key = `${publicId}:${cityId}`, sig = sigOf(cityId, state);
    if (sigs.get(key) === sig) return;
    sigs.set(key, sig);
    if (sigs.size > 50000) for (const old of sigs.keys()) { sigs.delete(old); if (sigs.size <= 40000) break; }
    queueMicrotask(() => void sync(publicId, cityId));
  };
  watchLives(onLife);

  /** Write the small summary file when something changed (called on the host's heartbeat and at shutdown). */
  async function saveMeta() {
    if (!shards || !metaDirty || metaWriting) return;
    metaWriting = true; metaDirty = false;
    try {
      const out = {};
      for (const [name, summary] of summaries) if (!summary.seeded) out[name] = { residents: summary.residents, houses: summary.houses, rev: summary.rev, occ: occOf(name), bytes: await shards.size(name) };
      await shards.writeMeta(out);
    } catch (error) { metaDirty = true; log(`World summary could not be written: ${error?.message}`); } finally { metaWriting = false; }
  }
  async function loadMeta() {
    if (!shards) return;
    const saved = await shards.readMeta();
    for (const [name, value] of Object.entries(saved || {})) {
      if (!/^[a-z-]+\.[a-z-]+$/.test(name) || typeof value?.occ !== 'string') continue;
      // A shard file that is not the size the summary was written for changed after it (a crash): count it again when asked.
      summaries.set(name, { residents: Number(value.residents) || 0, houses: Number(value.houses) || 0, rev: Number(value.rev) || 0, occ: value.occ, stale: (await shards.size(name)) !== value.bytes });
    }
  }
  /** Shards on disk that the summary file does not describe correctly are read once. */
  async function refresh(cityId) {
    for (const unit of lgasOf(cityId)) {
      const name = shardOf(cityId, unit.id), summary = summaries.get(name);
      if (summary && !summary.stale) continue;
      if (!summary && (await shards.size(name)) === 0) { summaries.set(name, { residents: 0, houses: 0, rev: 0, occ: null, stale: false }); continue; }
      await shards.read(name, () => null);
      if (summary) summary.stale = true;
      touch(name);
    }
  }

  service = {
    enabled: Boolean(shards),
    sync,
    /** Everything in flight has finished (tests and the load generator wait on this). */
    async idle() { for (let i = 0; i < 20 && (running.size || dirty.size); i++) await Promise.all([...running.values()]); await new Promise((done) => setTimeout(done, 0)); if (running.size) return service.idle(); },
    /** The city at a glance: per local government the counts and the houses-per-estate summary. `v` changes whenever any of it does. */
    async city(cityId) {
      await refresh(cityId);
      return { v: `${boot}.${version}`, lgas: lgasOf(cityId).map((unit) => { const name = shardOf(cityId, unit.id), summary = summaryOf(name); return { id: unit.id, residents: summary.residents, houses: summary.houses, online: onlineIn.get(name)?.size ?? 0, occ: occOf(name) }; }) };
    },
    version: () => `${boot}.${version}`,
    async lga(cityId, lga) {
      const name = shardOf(cityId, lga);
      const counts = await shards.read(name, (state) => registry.counts(state));
      touch(name);
      return { ...counts, online: onlineIn.get(name)?.size ?? 0 };
    },
    estates: (cityId, lga, from, count) => shards.read(shardOf(cityId, lga), (state) => ({ v: state.rev, from, counts: registry.occupancy(state, from, Math.min(count, registry.PAGE.estates)) })),
    async houses(cityId, lga, estate, page, viewerId) {
      const result = await shards.read(shardOf(cityId, lga), (state) => registry.housesPage(state, estate, page, viewerId));
      // Presence is joined for this page only, from the sockets the host holds.
      for (const house of result.houses) if (house.id) { house.online = ctx.online(house.id); if (house.id === viewerId) house.you = true; }
      return result;
    },
    async people(cityId, lga, { q, after, online, viewerId }) {
      const name = shardOf(cityId, lga);
      if (online) {
        // Who is online here, from the in-memory presence set: a page of it, never a scan of residents.
        // Walks the set only as far as this page (at most 400 + 25 entries), however many are online.
        const set = onlineIn.get(name) ?? new Set(), start = Number.isSafeInteger(after) && after > 0 ? Math.min(after, 400) : 0, slice = [];
        let seen = 0;
        for (const id of set) { if (seen++ < start) continue; slice.push(id); if (slice.length >= registry.PAGE.people) break; }
        const ids = { length: Math.min(set.size, 400 + registry.PAGE.people) };
        const items = await shards.read(name, (state) => slice.map((id) => registry.person(state, id, viewerId)).filter(Boolean));
        return { items: items.map((item) => ({ ...item, online: ctx.online(item.id), you: item.id === viewerId })), next: start + slice.length < ids.length ? start + slice.length : null };
      }
      const page = await shards.read(name, (state) => registry.directory(state, { q, after, viewerId }));
      return { items: page.items.map((item) => ({ ...item, online: ctx.online(item.id), you: item.id === viewerId })), next: page.next };
    },
    isHidden: (id) => hidden.has(id),
    /** The directory preference changed (server/routes/civic.js): the player's registry entries follow. */
    setHidden(id, value) { if (value) hidden.add(id); else hidden.delete(id); for (const cityId of ctx.cityIds) { sigs.delete(`${id}:${cityId}`); if (known.has(`${id}:${cityId}`)) void sync(id, cityId); } },
    open(ws) { const id = ws.session?.id; if (!id) return; sockets.set(id, (sockets.get(id) ?? 0) + 1); for (const name of homesOf(id)) setOnline(id, name, true); },
    close(ws) { const id = ws.session?.id; if (!id || !sockets.has(id)) return; const left = sockets.get(id) - 1; if (left > 0) { sockets.set(id, left); return; } sockets.delete(id); for (const name of homesOf(id)) setOnline(id, name, false); },
    saveMeta, loadMeta,
    /** LOAD GENERATOR AND TESTS ONLY (not reachable from any route): put a resident straight into a shard, or a summary in place of one. */
    async seedResident(cityId, lga, who) { const name = shardOf(cityId, lga); const result = await shards.transact(name, (state) => { const placed = registry.settleIn(state, who); return { records: placed.records, result: placed.plot }; }); return result; },
    touch: (cityId, lga) => touch(shardOf(cityId, lga)),
    seedSummary(cityId, lga, { residents, houses, occ }) { summaries.set(shardOf(cityId, lga), { residents, houses, rev: 1, occ: b64(occ), stale: false, seeded: true }); version += 1; },
    seedOnline(cityId, lga, ids) { for (const id of ids) setOnline(id, shardOf(cityId, lga), true); },
    stats: () => ({ shards: shards?.stats() ?? null, synced: known.size, online: sockets.size, steps: registry.metrics.steps }),
    capacity: ESTATE.estates * PLOTS_PER_ESTATE,
  };
  services.set(ctx, service);
  if (shards) {
    // Before the server takes requests: the summary file, the directory preferences, and the character records.
    ctx.startup.push(loadMeta());
    ctx.startup.push(ctx.store.read((db) => { for (const [id, prefs] of Object.entries(db.civic?.prefs ?? {})) if (prefs?.directory === true) hidden.add(id); }));
    ctx.startup.push(ctx.store.transact((db) => migrateCharacters(db)));
    // Housekeeping on the host's heartbeat: the summary file, and — one open shard per beat, a slice at a time —
    // residents not seen for PRUNE_DAYS days leave with their plots (their session expired long before).
    let beat = 0;
    ctx.on('heartbeat', () => {
      void saveMeta();
      const open = shards.open();
      if (!open.length) return;
      const name = open[beat++ % open.length];
      shards.transact(name, (state) => ({ records: registry.stale(state, today() - PRUNE_DAYS) })).then(() => touch(name), () => {});
    });
    ctx.on('directory-pref', ({ id, hidden: value }) => service.setHidden(id, value));
  }
  // Kept on the service so the weakly held watcher lives as long as the server does.
  service.onLife = onLife;
  return service;
}

