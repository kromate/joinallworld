/**
 * OWNER: social
 * House invites: share a link, guests knock, host lets them in.
 *
 * Placeholder panel, already registered by panels/index.js. Replace render() (and add bind,
 * keys, enabled, live as needed). The panel contract is at the top of src/ui/shell.js.
 * Styles: create ./invite.css and import it here; use the shared values in ../tokens.css.
 */
import { placeholder } from '../dom.js';

export default {
  id: 'invite', title: 'Invite', icon: '🏠', placement: 'phone',
  render() { return placeholder('Invite', 'Coming soon.'); },
};
