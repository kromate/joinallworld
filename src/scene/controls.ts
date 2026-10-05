/**
 * OWNER: scenes
 * On-screen controls for the scene, for touch and for anyone who prefers buttons: zoom in, zoom
 * out, recentre the camera, a virtual joystick (shown on touch devices only) and a one-time hint.
 * They live inside the scene container, under the HUD overlay, and are placed with the same
 * insets the host uses to centre the scene — so they sit in the part of the screen the HUD
 * leaves free and never under the bottom sheet.
 *
 * Clean screen (the shell's `is-clean` class) hides everything here except the joystick.
 * Nothing here runs on a timer: the joystick only reports pointer events to the host.
 *
 * THE HINT teaches one thing at a time and then leaves. teach([{ id, text }, …]) gives the lessons
 * in order (walk, then look); the first one not yet learned is shown, and learned(id) — called by
 * the host the moment the player actually does that thing — retires it and brings up the next.
 * Each lesson is remembered on the device, so it is never shown again; × retires them all. On a
 * wide screen it is a pill under the top bar; on a phone it sits in the free band at the bottom of
 * the scene, between the joystick and the zoom buttons — next to the control it talks about, and
 * never over the avatar or the HUD's rows.
 *
 * This file also carries the few styles the scene's name tags need beyond the shell's (the crown and
 * dot marks, the hover state, the spot label shown while the pointer is on a marker).
 *
 * createSceneControls(container, { onZoom(direction), onRecentre(), onStick(x, forward, jog) })
 *   → { place({ top, bottom, wide, hintTop }), touch(on), teach(lessons), learned(id), hint(text | null), dispose() }, or null without a DOM.
 */
const STYLE_ID = 'scene-controls-style';
const HINT_KEY = 'joinallworld-move-hint';
const CSS = `
.scene-controls{position:absolute;inset:0;pointer-events:none;z-index:2;font:600 12px/1.3 system-ui,-apple-system,"Segoe UI",sans-serif;--sc-top:76px;--sc-bottom:16px}
.scene-pad{position:absolute;right:max(10px,env(safe-area-inset-right));bottom:var(--sc-bottom);display:grid;gap:6px;pointer-events:none}
.scene-pad button{pointer-events:auto;width:44px;height:44px;border:1px solid rgba(255,255,255,.85);border-radius:50%;background:rgba(250,252,249,.9);color:#1d2a26;font:700 20px/1 system-ui,sans-serif;display:grid;place-items:center;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.25);-webkit-tap-highlight-color:transparent;touch-action:manipulation;padding:0}
.scene-pad button:active{background:#fff;transform:scale(.95)}
.scene-pad button:focus-visible,.scene-hint button:focus-visible{outline:3px solid #ffd34d;outline-offset:2px}
.scene-pad svg{width:20px;height:20px;display:block}
.scene-stick{position:absolute;left:max(12px,env(safe-area-inset-left));bottom:var(--sc-bottom);width:104px;height:104px;border-radius:50%;background:rgba(18,32,28,.3);border:2px solid rgba(255,255,255,.6);pointer-events:auto;touch-action:none;display:none;-webkit-tap-highlight-color:transparent;user-select:none;-webkit-user-select:none}
.scene-controls.is-touch .scene-stick{display:block}
.scene-stick i{position:absolute;left:50%;top:50%;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;background:rgba(255,255,255,.9);box-shadow:0 2px 8px rgba(0,0,0,.3);pointer-events:none}
.scene-hint{position:absolute;left:50%;top:var(--sc-hint-top,var(--sc-top));transform:translateX(-50%);display:flex;align-items:center;gap:6px;max-width:calc(100% - 24px);padding:6px 6px 6px 12px;border-radius:999px;background:rgba(18,32,28,.84);color:#fff;pointer-events:auto;box-shadow:0 2px 8px rgba(0,0,0,.25);text-align:center}
.scene-controls.is-narrow .scene-hint{top:auto;bottom:calc(var(--sc-bottom) + 6px);left:max(12px,env(safe-area-inset-left));right:calc(max(10px,env(safe-area-inset-right)) + 54px);transform:none;max-width:none;width:fit-content;padding:5px 4px 5px 12px;border-radius:16px;font-size:12px;line-height:1.3;text-align:left;pointer-events:none}
.scene-controls.is-narrow.is-touch .scene-hint{left:calc(max(12px,env(safe-area-inset-left)) + 114px)}
.scene-controls.is-narrow .scene-hint button{pointer-events:auto;width:36px;height:36px;font-size:15px}
.scene-tag{touch-action:none;user-select:none;-webkit-user-select:none}
.scene-tag.is-hover{outline:2px solid #ffd34d;outline-offset:1px}
.scene-tag svg{display:block;width:18px;height:18px}
.scene-tag i{display:block;width:10px;height:10px;border-radius:50%;background:currentColor;box-shadow:0 0 3px rgba(0,0,0,.7)}
.scene-spot-hint{position:absolute;transform:translate(-50%,-100%);margin-top:-14px;padding:3px 9px;border-radius:999px;background:rgba(255,211,77,.96);color:#2a2410;font:700 12px/1.3 system-ui,-apple-system,"Segoe UI",sans-serif;white-space:nowrap;pointer-events:none;box-shadow:0 2px 6px rgba(0,0,0,.3)}
.scene-spot-hint[hidden]{display:none}
.scene-hint[hidden]{display:none}
.scene-reward{position:absolute;display:grid;justify-items:center;gap:4px;transform:translate(-50%,-100%);pointer-events:none;z-index:3}
.scene-reward span{display:inline-flex;align-items:center;gap:5px;padding:4px 11px 4px 8px;border-radius:999px;background:rgba(255,255,255,.97);color:#14532d;font:700 13px/1.25 system-ui,-apple-system,"Segoe UI",sans-serif;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.3);opacity:0;animation:scene-reward 1.5s cubic-bezier(.2,.8,.2,1) forwards}
.scene-reward span:nth-child(2){animation-delay:.12s}.scene-reward span:nth-child(3){animation-delay:.24s}.scene-reward span:nth-child(4){animation-delay:.36s}
.scene-reward svg{width:15px;height:15px;display:block;flex:none}
.scene-reward .is-money{background:#1d6b43;color:#fff}
.scene-reward .is-loss{color:#8a3f1d}
.scene-reward .is-xp{color:#0b4f96}
@keyframes scene-reward{0%{opacity:0;transform:translateY(14px) scale(.8)}16%{opacity:1;transform:translateY(0) scale(1.07)}26%{transform:translateY(0) scale(1)}76%{opacity:1;transform:translateY(-10px)}100%{opacity:0;transform:translateY(-34px)}}
@keyframes scene-reward-still{0%,80%{opacity:1}100%{opacity:0}}
.scene-hint button{flex:none;width:32px;height:32px;border:0;border-radius:50%;background:rgba(255,255,255,.16);color:#fff;font:700 16px/1 system-ui,sans-serif;cursor:pointer;padding:0}
body:has(.life-ui.is-clean) .scene-pad,body:has(.life-ui.is-clean) .scene-hint{display:none}
/* One line of guidance at a time: while the goal coach is talking (the first starter goals), the camera and walking lesson waits its turn. */
body:has(.life-ui.has-coach) .scene-hint{display:none}
body.map-open .scene-controls{display:none}
@media (max-height:520px){.scene-controls.is-narrow .scene-hint,.scene-controls.is-narrow.is-touch .scene-hint{top:var(--sc-hint-top,var(--sc-top));bottom:auto;left:50%;right:auto;transform:translateX(-50%);width:max-content;max-width:calc(100% - 240px)}}
@media (prefers-reduced-motion:reduce){.scene-pad button:active{transform:none}.scene-reward span{animation:scene-reward-still 1.6s steps(1,end) forwards;animation-delay:0s!important}}
`;
const ICON_HOME = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4"/></svg>';

export interface SceneLesson { id: string; text: string }
export interface SceneControlsOptions {
  onZoom?: (direction: number) => void;
  onRecentre?: () => void;
  onStick?: (right: number, forward: number, jog: boolean) => void;
}
export interface SceneControls {
  root: HTMLElement;
  place(insets?: { top?: number; bottom?: number; wide?: boolean; hintTop?: number }): void;
  touch(on: unknown): void;
  readonly isTouch: boolean;
  hint(text: string | null | undefined): void;
  teach(list: Array<SceneLesson | null | undefined> | null | undefined): void;
  learned(id: string): void;
  readonly lesson: string | null;
  release(): void;
  dispose(): void;
}

export function createSceneControls(container: HTMLElement | null | undefined, { onZoom, onRecentre, onStick }: SceneControlsOptions = {}): SceneControls | null {
  const doc = globalThis.document;
  if (!doc?.createElement || !container?.appendChild) return null;
  if (!doc.getElementById(STYLE_ID)) {
    const style = doc.createElement('style');
    style.id = STYLE_ID; style.textContent = CSS;
    doc.head.appendChild(style);
  }
  const root = doc.createElement('div');
  root.className = 'scene-controls';
  root.innerHTML = `<div class="scene-stick" aria-hidden="true"><i></i></div>
    <div class="scene-pad" role="group" aria-label="Camera">
      <button type="button" data-scene="zoom-in" aria-label="Zoom in" title="Zoom in (+)">+</button>
      <button type="button" data-scene="zoom-out" aria-label="Zoom out" title="Zoom out (−)">−</button>
      <button type="button" data-scene="recentre" aria-label="Recentre the camera on you" title="Recentre (0)">${ICON_HOME}</button>
    </div>
    <p class="scene-hint" role="note" hidden><span></span><button type="button" data-scene="hint-off" aria-label="Hide this tip">×</button></p>`;
  container.appendChild(root);
  const stick = root.querySelector<HTMLElement>('.scene-stick')!, knob = stick.firstElementChild as HTMLElement, hint = root.querySelector<HTMLElement>('.scene-hint')!;
  let seen = false;
  try { seen = globalThis.localStorage?.getItem(HINT_KEY) === '1'; } catch { seen = false; }

  const remember = (key: string) => { try { globalThis.localStorage?.setItem(key, '1'); } catch { /* shown again next visit */ } };
  const known = (key: string) => { try { return globalThis.localStorage?.getItem(key) === '1'; } catch { return false; } };
  let lessons: SceneLesson[] = [], showing: string | null = null;
  /** Retire every lesson for good (the × button, or hint(null)). */
  function hideHint() {
    for (const lesson of lessons) remember(`${HINT_KEY}:${lesson.id}`);
    lessons = []; showing = null;
    if (hint.hidden) return;
    hint.hidden = true; seen = true;
    remember(HINT_KEY);
  }
  /** Show the first lesson that has not been learned, or nothing. */
  function showLesson() {
    const next = seen ? null : lessons.find((lesson) => !known(`${HINT_KEY}:${lesson.id}`)) || null;
    showing = next?.id ?? null;
    if (!next) { hint.hidden = true; return; }
    hint.firstElementChild!.textContent = next.text;
    hint.hidden = false;
  }
  root.addEventListener('click', (event) => {
    const action = (event.target as Element | null)?.closest?.<HTMLElement>('[data-scene]')?.dataset.scene;
    if (action === 'zoom-in') onZoom?.(1);
    else if (action === 'zoom-out') onZoom?.(-1);
    else if (action === 'recentre') onRecentre?.();
    else if (action === 'hint-off') hideHint();
  });

  // The joystick: a drag from its centre, reported as right / forward in −1…1. Full deflection jogs.
  let stickPointer: number | null = null;
  const REACH = 36;
  function stickMove(event: PointerEvent) {
    if (event.pointerId !== stickPointer) return;
    const box = stick.getBoundingClientRect();
    let dx = event.clientX - (box.left + box.width / 2), dy = event.clientY - (box.top + box.height / 2);
    const size = Math.hypot(dx, dy);
    if (size > REACH) { dx *= REACH / size; dy *= REACH / size; }
    knob.style.transform = `translate(${dx.toFixed(1)}px,${dy.toFixed(1)}px)`;
    const dead = size < 6;
    onStick?.(dead ? 0 : dx / REACH, dead ? 0 : -dy / REACH, size >= REACH * 0.97);
    event.preventDefault();
  }
  function stickEnd(event: PointerEvent) {
    if (event.pointerId !== stickPointer) return;
    stickPointer = null;
    try { stick.releasePointerCapture?.(event.pointerId); } catch { /* already released */ }
    knob.style.transform = '';
    onStick?.(0, 0, false);
  }
  stick.addEventListener('pointerdown', (event) => {
    if (stickPointer !== null) return;
    stickPointer = event.pointerId;
    try { stick.setPointerCapture?.(event.pointerId); } catch { /* not capturable */ }
    stickMove(event);
  });
  stick.addEventListener('pointermove', stickMove);
  stick.addEventListener('pointerup', stickEnd);
  stick.addEventListener('pointercancel', stickEnd);
  stick.addEventListener('lostpointercapture', stickEnd);

  const controls: SceneControls = {
    root,
    /** Where the HUD leaves room: CSS pixels covered at the top and the bottom; wide = the bottom corners are free. */
    place({ top = 0, bottom = 0, wide = false, hintTop = 0 } = {}) {
      root.style.setProperty('--sc-top', `${Math.round(top + 8)}px`);
      root.style.setProperty('--sc-hint-top', `${Math.round(Math.max(top, hintTop) + 8)}px`);
      root.style.setProperty('--sc-bottom', `${Math.round(wide ? 16 : bottom + 10)}px`);
      root.classList.toggle('is-narrow', !wide);
    },
    touch(on) { root.classList.toggle('is-touch', Boolean(on)); },
    get isTouch() { return root.classList.contains('is-touch'); },
    /** Show the one-time hint (never again once dismissed or once the player has moved). */
    hint(text) {
      if (!text) { hideHint(); return; }
      if (seen) return;
      hint.firstElementChild!.textContent = text;
      hint.hidden = false;
    },
    /** The lessons, in the order they are taught: [{ id, text }]. Shows the first one not yet learned. */
    teach(list) { lessons = Array.isArray(list) ? list.filter((lesson): lesson is SceneLesson => Boolean(lesson?.id && lesson.text)) : []; showLesson(); },
    /** The player just did this: retire that lesson and bring up the next. A lesson that is not the one showing is simply remembered. */
    learned(id) {
      if (!lessons.some((lesson) => lesson.id === id) || known(`${HINT_KEY}:${id}`)) return;
      remember(`${HINT_KEY}:${id}`);
      if (showing === id) showLesson();
    },
    get lesson() { return showing; },
    release() { if (stickPointer !== null) { stickPointer = null; knob.style.transform = ''; } },
    dispose() { root.remove(); },
  };
  return controls;
}
