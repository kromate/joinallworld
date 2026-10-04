/**
 * OWNER: foundation — feature owners never edit this file.
 * Registers every system in a fixed order. Order matters twice: sanitize() runs in this
 * order (later systems may read what earlier ones wrote) and events/modifiers are delivered
 * in this order.
 */
import { registerSystem } from '../registry.js';
import core from './core.js';
import wallet from './wallet.js';
import inventory from './inventory.js';
import needs from './needs.js';
import skills from './skills.js';
import career from './career.js';
import activities from './activities.js';
import travel from './travel.js';
import health from './health.js';
import economy from './economy.js';
import property from './property.js';
import home from './home.js';
import onboarding from './onboarding.js';
import goals from './goals.js';
import social from './social.js';
import civic from './civic.js';

import unilagStudent from '../../campus/unilag/student.js';
import unilagCommunity from '../../campus/unilag/games.js';
import unilagShuttle from '../../campus/unilag/shuttle.js';

export const SYSTEMS = [core, wallet, inventory, needs, skills, career, activities, travel, health, economy, property, home, onboarding, goals, social, civic, unilagStudent, unilagCommunity, unilagShuttle];
for (const system of SYSTEMS) registerSystem(system);
