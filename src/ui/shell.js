/**
 * CLIENT SHELL — the contract for every UI panel (src/ui/panels/*.js)
 * ===========================================================================
 * OWNER: foundation. The shell owns the HUD (top bar: clock, mood, name, saved state, wallet;
 * the needs strip; the goal line; the "More" tray and the Clean-screen toggle), the bottom nav
 * (Home / Buy / Map / Phone), the venue panel (spot rail, activity cards, progress + cancel),
 * the first-session coach, toasts, the connection notice, the Sim sheet and its
 * tabs, the keyboard map (src/ui/keys.js) and the help overlay. Everything else is a panel.
 * The Phone — the device, its home screen and the frame every app opens in — is drawn by
 * src/ui/phone/phone.js; the shell only decides which sheet is open and hands it over.
 *
 * THE SCENE AND THE KEYS: walking and the scene camera belong to the scene host
 * (src/venue-world.js). The shell only routes: in the venue view with no sheet open it forwards
 * the movement and camera keys as 'jaw:key' / 'jaw:key-up' window events, it announces the view
 * it is in ('jaw:mode': venue | buy | map), and it sends the `spot` action when the scene reports
 * ('jaw:scene-spot') that the avatar has walked up to a spot.
 *
 * THE HUD IS SMALL ON PURPOSE: the scene is the hero. Always visible are one top bar, the six
 * need bars as a slim strip, and one goal line. Every other HUD chip lives in the tray behind
 * the "More" button on a phone (and in a capped column on a wide screen); a chip asks for
 * attention by carrying the class `is-active`, which the shell counts into the button's badge.
 * "Clean screen" (X) hides everything except the top bar and the nav.
 *
 * HOW TO ADD OR EXTEND A PANEL
 * ----------------------------
 * Every panel is registered by src/ui/panels/index.js: eagerly if the first paint needs it,
 * otherwise as static metadata plus a lazily imported group (see that file). A lazy panel is a
 * stub with `pending: true` until its group arrives; the shell shows a loading state, calls
 * `panel.load()` and re-renders. Nothing else about the contract changes for a lazy panel.
 * A panel file default-exports one panel object, or an array of them:
 *
 *   export default {
 *     id: 'jobs',                 // unique; also the target of api.open('jobs') and data-open="jobs"
 *     title: 'Jobs',
 *     icon: 'jobs',               // optional: a GLYPH NAME of the icon set (src/ui/phone/icons.js) for the sheet
 *                                 //   head and the Sim tab. Left out, the glyph of the panel id is used. Never an
 *                                 //   emoji: no emoji is drawn anywhere in the UI (see src/ui/icon-map.js)
 *     group: 'money',             // optional, Phone apps: 'life' | 'money' | 'people' | 'city' on the home screen
 *     phone: true,                // optional: a Sim tab that is also listed as a Phone app
 *     badge(state, view) {},      // optional: the count for the red badge on the Phone icon, from data
 *                                 //   already in the view (never a fetch); falsy = no badge
 *     notifications(state, view) {}, // optional: lines for the Phone's notification list,
 *                                 //   [{ id, at, text, fresh, app, params? }] — `app` is the panel a tap opens
 *     placement: 'phone',         // see PLACEMENTS
 *     order: 20,                  // optional sort key within its placement (default 100)
 *     slot: 'goal',               // optional, 'hud' panels only: 'goal' = the single goal line,
 *                                 //   'alert' = always visible above it (something to act on now);
 *                                 //   omitted = in the tray behind "More". May be a function
 *                                 //   (state, view) → slot, for a chip that is only sometimes urgent
 *     live: true,                 // optional; false = do not re-render on every state update
 *                                 //   (use for forms; call api.refresh() yourself)
 *     enabled(state, view) {},    // optional; return true, or a string reason to disable the entry
 *     required(state, view) {},   // optional ('modal' panels); return a string reason while the panel MUST
 *                                 //   be completed: the shell opens it by itself, shows the reason, and
 *                                 //   Esc, the close button and other sheets do nothing until it returns
 *                                 //   nothing (used by character creation for a brand-new life)
 *     render(state, view, api) → html string,
 *     bind(root, api, params) {}, // optional; called after each (re)render with the panel's root element
 *                                 //   and the params it was opened with
 *     keys(action, api) {},       // optional; receives 'key:*' shortcuts while this panel is showing, and
 *                                 //   'cancel' when Esc is pressed — return true to say "handled" (the
 *                                 //   shell then does not close the panel: e.g. Esc cancels a placement
 *                                 //   first, and only a second Esc leaves Buy mode)
 *   };
 *
 * PLACEMENTS
 *   'phone'    an app on the Phone's home screen. It always opens INSIDE the phone — also when it
 *              is opened by api.open(id) from a HUD chip, a toast or another app (a deep link) —
 *              and anything opened while the phone is up stays in the phone. Esc goes back one
 *              level: app → home screen → closed (a panel's keys('cancel') still gets Esc first).
 *   'nav'      bound to the bottom-nav button with the same id ('buy', 'map'); renders inline
 *              above the nav while the scene stays visible (no modal)
 *   'hud'      a HUD chip (see `slot`); return '' to hide it. Add the class `is-active` to the
 *              chip while it has something new for the player.
 *   'sim-tab'  a tab of the Sim sheet (Profile, Needs, Goals, Skills, People, Career, Settings)
 *   'modal'    not listed anywhere; opened only by api.open(id) (onboarding, account landing)
 *
 * render(state, view, api)
 *   state  the server's life state, read-only (shape: src/life.js + each system's stateKeys)
 *   view   { ...viewLife(state) (view[systemId] from each system's view()),
 *            cityId, city: { id, name, region }, connected, session: { id, name } | null,
 *            name, now (server ms), mode, venues: [{ id, label, district, icon, description }] (icon is the content's
 *                  emoji: draw it with iconFor('venue', id, icon) from ../dom.js, never as text),
 *            net: { text, error } (the connection status line),
 *            link: 'connecting' | 'online' | 'new' | 'expired' | 'offline' | 'unreachable' — WHY the game
 *                  is or is not playable (src/client.js). `connected` is still the one flag to test for
 *                  "can anything change"; use `link` only to word the reason truthfully ("Offline" is
 *                  said only for 'offline': the device itself has no network),
 *            storage: null | { reason } (the server said it cannot save right now),
 *            params (whatever was passed to api.open(id, params)) }
 *   Return an HTML string. Escape every dynamic value with esc() from ../dom.js.
 *   The shell re-renders a showing panel when state changes and only touches the DOM if the
 *   string differs, so render must be pure and cheap: no timers, no fetches, no DOM access.
 *
 * DECLARATIVE ATTRIBUTES — handled by the shell on any element inside any panel (no bind needed)
 *   data-action="<type>" data-payload='<json>'   send a game action (api.command)
 *       optional data-then="close"               close the sheet / leave the nav panel if it succeeded
 *   data-open="<panelId>" data-params='<json>'   api.open
 *   data-close                                   api.close
 *   Use json() from ../dom.js to write the JSON attributes.
 *
 * api
 *   api.command(type, payload) → Promise<{ ok, code, reason? }>   one server action. Offline it
 *                                 resolves { ok: false, code: 'offline' } and changes nothing.
 *   api.open(panelId, params?)    open a panel (or 'phone', 'sim', 'help')
 *   api.close()                   close the sheet, or return a nav panel to the venue view
 *   api.toast(text, kind?)        top-centre toast; kind: 'info' | 'good' | 'earn' | 'spend' | 'error'.
 *                                 At most two show at once; the same text is never shown twice. The toast has
 *                                 its own glyph: an emoji the text starts with is dropped, one inside it is
 *                                 drawn as a glyph.
 *   api.fetchJson(path, { method, body, headers }?) → Promise<object>; rejects Error{ status, code }
 *   api.newId()                   a retry key for an exactly-once write: `<server ms>:<uuid>` (the action-id
 *                                 form the server requires). One per thing the player does; reuse it on a retry.
 *   api.refresh()                 re-render now (after changing your own module-level UI state);
 *                                 this also redraws a showing `live: false` panel
 *   api.redrawScene()             ask the host to draw one frame of the 3D scene now (after a
 *                                 window event changed what a scene shows). On demand only: never
 *                                 call it from a timer or a loop.
 *   api.goTo(venueId, spotId?)    go to a venue and stand at a spot there. Already at the venue:
 *                                 just select the spot. Elsewhere: open the Map travel card for it
 *                                 (mode tiles, Danfo selected) — it never starts a trip by itself;
 *                                 the spot is selected on arrival.
 *   api.toggleCommunity(force?)   show/hide the existing community (presence/chat/voice) panel
 *   api.state() / api.view()      the latest state and view, for use inside bind/keys handlers
 *
 * host (what src/life-main.js gives the shell)
 *   command, fetchJson, goTo, toggleCommunity, redrawScene — behind the api calls above
 *   onMode(mode, params)          a nav panel was entered or left
 *   onRender()                    the shell finished a render pass (the HUD may have changed size)
 *   menu(id)                      an entry of the More menu: 'city' (the country map) | 'reconnect' (also "Try again"
 *                                 in the connection notice). "Start a new life" in that notice dispatches the
 *                                 window event 'jaw:start-life', the same one the session panel sends.
 *
 * RULES
 *   - Panels never change state locally and never fetch /api/action themselves: the server is
 *     authoritative; use api.command. While offline everything is read-only.
 *   - UI-only state (selected tab, form draft) lives in module-level variables of your file.
 *   - No emoji as icons. Icons are glyphs: glyph(name) / mark(name) / iconFor(kind, id, contentIcon) / empty(name, …)
 *     from ../dom.js. Words about the connection come from src/ui/link.js (linkWords(view)): "offline" is said only
 *     when the device has no network.
 *   - Styles: import './<id>.css' from your panel file; shared values come from ../tokens.css.
 *     Prefix your class names with your panel id. Must work at 390×844 and on desktop.
 *   - No requestAnimationFrame loops, no intervals: nothing may run while the game is idle.
 *   - May import: ../dom.js, ../tokens.css, your own CSS, src/game/content/* and src/game/clock.js
 *     (pure data/helpers). Must not import the shell, other panels, src/client.js or src/life-main.js.
 *   - Panel modules are browser-only (they import CSS), so keep logic worth testing in
 *     src/game/ where `node --test` can reach it.
 */
import './tokens.css';
import './shell.css';
import { esc, money, cap, icon, json, skeleton, mark, iconFor, withGlyphs, stripLeadEmoji } from './dom.js';
import { SHORTCUTS, shortcutFor, shortcutRows, heldActionFor } from './keys.js';
import { glyph, glyphFor, hasGlyph, onGlyphs } from './phone/icons.js';
import { linkWords } from './link.js';

const NEEDS = ['hunger', 'energy', 'fun', 'social', 'hygiene', 'bladder'];
const NAV = [['home', 'Home'], ['buy', 'Buy'], ['map', 'Map'], ['phone', 'Phone']];
const MAX_TOASTS = 2;
/** A need under this is low (shown on a phone's HUD, marked beside its bar); under the second it is critical. */
const LOW_NEED = 35, CRITICAL_NEED = 20;
const TOAST_KINDS = ['info', 'good', 'earn', 'spend', 'error'];
/** The first-session coach points at the next control for this many starter goals, then stops. */
const COACH_GOALS = 3;
const COACH_KEY = 'joinallworld-coach-off';
const LOADING = skeleton();
/**
 * CONNECTION STATES (view.link, from src/client.js). Each has its own truthful wording: the word
 * "Offline" is used only when this device has no network. `pill` is the top bar's short label;
 * the notice under the top bar says what happened and offers the one action that resolves it.
 */
const LINKS = {
  connecting: { pill: 'Connecting…', icon: 'refresh', tone: 'wait', menu: 'Connecting…' },
  new: { pill: 'Not started', icon: 'person', tone: 'wait', menu: 'Choose a nickname to start', gate: 'new' },
  expired: { pill: 'Saved life not found', icon: 'cloud-off', tone: 'off', menu: 'Saved life not found · read-only', gate: 'expired',
    title: 'This device’s saved life is no longer on this server',
    text: 'The server is up, but it has no record of the life this browser remembers: its data was reset, or the session ran out. What you see is the copy kept on this device, read-only.',
    actions: [['Start a new life', 'data-new-life', true], ['Try again', 'data-menu="reconnect"', false]] },
  offline: { pill: 'No internet', icon: 'cloud-off', tone: 'off', menu: 'No internet · read-only',
    title: 'You are offline',
    text: 'This device has no internet connection. You are looking at the last saved copy; nothing changes until you are back online.',
    actions: [['Try again', 'data-menu="reconnect"', true]] },
  unreachable: { pill: 'Server unreachable', icon: 'cloud-off', tone: 'off', menu: 'Server unreachable · read-only',
    title: 'The game server is not answering',
    text: 'Your device is online, but the server could not be reached. Your life is safe there; this is the last copy kept on this device, read-only.',
    actions: [['Try again', 'data-menu="reconnect"', true]] },
};
const STORAGE_NOTICE = { title: 'The server cannot save right now', actions: [['Check again', 'data-menu="reconnect"', true]] };

export function createShell({ root, dialog, dialogContent, panels, host }) {
  let state = null, view = null, mode = 'venue', lastMode = 'venue', modeParams = null, expanded = false, sheet = null, lastSpotKey = '', forced = false;
  let trayOpen = false, clean = false, saving = 0, lastCash = null, lastNeeds = null, lastMessage = null, lastLife = '', coachOff = false;
  let wasExpanded = false;
  try { coachOff = globalThis.localStorage?.getItem(COACH_KEY) === '1'; } catch { coachOff = false; }
  const html = new WeakMap();
  const byId = new Map(panels.map((panel) => [panel.id, panel]));
  const placed = (placement) => panels.filter((panel) => panel.placement === placement);
  /** Where a HUD chip goes right now: a panel may decide per state (a knock at the door is an alert, an empty inbox is not). */
  const slotOf = (panel) => { try { return (typeof panel.slot === 'function' ? panel.slot(state, view) : panel.slot) || 'hud'; } catch { return 'hud'; } };
  const gate = (panel) => { const value = panel.enabled?.(state, view); return value === undefined || value === true ? null : String(value || 'Unavailable right now'); };

  root.classList.add('life-ui');
  root.innerHTML = `<p class="life-wordmark" aria-label="Allworld"><i aria-hidden="true">${glyph('globe')}</i><span><b>Allworld</b></span></p>
    <section class="life-status" aria-label="Player status"><i class="life-status-mark" aria-hidden="true">${glyph('globe')}</i><span class="life-clock" data-clock></span><button class="life-mood" data-open="needs" data-mood aria-label="Mood. Open your needs"></button><button class="life-status-profile" data-open="sim" data-name></button><span class="life-saved-slot" data-saved></span><button class="life-cash" data-open="bank" data-cash></button><span class="life-delta" data-delta aria-hidden="true"></span></section>
    <div class="life-notice" data-notice role="status"></div>
    <aside class="life-sidebar" aria-label="Needs, goal and more">
      <div class="life-quick"><div class="life-needs" role="group" aria-label="Your needs">${NEEDS.map((id) => `<div class="life-need" title="${cap(id)}"><span aria-hidden="true">${glyph(id)}</span><div role="meter" aria-label="${cap(id)}" aria-valuemin="0" aria-valuemax="100" data-need="${id}"><i></i></div></div>`).join('')}</div>
        <button class="life-round" data-tray-toggle aria-expanded="false" aria-controls="life-tray" aria-label="More: weather, messages, city and help" title="More">${icon('menu')}<b class="life-badge" data-badge hidden></b></button>
        <button class="life-round" data-clean aria-pressed="false" aria-label="Clean screen: hide the panels and show only the scene" title="Clean screen (X)">${icon('eye')}</button></div>
      <div class="life-alerts" data-slot="alert"></div>
      <div class="life-goal" data-slot="goal"></div>
      <div class="life-tray" id="life-tray"><div class="life-hud" data-slot="hud"></div><div class="life-menu" data-slot="menu"></div></div>
    </aside>
    <div class="life-toasts" data-toasts role="status" aria-live="polite"></div>
    <div class="life-bottom" data-bottom><div data-slot="coach"></div><div data-slot="progress"></div><div data-slot="main"></div><nav class="life-nav" aria-label="Main navigation" data-slot="nav"></nav></div>`;
  const $ = (selector) => root.querySelector(selector);
  const el = { clock: $('[data-clock]'), mood: $('[data-mood]'), name: $('[data-name]'), cash: $('[data-cash]'), delta: $('[data-delta]'), saved: $('[data-saved]'),
    toasts: $('[data-toasts]'), bottom: $('[data-bottom]'), progress: $('[data-slot="progress"]'), main: $('[data-slot="main"]'), nav: $('[data-slot="nav"]'), coach: $('[data-slot="coach"]'),
    slots: { alert: $('[data-slot="alert"]'), goal: $('[data-slot="goal"]'), hud: $('[data-slot="hud"]') }, menu: $('[data-slot="menu"]'),
    needs: $('.life-needs'), tray: $('[data-tray-toggle]'), badge: $('[data-badge]'), clean: $('[data-clean]'), sidebar: $('.life-sidebar'), notice: $('[data-notice]') };

  /** Write HTML only when it changed, so per-second updates never rebuild or reflow unchanged parts. */
  function setHtml(target, next) {
    if (html.get(target) === next) return false;
    html.set(target, next);
    target.innerHTML = next;
    return true;
  }
  function setText(target, next) { if (target.textContent !== next) target.textContent = next; }
  /** Run a one-shot CSS highlight on an element again, even if it is still running. No timer: the animation ends by itself. */
  function flash(target, name) {
    target.classList.remove('is-up', 'is-down');
    void target.offsetWidth;
    target.classList.add(name);
  }

  const api = {
    async command(type, payload) {
      saving += 1; renderSaved();
      try { return await host.command(type, payload); } finally { saving -= 1; renderSaved(); }
    },
    open, close,
    toast,
    fetchJson: (path, options) => host.fetchJson(path, options),
    newId: () => host.newId(),
    refresh: () => { forced = true; try { render(state, view); } finally { forced = false; } },
    redrawScene: () => host.redrawScene?.(),
    goTo: (venueId, spotId) => host.goTo(venueId, spotId),
    toggleCommunity: (force) => host.toggleCommunity(force),
    state: () => state,
    view: () => view,
  };

  /**
   * One line of feedback under the top bar. Never more than MAX_TOASTS at once (the oldest gives
   * way), and a text that is already showing is not repeated — a stronger kind just recolours it.
   */
  function toast(text, kind = 'info') {
    if (!text) return;
    text = String(text);
    if (kind === 'good' && /\+₦/.test(text)) kind = 'earn';
    const tone = TOAST_KINDS.includes(kind) ? kind : 'info';
    // A finished goal: the scene host answers with a sub-second burst of confetti (src/scene/reward.js).
    if (/^goal complete/i.test(stripLeadEmoji(text) || text)) window.dispatchEvent(new CustomEvent('jaw:cheer'));
    const showing = [...el.toasts.children].find((node) => node.dataset.text === text);
    if (showing) { if (tone !== 'info') { showing.className = `life-toast is-${tone}`; showing.firstChild.innerHTML = glyph(tone); } return; }
    // The toast carries its own glyph: an emoji the text starts with is dropped, one inside it is drawn as a glyph.
    const shown = stripLeadEmoji(text) || text;
    const item = document.createElement('div');
    item.className = `life-toast is-${tone}`;
    item.dataset.text = text;
    const mark = document.createElement('span'); mark.setAttribute('aria-hidden', 'true'); mark.innerHTML = glyph(tone);
    const body = document.createElement('span'); body.innerHTML = withGlyphs(shown);
    item.append(mark, body);
    el.toasts.append(item);
    placeToasts();
    while (el.toasts.children.length > MAX_TOASTS) el.toasts.firstChild.remove();
    setTimeout(() => item.remove(), Math.min(7000, 2800 + shown.length * 40));
  }
  /**
   * On a phone (and any window too narrow to keep them clear of the left column) toasts sit just
   * under the always-visible HUD rows — the needs strip, the alerts and the goal line — so even two
   * of them never cover those. Measured when a toast appears; nothing runs on a timer.
   */
  function placeToasts() {
    const narrow = globalThis.matchMedia?.('(max-width: 1000px)').matches;
    const rows = dialog.open ? [] : [el.notice, ...(narrow ? [el.sidebar.querySelector('.life-quick'), el.slots.alert, el.slots.goal] : [])];
    const bottom = Math.max(0, ...rows.map((node) => node?.getBoundingClientRect().bottom || 0));
    if (bottom > 0) el.toasts.style.setProperty('--toast-top', `${Math.round(bottom + 6)}px`);
    else el.toasts.style.removeProperty('--toast-top');
  }
  /**
   * Toasts must never be covered: a modal dialog sits in the browser's top layer, so they move
   * into it while it is open; otherwise they sit on the page above every other fixed bar.
   */
  function mountToasts() {
    const home = dialog.open ? dialog : document.body;
    if (el.toasts.parentNode !== home) home.append(el.toasts);
  }
  mountToasts();

  /**
   * The in-game phone: the home screen and every app opened inside it are drawn by
   * src/ui/phone/phone.js. Its code is not part of the first download: it is fetched as soon as the
   * shell exists (the HUD is already on screen) and stands in for this placeholder when it arrives.
   * A Phone sheet asked for before then is opened the moment the code is here.
   */
  let escAt = 0, phoneLoading = null;
  let phone = { open: false, ready: false, hosts: () => false, render: () => false, unmount() {}, back: () => false, focus() {}, destroy() {} };
  function loadPhone() {
    phoneLoading ??= import('./phone/phone.js').then((module) => {
      phone = module.createPhone({ dialog, content: dialogContent, panels,
        host: { api, panelHtml: (panel, params) => panelHtml(panel, params), bindPanels: (container, params) => bindPanels(container, params), open: (id, params) => open(id, params), close: () => close(), helpHtml: () => helpHtml() } });
      phone.ready = true;
    }).catch((error) => { phoneLoading = null; throw error; });
    return phoneLoading;
  }
  loadPhone().catch((error) => console.error('The phone could not be loaded:', error));
  // The rest of the icon set arrives with the phone and the lazy panel groups: redraw whatever showed a placeholder.
  const offGlyphs = onGlyphs(() => { if (state) api.refresh(); });

  /** The reason the open sheet may not be closed yet (a panel whose required() still returns one), or null. */
  function lockOf() {
    if (sheet?.kind !== 'panel' || !state || !view) return null;
    const panel = byId.get(sheet.id);
    const reason = panel?.required?.(state, panelView(sheet.params));
    return typeof reason === 'string' && reason ? { panel, reason } : null;
  }

  // ---- sheets (dialog) ------------------------------------------------------------------
  const sheetKey = () => (sheet ? `${sheet.kind}:${sheet.id ?? sheet.tab ?? ''}` : '');
  function open(id, params) {
    const lock = lockOf(), before = sheetKey();
    if (lock && id !== lock.panel.id && byId.get(id)?.role !== 'session-gate') { toast(lock.reason); return false; }
    // The phone's code is still on its way: open this as soon as it is here (it is requested at start, so this is rare).
    if (!phone.ready && (id === 'phone' || byId.get(id)?.placement === 'phone')) {
      loadPhone().then(() => open(id, params), () => toast('The phone could not be loaded. Check your connection and try again.', 'error'));
      return true;
    }
    // Anything opened while the phone is up stays in the phone (see src/ui/phone/phone.js).
    const inPhone = phone.hosts(sheet);
    if (id === 'phone' || id === 'help') sheet = { kind: id, from: inPhone ? 'phone' : null };
    else if (id === 'sim') sheet = { kind: 'sim', tab: params?.tab || sheet?.tab || placed('sim-tab')[0]?.id };
    else {
      const panel = byId.get(id);
      if (!panel) return false;
      const reason = gate(panel);
      if (reason) { toast(reason, 'error'); return false; }
      if (panel.placement === 'nav') { closeDialog(); setTray(false); setMode(id, params); return true; }
      if (panel.placement === 'hud') return false;
      if (panel.placement === 'sim-tab' && !inPhone) sheet = { kind: 'sim', tab: id, params };
      else sheet = { kind: 'panel', id, params, from: inPhone ? 'phone' : null };
    }
    setTray(false);
    html.delete(dialogContent);
    renderSheet();
    if (state) renderCoach();
    if (!dialog.open) { dialog.showModal(); phone.focus(); }
    // A different screen starts at its top; a form that redraws itself by re-opening keeps its place.
    if (sheetKey() !== before) dialogContent.scrollTop = 0;
    mountToasts();
    return true;
  }
  function closeDialog() { sheet = null; phone.unmount(); if (dialog.open) dialog.close(); mountToasts(); }
  function close() {
    const lock = lockOf();
    if (lock) { toast(lock.reason); return; }
    if (sheet) closeDialog();
    else if (mode !== 'venue') setMode('venue');
  }
  // Esc on a modal dialog raises 'cancel'; a required panel refuses it. Browsers let a second Esc
  // through regardless, so a required panel that gets closed is put straight back.
  dialog.addEventListener('cancel', (event) => {
    const lock = lockOf();
    if (lock) { event.preventDefault(); toast(lock.reason); }
    // The phone goes back one level per Esc / back gesture. The keydown handler usually got there first (escAt).
    else if (phone.open) { event.preventDefault(); if (performance.now() - escAt > 120) phone.back(); }
  });
  dialog.addEventListener('close', () => {
    if (dialog.open) return; // closed and opened again in the same turn: the new sheet stands
    if (lockOf()) { html.delete(dialogContent); renderSheet(); dialog.showModal(); mountToasts(); return; }
    sheet = null; phone.unmount(); html.delete(dialogContent); mountToasts();
  });
  // A tap outside the sheet (or outside the phone) closes it; a press that began inside does not.
  let pressedOutside = false;
  dialog.addEventListener('pointerdown', (event) => { pressedOutside = event.target === dialog; });
  dialog.addEventListener('click', (event) => { if (event.target === dialog && pressedOutside) close(); pressedOutside = false; });

  function setMode(next, params) {
    mode = next === 'venue' || byId.get(next)?.placement === 'nav' ? next : 'venue';
    modeParams = params ?? null;
    // The scene host walks the avatar on a tap only in the venue view (Buy mode and the map keep their own taps).
    window.dispatchEvent(new CustomEvent('jaw:mode', { detail: { mode } }));
    host.onMode(mode, params);
  }

  function panelView(params) { return { ...view, mode, params: params ?? null }; }
  /** A lazy panel's code is fetched the first time it is shown; the screen redraws itself when it arrives. */
  function fetchPanel(panel) {
    if (panel.failed) return `<div class="ui-empty"><span aria-hidden="true">${mark('cloud-off')}</span><h3>This screen did not load</h3><p>Check your connection and try again.</p><button class="ui-button is-primary" data-retry-panel="${esc(panel.id)}">Try again</button></div>`;
    panel.load().then(() => { if (state) api.refresh(); }, (error) => { console.error(`Panel ${panel.id} failed to load:`, error); panel.failed = true; if (state) api.refresh(); });
    return LOADING;
  }
  function panelHtml(panel, params) {
    if (panel.pending) return fetchPanel(panel);
    try { return panel.render(state, panelView(params), api) ?? ''; }
    catch (error) { console.error(`Panel ${panel.id} failed to render:`, error); return '<p class="ui-error">This screen could not be shown.</p>'; }
  }
  function bindPanels(container, params) {
    for (const node of container.querySelectorAll('[data-panel]')) {
      const panel = byId.get(node.dataset.panel);
      if (!panel || panel.pending) continue;
      try { panel.bind?.(node, api, params ?? null); } catch (error) { console.error(`Panel ${node.dataset.panel} failed to bind:`, error); }
    }
  }

  const sheetHead = (title, { back = false, extra = '' } = {}) => `<header class="sheet-head">${back ? `<button class="sheet-back" data-open="phone" aria-label="Back to phone">${icon('back')}</button>` : ''}${extra}<h2>${title}</h2></header>`;

  /** The glyph of a panel: its own `icon` when that names a glyph, else the glyph of its id. */
  const panelGlyph = (panel) => (hasGlyph(panel?.icon) ? panel.icon : glyphFor(panel?.id));
  const kbd = (...keys) => keys.map((key) => `<kbd>${esc(key)}</kbd>`).join(' ');
  /**
   * "Move around": how to walk, look and zoom in a venue or at home. Every key named here is read from
   * src/ui/keys.js (labelOf), so this card and the key table below it cannot disagree with what the keys do.
   */
  function moveHtml() {
    const labelOf = (run) => SHORTCUTS.find((shortcut) => shortcut.run === run)?.label || '';
    const row = (name, title, text) => `<li><i aria-hidden="true">${glyph(name)}</i><div><b>${title}</b><span>${text}</span></div></li>`;
    const walk = ['walk:up', 'walk:left', 'walk:down', 'walk:right'].map(labelOf), arrows = ['key:move-left', 'key:move-up', 'key:move-down', 'key:move-right'].map(labelOf);
    return `<h3 id="help-move">Move around</h3><ul class="help-steps help-move" aria-labelledby="help-move">${row('walk', 'Walk', `${kbd(...walk)} or the arrow keys ${kbd(...arrows)}. Hold ${kbd(labelOf('walk:jog'))} to jog. On a touch screen, drag the stick at the bottom left.`)
      }${row('pin', 'Go to a spot', `Click or tap the floor to walk there. Click a spot marker or a person and your Sim walks up to it. ${kbd('1')}–${kbd('9')} pick a spot from the keyboard.`)
      }${row('compass', 'Look around', `Drag the scene to turn the camera. ${kbd(labelOf('look:left'))} ${kbd(labelOf('look:right'))} swing it left and right; ${kbd(labelOf('look:up'))} ${kbd(labelOf('look:down'))} raise and lower it.`)
      }${row('search', 'Zoom', `Mouse wheel, pinch, or ${kbd(labelOf('key:zoom-in'))} ${kbd(labelOf('key:zoom-out'))}. ${kbd(labelOf('key:zoom-fit'))} recentres the camera on your Sim.`)
      }${row('person', 'Your Sim', `${kbd(labelOf('open:sim'))} opens your Sim: profile, needs, goals and skills. ${kbd(labelOf('clean'))} hides the panels to see the whole scene.`)}</ul>`;
  }
  /** How to play: the Help app in the phone, and the help sheet (the ? key) outside it. */
  function helpHtml() {
    const card = (name, title, text) => `<li><i aria-hidden="true">${glyph(name)}</i><div><b>${title}</b><span>${text}</span></div></li>`;
    const words = linkWords(view);
    return `<ul class="help-steps">${card('home', 'Do things', 'Pick a spot in the venue panel, then an activity. It takes real seconds and finishes on the server even if you close the tab.')}${card('map', 'Go places', 'Open the Map to travel. Every fare, trip time and closing hour is shown before you go.')}${card('phone', 'Use your phone', 'Jobs, Bank, Messages and every other app live in the Phone (P). Red badges mean something is waiting.')}${card('person', 'Look after your Sim', 'The six bars are your needs. Tap your avatar for your profile, goals, skills and people.')}</ul>
      ${moveHtml()}
      <p class="help-note">The <b>More</b> button holds the weather, the gem hunt, messages and the Nigeria map. <b>Clean screen</b> (the eye, or X) hides the panels so you can see the whole scene.</p>
      <p class="help-note">${words ? `${esc(words.why)} What you see is the last copy kept on this device, and nothing changes until that is resolved.` : 'Your progress is saved on this server under this device session. It is not a password-protected account, so keep your cookies.'}</p>
      <h3>Keyboard</h3><dl class="help-keys">${shortcutRows().map((row) => `<div><dt><kbd>${esc(row.label)}</kbd></dt><dd>${esc(row.description)}</dd></div>`).join('')}</dl>
      <button class="ui-button is-block" data-open="support">Report a problem</button>`;
  }

  function renderSheet(force = true) {
    if (!sheet || !state) return;
    // The Phone — its home screen, its apps and Help opened from it — draws itself (src/ui/phone/phone.js).
    const wasPhone = phone.open;
    if (phone.render(state, view, sheet, force)) { dialog.removeAttribute('data-locked'); return; }
    if (wasPhone) html.delete(dialogContent);
    let body = '';
    if (sheet.kind === 'help') {
      body = `${sheetHead('How to play')}<div class="sheet-body">${helpHtml()}</div>`;
    } else if (sheet.kind === 'sim') {
      const tabs = placed('sim-tab');
      const current = tabs.find((panel) => panel.id === sheet.tab) || tabs[0];
      const feeling = view.needs?.feelings?.[0];
      if (current && current.live === false && !current.pending && !force) return;
      body = `<header class="sheet-head sim-head"><span class="sim-avatar" aria-hidden="true">${mark('person')}</span><div><h2>${esc(state.name)}</h2><p>${esc(moodOf().word)}${feeling ? ` · ${esc(feeling.label)}` : ''}</p></div></header><div class="sim-tabs" role="tablist">${tabs.map((panel) => `<button role="tab" aria-selected="${panel === current}" class="${panel === current ? 'is-selected' : ''}" data-tab="${esc(panel.id)}">${mark(panelGlyph(panel))}<span>${esc(panel.title)}</span></button>`).join('')}</div><div class="sheet-body" role="tabpanel" data-panel="${esc(current?.id ?? '')}">${current ? panelHtml(current, sheet.params) : ''}</div>`;
    } else {
      const panel = byId.get(sheet.id);
      if (panel.live === false && !panel.pending && !force) return;
      const lock = lockOf();
      body = `${sheetHead(`${mark(panelGlyph(panel))}<span>${esc(panel.title)}</span>`, { back: sheet.from === 'phone' })}${lock ? `<p class="sheet-lock" role="note">${mark('lock')}<span>${esc(lock.reason)}</span></p>` : ''}<div class="sheet-body" data-panel="${esc(panel.id)}">${panelHtml(panel, sheet.params)}</div>`;
    }
    dialog.toggleAttribute('data-locked', Boolean(lockOf()));
    if (setHtml(dialogContent, body)) {
      bindPanels(dialogContent, sheet.params);
      // The selected Sim tab is always in view, even the last one of the row.
      const tabs = dialogContent.querySelector('.sim-tabs'), chosen = tabs?.querySelector('.is-selected');
      if (chosen) tabs.scrollLeft = Math.max(0, chosen.offsetLeft - (tabs.clientWidth - chosen.offsetWidth) / 2);
    }
  }

  /** The mood word shown in the HUD and the Sim header: the character system's five words, else the core label. */
  function moodOf() {
    const mood = view.onboarding?.mood;
    return mood?.word ? mood : { word: view.needs.mood.label, icon: view.needs.mood.icon, tone: view.needs.mood.score < 25 ? 'bad' : view.needs.mood.score < 45 ? 'warn' : 'good', score: view.needs.mood.score };
  }

  // ---- HUD (shell-owned) ----------------------------------------------------------------
  /** The connection state the view reports; older hosts that send none are read from `connected`. */
  const linkOf = () => (view.connected ? 'online' : Object.hasOwn(LINKS, view.link) ? view.link : 'unreachable');
  function renderSaved() {
    if (!view) return;
    const net = view.net?.text || '', link = LINKS[linkOf()];
    const pill = (tone, name, text, title) => `<span class="life-saved is-${tone}" role="status" title="${esc(title)}"><i aria-hidden="true">${glyph(name)}</i><span>${esc(text)}</span></span>`;
    setHtml(el.saved, link
      ? link.tone === 'wait' && !link.gate ? pill('saving', link.icon, link.pill, net)
        : `<button class="life-saved is-off${link.tone === 'wait' ? ' is-wait' : ''}" ${link.gate ? `data-open-gate="${link.gate}"` : 'data-menu="reconnect"'} title="${esc(net)}"><i aria-hidden="true">${glyph(link.icon)}</i><span>${esc(link.pill)}</span></button>`
      : view.storage ? pill('off is-unsaved', 'error', 'Not saving', view.storage.reason)
        : saving > 0 ? pill('saving', 'refresh', 'Saving…', 'Sending your action to the server')
          : pill('ok', 'good', 'Saved', net || 'Progress saved on the server'));
    renderNotice();
  }
  /**
   * The notice under the top bar: shown for as long as the game cannot be played or saved, with
   * what happened in plain words and the action that resolves it. It is measured once when it
   * changes so the HUD column starts below it.
   */
  function renderNotice() {
    const link = LINKS[linkOf()];
    const info = link?.title ? link : !link && view.storage ? { ...STORAGE_NOTICE, text: `${view.storage.reason} You are still connected; nothing new is kept until it can save again.` } : null;
    const body = info ? `<i aria-hidden="true">${glyph(link ? 'cloud-off' : 'error')}</i><div><strong>${esc(info.title)}</strong><p>${esc(info.text)}</p></div><span class="life-notice-actions">${info.actions.map(([label, attrs, primary]) => `<button class="ui-button${primary ? ' is-primary' : ''}" ${attrs}>${esc(label)}</button>`).join('')}</span>` : '';
    if (!setHtml(el.notice, body)) return;
    el.notice.classList.toggle('is-storage', Boolean(info) && !link);
    root.classList.toggle('has-notice', Boolean(info));
    root.style.setProperty('--notice-h', info ? `${Math.ceil(el.notice.getBoundingClientRect().height)}px` : '0px');
  }
  function setTray(next) {
    if (trayOpen === next) return;
    trayOpen = next;
    root.classList.toggle('is-tray-open', trayOpen);
    el.tray.setAttribute('aria-expanded', String(trayOpen));
  }
  function setClean(next) {
    clean = next;
    if (clean) setTray(false);
    root.classList.toggle('is-clean', clean);
    el.clean.setAttribute('aria-pressed', String(clean));
    el.clean.innerHTML = icon(clean ? 'eye-off' : 'eye');
    el.clean.title = clean ? 'Show the panels again (X)' : 'Clean screen (X)';
  }
  function menuHtml() {
    const atHome = state.location === 'home', net = view.net || {};
    const link = LINKS[linkOf()];
    return `<p class="life-brand"><strong><span>Allworld</span></strong><small>${esc(link ? link.menu : 'City beta')}</small></p>
      <button data-menu="city"><span aria-hidden="true">${glyph('globe')}</span><span><b>${esc(view.city?.name || 'City')}, Nigeria</b><small>See Nigeria: your city and what is coming</small></span></button>
      <button data-community><span aria-hidden="true">${glyph('community')}</span><span><b>Community</b><small>${atHome ? 'Home is private — visit a venue to chat' : 'People, chat and voice at this venue'}</small></span></button>
      <button data-open="help"><span aria-hidden="true">${glyph('help')}</span><span><b>How to play</b><small>Tips and keyboard shortcuts</small></span></button>
      <p class="life-net ${net.error ? 'is-error' : ''}" role="status">${esc(net.text || '')}</p>${link && link.tone === 'off' ? '<button class="life-menu-retry" data-menu="reconnect">Try again</button>' : ''}`;
  }

  // ---- venue panel (shell-owned) --------------------------------------------------------
  function effectTags(card) {
    const tags = Object.entries(card.effects || {}).filter(([, amount]) => amount).map(([need, amount]) => (amount > 0 ? { text: `+${amount} ${cap(need)}` } : { text: `−${-amount} ${cap(need)}`, cost: true }));
    for (const [need, rate] of Object.entries(card.effectsPerSecond || {})) if (rate > 0) tags.push({ text: `+${rate} ${cap(need)}/s` });
    for (const [skill, amount] of Object.entries(card.xp || {})) tags.push({ text: `+${amount} ${cap(skill)} XP` });
    if (card.beta) tags.push({ text: 'Beta', beta: true });
    return tags;
  }
  /**
   * One compact activity card: icon and name, then time and price, then either what it gives or —
   * when it cannot be started — the one reason why. Every card has the same height.
   */
  function activityCard(card) {
    const blocked = card.blocked;
    const unavailable = blocked?.code === 'unavailable';
    const busy = Boolean(state.activeAction), offline = !view.connected;
    const disabled = Boolean(blocked) || busy || offline;
    const price = card.reward > 0 ? `+${money(card.reward)}` : card.cost > 0 ? money(card.cost) : 'Free';
    const unmet = Object.entries(card.minimumNeeds || {}).filter(([need, minimum]) => state.needs[need] < minimum).map(([need, minimum]) => `${cap(need)} ${Math.floor(state.needs[need])}/${minimum}`);
    const why = unavailable ? (card.requiresSkill ? `Needs ${cap(card.requiresSkill.id)} level ${card.requiresSkill.level}` : 'Unavailable in this preview')
      : unmet.length ? `Needs ${unmet.join(', ')}` : blocked?.code === 'gig_limit' ? 'Today’s gigs are done · back at midnight' : blocked ? blocked.reason : offline ? `${linkWords(view)?.short || 'Not connected'} — cannot start now` : '';
    const busyWhy = !why && busy ? 'Finish or cancel what you are doing first' : '';
    // The card shows the short line; the tooltip and the screen-reader label carry the server's full sentence.
    const full = blocked?.code === 'gig_limit' ? blocked.reason : why || busyWhy;
    const foot = why ? `<span class="life-lock">${mark('lock')} ${esc(why)}</span>`
      : `<span class="life-tags">${effectTags(card).map((tag) => `<span${tag.cost ? ' class="is-cost"' : tag.beta ? ' class="is-beta"' : ''}>${esc(tag.text)}</span>`).join('')}</span>`;
    const inner = `<span class="life-action-head"><span class="life-action-emoji" aria-hidden="true">${iconFor('activity', card.id, card.icon)}</span><span class="life-action-title">${esc(card.label)}</span></span><span class="life-action-meta"><span>${mark('clock')} ${esc(card.duration)}s</span><strong class="${card.reward > 0 ? 'is-earn' : card.cost > 0 ? 'is-cost' : ''}">${price}</strong></span>${foot}`;
    const classes = `life-action ${unavailable ? 'is-unavailable' : why ? 'is-blocked' : busy ? 'is-busy' : ''}`;
    const label = `${esc(card.label)}, ${esc(card.duration)} seconds, ${esc(price)}${full ? `. ${esc(full)}` : ''}`;
    if (card.choices && !unavailable) {
      return `<div class="${classes} has-choices" role="group" aria-label="${label}">${inner}<span class="life-choices">${card.choices.map((choice) => `<button data-start="${esc(card.id)}" data-choice="${esc(choice.id)}" ${disabled ? `disabled title="${esc(full)}"` : ''}>${esc(choice.label)}</button>`).join('')}</span></div>`;
    }
    return `<button class="${classes}" data-start="${esc(card.id)}" ${disabled ? 'disabled' : ''} title="${esc(full)}" aria-label="${label}">${inner}</button>`;
  }
  function venuePanel() {
    const venue = view.venues.find((item) => item.id === state.location) || { label: state.location, district: '' };
    const privateHome = state.location === 'home';
    const activities = view.activities;
    const spots = activities.spots.filter((spot) => !privateHome || spot.id !== 'people');
    const spot = spots.find((item) => item.id === state.spot);
    // Home shows the player's own house; the line under the name is the venue's ambient line, which
    // changes only when the view is rebuilt (a state update or an action) — there is no timer.
    const house = privateHome ? view.property?.house : null;
    const title = house?.label || venue.label, district = house?.district || venue.district;
    const ambient = view.travel?.destinations?.find((item) => item.id === state.location)?.ambient;
    const line = !view.connected ? (LINKS[linkOf()]?.menu || 'Not connected · read-only') : `${privateHome ? 'Private · ' : ''}${ambient || spot?.caption || 'Explore at your own pace'}`;
    const lineMark = privateHome && view.connected ? `${mark('lock')} ` : '';
    const busyNote = state.activeAction && expanded ? '<p class="life-actions-note" role="note">Finish or cancel what you are doing to start something else.</p>' : '';
    // Where this spot lists paid gigs, the day's counter sits above them (view.travel.gigs; the limit is the server's).
    const gigs = view.travel?.gigs, gigIds = view.travel?.gigsHere || [];
    const gigNote = expanded && gigs && activities.cards.some((card) => gigIds.includes(card.id))
      ? `<p class="life-actions-note life-gigs${gigs.left ? '' : ' is-out'}" role="note" title="Paid gigs are limited each Lagos day. Your job’s shift does not count."><b>Gigs today: ${esc(gigs.used)}/${esc(gigs.limit)}</b> · ${gigs.left ? `${esc(gigs.left)} left` : 'open again at midnight, Lagos time'}</p>` : '';
    const cards = activities.cards.length ? activities.cards.map(activityCard).join('')
      : `<div class="ui-empty is-inline"><p>${spot ? 'Nothing to do at this spot yet.' : 'Pick a spot above to see what you can do there.'}</p></div>`;
    return `<section class="life-venue-panel" aria-label="Current venue"><header class="life-venue-header"><button class="life-avatar" data-open="sim" aria-label="Open your Sim: profile, needs, goals and skills">${mark('person')}</button><div class="life-venue-heading"><h1>${iconFor('venue', venue.id, venue.icon)} ${esc(title)} <span>· ${esc(district)}</span></h1><p>${lineMark}${esc(line)}</p></div>${privateHome || !view.connected ? '' : `<button class="life-icon-button" data-community aria-label="Open community chat" title="Community chat">${icon('chat')}</button>`}<button class="life-icon-button" data-open="map" aria-label="Open map" title="Map (M)">${icon('map')}</button></header><div class="life-spots"><button class="life-expand ${expanded ? 'is-expanded' : ''}" data-toggle-activities aria-expanded="${expanded}" aria-label="${expanded ? 'Hide' : 'Show'} activities" title="Activities (T)">${icon('chevron')}</button>${spots.map((item, i) => `<button class="${item.id === state.spot ? 'is-selected' : ''}" data-spot="${esc(item.id)}" aria-pressed="${item.id === state.spot}" title="Shortcut ${i + 1}">${iconFor('spot', item.id, item.icon)}<span>${esc(item.label)}</span></button>`).join('')}${privateHome || spots.some((item) => item.id === 'people') ? '' : `<button data-community>${mark('people')}<span>People</span></button>`}</div>${expanded ? `${busyNote}${gigNote}<div class="life-actions">${cards}</div>` : ''}</section>`;
  }
  const isTrip = (active) => active?.kind === 'travel' || active?.kind === 'commute';
  const placeOf = (id) => { const venue = view.venues.find((item) => item.id === id); return { label: !venue ? 'your destination' : id === 'home' ? 'Home' : venue.label }; };
  /**
   * What is running right now, as a small chip above the nav: its name, the time left and Cancel.
   * A trip is named by where it goes; the trip itself (route, fare, the cancel rule) is the Map panel's trip bar.
   */
  function progressHtml() {
    const active = state.activeAction;
    if (!active) return '';
    const activity = view.activities.active;
    // Timed actions that are not activities name themselves by kind; the id is the venue they head for.
    const place = placeOf(active.id).label;
    const name = activity?.label || (active.kind === 'travel' ? `Travelling to ${place}` : active.kind === 'commute' ? `Commuting to work · ${place}` : 'Action in progress');
    const paid = activity?.reward > 0, sleeping = Boolean(activity?.tags?.includes('sleep'));
    const fixed = activity && !activity.cancellable;
    return `<section class="life-progress" aria-label="Current activity"><span class="life-progress-icon" aria-hidden="true">${activity ? iconFor('activity', activity.id, activity.icon) : mark(active.kind === 'commute' ? 'jobs' : isTrip(active) ? 'compass' : 'clock')}</span><div><strong>${esc(name)}</strong><small data-remaining></small></div><button data-cancel ${fixed ? 'disabled title="This cannot be cancelled once started"' : ''} aria-label="${fixed ? 'This cannot be cancelled once started' : paid ? 'Cancel shift. Cancelling earns nothing' : sleeping ? 'Wake up. The rest you got is kept' : 'Cancel current activity'}">${sleeping ? 'Wake up' : 'Cancel'}</button><progress max="1" value="0" data-progress aria-label="Activity progress"></progress>${paid ? `<p class="life-progress-note">Pays ${money(activity.reward)} when finished. Cancelling earns nothing.</p>` : fixed ? '<p class="life-progress-note">This cannot be cancelled once started.</p>' : ''}</section>`;
  }
  function navHtml() {
    return NAV.map(([id, label]) => {
      const panel = byId.get(id);
      const reason = panel?.placement === 'nav' ? gate(panel) : null;
      const selected = mode === id || (id === 'home' && mode === 'venue' && state.location === 'home');
      // A nav tab that cannot be used yet stays tappable and says why, instead of being a dead button.
      return `<button data-nav="${id}" ${reason ? `aria-disabled="true" data-why="${esc(reason)}" title="${esc(reason)}"` : ''} ${selected ? 'aria-current="page"' : ''} class="${selected ? 'is-selected' : ''}${reason ? ' is-off' : ''}">${icon(id)}<span>${label}</span></button>`;
    }).join('');
  }

  /**
   * First-session coach: for the first COACH_GOALS starter goals it names the next control and
   * rings it. It is silent once those goals are done, when dismissed, and whenever a sheet,
   * the map or Buy mode is in front. → { text, target (selector within root) } | null
   */
  function coachStep() {
    if (coachOff || clean || mode !== 'venue' || !view.connected || view.onboarding?.required) return null;
    const goal = view.goals?.chip;
    if (!goal || goal.kind !== 'goal' || goal.step > COACH_GOALS) return null;
    const active = state.activeAction;
    if (active) {
      if (isTrip(active)) return null;
      // Only the goal's own activity (one started at the goal's spot) is cheered on; anything else is named as a detour.
      const [goalVenue, goalSpot] = goal.go || [];
      const forGoal = Boolean(goalSpot) && state.location === goalVenue && state.spot === goalSpot;
      return { text: forGoal ? 'Nice. It finishes by itself — watch the bar.' : 'This is not part of the goal. Let it finish or cancel it, then carry on.', target: null };
    }
    if (goal.go) {
      const [venueId, spotId] = goal.go;
      if (state.location !== venueId) return { text: `Go ${venueId === 'home' ? 'Home' : 'there'} first: tap ${venueId === 'home' ? 'Home' : 'Map'}.`, target: `[data-nav="${venueId === 'home' ? 'home' : 'map'}"]` };
      const spot = view.activities.spots.find((item) => item.id === spotId);
      if (spot && (state.spot !== spotId || !expanded)) return { text: `Tap ${spot.label} to see what you can do.`, target: `[data-spot="${spotId}"]` };
      return { text: `Pick one. ${goal.hint}.`, target: '.life-action:not(:disabled):not(.is-blocked)' };
    }
    if (goal.open) {
      const app = byId.get(goal.open);
      if (app?.placement === 'phone') return { text: `Open Phone, then ${app.title}.`, target: '[data-nav="phone"]', app: app.id };
      if (app?.placement === 'nav') return { text: `Tap ${app.title}.`, target: `[data-nav="${goal.open}"]` };
    }
    return null;
  }
  function renderCoach() {
    const step = coachStep(), goal = view.goals?.chip;
    // One line of guidance at a time: while the coach is talking, a phone's HUD drops the goal chip that says the same thing.
    root.classList.toggle('has-coach', Boolean(step));
    setHtml(el.coach, step ? `<div class="life-coach" role="note"><span aria-hidden="true">${mark('pointer')}</span><p><b>Goal ${esc(goal.step)} of ${esc(goal.of)} · ${esc(goal.title)}</b>${esc(step.text)}</p><button data-coach-off aria-label="Hide these tips">${icon('close')}</button></div>` : '');
    for (const node of [...root.querySelectorAll('.is-coach'), ...dialogContent.querySelectorAll('.is-coach')]) node.classList.remove('is-coach');
    if (step?.target) root.querySelector(step.target)?.classList.add('is-coach');
    if (step?.app && sheet?.kind === 'phone') dialogContent.querySelector(`[data-ph-app="${step.app}"]`)?.classList.add('is-coach');
  }

  // ---- render ---------------------------------------------------------------------------
  function render(nextState, nextView) {
    state = nextState; view = nextView;
    if (!state || !view) return;
    // A different life (another city, a new session): compare nothing against the old one.
    const life = `${view.session?.id ?? ''}:${view.cityId}`;
    if (life !== lastLife) { lastLife = life; lastCash = null; lastNeeds = null; lastMessage = null; }
    setText(el.clock, view.clock);
    const mood = moodOf();
    if (setHtml(el.mood, `${iconFor('mood', mood.tone, mood.icon)}<span>${esc(mood.word)}</span>`)) el.mood.setAttribute('aria-label', `Mood: ${mood.word}. Open your needs`);
    el.mood.classList.toggle('is-uneasy', mood.tone === 'warn');
    el.mood.classList.toggle('is-bad', mood.tone === 'bad');
    el.mood.classList.toggle('is-neutral', mood.tone === 'neutral');
    if (el.name.dataset.shown !== state.name) { el.name.dataset.shown = state.name; el.name.innerHTML = `${glyph('person')}<span>${esc(state.name)}</span>`; }
    renderSaved();

    // Wallet: a change is flashed and written out with its reason from the ledger.
    const cashText = money(state.cash);
    if (el.cash.textContent !== cashText) { el.cash.textContent = cashText; el.cash.setAttribute('aria-label', `Wallet ${cashText}. Open the bank and your transactions`); }
    if (lastCash !== null && view.connected && state.cash !== lastCash) {
      const change = state.cash - lastCash, entry = view.wallet?.ledger?.[0];
      el.delta.textContent = `${change > 0 ? '+' : '−'}${money(Math.abs(change))}${entry && entry.amount === change ? ` · ${entry.reason}` : ''}`;
      flash(el.delta, change > 0 ? 'is-up' : 'is-down');
      flash(el.cash, change > 0 ? 'is-up' : 'is-down');
    }
    if (view.connected) lastCash = state.cash;

    const needs = {};
    for (const need of view.needs.order) {
      const meter = root.querySelector(`[data-need="${need}"]`), value = Math.round(state.needs[need]);
      needs[need] = value;
      if (meter.getAttribute('aria-valuenow') !== String(value)) {
        // Low (under 35) and critical (under 20) are said three ways: the colour, a mark beside the bar, and the word a screen reader hears.
        const low = value < LOW_NEED, bad = value < CRITICAL_NEED, row = meter.parentNode;
        meter.style.setProperty('--need', `${value}%`); meter.setAttribute('aria-valuenow', value); meter.setAttribute('aria-valuetext', `${value}%${bad ? ', critical' : low ? ', low' : ''}`);
        row.classList.toggle('is-low', low); row.classList.toggle('is-critical', bad);
      }
      // A gain, or a sharp drop, is highlighted once; the slow decay is not.
      const before = lastNeeds?.[need];
      if (before !== undefined && (value - before >= 1 || before - value >= 3)) flash(meter.parentNode, value > before ? 'is-up' : 'is-down');
    }
    lastNeeds = needs;
    // On a phone the strip shows only the needs that are low; with none low it steps aside (the mood in the top bar opens them all).
    el.needs.classList.toggle('has-low', Object.values(needs).some((value) => value < LOW_NEED));

    const hud = placed('hud');
    for (const [slot, target] of Object.entries(el.slots)) {
      const chips = hud.filter((panel) => slotOf(panel) === slot).map((panel) => { const body = panelHtml(panel); return body ? `<div data-panel="${esc(panel.id)}">${body}</div>` : ''; }).join('');
      if (setHtml(target, chips)) bindPanels(target);
    }
    setHtml(el.menu, menuHtml());
    const waiting = el.slots.hud.querySelectorAll('.is-active').length;
    el.badge.hidden = !waiting;
    setText(el.badge, String(waiting));
    el.tray.setAttribute('aria-label', `More: weather, messages, city and help${waiting ? `. ${waiting} waiting` : ''}`);

    // What the server last said becomes a toast when it changes; it never sits on the scene.
    const active = state.activeAction;
    const text = state.message || '';
    if (lastMessage !== null && text && text !== lastMessage && !(active && (text === (view.activities.active?.label || '') || text.startsWith('Travelling to ')))) toast(text);
    lastMessage = text;

    // What is running — an activity or a trip — is always the small progress chip (with Cancel), also on a Clean screen.
    // A trip itself is shown on the map: the host sends the shell there for as long as one runs (onMode in src/life-main.js).
    setHtml(el.progress, progressHtml());
    root.classList.toggle('is-expanded', expanded && mode === 'venue');
    // The cards rise in once, when the rail is opened — not on the redraws that follow while it stays open.
    const opened = expanded && mode === 'venue';
    root.classList.toggle('is-opening', opened && !wasExpanded);
    wasExpanded = opened;
    root.dataset.mode = mode;

    const navPanel = mode !== 'venue' ? byId.get(mode) : null;
    const rail = el.main.querySelector('.life-spots');
    const railLeft = rail?.scrollLeft || 0;
    const cardsLeft = el.main.querySelector('.life-actions')?.scrollLeft || 0;
    const mainHtml = navPanel ? `<section class="life-sheet" aria-label="${esc(navPanel.title)}" data-panel="${esc(navPanel.id)}">${panelHtml(navPanel, modeParams)}</section>` : venuePanel();
    if (navPanel?.live === false && html.has(el.main) && lastMode === mode && !forced) { /* static nav panel: leave as is until api.refresh() */ }
    else if (setHtml(el.main, mainHtml)) {
      if (navPanel) bindPanels(el.main, modeParams);
      else {
        if (!rail) lastSpotKey = '';
        const sameSpot = lastSpotKey === `${state.location}:${state.spot}`;
        restoreRail(railLeft);
        const cards = el.main.querySelector('.life-actions');
        if (cards && sameSpot) cards.scrollLeft = cardsLeft;
      }
    }
    if (active) {
      const scope = el.progress;
      const bar = scope.querySelector('[data-progress]');
      if (bar) bar.value = Math.max(0, Math.min(1, 1 - active.remaining / (active.duration || 1)));
      const left = scope.querySelector('[data-remaining]');
      if (left) setText(left, `${Math.ceil(active.remaining)}s left`);
    }
    lastMode = mode;
    setHtml(el.nav, navHtml());
    renderSheet(forced);
    renderCoach();
    // A panel that must be completed opens by itself (and comes back if anything replaced it).
    if (view.connected) {
      const must = panels.find((panel) => panel.placement === 'modal' && typeof panel.required?.(state, panelView()) === 'string');
      if (must && !(sheet?.kind === 'panel' && (sheet.id === must.id || byId.get(sheet.id)?.role === 'session-gate'))) { sheet = null; open(must.id); }
    }
    // The HUD may have changed size (activities opened, Clean screen, a trip): the host re-centres the scene if so.
    host.onRender?.();
  }

  /** Rebuilding resets the spot rail: keep the scroll position and reveal a newly selected spot. */
  function restoreRail(left) {
    const rail = el.main.querySelector('.life-spots');
    if (!rail) { lastSpotKey = ''; return; }
    rail.scrollLeft = left;
    const key = `${state.location}:${state.spot}`;
    if (key === lastSpotKey) return;
    lastSpotKey = key;
    const selected = rail.querySelector('.is-selected[data-spot]');
    const bounds = rail.getBoundingClientRect();
    if (!selected || bounds.width <= 0) return;
    const box = selected.getBoundingClientRect();
    if (box.left < bounds.left + 52) rail.scrollLeft += box.left - bounds.left - 52;
    else if (box.right > bounds.right - 8) rail.scrollLeft += box.right - bounds.right + 8;
  }

  // ---- input ----------------------------------------------------------------------------
  function parse(text) { try { return text ? JSON.parse(text) : undefined; } catch { return undefined; } }
  async function onClick(event) {
    const target = event.target.closest('[data-start],[data-cancel],[data-spot],[data-nav],[data-toggle-activities],[data-community],[data-tab],[data-action],[data-open],[data-close],[data-menu],[data-tray-toggle],[data-clean],[data-coach-off],[data-retry-panel],[data-new-life],[data-open-gate]');
    if (!target || target.disabled || !(root.contains(target) || dialog.contains(target))) return;
    const data = target.dataset;
    if ('trayToggle' in data) { setTray(!trayOpen); return; }
    if ('clean' in data) { setClean(!clean); api.refresh(); return; }
    if ('coachOff' in data) { coachOff = true; try { globalThis.localStorage?.setItem(COACH_KEY, '1'); } catch { /* still off for this visit */ } api.refresh(); return; }
    if ('retryPanel' in data) { const panel = byId.get(data.retryPanel); if (panel) { panel.failed = false; api.refresh(); } return; }
    if ('menu' in data) { setTray(false); host.menu?.(data.menu); return; }
    // The connection notice: one tap starts a new life (the same event the session panel sends), or opens the session panel.
    if ('newLife' in data) { window.dispatchEvent(new CustomEvent('jaw:start-life', { detail: { name: null } })); return; }
    if ('openGate' in data) { const gatePanel = panels.find((panel) => panel.role === 'session-gate' && panel.id !== 'session') || byId.get('session'); if (gatePanel) open(gatePanel.id, { reason: data.openGate }); return; }
    if ('start' in data) { expanded = false; await api.command('activity', { id: data.start, ...(data.choice ? { choice: data.choice } : {}) }); }
    else if ('cancel' in data) await api.command('cancel');
    else if ('spot' in data) { expanded = true; await api.command('spot', { id: data.spot }); api.refresh(); }
    else if ('toggleActivities' in data) { expanded = !expanded; api.refresh(); }
    else if ('community' in data) { closeDialog(); setTray(false); api.toggleCommunity(true); }
    else if ('tab' in data) { sheet = { kind: 'sim', tab: data.tab }; renderSheet(); dialogContent.scrollTop = 0; }
    else if ('nav' in data) { if (data.why) toast(data.why, 'error'); else navigate(data.nav); }
    else if ('action' in data) {
      const result = await api.command(data.action, parse(data.payload));
      if (result.ok && data.then === 'close') close();
      // A sheet covers the scene, so a successful action inside one confirms itself with a toast.
      else if (result.ok && sheet && dialog.open && state.message) toast(state.message, 'good');
    }
    else if ('open' in data) open(data.open, parse(data.params));
    else if ('close' in data) close();
  }
  /** A tap anywhere outside the tray closes it. */
  function onOutside(event) { if (trayOpen && !el.sidebar.contains(event.target)) setTray(false); }
  function navigate(id) {
    if (clean) setClean(false);
    if (id === 'phone') open('phone');
    else if (id === 'home') {
      // At home (or already on the way somewhere): show the scene. Elsewhere: the travel card for Home, never a silent trek.
      closeDialog();
      if (state.location === 'home' || isTrip(state.activeAction)) setMode('venue'); else api.goTo('home');
    }
    else if (mode === id) setMode('venue');
    else open(id);
  }
  function showing() {
    if (sheet?.kind === 'panel') return byId.get(sheet.id);
    if (sheet?.kind === 'sim') return byId.get(sheet.tab);
    return mode !== 'venue' ? byId.get(mode) : null;
  }
  function onKey(event) {
    const typing = event.target.matches?.('input, textarea, select, [contenteditable]');
    if (typing && event.key !== 'Escape') return;
    const shortcut = shortcutFor(event);
    if (!shortcut || !state) return;
    const [verb, arg] = shortcut.run.split(':');
    const lock = lockOf();
    if (lock) { if (verb === 'close') toast(lock.reason); return; } // nothing but the required panel responds
    if (verb === 'key') {
      if (event.key === 'Enter' && event.target.matches?.('button, a, summary')) return;
      showing()?.keys?.(arg, api);
      // In the venue view the arrows walk the avatar (the scene host listens); they must not also scroll the spot rail.
      if (mode === 'venue' && !dialog.open && arg.startsWith('move-')) event.preventDefault();
      window.dispatchEvent(new CustomEvent('jaw:key', { detail: { action: arg, mode: dialog.open ? 'sheet' : mode, jog: event.shiftKey } }));
      return;
    }
    if (verb === 'walk' || verb === 'look') {
      // Held keys for the scene host: only in the venue view, never under a sheet (typing was ruled out above).
      if (mode === 'venue' && !dialog.open) { if (arg !== 'jog') event.preventDefault(); window.dispatchEvent(new CustomEvent('jaw:key', { detail: { action: `${verb}-${arg}`, mode, jog: event.shiftKey } })); }
      return;
    }
    if (dialog.open && verb !== 'close' && verb !== 'open' && verb !== 'help') return;
    if (verb === 'close') {
      // The showing panel gets Esc first ('cancel'); if it handled it, nothing is closed.
      let handled = false;
      try { handled = showing()?.keys?.('cancel', api) === true; } catch (error) { console.error('Panel failed to handle Esc:', error); }
      if (handled) { event.preventDefault(); return; }
      // In the phone Esc goes back one level: notifications → app → home screen → closed.
      if (phone.open) { event.preventDefault(); escAt = performance.now(); phone.back(); return; }
      if (sheet || mode !== 'venue') close();
      else if (trayOpen) setTray(false);
      else if (clean) { setClean(false); api.refresh(); }
      else if (expanded) { expanded = false; api.refresh(); }
    }
    else if (verb === 'help') open('help');
    else if (verb === 'clean') { setClean(!clean); api.refresh(); }
    else if (verb === 'nav') navigate(arg);
    else if (verb === 'toggle') { if (mode === 'venue') { if (clean) setClean(false); expanded = !expanded; api.refresh(); } }
    else if (verb === 'spot') { const spot = view.activities.spots[Number(arg) - 1]; if (spot && mode === 'venue' && !state.activeAction) { expanded = true; api.command('spot', { id: spot.id }).then(api.refresh); } }
    else if (verb === 'open') {
      const isOpen = (sheet?.kind === arg) || (sheet?.kind === 'panel' && sheet.id === arg) || (sheet?.kind === 'sim' && sheet.tab === arg) || mode === arg || (arg === 'phone' && phone.open);
      if (isOpen) close(); else open(arg);
    }
  }
  /** A movement or camera key was released: always forwarded, so a key can never stay "held" in the scene. */
  function onKeyUp(event) { const action = heldActionFor(event); if (action) window.dispatchEvent(new CustomEvent('jaw:key-up', { detail: { action } })); }
  /**
   * The avatar walked up to a spot in the scene. Selecting it is still the server's `spot` action;
   * `open` (the player sent the avatar there on purpose) also shows the spot's activities.
   */
  function onSceneSpot(event) {
    const { id, open: show } = event.detail || {};
    if (!state || !view?.connected || mode !== 'venue' || dialog.open || state.activeAction || !view.activities.spots.some((spot) => spot.id === id)) return;
    if (id === state.spot) { if (show && !expanded) { expanded = true; api.refresh(); } return; }
    if (show) expanded = true;
    api.command('spot', { id }).then(api.refresh);
  }
  root.addEventListener('click', onClick);
  dialog.addEventListener('click', onClick);
  document.addEventListener('pointerdown', onOutside);
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('jaw:scene-spot', onSceneSpot);

  return {
    api, render, open, close, toast,
    get mode() { return mode; },
    setMode,
    setExpanded(value) { expanded = Boolean(value); },
    destroy() { offGlyphs(); phone.destroy(); el.toasts.remove(); root.removeEventListener('click', onClick); dialog.removeEventListener('click', onClick); document.removeEventListener('pointerdown', onOutside); window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKeyUp); window.removeEventListener('jaw:scene-spot', onSceneSpot); root.replaceChildren(); root.classList.remove('life-ui'); },
  };
}
