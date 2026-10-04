/**
 * OWNER: home
 * Grocery ordering: buy ingredients into the inventory (prices in src/game/content/food.js).
 *
 * Placeholder panel, already registered by panels/index.js. Replace render() (and add bind,
 * keys, enabled, live as needed). The panel contract is at the top of src/ui/shell.js.
 * Styles: create ./groceries.css and import it here; use the shared values in ../tokens.css.
 */
import { placeholder } from '../dom.js';

export default {
  id: 'groceries', title: 'Groceries', icon: '🛒', placement: 'phone',
  render() { return placeholder('Groceries', 'Coming soon.'); },
};
