/** Lazy panel group: character creation and the account landing. Loaded on first open (see ../index.js). */
import '../../phone/icons-more.js';
import onboarding, { HOME_EXTRAS } from '../onboarding.js';
import { lgaHomeExtra } from '../lga-card.js';
import account from '../account.js';

// Where you live: the local-government choice is the world layer's section of the settle-in Home card.
if (!HOME_EXTRAS.includes(lgaHomeExtra)) HOME_EXTRAS.push(lgaHomeExtra);

export default [onboarding, account].flat();
