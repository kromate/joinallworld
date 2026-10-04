/**
 * OWNER: home
 * Housing market: neighbourhoods, rents, moving.
 *
 * Placeholder panel, already registered by panels/index.js. Replace render() (and add bind,
 * keys, enabled, live as needed). The panel contract is at the top of src/ui/shell.js.
 * Styles: create ./houses.css and import it here; use the shared values in ../tokens.css.
 */
import { placeholder } from '../dom.js';

export default {
  id: 'houses', title: 'Houses', icon: '🏘️', placement: 'phone',
  render() { return placeholder('Houses', 'Coming soon.'); },
};
