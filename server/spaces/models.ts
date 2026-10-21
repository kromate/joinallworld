import { requireSharingTerms } from '../sharing-policy.ts'
/**
 * OWNER: spaces
 * PLAYERS' 3D MODELS (docs/SPACES-3D.md, phase 1): a player uploads a .glb, the server checks it byte by byte (src/spaces/glb.ts),
 * keeps the bytes once per content hash (ctx.models: files on Node, R2 on the Worker) and the facts in `spaces.models`.
 * Nothing in a model file is ever run. A model shows only in its owner's spaces; anyone who can see such a space can fetch it.
 *
 *   spaces.models[publicId]   ModelEntry[]   at most MODELS.perPlayer, MODELS.bytesPerPlayer in all
 *   spaces.modelTrash         string[]       hashes that may have lost their last owner; the heartbeat deletes the bytes of each
 *                                            one no entry names any more
 *
 * Who may upload: a player with an account (not a guest) whose listings are not held, while the operator setting `spacesModels`
 * is on and the host has storage. Three reports hide a model until an operator looks (GET/POST /api/mod/spaces/models).
 *
 * A whole house (docs/HOUSE-FROM-PHOTOS.md): `?house=1` takes the bigger HOUSE_GLB_LIMITS; a player keeps one, and a new one replaces it.
 * A one-time upload link (POST /api/spaces/models/upload-link) lets a player's own AI send a model without the browser's cookie:
 *   spaces.links[token]   { by, name, house, use, exp }   ten minutes, one model; erased with the player
 */
import { checkGlb, GLB_LIMITS, HOUSE_GLB_LIMITS, type GlbInfo } from '../../src/spaces/glb.ts';
import { oneLine } from '../../src/spaces/plan.ts';
import { MODELS, type ModelView } from '../../src/types/spaces.ts';
import { registerAdminSetting } from '../admin/settings.ts';
import { screenText } from '../moderation/text.ts';
import { trustService } from '../trust/service.ts';
import { forgetPlacements, spacesOf, type ModelEntry } from './store.ts';
import type { Db, RouteContext, RouteRequest, SessionRecord } from '../types.ts';

const no = (code: string, reason: string) => ({ ok: false as const, code, reason });
const ID = /^m[0-9a-z]{9}$/;
const HASH = /^[0-9a-f]{64}$/;
export const MODEL_TYPES = Object.freeze(['model/gltf-binary', 'application/octet-stream']);

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
/** A world's cover shares the store with the models: its hash stays out of the sweep (server/spaces/worlds.ts). */
const covers = (col: { worlds?: Record<string, { cover?: string }> } | undefined): string[] => Object.values(col?.worlds ?? {}).flatMap((w) => (w.cover ? [w.cover] : []));
export function modelView(entry: ModelEntry, by: string): ModelView {
  return { id: entry.id, by, name: entry.name, hash: entry.hash, bytes: entry.bytes, triangles: entry.tris, textures: entry.tex, size: entry.size, min: entry.min, animations: entry.anims, skinned: entry.skinned === true, hidden: entry.hidden === true, at: entry.at };
}

const services = new WeakMap<RouteContext, ReturnType<typeof build>>();
export function modelsService(ctx: RouteContext): ReturnType<typeof build> {
  const found = services.get(ctx);
  if (found) return found;
  const made = build(ctx);
  services.set(ctx, made);
  return made;
}

function build(ctx: RouteContext) {
  registerAdminSetting(ctx, { key: 'spacesModels', label: 'Players upload 3D models', help: 'Players with an account may upload their own .glb models (at most 30 each, 20 MB and 200,000 triangles a model) and place them in their own spaces (docs/SPACES-3D.md). Off until an operator turns it on.', kind: 'boolean', default: () => false });
  const trust = trustService(ctx);
  const on = (): boolean => ctx.checks?.setting?.('spacesModels') === true;
  const ready = (): boolean => Boolean(ctx.models);
  const listOf = (db: Db, id: string): ModelEntry[] => {
    const all = (db as { spaces?: { models?: Record<string, ModelEntry[]> } }).spaces?.models;
    return all && Object.hasOwn(all, id) && Array.isArray(all[id]) ? all[id]! : [];
  };
  const totalBytes = (list: readonly ModelEntry[]): number => list.reduce((sum, m) => sum + m.bytes, 0);
  const newId = (): string => `m${ctx.randomId().replace(/[^0-9a-z]/gi, '').toLowerCase().slice(-9).padStart(9, '0')}`;

  /** Who may upload, and why not. */
  function refusal(db: Db, session: SessionRecord): ReturnType<typeof no> | null {
    if (!on()) return no('models_off', 'Uploading 3D models is not switched on yet.');
    if (!ready()) return no('not_ready', 'Model uploads are not ready on this server yet. Try again later.');
    if (trust.tierOf(db, session) === 'guest') return no('account_required', 'Sign in to upload your own 3D models.');
    if (trust.complaints(db, session.publicId).held) return no('held', 'Uploads are paused on your account while reports are reviewed.');
    return null;
  }
  const cleanName = (value: unknown): { name: string } | ReturnType<typeof no> => {
    const name = oneLine(value, MODELS.name).replace(/\.glb$/i, '').trim()
    if (!name) return no('invalid_name', 'Give the model a name.');
    const blocked = screenText(name, { contact: true, what: 'The model name' });
    return blocked ? no(blocked.code, blocked.reason) : { name };
  };

  /** Forget bytes no model names any more. Runs on the heartbeat; a failure keeps the hash for the next one. */
  let sweeping = false;
  async function sweep(): Promise<void> {
    if (sweeping || !ctx.models) return;
    sweeping = true;
    try {
      const orphans = await ctx.store.read((db) => {
        const col = (db as { spaces?: { models?: Record<string, ModelEntry[]>; modelTrash?: string[]; worlds?: Record<string, { cover?: string }> } }).spaces;
        const trash = col?.modelTrash ?? [];
        if (!trash.length) return null;
        const named = new Set([...Object.values(col?.models ?? {}).flatMap((list) => list.map((m) => m.hash)), ...covers(col)]);
        return trash.filter((hash) => !named.has(hash)).slice(0, 50);
      });
      if (!orphans) return;
      if (orphans.length) await ctx.models.remove(orphans);
      await ctx.store.transact((db) => {
        const col = spacesOf(db);
        const named = new Set([...Object.values(col.models ?? {}).flatMap((list) => list.map((m) => m.hash)), ...covers(col)]);
        const gone = new Set(orphans);
        // A hash named again since the read stays; one that was deleted, or is named, leaves the list.
        col.modelTrash = (col.modelTrash ?? []).filter((hash) => !gone.has(hash) && !named.has(hash)).slice(0, 10_000);
        if (!col.modelTrash.length) delete col.modelTrash;
      }, { durable: false });
    } finally { sweeping = false; }
  }
  ctx.on?.('heartbeat', () => { void sweep().catch(() => {}); });

  const methods = {
    /** GET /api/spaces/models */
    mine(db: Db, session: SessionRecord) {
      const list = listOf(db, session.publicId);
      const why = refusal(db, session);
      return { ok: true as const, code: 'ok' as const, on: on(), ready: ready(), canUpload: !why, why: why?.reason ?? null, models: list.map((m) => modelView(m, session.publicId)), used: { count: list.length, bytes: totalBytes(list) }, limits: { count: MODELS.perPlayer, bytes: MODELS.bytesPerPlayer, file: GLB_LIMITS.bytes, triangles: GLB_LIMITS.triangles } };
    },
    /** POST /api/spaces/models?name=…  (the body is the .glb itself) */
    async upload(request: RouteRequest) {
      const session = await ctx.store.read((db) => request.requireSession(db));
      const named = cleanName(request.query.get('name'));
      if ('ok' in named) return named;
      return store(session, named.name, request, request.query.get('house') === '1');
    },
    /** POST /api/spaces/models/upload-link { name, house?, use? }: a one-time address the player's own AI sends one model to. */
    uploadLink(db: Db, session: SessionRecord, body: Record<string, unknown>) {
      const first = refusal(db, session);
      if (first) return first;
      const named = cleanName(body['name']);
      if ('ok' in named) return named;
      if (!ctx.allow(`spaces:upload-link:${session.publicId}`, 20, 3_600_000)) return no('rate_limited', 'Too many upload links. Wait a while.');
      const col = spacesOf(db), now = ctx.now();
      const links = col.links ??= {};
      for (const [token, link] of Object.entries(links)) if (link.exp <= now) delete links[token];
      const token = ctx.randomId().replace(/[^0-9a-z]/gi, '') + ctx.randomId().replace(/[^0-9a-z]/gi, '');
      const house = body['house'] === true || body['use'] === 'house';
      links[token] = { by: session.publicId, name: named.name, house, use: body['use'] === 'house' ? 'house' : 'model', exp: now + 600_000 };
      return { ok: true as const, code: 'ok' as const, url: `/api/spaces/models/upload/${token}`, expires: now + 600_000, limits: house ? { bytes: HOUSE_GLB_LIMITS.bytes, triangles: HOUSE_GLB_LIMITS.triangles } : { bytes: GLB_LIMITS.bytes, triangles: GLB_LIMITS.triangles } };
    },
    /** POST /api/spaces/models/upload/:token (the .glb, no cookie): the upload the link was made for, once. */
    async uploadByLink(request: RouteRequest, setHouse: (db: Db, by: string, id: string) => void) {
      const token = request.params['token'] ?? '';
      const found = await ctx.store.read((db) => {
        const link = /^[0-9a-z]{16,80}$/i.test(token) ? spacesOf(db).links?.[token] : undefined;
        if (!link || link.exp <= ctx.now()) return null;
        const session = ctx.core.sessionByPublicId(db, link.by);
        if (session) requireSharingTerms(ctx, db, session);
        return session ? { link, session } : null;
      });
      if (!found) throw ctx.fail(404, 'unknown_link');
      const result = await store(found.session, found.link.name, request, found.link.house);
      if (result.ok) await ctx.store.transact((db) => {
        const links = spacesOf(db).links;
        if (links) delete links[token];
        if (found.link.use === 'house') setHouse(db, found.link.by, result.model.id);
      });
      return result;
    },
  };

  /** Keep one uploaded model for `session`: checked, stored by hash, listed. A house replaces the player's last house. */
  async function store(session: SessionRecord, name: string, request: RouteRequest, house: boolean) {
    {
      const first = await ctx.store.read((db) => refusal(db, session));
      if (first) return first;
      if (!ctx.allow(`spaces:model-upload:${session.publicId}`, MODELS.uploadsPerHour, 3_600_000)) return no('rate_limited', `You can upload ${MODELS.uploadsPerHour} models an hour. Try again later.`);
      const named = { name };
      if (!request.binaryBody) return no('not_ready', 'Model uploads are not ready on this server yet.');
      const limits = house ? HOUSE_GLB_LIMITS : GLB_LIMITS;
      const bytes = await request.binaryBody(limits.bytes, MODEL_TYPES);
      const checked = checkGlb(bytes, limits);
      if (!checked.ok) return no(checked.code, checked.reason);
      const hash = await sha256(bytes);
      const room = await ctx.store.read((db) => {
        const list = listOf(db, session.publicId);
        const same = list.find((m) => m.hash === hash);
        if (same) return { same };
        if (list.length >= MODELS.perPlayer) return no('too_many', `You have ${list.length} models, the most you can keep. Delete one first.`);
        if (totalBytes(list) + bytes.byteLength > MODELS.bytesPerPlayer) return no('no_space', `Your models would use more than ${MODELS.bytesPerPlayer / 1e6} MB. Delete one first.`);
        return null;
      });
      if (room && 'same' in room) return { ok: true as const, code: 'already' as const, model: modelView(room.same, session.publicId) };
      if (room) return room;
      // The bytes first (a second upload of the same file writes the same object), then the facts.
      await ctx.models!.put(hash, bytes);
      const info: GlbInfo = checked.info;
      const result = await ctx.store.transact((db) => {
        const col = spacesOf(db);
        col.models ??= {};
        const list = col.models[session.publicId] ??= [];
        const again = refusal(db, session);
        const full = list.length >= MODELS.perPlayer || totalBytes(list) + bytes.byteLength > MODELS.bytesPerPlayer;
        if (again || full) { (col.modelTrash ??= []).push(hash); return again ?? no('too_many', 'You have the most models you can keep. Delete one first.'); }
        const entry: ModelEntry = { id: newId(), name: named.name, hash, bytes: bytes.byteLength, tris: info.triangles, tex: info.textures, size: info.size, min: info.min, anims: info.animations, ...(info.skinned ? { skinned: true } : {}), ...(house ? { house: true as const } : {}), at: ctx.now() };
        // One house a player: the one before it goes (its bytes are swept), and the home that used it uses the new one.
        if (house) for (const old of list.filter((m) => m.house)) {
          list.splice(list.indexOf(old), 1);
          (col.modelTrash ??= []).push(old.hash);
          forgetPlacements(col, session.publicId, old.id);
          const home = col.homes[session.publicId];
          if (home?.house?.m === old.id) home.house = { m: entry.id, by: session.publicId };
        }
        list.push(entry);
        return { ok: true as const, code: 'uploaded' as const, model: modelView(entry, session.publicId) };
      });
      return result;
    }
  }
  const api = {
    on, ready, sweep, ...methods,
    /** POST /api/spaces/models/rename { id, name } */
    rename(db: Db, session: SessionRecord, body: Record<string, unknown>) {
      const entry = listOf(db, session.publicId).find((m) => m.id === body['id']);
      if (!entry) return no('unknown_model', 'That model is not yours or is gone.');
      const named = cleanName(body['name']);
      if ('ok' in named) return named;
      entry.name = named.name;
      return { ok: true as const, code: 'renamed' as const, model: modelView(entry, session.publicId) };
    },
    /** POST /api/spaces/models/delete { id } */
    remove(db: Db, session: SessionRecord, body: Record<string, unknown>) {
      const col = spacesOf(db);
      const list = col.models?.[session.publicId] ?? [];
      const at = list.findIndex((m) => m.id === body['id']);
      if (at < 0) return no('unknown_model', 'That model is not yours or is gone.');
      const [gone] = list.splice(at, 1);
      (col.modelTrash ??= []).push(gone!.hash);
      forgetPlacements(col, session.publicId, gone!.id);
      if (!list.length) delete col.models![session.publicId];
      return { ok: true as const, code: 'deleted' as const };
    },
    /** POST /api/spaces/models/report { by, id } — three reports hide it until an operator looks. */
    report(db: Db, session: SessionRecord, body: Record<string, unknown>) {
      const by = typeof body['by'] === 'string' ? body['by'] : '';
      if (by === session.publicId) return no('own_model', 'That is your own model.');
      const entry = listOf(db, by).find((m) => m.id === body['id']);
      if (!entry) return no('unknown_model', 'That model is gone.');
      const reports = entry.reports ??= [];
      if (!reports.includes(session.publicId) && reports.length < 10) reports.push(session.publicId);
      if (reports.length >= MODELS.reportsToHide && !entry.cleared) entry.hidden = true;
      return { ok: true as const, code: 'reported' as const };
    },
    /** GET /api/spaces/model-file/:hash — the bytes, for anyone with a session, unless every copy is hidden (its owner still sees it). */
    async file(request: RouteRequest) {
      const hash = request.params['hash'] ?? '';
      if (!HASH.test(hash) || !ctx.models) throw ctx.fail(404, 'unknown_model');
      const allowed = await ctx.store.read((db) => {
        const session = request.requireSession(db);
        const all = (db as { spaces?: { models?: Record<string, ModelEntry[]> } }).spaces?.models ?? {};
        return Object.entries(all).some(([owner, list]) => list.some((m) => m.hash === hash && (!m.hidden || owner === session.publicId)));
      });
      if (!allowed) throw ctx.fail(404, 'unknown_model');
      const bytes = await ctx.models.get(hash);
      if (!bytes) throw ctx.fail(404, 'unknown_model');
      return { file: { bytes, type: 'model/gltf-binary', cache: 'immutable' as const } };
    },
    /** Operator: reported or hidden models, newest first. */
    queue(db: Db) {
      const all = (db as { spaces?: { models?: Record<string, ModelEntry[]> } }).spaces?.models ?? {};
      const items = Object.entries(all).flatMap(([owner, list]) => list.filter((m) => (m.reports?.length ?? 0) > 0 || m.hidden).map((m) => ({ ...modelView(m, owner), reports: m.reports?.length ?? 0, owner: db.social?.players[owner]?.name ?? owner })));
      return { ok: true as const, code: 'ok' as const, items: items.sort((a, b) => b.at - a.at).slice(0, 200) };
    },
    /** Operator: { by, id, action: 'remove' | 'hide' | 'clear' }. Remove deletes it; clear keeps it visible for good. */
    moderate(db: Db, body: Record<string, unknown>) {
      const col = spacesOf(db);
      const by = typeof body['by'] === 'string' ? body['by'] : '';
      const list = col.models?.[by] ?? [];
      const at = list.findIndex((m) => m.id === body['id']);
      if (at < 0) return no('unknown_model', 'No such model.');
      const entry = list[at]!;
      if (body['action'] === 'remove') { list.splice(at, 1); (col.modelTrash ??= []).push(entry.hash); forgetPlacements(col, by, entry.id); return { ok: true as const, code: 'removed' as const }; }
      if (body['action'] === 'hide') { entry.hidden = true; return { ok: true as const, code: 'hidden' as const }; }
      if (body['action'] === 'clear') { delete entry.hidden; delete entry.reports; entry.cleared = true; return { ok: true as const, code: 'cleared' as const }; }
      return no('invalid_action', 'action must be remove, hide or clear.');
    },
  };
  return api;
}
