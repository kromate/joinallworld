/**
 * OWNER: world
 * THE REGISTRY OF ONE LOCAL GOVERNMENT — who lives there and which plot each house stands on.
 * Pure and portable: no I/O, no clock, no imports from the host. server/world/shards.js keeps one
 * of these per local government in an append-only log; this file is the state, the records that
 * change it and the queries over it.
 *
 * RECORDS (one JSON array per log line — compact on purpose: a resident is ~75 bytes, a house ~60)
 *   ['v', rev]                                    the revision the snapshot was taken at
 *   ['r', id, name, day, hidden, home]            a resident, added or updated. `id` is the PUBLIC id;
 *                                                 `day` the Lagos day last seen; `hidden` 1 = left out of
 *                                                 the directory; `home` 'own' or a rented tier id
 *   ['x', id]                                     the resident left this local government
 *   ['h', estate, plot, id, style, upgradeDoneAt] a house on a plot: its owner, its packed style
 *                                                 (content/world.js packStyle) and, while an upgrade
 *                                                 is being built, the server ms it finishes (else 0)
 *   ['f', estate, plot]                           the plot was given up
 * Nothing else is ever stored here: no secret, no position, no address of a device.
 *
 * EVERY OPERATION IS BOUNDED, and `metrics.steps` counts the loop steps of every query so a test
 * can assert it (server/world.test.js):
 *   allocating a plot      amortised O(1): a cursor to the first estate with room and, per estate,
 *                          a hint to its first free plot. Neither ever scans residents.
 *   counts, occupancy      maintained as records are applied; reading them is O(1) / O(estates)
 *   one estate's houses    ≤ PAGE.houses plot numbers looked at per page
 *   directory and search   one binary search in the sorted name index, then ≤ PAGE.scan entries
 *   adding a resident      one binary search and one insertion into that index
 */
import { ESTATE, PLOTS_PER_ESTATE, LGA_CAPACITY } from '../../src/game/content/world.ts';

export const PAGE = Object.freeze({ people: 25, houses: 98, scan: 200, estates: 128 });
export const metrics = { steps: 0 };
const SEP = '\u0001';

/** Case, accents and anything that is not a letter or digit folded away: what names are indexed and searched by. */
export const fold = (text) => String(text ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 24);
const keyOf = (name, id) => `${fold(name)}${SEP}${id}`;

function lowerBound(list, key) {
  let low = 0, high = list.length;
  while (low < high) { const mid = (low + high) >>> 1; metrics.steps += 1; if (list[mid] < key) low = mid + 1; else high = mid; }
  return low;
}

export function empty(name = '') {
  return { name, rev: 0, loading: true, residents: new Map(), names: [], sorted: true, houses: new Map(), occ: new Uint8Array(ESTATE.estates), hint: new Uint8Array(ESTATE.estates),
    stamp: new Uint32Array(ESTATE.estates), owners: new Map(), cursor: 0, houseCount: 0 };
}

/** Apply one record. The only code that changes a registry — live and when a shard file is replayed. */
export function reduce(state, record) {
  const kind = record[0];
  if (kind === 'v') { state.rev = Math.max(state.rev, Number(record[1]) || 0); return; }
  state.rev += 1;
  if (kind === 'r') {
    const [, id, name, day, hidden, home] = record, old = state.residents.get(id), key = keyOf(name, id);
    if (old && old.k !== key) { const at = index(state, old.k); if (state.names[at] === old.k) state.names.splice(at, 1); }
    if (!old || old.k !== key) {
      // Replaying a file appends in whatever order it was written and sorts once at the end (see index()).
      if (state.sorted && (state.names.length === 0 || state.names[state.names.length - 1] < key)) state.names.push(key);
      else if (state.loading) { state.names.push(key); state.sorted = false; }
      else state.names.splice(index(state, key), 0, key);
    }
    state.residents.set(id, { n: name, k: key, d: day, h: hidden ? 1 : 0, t: home });
  } else if (kind === 'x') {
    const old = state.residents.get(record[1]);
    if (!old) return;
    const at = index(state, old.k);
    if (state.names[at] === old.k) state.names.splice(at, 1);
    state.residents.delete(record[1]);
  } else if (kind === 'h') {
    const [, estate, plot, id, style, until] = record;
    let plots = state.houses.get(estate);
    if (!plots) state.houses.set(estate, plots = new Map());
    const had = plots.get(plot);
    if (!had) { state.occ[estate] += 1; state.houseCount += 1; } else if (had.o !== id) state.owners.delete(had.o);
    plots.set(plot, { o: id, s: style, u: until || 0 });
    state.owners.set(id, estate * PLOTS_PER_ESTATE + plot);
    state.stamp[estate] = state.rev;
  } else if (kind === 'f') {
    const [, estate, plot] = record, plots = state.houses.get(estate), had = plots?.get(plot);
    if (!had) return;
    plots.delete(plot);
    if (state.owners.get(had.o) === estate * PLOTS_PER_ESTATE + plot) state.owners.delete(had.o);
    state.occ[estate] -= 1; state.houseCount -= 1;
    // The plot is free again: the next allocation may use it (the growing edge moves back to it).
    if (plot < state.hint[estate]) state.hint[estate] = plot;
    if (estate < state.cursor) state.cursor = estate;
    state.stamp[estate] = state.rev;
  }
}
/** Position of `key` in the name index (sorting it first if a file was just replayed). */
function index(state, key) {
  if (!state.sorted) { state.names.sort(); state.sorted = true; }
  return lowerBound(state.names, key);
}
/** Called by the shard store after a file was replayed: the name index is put in order once. */
export function loaded(state) { delete state.loading; if (!state.sorted) { state.names.sort(); state.sorted = true; } return state; }

/** The records that rebuild this state: what a compacted shard file holds. */
export function snapshot(state) {
  const out = [['v', state.rev]];
  for (const [id, r] of state.residents) out.push(['r', id, r.n, r.d, r.h, r.t]);
  for (const [estate, plots] of state.houses) for (const [plot, house] of plots) out.push(['h', estate, plot, house.o, house.s, house.u]);
  return out;
}
/** How many records the state needs (the shard store compacts a file that holds more than twice this). */
export const live = (state) => state.residents.size + state.houseCount + 1;

// ---- allocation --------------------------------------------------------------------------------

/** The next free plot — the growing edge of the estates — or null when all 100,352 are taken. Amortised O(1). */
export function nextFree(state) {
  while (state.cursor < ESTATE.estates && state.occ[state.cursor] >= PLOTS_PER_ESTATE) { state.cursor += 1; metrics.steps += 1; }
  if (state.cursor >= ESTATE.estates) return null;
  const estate = state.cursor, plots = state.houses.get(estate);
  let plot = state.hint[estate];
  while (plots?.has(plot)) { plot += 1; metrics.steps += 1; }
  state.hint[estate] = plot;
  return { estate, plot };
}
/** Where a player's house is in this local government, or null. O(1). */
export function plotOf(state, id) {
  const at = state.owners.get(id);
  return at === undefined ? null : { estate: Math.floor(at / PLOTS_PER_ESTATE), plot: at % PLOTS_PER_ESTATE };
}

/**
 * The records that make `who` a resident with a house here, exactly once: a player who already has
 * a plot keeps it (so a repeat, a retry or a reload changes nothing), a new one gets the next free
 * plot. Returns { records, plot: { estate, plot } | null, full }.
 *   who = { id, name, day, hidden, home, style, until }
 */
export function settleIn(state, who) {
  const records = [], resident = state.residents.get(who.id);
  if (!resident || resident.n !== who.name || resident.d !== who.day || resident.h !== (who.hidden ? 1 : 0) || resident.t !== who.home) records.push(['r', who.id, who.name, who.day, who.hidden ? 1 : 0, who.home]);
  let plot = plotOf(state, who.id);
  if (!plot) {
    plot = nextFree(state);
    if (!plot) return { records, plot: null, full: true };
    records.push(['h', plot.estate, plot.plot, who.id, who.style, who.until || 0]);
  } else {
    const house = state.houses.get(plot.estate).get(plot.plot);
    if (house.s !== who.style || house.u !== (who.until || 0)) records.push(['h', plot.estate, plot.plot, who.id, who.style, who.until || 0]);
  }
  return { records, plot, full: false };
}
/** The records that remove a player and their house from this local government (none if they are not here). */
export function moveOut(state, id) {
  const records = [], plot = plotOf(state, id);
  if (plot) records.push(['f', plot.estate, plot.plot]);
  if (state.residents.has(id)) records.push(['x', id]);
  return { records, plot };
}

/**
 * Housekeeping, a slice at a time: look at the next `budget` residents (in the order they joined)
 * and return the records that remove those not seen since `beforeDay`, with their houses. Called by
 * the service on a timer, never by a request; a whole pass over a full local government is 50 calls.
 */
export function stale(state, beforeDay, budget = 2000) {
  const records = [];
  if (!state.sweep) state.sweep = state.residents.entries();
  for (let i = 0; i < budget; i++) {
    const next = state.sweep.next();
    if (next.done) { state.sweep = null; break; }
    const [id, resident] = next.value;
    if (resident.d < beforeDay) records.push(...moveOut(state, id).records);
  }
  return records;
}

// ---- queries -----------------------------------------------------------------------------------

export const counts = (state) => ({ residents: state.residents.size, houses: state.houseCount, capacity: LGA_CAPACITY, rev: state.rev });
/** Houses per estate for estates [from, from + count): the occupancy summary the map draws density from. */
export function occupancy(state, from = 0, count = ESTATE.estates) {
  const start = Math.max(0, Math.min(ESTATE.estates, from)), end = Math.min(ESTATE.estates, start + Math.max(0, count));
  metrics.steps += end - start;
  return Array.from(state.occ.subarray(start, end));
}

/**
 * One page of an estate's houses, in plot order. A hidden owner's house is listed without its
 * owner: occupied, anonymous. → { page, pages, rev, houses: [{ p, s, u, id?, name? }] }
 */
export function housesPage(state, estate, page = 0, viewerId = null) {
  const pages = Math.ceil(PLOTS_PER_ESTATE / PAGE.houses), at = Math.max(0, Math.min(pages - 1, page));
  const plots = state.houses.get(estate), houses = [];
  for (let plot = at * PAGE.houses; plot < Math.min(PLOTS_PER_ESTATE, (at + 1) * PAGE.houses); plot++) {
    metrics.steps += 1;
    const house = plots?.get(plot);
    if (!house) continue;
    const resident = state.residents.get(house.o), shown = resident && (!resident.h || house.o === viewerId);
    houses.push({ p: plot, s: house.s, u: house.u, ...(shown ? { id: house.o, name: resident.n } : {}) });
  }
  return { page: at, pages, rev: state.stamp[estate], houses };
}

/**
 * One page of the directory, in name order. `q` is a name prefix (folded); `after` is the cursor
 * the previous page returned. Hidden residents are skipped; at most PAGE.scan index entries are
 * looked at, so a run of hidden residents makes a short page, never a long request. The cursor
 * is a position in the index, not a name or an id, so it can never reveal a hidden resident (a
 * resident who joins or leaves between two pages can shift a row by one; nothing is ever repeated
 * across more than that).
 * → { items: [{ id, name, home, estate, plot }], next: cursor | null }
 */
export function directory(state, { q = '', after = null, limit = PAGE.people, viewerId = null } = {}) {
  const prefix = fold(q), items = [], first = index(state, prefix);
  let at = Number.isSafeInteger(after) && after > first ? Math.min(after, state.names.length) : first, scanned = 0;
  for (; at < state.names.length && items.length < limit && scanned < PAGE.scan; at++, scanned++) {
    metrics.steps += 1;
    const key = state.names[at];
    if (prefix && !key.startsWith(prefix)) { at = state.names.length; break; }
    const id = key.slice(key.indexOf(SEP) + 1), resident = state.residents.get(id);
    if (!resident || (resident.h && id !== viewerId)) continue;
    const plot = plotOf(state, id);
    items.push({ id, name: resident.n, home: resident.t, ...(plot ?? {}) });
  }
  const more = at < state.names.length && (!prefix || state.names[at].startsWith(prefix));
  return { items, next: more ? at : null };
}
/** A resident's public line, or null (also null for a hidden resident unless the viewer is that resident). */
export function person(state, id, viewerId = null) {
  metrics.steps += 1;
  const resident = state.residents.get(id);
  if (!resident || (resident.h && id !== viewerId)) return null;
  return { id, name: resident.n, home: resident.t, ...(plotOf(state, id) ?? {}) };
}
