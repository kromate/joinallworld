/**
 * OWNER: world
 * String helpers shared by the Map, Ride and Health panels. Not a panel: nothing here is
 * registered. Everything is derived from view.travel (systems/travel.js), so the map card and
 * the Ride app can never disagree about a fare, a trip time or why a trip is refused.
 */
import { esc, money, cap } from '../dom.js';

export const signed = (amount) => (amount > 0 ? `+${amount}` : `−${-amount}`);
export const needsLine = (needs) => Object.entries(needs || {}).map(([need, amount]) => `${signed(amount)} ${cap(need)}`).join(', ');
export const fareText = (mode) => (mode.fare ? money(mode.fare) : 'Free');

/** One-line summary of a trip: "Danfo · about 8s · −2 Hygiene, −2 Fun". */
export function tripLine(mode) {
  const parts = [mode.label, `about ${mode.seconds}s`];
  const costs = needsLine(mode.needs);
  if (costs) parts.push(costs);
  for (const [skill, amount] of Object.entries(mode.xp || {})) parts.push(`+${amount} ${cap(skill)} XP`);
  if (mode.fuel) parts.push('fuel only');
  return parts.join(' · ');
}

/** Pick the mode to show as selected: the wanted one if this trip offers it, else Danfo, else the first. */
export function chosenMode(destination, wanted, fallback = 'danfo') {
  const modes = destination?.modes || [];
  return modes.find((mode) => mode.id === wanted) || modes.find((mode) => mode.id === fallback) || modes[0] || null;
}

/**
 * Why Go is disabled, as { label, reason }, or null when the trip can start.
 * `label` is short enough for the button; `reason` is the full sentence shown beside it.
 */
export function goBlock(state, view, destination, mode) {
  if (!view.connected) return { label: 'Offline', reason: 'You are offline. Reconnect to travel — nothing changes while offline.' };
  const blocked = destination.blocked || mode?.blocked;
  if (blocked) {
    const label = blocked.code === 'closed' ? destination.status : blocked.code === 'already_here' ? 'You are here' : blocked.code === 'coming_soon' ? 'Coming soon'
      : blocked.code === 'insufficient_funds' ? `Not enough cash · ${fareText(mode)}` : 'Unavailable';
    return { label, reason: blocked.reason };
  }
  if (state.activeAction) return { label: 'Busy', reason: 'Finish or cancel what you are doing first, then travel.' };
  if (!mode) return { label: 'Unavailable', reason: 'No way of travelling there is available right now.' };
  return null;
}

export const statusClass = (destination) => (destination.kind === 'soon' ? 'is-soon' : destination.open ? 'is-open' : 'is-closed');
export const placeName = (destination) => `${esc(destination.icon || '📍')} ${esc(destination.label)}`;
