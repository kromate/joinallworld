/**
 * OWNER: civic
 * Neighbourhood list.
 *
 * Placeholder panel, already registered by panels/index.js. Replace render() (and add bind,
 * keys, enabled, live as needed). The panel contract is at the top of src/ui/shell.js.
 * Styles: create ./neighbours.css and import it here; use the shared values in ../tokens.css.
 */
import { placeholder } from '../dom.js';

export default {
  id: 'neighbours', title: 'Neighbours', icon: '🏡', placement: 'phone',
  render() { return placeholder('Neighbours', 'Coming soon.'); },
};
