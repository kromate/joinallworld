/**
 * OWNER: world
 * The location-confirmed badge: which local government a confirmation is for, and when it lapses (docs/LOCATION.md).
 *
 * The check runs on the player's device. The game is only ever told that it matched, together with the id of the player's
 * main-home local government, and records `{ lga, at }` with its own clock. No position, accuracy or distance exists here.
 * Small and pure: the rules engine (systems/estate.ts) and the server's badge route read the same functions.
 */
import type { EstateState, LgaId, ResidenceConfirmed, WorldCityId } from '../types/life.ts';

/** A confirmation lapses this many days after it was made. */
export const CONFIRMATION_DAYS = 90;
export const CONFIRMATION_MS = CONFIRMATION_DAYS * 86400000;

/** The main home's city and local government, or null while the life has no home anywhere. */
export function mainHomeUnit(e: EstateState): { city: WorldCityId; lga: LgaId } | null {
  if (!e.home) return null;
  const lga = e.home === e.city ? e.lga : e.away[e.home]?.lga ?? null;
  return lga ? { city: e.home, lga } : null;
}

/** The confirmation that still stands: for the main home's local government as it is now, and not lapsed. */
export function standingConfirmation(e: EstateState, now: number): ResidenceConfirmed | null {
  const saved = e.confirmed;
  if (!saved || typeof saved.at !== 'number' || !Number.isFinite(saved.at)) return null;
  const home = mainHomeUnit(e);
  return home && home.lga === saved.lga && now >= saved.at && now - saved.at < CONFIRMATION_MS ? saved : null;
}

/** Where the main home is, as one comparable word: when this changes the confirmation is void. */
export const mainHomeKey = (e: EstateState): string => { const home = mainHomeUnit(e); return home ? `${home.city}/${home.lga}` : ''; };
