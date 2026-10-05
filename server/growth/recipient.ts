/**
 * OWNER: growth
 * Who a comeback mail goes to. ONE small function, so that the address a player is written to can change without
 * touching the rules: today it is the address confirmed through "Stay in touch" (double opt-in); a verified address
 * of an account becomes a recipient by being answered here too. Everything else (preferences, caps, links) is keyed by
 * the player's public id and does not care where the address came from.
 *
 * `nonce` is part of every signed link in the mail: a changed or removed address voids the old links.
 */
import type { GrowthCollection } from '../types.ts';

export interface MailRecipient { email: string; nonce: string; source: 'contact' }

/** The confirmed address of an adult player, or null (never an unconfirmed address, never a minor's). */
export function mailRecipientOf(g: Pick<GrowthCollection, 'contacts' | 'players'>, publicId: string): MailRecipient | null {
  const contact = g.contacts !== undefined && Object.hasOwn(g.contacts, publicId) ? g.contacts[publicId] : undefined;
  if (!contact?.confirmed) return null;
  if (g.players[publicId]?.consent?.age !== 'adult') return null;
  return { email: contact.email, nonce: contact.nonce, source: 'contact' };
}
