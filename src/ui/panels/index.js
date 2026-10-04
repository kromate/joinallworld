/**
 * OWNER: foundation — feature owners never edit this file.
 * The panel registry. The panel contract is at the top of src/ui/shell.js.
 *
 * EAGER panels are imported here and are part of the first download: only what the first paint
 * needs — the session gate, the landing screen (./quick-start.js: a name, a quick character, Play) and the HUD chips (goal, home, inbox, gem hunt, club radio, health,
 * weather, the roadside prompt). A chip's file holds the chip alone; the app or sheet it opens is a lazy
 * panel like any other (inbox.js → messages.js, hunt-chip.js → hunt.js, home-chip.js → buy.js, roadside-chip.js → map.js …).
 * The two nav panels, Map and Buy, are lazy too: the Map's own 3D code is fetched on first open anyway.
 *
 * LAZY panels are listed here as STATIC METADATA ONLY — id, title, icon, placement, order and
 * `live` — and their code lives in a group module under ./groups/ that is fetched with a
 * dynamic import() the first time one of its panels is opened. Because the metadata is static,
 * a lazy Phone app is in the Phone grid, and a lazy Sim tab is in the tab row, before any of
 * its code has been downloaded. Until its group arrives a lazy panel is a stub with
 * `pending: true`; the shell shows a small loading state, calls `panel.load()`, and re-renders
 * when the group has been adopted (the stub object is filled in place, so every reference to
 * it — the registry, the shell's lookup map — becomes the real panel).
 *
 * TO ADD A LAZY PANEL: export it from its file as usual, import that file in one group module,
 * and add its metadata line to that group below. `npm run build` keeps one chunk per group.
 * A panel a group exports without a metadata line here is reported in the console and ignored.
 */
import session from './session.js';
import quickStart from './quick-start.js';
import city from './city.js';
import roadsideChip from './roadside-chip.js';
import healthChips from './health-chips.js';
import homeChip from './home-chip.js';
import goalChip from './goal-chip.js';
import inbox, { messagesBadge, notifications } from './inbox.js';
import huntChip from './hunt-chip.js';
import radioBanner from './radio-banner.js';
import { S as social } from './social-client.js';
import { civicNews } from './civic-ui.js';
import { reportReplies } from '../phone/reports.js';

const PLACEMENTS = ['phone', 'nav', 'hud', 'sim-tab', 'modal'];
const RESERVED = ['phone', 'sim', 'help', 'home', 'venue'];

/**
 * Stubs for one lazily loaded group. `load` is the dynamic import of the group module, whose
 * default export is the array of real panels. All stubs of a group share one download.
 */
export function lazyGroup(load, metas) {
  let loading = null;
  const stubs = metas.map((meta) => ({ ...meta, pending: true, render: () => '' }));
  const adopt = (module) => {
    for (const panel of [module.default].flat()) {
      const stub = stubs.find((item) => item.id === panel.id);
      if (!stub) { console.error(`Lazy panel "${panel.id}" has no metadata line in src/ui/panels/index.js and was ignored.`); continue; }
      // Placement and order stay as listed: the grid must not reshuffle when code arrives.
      Object.assign(stub, panel, { placement: stub.placement, order: stub.order });
    }
    for (const stub of stubs) delete stub.pending;
  };
  const start = () => {
    loading ??= load().then(adopt).catch((error) => { loading = null; throw error; });
    return loading;
  };
  for (const stub of stubs) stub.load = start;
  return stubs;
}

export function buildPanels(modules) {
  const panels = modules.flat();
  const ids = new Set();
  for (const panel of panels) {
    if (!panel || typeof panel.id !== 'string' || typeof panel.render !== 'function' || !PLACEMENTS.includes(panel.placement)) throw new Error(`Invalid panel: ${panel?.id}`);
    if (ids.has(panel.id) || RESERVED.includes(panel.id)) throw new Error(`Duplicate or reserved panel id: ${panel.id}`);
    ids.add(panel.id);
  }
  return panels.map((panel, index) => ({ panel, index })).sort((a, b) => (a.panel.order ?? 100) - (b.panel.order ?? 100) || a.index - b.index).map((entry) => entry.panel);
}

/*
 * PHONE METADATA (all static, so the home screen is complete before any group has loaded):
 *   group   where the icon sits on the home screen: 'life' | 'money' | 'people' | 'city'
 *   short   a shorter label under the icon when the title is long
 *   phone   true = a Sim tab that is also an app on the home screen (it opens in the phone from there)
 *   badge   (state, view) → count for the red badge, from data already in the view (never a fetch)
 * Icons come from the icon set by panel id (glyphFor in src/ui/phone/icons.js; the Phone's colours are in
 * icons-more.js). A panel sets `icon` only to name a different glyph. No emoji anywhere.
 */
/** Rent that is overdue or that the balance will not cover, and a loan instalment the balance will not cover. */
const billsDue = (state, view) => {
  const { rent, loan } = view.economy || {};
  return (rent?.warning ? 1 : 0) + (loan && !loan.cleared && !loan.prepaid && loan.weekBlocked ? 1 : 0);
};
/** Friend and Bae requests waiting for an answer; knocks at the door. */
const requestsWaiting = () => (social.me?.requests.in.length || 0) + (social.me?.baeRequests.length || 0);
const knocksWaiting = () => social.me?.house.knocks.length || 0;

const money = lazyGroup(() => import('./groups/money.js'), [
  { id: 'jobs', title: 'Jobs', placement: 'phone', order: 10, group: 'money' },
  { id: 'bank', title: 'Bank', placement: 'phone', order: 14, group: 'money', badge: billsDue },
  { id: 'groceries', title: 'Groceries', placement: 'phone', order: 16, group: 'life' },
  { id: 'ride', title: 'Ride', placement: 'phone', order: 18, group: 'life', badge: (state, view) => (view.travel?.event ? 1 : 0) },
  { id: 'houses', title: 'Houses', placement: 'phone', order: 30, group: 'life' },
  { id: 'boutique', title: 'Boutique', placement: 'phone', order: 32, group: 'life' },
  { id: 'cars', title: 'Cars', placement: 'phone', order: 34, group: 'life' },
  { id: 'invest', title: 'Invest', placement: 'phone', order: 50, group: 'money' },
]);
const sim = lazyGroup(() => import('./groups/sim.js'), [
  { id: 'profile', title: 'Profile', placement: 'sim-tab', order: 10, live: false },
  { id: 'needs', title: 'Needs', placement: 'sim-tab', order: 20 },
  { id: 'goals', title: 'Goals', placement: 'sim-tab', order: 30, phone: true, group: 'life' },
  { id: 'skills', title: 'Skills', placement: 'sim-tab', order: 40 },
  { id: 'people', title: 'People', placement: 'sim-tab', order: 50, phone: true, group: 'people', badge: requestsWaiting },
  { id: 'person', title: 'Person', placement: 'modal' },
  { id: 'career', title: 'Career', placement: 'sim-tab', order: 60, phone: true, group: 'money' },
  { id: 'settings', title: 'Settings', placement: 'sim-tab', order: 70, phone: true, group: 'life' },
]);
const socialApps = lazyGroup(() => import('./groups/social.js'), [
  // Messages: the badge and the notification lines are static (./inbox.js), so they work before the app's code is here.
  { id: 'messages', title: 'Messages', placement: 'phone', order: 12, group: 'people', badge: messagesBadge, notifications },
  { id: 'contacts', title: 'Contacts', placement: 'phone', order: 20, group: 'people' },
  { id: 'family', title: 'Family', placement: 'phone', order: 36, group: 'people' },
  { id: 'invite', title: 'Invite', placement: 'phone', order: 38, group: 'people', badge: knocksWaiting },
]);
const civic = lazyGroup(() => import('./groups/civic.js'), [
  { id: 'governor', title: 'Governor', placement: 'phone', order: 40, live: false, group: 'city', badge: (state, view) => civicNews(view, state) },
  { id: 'state-house', title: 'State House', placement: 'modal' },
  { id: 'neighbours', title: 'Neighbours', placement: 'phone', order: 42, group: 'city' },
  { id: 'ads', title: 'Billboards', placement: 'phone', order: 44, live: false, group: 'city' },
  { id: 'hunt-sheet', title: 'Gem hunt', placement: 'phone', order: 45, group: 'city', badge: (state, view) => (view.civic?.hunt?.canClaim ? 1 : 0) },
  { id: 'radio', title: 'Radio', placement: 'phone', order: 46, live: false, group: 'city' },
  { id: 'richlist', title: 'Rich List', placement: 'phone', order: 48, group: 'money' },
]);
const trust = lazyGroup(() => import('./groups/trust.js'), [
  { id: 'statement', title: 'Statement', placement: 'phone', order: 15, group: 'money' },
  { id: 'support', title: 'Report a problem', short: 'Report', placement: 'phone', order: 96, live: false, group: 'city', badge: () => reportReplies() },
]);
const start = lazyGroup(() => import('./groups/start.js'), [
  // Settling in ("Make this life yours") is offered, never required: a new life starts from the landing screen (./quick-start.js, eager).
  { id: 'onboarding', title: 'Make this life yours', placement: 'modal', live: false },
  { id: 'account', title: 'Account', placement: 'modal' },
]);
const life = lazyGroup(() => import('./groups/life.js'), [
  { id: 'health', title: 'Health', placement: 'phone', order: 22, group: 'life', badge: (state, view) => (view.health?.sick || view.health?.rundown ? 1 : 0) },
]);
const map = lazyGroup(() => import('./groups/map.js'), [
  { id: 'map', title: 'Map', placement: 'nav' },
  { id: 'roadside', title: 'On the road', placement: 'modal' },
]);
const home = lazyGroup(() => import('./groups/home.js'), [
  // `enabled` must answer before the code is here: Buy is only available at home, and the nav button says why elsewhere.
  { id: 'buy', title: 'Buy', placement: 'nav', enabled: (state) => state.location === 'home' || 'Go home to buy furniture' },
]);

export const PANELS = buildPanels([session, quickStart, city, map, roadsideChip, healthChips, home, homeChip, goalChip, inbox, huntChip, radioBanner, money, sim, socialApps, civic, trust, start, life]);

/** The panel that handles "no session / expired session". A non-foundation panel with role 'session-gate' wins. */
export const sessionGate = () => PANELS.find((panel) => panel.role === 'session-gate' && panel.id !== 'session') || PANELS.find((panel) => panel.id === 'session');
