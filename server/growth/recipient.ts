/**
 * OWNER: growth
 * Who a comeback mail goes to. ONE small function, so that the address a player is written to can change without
 * touching the rules. Two sources, in this order:
 *   contact  the address confirmed through "Stay in touch" (double opt-in);
 *   account  the VERIFIED address of the account the character belongs to (server/accounts/service.ts): an account is
 *            only ever made by a token the provider issued for a confirmed address. It is the recipient for the
 *            character that is the account's active one, and for no other (a character set aside is not written to).
 * Everything else (preferences, caps, links) is keyed by the player's public id and does not care where the address
 * came from.
 *
 * `nonce` is part of every signed link in the mail: a changed or removed address voids the old links. For an account it is
 * derived from the address itself, so an address that changed at a later sign-in voids them without anything being stored.
 */
import { hash53 } from '../protocol.ts';
import type { AccountRecord, GrowthCollection } from '../types.ts';

export interface MailRecipient {
  email: string
  nonce: string
  source: 'contact' | 'account'
  /** An account's welcome message: 'pending' while it is owed or being sent, or when it went out (server ms). It is one of the player's mails. */
  welcome?: 'pending' | number
}
/** The account whose active character is this player, or undefined. Supplied by the host side (it needs the session store). */
export type AccountOf = (publicId: string) => AccountRecord | undefined;

const hex = (text: string): string => parseInt(hash53(text), 36).toString(16).padStart(14, '0').slice(-14);
/** A UUID-shaped value that depends on the secret salt, the account and its current address. */
export function accountNonce(salt: string, account: Pick<AccountRecord, 'id' | 'email'>): string {
  const body = `${hex(`${salt}|a|${account.id}|${account.email.toLowerCase()}`)}${hex(`${salt}|b|${account.id}|${account.email.toLowerCase()}`)}${hex(`${salt}|c|${account.id}`)}`;
  return `${body.slice(0, 8)}-${body.slice(8, 12)}-4${body.slice(12, 15)}-8${body.slice(15, 18)}-${body.slice(18, 30)}`;
}

/** The confirmed address of a player who may be written to, or null (never an unconfirmed address, never a minor's). */
export function mailRecipientOf(g: Pick<GrowthCollection, 'contacts' | 'players' | 'salt'>, publicId: string, accountOf?: AccountOf): MailRecipient | null {
  const age = g.players[publicId]?.consent?.age;
  const contact = g.contacts !== undefined && Object.hasOwn(g.contacts, publicId) ? g.contacts[publicId] : undefined;
  if (contact?.confirmed && age === 'adult') return { email: contact.email, nonce: contact.nonce, source: 'contact' };
  // An account's address is vouched for by the provider. A player who said they are under 18 is never written to.
  const account = age === 'minor' ? undefined : accountOf?.(publicId);
  if (account && account.publicId === publicId && typeof account.email === 'string' && account.email) return { email: account.email, nonce: accountNonce(g.salt, account), source: 'account', ...(account.welcome === 'pending' || typeof account.welcome === 'number' ? { welcome: account.welcome } : {}) };
  return null;
}
