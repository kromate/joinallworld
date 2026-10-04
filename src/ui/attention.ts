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

const isTrip = (active) => active?.kind === 'travel' || active?.kind === 'commute';

/**
 * The next step. ctx: { state, view, mode ('venue' | 'map' | 'buy' | …), expanded, clean, hintsOff,
 * sheet (an open sheet's kind, or null), seen: { [stepId]: times already acted on },
 * apps: (id) → { placement, title } | undefined, has: (selector) → is that control on screen?, picked: the venue chosen on the map, or null }
 * → { id, text, target, bubble, title?, app? } | null
 *   id      what kind of step it is (for the taper): 'go' | 'trip' | 'roadside' | 'goal'
 *   target  a selector for the control to ring (null: nothing to ring, the text stands alone)
 *   bubble  true: say the text; false: ring only
 */
export function nextStep(ctx) {
  const { state, view, mode = 'venue', expanded = false, clean = false, hintsOff = false, sheet = null, seen = {}, apps = () => undefined, has = () => false, picked = null } = ctx || {};
  if (!state || !view || hintsOff || clean || !view.connected || view.onboarding?.required) return null;
  const fresh = (id) => (seen[id] || 0) < TAPER;
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
  const step = (text, target, more) => ({ id: 'goal', text, target, bubble, title, ...more });
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

/** Which way is `to` from `from`, as one of eight arrows, and how far (CSS px). Pure. */
export function wayTo(from, to) {
  const dx = to.x - from.x, dy = to.y - from.y, far = Math.hypot(dx, dy);
  const turn = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
  return { far, arrow: ['→', '↘', '↓', '↙', '←', '↖', '↑', '↗'][((turn % 8) + 8) % 8] };
}

/** A pointer is worth a bubble only when the target is off-screen or a good way from where the player is looking. Pure. */
export function needsBubble(from, box, view) {
  const off = box.right < 0 || box.bottom < 0 || box.left > view.width || box.top > view.height;
  const to = { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 };
  return off || Math.hypot(to.x - from.x, to.y - from.y) > Math.max(260, Math.min(view.width, view.height) * 0.32);
}

export function createAttention({ root, dialog } = {}) {
  const doc = globalThis.document;
  if (!doc?.createElement) return { point() {}, clear() {}, announce() {}, arrive() {}, destroy() {} };
  const layer = doc.createElement('div');
  layer.className = 'attn';
  // What is said for screen readers: polite, and separate from the toasts so neither swallows the other.
  const live = doc.createElement('p');
  live.className = 'ui-sr'; live.setAttribute('role', 'status'); live.setAttribute('aria-live', 'polite');
  layer.append(live);
  doc.body.append(layer);
  const reduced = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  const view = () => ({ width: globalThis.innerWidth || 0, height: globalThis.innerHeight || 0 });
  const middle = () => ({ x: view().width / 2, y: view().height * 0.56 });
  const clampTo = (value, low, high) => Math.max(low, Math.min(high, value));
  const find = (target) => (typeof target === 'string' ? (dialog?.open && dialog.querySelector(target)) || root.querySelector(target) : target) || null;
  const home = () => (dialog?.open ? dialog : doc.body);
  let ringed = null, bubble = null, said = '';

  function clear() {
    ringed?.classList.remove('is-coach');
    ringed = null;
    bubble?.remove(); bubble = null;
  }
  function point(target, { text = '', from = null, say = true } = {}) {
    const node = find(target);
    if (node !== ringed) { ringed?.classList.remove('is-coach'); ringed = node; node?.classList.add('is-coach'); }
    if (!node || !text) { bubble?.remove(); bubble = null; if (!node) said = ''; return node; }
    if (say && text !== said) { said = text; live.textContent = text; }
    const box = node.getBoundingClientRect(), at = from || middle();
    if (!needsBubble(at, box, view())) { bubble?.remove(); bubble = null; return node; }
    const to = { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 }, way = wayTo(at, to), words = `${text} ${way.arrow}`;
    // The same pointer again (the HUD redraws every second): leave the bubble as it is, so it does not start over.
    if (bubble?.textContent === words) return node;
    bubble?.remove();
    bubble = doc.createElement('p');
    bubble.className = 'attn-bubble'; bubble.setAttribute('aria-hidden', 'true');
    bubble.textContent = words;
    // Beside where the player is looking, a step towards the target, and always fully on screen.
    const step = Math.min(120, way.far * 0.25), size = view();
    bubble.style.left = `${Math.round(clampTo(at.x + ((to.x - at.x) / (way.far || 1)) * step, 120, size.width - 120))}px`;
    bubble.style.top = `${Math.round(clampTo(at.y + ((to.y - at.y) / (way.far || 1)) * step, 70, size.height - 110))}px`;
    if (layer.parentNode !== home()) home().append(layer);
    layer.append(bubble);
    return node;
  }
  function announce(text, { at = null, kind = 'info' } = {}) {
    if (!text) return;
    live.textContent = text;
    const node = find(at), size = view();
    const pill = doc.createElement('p');
    pill.className = `attn-cue is-${kind}`; pill.setAttribute('aria-hidden', 'true');
    let arrow = '';
    if (node) { const box = node.getBoundingClientRect(); arrow = ` ${wayTo({ x: size.width / 2, y: size.height * 0.4 }, { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 }).arrow}`; }
    pill.textContent = `${text}${arrow}`;
    layer.querySelector('.attn-cue')?.remove();
    if (layer.parentNode !== home()) home().append(layer);
    layer.append(pill);
    pill.addEventListener('animationend', (event) => { if (event.animationName === 'attn-cue' || event.animationName === 'attn-cue-still') pill.remove(); });
    // The place it happened answers too: one flash of its outline.
    if (node && !reduced()) { node.classList.remove('is-noted'); void node.offsetWidth; node.classList.add('is-noted'); node.addEventListener('animationend', () => node.classList.remove('is-noted'), { once: true }); }
  }
  function arrive(element, from) {
    if (!element || !from || reduced()) return;
    const box = element.getBoundingClientRect();
    if (!box.width) return;
    element.style.setProperty('--attn-x', `${Math.round(from.x - (box.left + box.width / 2))}px`);
    element.style.setProperty('--attn-y', `${Math.round(from.y - (box.top + box.height / 2))}px`);
    element.classList.remove('attn-arrive'); void element.offsetWidth; element.classList.add('attn-arrive');
    element.addEventListener('animationend', () => element.classList.remove('attn-arrive'), { once: true });
  }
  return { point, clear, announce, arrive, destroy() { clear(); layer.remove(); } };
}
