/**
 * OWNER: politics
 * The public record's two routes. Open to anyone, signed in or not: the record is the world's, and nothing in it is private (names and counts only).
 *
 *   GET /api/world/records?scope=&kind=&before=&limit=   { entries, before, head, count }   newest first; `before` is the entry number to go back from
 *   GET /api/world/records/proof                           { algorithm, count, head, genesis, how }   the hash that seals the chain so far
 * Each entry carries `prev` and `hash`; src/records/chain.ts checks a list of them, in the page and anywhere else.
 */
import { GENESIS } from '../../src/records/chain.ts';
import type { RecordKind } from '../../src/types/records.ts';
import { page, peekRecords } from '../records/store.ts';
import type { RouteContext, RouteHandler, RouteKey } from '../types.ts';

const KINDS: readonly RecordKind[] = ['term', 'impeachment', 'ruling', 'party', 'operator', 'law'];
const SCOPE = /^(city|state|nation):[a-z0-9-]{1,40}$|^world$/;

export default function recordsRoutes(ctx: RouteContext): Record<RouteKey, RouteHandler> {
  const { store, fail } = ctx;
  const limit = (request: { ip: string }): void => { if (!ctx.allow(`records:${request.ip}`, 120)) throw fail(429, 'records_rate_limited'); };
  const whole = (value: string | null, fallback: number, min: number, max: number): number => {
    if (value === null || value === '') return fallback;
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n < min || n > max) throw fail(400, 'invalid_query');
    return n;
  };
  return {
    'GET /api/world/records': async (request) => {
      limit(request);
      const scope = request.query.get('scope') ?? undefined, kind = request.query.get('kind') ?? undefined;
      if (scope !== undefined && !SCOPE.test(scope)) throw fail(400, 'invalid_query');
      const chosen = kind === undefined ? undefined : KINDS.find((item) => item === kind);
      if (kind !== undefined && !chosen) throw fail(400, 'invalid_query');
      const before = request.query.get('before') === null ? undefined : whole(request.query.get('before'), 0, 1, Number.MAX_SAFE_INTEGER), size = whole(request.query.get('limit'), 30, 1, 100);
      const body = await store.read((db) => {
        const records = peekRecords(db), found = page(records, { ...(before !== undefined ? { before } : {}), limit: size, ...(scope ? { scope } : {}), ...(chosen ? { kind: chosen } : {}) });
        return { entries: found.entries, before: found.before, head: records.head, count: records.seq };
      });
      return { body, headers: { 'Cache-Control': 'public, max-age=30' } };
    },
    'GET /api/world/records/proof': async (request) => {
      limit(request);
      const body = await store.read((db) => { const records = peekRecords(db); return { algorithm: 'sha256' as const, count: records.seq, head: records.head, genesis: GENESIS, how: 'Each entry’s hash is the SHA-256 of the previous hash and the entry’s own facts. Change or remove any entry and every hash after it changes.' }; });
      return { body, headers: { 'Cache-Control': 'public, max-age=30' } };
    },
  };
}
