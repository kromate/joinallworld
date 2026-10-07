/**
 * OWNER: foundation — feature owners never edit this file.
 * The systems every host runs, registered in their fixed order. Order matters twice: sanitize() runs in this
 * order (later systems may read what earlier ones wrote) and events/modifiers are delivered in this order.
 * index.ts adds the UNILAG campus after them; the browser build (browser.ts) adds stand-ins for it instead.
 */
import { registerSystem } from '../registry.ts';
import core from './core.ts';
import wallet from './wallet.ts';
import inventory from './inventory.ts';
import needs from './needs.ts';
import skills from './skills.ts';
import career from './career.ts';
import activities from './activities.ts';
import travel from './travel.ts';
import health from './health.ts';
import economy from './economy.ts';
import property from './property.ts';
import estate from './estate.ts';
import home from './home.ts';
import stories from './stories.ts';
import land from './land.ts';
import street from './street.ts';
import onboarding from './onboarding.ts';
import goals from './goals.ts';
import social from './social.ts';
import civic from './civic.ts';
import missions from './missions.ts';
import events from './events.ts';
import growth from './growth.ts';
import business from './business.ts';

export const BASE_SYSTEMS = [core, wallet, inventory, needs, skills, career, activities, travel, health, economy, property, estate, home, stories, land, street, onboarding, goals, social, civic, missions, events, growth, business];
for (const system of BASE_SYSTEMS) registerSystem(system);
