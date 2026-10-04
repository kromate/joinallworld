/**
 * OWNER: home
 * Buy mode: furniture catalogue and placement controls. A 'nav' panel renders inline above the
 * bottom nav while the home scene stays visible, and receives the furniture shortcuts through
 * keys(action): move-up/down/left/right, rotate, place, sell, catalogue.
 *
 * Placeholder panel, already registered by panels/index.js. The panel contract is at the top
 * of src/ui/shell.js. Styles: create ./buy.css and import it here.
 */
import { placeholder } from '../dom.js';

export default {
  id: 'buy', title: 'Buy', icon: '🛍️', placement: 'nav',
  /** Buy is only available at home; elsewhere the nav button is disabled with this reason. */
  enabled(state) { return state.location === 'home' || 'Go home to buy furniture'; },
  render() { return placeholder('Buy', 'The furniture catalogue is coming soon.') + '<button class="ui-button" data-close>Close</button>'; },
  keys() {},
};
