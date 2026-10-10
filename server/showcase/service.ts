/**
 * OWNER: showcase
 * The rules of showcase shops (docs/SHOWCASE.md). The game never holds money: the seller gives their own chat (and optionally
 * pay) destination, an allow-listed outside link, and payment happens there. The two links are released only by `go`, to a
 * signed-in adult, and are in no card, directory or shop payload.
 */
import { SAFETY_LINE, outboundLink, screenFee } from '../../src/game/trust/index.ts';
import { businessVenue } from '../../src/game/business-model.ts';
import { SHOWCASE } from '../../src/types/showcase.ts';
import type { ShowcaseCard, ShowcaseChatKind, ShowcaseCollection, ShowcaseGo, ShowcaseInput, ShowcaseLinkKind, ShowcaseMine, ShowcasePage, ShowcasePayKind, ShowcaseQueueItem, ShowcaseShop, ShowcaseView } from '../../src/types/showcase.ts';
import { screenText } from '../moderation/text.ts';
import { trustService } from '../trust/service.ts';
import type { Db, RouteContext, SessionRecord } from '../types.ts';
import { isShop, peekShowcase, pruneContacts, shopOf, showcaseOf } from './data.ts';
import { parseInput, prose, searchable } from './model.ts';

const CHAT_SITES: Readonly<Record<string, ShowcaseChatKind>> = { WhatsApp: 'whatsapp', Instagram: 'instagram' };
const PAY_SITES: Readonly<Record<string, ShowcasePayKind>> = { Paystack: 'paystack', Flutterwave: 'flutterwave', Selar: 'selar' };
// The same home-address shapes the real-value listings refuse (server/real-value/listings.ts).
const HOME_ADDRESS = /\b(?:home address|house address|my house|my home|flat \d|apartment \d|\d+\s+\w+\s+(?:street|road|avenue|close))\b/i;
export const PRICE_LABEL = 'Seller’s price, paid outside Allworld';
export const PAY_NOTICE = 'Payment details changed recently';
const idNumber = (id: string): number => Number(id.slice(3));

export function showcaseService(ctx: RouteContext) {
  const trust = trustService(ctx);
  const now = (): number => ctx.now();
  const dayOf = (at: number): number => Math.floor(at / SHOWCASE.day);

  /** May this player publish a shop? The real-value stall conditions, and an adult's own word. */
  function gate(db: Db, session: SessionRecord): void {
    if (trust.tierOf(db, session) === 'guest') throw ctx.fail(403, 'account_required');
    if (trust.complaints(db, session.publicId).held) throw ctx.fail(403, 'listings_held');
    const adult = trust.adult(db, session.publicId);
    if (adult === false) throw ctx.fail(403, 'adults_only');
    if (adult !== true) throw ctx.fail(403, 'adult_self_declaration_required');
    const refusal = trust.postBlock(db, session, 'stall');
    if (refusal) throw ctx.fail(403, refusal.code);
  }
  /** The refusal code a seller would meet now, or null. */
  function blocked(db: Db, session: SessionRecord): string | null {
    try { gate(db, session); return null; } catch (error) { return codeOf(error); }
  }
  function codeOf(error: unknown): string {
    const found = typeof error === 'object' && error !== null && 'code' in error ? (error as { code: unknown }).code : undefined;
    return typeof found === 'string' ? found : 'unavailable';
  }
  /** May this player be sent to a seller? A signed-in adult whose own listings are not held. */
  function buyerGate(db: Db, session: SessionRecord): void {
    if (trust.tierOf(db, session) === 'guest') throw ctx.fail(403, 'account_required');
    if (trust.complaints(db, session.publicId).held) throw ctx.fail(403, 'listings_held');
    if (trust.adult(db, session.publicId) !== true) throw ctx.fail(403, 'adult_self_declaration_required');
  }
  const isBlocked = (db: Db, a: string, b: string): boolean => Boolean(ctx.checks?.blocked?.(a, b) || db.social?.players?.[a]?.blocked?.[b] || db.social?.players?.[b]?.blocked?.[a]);
  /** On the public page: live, its owner still able to publish, and not between blocked players. */
  function isPublic(db: Db, shop: ShowcaseShop, viewer?: string): boolean {
    if (shop.status !== 'live') return false;
    if (viewer && isBlocked(db, viewer, shop.owner)) return false;
    const owner = ctx.core.sessionByPublicId?.(db, shop.owner);
    if (!owner || owner.expiresAt <= now()) return false;
    return blocked(db, owner) === null;
  }
  function visible(db: Db, shop: ShowcaseShop, viewer?: string): boolean {
    return viewer === shop.owner || isPublic(db, shop, viewer);
  }

  function card(db: Db, shop: ShowcaseShop): ShowcaseCard | null {
    const badge = trust.badge(db, shop.owner);
    if (!badge) return null;
    const cover = shop.photos.find((photo) => photo.approved && !photo.hidden);
    const prices = shop.services.map((item) => item.priceNaira).filter((price) => price > 0);
    return { id: shop.id, name: shop.name, category: shop.category, template: shop.template, colours: shop.colours, sign: shop.sign, logo: shop.logo, city: shop.city, venue: shop.venue, slot: shop.slot,
      cover: cover?.id ?? null, services: shop.services.length, from: prices.length ? Math.min(...prices) : null, pay: shop.pay !== null, badge };
  }
  function view(db: Db, shop: ShowcaseShop): ShowcaseView | null {
    const base = card(db, shop);
    if (!base) return null;
    return { ...base, about: shop.about, photos: shop.photos.filter((photo) => photo.approved && !photo.hidden).map((photo) => ({ id: photo.id, w: photo.w, h: photo.h })), serviceList: shop.services, hours: shop.hours,
      payNotice: shop.pay && shop.payChangedAt !== undefined && shop.payChangedAt + SHOWCASE.payNoticeMs > now() ? PAY_NOTICE : null, priceLabel: PRICE_LABEL };
  }
  function get(db: Db, id: string, viewer?: string): ShowcaseShop {
    const shop = peekShowcase(db).shops[id];
    if (!isShop(shop) || shop.id !== id || !visible(db, shop, viewer)) throw ctx.fail(404, 'shop_unavailable');
    return shop;
  }

  function linkOf(kind: ShowcaseLinkKind, url: string, derived: ShowcaseChatKind | ShowcasePayKind | undefined): { url: string; kind: ShowcaseChatKind | ShowcasePayKind } {
    const refusal = kind === 'chat' ? 'chat_link_not_allowed' : 'pay_link_not_allowed';
    const link = outboundLink(url);
    const found = link ? (kind === 'chat' ? CHAT_SITES : PAY_SITES)[link.site] : undefined;
    if (!link || !found || (derived !== undefined && derived !== found)) throw ctx.fail(400, refusal);
    return { url: link.url, kind: found };
  }
  /** Parse, screen every text, check the market and the links. Returns the clean input with links normalised. */
  function validate(body: Record<string, unknown>): ShowcaseInput & { chat: { url: string; kind: ShowcaseChatKind }; pay: { url: string; kind: ShowcasePayKind } | null } {
    const parsed = parseInput(body);
    if (!parsed.ok) throw ctx.fail(400, parsed.code);
    const { input } = parsed;
    const city = ctx.cityIds.find((id) => id === input.city);
    if (!city) throw ctx.fail(400, 'invalid_city');
    if (!businessVenue(city, input.venue)) throw ctx.fail(400, 'market_required');
    for (const text of prose(input)) {
      const refusal = screenFee(text, { what: 'This shop' }) ?? screenText(text, { contact: true, what: 'This shop' });
      if (refusal) throw ctx.fail(400, refusal.code);
      if (HOME_ADDRESS.test(text)) throw ctx.fail(400, 'home_address_not_allowed');
    }
    const chat = linkOf('chat', input.chat.url, input.chat.kind) as { url: string; kind: ShowcaseChatKind };
    const pay = input.pay ? linkOf('pay', input.pay.url, input.pay.kind) as { url: string; kind: ShowcasePayKind } : null;
    return { ...input, city, chat, pay };
  }

  /** A slot of the market for this shop: the one asked for if free, else the one it already holds there, else the lowest free. */
  function slotFor(collection: ShowcaseCollection, input: ShowcaseInput, current: ShowcaseShop | undefined): number {
    const taken = new Set(Object.values(collection.shops).filter((shop) => shop.city === input.city && shop.venue === input.venue && shop.id !== current?.id).map((shop) => shop.slot));
    if (input.slot !== undefined) { if (taken.has(input.slot)) throw ctx.fail(409, 'slot_taken'); return input.slot; }
    if (current && current.city === input.city && current.venue === input.venue) return current.slot;
    for (let slot = 1; slot <= SHOWCASE.slotsPerVenue; slot += 1) if (!taken.has(slot)) return slot;
    throw ctx.fail(409, 'market_full');
  }
  function revision(value: unknown, expected: number): void {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw ctx.fail(400, 'expected_revision_required');
    if (value !== expected) throw ctx.fail(409, 'revision_conflict');
  }
  const mineOf = (db: Db, session: SessionRecord, create = false): { collection: ShowcaseCollection; shop: ShowcaseShop | undefined } => {
    const collection = create ? showcaseOf(ctx, db) : peekShowcase(db);
    return { collection, shop: shopOf(collection, session.publicId) };
  };
  /** A shop that comes back from being hidden or held goes live only if an operator has already approved it and nothing needing a look changed. */
  const resume = (shop: ShowcaseShop): ShowcaseShop['status'] => (shop.photos.length < SHOWCASE.photosMin ? 'draft' : shop.reviewedAt !== undefined && !shop.reapprove ? 'live' : 'review');

  return {
    trust, gate, buyerGate, blocked, isPublic, visible, card, view, get,
    page(db: Db, query: URLSearchParams, viewer?: string): ShowcasePage {
      const city = query.get('city'), venue = query.get('venue'), category = query.get('category'), after = query.get('after');
      const q = searchable((query.get('q') ?? '').slice(0, SHOWCASE.search));
      if (after && !/^SC-\d{1,16}$/.test(after)) throw ctx.fail(400, 'invalid_cursor');
      const below = after ? idNumber(after) : Infinity;
      const ordered = Object.keys(peekShowcase(db).shops).filter((id) => /^SC-\d{1,16}$/.test(id) && idNumber(id) < below).sort((a, b) => idNumber(b) - idNumber(a));
      const shops: ShowcaseCard[] = [];
      let more = false;
      for (const id of ordered) {
        const shop = peekShowcase(db).shops[id];
        if (!isShop(shop) || shop.id !== id || (city && shop.city !== city) || (venue && shop.venue !== venue) || (category && shop.category !== category)) continue;
        if (q && !searchable([shop.name, shop.sign, ...shop.services.map((item) => item.label)].join(' ')).includes(q)) continue;
        if (!isPublic(db, shop, viewer)) continue;
        const face = card(db, shop);
        if (!face) continue;
        if (shops.length === SHOWCASE.page) { more = true; break; }
        shops.push(face);
      }
      return { shops, next: more ? shops[shops.length - 1]?.id ?? null : null };
    },
    mine(db: Db, session: SessionRecord): ShowcaseMine {
      const { collection, shop } = mineOf(db, session);
      const owner = collection.owners[session.publicId], today = dayOf(now());
      const used = owner && owner.day === today ? owner.uploads : 0;
      const { photos, v: _v, ...rest } = shop ?? ({} as ShowcaseShop);
      return { shop: shop ? { ...rest, photos: photos.map((photo) => ({ id: photo.id, w: photo.w, h: photo.h, approved: photo.approved, hidden: photo.hidden === true })) } : null, blocked: blocked(db, session), uploadsLeft: Math.max(0, SHOWCASE.uploadsPerDay - used) };
    },
    /** Create or edit the caller's one shop. */
    save(db: Db, session: SessionRecord, body: Record<string, unknown>) {
      gate(db, session);
      const input = validate(body);
      const { collection, shop: current } = mineOf(db, session, true);
      revision(body.expectedRevision, current?.revision ?? 0);
      if (current?.status === 'held') throw ctx.fail(403, 'shop_held');
      if (!current && Object.keys(collection.shops).length >= SHOWCASE.shops) throw ctx.fail(429, 'showcase_full');
      const slot = slotFor(collection, input, current), at = now();
      const id = current?.id ?? `SC-${++collection.seq}`;
      const changed = Boolean(current) && (current?.name !== input.name || current?.chat.url !== input.chat.url || (current?.pay?.url ?? null) !== (input.pay?.url ?? null));
      const approved = current?.reviewedAt !== undefined;
      const payChanged = approved && (current?.pay?.url ?? null) !== (input.pay?.url ?? null);
      const next: ShowcaseShop = {
        v: 1, id, owner: session.publicId, city: input.city, venue: input.venue, slot, name: input.name, category: input.category, template: input.template, colours: input.colours, sign: input.sign, logo: input.logo,
        about: input.about, services: input.services, hours: input.hours, chat: input.chat, pay: input.pay, photos: current?.photos ?? [],
        status: current?.status ?? 'draft', ...(current?.reviewedAt !== undefined ? { reviewedAt: current.reviewedAt } : {}),
        ...(input.pay && payChanged ? { payChangedAt: at } : input.pay && current?.payChangedAt !== undefined ? { payChangedAt: current.payChangedAt } : {}),
        ...(current?.reapprove || (approved && changed) ? { reapprove: true as const } : {}),
        ...(current?.note ? { note: current.note } : {}),
        revision: (current?.revision ?? 0) + 1, createdAt: current?.createdAt ?? at, updatedAt: at,
      };
      // A live shop whose name or destinations changed is looked at again before it is shown; any other edit shows at once.
      if (current?.status === 'live' && next.reapprove) next.status = 'review';
      collection.shops[id] = next;
      collection.owners[session.publicId] = { day: collection.owners[session.publicId]?.day ?? dayOf(at), uploads: collection.owners[session.publicId]?.uploads ?? 0, shop: id };
      return { ok: true, code: current ? 'updated' : 'created', id, revision: next.revision, status: next.status };
    },
    /** Draft to review (or live again when nothing needs a look). Needs the minimum photos. */
    submit(db: Db, session: SessionRecord) {
      gate(db, session);
      const { collection, shop } = mineOf(db, session, true);
      if (!shop) throw ctx.fail(404, 'no_shop');
      if (shop.status === 'held') throw ctx.fail(403, 'shop_held');
      if (shop.photos.length < SHOWCASE.photosMin) throw ctx.fail(400, 'photos_needed');
      if (shop.status === 'draft' || shop.status === 'hidden') shop.status = resume(shop);
      shop.updatedAt = now(); shop.revision += 1;
      collection.shops[shop.id] = shop;
      return { ok: true, code: shop.status === 'review' ? 'in_review' : 'submitted', id: shop.id, revision: shop.revision, status: shop.status };
    },
    hide(db: Db, session: SessionRecord, hidden: unknown) {
      if (typeof hidden !== 'boolean') throw ctx.fail(400, 'invalid_shop');
      const { collection, shop } = mineOf(db, session, true);
      if (!shop) throw ctx.fail(404, 'no_shop');
      if (shop.status === 'held') throw ctx.fail(403, 'shop_held');
      if (hidden) { if (shop.status === 'live' || shop.status === 'review') shop.status = 'hidden'; } else {
        gate(db, session);
        if (shop.status === 'hidden') shop.status = resume(shop);
      }
      shop.updatedAt = now(); shop.revision += 1;
      collection.shops[shop.id] = shop;
      return { ok: true, code: hidden ? 'hidden' : 'shown', id: shop.id, revision: shop.revision, status: shop.status };
    },
    /** Remove the shop: its slot is free again. The photos' ids go to `gone` so the caller can delete their bytes. */
    remove(db: Db, session: SessionRecord, gone: string[]) {
      const { collection, shop } = mineOf(db, session, true);
      if (!shop) throw ctx.fail(404, 'no_shop');
      gone.push(...shop.photos.map((photo) => photo.id));
      delete collection.shops[shop.id];
      const owner = collection.owners[session.publicId];
      if (owner) delete owner.shop;
      return { ok: true, code: 'removed', id: shop.id };
    },
    /** Add a stored picture to the caller's shop. Counts against the daily upload limit. */
    attach(db: Db, session: SessionRecord, photo: { id: string; w: number; h: number; n: number }) {
      gate(db, session);
      const { collection, shop } = mineOf(db, session, true);
      if (!shop) throw ctx.fail(404, 'no_shop');
      if (shop.status === 'held') throw ctx.fail(403, 'shop_held');
      if (shop.photos.length >= SHOWCASE.photosMax) throw ctx.fail(409, 'photo_limit');
      const at = now(), owner = collection.owners[session.publicId] ?? { day: dayOf(at), uploads: 0 };
      if (owner.day !== dayOf(at)) { owner.day = dayOf(at); owner.uploads = 0; }
      if (owner.uploads >= SHOWCASE.uploadsPerDay) throw ctx.fail(429, 'upload_limit');
      owner.uploads += 1; owner.shop = shop.id; collection.owners[session.publicId] = owner;
      shop.photos.push({ ...photo, at, approved: shop.reviewedAt !== undefined });
      shop.updatedAt = at; shop.revision += 1;
      collection.shops[shop.id] = shop;
      return { ok: true, code: 'photo_added', id: shop.id, revision: shop.revision, photo: photo.id };
    },
    /** May this player add a picture now? Throws the refusal; used before any bytes are kept. */
    canUpload(db: Db, session: SessionRecord): void {
      gate(db, session);
      const { collection, shop } = mineOf(db, session);
      if (!shop) throw ctx.fail(404, 'no_shop');
      if (shop.status === 'held') throw ctx.fail(403, 'shop_held');
      if (shop.photos.length >= SHOWCASE.photosMax) throw ctx.fail(409, 'photo_limit');
      const owner = collection.owners[session.publicId];
      if (owner && owner.day === dayOf(now()) && owner.uploads >= SHOWCASE.uploadsPerDay) throw ctx.fail(429, 'upload_limit');
    },
    detach(db: Db, session: SessionRecord, photo: unknown, gone: string[]) {
      const { collection, shop } = mineOf(db, session, true);
      if (!shop) throw ctx.fail(404, 'no_shop');
      const at = shop.photos.findIndex((item) => item.id === photo);
      if (at < 0) throw ctx.fail(404, 'unknown_photo');
      gone.push(...shop.photos.splice(at, 1).map((item) => item.id));
      // Under the minimum a live shop is no longer a complete one: it goes back to a draft to be submitted again.
      if (shop.photos.length < SHOWCASE.photosMin && (shop.status === 'live' || shop.status === 'review')) shop.status = 'draft';
      shop.updatedAt = now(); shop.revision += 1;
      collection.shops[shop.id] = shop;
      return { ok: true, code: 'photo_removed', id: shop.id, revision: shop.revision, status: shop.status };
    },
    /** The caller wants the chat or pay destination of a shop. One contact event is kept; the link is not stored anywhere new. */
    go(db: Db, session: SessionRecord, id: string, kind: unknown): { ok: true; code: 'link' } & ShowcaseGo {
      if (kind !== 'chat' && kind !== 'pay') throw ctx.fail(400, 'invalid_shop');
      const shop = get(db, id, session.publicId);
      buyerGate(db, session);
      if (shop.owner === session.publicId) throw ctx.fail(400, 'own_shop');
      if (!isPublic(db, shop, session.publicId)) throw ctx.fail(404, 'shop_unavailable');
      const collection = showcaseOf(ctx, db), at = now();
      pruneContacts(collection, at);
      if (Object.values(collection.contacts).filter((event) => event.buyer === session.publicId && event.at > at - SHOWCASE.day).length >= SHOWCASE.goPerDay) throw ctx.fail(429, 'go_limit');
      const link = outboundLink(kind === 'chat' ? shop.chat.url : shop.pay?.url), badge = trust.badge(db, shop.owner);
      if (!link || !badge || badge.held) throw ctx.fail(404, 'shop_unavailable');
      const event = `SG-${++collection.seq}`;
      collection.contacts[event] = { id: event, shop: shop.id, buyer: session.publicId, kind, at };
      return { ok: true, code: 'link', link, badge, warning: SAFETY_LINE, requiresWarning: true, kind };
    },
    /** A complaint about the seller; with a photo id, also a vote to hide that one photo until an operator decides. */
    report(db: Db, session: SessionRecord, id: string, body: Record<string, unknown>) {
      if (trust.tierOf(db, session) === 'guest') throw ctx.fail(403, 'account_required');
      const shop = peekShowcase(db).shops[id];
      if (!isShop(shop) || shop.id !== id || shop.owner === session.publicId || isBlocked(db, session.publicId, shop.owner) || (shop.status !== 'live' && shop.status !== 'review')) throw ctx.fail(404, 'shop_unavailable');
      const photo = body.photo === undefined ? undefined : shop.photos.find((item) => item.id === body.photo);
      if (body.photo !== undefined && !photo) throw ctx.fail(404, 'unknown_photo');
      const filed = trust.report(db, session, { reason: body.reason, note: body.note, about: shop.owner });
      if (!filed.ok) return filed;
      let hidden = false;
      if (photo) {
        const reports = photo.reports ?? [];
        if (!reports.includes(session.publicId) && reports.length < 20) reports.push(session.publicId);
        photo.reports = reports;
        if (reports.length >= SHOWCASE.reportsToHide) { photo.hidden = true; hidden = true; }
        showcaseOf(ctx, db).shops[id] = shop;
      }
      return { ...filed, ...(hidden ? { hidden: true as const } : {}) };
    },

    // ---- operator -----------------------------------------------------------------------------------------------
    queue(db: Db): { queue: ShowcaseQueueItem[]; shops: number } {
      const collection = peekShowcase(db);
      const items = Object.values(collection.shops).filter((shop) => isShop(shop) && (shop.status === 'review' || shop.photos.some((photo) => photo.hidden))).sort((a, b) => a.updatedAt - b.updatedAt).slice(0, 100);
      return { shops: Object.keys(collection.shops).length, queue: items.map((shop) => ({ id: shop.id, name: shop.name, owner: shop.owner, ownerName: ctx.core.sessionByPublicId?.(db, shop.owner)?.name ?? '', city: shop.city, venue: shop.venue, status: shop.status, reviewedAt: shop.reviewedAt ?? null, updatedAt: shop.updatedAt,
        photos: shop.photos.map((photo) => ({ id: photo.id, w: photo.w, h: photo.h, approved: photo.approved, hidden: photo.hidden === true })), hiddenPhotos: shop.photos.filter((photo) => photo.hidden).map((photo) => photo.id), about: shop.about, chat: shop.chat.url, pay: shop.pay?.url ?? null })) };
    },
    decide(db: Db, body: Record<string, unknown>, gone: string[]): { ok: true; code: string; status: string; owner: string; name: string } {
      const shop = typeof body.shop === 'string' ? showcaseOf(ctx, db).shops[body.shop] : undefined;
      if (!shop) throw ctx.fail(404, 'unknown_shop');
      const at = now();
      switch (body.action) {
        case 'approve':
          if (shop.status !== 'review') throw ctx.fail(409, 'not_in_review');
          shop.status = 'live'; shop.reviewedAt ??= at; delete shop.reapprove; delete shop.note;
          for (const photo of shop.photos) photo.approved = true;
          break;
        case 'hide':
          shop.status = 'held';
          { const note = typeof body.reason === 'string' ? body.reason.replace(/\s+/g, ' ').trim().slice(0, 200) : ''; if (note) shop.note = note; else delete shop.note; }
          break;
        case 'restore':
          if (shop.status !== 'held') throw ctx.fail(409, 'not_held');
          delete shop.note; shop.status = resume(shop);
          break;
        case 'photo-restore': case 'photo-remove': {
          const photo = shop.photos.find((item) => item.id === body.photo);
          if (!photo) throw ctx.fail(404, 'unknown_photo');
          if (body.action === 'photo-restore') { delete photo.hidden; photo.reports = []; } else { gone.push(photo.id); shop.photos = shop.photos.filter((item) => item.id !== photo.id); if (shop.photos.length < SHOWCASE.photosMin && shop.status === 'live') shop.status = 'draft'; }
          break;
        }
        default: throw ctx.fail(400, 'invalid_action');
      }
      shop.updatedAt = at; shop.revision += 1;
      return { ok: true, code: String(body.action), status: shop.status, owner: shop.owner, name: shop.name };
    },
  };
}
export type ShowcaseService = ReturnType<typeof showcaseService>;
