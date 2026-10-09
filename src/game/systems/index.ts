/**
 * OWNER: foundation — feature owners never edit this file.
 * Registers host systems in a fixed order (base.ts, server-only living-world actions, then the UNILAG campus:
 * student before community, then the shuttle). This is what servers, the Worker, scripts and tests run. The browser
 * build swaps it for browser.ts (vite.config.ts), which omits server-only actions and registers campus stand-ins.
 */
import { BASE_SYSTEMS } from './base.ts';
import { registerSystem } from '../registry.ts';
import livingWorld from './living-world.ts';
import unilagStudent from '../../campus/unilag/student.ts';
import unilagCommunity from '../../campus/unilag/games.ts';
import unilagShuttle from '../../campus/unilag/shuttle.ts';

export const CAMPUS_SYSTEMS = [unilagStudent, unilagCommunity, unilagShuttle];
registerSystem(livingWorld);
for (const system of CAMPUS_SYSTEMS) registerSystem(system);
export const SYSTEMS = [...BASE_SYSTEMS, livingWorld, ...CAMPUS_SYSTEMS];
