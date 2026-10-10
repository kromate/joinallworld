/** OWNER: showcase. The stored collection `db.showcase`: shops, one record per owner, and contact events. Server only. */
import { SHOWCASE, SHOWCASE_CATEGORIES, SHOWCASE_ICONS, SHOWCASE_TEMPLATES } from '../../src/types/showcase.ts';
import type { ShowcaseCollection, ShowcaseContact, ShowcaseShop } from '../../src/types/showcase.ts';
import type { Db, RouteContext } from '../types.ts';

export const emptyShowcase = (): ShowcaseCollection => ({ v: 1, seq: 0, shops: {}, owners: {}, contacts: {} });
export const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const whole = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
const oneOf = <T extends string>(list: readonly T[], value: unknown): value is T => typeof value === 'string' && (list as readonly string[]).includes(value);
const STATUSES = ['draft', 'review', 'live', 'hidden', 'held'] as const;

/** A stored shop, checked entry by entry as it is read (a damaged one is skipped, never repaired in place). */
export function isShop(value: unknown): value is ShowcaseShop {
  return record(value) && value.v === 1 && typeof value.id === 'string' && /^SC-\d{1,16}$/.test(value.id) && typeof value.owner === 'string' && typeof value.city === 'string' && typeof value.venue === 'string'
    && whole(value.slot, 1, SHOWCASE.slotsPerVenue) && typeof value.name === 'string' && oneOf(SHOWCASE_CATEGORIES, value.category) && oneOf(SHOWCASE_TEMPLATES, value.template) && oneOf(SHOWCASE_ICONS, value.logo)
    && Array.isArray(value.colours) && value.colours.length === 2 && typeof value.sign === 'string' && typeof value.about === 'string'
    && Array.isArray(value.services) && value.services.length <= SHOWCASE.services && Array.isArray(value.hours) && value.hours.length === 7
    && record(value.chat) && typeof value.chat.url === 'string' && (value.pay === null || (record(value.pay) && typeof value.pay.url === 'string'))
    && Array.isArray(value.photos) && value.photos.length <= SHOWCASE.photosMax && value.photos.every((photo) => record(photo) && typeof photo.id === 'string' && whole(photo.w) && whole(photo.h) && whole(photo.n) && typeof photo.approved === 'boolean')
    && oneOf(STATUSES, value.status) && whole(value.revision, 1) && whole(value.createdAt) && whole(value.updatedAt);
}
const isContact = (value: unknown): value is ShowcaseContact => record(value) && typeof value.id === 'string' && typeof value.shop === 'string' && typeof value.buyer === 'string' && (value.kind === 'chat' || value.kind === 'pay') && whole(value.at);
export function isCollection(value: unknown): value is ShowcaseCollection {
  return record(value) && value.v === 1 && whole(value.seq) && record(value.shops) && record(value.owners) && record(value.contacts)
    && Object.keys(value.shops).length <= SHOWCASE.shops && Object.keys(value.contacts).length <= SHOWCASE.contacts
    && Object.entries(value.shops).every(([id, shop]) => isShop(shop) && shop.id === id) && Object.entries(value.contacts).every(([id, contact]) => isContact(contact) && contact.id === id);
}
/** A read that never creates or repairs: what is there if it looks like a collection, else nothing. */
export function peekShowcase(db: Db): ShowcaseCollection {
  const found: unknown = 'showcase' in db ? db.showcase : undefined;
  if (!record(found) || found.v !== 1 || !whole(found.seq) || !record(found.shops) || !record(found.owners) || !record(found.contacts)
    || Object.keys(found.shops).length > SHOWCASE.shops || Object.keys(found.contacts).length > SHOWCASE.contacts) return emptyShowcase();
  return found as unknown as ShowcaseCollection;
}
export function showcaseOf(ctx: RouteContext, db: Db): ShowcaseCollection {
  const found = ctx.collection(db, 'showcase', emptyShowcase());
  // Fail closed rather than replace a partly damaged record.
  if (!isCollection(found)) throw ctx.fail(503, 'showcase_storage_invalid');
  return found;
}
/** Contact events older than the retention go; past the cap the oldest go. */
export function pruneContacts(collection: ShowcaseCollection, now: number): void {
  const events = Object.entries(collection.contacts);
  for (const [id, event] of events) if (event.at < now - SHOWCASE.contactDays * SHOWCASE.day) delete collection.contacts[id];
  const left = Object.entries(collection.contacts);
  if (left.length > SHOWCASE.contacts - 1) for (const [id] of left.sort((a, b) => a[1].at - b[1].at).slice(0, left.length - (SHOWCASE.contacts - 1))) delete collection.contacts[id];
}
/** The shop of an owner, if the owner's record points at one that still exists. */
export function shopOf(collection: ShowcaseCollection, owner: string): ShowcaseShop | undefined {
  const id = collection.owners[owner]?.shop;
  const shop = id ? collection.shops[id] : undefined;
  return shop && shop.owner === owner ? shop : undefined;
}
