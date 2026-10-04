/**
 * OWNER: home
 * Car dealership and owned cars.
 *
 * Placeholder panel, already registered by panels/index.js. Replace render() (and add bind,
 * keys, enabled, live as needed). The panel contract is at the top of src/ui/shell.js.
 * Styles: create ./cars.css and import it here; use the shared values in ../tokens.css.
 */
import { placeholder } from '../dom.js';

export default {
  id: 'cars', title: 'Cars', icon: '🚗', placement: 'phone',
  render() { return placeholder('Cars', 'Coming soon.'); },
};
