/**
 * OWNER: trust. Under /api/trust/ (server/trust/service.ts keeps the record; the rules are in src/game/trust/).
 *
 *   GET  /api/trust/me                      my tier, my age answer, my complaints, which checks exist, and what I may post
 *   GET  /api/trust/profile/:id             another player's badge: tier, upheld complaints (90 days), held. Never an address.
 *   POST /api/trust/check/:kind/start       kind = phone | id. No provider is configured: { ok: false, code: 'provider_unavailable', reason }
 *   POST /api/trust/report                  { about, reason: scam | fee-request | fake-item | abuse | under-18, note? } → { ok, code, id }
 *
 * Guests may look and report. Only an account may be checked. Banned players are refused before any of this runs.
 * The vendor-link check for venue chat is set here: ctx.checks.vendorLink(db, publicId, room, body).
 */
import { POST_KINDS, TIER_LABELS } from '../../src/game/trust/index.ts';
import type { PostKind, TrustRefusal } from '../../src/game/trust/index.ts';
import { CHECK_WORDS, checkProvider, checkStatus } from '../trust/providers.ts';
import type { CheckKind } from '../trust/providers.ts';
import { trustService } from '../trust/service.ts';
import { UUID_PATTERN } from '../protocol.ts';
import type { RouteContext, RouteHandler, RouteKey } from '../types.ts';

const NO_STORE = { 'Cache-Control': 'no-store' };

export default function trustRoutes(ctx: RouteContext): Record<RouteKey, RouteHandler> {
  const trust = trustService(ctx);
  (ctx.checks ??= {}).vendorLink = (db, publicId, room, body) => trust.vendorLink(db, publicId, room, body);
  const look = (key: string): void => { if (!ctx.allow(key, 60)) throw ctx.fail(429, 'rate_limited'); };

  return {
    'GET /api/trust/me': async (request) => {
      const body = await ctx.store.read((db) => {
        const session = request.requireSession(db);
        look(`trust:look:${session.publicId}`);
        const facts = trust.facts(db, session), mine = trust.complaints(db, session.publicId);
        const can = Object.fromEntries(POST_KINDS.map((kind) => [kind, trust.postBlock(db, session, kind)])) as Record<PostKind, TrustRefusal | null>;
        return { tier: facts.tier, label: TIER_LABELS[facts.tier], adult: facts.adult, complaints: mine.count, held: mine.held, checks: checkStatus(), can };
      });
      return { body, headers: NO_STORE };
    },
    'GET /api/trust/profile/:id': async (request) => {
      const id = String(request.params.id ?? '').toLowerCase();
      if (!UUID_PATTERN.test(id)) throw ctx.fail(400, 'invalid_player');
      const badge = await ctx.store.read((db) => { const session = request.requireSession(db); look(`trust:look:${session.publicId}`); return trust.badge(db, id); });
      if (!badge) throw ctx.fail(404, 'unknown_player');
      return { body: { badge }, headers: NO_STORE };
    },
    'POST /api/trust/check/:kind/start': async (request) => {
      const kind: CheckKind | undefined = (['phone', 'id'] as const).find((item) => item === request.params.kind);
      if (!kind) throw ctx.fail(404, 'unknown_check');
      const { tier, publicId } = await ctx.store.read((db) => { const session = request.requireSession(db); return { tier: trust.tierOf(db, session), publicId: session.publicId }; });
      if (tier === 'guest') return { body: { ok: false, code: 'account_required', reason: 'Claim your account first. Guests cannot be checked.' } };
      const provider = checkProvider(kind);
      if (!provider) return { body: { ok: false, code: 'provider_unavailable', reason: CHECK_WORDS[kind].soon } };
      if (!ctx.allow(`trust:check:${publicId}`, 3, 3600000)) throw ctx.fail(429, 'rate_limited');
      return { body: await provider.start(publicId) };
    },
    'POST /api/trust/report': async (request) => {
      const body = await request.json();
      return { body: await ctx.store.transact((db) => trust.report(db, request.requireSession(db), body)) };
    },
  };
}
