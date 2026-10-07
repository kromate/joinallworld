/**
 * OWNER: trust. The seam where a phone (OTP) or ID check provider plugs in. NONE IS CONFIGURED: both checks answer
 * `provider_unavailable` with "coming soon", and the only way to a checked tier today is an admin checking by hand.
 *
 * A provider, when one is added, keeps everything personal on its side. Allworld stores the RESULT (the tier) and the
 * provider's REFERENCE for the check, never a phone number, BVN, NIN, date of birth or picture of a document.
 */
import type { VerifiedTier } from '../../src/game/trust/index.ts';

export type CheckKind = 'phone' | 'id';
export interface CheckStart { ok: true; ref: string; next: string }
export interface CheckProvider {
  kind: CheckKind
  /** The provider's name, shown to the player. */
  name: string
  /** Start a check for this player; the provider's reference comes back, never the data the player gave it. */
  start(publicId: string): Promise<CheckStart>
  /** The provider's answer for a reference: the tier it supports, or null while pending or failed. */
  result(ref: string): Promise<VerifiedTier | null>
}

const PROVIDERS: Partial<Record<CheckKind, CheckProvider>> = {};

export const checkProvider = (kind: CheckKind): CheckProvider | null => PROVIDERS[kind] ?? null;
export const CHECK_WORDS: Record<CheckKind, { label: string; soon: string }> = {
  phone: { label: 'Check my phone number', soon: 'Phone checks are coming soon. Until then a moderator can check you by hand if you run a stall.' },
  id: { label: 'Check my ID', soon: 'ID checks are coming soon. We will only keep the result, never your BVN, NIN or a picture of your card.' },
};
export function checkStatus(): Record<CheckKind, 'ready' | 'unavailable'> {
  return { phone: checkProvider('phone') ? 'ready' : 'unavailable', id: checkProvider('id') ? 'ready' : 'unavailable' };
}
