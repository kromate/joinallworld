/**
 * OWNER: career
 * Career tab of the Sim sheet: level, pay, schedule, performance, next promotion.
 *
 * Placeholder panel, already registered by panels/index.js. Replace render() (and add bind,
 * keys, enabled, live as needed). The panel contract is at the top of src/ui/shell.js.
 * Styles: create ./career.css and import it here; use the shared values in ../tokens.css.
 */
import { placeholder } from '../dom.js';

export default {
  id: 'career', title: 'Career', icon: '📈', placement: 'sim-tab', order: 60,
  render() { return placeholder('Career', 'Coming soon.'); },
};
