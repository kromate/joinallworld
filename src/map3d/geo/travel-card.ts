/**
 * OWNER: world
 * The travel card of the atlas, without a DOM: the ways to a chosen city as one button each, cheapest first.
 * One tap on a way leaves. A fare that takes more than TRAVEL_CONFIRM_SHARE of the cash in hand asks once, in place.
 * A way that cannot leave says why: what stops every way alike (a trip already under way, a life that has not settled
 * in) is said once above them, and a fare the player cannot pay names the amount missing under its own button.
 *
 *   travelWays(routes, { cash, confirming }) → { shared, ways }
 *   needsConfirm(fare, cash)                 → is this fare asked about before it is paid?
 */
import type { RouteInfo } from './info.ts';

/** A fare above this share of the cash in hand is asked about once before it is paid. */
export const TRAVEL_CONFIRM_SHARE = 0.5;
export const needsConfirm = (fare: number, cash: number | null): boolean => cash !== null && fare > cash * TRAVEL_CONFIRM_SHARE;

export interface TravelWay {
  id: string; to: string; mode: RouteInfo['mode'];
  /** Bus, Train or Flight. */
  name: string;
  fare: number; seconds: number;
  /** go: one tap leaves · ask: the fare is being confirmed · off: it cannot leave now · coming: the link is not open yet */
  state: 'go' | 'ask' | 'off' | 'coming';
  /** Naira missing for the fare, or 0. */
  short: number;
  /** Under the button: why it is off ('' when it can leave, or when the reason is the shared one). */
  why: string;
}
/** The most buttons the card shows: one each for the bus, the flight and the train. */
export const MAX_WAYS = 3;
export interface TravelCard { shared: string | null; ways: TravelWay[] }

const NAMES: Readonly<Record<string, string>> = { road: 'Bus', rail: 'Train', air: 'Flight' };
const naira = (value: number): string => `₦${value.toLocaleString('en-NG')}`;

export function travelWays(routes: readonly RouteInfo[], { cash = null, confirming = null }: { cash?: number | null; confirming?: string | null } = {}): TravelCard {
  // Cheapest first; a way that is not open yet comes after every way that is.
  // One way per mode, so a city with many connections still shows at most the bus, the flight and the train.
  const sorted = [...routes].filter((route, i, all) => all.findIndex((other) => other.mode === route.mode) === i).sort((a, b) => Number(a.status === 'coming') - Number(b.status === 'coming') || a.fare - b.fare || a.seconds - b.seconds);
  const bookable = sorted.filter((route) => route.status !== 'coming');
  const first = bookable[0]?.why ?? null;
  // The server names a fare it cannot take ("… costs ₦65,000; you have …"): that belongs to one way, never to all.
  const shared = first && bookable.every((route) => !route.live && route.why === first) && !/costs ₦/.test(first) ? first : null;
  const ways = sorted.map((route): TravelWay => {
    const base = { id: route.id, to: route.to, mode: route.mode, name: NAMES[route.mode] ?? route.mode, fare: route.fare, seconds: route.seconds };
    if (route.status === 'coming') return { ...base, state: 'coming', short: 0, why: 'Coming soon' };
    const short = cash !== null && route.fare > cash ? route.fare - cash : 0;
    if (short) return { ...base, state: 'off', short, why: shared ? '' : `You need ${naira(short)} more.` };
    if (!route.live) return { ...base, state: 'off', short: 0, why: shared ? '' : route.why || 'This way is not available right now.' };
    return { ...base, state: confirming === route.id ? 'ask' : 'go', short: 0, why: '' };
  });
  return { shared, ways: ways.slice(0, MAX_WAYS) };
}

/**
 * What a ride debt says on a card, and its one button: "Pay ₦X now" (data-atlas-repay) when cash covers the whole of what is STILL owed,
 * otherwise the way to "What you can do now" (data-atlas-help). '' when nothing is owed. The sentence is whole: nothing in it is cut.
 */
export function debtHtml(owing: number, cash: number | null): string {
  if (!(owing > 0)) return '';
  return cash !== null && cash >= owing
    ? `<div class="atlas-way-ask" role="group" aria-label="Your ride home is not paid" data-atlas-debt><p>You owe ${naira(owing)} for your ride home. Pay it and you can travel on.</p><div><button type="button" class="atlas-go is-small" data-atlas-repay>Pay ${naira(owing)} now</button></div></div>`
    : `<div class="atlas-way-ask" role="group" aria-label="Your ride home is not paid" data-atlas-debt><p>You still owe ${naira(owing)} for your ride home${cash !== null ? ` and have ${naira(cash)}` : ''}. Half of each earning repays it.</p><div><button type="button" class="atlas-chip" data-atlas-help>What you can do now</button></div></div>`;
}
