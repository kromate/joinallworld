/**
 * OWNER: character
 * Clothing and appearance shop.
 *
 * Placeholder panel, already registered by panels/index.js. Replace render() (and add bind,
 * keys, enabled, live as needed). The panel contract is at the top of src/ui/shell.js.
 * Styles: create ./boutique.css and import it here; use the shared values in ../tokens.css.
 */
import { placeholder } from '../dom.js';

export default {
  id: 'boutique', title: 'Boutique', icon: '👗', placement: 'phone',
  render() { return placeholder('Boutique', 'Coming soon.'); },
};
