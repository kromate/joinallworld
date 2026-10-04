/**
 * OWNER: social
 * Contacts: friends, NPC contacts, find a player.
 *
 * Placeholder panel, already registered by panels/index.js. Replace render() (and add bind,
 * keys, enabled, live as needed). The panel contract is at the top of src/ui/shell.js.
 * Styles: create ./contacts.css and import it here; use the shared values in ../tokens.css.
 */
import { placeholder } from '../dom.js';

export default {
  id: 'contacts', title: 'Contacts', icon: '📇', placement: 'phone',
  render() { return placeholder('Contacts', 'Coming soon.'); },
};
