/**
 * OWNER: world
 * The safety nets: what keeps a player from being stuck (src/game/relief.ts). All the numbers are here, in one place, to tune.
 * They carry no tags, so no goal, mission or table counts them as work, food or rest.
 * (The two thresholds of the "What you can do now" card, HELP_NEEDS and MEAL_CASH, are with the card: src/app/features/relief/reliefHelp.ts.)
 *
 *   RIDE HOME ON CREDIT   a visitor who cannot pay the cheapest fare to the main home is advanced that fare. It is a debt on the
 *                         life (state.travel.rideDebt), repaid from earnings: `share` of every wage, gig, stall collection
 *                         and gift received goes to it until it is cleared. One debt at a time, only to the main home.
 *   ODD JOBS              short paid work at the public place a city opens to a newcomer, any hour, with no minimum needs. A floor,
 *                         not a career: a small pay, a break between jobs, only while the player is short of money (`cashBelow`),
 *                         and each one counts as one of the day's paid gigs (the daily gig limit).
 *   BENCH AND TAP         a free sit-down and a drink at the same place, slowly restoring Energy and Hunger, with a break between
 *                         uses, and only while the need is below `below`.
 */
import type { ActivityDefinition } from '../../types/content.ts';

export const RIDE_CREDIT = { share: 0.5, max: 1_000_000 };
/** Open at every hour: a newcomer who arrives at night still has somewhere to turn. */
const ALWAYS = { open: 0, close: 24 };
export const ODD_JOBS: ActivityDefinition = { id: 'relief-odd-jobs', label: 'Odd jobs: carrying and sweeping', icon: '🧹', duration: 12, reward: 350, cooldown: 4 * 3600, hours: ALWAYS, effects: { energy: -3, hunger: -2 } };
export const ODD_JOBS_CASH_BELOW = 5000;
export const BENCH: ActivityDefinition = { id: 'relief-bench', label: 'Rest on a bench', icon: '🪑', duration: 15, cooldown: 4 * 3600, hours: ALWAYS, effects: { energy: 15 } };
export const TAP: ActivityDefinition = { id: 'relief-tap', label: 'Drink from the public tap', icon: '🥤', duration: 8, cooldown: 4 * 3600, hours: ALWAYS, effects: { hunger: 15 } };
/** The bench and the tap are for someone who needs them: Energy or Hunger below this. */
export const RELIEF_BELOW = 60;
