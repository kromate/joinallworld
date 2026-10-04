/**
 * OWNER: foundation — feature owners never edit this file.
 * The panel registry. The panel contract is at the top of src/ui/shell.js.
 *
 * EAGER panels are imported here and are part of the first download: everything the first
 * paint needs (the session gate, the HUD chips, the two nav panels).
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
import city from './city.js';
import map from './map.js';
import health from './health.js';
import buy from './buy.js';
import goals from './goals.js';
import messages from './messages.js';
import hunt from './hunt.js';
import radio from './radio.js';

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

const money = lazyGroup(() => import('./groups/money.js'), [
  { id: 'jobs', title: 'Jobs', icon: '💼', placement: 'phone', order: 10 },
  { id: 'bank', title: 'Bank', icon: '🏦', placement: 'phone', order: 14 },
  { id: 'groceries', title: 'Groceries', icon: '🛒', placement: 'phone', order: 16 },
  { id: 'ride', title: 'Ride', icon: '🚕', placement: 'phone', order: 18 },
  { id: 'houses', title: 'Houses', icon: '🏘️', placement: 'phone', order: 30 },
  { id: 'boutique', title: 'Boutique', icon: '👗', placement: 'phone', order: 32 },
  { id: 'cars', title: 'Cars', icon: '🚗', placement: 'phone', order: 34 },
  { id: 'invest', title: 'Invest', icon: '📊', placement: 'phone', order: 50 },
]);
const sim = lazyGroup(() => import('./groups/sim.js'), [
  { id: 'profile', title: 'Profile', icon: '👤', placement: 'sim-tab', order: 10, live: false },
  { id: 'needs', title: 'Needs', icon: '❤️', placement: 'sim-tab', order: 20 },
  { id: 'skills', title: 'Skills', icon: '🎓', placement: 'sim-tab', order: 40 },
  { id: 'people', title: 'People', icon: '👥', placement: 'sim-tab', order: 50 },
  { id: 'person', title: 'Person', icon: '🧑🏾', placement: 'modal' },
  { id: 'career', title: 'Career', icon: '📈', placement: 'sim-tab', order: 60 },
  { id: 'settings', title: 'Settings', icon: '⚙️', placement: 'sim-tab', order: 70 },
]);
const social = lazyGroup(() => import('./groups/social.js'), [
  { id: 'contacts', title: 'Contacts', icon: '📇', placement: 'phone', order: 20 },
  { id: 'family', title: 'Family', icon: '👪', placement: 'phone', order: 36 },
  { id: 'invite', title: 'Invite', icon: '🏠', placement: 'phone', order: 38 },
]);
const civic = lazyGroup(() => import('./groups/civic.js'), [
  { id: 'governor', title: 'Governor', icon: '🏛️', placement: 'phone', order: 40, live: false },
  { id: 'state-house', title: 'State House', icon: '🏛️', placement: 'modal' },
  { id: 'neighbours', title: 'Neighbours', icon: '🏡', placement: 'phone', order: 42 },
  { id: 'ads', title: 'Billboards', icon: '📢', placement: 'phone', order: 44, live: false },
  { id: 'richlist', title: 'Rich List', icon: '🏆', placement: 'phone', order: 48 },
]);
const start = lazyGroup(() => import('./groups/start.js'), [
  // `required` must answer before the code is here: a brand-new life is held in character creation.
  { id: 'onboarding', title: 'Create your Sim', icon: '✨', placement: 'modal', live: false,
    required: (state, view) => (view.onboarding?.required ? 'Finish creating your Sim to start playing.' : null) },
  { id: 'account', title: 'Account', icon: '🔑', placement: 'modal' },
]);

export const PANELS = buildPanels([session, city, map, health, buy, goals, messages, hunt, radio, money, sim, social, civic, start]);

/** The panel that handles "no session / expired session". A non-foundation panel with role 'session-gate' wins. */
export const sessionGate = () => PANELS.find((panel) => panel.role === 'session-gate' && panel.id !== 'session') || PANELS.find((panel) => panel.id === 'session');
