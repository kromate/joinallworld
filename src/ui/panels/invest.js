/**
 * OWNER: career
 * Investment app.
 *
 * Placeholder panel, already registered by panels/index.js. Replace render() (and add bind,
 * keys, enabled, live as needed). The panel contract is at the top of src/ui/shell.js.
 * Styles: create ./invest.css and import it here; use the shared values in ../tokens.css.
 */
import { placeholder } from '../dom.js';

export default {
  id: 'invest', title: 'Invest', icon: '📊', placement: 'phone',
  render() { return placeholder('Invest', 'Coming soon.'); },
};
