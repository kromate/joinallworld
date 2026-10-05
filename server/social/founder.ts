/**
 * OWNER: social
 * THE FOUNDER IS EVERY PLAYER'S FIRST FRIEND. The rules are applied in server/social/service.ts; what they share with
 * the modules that also ask "are these two friends?" (calls, comeback mail, presence) is here. Portable: no Node imports.
 *
 * WHO THE FOUNDER IS. The character currently in play on the ACCOUNT whose verified address has the SHA-256 below.
 * Only the hash is in the source; a host may replace it with FOUNDER_EMAIL_SHA256 (server/host-context.ts
 * founderEmailHash), and an empty value there switches all of this off. A name never makes anyone the founder.
 *
 * HOW IT IS STORED (all optional fields: a collection written before them reads unchanged)
 *   social.founder             { account, id }   which account matched, and its character, noted when that character
 *                                                 makes a social request. It is checked against the account record
 *                                                 every time it is used, so a deleted account, another character in
 *                                                 play or a changed setting never leaves a stale founder.
 *   social.players[x].founder  { id, at }        the marker: this player was introduced to the founder ONCE. It is
 *                                                 never cleared, so a player who removed or blocked the founder is
 *                                                 not given them again.
 *   social.players[x].friends[founderId]         the friendship itself, on the PLAYER'S side only. The founder's own
 *                                                 record holds no entry for it: tens of thousands of friends cost the
 *                                                 founder's record, their overview and their presence nothing.
 *   message.auto                                  the welcome note. Its words are not stored (welcomeNote below).
 * Such a one-sided entry is a full friendship (friendsIn): messages, gifts, groups and calls work both ways.
 */
import { sha256Hex } from '../../src/game/util.ts';
import type { SocialPlayerRecord } from '../types.ts';

/** SHA-256 (lowercase hex) of the founder account's verified address, trimmed and lower-cased. */
export const FOUNDER_EMAIL_SHA256 = '7943383096e6b469adffe35b56822e52bf427ee74c140ad44bad3434708ded88';
/** Automatic friends sent to the founder's own client at a time (GET /api/social/me, GET /api/social/friends). */
export const FOUNDER_PAGE = 50;

/**
 * The welcome note every player finds in Messages, from the founder's character. Sent once, by the server; it costs
 * the founder nothing and tells them nothing. A reply is an ordinary message.
 */
export const WELCOME_NOTE = 'Welcome to Allworld! This is an automatic welcome note from the founder. Allworld is a digital world of real cities: you can make a life in one and travel to the others. I am glad you are here. Say hello here any time, and bring a friend along. The world is better with people you know.';

type Players = Readonly<Record<string, SocialPlayerRecord>> | null | undefined;

/** What an address is compared by: the SHA-256 of it, trimmed and lower-cased. */
export const emailHash = (email: unknown): string => (typeof email === 'string' && email.trim() ? sha256Hex(email.trim().toLowerCase()) : '');

/** `other` holds the automatic friendship with `founderId`: kept on their side only, and not removed since. */
export function autoFriend(players: Players, founderId: string, other: string): boolean {
  const theirs = players?.[other], founder = players?.[founderId];
  return theirs !== undefined && founder !== undefined && theirs.founder?.id === founderId && theirs.friends[founderId] !== undefined && founder.friends[other] === undefined;
}
/** Are these two friends? Both listed each other, or one holds the automatic friendship with the other. */
export const friendsIn = (players: Players, a: string, b: string): boolean => Boolean(players?.[a]?.friends[b] !== undefined && players[b]?.friends[a] !== undefined) || autoFriend(players, a, b) || autoFriend(players, b, a);
/** When a friendship began (server ms); 0 when there is none. */
export const friendsSince = (players: Players, a: string, b: string): number => Math.max(players?.[a]?.friends[b] ?? 0, players?.[b]?.friends[a] ?? 0);
/**
 * Who is told that `id` connected or dropped: the friends who listed each other. An automatic friendship is told
 * neither way — the founder is not sent a frame for every player who opens the game, and their own arrival is not
 * sent to everyone who ever played.
 */
export function presenceAudience(players: Players, id: string): string[] {
  return Object.keys(players?.[id]?.friends ?? {}).filter((other) => players?.[other]?.friends[id] !== undefined);
}
