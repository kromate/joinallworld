/** Lazy panel group: Missions, Events, Bring a friend (with the share sheet) and Stay in touch. Loaded on first open (see ../index.js). */
import '../../phone/icons-more.js';
import missions from '../missions.js';
import events from '../events.js';
import refer from '../refer.js';
import touch from '../touch.js';

export default [missions, events, refer, touch].flat();
