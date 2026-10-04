/**
 * OWNER: civic
 * Governor elections and announcements.
 *
 * Placeholder panel, already registered by panels/index.js. Replace render() (and add bind,
 * keys, enabled, live as needed). The panel contract is at the top of src/ui/shell.js.
 * Styles: create ./governor.css and import it here; use the shared values in ../tokens.css.
 */
import { placeholder } from '../dom.js';

export default {
  id: 'governor', title: 'Governor', icon: '🏛️', placement: 'phone',
  render() { return placeholder('Governor', 'Coming soon.'); },
};
