/**
 * CLIENT SHELL — the contract for every UI panel (src/ui/panels/*.js)
 * ===========================================================================
 * OWNER: foundation. The shell owns the HUD (top bar: clock, mood, name, saved state, wallet;
 * the needs strip; the goal line; the "More" tray and the Clean-screen toggle), the bottom nav
 * (Home / Buy / Map / Phone), the venue panel (spot rail, activity cards, progress + cancel),
 * the travel view, the first-session coach, toasts, the Phone app grid, the Sim sheet and its
 * tabs, the keyboard map (src/ui/keys.js) and the help overlay. Everything else is a panel.
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
 *     icon: '💼',                 // emoji or short text shown in the Phone grid / tab
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
 *   'phone'    an app in the Phone grid; opens in the sheet with a back button
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
 *            name, now (server ms), mode, venues: [{ id, label, district, icon, description }],
 *            net: { text, error } (the connection status line),
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
 *                                 At most two show at once; the same text is never shown twice.
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
 *   menu(id)                      an entry of the More menu: 'city' | 'locate' | 'reconnect'
 *
 * RULES
 *   - Panels never change state locally and never fetch /api/action themselves: the server is
 *     authoritative; use api.command. While offline everything is read-only.
 *   - UI-only state (selected tab, form draft) lives in module-level variables of your file.
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
import { esc, money, cap, icon, json } from './dom.js';
import { shortcutFor, shortcutRows } from './keys.js';

const NEED_ICONS = { hunger: '🍲', energy: '⚡', fun: '🎉', social: '💬', hygiene: '🫧', bladder: '🚻' };
const NAV = [['home', 'Home'], ['buy', 'Buy'], ['map', 'Map'], ['phone', 'Phone']];
const MAX_TOASTS = 2;
const TOAST_ICONS = { info: '💬', good: '✅', earn: '💰', spend: '💸', error: '🚫' };
/** The first-session coach points at the next control for this many starter goals, then stops. */
const COACH_GOALS = 3;
const COACH_KEY = 'joinallworld-coach-off';
const LOADING = '<div class="ui-loading" role="status">Loading…</div>';

export function createShell({ root, dialog, dialogContent, panels, host }) {
  let state = null, view = null, mode = 'venue', lastMode = 'venue', modeParams = null, expanded = false, sheet = null, lastSpotKey = '', forced = false;
  let trayOpen = false, clean = false, saving = 0, lastCash = null, lastNeeds = null, lastMessage = null, lastLife = '', coachOff = false;
  try { coachOff = globalThis.localStorage?.getItem(COACH_KEY) === '1'; } catch { coachOff = false; }
  const html = new WeakMap();
  const byId = new Map(panels.map((panel) => [panel.id, panel]));
  const placed = (placement) => panels.filter((panel) => panel.placement === placement);
  /** Where a HUD chip goes right now: a panel may decide per state (a knock at the door is an alert, an empty inbox is not). */
  const slotOf = (panel) => { try { return (typeof panel.slot === 'function' ? panel.slot(state, view) : panel.slot) || 'hud'; } catch { return 'hud'; } };
  const gate = (panel) => { const value = panel.enabled?.(state, view); return value === undefined || value === true ? null : String(value || 'Unavailable right now'); };

  root.classList.add('life-ui');
  root.innerHTML = `<section class="life-status" aria-label="Player status"><span class="life-clock" data-clock></span><span class="life-mood" data-mood></span><button class="life-status-profile" data-open="sim" data-name></button><span class="life-saved-slot" data-saved></span><button class="life-cash" data-open="bank" data-cash></button><span class="life-delta" data-delta aria-hidden="true"></span></section>
    <aside class="life-sidebar" aria-label="Needs, goal and more">
      <div class="life-quick"><div class="life-needs" role="group" aria-label="Your needs">${Object.entries(NEED_ICONS).map(([id, emoji]) => `<div class="life-need" title="${cap(id)}"><span aria-hidden="true">${emoji}</span><div role="meter" aria-label="${cap(id)}" aria-valuemin="0" aria-valuemax="100" data-need="${id}"><i></i></div></div>`).join('')}</div>
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
    tray: $('[data-tray-toggle]'), badge: $('[data-badge]'), clean: $('[data-clean]'), sidebar: $('.life-sidebar') };

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
    const tone = Object.hasOwn(TOAST_ICONS, kind) ? kind : 'info';
    const showing = [...el.toasts.children].find((node) => node.dataset.text === text);
    if (showing) { if (tone !== 'info') { showing.className = `life-toast is-${tone}`; showing.firstChild.textContent = TOAST_ICONS[tone]; } return; }
    const item = document.createElement('div');
    item.className = `life-toast is-${tone}`;
    item.dataset.text = text;
    const mark = document.createElement('span'); mark.setAttribute('aria-hidden', 'true'); mark.textContent = TOAST_ICONS[tone];
    const body = document.createElement('span'); body.textContent = text;
    item.append(mark, body);
    el.toasts.append(item);
    placeToasts();
    while (el.toasts.children.length > MAX_TOASTS) el.toasts.firstChild.remove();
    setTimeout(() => item.remove(), Math.min(7000, 2800 + text.length * 40));
  }
  /**
   * On a phone (and any window too narrow to keep them clear of the left column) toasts sit just
   * under the always-visible HUD rows — the needs strip, the alerts and the goal line — so even two
   * of them never cover those. Measured when a toast appears; nothing runs on a timer.
   */
  function placeToasts() {
    const narrow = globalThis.matchMedia?.('(max-width: 1000px)').matches;
    const rows = narrow && !dialog.open ? [el.sidebar.querySelector('.life-quick'), el.slots.alert, el.slots.goal] : [];
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
    if (id === 'phone' || id === 'help') sheet = { kind: id };
    else if (id === 'sim') sheet = { kind: 'sim', tab: params?.tab || sheet?.tab || placed('sim-tab')[0]?.id };
    else {
      const panel = byId.get(id);
      if (!panel) return false;
      const reason = gate(panel);
      if (reason) { toast(reason, 'error'); return false; }
      if (panel.placement === 'nav') { closeDialog(); setTray(false); setMode(id, params); return true; }
      if (panel.placement === 'hud') return false;
      if (panel.placement === 'sim-tab') sheet = { kind: 'sim', tab: id, params };
      else sheet = { kind: 'panel', id, params, from: sheet?.kind === 'phone' || sheet?.from === 'phone' ? 'phone' : null };
    }
    setTray(false);
    html.delete(dialogContent);
    renderSheet();
    if (state) renderCoach();
    if (!dialog.open) dialog.showModal();
    // A different screen starts at its top; a form that redraws itself by re-opening keeps its place.
    if (sheetKey() !== before) dialogContent.scrollTop = 0;
    mountToasts();
    return true;
  }
  function closeDialog() { sheet = null; if (dialog.open) dialog.close(); mountToasts(); }
  function close() {
    const lock = lockOf();
    if (lock) { toast(lock.reason); return; }
    if (sheet) closeDialog();
    else if (mode !== 'venue') setMode('venue');
  }
  // Esc on a modal dialog raises 'cancel'; a required panel refuses it. Browsers let a second Esc
  // through regardless, so a required panel that gets closed is put straight back.
  dialog.addEventListener('cancel', (event) => { const lock = lockOf(); if (lock) { event.preventDefault(); toast(lock.reason); } });
  dialog.addEventListener('close', () => {
    if (lockOf()) { html.delete(dialogContent); renderSheet(); dialog.showModal(); mountToasts(); return; }
    sheet = null; html.delete(dialogContent); mountToasts();
  });

  function setMode(next, params) {
    mode = next === 'venue' || byId.get(next)?.placement === 'nav' ? next : 'venue';
    modeParams = params ?? null;
    host.onMode(mode, params);
  }

  function panelView(params) { return { ...view, mode, params: params ?? null }; }
  /** A lazy panel's code is fetched the first time it is shown; the screen redraws itself when it arrives. */
  function fetchPanel(panel) {
    if (panel.failed) return `<div class="ui-empty"><span aria-hidden="true">📡</span><h3>This screen did not load</h3><p>Check your connection and try again.</p><button class="ui-button is-primary" data-retry-panel="${esc(panel.id)}">Try again</button></div>`;
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

  function renderSheet(force = true) {
    if (!sheet || !state) return;
    let body = '';
    if (sheet.kind === 'phone') {
      body = `${sheetHead('Phone')}<div class="phone-grid">${placed('phone').map((panel) => { const reason = gate(panel); return `<button class="phone-app" data-open="${esc(panel.id)}" ${reason ? `disabled title="${esc(reason)}"` : ''}><span aria-hidden="true">${esc(panel.icon || '📱')}</span>${esc(panel.title)}</button>`; }).join('')}<button class="phone-app" data-community><span aria-hidden="true">💬</span>Community</button><button class="phone-app" data-open="help"><span aria-hidden="true">❓</span>Help</button></div>`;
    } else if (sheet.kind === 'help') {
      body = `${sheetHead('How to play')}<div class="sheet-body"><p>Pick a spot in the venue panel, then an activity. Activities take real seconds and finish on the server even if you close the tab. Open Map to travel, Phone for apps, and your avatar for your Sim.</p><p>The <b>☰ More</b> button holds the weather, the gem hunt, messages, the city switch and this help. <b>Clean screen</b> (the eye, or X) hides the panels so you can see the whole scene.</p><p>${view.connected ? 'Your progress is saved on this server under this device session — it is not a password-protected account, so keep your cookies.' : 'You are offline: what you see is the last saved state, and nothing changes until you reconnect.'}</p><h3>Keyboard</h3><dl class="help-keys">${shortcutRows().map((row) => `<div><dt><kbd>${esc(row.label)}</kbd></dt><dd>${esc(row.description)}</dd></div>`).join('')}</dl></div>`;
    } else if (sheet.kind === 'sim') {
      const tabs = placed('sim-tab');
      const current = tabs.find((panel) => panel.id === sheet.tab) || tabs[0];
      const feeling = view.needs?.feelings?.[0];
      if (current && current.live === false && !current.pending && !force) return;
      body = `<header class="sheet-head sim-head"><span class="sim-avatar" aria-hidden="true">👤</span><div><h2>${esc(state.name)}</h2><p>${esc(moodOf().word)}${feeling ? ` · ${esc(feeling.label)}` : ''}</p></div></header><div class="sim-tabs" role="tablist">${tabs.map((panel) => `<button role="tab" aria-selected="${panel === current}" class="${panel === current ? 'is-selected' : ''}" data-tab="${esc(panel.id)}">${esc(panel.title)}</button>`).join('')}</div><div class="sheet-body" role="tabpanel" data-panel="${esc(current?.id ?? '')}">${current ? panelHtml(current, sheet.params) : ''}</div>`;
    } else {
      const panel = byId.get(sheet.id);
      if (panel.live === false && !panel.pending && !force) return;
      const lock = lockOf();
      body = `${sheetHead(`${esc(panel.icon || '')} ${esc(panel.title)}`, { back: sheet.from === 'phone' })}${lock ? `<p class="sheet-lock" role="note">🔒 ${esc(lock.reason)}</p>` : ''}<div class="sheet-body" data-panel="${esc(panel.id)}">${panelHtml(panel, sheet.params)}</div>`;
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
  function renderSaved() {
    if (!view) return;
    const net = view.net?.text || '';
    setHtml(el.saved, !view.connected
      ? `<button class="life-saved is-off" data-menu="reconnect" title="${esc(net)}"><i aria-hidden="true">⚠</i><span>Offline · Reconnect</span></button>`
      : view.storage ? `<span class="life-saved is-off is-unsaved" role="status" title="${esc(view.storage.reason)}"><i aria-hidden="true">⚠</i><span>Not saving</span></span>`
      : saving > 0 ? '<span class="life-saved is-saving" title="Sending your action to the server"><i aria-hidden="true">↻</i><span>Saving…</span></span>'
        : `<span class="life-saved is-ok" title="${esc(net || 'Progress saved on the server')}"><i aria-hidden="true">✓</i><span>Saved</span></span>`);
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
    return `<p class="life-brand"><strong>Join<span>Allworld</span></strong><small>${view.connected ? 'City beta' : 'Offline · read-only'}</small></p>
      <button data-menu="city"><span aria-hidden="true">🌍</span><span><b>${esc(view.city?.name || 'City')}</b><small>Switch city on the world map</small></span></button>
      <button data-menu="locate"><span aria-hidden="true">📍</span><span><b>Use my location</b><small>Find the nearest city</small></span></button>
      <button data-community><span aria-hidden="true">💬</span><span><b>Community</b><small>${atHome ? 'Home is private — visit a venue to chat' : 'People, chat and voice at this venue'}</small></span></button>
      <button data-open="help"><span aria-hidden="true">❓</span><span><b>How to play</b><small>Tips and keyboard shortcuts</small></span></button>
      <p class="life-net ${net.error ? 'is-error' : ''}" role="status">${esc(net.text || '')}</p>${view.connected ? '' : '<button class="life-menu-retry" data-menu="reconnect">Reconnect</button>'}`;
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
      : unmet.length ? `Needs ${unmet.join(', ')}` : blocked?.code === 'gig_limit' ? 'Today’s gigs are done · back at midnight' : blocked ? blocked.reason : offline ? 'Offline — reconnect to start' : '';
    const busyWhy = !why && busy ? 'Finish or cancel what you are doing first' : '';
    // The card shows the short line; the tooltip and the screen-reader label carry the server's full sentence.
    const full = blocked?.code === 'gig_limit' ? blocked.reason : why || busyWhy;
    const foot = why ? `<span class="life-lock">🔒 ${esc(why)}</span>`
      : `<span class="life-tags">${effectTags(card).map((tag) => `<span${tag.cost ? ' class="is-cost"' : tag.beta ? ' class="is-beta"' : ''}>${esc(tag.text)}</span>`).join('')}</span>`;
    const inner = `<span class="life-action-head"><span class="life-action-emoji" aria-hidden="true">${esc(card.icon || '✨')}</span><span class="life-action-title">${esc(card.label)}</span></span><span class="life-action-meta"><span>◷ ${esc(card.duration)}s</span><strong class="${card.reward > 0 ? 'is-earn' : card.cost > 0 ? 'is-cost' : ''}">${price}</strong></span>${foot}`;
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
    const line = !view.connected ? 'Offline · read-only until you reconnect' : `${privateHome ? '🔒 Private · ' : ''}${ambient || spot?.caption || 'Explore at your own pace'}`;
    const busyNote = state.activeAction && expanded ? '<p class="life-actions-note" role="note">Finish or cancel what you are doing to start something else.</p>' : '';
    // Where this spot lists paid gigs, the day's counter sits above them (view.travel.gigs; the limit is the server's).
    const gigs = view.travel?.gigs, gigIds = view.travel?.gigsHere || [];
    const gigNote = expanded && gigs && activities.cards.some((card) => gigIds.includes(card.id))
      ? `<p class="life-actions-note life-gigs${gigs.left ? '' : ' is-out'}" role="note" title="Paid gigs are limited each Lagos day. Your job’s shift does not count."><b>Gigs today: ${esc(gigs.used)}/${esc(gigs.limit)}</b> · ${gigs.left ? `${esc(gigs.left)} left` : 'open again at midnight, Lagos time'}</p>` : '';
    const cards = activities.cards.length ? activities.cards.map(activityCard).join('')
      : `<div class="ui-empty is-inline"><p>${spot ? 'Nothing to do at this spot yet.' : 'Pick a spot above to see what you can do there.'}</p></div>`;
    return `<section class="life-venue-panel" aria-label="Current venue"><header class="life-venue-header"><button class="life-avatar" data-open="sim" aria-label="Open your Sim: profile, needs, goals and skills">👤</button><div class="life-venue-heading"><h1>${esc(venue.icon || '')} ${esc(title)} <span>· ${esc(district)}</span></h1><p>${esc(line)}</p></div>${privateHome || !view.connected ? '' : `<button class="life-icon-button" data-community aria-label="Open community chat" title="Community chat">${icon('chat')}</button>`}<button class="life-icon-button" data-open="map" aria-label="Open map" title="Map (M)">${icon('map')}</button></header><div class="life-spots"><button class="life-expand ${expanded ? 'is-expanded' : ''}" data-toggle-activities aria-expanded="${expanded}" aria-label="${expanded ? 'Hide' : 'Show'} activities" title="Activities (T)">${icon('chevron')}</button>${spots.map((item, i) => `<button class="${item.id === state.spot ? 'is-selected' : ''}" data-spot="${esc(item.id)}" aria-pressed="${item.id === state.spot}" title="Shortcut ${i + 1}">${esc(item.icon || '')} ${esc(item.label)}</button>`).join('')}${privateHome || spots.some((item) => item.id === 'people') ? '' : '<button data-community>👥 People</button>'}</div>${expanded ? `${busyNote}${gigNote}<div class="life-actions">${cards}</div>` : ''}</section>`;
  }
  const isTrip = (active) => active?.kind === 'travel' || active?.kind === 'commute';
  const placeOf = (id) => { const venue = view.venues.find((item) => item.id === id); return venue ? { icon: venue.icon || '📍', label: id === 'home' ? 'Home' : venue.label } : { icon: '📍', label: 'your destination' }; };
  /**
   * The travel view replaces the venue panel for the length of a trip: from → to, how, the time
   * left, and what cancelling does (the trip stops where it started; a fare already paid stays paid).
   */
  function travelHtml() {
    const active = state.activeAction, commute = active.kind === 'commute';
    // view.travel.active carries where the trip started and the fare charged at departure (null on an older save).
    const trip = commute ? null : view.travel?.active;
    const from = placeOf(trip?.from ?? state.location), to = placeOf(active.id);
    const how = view.travel?.modes?.find((item) => item.id === active.mode) || (commute ? { icon: '💼', label: 'Commute to work' } : active.mode === 'car' ? { icon: '🚗', label: 'Your car' } : { icon: '🧭', label: 'On the way' });
    const rule = commute ? `Cancel to stay at ${from.label}. The commute is free, so nothing is lost.`
      : Number.isFinite(trip?.fare) ? (trip.fare > 0 ? `Cancel to stay at ${from.label}. The ${money(trip.fare)} ${active.mode === 'car' ? 'fuel' : 'fare'} you paid is not refunded.` : `Cancel to stay at ${from.label}. This trip was free, so nothing is lost.`)
      : how.fare > 0 || active.mode === 'car' ? `Cancel to stay at ${from.label}. The fare you paid is not refunded.` : `Cancel to stay at ${from.label}. Nothing was charged.`;
    const paid = Number.isFinite(trip?.fare) ? `<small class="life-travel-fare">${trip.fare > 0 ? `${money(trip.fare)} paid` : 'Free'}</small>` : '';
    return `<section class="life-travel" aria-label="Travelling to ${esc(to.label)}"><div class="life-travel-route"><span class="life-travel-place"><i aria-hidden="true">${esc(from.icon)}</i><b>${esc(from.label)}</b><small>From</small></span><span class="life-travel-mode"><i aria-hidden="true">${esc(how.icon)}</i><small>${esc(how.label)}</small>${paid}</span><span class="life-travel-place"><i aria-hidden="true">${esc(to.icon)}</i><b>${esc(to.label)}</b><small>To</small></span></div><progress max="1" value="0" data-progress aria-label="Trip progress"></progress><div class="life-travel-foot"><strong data-remaining></strong><button data-cancel aria-label="Cancel the trip and stay at ${esc(from.label)}">Cancel trip</button></div><p class="life-progress-note">${esc(rule)}</p></section>`;
  }
  function progressHtml() {
    const active = state.activeAction;
    if (!active) return '';
    const activity = view.activities.active;
    // Timed actions that are not activities name themselves by kind; the id is the venue they head for.
    const place = placeOf(active.id).label;
    const name = activity?.label || (active.kind === 'travel' ? `Travelling to ${place}` : active.kind === 'commute' ? `Commuting to work · ${place}` : 'Action in progress');
    const paid = activity?.reward > 0, sleeping = Boolean(activity?.tags?.includes('sleep'));
    const fixed = activity && !activity.cancellable;
    return `<section class="life-progress" aria-label="Current activity"><span class="life-progress-icon" aria-hidden="true">${esc(activity?.icon || (isTrip(active) ? '🧭' : '⏳'))}</span><div><strong>${esc(name)}</strong><small data-remaining></small></div><button data-cancel ${fixed ? 'disabled title="This cannot be cancelled once started"' : ''} aria-label="${fixed ? 'This cannot be cancelled once started' : paid ? 'Cancel shift. Cancelling earns nothing' : sleeping ? 'Wake up. The rest you got is kept' : 'Cancel current activity'}">${sleeping ? 'Wake up' : 'Cancel'}</button><progress max="1" value="0" data-progress aria-label="Activity progress"></progress>${paid ? `<p class="life-progress-note">Pays ${money(activity.reward)} when finished. Cancelling earns nothing.</p>` : fixed ? '<p class="life-progress-note">This cannot be cancelled once started.</p>' : ''}</section>`;
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
    setHtml(el.coach, step ? `<div class="life-coach" role="note"><span aria-hidden="true">👉</span><p><b>Goal ${esc(goal.step)} of ${esc(goal.of)} · ${esc(goal.title)}</b>${esc(step.text)}</p><button data-coach-off aria-label="Hide these tips">${icon('close')}</button></div>` : '');
    for (const node of [...root.querySelectorAll('.is-coach'), ...dialogContent.querySelectorAll('.is-coach')]) node.classList.remove('is-coach');
    if (step?.target) root.querySelector(step.target)?.classList.add('is-coach');
    if (step?.app && sheet?.kind === 'phone') dialogContent.querySelector(`[data-open="${step.app}"]`)?.classList.add('is-coach');
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
    setText(el.mood, `${mood.icon} ${mood.word}`);
    el.mood.classList.toggle('is-uneasy', mood.tone === 'warn');
    el.mood.classList.toggle('is-bad', mood.tone === 'bad');
    el.mood.classList.toggle('is-neutral', mood.tone === 'neutral');
    setText(el.name, `👤 ${state.name}`);
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
      if (meter.getAttribute('aria-valuenow') !== String(value)) { meter.style.setProperty('--need', `${value}%`); meter.setAttribute('aria-valuenow', String(value)); meter.classList.toggle('is-low', value < 35); }
      // A gain, or a sharp drop, is highlighted once; the slow decay is not.
      const before = lastNeeds?.[need];
      if (before !== undefined && (value - before >= 1 || before - value >= 3)) flash(meter.parentNode, value > before ? 'is-up' : 'is-down');
    }
    lastNeeds = needs;

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

    // Clean screen keeps only the small progress chip (with Cancel), also for a trip.
    const travelling = isTrip(active) && mode === 'venue' && !clean;
    setHtml(el.progress, travelling ? '' : progressHtml());
    root.classList.toggle('is-expanded', expanded && mode === 'venue');
    root.classList.toggle('is-travelling', travelling);
    root.dataset.mode = mode;

    const navPanel = mode !== 'venue' ? byId.get(mode) : null;
    const rail = el.main.querySelector('.life-spots');
    const railLeft = rail?.scrollLeft || 0;
    const cardsLeft = el.main.querySelector('.life-actions')?.scrollLeft || 0;
    const mainHtml = navPanel ? `<section class="life-sheet" aria-label="${esc(navPanel.title)}" data-panel="${esc(navPanel.id)}">${panelHtml(navPanel, modeParams)}</section>` : travelling ? travelHtml() : venuePanel();
    if (navPanel?.live === false && html.has(el.main) && lastMode === mode && !forced) { /* static nav panel: leave as is until api.refresh() */ }
    else if (setHtml(el.main, mainHtml)) {
      if (navPanel) bindPanels(el.main, modeParams);
      else if (!travelling) {
        if (!rail) lastSpotKey = '';
        const sameSpot = lastSpotKey === `${state.location}:${state.spot}`;
        restoreRail(railLeft);
        const cards = el.main.querySelector('.life-actions');
        if (cards && sameSpot) cards.scrollLeft = cardsLeft;
      }
    }
    if (active) {
      const scope = travelling ? el.main : el.progress;
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
    const target = event.target.closest('[data-start],[data-cancel],[data-spot],[data-nav],[data-toggle-activities],[data-community],[data-tab],[data-action],[data-open],[data-close],[data-menu],[data-tray-toggle],[data-clean],[data-coach-off],[data-retry-panel]');
    if (!target || target.disabled || !(root.contains(target) || dialog.contains(target))) return;
    const data = target.dataset;
    if ('trayToggle' in data) { setTray(!trayOpen); return; }
    if ('clean' in data) { setClean(!clean); api.refresh(); return; }
    if ('coachOff' in data) { coachOff = true; try { globalThis.localStorage?.setItem(COACH_KEY, '1'); } catch { /* still off for this visit */ } api.refresh(); return; }
    if ('retryPanel' in data) { const panel = byId.get(data.retryPanel); if (panel) { panel.failed = false; api.refresh(); } return; }
    if ('menu' in data) { setTray(false); host.menu?.(data.menu); return; }
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
      window.dispatchEvent(new CustomEvent('jaw:key', { detail: { action: arg, mode: dialog.open ? 'sheet' : mode } }));
      return;
    }
    if (dialog.open && verb !== 'close' && verb !== 'open' && verb !== 'help') return;
    if (verb === 'close') {
      // The showing panel gets Esc first ('cancel'); if it handled it, nothing is closed.
      let handled = false;
      try { handled = showing()?.keys?.('cancel', api) === true; } catch (error) { console.error('Panel failed to handle Esc:', error); }
      if (handled) { event.preventDefault(); return; }
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
      const isOpen = (sheet?.kind === arg) || (sheet?.kind === 'panel' && sheet.id === arg) || (sheet?.kind === 'sim' && sheet.tab === arg) || mode === arg;
      if (isOpen) close(); else open(arg);
    }
  }
  root.addEventListener('click', onClick);
  dialog.addEventListener('click', onClick);
  document.addEventListener('pointerdown', onOutside);
  window.addEventListener('keydown', onKey);

  return {
    api, render, open, close, toast,
    get mode() { return mode; },
    setMode,
    setExpanded(value) { expanded = Boolean(value); },
    destroy() { el.toasts.remove(); root.removeEventListener('click', onClick); dialog.removeEventListener('click', onClick); document.removeEventListener('pointerdown', onOutside); window.removeEventListener('keydown', onKey); root.replaceChildren(); root.classList.remove('life-ui'); },
  };
}
