/** Lazy panel group: the Sim sheet's tabs and the person card. Loaded on first open (see ../index.js). */
import sim from '../sim.js';
import career from '../career.js';
import people from '../people.js';
import settings from '../settings.js';

export default [sim, career, people, settings].flat();
