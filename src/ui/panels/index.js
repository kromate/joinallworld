/**
 * OWNER: foundation — feature owners never edit this file.
 * Imports and registers every panel. A panel file may export one panel or an array.
 * The panel contract is at the top of src/ui/shell.js.
 */
import session from './session.js';
import city from './city.js';
import map from './map.js';
import ride from './ride.js';
import health from './health.js';
import jobs from './jobs.js';
import career from './career.js';
import bank from './bank.js';
import invest from './invest.js';
import buy from './buy.js';
import houses from './houses.js';
import cars from './cars.js';
import groceries from './groceries.js';
import onboarding from './onboarding.js';
import goals from './goals.js';
import sim from './sim.js';
import boutique from './boutique.js';
import account from './account.js';
import settings from './settings.js';
import people from './people.js';
import messages from './messages.js';
import contacts from './contacts.js';
import family from './family.js';
import invite from './invite.js';
import governor from './governor.js';
import neighbours from './neighbours.js';
import ads from './ads.js';
import richlist from './richlist.js';
import hunt from './hunt.js';
import radio from './radio.js';

const PLACEMENTS = ['phone', 'nav', 'hud', 'sim-tab', 'modal'];
const RESERVED = ['phone', 'sim', 'help', 'home', 'venue'];

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

export const PANELS = buildPanels([session, city, map, ride, health, jobs, career, bank, invest, buy, houses, cars, groceries, onboarding, goals, sim, boutique,
  account, settings, people, messages, contacts, family, invite, governor, neighbours, ads, richlist, hunt, radio]);

/** The panel that handles "no session / expired session". A non-foundation panel with role 'session-gate' wins. */
export const sessionGate = () => PANELS.find((panel) => panel.role === 'session-gate' && panel.id !== 'session') || PANELS.find((panel) => panel.id === 'session');
