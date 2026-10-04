/** Lazy panel group: the Sim sheet's tabs (Profile, Needs, Goals, Skills, People, Career, Settings) and the person card. Loaded on first open (see ../index.js). */
import '../../phone/icons-more.ts';
import sim from '../sim.js';
import goals from '../goals.js';
import career from '../career.js';
import people from '../people.js';
import settings from '../settings.js';

export default [sim, goals, career, people, settings].flat();
