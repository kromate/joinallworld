/**
 * OWNER: foundation — feature owners never edit this file.
 * Registers every system in a fixed order. Order matters twice: sanitize() runs in this
 * order (later systems may read what earlier ones wrote) and events/modifiers are delivered
 * in this order.
 */
import { registerSystem } from '../registry.ts';
import type { SystemDefinition } from '../../types/registry.ts';
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
import onboarding from './onboarding.ts';
import goals from './goals.ts';
import social from './social.ts';
import civic from './civic.ts';
import missions from './missions.ts';
import events from './events.ts';
import growth from './growth.ts';
// The UNILAG campus (src/campus/unilag): student before community, then the shuttle.
import unilagStudent from '../../campus/unilag/student.js';
import unilagCommunity from '../../campus/unilag/games.js';
import unilagShuttle from '../../campus/unilag/shuttle.js';

// Trust boundary: the campus systems are plain JavaScript (their ids are `string`); src/types/campus.ts describes them.
const campusSystems = [unilagStudent, unilagCommunity, unilagShuttle] as unknown as SystemDefinition[];

export const SYSTEMS = [core, wallet, inventory, needs, skills, career, activities, travel, health, economy, property, estate, home, onboarding, goals, social, civic, missions, events, growth, ...campusSystems];
for (const system of SYSTEMS) registerSystem(system);
