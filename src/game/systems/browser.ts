/**
 * OWNER: foundation — feature owners never edit this file.
 * The browser's systems (it takes the place of index.ts in the build, vite.config.ts). Common life systems are registered;
 * stateless server-only living-world actions are omitted. The campus is a stand-in per system until its rules are fetched
 * (campus/unilag/register.ts, through game/campus-gate.ts), and the order stays the same.
 */
import { BASE_SYSTEMS } from './base.ts';
import { registerStandIn } from '../registry.ts';
import { CAMPUS_STAND_INS } from '../../campus/unilag/slices.ts';

for (const system of CAMPUS_STAND_INS) registerStandIn(system);
export const SYSTEMS = [...BASE_SYSTEMS, ...CAMPUS_STAND_INS];
