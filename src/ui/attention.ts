/**
 * OWNER: foundation (design)
 * THE ATTENTION SYSTEM: one place that decides what the player should look at next, and the few
 * ways the game is allowed to point. It grew out of the first-session coach and replaces it — there
 * is one pointer on screen at a time, never two.
 *
 *   nextStep(ctx)                         PURE. What is the one next thing to do, if any?
 *   createAttention({ root, dialog })     the DOM side, used by the shell:
 *     point(target, { text, from })       ring `target` (an element or a selector inside root / the
 *                                         dialog); if it is far from where the player is looking
 *                                         (`from`, a point — the last click — or the middle of the
 *                                         screen) a small bubble near that point names it and an
 *                                         arrow shows the way. One at a time; point(null) clears.
 *     clear()
 *     announce(text, { at, kind })        something happened elsewhere on screen (money, a low need,
 *                                         a message, an arrival): a brief pill near the middle
 *                                         pointing at `at`, then gone — and the text is said in the
 *                                         polite live region for screen readers.
 *     arrive(element, from)               cause → effect: a card that has just appeared slides in
 *                                         from the control that started it (`from`: a point).
 *     destroy()
 *
 * RULES
 *   - Nothing here keeps time. Every movement is a CSS animation that ends by itself (the ring
 *     pulses six times and then stays as a still outline); the pieces remove themselves on
 *     animationend. Nothing in the 3D scene is drawn because of a hint.
 *   - prefers-reduced-motion: the ring is a still outline, the bubble and the pill simply appear.
 *   - Never colour alone: the ring is an outline, the bubble is text with an arrow.
 *   - It tapers. Goal steps are spelled out for the first COACH_GOALS starter goals and only ringed
 *     after that; the map and trip pointers are shown the first TAPER times each and then never
 *     again; nothing is shown on a Clean screen or with Hints switched off (Settings).
 */

/** The coach spells the step out for this many starter goals; later goals only ring their control. */
export const COACH_GOALS = 3;
/** A situational pointer (Go, the trip card, a roadside prompt) is shown this many times, then retired. */
export const TAPER = 3;

/** A point on screen (CSS px). */
export interface Point { x: number; y: number }
/** The edges of a box on screen; a DOMRect fits. */
export interface Box { left: number; right: number; top: number; bottom: number }
/** The size of the viewport. */
export interface ViewSize { width: number; height: number }

/** The goal chip as the coach reads it (the full type is GoalChip in src/types/view.ts). */
export interface CoachChip { kind: string; step: number; of: number; title: string; hint: string; go?: readonly string[] | null; activity?: string; open?: string }
/** What nextStep reads of the player's state, the view and the screen. Every part is optional: a missing one means "nothing to say". */
export interface StepContext {
  state?: { location?: string; spot?: string | null; activeAction?: { kind?: string } | null } | null;
  view?: {
    connected?: boolean;
    onboarding?: { required?: boolean } | null;
    travel?: { event?: unknown } | null;
    goals?: { chip?: CoachChip | null } | null;
    activities?: { spots?: readonly { id: string; label: string }[] } | null;
  } | null;
  mode?: string;
  expanded?: boolean;
  clean?: boolean;
  hintsOff?: boolean;
  sheet?: string | null;
  seen?: Record<string, number>;
  apps?: (id: string) => { placement?: string; title: string } | undefined;
  has?: (selector: string) => boolean;
  picked?: unknown;
}
/** The one next thing to do. */
export interface NextStep { id: 'go' | 'trip' | 'roadside' | 'goal'; text: string; target: string | null; bubble: boolean; title?: string; app?: string }

const isTrip = (active?: { kind?: string } | null): boolean => active?.kind === 'travel' || active?.kind === 'commute';

/**
 * The next step. ctx: { state, view, mode ('venue' | 'map' | 'buy' | …), expanded, clean, hintsOff,
 * sheet (an open sheet's kind, or null), seen: { [stepId]: times already acted on },
 * apps: (id) → { placement, title } | undefined, has: (selector) → is that control on screen?, picked: the venue chosen on the map, or null }
 * → { id, text, target, bubble, title?, app? } | null
 *   id      what kind of step it is (for the taper): 'go' | 'trip' | 'roadside' | 'goal'
 *   target  a selector for the control to ring (null: nothing to ring, the text stands alone)
 *   bubble  true: say the text; false: ring only
 */
export function nextStep(ctx?: StepContext | null): NextStep | null {
  const { state, view, mode = 'venue', expanded = false, clean = false, hintsOff = false, sheet = null, seen = {}, apps = () => undefined, has = () => false, picked = null } = ctx || {};
  if (!state || !view || hintsOff || clean || !view.connected || view.onboarding?.required) return null;
  const fresh = (id: string): boolean => (seen[id] || 0) < TAPER;
  const active = state.activeAction;
  // A trip that is running: the first few times, say where its card is (it is easy to miss on a big screen).
  if (isTrip(active)) return mode === 'map' && fresh('trip') ? { id: 'trip', text: 'Your trip is here — time left and Cancel', target: '.map-trip', bubble: true } : null;
  // A place has been picked on the map and nothing stops the trip: Go is the next click.
  if (mode === 'map') return picked && !sheet && fresh('go') ? { id: 'go', text: 'Tap Go to travel there', target: '.map-go:not(:disabled)', bubble: true } : null;
  if (mode !== 'venue') return null;
  // Someone is waiting by the road: the chip is the way in (it never opens by itself).
  if (view.travel?.event && !active && fresh('roadside')) return { id: 'roadside', text: 'Someone is waiting — tap to answer', target: '.map-event-chip', bubble: false };
  const goal = view.goals?.chip;
  if (!goal || goal.kind !== 'goal') return null;
  const bubble = goal.step <= COACH_GOALS, title = `Goal ${goal.step} of ${goal.of} · ${goal.title}`;
  const step = (text: string, target: string | null, more?: { app?: string }): NextStep => ({ id: 'goal', text, target, bubble, title, ...more });
  if (active) {
    if (!bubble) return null;
    // Only the goal's own activity (one started at the goal's spot) is cheered on; anything else is named as a detour.
    const [goalVenue, goalSpot] = goal.go || [];
    const forGoal = Boolean(goalSpot) && state.location === goalVenue && state.spot === goalSpot;
    return step(forGoal ? 'Nice. It finishes by itself — watch the bar.' : 'This is not part of the goal. Let it finish or cancel it, then carry on.', forGoal ? '.life-progress' : null);
  }
  if (goal.go) {
    const [venueId, spotId] = goal.go;
    if (state.location !== venueId) return step(`Go ${venueId === 'home' ? 'Home' : 'there'} first: tap ${venueId === 'home' ? 'Home' : 'Map'}.`, `[data-nav="${venueId === 'home' ? 'home' : 'map'}"]`);
    const spot = view.activities?.spots?.find((item) => item.id === spotId);
    if (spot && (state.spot !== spotId || !expanded)) return step(`Tap ${spot.label} to see what you can do.`, `[data-spot="${spotId}"]`);
    // A goal that names its activity rings that card (when it is on screen); otherwise the first one that can be started.
    const own = goal.activity && has(`[data-start="${goal.activity}"]`) ? `[data-start="${goal.activity}"]` : null;
    return step(own ? `Tap it: ${goal.hint}.` : `Pick one. ${goal.hint}.`, own ?? '.life-action:not(:disabled):not(.is-blocked)');
  }
  if (goal.open) {
    const app = apps(goal.open);
    if (app?.placement === 'phone') return step(`Open Phone, then ${app.title}.`, '[data-nav="phone"]', { app: goal.open });
    if (app?.placement === 'nav') return step(`Tap ${app.title}.`, `[data-nav="${goal.open}"]`);
  }
  return null;
}
// The rings, bubbles and pills drawn on the page (createAttention, wayTo, needsBubble) are in ./attention-dom.ts: the shell fetches them after the first paint.
