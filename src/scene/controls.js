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
 * createSceneControls(container, { onZoom(direction), onRecentre(), onStick(x, forward, jog) })
 *   → { place({ top, bottom, wide }), touch(on), hint(text | null), dispose() }, or null without a DOM.
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
.scene-hint{position:absolute;left:50%;top:var(--sc-top);transform:translateX(-50%);display:flex;align-items:center;gap:6px;max-width:calc(100% - 24px);padding:6px 6px 6px 12px;border-radius:999px;background:rgba(18,32,28,.84);color:#fff;pointer-events:auto;box-shadow:0 2px 8px rgba(0,0,0,.25);text-align:center}
.scene-controls.is-narrow .scene-hint{top:auto;bottom:calc(var(--sc-bottom) + 122px)}
.scene-hint[hidden]{display:none}
.scene-hint button{flex:none;width:32px;height:32px;border:0;border-radius:50%;background:rgba(255,255,255,.16);color:#fff;font:700 16px/1 system-ui,sans-serif;cursor:pointer;padding:0}
body:has(.life-ui.is-clean) .scene-pad,body:has(.life-ui.is-clean) .scene-hint{display:none}
body.map-open .scene-controls{display:none}
@media (prefers-reduced-motion:reduce){.scene-pad button:active{transform:none}}
`;
const ICON_HOME = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4"/></svg>';

export function createSceneControls(container, { onZoom, onRecentre, onStick } = {}) {
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
  const stick = root.querySelector('.scene-stick'), knob = stick.firstElementChild, hint = root.querySelector('.scene-hint');
  let seen = false;
  try { seen = globalThis.localStorage?.getItem(HINT_KEY) === '1'; } catch { seen = false; }

  function hideHint() {
    if (hint.hidden) return;
    hint.hidden = true; seen = true;
    try { globalThis.localStorage?.setItem(HINT_KEY, '1'); } catch { /* shown again next visit */ }
  }
  root.addEventListener('click', (event) => {
    const action = event.target.closest?.('[data-scene]')?.dataset.scene;
    if (action === 'zoom-in') onZoom?.(1);
    else if (action === 'zoom-out') onZoom?.(-1);
    else if (action === 'recentre') onRecentre?.();
    else if (action === 'hint-off') hideHint();
  });

  // The joystick: a drag from its centre, reported as right / forward in −1…1. Full deflection jogs.
  let stickPointer = null;
  const REACH = 36;
  function stickMove(event) {
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
  function stickEnd(event) {
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
    hideHint();
    stickMove(event);
  });
  stick.addEventListener('pointermove', stickMove);
  stick.addEventListener('pointerup', stickEnd);
  stick.addEventListener('pointercancel', stickEnd);
  stick.addEventListener('lostpointercapture', stickEnd);

  return {
    root,
    /** Where the HUD leaves room: CSS pixels covered at the top and the bottom; wide = the bottom corners are free. */
    place({ top = 0, bottom = 0, wide = false } = {}) {
      root.style.setProperty('--sc-top', `${Math.round(top + 8)}px`);
      root.style.setProperty('--sc-bottom', `${Math.round(wide ? 16 : bottom + 10)}px`);
      // On a narrow screen the rows under the top bar (needs, alerts, the goal line) are the HUD's: the hint sits above the controls instead.
      root.classList.toggle('is-narrow', !wide);
    },
    touch(on) { root.classList.toggle('is-touch', Boolean(on)); },
    get isTouch() { return root.classList.contains('is-touch'); },
    /** Show the one-time hint (never again once dismissed or once the player has moved). */
    hint(text) {
      if (!text) { hideHint(); return; }
      if (seen) return;
      hint.firstElementChild.textContent = text;
      hint.hidden = false;
    },
    release() { if (stickPointer !== null) { stickPointer = null; knob.style.transform = ''; } },
    dispose() { root.remove(); },
  };
}
