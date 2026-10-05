/**
 * The campus rules, for a host that started with stand-ins (src/game/systems/browser.ts): importing this file replaces the
 * three stand-ins by the real systems, in their place in the order. It is a chunk of its own, fetched by
 * src/game/campus-gate.ts and by the Campus app. The servers register the same systems from src/game/systems/index.ts.
 */
import { completeSystem, isStandIn } from '../../game/registry.ts';
import unilagStudent from './student.ts';
import unilagCommunity from './games.ts';
import unilagShuttle from './shuttle.ts';

for (const system of [unilagStudent, unilagCommunity, unilagShuttle]) if (isStandIn(system.id)) completeSystem(system);
