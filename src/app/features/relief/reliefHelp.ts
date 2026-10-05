/**
 * OWNER: world
 * The "What you can do now" card, worked out from a life: the moments a player could be stuck in, and the ways out. Read by the
 * card in the HUD, the wallet and the goal line, so it lives with them (a lazy chunk), not in the engine every page loads. Pure: it changes nothing.
 * Numbers: content/relief.ts. The ways themselves are the game's: src/game/relief.ts and systems/estate.ts.
 */
import { routeUnavailable } from '../../../game/cities/routeAvailability.ts';
import { cityRules, linksFrom } from '../../../game/cities/registry.ts';
import { blockReason } from '../../../game/api.ts';
import { ODD_JOBS } from '../../../game/content/relief.ts';
import { LODGING } from '../../../game/content/world.ts';
import { naira } from '../../../game/util.ts';
import { creditLink, unsettled, visitingHere } from '../../../game/systems/estate.ts';
import { reliefActivities } from '../../../game/relief.ts';
import type { LifeContext, LifeState } from '../../../types/life.ts';
import type { ReliefAction, ReliefHelp } from '../../../types/view.ts';

/** Below this much cash a hungry player counts as unable to buy a meal. */
export const MEAL_CASH = 1500;
/** Need levels at which the "What you can do now" card is offered. */
export const HELP_NEEDS = { hunger: 25, energy: 25 };
const NOTHING = { blocked: null, venue: null, here: false, activity: null, spot: null, to: null, mode: null } as const;

/** The card for this moment, or null when the player is not stuck-ish: a visitor who cannot pay the cheapest fare home, hunger low with no money for a meal, or energy low with no money for a room. */
export function helpOf(state: LifeState, ctx: LifeContext): ReliefHelp | null {
  const e = state.estate, name = cityRules(e.city)?.name ?? e.city;
  if (unsettled(state) || state.activeAction) return null;
  const away = visitingHere(state), homeName = cityRules(e.home)?.name ?? 'home';
  const fares = e.home ? linksFrom(e.city).filter((item) => item.to === e.home && !routeUnavailable(item)).map((item) => item.fare) : [];
  const cheapest = fares.length ? Math.min(...fares) : null;
  const farHome = away && cheapest !== null && state.cash < cheapest;
  const hungry = state.needs.hunger < HELP_NEEDS.hunger && state.cash < MEAL_CASH;
  const tired = !e.lga && state.needs.energy < HELP_NEEDS.energy && state.cash < LODGING.fee;
  if (!farHome && !hungry && !tired) return null;
  const key = `${[farHome ? 'home' : '', hungry ? 'hunger' : '', tired ? 'rest' : ''].filter(Boolean).join('+')}@${e.city}`;
  const line = farHome ? `You have ${naira(state.cash)} in ${name} and the cheapest way home to ${homeName} is ${naira(cheapest ?? 0)}. There is a way through.`
    : hungry ? `You are hungry and have ${naira(state.cash)}. There is a way through.` : `You are worn out and have ${naira(state.cash)}. There is a way through.`;
  const defs = reliefActivities(e.city), arrival = defs[0]?.where.venue ?? null;
  const at = (id: string, kind: 'odd-job' | 'bench' | 'tap', detail: string): ReliefAction | null => {
    const def = defs.find((item) => item.id === id);
    if (!def || !arrival) return null;
    const why = blockReason(state, def, arrival, ctx);
    if (why?.code === 'not_needed') return null;
    return { id: kind, label: def.label, detail, blocked: why?.reason ?? null, venue: arrival, here: state.location === arrival, activity: id, spot: def.where.spot, to: null, mode: null };
  };
  const actions: ReliefAction[] = [];
  const job = at('relief-odd-jobs', 'odd-job', `Paid work, any hour: ${naira(ODD_JOBS.reward ?? 0)} a job.`);
  const bench = at('relief-bench', 'bench', 'Free. Gets your energy back, slowly.'), tap = at('relief-tap', 'tap', 'Free. Takes the edge off your hunger.');
  if (job) actions.push(job);
  if (hungry && tap) actions.push(tap);
  if ((tired || !hungry) && bench) actions.push(bench);
  const offer = state.activeAction ? null : creditLink(state, ctx);
  if (offer) actions.push({ ...NOTHING, id: 'credit-ride', label: `Ride home on credit to ${cityRules(offer.to)?.name ?? offer.to}`, detail: `${naira(offer.fare)} is advanced and you owe it: half of each earning repays it. No skipping the trip.`, to: offer.to, mode: offer.mode });
  if (state.business.opened > 0) actions.push({ ...NOTHING, id: 'cash-box', label: 'Collect your cash box', detail: 'Whatever your stall has taken is yours.' });
  actions.push({ ...NOTHING, id: 'friend', label: 'Ask a friend', detail: 'A message is ready for you to send.' });
  return { key, title: 'What you can do now', line, actions };
}

/** The one line under the needs bars for such a moment: the first step of the card. Null when there is none. */
export function helpStep(state: LifeState, ctx: LifeContext): { icon: string; title: string; hint: string; go?: [string, string]; open?: string } | null {
  const help = helpOf(state, ctx), first = help?.actions.find((action) => !action.blocked && (action.activity || action.id === 'credit-ride'));
  if (!help || !first) return null;
  return first.activity && first.venue
    ? { icon: first.id === 'odd-job' ? '🧹' : first.id === 'bench' ? '🪑' : '🥤', title: first.label, hint: first.detail, go: [first.venue, first.spot ?? ''] }
    : { icon: '🚌', title: first.label, hint: 'Open Home: the ride home on credit is the first button after the room.', open: 'visiting' };
}
