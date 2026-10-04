/**
 * OWNER: civic
 * Club radio: what is playing at the club.
 *
 * Placeholder panel, already registered by panels/index.js. Replace render() (and add bind,
 * keys, enabled, live as needed). The panel contract is at the top of src/ui/shell.js.
 * Styles: create ./radio.css and import it here; use the shared values in ../tokens.css.
 */
import { placeholder } from '../dom.js';

export default {
  id: 'radio', title: 'Radio', icon: '📻', placement: 'phone',
  render() { return placeholder('Radio', 'Coming soon.'); },
};
