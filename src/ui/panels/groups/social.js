/** Lazy panel group: contacts, family and house invites. Loaded on first open (see ../index.js). */
import contacts from '../contacts.js';
import family from '../family.js';
import invite from '../invite.js';

export default [contacts, family, invite].flat();
