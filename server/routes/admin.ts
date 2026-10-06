/**
 * OWNER: admin
 * THE ADMIN SECTION, under /api/admin/ (docs/ADMIN.md). Not the operator surface: that is /api/mod/ with a bearer token, which is
 * unchanged; the two share the services underneath (reports, mutes, shops, outreach, the notice), never a copy of them.
 *
 * WHO. A signed-in ACCOUNT whose verified address is the founder's or listed in ADMIN_EMAIL_SHA256S, decided on every request
 * (server/admin/gate.ts). Everyone else, a guest included, is answered 404 `not_found` on every route here.
 * LIMITS. Per address (`admin-ip:`), per account for reads and for writes apart (`admin-r:`, `admin-w:`), and a count of refused
 * attempts per address (`admin-fail:`) - all protected limiter keys. Writes need the request to name this host as its origin.
 * EXACTLY ONCE. Every POST carries a `clientId` (`<server ms>:<uuid>`); ctx.once keeps the first result on the admin's own session.
 * AUDIT. Every action that runs writes one line (server/admin/store.ts) in the same transaction as the change.
 * Reads write nothing (they run on a snapshot and the collections they look at are not created by looking).
 *
 *   GET  /api/admin/me                        who I am as an admin, the cities, the tool descriptors, the limits in force
 *   GET  /api/admin/dashboard[?fresh=1]       the dashboard (server/admin/stats.ts), cached 45 s
 *   GET  /api/admin/economy[?fresh=1]         the economy snapshot (a walk over the sessions), cached 10 min
 *   GET  /api/admin/players?q&filter&city&page    search and list
 *   GET  /api/admin/players/:id               one player
 *   POST /api/admin/players/:id/act           { clientId, action, reason?, confirm?, …params }   server/admin/actions.ts
 *   POST /api/admin/world/grant               { clientId, audience, city?, amount, reason, preview?, confirm? }
 *   GET/POST /api/admin/announcements[/:id/cancel]
 *   GET/POST /api/admin/settings              runtime settings (server/admin/settings.ts) and the e-mail / push switches
 *   POST /api/admin/notice                    { clientId, minutes }  the "update is coming" notice from a button (0 ends it)
 *   GET  /api/admin/moderation/reports, POST …/reports/:id/act, GET/POST …/shops, GET/POST …/content
 *   GET  /api/admin/audit?action&admin&target&q&before&limit
 *   GET  /api/admin/tools                     descriptors other features have registered (server/admin/tools.ts)
 */
import { AD_KINDS, liveAds, takeDown } from '../civic/ads.ts';
import { cityOf, emptyCivic } from '../civic/data.ts';
import { removeAnnouncement } from '../civic/elections.ts';
import { liveShoutouts, removeShoutout } from '../civic/radio.ts';
import { businessService } from '../business/service.ts';
import { growthOf } from '../growth/data.ts';
import { outreachService } from '../growth/outreach.ts';
import { moderationService } from '../moderation/service.ts';
import { noticeOf } from '../notice.ts';
import { socialService } from '../social/service.ts';
import { UUID_PATTERN } from '../protocol.ts';
import { DESTRUCTIVE, actionsService, formatNaira, parseAction } from '../admin/actions.ts';
import type { Effects } from '../admin/actions.ts';
import { announceOf } from '../admin/announce.ts';
import { linkFeatures } from '../admin/links.ts';
import { companionService } from '../companion/service.ts';
import { CONTENT_TYPES, PICTURE_LIMITS } from '../social/images.ts';
import { checkConfirm, issueConfirm } from '../admin/confirm.ts';
import { limitsOf, maskEmail } from '../admin/config.ts';
import { accountBudget, addressBudget, adminOf, countFailure, mayAct, notFound, shortRef } from '../admin/gate.ts';
import type { Admin } from '../admin/gate.ts';
import { playersService, FILTERS } from '../admin/players.ts';
import type { PlayerFilter } from '../admin/players.ts';
import { sanctionsOf } from '../admin/sanctions.ts';
import { settingsOf } from '../admin/settings.ts';
import { statsService } from '../admin/stats.ts';
import { audit, peek } from '../admin/store.ts';
import { adminTools } from '../admin/tools.ts';
import { worldService } from '../admin/world.ts';
import type { CityId } from '../../src/types/protocol.ts';
import type { Db, RouteContext, RouteHandler, RouteKey, RouteRequest } from '../types.ts';

const NO_STORE = { 'Cache-Control': 'no-store' };
const REPORT_ACTIONS = ['dismiss', 'warn', 'mute'] as const;

export default function adminRoutes(ctx: RouteContext): Record<RouteKey, RouteHandler> {
  const players = playersService(ctx), actions = actionsService(ctx), stats = statsService(ctx), announce = announceOf(ctx), settings = settingsOf(ctx), sanctions = sanctionsOf(ctx);
  const world = worldService(ctx), moderation = moderationService(ctx), social = socialService(ctx), outreach = outreachService(ctx), shops = businessService(ctx), notice = noticeOf(ctx);
  linkFeatures(ctx);
  ctx.startup?.push(sanctions.load(), announce.load(), settings.load());
  const refuse = (status: number, code: string, reason: string) => Object.assign(ctx.fail(status, code), { reason });

  /**
   * The checks every admin request makes first, before it reads anything of its own. A request that is not an admin's is a 404 and
   * is counted as a refused attempt (except `quiet`, the probe the game makes to decide whether to show the Admin entry).
   */
  async function enter(request: RouteRequest, { write = false, quiet = false }: { write?: boolean; quiet?: boolean } = {}): Promise<Admin> {
    addressBudget(ctx, request);
    const admin = await ctx.store.read((db) => adminOf(ctx, db, request));
    if (!admin) { if (!quiet) countFailure(ctx, request); throw notFound(ctx); }
    accountBudget(ctx, admin, write);
    if (write && request.strictOrigin !== true) throw refuse(403, 'origin_required', 'Admin changes must come from the game page.');
    return admin;
  }
  /** Inside a transaction or a read: the admin again, from the stored records as they are now. */
  const again = (db: Db, request: RouteRequest): Admin => { const admin = adminOf(ctx, db, request); if (!admin) throw notFound(ctx); return admin; };
  const targetOf = (db: Db, id: string) => {
    const session = ctx.core.sessionByPublicId?.(db, id);
    if (!session || !(session.expiresAt > ctx.now())) throw refuse(404, 'unknown_player', 'No live player has that id.');
    return session;
  };
  const publicId = (value: unknown): string => { if (typeof value !== 'string' || !UUID_PATTERN.test(value)) throw ctx.fail(400, 'invalid_player'); return value.toLowerCase(); };
  const read = <T extends object>(handler: (db: Db, admin: Admin, request: RouteRequest) => T, options: { quiet?: boolean } = {}): RouteHandler => async (request) => {
    const admin = await enter(request, { quiet: options.quiet === true });
    return { body: await ctx.store.read((db) => handler(db, again(db, request), request)), headers: NO_STORE, ...(admin ? {} : {}) };
  };
  /** A write: the body, the clientId, one transaction, the receipt, then what the transaction decided to do afterwards. */
  const write = <T extends object>(kind: string, plan: (db: Db, admin: Admin, body: Record<string, unknown>, request: RouteRequest, effects: Effects & { after?: (() => Promise<void> | void)[] }) => { fingerprint: unknown; run: () => T }, { durable = true, before }: { durable?: boolean; before?: (admin: Admin, body: Record<string, unknown>) => Promise<object | null> } = {}): RouteHandler => async (request) => {
    const entered = await enter(request, { write: true });
    const body = await request.json();
    const early = before ? await before(entered, body) : null;
    if (early) return { body: early, headers: NO_STORE };
    const effects: Effects & { after?: (() => Promise<void> | void)[] } = {};
    ctx.onceId(body.clientId);
    const result = await ctx.store.transact((db) => {
      const admin = again(db, request), made = plan(db, admin, body, request, effects);
      return ctx.once(db, admin.session, { id: body.clientId as string, kind: `admin.${kind}`, fingerprint: made.fingerprint }, () => ({ ...made.run() }));
    }, { durable });
    stats.invalidate();
    await actions.finish(effects);
    for (const step of effects.after ?? []) await step();
    return { body: result, headers: NO_STORE };
  };
  const canon = (value: unknown): string => JSON.stringify(value);
  /**
   * A change to a picture or to a player's picture-sending: the same steps as the operator's route, so the bytes of a removed picture leave the
   * image store after the commit and the people in the chat are told. Both changes can be repeated without harm, so no receipt is kept.
   */
  const pictureWrite = (plan: (db: Db, admin: Admin, body: Record<string, unknown>, request: RouteRequest) => object): RouteHandler => async (request) => {
    await enter(request, { write: true });
    const body = await request.json();
    ctx.onceId(body.clientId);
    const result = await ctx.store.transact((db) => social.finish(db, plan(db, again(db, request), body, request)), { committed: (value) => social.committed(value) });
    stats.invalidate();
    return { body: social.deliver(result) ?? {}, headers: NO_STORE };
  };

  return {
    // The probe the game makes once a signed-in account is known: 404 for everyone who is not an admin, and it is not counted as an attempt.
    'GET /api/admin/me': read((db, admin) => ({ admin: true, level: admin.root ? 'root' : 'admin', name: admin.name, ref: shortRef(admin.accountId), cities: ctx.cityIds, tools: adminTools(ctx), limits: { ...limitsOf(ctx) },
      email: maskEmail(db.accounts?.[admin.accountId]?.email) }), { quiet: true }),
    'GET /api/admin/dashboard': read((db, _admin, request) => stats.dashboard(db, request.query.get('fresh') === '1')),
    'GET /api/admin/economy': read((db, _admin, request) => stats.economy(db, request.query.get('fresh') === '1')),
    'GET /api/admin/tools': read(() => ({ tools: adminTools(ctx) })),

    'GET /api/admin/players': read((db, _admin, request) => {
      const filter = FILTERS.find((item) => item === request.query.get('filter')) ?? 'all' as PlayerFilter, city = ctx.cityIds.find((id) => id === request.query.get('city')) ?? '';
      return players.list(db, { q: request.query.get('q') ?? '', filter, city, page: Number(request.query.get('page')) || 0 });
    }),
    'GET /api/admin/players/:id': read((db, _admin, request) => {
      const found = players.detail(db, publicId(request.params.id));
      if (!found) throw refuse(404, 'unknown_player', 'No live player has that id.');
      return found;
    }),

    'POST /api/admin/players/:id/act': async (request) => {
      const admin = await enter(request, { write: true });
      const body = await request.json(), id = publicId(request.params.id);
      const parsed = parseAction(ctx, body.action, body);
      ctx.onceId(body.clientId);
      if (DESTRUCTIVE.has(parsed.action)) {
        const bound = canon([parsed.params, parsed.reason]);
        if (!(await checkConfirm(ctx, body.confirm, admin.accountId, parsed.action, id, bound))) {
          // The first request of a destructive action changes nothing: it checks the target and answers a token for the second.
          const named = await ctx.store.read((db) => { const caller = again(db, request), target = targetOf(db, id); mayAct(ctx, db, caller, target); return target.name; });
          const issued = await issueConfirm(ctx, admin.accountId, parsed.action, id, bound);
          return { body: { ok: false, code: 'confirmation_required', ...issued, summary: `${parsed.action} ${named}` }, headers: NO_STORE };
        }
      }
      const effects: Effects = {};
      const result = await ctx.store.transact((db) => {
        const caller = again(db, request), target = targetOf(db, id);
        return ctx.once(db, caller.session, { id: body.clientId as string, kind: `admin.${parsed.action}`, fingerprint: [id, parsed.action, parsed.params, parsed.reason] }, () => ({ ...actions.run(db, caller, target, parsed, effects) }));
      });
      stats.invalidate();
      await actions.finish(effects);
      return { body: result, headers: NO_STORE };
    },

    'POST /api/admin/world/grant': async (request) => {
      const admin = await enter(request, { write: true });
      const body = await request.json(), input = world.parse(body);
      ctx.onceId(body.clientId);
      const preview = await ctx.store.read((db) => { again(db, request); return world.preview(db, input); });
      if (body.preview === true) return { body: { ok: false, code: 'preview', ...preview, summary: `${preview.count} players, ${formatNaira(preview.total)} in all` }, headers: NO_STORE };
      if (preview.needsConfirmation) {
        const bound = canon([input.audience, input.city, input.amount, input.reason]);
        if (!(await checkConfirm(ctx, body.confirm, admin.accountId, 'grant', input.audience, bound))) {
          const issued = await issueConfirm(ctx, admin.accountId, 'grant', input.audience, bound);
          return { body: { ok: false, code: 'confirmation_required', ...issued, summary: `Give ${formatNaira(input.amount)} to ${preview.count} players (${formatNaira(preview.total)} in all)`, players: preview.count, total: preview.total }, headers: NO_STORE };
        }
      }
      const effects: Effects = {};
      const result = await ctx.store.transact((db) => {
        const caller = again(db, request);
        return ctx.once(db, caller.session, { id: body.clientId as string, kind: 'admin.grant', fingerprint: [input.audience, input.city, input.amount, input.reason] }, () => ({ ...world.run(db, caller, input, effects) }));
      });
      stats.invalidate();
      await actions.finish(effects);
      return { body: result, headers: NO_STORE };
    },

    'GET /api/admin/announcements': read((db) => ({ announcements: announce.list(db), limits: { title: 60, body: 240, confirmAbove: limitsOf(ctx).mailConfirmAbove }, actions: ['map', 'missions', 'business', 'invite'] })),
    'POST /api/admin/announcements': async (request) => {
      await enter(request, { write: true });
      const body = await request.json();
      ctx.onceId(body.clientId);
      if (body.preview === true) {
        const audience = body.audience === 'city' || body.audience === 'online' ? body.audience : 'everyone', city = ctx.cityIds.find((id) => id === body.city) ?? null;
        const counted = await ctx.store.read((db) => { again(db, request); return announce.preview(db, { audience, city }); });
        return { body: { ok: false, code: 'preview', ...counted }, headers: NO_STORE };
      }
      let sendNow: ReturnType<typeof announce.create> | null = null;
      const result = await ctx.store.transact((db) => {
        const caller = again(db, request);
        return ctx.once(db, caller.session, { id: body.clientId as string, kind: 'admin.announce', fingerprint: [body.title, body.body, body.audience, body.city, body.action, body.at, body.expiresAt, body.push, body.email] }, () => {
          const made = announce.create(db, caller, body);
          sendNow = made;
          audit(ctx, db, { admin: caller.accountId, adminName: caller.name, action: 'announce', target: made.record.id, targetName: made.record.title, params: { audience: made.record.audience, city: made.record.city, push: made.record.mail.push, email: made.record.mail.email, scheduled: made.record.sentAt === 0 }, summary: `Announcement “${made.record.title}” ${made.send ? 'sent now' : 'scheduled'} for ${made.record.audience === 'city' ? made.record.city : made.record.audience}${made.record.mail.wanted ? `; e-mail/push to ${made.record.mail.total}` : ''}`, reason: '' });
          return { ok: true, code: made.send ? 'sent' : 'scheduled', id: made.record.id, recipients: made.record.mail.total };
        });
      });
      const made = sendNow as ReturnType<typeof announce.create> | null;
      if (made) { announce.sync(made.items); if (made.send) await announce.went(made.record); }
      stats.invalidate();
      return { body: result, headers: NO_STORE };
    },
    'POST /api/admin/announcements/:id/cancel': async (request) => {
      await enter(request, { write: true });
      const body = await request.json();
      ctx.onceId(body.clientId);
      let after: ReturnType<typeof announce.cancel> | null = null;
      const result = await ctx.store.transact((db) => {
        const caller = again(db, request);
        return ctx.once(db, caller.session, { id: body.clientId as string, kind: 'admin.announce-cancel', fingerprint: [request.params.id] }, () => {
          const done = announce.cancel(db, String(request.params.id));
          after = done;
          if (done.changed) audit(ctx, db, { admin: caller.accountId, adminName: caller.name, action: 'announce-cancel', target: done.record.id, targetName: done.record.title, params: {}, summary: `Announcement “${done.record.title}” ended`, reason: '' });
          return { ok: true, code: done.changed ? 'cancelled' : 'already_ended', id: done.record.id };
        });
      });
      const done = after as ReturnType<typeof announce.cancel> | null;
      if (done) announce.sync(done.items);
      return { body: result, headers: NO_STORE };
    },

    'GET /api/admin/settings': read((db) => ({ settings: settings.list(db), switches: { email: db.growth?.outreach?.off.email === true, push: db.growth?.outreach?.off.push === true }, notice: notice.frame() })),
    'POST /api/admin/settings': write('setting', (db, admin, body, _request, effects) => {
      const key = String(body.key ?? '');
      return { fingerprint: [key, body.value], run: () => {
        // The two kill switches already exist under the operator surface: this is the same function.
        if (key === 'emailOff' || key === 'pushOff') {
          if (typeof body.value !== 'boolean') throw ctx.fail(400, 'invalid_value');
          const channel = key === 'emailOff' ? 'email' : 'push', before = db.growth?.outreach?.off[channel] === true;
          outreach.setSwitch(growthOf(ctx, db), channel, body.value);
          const line = audit(ctx, db, { admin: admin.accountId, adminName: admin.name, action: 'setting', target: key, targetName: key, params: { value: body.value }, summary: `${channel} sending ${before ? 'off' : 'on'} → ${body.value ? 'off' : 'on'}`, reason: '' });
          return { ok: true, code: 'changed', summary: line.summary, line: line.n };
        }
        const changed = settings.change(db, key, body.value, shortRef(admin.accountId));
        effects.after = [...(effects.after ?? []), () => settings.sync(changed.values)];
        const line = audit(ctx, db, { admin: admin.accountId, adminName: admin.name, action: 'setting', target: key, targetName: key, params: { value: body.value === null ? 'default' : (body.value as boolean | number) }, summary: `${key}: ${String(changed.before)} → ${String(changed.after)}`, reason: '' });
        return { ok: true, code: 'changed', summary: line.summary, line: line.n };
      } };
    }, { before: async (admin, body) => {
      // A setting that is risky to turn on (pictures in chat) answers a token first; the second request carries it back.
      const item = settings.descriptors().get(String(body.key ?? ''));
      if (!item?.confirmOn || body.value !== true) return null;
      const bound = canon([item.key, true]);
      if (await checkConfirm(ctx, body.confirm, admin.accountId, 'setting', item.key, bound)) return null;
      return { ok: false, code: 'confirmation_required', ...(await issueConfirm(ctx, admin.accountId, 'setting', item.key, bound)), summary: `Turn on: ${item.label}` };
    } }),
    'POST /api/admin/notice': write('notice', (db, admin, body, _request, effects) => ({ fingerprint: [body.minutes], run: () => {
      const minutes = body.minutes;
      if (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes < 0 || minutes > 15) throw refuse(400, 'invalid_notice', 'Use 1 to 15 minutes, or 0 to end the notice.');
      // The notice is held in memory and sent to the open sockets once the change is saved, like the signed announcer's.
      effects.after = [() => { if (minutes === 0) notice.stop(); else notice.start(minutes); }];
      const line = audit(ctx, db, { admin: admin.accountId, adminName: admin.name, action: 'notice', target: 'update', targetName: 'Update is coming', params: { minutes }, summary: minutes ? `"Update is coming" notice for ${minutes} minutes` : '"Update is coming" notice ended', reason: '' });
      return { ok: true, code: minutes ? 'started' : 'stopped', summary: line.summary, line: line.n };
    } })),

    'GET /api/admin/moderation/reports': read((db, _admin, request) => {
      const status = request.query.get('status') ?? 'open', allowed = ['open', 'all', 'received', 'dismissed', 'actioned'];
      if (!allowed.includes(status)) throw ctx.fail(400, 'invalid_status');
      const reports = social.modReports(db, status, 100).map((report) => ({ ...report, by: undefined, about: report.about, byName: report.byName, aboutKnown: social.modKnows(db, report.about) }));
      return { reports, counts: social.modReportCounts(db), problems: db.support?.reports.filter((item) => item.status === 'received').length ?? 0 };
    }),
    'POST /api/admin/moderation/reports/:id/act': write('report', (db, admin, body, request, effects) => ({ fingerprint: [request.params.id, body.action, body.note, body.minutes], run: () => {
      const action = REPORT_ACTIONS.find((item) => item === body.action);
      if (!action) throw ctx.fail(400, 'unknown_action');
      const note = typeof body.note === 'string' ? body.note.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
      const reportId = String(request.params.id ?? ''), report = (db.social?.reports ?? []).find((item) => item.id === reportId);
      if (!report) throw ctx.fail(404, 'unknown_report');
      const target = ctx.core.sessionByPublicId?.(db, report.about);
      if (target) mayAct(ctx, db, admin, target);
      let status: 'dismissed' | 'actioned' = 'actioned', text = note;
      if (action === 'dismiss') status = 'dismissed';
      if (action === 'warn') {
        if (!note) throw refuse(400, 'reason_required', 'Write the warning.');
        if (social.modKnows(db, report.about)) (effects.push ??= []).push(...social.modNote(db, report.about, `A moderator is warning you: ${note}`).push);
        text = `Warned: ${note}`;
      }
      if (action === 'mute') {
        const minutes = body.minutes;
        if (typeof minutes !== 'number' || !Number.isSafeInteger(minutes) || minutes < 1 || minutes > 43200 || note.length < 3) throw refuse(400, 'reason_required', 'Give the minutes and a reason.');
        const done = moderation.mute(db, { id: report.about, minutes, reason: note, report: reportId }, 'admin');
        effects.mutes = done.mutes;
        if (social.modKnows(db, report.about)) (effects.push ??= []).push(...social.modNote(db, report.about, `A moderator has muted you for ${minutes} minutes: ${note}. You can keep playing; you cannot post text until it ends.`).push);
        text = `Muted for ${minutes} minutes.`;
      }
      const changed = social.modSetReport(db, reportId, status, text);
      if (changed) (effects.push ??= []).push(...changed.push);
      const line = audit(ctx, db, { admin: admin.accountId, adminName: admin.name, action: `report-${action}`, target: report.about, targetName: report.aboutName, params: { report: reportId }, summary: `Report ${reportId} ${action === 'dismiss' ? 'dismissed' : action === 'warn' ? 'answered with a warning' : 'answered with a mute'}`, reason: note });
      return { ok: true, code: status, summary: line.summary, line: line.n };
    } })),

    'GET /api/admin/moderation/shops': read((db) => shops.modReports(db)),
    'POST /api/admin/moderation/shops/act': write('shop', (db, admin, body, _request, effects) => ({ fingerprint: [body.shop, body.action, body.reason], run: () => {
      const push: [string, unknown][] = [], reason = typeof body.reason === 'string' ? body.reason.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
      const done = body.action === 'close' ? shops.modClose(db, body.shop, push) : body.action === 'rename' ? shops.modRename(db, body.shop, push) : (() => { throw ctx.fail(400, 'unknown_action'); })();
      if (!done) throw ctx.fail(404, 'unknown_shop');
      const name = 'name' in done ? done.name : done.old;
      moderation.audit(db, `shop-${String(body.action)}`, done.by.id, `${name}${reason ? ` · ${reason}` : ''}`, 'admin');
      effects.after = [() => shops.deliver(push)];
      const line = audit(ctx, db, { admin: admin.accountId, adminName: admin.name, action: `shop-${String(body.action)}`, target: done.by.id, targetName: done.by.name, params: { shop: String(body.shop) }, summary: `Shop “${name}” ${body.action === 'close' ? 'closed' : 'renamed to a plain name'}`, reason });
      return { ok: true, code: String(body.action), summary: line.summary, line: line.n };
    } })),

    'GET /api/admin/moderation/content': read((db, _admin, request) => {
      const cityId = ctx.cityIds.find((id) => id === request.query.get('city'));
      if (!cityId) throw ctx.fail(400, 'invalid_city');
      const city = cityOf(ctx.collection(db, 'civic', emptyCivic()), cityId);
      return { city: cityId, ads: liveAds(city, ctx.now()), radio: liveShoutouts(city, ctx.now()), announcements: city.gov.announcements.map((item) => ({ id: item.id, text: item.text, by: { id: item.by.id, name: item.by.name }, at: item.at })) };
    }),
    'POST /api/admin/moderation/content/remove': write('content', (db, admin, body, _request, effects) => ({ fingerprint: [body.cityId, body.kind, body.slot, body.id, body.venue], run: () => {
      const cityId = ctx.cityIds.find((id): id is CityId => id === body.cityId);
      if (!cityId) throw ctx.fail(400, 'invalid_city');
      const city = cityOf(ctx.collection(db, 'civic', emptyCivic()), cityId), reason = typeof body.reason === 'string' ? body.reason.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
      let removed: { by: { id: string; name: string }; text?: string; title?: string } | null = null, what = '';
      if (AD_KINDS.some((item) => item === body.kind)) { removed = takeDown(city, ctx.now(), body.kind, body.slot); what = `your ${body.kind === 'sea' ? 'sea plot' : 'billboard'} ad “${removed?.text}”`; }
      else if (body.kind === 'announcement') { removed = typeof body.id === 'string' ? removeAnnouncement(city, body.id) : null; what = `your announcement “${removed?.text}”`; }
      else if (body.kind === 'radio') { removed = typeof body.venue === 'string' && typeof body.id === 'string' && Object.hasOwn(city.radio.queues, body.venue) ? removeShoutout(city, body.venue, body.id) : null; what = `your shout-out “${removed?.title}”`; }
      else throw ctx.fail(400, 'invalid_kind');
      if (!removed) throw ctx.fail(404, 'nothing_to_remove');
      const label = removed.text ?? removed.title ?? '';
      moderation.audit(db, `remove-${String(body.kind)}`, `${cityId}:${String(body.slot ?? body.id)}`, `${label} · by ${removed.by.id}${reason ? ` · ${reason}` : ''}`, 'admin');
      if (social.modKnows(db, removed.by.id)) (effects.push ??= []).push(...social.modNote(db, removed.by.id, `A moderator removed ${what}${reason ? `: ${reason}` : ''}. What you paid for it is not refunded.`).push);
      const line = audit(ctx, db, { admin: admin.accountId, adminName: admin.name, action: 'content-remove', target: removed.by.id, targetName: removed.by.name, params: { city: cityId, kind: String(body.kind) }, summary: `Removed ${String(body.kind)} “${label}”`, reason });
      return { ok: true, code: 'removed', summary: line.summary, line: line.n };
    } })),

    // Pictures in chat that were reported, hidden or removed: the operator's own service functions (server/social/service.ts) under the admin guard.
    'GET /api/admin/moderation/pictures': read((db) => social.modPictures(db)),
    'GET /api/admin/moderation/pictures/:id': async (request) => {
      await enter(request);
      const id = request.params.id ?? '', found = ctx.images && PICTURE_LIMITS.idPattern.test(id) ? await ctx.images.get(id) : null;
      if (!found) throw ctx.fail(404, 'unknown_picture');
      return { file: { bytes: found.bytes, type: CONTENT_TYPES[found.image.type] } };
    },
    'POST /api/admin/moderation/pictures/:id/act': pictureWrite((db, admin, body, request) => {
      const action = body.action, id = request.params.id ?? '';
      if (action !== 'remove' && action !== 'restore') throw ctx.fail(400, 'invalid_action');
      if (!PICTURE_LIMITS.idPattern.test(id)) throw ctx.fail(400, 'invalid_image');
      const result = social.modPicture(db, id, action);
      if (result.ok) {
        moderation.audit(db, `picture-${action}`, id, '', 'admin');
        audit(ctx, db, { admin: admin.accountId, adminName: admin.name, action: `picture-${action}`, target: id, targetName: 'picture', params: {}, summary: `Picture ${action === 'remove' ? 'removed' : 'restored'}`, reason: '' });
      }
      return { ...result };
    }),
    'POST /api/admin/moderation/pictures/player': pictureWrite((db, admin, body) => {
      if (typeof body.allowed !== 'boolean') throw ctx.fail(400, 'invalid_action');
      const id = publicId(body.player), result = social.modPictureBan(db, id, !body.allowed);
      if (result.ok) {
        moderation.audit(db, body.allowed ? 'picture-allow' : 'picture-ban', id, '', 'admin');
        audit(ctx, db, { admin: admin.accountId, adminName: admin.name, action: body.allowed ? 'picture-allow' : 'picture-ban', target: id, targetName: 'player', params: {}, summary: `Picture-sending ${body.allowed ? 'allowed again' : 'stopped'} for one player`, reason: '' });
      }
      return { ...result };
    }),
    // One tiny request to the language-model gateway: the function behind POST /api/mod/companion-test.
    'POST /api/admin/companion/test': async (request) => {
      await enter(request, { write: true });
      if (!ctx.allow('admin:companion-test', 6, 600000)) throw ctx.fail(429, 'rate_limited');
      return { body: await companionService(ctx).selfTest(), headers: NO_STORE };
    },

    'GET /api/admin/audit': read((db, _admin, request) => {
      const q = request.query, action = q.get('action') ?? '', admin = q.get('admin') ?? '', target = q.get('target') ?? '', text = (q.get('q') ?? '').toLowerCase().slice(0, 80);
      const before = Number(q.get('before')) || Infinity, limit = Math.min(500, Math.max(1, Number(q.get('limit')) || 100));
      const log = peek(db, 'adminAudit');
      const all = log.lines.filter((line) => line.n < before && (!action || line.action === action) && (!admin || shortRef(line.admin) === admin) && (!target || line.target === target)
        && (!text || `${line.summary} ${line.reason} ${line.targetName} ${line.adminName}`.toLowerCase().includes(text)));
      const page = all.slice(-limit).reverse(), last = page.at(-1);
      return { lines: page.map((line) => ({ ...line, admin: shortRef(line.admin) })), total: all.length, next: all.length > page.length && last ? last.n : null, totals: log.totals, kept: log.lines.length };
    }),
  };
}
