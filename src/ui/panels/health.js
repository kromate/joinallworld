/**
 * OWNER: world
 * Health app: current illness and weather effects, hospital treatment.
 *
 * Placeholder panel, already registered by panels/index.js. Replace render() (and add bind,
 * keys, enabled, live as needed). The panel contract is at the top of src/ui/shell.js.
 * Styles: create ./health.css and import it here; use the shared values in ../tokens.css.
 */
import { placeholder } from '../dom.js';

export default {
  id: 'health', title: 'Health', icon: '🩺', placement: 'phone',
  render() { return placeholder('Health', 'Coming soon.'); },
};
