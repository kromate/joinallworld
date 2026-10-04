/**
 * THE IN-GAME PHONE — device shell, home screen and app frame.
 * ===========================================================================
 * The shell (src/ui/shell.js) owns WHICH sheet is open; this module draws it when that sheet
 * belongs in the phone: the home screen (`{ kind: 'phone' }`), a panel opened as an app
 * (`{ kind: 'panel', … }` with placement 'phone', or anything opened while the phone is up), and
 * Help. Everything lives inside the shell's one <dialog>, so focus is trapped by the browser and
 * restored to where it was when the phone closes.
 *
 * STRUCTURE (all inside #life-dialog-content)
 *   .ph-close              the Close pill above the device (a tap outside the device closes it too)
 *   .ph                    the device: body, bezel, island, side buttons
 *     .ph-status           status bar — Lagos time · signal/"4G" (the server connection) · battery (the Sim's Energy)
 *     .ph-home             big clock and date, the newest notification, the icon pages, page dots, the dock
 *     .ph-shade            the notification list (every recent Update, each a deep link into its app)
 *     .ph-app              app bar (the app's colour, back to home, expand) + the scrolling app body
 *
 * BESIDE THIS FILE
 *   how.js / how.css   the "How it works" disclosure every app folds its longer rules behind
 *   reports.js         the Report a problem badge (one look at the server when the phone opens)
 *   logic.js           the pure decisions behind the badges, the disclosure and Groceries' Buy 1 pack
 *
 * WHAT A PANEL CAN ADD (all optional, all static so they work before a lazy group has loaded)
 *   group: 'life' | 'money' | 'people' | 'city'   where its icon sits on the home screen
 *   tint:  '#rrggbb'                               its icon / app bar colour (default: TINTS[id])
 *   phone: true                                    list a non-'phone' panel (a Sim tab) as an app too
 *   badge(state, view) → number | string | falsy   the red badge on its icon, from data already in the view
 *   notifications(state, view) → [{ id, at, text, fresh, app, open?, params? }]   lines for the shade
 *
 * NOTHING RUNS WHILE IDLE. There is no timer and no animation loop here: the clock, the battery
 * and the badges are redrawn only when the shell renders (a state update or the HUD's own clock
 * tick) or when the phone is opened. Each region is written only when its HTML changed, so a
 * minute passing never rebuilds the icon grid, moves the page or steals focus. Motion is CSS
 * transitions on open and on entering/leaving an app, switched off by prefers-reduced-motion.
 *
 * CLOSING. The shell closes the phone by calling unmount() and then dialog.close(), in one turn, so
 * the dialog is gone at once: Esc, the Close pill, a tap outside, the nav and Community all close it
 * reliably and none of them waits for an animation. The animation is decoration on top of that:
 * unmount() moves the device out of the dialog into a "ghost" layer on the page (inert, hidden from
 * assistive technology, deaf to the pointer) that slides down and fades with one CSS animation and
 * removes itself when it ends. No timer. It is skipped under prefers-reduced-motion, when the
 * dialog is no longer on screen, and when another sheet (a required panel, a non-phone sheet) takes
 * the dialog over — then the phone is simply gone.
 * The 3D scene is not touched: opening, paging and closing the phone draw no scene frame.
 */
import './phone.css';
import { esc, json } from '../dom.js';
import { glyph, glyphFor } from './icons.js';
import { appIcon, tintOf } from './icons-more.js';
import { getWallpaper } from './wallpapers.js';
import { checkReports } from './reports.js';

const DOCK = ['messages', 'jobs', 'bank', 'ride'];
const PAGES = [
  { label: 'Life and money', groups: [['life', 'Life'], ['money', 'Money']] },
  { label: 'People and city', groups: [['people', 'People'], ['city', 'City']] },
];
const SHADE_MAX = 14;
const lagos = (options) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', ...options });
const TIME = lagos({ hour: '2-digit', minute: '2-digit', hour12: false });
const DATE = lagos({ weekday: 'long', day: 'numeric', month: 'long' });
const STAMP = lagos({ weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false });

/**
 * @param {object} options
 *   dialog, content                the shell's <dialog> and its content element
 *   panels                         every registered panel (sorted)
 *   host { api, panelHtml(panel, params), bindPanels(container, params), open(id, params), close(), helpHtml() }
 */
export function createPhone({ dialog, content, panels, host }) {
  const html = new WeakMap();
  let el = null, state = null, view = null, sheet = null;
  let page = 0, shade = false, wide = false, lastApp = null, shown = '', focusNext = null;
  let ghost = null;

  const set = (target, next) => { if (html.get(target) === next) return false; html.set(target, next); target.innerHTML = next; return true; };
  const byId = (id) => panels.find((panel) => panel.id === id);
  const listed = () => panels.filter((panel) => panel.placement === 'phone' || panel.phone === true);
  const builtIns = [
    { id: 'community', title: 'Community', group: 'city', attrs: 'data-community' },
    { id: 'help', title: 'Help', group: 'life', attrs: 'data-open="help"' },
  ];

  /** Is this sheet drawn inside the phone? */
  function hosts(target) {
    if (!target) return false;
    if (target.kind === 'phone') return true;
    if (target.kind === 'help') return target.from === 'phone';
    if (target.kind !== 'panel') return false;
    const panel = byId(target.id);
    if (!panel || panel.role === 'session-gate' || typeof panel.required === 'function') return false;
    return panel.placement === 'phone' || target.from === 'phone';
  }
  const appKey = (target) => (target?.kind === 'panel' ? target.id : target?.kind === 'help' ? 'help' : '');

  function badgeOf(panel) {
    let value = null;
    try { value = panel.badge?.(state, view); } catch (error) { console.error(`Badge of ${panel.id} failed:`, error); }
    if (!value) return '';
    return typeof value === 'number' ? (value > 99 ? '99+' : String(Math.floor(value))) : String(value).slice(0, 3);
  }
  function notifications() {
    const lines = [];
    for (const panel of panels) {
      if (typeof panel.notifications !== 'function') continue;
      try { lines.push(...(panel.notifications(state, view) || [])); } catch (error) { console.error(`Notifications of ${panel.id} failed:`, error); }
    }
    return lines.filter((line) => line && line.text).sort((a, b) => (b.at || 0) - (a.at || 0));
  }

  // ---- markup ----------------------------------------------------------------------------
  function iconButton(app, { dock = false } = {}) {
    const badge = app.badge ? badgeOf(app) : '';
    const attrs = app.attrs || `data-open="${esc(app.id)}"`;
    const running = lastApp === app.id ? ' is-running' : '';
    const label = `${app.title}${badge ? `, ${badge} new` : ''}`;
    return `<button class="ph-appbtn${running}" ${attrs} data-ph-app="${esc(app.id)}" aria-label="${esc(label)}"${dock ? ' data-ph-dock' : ''}>${appIcon(app.id, tintOf(app))}${badge ? `<b class="ph-badge" aria-hidden="true">${esc(badge)}</b>` : ''}<span class="ph-label">${esc(app.short || app.title)}</span></button>`;
  }
  function pagesHtml() {
    const apps = [...listed(), ...builtIns].filter((app) => !DOCK.includes(app.id));
    return PAGES.map((def, index) => {
      const known = PAGES.flatMap((item) => item.groups.map(([id]) => id));
      const groups = def.groups.map(([id, label]) => {
        // An app with no group (or one this build does not know) still gets a place: with the first page's first group.
        const mine = apps.filter((app) => app.group === id || (index === 0 && id === def.groups[0][0] && !known.includes(app.group)));
        return mine.length ? `<h3 class="ph-group">${esc(label)}</h3><div class="ph-grid">${mine.map((app) => iconButton(app)).join('')}</div>` : '';
      }).join('');
      return `<section class="ph-page" data-ph-page="${index}" aria-label="${esc(def.label)}">${groups}</section>`;
    }).join('');
  }
  const dotsHtml = () => PAGES.map((def, index) => `<button data-ph-go="${index}" aria-label="Page ${index + 1} of ${PAGES.length}: ${esc(def.label)}"${index === page ? ' aria-current="true"' : ''}></button>`).join('');
  const dockHtml = () => DOCK.map((id) => byId(id)).filter(Boolean).map((app) => iconButton(app, { dock: true })).join('');

  function noteHtml(line, { compact = false } = {}) {
    const app = byId(line.app) || { id: line.app, title: 'Update' };
    const target = line.open || line.app;
    const attrs = target ? `data-open="${esc(target)}"${line.params ? ` data-params="${json(line.params)}"` : ''}` : '';
    return `<button class="ph-note${line.fresh ? ' is-fresh' : ''}${compact ? ' is-compact' : ''}" ${attrs}>${appIcon(app.id, tintOf(app))}<span><small>${esc(app.title)}${line.at ? ` · ${esc(STAMP.format(new Date(line.at)))}` : ''}${line.fresh ? ' · New' : ''}</small><b>${esc(line.text)}</b></span></button>`;
  }
  function notifsHtml(lines) {
    if (!lines.length) return '';
    const fresh = lines.filter((line) => line.fresh).length;
    const more = lines.length - 1;
    return `${noteHtml(lines[0], { compact: true })}${more > 0 ? `<button class="ph-more" data-ph-shade aria-expanded="${shade}" aria-label="Show all ${lines.length} notifications">${glyph('bell')}<span>${fresh > 1 ? `${fresh} new · ` : ''}${more} more</span></button>` : ''}`;
  }
  function shadeHtml(lines) {
    const body = lines.length ? lines.slice(0, SHADE_MAX).map((line) => noteHtml(line)).join('')
      : `<div class="ph-shade-empty">${glyph('bell')}<p><b>No notifications</b>Rent and loan notices, messages, knocks at your door and city news land here.</p></div>`;
    return `<header><h2>Notifications</h2><button class="ph-shade-close" data-ph-shade aria-label="Close notifications">${glyph('close')}</button></header><div class="ph-shade-list">${body}</div>${lines.length ? '<button class="ph-shade-all" data-open="messages" data-params="{&quot;tab&quot;:&quot;updates&quot;}">Open all Updates</button>' : ''}`;
  }
  function statusHtml() {
    const energy = Math.max(0, Math.min(100, Math.round(state.needs?.energy ?? 0)));
    const online = Boolean(view.connected);
    const level = energy <= 15 ? 'is-low' : energy <= 35 ? 'is-mid' : '';
    return `<button class="ph-status-btn" data-ph-shade aria-label="Notifications. Lagos time ${esc(TIME.format(new Date(view.now)))}">${esc(TIME.format(new Date(view.now)))}</button>
      <span class="ph-sys"><span class="ph-signal${online ? '' : ' is-off'}" role="img" aria-label="${online ? 'Connected to the game server' : 'No connection to the game server'}"><i></i><i></i><i></i><i></i></span><b>${online ? '4G' : 'No service'}</b>
      <span class="ph-batt ${level}" role="img" aria-label="Battery: your Sim’s Energy is ${energy}%" style="--level:${energy}%"><i></i></span><b>${energy}%</b></span>`;
  }
  function barHtml(title, id, tint) {
    return `<button class="ph-back" data-open="phone" aria-label="Back to the home screen">${glyph('back')}</button><span class="ph-bar-icon" aria-hidden="true">${glyph(glyphFor(id))}</span><h2>${esc(title)}</h2><button class="ph-wide" data-ph-wide aria-pressed="${wide}" aria-label="${wide ? 'Make the phone narrower' : 'Make the phone wider'}" title="${wide ? 'Narrower' : 'Wider'}">${glyph(wide ? 'shrink' : 'expand')}</button>`;
  }

  // ---- mount / render --------------------------------------------------------------------
  function mount() {
    html.delete(content);
    content.innerHTML = `<div class="ph-stage"><button class="ph-close" data-close aria-label="Close the phone">${glyph('close')}<span>Close</span></button><div class="ph" data-view="home" data-wall="${esc(getWallpaper())}" role="group" aria-label="Phone">
      <div class="ph-screen">
        <div class="ph-wallpaper" aria-hidden="true"></div>
        <header class="ph-status" data-ph="status"></header>
        <div class="ph-island" aria-hidden="true"></div>
        <section class="ph-home" data-ph="home" aria-label="Home screen">
          <div class="ph-clock"><b data-ph="time"></b><span data-ph="date"></span></div>
          <div class="ph-notifs" data-ph="notifs"></div>
          <div class="ph-pages" data-ph="pages"></div>
          <div class="ph-dots" data-ph="dots" role="group" aria-label="Home screen pages"></div>
          <div class="ph-dock" data-ph="dock" role="group" aria-label="Dock"></div>
        </section>
        <section class="ph-shade" data-ph="shade" aria-label="Notifications" inert></section>
        <section class="ph-app" data-ph="app" inert>
          <header class="ph-appbar" data-ph="bar"></header>
          <div class="ph-appbody sheet-body" data-ph="body"></div>
        </section>
        <button class="ph-homebar" data-open="phone" aria-label="Home screen" tabindex="-1"></button>
      </div>
    </div></div>`;
    dropGhost(); // opened again while the last one was still leaving: there is only ever one phone
    const device = content.querySelector('.ph');
    const part = (name) => device.querySelector(`[data-ph="${name}"]`);
    el = { device, status: part('status'), home: part('home'), time: part('time'), date: part('date'), notifs: part('notifs'), pages: part('pages'), dots: part('dots'), dock: part('dock'), shade: part('shade'), app: part('app'), bar: part('bar'), body: part('body') };
    dialog.setAttribute('data-phone', '');
    el.pages.addEventListener('scroll', onScroll, { passive: true });
    shown = ''; shade = false;
    if (host.api) checkReports(host.api); // opening the phone is the moment to look for a moderator's reply
  }
  function dropGhost() { ghost?.remove(); ghost = null; }
  /**
   * The close animation (see CLOSING above): hand the device to a ghost layer that leaves by itself.
   * Purely visual — whatever happens here, the caller has already let go of the phone.
   */
  function leave() {
    const stage = content.querySelector('.ph-stage');
    const box = stage?.getBoundingClientRect();
    if (!box || box.width < 2 || box.height < 2) return; // the dialog is already off screen
    if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const scrollTop = el.body.scrollTop, scrollLeft = el.pages.scrollLeft;
    dropGhost();
    const layer = document.createElement('div');
    layer.id = 'ph-ghost';
    layer.setAttribute('aria-hidden', 'true');
    layer.inert = true;
    stage.style.cssText = `left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px`;
    layer.append(stage); // moved, not copied: nothing is drawn twice
    (dialog.parentNode || document.body).append(layer);
    // Moving a scroller resets it: put the screen back where it was so nothing jumps as it leaves.
    const body = stage.querySelector('[data-ph="body"]'), pages = stage.querySelector('[data-ph="pages"]');
    if (body) { body.scrollTop = scrollTop; body.removeAttribute('data-panel'); } // a picture of the app, not the app
    if (pages) pages.scrollLeft = scrollLeft;
    ghost = layer;
    const done = (event) => { if (event.target !== stage) return; layer.remove(); if (ghost === layer) ghost = null; };
    layer.addEventListener('animationend', done);
    layer.addEventListener('animationcancel', done);
    // No animation to wait for (a stylesheet switched it off): do not leave a phone lying on the page.
    if (getComputedStyle(stage).animationName === 'none') dropGhost();
  }
  /** `animate: false` when the dialog stays open for another sheet. The shell's own calls animate. */
  function unmount(animate = true) {
    if (!el) return;
    if (animate) { try { leave(); } catch (error) { console.error('Phone close animation failed:', error); dropGhost(); } }
    el = null; shown = ''; lastApp = null; shade = false; sheet = null;
    dialog.removeAttribute('data-phone');
    html.delete(content);
    content.innerHTML = '';
  }

  function setShade(next) {
    if (!el || shade === next) return;
    shade = next;
    el.device.classList.toggle('is-shade', shade);
    el.shade.toggleAttribute('inert', !shade);
    el.home.toggleAttribute('inert', shade || Boolean(appKey(sheet)));
    for (const node of el.device.querySelectorAll('[data-ph-shade][aria-expanded]')) node.setAttribute('aria-expanded', String(shade));
    if (shade) el.shade.querySelector('button')?.focus();
    else el.notifs.querySelector('button')?.focus();
  }
  function goPage(next, { focus = false } = {}) {
    page = Math.max(0, Math.min(PAGES.length - 1, next));
    const target = el.pages.children[page];
    if (target) el.pages.scrollTo({ left: target.offsetLeft, behavior: 'auto' });
    set(el.dots, dotsHtml());
    if (focus) target?.querySelector('.ph-appbtn')?.focus();
  }
  /** The page in view after a swipe: only the dots change. Fires on user scrolling, never on a timer. */
  function onScroll() {
    const width = el?.pages.clientWidth || 1;
    const next = Math.max(0, Math.min(PAGES.length - 1, Math.round(el.pages.scrollLeft / width)));
    if (next !== page) { page = next; set(el.dots, dotsHtml()); }
  }

  /**
   * Draw the sheet. `force` redraws a `live: false` app (a form) too — the shell passes it when the
   * panel itself asked (api.refresh / api.open). Returns false when the sheet is not the phone's.
   */
  function render(nextState, nextView, nextSheet, force = false) {
    if (!hosts(nextSheet)) { unmount(false); return false; }
    state = nextState; view = nextView; sheet = nextSheet;
    const opening = !el;
    if (opening) mount();
    const key = appKey(sheet);
    el.device.dataset.wall = getWallpaper();
    set(el.status, statusHtml());

    // Home: always kept current underneath, so going back shows fresh badges at once.
    const now = new Date(view.now);
    if (el.time.textContent !== TIME.format(now)) el.time.textContent = TIME.format(now);
    const date = `${DATE.format(now)} · ${view.city?.name || 'Lagos'}`;
    if (el.date.textContent !== date) el.date.textContent = date;
    const lines = notifications();
    set(el.notifs, notifsHtml(lines));
    if (shade || opening) set(el.shade, shadeHtml(lines));
    const left = el.pages.scrollLeft, active = document.activeElement?.closest?.('[data-ph-app]')?.dataset.phApp;
    if (set(el.pages, pagesHtml())) { el.pages.scrollLeft = left; if (active && !key) el.pages.querySelector(`[data-ph-app="${CSS.escape(active)}"]`)?.focus(); }
    if (set(el.dock, dockHtml()) && active && !key) el.dock.querySelector(`[data-ph-app="${CSS.escape(active)}"]`)?.focus();
    set(el.dots, dotsHtml());

    // App layer.
    const changed = key !== shown;
    if (key) {
      const help = sheet.kind === 'help';
      const panel = help ? { id: 'help', title: 'Help' } : byId(sheet.id);
      const tint = tintOf(panel);
      el.device.style.setProperty('--app-tint', tint);
      set(el.bar, barHtml(panel.title, panel.id, tint));
      el.app.setAttribute('aria-label', panel.title);
      const still = !help && panel.live === false && !panel.pending && !force && !changed;
      if (!still) {
        el.body.dataset.panel = help ? '' : panel.id;
        if (help) el.body.removeAttribute('data-panel');
        const body = help ? host.helpHtml() : host.panelHtml(panel, sheet.params);
        if (changed) html.delete(el.body);
        if (set(el.body, body) && !help) host.bindPanels(el.app, sheet.params);
      }
      if (changed) { el.body.scrollTop = 0; lastApp = panel.id; setShade(false); }
    } else if (changed) {
      // Left an app: its body stays for the fade-out but no longer answers to its panel id, so a
      // late response cannot mistake it for an open app and re-open it.
      el.body.removeAttribute('data-panel');
      html.delete(el.body);
    }
    el.device.dataset.view = key ? 'app' : 'home';
    el.device.classList.toggle('is-wide', wide && Boolean(key));
    el.app.toggleAttribute('inert', !key);
    el.home.toggleAttribute('inert', Boolean(key) || shade);

    if (changed || opening) { shown = key; focusView(); }
    return true;
  }

  /** Keyboard focus follows the view: the back button in an app, the app's own icon back on the home screen. */
  function focusView() {
    if (!el) return;
    if (shown) { el.bar.querySelector('.ph-back')?.focus({ preventScroll: true }); return; }
    const wanted = focusNext || lastApp;
    const icon = (wanted && el.home.querySelector(`[data-ph-app="${CSS.escape(wanted)}"]`)) || el.dock.querySelector('.ph-appbtn') || el.pages.querySelector('.ph-appbtn');
    const owner = icon?.closest('[data-ph-page]');
    goPage(owner ? Number(owner.dataset.phPage) : page);
    icon?.focus({ preventScroll: true });
    focusNext = null;
  }

  // ---- input -----------------------------------------------------------------------------
  /** Esc / the back gesture: shade → app → home → closed. */
  function back() {
    if (!el) return false;
    if (shade) { setShade(false); return true; }
    if (appKey(sheet)) host.open('phone'); else host.close();
    return true;
  }
  /** Move focus between icons with the arrow keys, by where they are on screen; past the edge of a page, turn it. */
  function moveFocus(direction) {
    const current = document.activeElement?.closest?.('.ph-appbtn');
    const pageEl = el.pages.children[page];
    const pool = [...(pageEl?.querySelectorAll('.ph-appbtn') || []), ...el.dock.querySelectorAll('.ph-appbtn')];
    if (!current || !pool.includes(current)) { pool[0]?.focus(); return; }
    const from = current.getBoundingClientRect();
    const [dx, dy] = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[direction];
    let best = null, bestScore = Infinity;
    for (const node of pool) {
      if (node === current) continue;
      const box = node.getBoundingClientRect();
      const along = (box.left - from.left) * dx + (box.top - from.top) * dy;
      const across = Math.abs((box.left - from.left) * dy) + Math.abs((box.top - from.top) * dx);
      if (along < 8) continue;
      // Left/right stay in the row; up/down prefer the same column.
      if (dx && across > from.height / 2) continue;
      const score = along + across * 3;
      if (score < bestScore) { best = node; bestScore = score; }
    }
    if (best) { best.focus(); return; }
    if (dx && !current.hasAttribute('data-ph-dock')) {
      const next = page + dx;
      if (next < 0 || next >= PAGES.length) return;
      goPage(next);
      const row = [...el.pages.children[next].querySelectorAll('.ph-appbtn')];
      // Arrive on the row nearest to the one just left.
      const target = row.reduce((pick, node) => { const gap = Math.abs(node.getBoundingClientRect().top - from.top); return !pick || gap < pick.gap || (gap === pick.gap && dx < 0) ? { node, gap } : pick; }, null);
      target?.node.focus({ preventScroll: true });
    }
  }
  function onKeydown(event) {
    if (!el || event.ctrlKey || event.metaKey || event.altKey) return;
    const arrow = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }[event.key];
    if (!arrow) return;
    // Arrows belong to the phone while it is open: on the home screen they move between icons, in
    // an app they scroll or move the caret as usual. They never reach the scene behind.
    event.stopPropagation();
    if (appKey(sheet) || shade || event.target.matches?.('input, textarea, select')) return;
    event.preventDefault();
    moveFocus(arrow);
  }
  function onClick(event) {
    if (!el) return;
    // The stage around the device is "outside": a tap there closes the phone, like a tap on the backdrop.
    if (event.target === content || event.target.classList?.contains('ph-stage')) { host.close(); return; }
    const target = event.target.closest('[data-ph-shade],[data-ph-go],[data-ph-wide]');
    if (!target || !el.device.contains(target)) return;
    if ('phShade' in target.dataset) {
      if (!shade) set(el.shade, shadeHtml(notifications()));
      setShade(!shade);
    } else if ('phGo' in target.dataset) goPage(Number(target.dataset.phGo), { focus: false });
    else if ('phWide' in target.dataset) {
      wide = !wide;
      el.device.classList.toggle('is-wide', wide && Boolean(appKey(sheet)));
      html.delete(el.bar);
      const panel = sheet.kind === 'help' ? { id: 'help', title: 'Help' } : byId(sheet.id);
      set(el.bar, barHtml(panel.title, panel.id));
      el.bar.querySelector('.ph-wide')?.focus();
    }
  }
  dialog.addEventListener('keydown', onKeydown);
  dialog.addEventListener('click', onClick);

  return {
    hosts, render, back,
    /** The phone is closing (the shell calls this, then closes the dialog). Animated; see CLOSING above. */
    unmount: () => unmount(true),
    /** Put the keyboard focus where the current view expects it (called once the dialog is showing). */
    focus: focusView,
    /** True while the phone is on screen (home or an app). */
    get open() { return Boolean(el); },
    /** Which app icon gets the focus the next time the home screen shows. */
    focusOn(id) { focusNext = id; },
    destroy() { dialog.removeEventListener('keydown', onKeydown); dialog.removeEventListener('click', onClick); unmount(false); dropGhost(); },
  };
}
