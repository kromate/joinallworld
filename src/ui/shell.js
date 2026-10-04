/**
 * CLIENT SHELL — the contract for every UI panel (src/ui/panels/*.js)
 * ===========================================================================
 * OWNER: foundation. The shell owns the HUD (clock, mood, name, wallet, six need bars, HUD
 * chip stack), the bottom nav (Home / Buy / Map / Phone), the venue panel (spot rail, activity
 * cards, progress + cancel), toasts, the Phone app grid, the Sim sheet and its tabs, the
 * keyboard map (src/ui/keys.js) and the help overlay. Everything else is a panel.
 *
 * HOW TO ADD OR EXTEND A PANEL
 * ----------------------------
 * Every file in src/ui/panels/ is already imported and registered by src/ui/panels/index.js.
 * You edit only your own panel files; never the index, this shell or src/life-main.js.
 * A panel file default-exports one panel object, or an array of them:
 *
 *   export default {
 *     id: 'jobs',                 // unique; also the target of api.open('jobs') and data-open="jobs"
 *     title: 'Jobs',
 *     icon: '💼',                 // emoji or short text shown in the Phone grid / tab
 *     placement: 'phone',         // see PLACEMENTS
 *     order: 20,                  // optional sort key within its placement (default 100)
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
 *   'hud'      a chip in the top-left HUD stack, always visible (goal chip, daily hunt chip);
 *              return '' to hide it
 *   'sim-tab'  a tab of the Sim sheet (Profile, Needs, Goals, Skills, People, Career, Settings)
 *   'modal'    not listed anywhere; opened only by api.open(id) (onboarding, account landing)
 *
 * render(state, view, api)
 *   state  the server's life state, read-only (shape: src/life.js + each system's stateKeys)
 *   view   { ...viewLife(state) (view[systemId] from each system's view()),
 *            cityId, city: { id, name, region }, connected, session: { id, name } | null,
 *            name, now (server ms), mode, venues: [{ id, label, district, icon, description }],
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
 *   api.toast(text, kind?)        top-centre toast; kind: 'info' | 'good' | 'error'
 *   api.fetchJson(path, { method, body, headers }?) → Promise<object>; rejects Error{ status, code }
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
const TOAST_MS = 4000;

export function createShell({ root, dialog, dialogContent, panels, host }) {
  let state = null, view = null, mode = 'venue', lastMode = 'venue', modeParams = null, expanded = false, sheet = null, lastSpotKey = '', forced = false;
  const html = new WeakMap();
  const byId = new Map(panels.map((panel) => [panel.id, panel]));
  const placed = (placement) => panels.filter((panel) => panel.placement === placement);
  const gate = (panel) => { const value = panel.enabled?.(state, view); return value === undefined || value === true ? null : String(value || 'Unavailable right now'); };

  root.classList.add('life-ui');
  root.innerHTML = `<div class="life-identity"><strong>Join<span>Allworld</span></strong><small data-identity></small></div>
    <section class="life-status" aria-label="Player status"><span class="life-clock" data-clock></span><span class="life-mood" data-mood></span><button class="life-status-profile" data-open="sim" data-name></button><button class="life-cash" data-open="bank" aria-label="Wallet and transactions" data-cash></button></section>
    <aside class="life-sidebar"><div class="life-hud" data-slot="hud"></div><div class="life-needs" aria-label="Your needs">${Object.entries(NEED_ICONS).map(([id, emoji]) => `<div class="life-need" title="${cap(id)}"><span aria-hidden="true">${emoji}</span><div role="meter" aria-label="${cap(id)}" aria-valuemin="0" aria-valuemax="100" data-need="${id}"><i></i></div></div>`).join('')}</div><button class="life-help" data-open="help">? How to play</button></aside>
    <div class="life-toasts" data-toasts role="status" aria-live="polite"></div>
    <div class="life-bottom" data-bottom><div class="life-message" role="status" data-message hidden></div><div data-slot="progress"></div><div data-slot="main"></div><nav class="life-nav" aria-label="Main navigation" data-slot="nav"></nav></div>`;
  const $ = (selector) => root.querySelector(selector);
  const el = { clock: $('[data-clock]'), mood: $('[data-mood]'), name: $('[data-name]'), cash: $('[data-cash]'), identity: $('[data-identity]'), message: $('[data-message]'),
    toasts: $('[data-toasts]'), bottom: $('[data-bottom]'), hud: $('[data-slot="hud"]'), progress: $('[data-slot="progress"]'), main: $('[data-slot="main"]'), nav: $('[data-slot="nav"]') };

  /** Write HTML only when it changed, so per-second updates never rebuild or reflow unchanged parts. */
  function setHtml(target, next) {
    if (html.get(target) === next) return false;
    html.set(target, next);
    target.innerHTML = next;
    return true;
  }
  function setText(target, next) { if (target.textContent !== next) target.textContent = next; }

  const api = {
    command: (type, payload) => host.command(type, payload),
    open, close,
    toast,
    fetchJson: (path, options) => host.fetchJson(path, options),
    refresh: () => { forced = true; try { render(state, view); } finally { forced = false; } },
    redrawScene: () => host.redrawScene?.(),
    goTo: (venueId, spotId) => host.goTo(venueId, spotId),
    toggleCommunity: (force) => host.toggleCommunity(force),
    state: () => state,
    view: () => view,
  };

  function toast(text, kind = 'info') {
    if (!text) return;
    if (el.toasts.lastElementChild?.textContent === text) return; // the same notice twice in a row says nothing new
    const item = document.createElement('div');
    item.className = `life-toast is-${kind}`;
    item.textContent = text;
    el.toasts.append(item);
    while (el.toasts.children.length > 3) el.toasts.firstChild.remove();
    setTimeout(() => item.remove(), TOAST_MS);
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
  function open(id, params) {
    const lock = lockOf();
    if (lock && id !== lock.panel.id && byId.get(id)?.role !== 'session-gate') { toast(lock.reason); return false; }
    if (id === 'phone' || id === 'help') sheet = { kind: id };
    else if (id === 'sim') sheet = { kind: 'sim', tab: params?.tab || sheet?.tab || placed('sim-tab')[0]?.id };
    else {
      const panel = byId.get(id);
      if (!panel) return false;
      const reason = gate(panel);
      if (reason) { toast(reason, 'error'); return false; }
      if (panel.placement === 'nav') { closeDialog(); setMode(id, params); return true; }
      if (panel.placement === 'hud') return false;
      if (panel.placement === 'sim-tab') sheet = { kind: 'sim', tab: id, params };
      else sheet = { kind: 'panel', id, params, from: sheet?.kind === 'phone' || sheet?.from === 'phone' ? 'phone' : null };
    }
    html.delete(dialogContent);
    renderSheet();
    if (!dialog.open) dialog.showModal();
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
  function panelHtml(panel, params) {
    try { return panel.render(state, panelView(params), api) ?? ''; }
    catch (error) { console.error(`Panel ${panel.id} failed to render:`, error); return '<p class="ui-error">This screen could not be shown.</p>'; }
  }
  function bindPanels(container, params) {
    for (const node of container.querySelectorAll('[data-panel]')) {
      const panel = byId.get(node.dataset.panel);
      try { panel?.bind?.(node, api, params ?? null); } catch (error) { console.error(`Panel ${node.dataset.panel} failed to bind:`, error); }
    }
  }

  function renderSheet(force = true) {
    if (!sheet || !state) return;
    let body = '';
    if (sheet.kind === 'phone') {
      body = `<header class="sheet-head"><h2>Phone</h2></header><div class="phone-grid">${placed('phone').map((panel) => { const reason = gate(panel); return `<button class="phone-app" data-open="${esc(panel.id)}" ${reason ? `disabled title="${esc(reason)}"` : ''}><span aria-hidden="true">${esc(panel.icon || '📱')}</span>${esc(panel.title)}</button>`; }).join('')}<button class="phone-app" data-community><span aria-hidden="true">💬</span>Community</button><button class="phone-app" data-open="help"><span aria-hidden="true">❔</span>Help</button></div>`;
    } else if (sheet.kind === 'help') {
      body = `<header class="sheet-head"><h2>How to play</h2></header><p>Pick a spot in the venue panel, then an activity. Activities take real seconds and finish on the server even if you close the tab. Open Map to travel, Phone for apps, and your name for your Sim. ${view.connected ? 'Your progress is saved on this server under this device session — it is not a password-protected account, so keep your cookies.' : 'You are offline: what you see is the last saved state, and nothing changes until you reconnect.'}</p><h3>Keyboard</h3><dl class="help-keys">${shortcutRows().map((row) => `<div><dt><kbd>${esc(row.label)}</kbd></dt><dd>${esc(row.description)}</dd></div>`).join('')}</dl>`;
    } else if (sheet.kind === 'sim') {
      const tabs = placed('sim-tab');
      const current = tabs.find((panel) => panel.id === sheet.tab) || tabs[0];
      const feeling = view.needs?.feelings?.[0];
      if (current && current.live === false && !force) return;
      body = `<header class="sheet-head sim-head"><span class="sim-avatar" aria-hidden="true">👤</span><div><h2>${esc(state.name)}</h2><p>${esc(moodOf().word)}${feeling ? ` · ${esc(feeling.label)}` : ''}</p></div></header><div class="sim-tabs" role="tablist">${tabs.map((panel) => `<button role="tab" aria-selected="${panel === current}" class="${panel === current ? 'is-selected' : ''}" data-tab="${esc(panel.id)}">${esc(panel.title)}</button>`).join('')}</div><div class="sheet-body" role="tabpanel" data-panel="${esc(current?.id ?? '')}">${current ? panelHtml(current, sheet.params) : ''}</div>`;
    } else {
      const panel = byId.get(sheet.id);
      if (panel.live === false && !force) return;
      const lock = lockOf();
      body = `<header class="sheet-head">${sheet.from === 'phone' ? `<button class="sheet-back" data-open="phone" aria-label="Back to phone">${icon('back')}</button>` : ''}<h2>${esc(panel.icon || '')} ${esc(panel.title)}</h2></header>${lock ? `<p class="sheet-lock" role="note">🔒 ${esc(lock.reason)}</p>` : ''}<div class="sheet-body" data-panel="${esc(panel.id)}">${panelHtml(panel, sheet.params)}</div>`;
    }
    dialog.toggleAttribute('data-locked', Boolean(lockOf()));
    if (setHtml(dialogContent, body)) bindPanels(dialogContent, sheet.params);
  }

  /** The mood word shown in the HUD and the Sim header: the character system's five words, else the core label. */
  function moodOf() {
    const mood = view.onboarding?.mood;
    return mood?.word ? mood : { word: view.needs.mood.label, icon: view.needs.mood.icon, tone: view.needs.mood.score < 25 ? 'bad' : view.needs.mood.score < 45 ? 'warn' : 'good', score: view.needs.mood.score };
  }

  // ---- venue panel (shell-owned) --------------------------------------------------------
  function effectTags(card) {
    const tags = Object.entries(card.effects || {}).filter(([, amount]) => amount).map(([need, amount]) => (amount > 0 ? { text: `+${amount} ${cap(need)}` } : { text: `−${-amount} ${cap(need)}`, cost: true }));
    for (const [need, rate] of Object.entries(card.effectsPerSecond || {})) if (rate > 0) tags.push({ text: `+${rate} ${cap(need)}/s` });
    for (const [skill, amount] of Object.entries(card.xp || {})) tags.push({ text: `+${amount} ${cap(skill)} XP` });
    if (card.beta) tags.push({ text: 'Beta' });
    return tags;
  }
  function activityCard(card) {
    const blocked = card.blocked;
    const unavailable = blocked?.code === 'unavailable';
    const disabled = Boolean(blocked) || Boolean(state.activeAction) || !view.connected;
    const price = card.reward > 0 ? `+${money(card.reward)}` : card.cost > 0 ? money(card.cost) : 'Free';
    const requirements = Object.entries(card.minimumNeeds || {}).map(([need, minimum]) => { const value = state.needs[need], met = value >= minimum; return `<span class="${met ? 'is-met' : 'is-unmet'}">${met ? '✓' : '✗'} ${cap(need)} ${Math.floor(value)} (needs ${minimum})</span>`; }).join('');
    const reason = blocked && !unavailable ? `<strong>${esc(blocked.reason)}</strong>` : '';
    const tags = unavailable ? `<span class="life-locked">${esc(card.requiresSkill ? `Needs ${cap(card.requiresSkill.id)} ${card.requiresSkill.level}` : 'Unavailable in preview')}</span>` : effectTags(card).map((tag) => `<span${tag.cost ? ' class="is-cost"' : ''}>${esc(tag.text)}</span>`).join('');
    const inner = `<span class="life-action-meta"><span class="life-action-emoji">${esc(card.icon || '✨')}</span><span>◷ ${esc(card.duration)}s<strong>${price}</strong></span></span><span class="life-action-title">${esc(card.label)}</span><span class="life-tags">${tags}</span>${requirements || reason ? `<span class="life-requirements">${requirements}${reason}</span>` : ''}`;
    const classes = `life-action ${unavailable ? 'is-unavailable' : blocked ? 'is-blocked' : state.activeAction ? 'is-busy' : ''} ${requirements || reason ? 'has-requirements' : ''}`;
    if (card.choices && !unavailable) {
      return `<div class="${classes} has-choices">${inner}<span class="life-choices">${card.choices.map((choice) => `<button data-start="${esc(card.id)}" data-choice="${esc(choice.id)}" ${disabled ? 'disabled' : ''}>${esc(choice.label)}</button>`).join('')}</span></div>`;
    }
    return `<button class="${classes}" data-start="${esc(card.id)}" ${disabled ? 'disabled' : ''} aria-label="${esc(card.label)}, ${esc(card.duration)} seconds, ${esc(price)}${blocked ? `, ${esc(blocked.reason)}` : ''}">${inner}${card.reward > 0 && !disabled ? '<span class="life-action-cta">Start shift →</span>' : ''}</button>`;
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
    return `<section class="life-venue-panel" aria-label="Current venue"><header class="life-venue-header"><button class="life-avatar" data-open="sim" aria-label="Open your profile">👤</button><div class="life-venue-heading"><h1>${esc(venue.icon || '')} ${esc(title)} <span>· ${esc(district)}</span></h1><p>${esc(ambient || spot?.caption || 'Explore at your own pace')}</p></div><button class="life-icon-button" data-open="map" aria-label="Open map">${icon('map')}</button><button class="life-icon-button" data-open="help" aria-label="Help">?</button></header><div class="life-chat">${privateHome ? '<span class="life-private-home">🔒 Your private home</span>' : view.connected ? '<button class="life-community-chat" data-community><span>💬 Open community chat</span><span aria-hidden="true">→</span></button>' : '<span class="life-private-home">Offline · read-only until you reconnect</span>'}</div><div class="life-spots"><button class="life-expand ${expanded ? 'is-expanded' : ''}" data-toggle-activities aria-expanded="${expanded}" aria-label="${expanded ? 'Collapse' : 'Expand'} activities">${icon('chevron')}</button>${spots.map((item, i) => `<button class="${item.id === state.spot ? 'is-selected' : ''}" data-spot="${esc(item.id)}" title="Shortcut ${i + 1}">${esc(item.icon || '')} ${esc(item.label)}</button>`).join('')}${privateHome || spots.some((item) => item.id === 'people') ? '' : '<button data-community>👥 People</button>'}</div>${expanded ? `<div class="life-actions">${activities.cards.length ? activities.cards.map(activityCard).join('') : '<p class="life-empty">No activities at this spot yet.</p>'}</div>` : ''}</section>`;
  }
  function progressHtml() {
    const active = state.activeAction;
    if (!active) return '';
    const activity = view.activities.active;
    // Timed actions that are not activities name themselves by kind; the id is the venue they head for.
    const destination = activity ? null : view.venues.find((item) => item.id === active.id);
    const place = destination ? (destination.id === 'home' ? 'Home' : destination.label) : 'your destination';
    const name = activity?.label || (active.kind === 'travel' ? `Travelling to ${place}` : active.kind === 'commute' ? `Commuting to work · ${place}` : destination ? `On the way to ${place}` : 'Action in progress');
    const paid = activity?.reward > 0;
    return `<section class="life-progress" aria-label="Current activity"><div><strong>${esc(name)}</strong><small data-remaining></small></div><button data-cancel ${activity && !activity.cancellable ? 'disabled' : ''} aria-label="${paid ? 'Cancel shift. Cancelling earns nothing' : 'Cancel current activity'}">Cancel</button><progress max="1" value="0" data-progress aria-label="Activity progress"></progress>${paid ? `<p class="life-progress-note">Pays ${money(activity.reward)} when finished. Cancelling earns nothing.</p>` : ''}</section>`;
  }
  function navHtml() {
    return NAV.map(([id, label]) => {
      const panel = byId.get(id);
      const reason = panel?.placement === 'nav' ? gate(panel) : null;
      const selected = mode === id || (id === 'home' && mode === 'venue' && state.location === 'home');
      return `<button data-nav="${id}" ${reason ? `disabled title="${esc(reason)}"` : ''} class="${selected ? 'is-selected' : ''}">${icon(id)}<span>${label}</span></button>`;
    }).join('');
  }

  // ---- render ---------------------------------------------------------------------------
  function render(nextState, nextView) {
    state = nextState; view = nextView;
    if (!state || !view) return;
    setText(el.clock, view.clock);
    const mood = moodOf();
    setText(el.mood, `${mood.icon} ${mood.word}`);
    el.mood.classList.toggle('is-uneasy', mood.tone === 'warn');
    el.mood.classList.toggle('is-bad', mood.tone === 'bad');
    el.mood.classList.toggle('is-neutral', mood.tone === 'neutral');
    setText(el.name, `👤 ${state.name}`);
    setText(el.cash, money(state.cash));
    setText(el.identity, view.connected ? 'City beta' : 'Offline · read-only');
    for (const need of view.needs.order) {
      const meter = root.querySelector(`[data-need="${need}"]`), value = Math.round(state.needs[need]);
      if (meter.getAttribute('aria-valuenow') !== String(value)) { meter.style.setProperty('--need', `${value}%`); meter.setAttribute('aria-valuenow', String(value)); meter.classList.toggle('is-low', value < 35); }
    }
    if (setHtml(el.hud, placed('hud').map((panel) => { const body = panelHtml(panel); return body ? `<div data-panel="${esc(panel.id)}">${body}</div>` : ''; }).join(''))) bindPanels(el.hud);

    const active = state.activeAction;
    const activeLabel = view.activities.active?.label || '';
    const text = state.message || '';
    const repeated = Boolean(active) && (text === activeLabel || text.startsWith('Travelling to '));
    setText(el.message, text);
    el.message.hidden = !text || repeated || mode !== 'venue';

    setHtml(el.progress, progressHtml());
    el.bottom.classList.toggle('has-progress', Boolean(active));
    root.classList.toggle('is-expanded', expanded && mode === 'venue');
    if (active) {
      const bar = el.progress.querySelector('[data-progress]');
      bar.value = Math.max(0, Math.min(1, 1 - active.remaining / (active.duration || 1)));
      setText(el.progress.querySelector('[data-remaining]'), `${Math.ceil(active.remaining)}s remaining`);
    }

    const navPanel = mode !== 'venue' ? byId.get(mode) : null;
    const rail = el.main.querySelector('.life-spots');
    const railLeft = rail?.scrollLeft || 0;
    const mainHtml = navPanel ? `<section class="life-sheet" aria-label="${esc(navPanel.title)}" data-panel="${esc(navPanel.id)}">${panelHtml(navPanel, modeParams)}</section>` : venuePanel();
    if (navPanel?.live === false && html.has(el.main) && lastMode === mode && !forced) { /* static nav panel: leave as is until api.refresh() */ }
    else if (setHtml(el.main, mainHtml)) {
      if (navPanel) bindPanels(el.main, modeParams);
      else { if (!rail) lastSpotKey = ''; restoreRail(railLeft); }
    }
    lastMode = mode;
    setHtml(el.nav, navHtml());
    renderSheet(forced);
    // A panel that must be completed opens by itself (and comes back if anything replaced it).
    if (view.connected) {
      const must = panels.find((panel) => panel.placement === 'modal' && typeof panel.required?.(state, panelView()) === 'string');
      if (must && !(sheet?.kind === 'panel' && (sheet.id === must.id || byId.get(sheet.id)?.role === 'session-gate'))) { sheet = null; open(must.id); }
    }
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
    if (box.left < bounds.left + 48) rail.scrollLeft += box.left - bounds.left - 48;
    else if (box.right > bounds.right - 8) rail.scrollLeft += box.right - bounds.right + 8;
  }

  // ---- input ----------------------------------------------------------------------------
  function parse(text) { try { return text ? JSON.parse(text) : undefined; } catch { return undefined; } }
  async function onClick(event) {
    const target = event.target.closest('[data-start],[data-cancel],[data-spot],[data-nav],[data-toggle-activities],[data-community],[data-tab],[data-action],[data-open],[data-close]');
    if (!target || target.disabled || !(root.contains(target) || dialog.contains(target))) return;
    const data = target.dataset;
    if ('start' in data) { expanded = false; await api.command('activity', { id: data.start, ...(data.choice ? { choice: data.choice } : {}) }); }
    else if ('cancel' in data) await api.command('cancel');
    else if ('spot' in data) { expanded = true; await api.command('spot', { id: data.spot }); api.refresh(); }
    else if ('toggleActivities' in data) { expanded = !expanded; api.refresh(); }
    else if ('community' in data) { closeDialog(); api.toggleCommunity(true); }
    else if ('tab' in data) { sheet = { kind: 'sim', tab: data.tab }; renderSheet(); }
    else if ('nav' in data) navigate(data.nav);
    else if ('action' in data) {
      const result = await api.command(data.action, parse(data.payload));
      if (result.ok && data.then === 'close') close();
      // A sheet covers the status line, so a successful action inside one confirms itself with a toast.
      else if (result.ok && sheet && dialog.open && state.message) toast(state.message, 'good');
    }
    else if ('open' in data) open(data.open, parse(data.params));
    else if ('close' in data) close();
  }
  function navigate(id) {
    if (id === 'phone') open('phone');
    else if (id === 'home') {
      // At home (or already on the way somewhere): show the scene. Elsewhere: the travel card for Home, never a silent trek.
      closeDialog();
      const moving = state.activeAction?.kind === 'travel' || state.activeAction?.kind === 'commute';
      if (state.location === 'home' || moving) setMode('venue'); else api.goTo('home');
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
      window.dispatchEvent(new CustomEvent('jaw:key', { detail: { action: arg } }));
      return;
    }
    if (dialog.open && verb !== 'close' && verb !== 'open' && verb !== 'help') return;
    if (verb === 'close') {
      // The showing panel gets Esc first ('cancel'); if it handled it, nothing is closed.
      let handled = false;
      try { handled = showing()?.keys?.('cancel', api) === true; } catch (error) { console.error('Panel failed to handle Esc:', error); }
      if (handled) { event.preventDefault(); return; }
      if (sheet || mode !== 'venue') close(); else if (expanded) { expanded = false; api.refresh(); }
    }
    else if (verb === 'help') open('help');
    else if (verb === 'nav') navigate(arg);
    else if (verb === 'toggle') { if (mode === 'venue') { expanded = !expanded; api.refresh(); } }
    else if (verb === 'spot') { const spot = view.activities.spots[Number(arg) - 1]; if (spot && mode === 'venue' && !state.activeAction) { expanded = true; api.command('spot', { id: spot.id }).then(api.refresh); } }
    else if (verb === 'open') {
      const isOpen = (sheet?.kind === arg) || (sheet?.kind === 'panel' && sheet.id === arg) || (sheet?.kind === 'sim' && sheet.tab === arg) || mode === arg;
      if (isOpen) close(); else open(arg);
    }
  }
  root.addEventListener('click', onClick);
  dialog.addEventListener('click', onClick);
  window.addEventListener('keydown', onKey);

  return {
    api, render, open, close, toast,
    get mode() { return mode; },
    setMode,
    setExpanded(value) { expanded = Boolean(value); },
    destroy() { el.toasts.remove(); root.removeEventListener('click', onClick); dialog.removeEventListener('click', onClick); window.removeEventListener('keydown', onKey); root.replaceChildren(); root.classList.remove('life-ui'); },
  };
}
