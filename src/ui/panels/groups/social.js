/** Lazy panel group: Messages, contacts, family and house invites. Loaded on first open (see ../index.js). */
import '../../phone/icons-more.ts';
import messages from '../messages.js';
import contacts from '../contacts.js';
import family from '../family.js';
import invite from '../invite.js';

export default [messages, contacts, family, invite].flat();
