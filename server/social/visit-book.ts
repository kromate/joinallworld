/**
 * OWNER: social
 * THE VISIT BOOK: invitations to a home and house links, in `db.visits` — a collection of its own, so that making, reading or
 * answering one never rewrites the social collection (which holds every player), and the social collection is written only
 * when somebody actually comes in or goes out. Bounded: an invitation lives VISIT.inviteMinutes, a link as long as its host
 * chose (at most VISIT.linkMaxHours); an expired record is dropped by the next write, and at most VISIT.kept are held in all.
 *   invites  { "<host>><guest>": { host, guest, at, expires, cityId } }   one per pair: asking again renews it
 *   links    { "<link id>": { id, host, at, expires, max?, open?, ended?, members, log, removed? } }
 * Reads never create the collection and never write. Portable: no Node imports.
 */
import { VISIT } from '../../src/game/visit.ts';
import type { Db, HouseLinkRecord, InviteRecord, VisitsCollection } from '../types.ts';

const HOUR = 3600000;
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
export const inviteKey = (host: string, guest: string): string => `${host}>${guest}`;

/** The book as stored, or null when nobody has made a record yet. A damaged book reads as empty. Never writes. */
export function peekBook(db: Db): VisitsCollection | null {
  const book = db.visits;
  return isRecord(book) && isRecord(book.invites) && isRecord(book.links) ? book : null;
}
/** The book, made when there is none. Only for a call that is about to write. */
export function openBook(db: Db): VisitsCollection {
  const found = peekBook(db);
  if (found) return found;
  db.visits = { invites: {}, links: {} };
  return db.visits;
}
/** Drop what is over; keep at most VISIT.kept (the oldest go first). */
export function sweepBook(book: VisitsCollection, t: number): void {
  for (const [key, invite] of Object.entries(book.invites)) if (!isRecord(invite) || !(invite.expires > t)) delete book.invites[key];
  // A link stays a while after it ends so the host still reads how many came in; then it is forgotten.
  for (const [key, link] of Object.entries(book.links)) if (!isRecord(link) || link.expires + HOUR < t || (link.ended === true && t - link.at > 2 * HOUR + VISIT.linkMaxHours * HOUR)) delete book.links[key];
  for (const list of [book.invites, book.links] as Record<string, { at: number }>[]) {
    const keys = Object.keys(list);
    if (keys.length > VISIT.kept) for (const key of keys.sort((a, b) => (list[a]?.at ?? 0) - (list[b]?.at ?? 0)).slice(0, keys.length - VISIT.kept)) delete list[key];
  }
}
/** The invitation `host` made to `guest`, if it is still good. */
export function liveInvite(db: Db, host: string, guest: string, t: number): InviteRecord | undefined {
  const found = peekBook(db)?.invites[inviteKey(host, guest)];
  return found && found.expires > t ? found : undefined;
}
/** Everyone's invitations to `guest` that are still good. */
export function invitesFor(db: Db, guest: string, t: number): InviteRecord[] {
  const book = peekBook(db);
  return book ? Object.values(book.invites).filter((invite) => invite.guest === guest && invite.expires > t) : [];
}
/** The invitations `host` has made that are still good. */
export function invitesBy(db: Db, host: string, t: number): InviteRecord[] {
  const book = peekBook(db);
  return book ? Object.values(book.invites).filter((invite) => invite.host === host && invite.expires > t) : [];
}
/** Links that still open a door (not ended, not run out): the host's own. */
export function liveLinks(db: Db, host: string, t: number): HouseLinkRecord[] {
  const book = peekBook(db);
  return book ? Object.values(book.links).filter((link) => link.host === host && link.ended !== true && link.expires > t) : [];
}
/** Links of a host as they list them: the live ones and those that ended or ran out lately. */
export function linksOf(db: Db, host: string): HouseLinkRecord[] {
  const book = peekBook(db);
  return book ? Object.values(book.links).filter((link) => link.host === host).sort((a, b) => b.at - a.at) : [];
}
/** A link's state, for the landing and the door. */
export const linkState = (link: HouseLinkRecord | undefined, t: number): 'open' | 'ended' | 'expired' | 'full' => {
  if (!link || link.ended === true) return 'ended';
  if (!(link.expires > t)) return 'expired';
  return link.max !== undefined && Object.keys(link.members).length >= link.max ? 'full' : 'open';
};
/** Count a person's coming in through a link: once per person, and in the hour's log. */
export function noteLinkUse(db: Db, linkId: string, visitor: string, t: number): void {
  const link = peekBook(db)?.links[linkId];
  if (!link) return;
  if (link.members[visitor] === undefined) link.members[visitor] = t;
  link.log = [...link.log.filter((at) => t - at < HOUR), t].slice(-2 * VISIT.linkPerHour);
}
/** A guest the host removed: this link never lets them in again. */
export function removeFromLink(db: Db, linkId: string, guest: string, t: number): void {
  const link = peekBook(db)?.links[linkId];
  if (link) (link.removed ||= {})[guest] = t;
}
