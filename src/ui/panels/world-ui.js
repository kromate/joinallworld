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
 * Why Go is disabled, as { code, label, reason, fix? }, or null when the trip can start.
 * `label` is short enough for the button; `reason` is the full sentence shown beside it, and it
 * always says what to do about it. `fix` is the one-tap way out where there is one:
 *   { kind: 'reconnect' }                    offline or an expired session → reconnect (the host's own Reconnect)
 *   { kind: 'cancel', label }                busy → cancel what is running
 *   { kind: 'mode', mode: 'trek', label }    not enough cash → go on foot, which is free
 *   { kind: 'enter', label }                 already there → go inside
 */
export function goBlock(state, view, destination, mode) {
  if (!view.connected) {
    return { code: 'offline', label: 'Offline', fix: { kind: 'reconnect', label: view.session ? 'Reconnect' : 'Reconnect to travel' },
      reason: view.session ? 'You are offline, so the trip cannot start. Reconnect and Go will work again — nothing changes while you are offline.'
        : 'Your session on this device is not connected. Reconnect to carry on with your saved life, then travel.' };
  }
  const blocked = destination.blocked || mode?.blocked;
  if (blocked) {
    if (blocked.code === 'closed') return { code: 'closed', label: destination.status, reason: `${blocked.reason} Pick somewhere that is open now, or come back then.` };
    if (blocked.code === 'already_here') return { code: 'already_here', label: 'You are here', reason: 'You are already here.', fix: { kind: 'enter', label: 'Go inside' } };
    if (blocked.code === 'coming_soon') return { code: 'coming_soon', label: 'Coming soon', reason: `${blocked.reason} There is nothing to do there yet.` };
    if (blocked.code === 'insufficient_funds') {
      const short = Math.max(0, (mode?.fare || 0) - (Number(state.cash) || 0));
      const trek = destination.modes?.find((option) => option.id === 'trek' && !option.blocked);
      return { code: 'insufficient_funds', label: `Not enough cash · ${fareText(mode)}`, fix: trek && mode?.id !== 'trek' ? { kind: 'mode', mode: 'trek', label: `Trek instead · Free · ${trek.seconds}s` } : null,
        reason: `${mode.label} costs ${money(mode.fare)} and you have ${money(state.cash)} — you are ${money(short)} short.${trek ? ' Trekking is free, or earn a little first.' : ''}` };
    }
    return { code: blocked.code || 'unavailable', label: 'Unavailable', reason: blocked.reason };
  }
  if (state.activeAction) {
    const trip = state.activeAction.kind === 'travel' || state.activeAction.kind === 'commute';
    const name = trip ? view.travel?.destinations?.find((item) => item.id === state.activeAction.id)?.label : view.activities?.active?.label;
    const locked = !trip && view.activities?.active && view.activities.active.cancellable === false;
    return { code: trip ? 'travelling' : 'busy', label: trip ? 'Already travelling' : 'Busy',
      fix: locked ? null : { kind: 'cancel', label: trip ? 'Cancel that trip' : `Cancel ${name || 'it'}` },
      reason: trip ? `You are already on the way${name ? ` to ${name}` : ''}. Arrive first, or cancel that trip (its fare is not refunded) and then travel here.`
        : `You are busy${name ? `: ${name}` : ''} (${Math.ceil(state.activeAction.remaining ?? 0)}s left). ${locked ? 'It cannot be cancelled — wait for it to finish, then travel.' : 'Wait for it to finish, or cancel it and then travel.'}` };
  }
  if (!mode) return { code: 'unavailable', label: 'Unavailable', reason: 'No way of travelling there is available right now.' };
  return null;
}

/** The one-tap fix of a refusal as a button, or ''. The shell runs data-menu / data-cancel / data-close itself. */
export function fixButton(block, className = 'map-fix') {
  const fix = block?.fix;
  if (!fix) return '';
  const attribute = fix.kind === 'reconnect' ? 'data-menu="reconnect"' : fix.kind === 'cancel' ? 'data-cancel' : fix.kind === 'enter' ? 'data-close' : `data-travel-mode="${esc(fix.mode)}"`;
  return `<button class="${className}" ${attribute}>${esc(fix.label)}</button>`;
}

/**
 * The trip in progress, for the trip bar: { from, to, mode: { icon, label }, fare, remaining, duration, fraction, rule } or null.
 * Everything is the server's: where it started, how, what was paid and how long is left.
 */
export function tripInfo(state, view) {
  const active = state.activeAction;
  if (!active || (active.kind !== 'travel' && active.kind !== 'commute')) return null;
  const commute = active.kind === 'commute', trip = commute ? null : view.travel?.active;
  const place = (id) => view.travel?.destinations?.find((item) => item.id === id) || { id, label: id, icon: '📍' };
  const from = place(trip?.from ?? state.location), to = place(active.id);
  const mode = commute ? { id: 'commute', icon: '💼', label: 'Commute to work' } : view.travel?.modes?.find((item) => item.id === active.mode) || (active.mode === 'car' ? { id: 'car', icon: '🚗', label: 'Your car' } : { id: 'danfo', icon: '🧭', label: 'On the way' });
  const fare = Number.isFinite(trip?.fare) ? trip.fare : null;
  const rule = commute ? `Cancel to stay at ${from.label}. Nothing was charged for the commute.`
    : fare === null ? `Cancel to stay at ${from.label}. A fare already paid is not refunded.`
      : fare > 0 ? `Cancel to stay at ${from.label}. The ${money(fare)} ${active.mode === 'car' ? 'fuel' : 'fare'} you paid is not refunded.` : `Cancel to stay at ${from.label}. This trip was free, so nothing is lost.`;
  const duration = active.duration || 1, remaining = Math.max(0, active.remaining ?? 0);
  return { from, to, mode, fare, commute, remaining, duration, fraction: Math.max(0, Math.min(1, 1 - remaining / duration)), rule };
}

export const statusClass = (destination) => (destination.kind === 'soon' ? 'is-soon' : destination.open ? 'is-open' : 'is-closed');
export const placeName = (destination) => `${esc(destination.icon || '📍')} ${esc(destination.label)}`;
