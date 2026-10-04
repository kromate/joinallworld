/**
 * OWNER: social
 * Direct messages and groups.
 *
 * Placeholder panel, already registered by panels/index.js. Replace render() (and add bind,
 * keys, enabled, live as needed). The panel contract is at the top of src/ui/shell.js.
 * Styles: create ./messages.css and import it here; use the shared values in ../tokens.css.
 */
import { placeholder } from '../dom.js';

export default {
  id: 'messages', title: 'Messages', icon: '✉️', placement: 'phone',
  render() { return placeholder('Messages', 'Coming soon.'); },
};
