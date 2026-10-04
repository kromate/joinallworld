/**
 * OWNER: foundation — feature owners never edit this file.
 * Registers every system in a fixed order (base.ts, then the UNILAG campus: student before community, then the shuttle).
 * This is what the servers, the Worker, the scripts and the tests run. The browser build swaps it for browser.ts
 * (vite.config.ts), which registers stand-ins for the campus and fetches its rules on first use.
 */
import { BASE_SYSTEMS } from './base.ts';
import { registerSystem } from '../registry.ts';
import unilagStudent from '../../campus/unilag/student.ts';
import unilagCommunity from '../../campus/unilag/games.ts';
import unilagShuttle from '../../campus/unilag/shuttle.ts';

export const CAMPUS_SYSTEMS = [unilagStudent, unilagCommunity, unilagShuttle];
for (const system of CAMPUS_SYSTEMS) registerSystem(system);
export const SYSTEMS = [...BASE_SYSTEMS, ...CAMPUS_SYSTEMS];
