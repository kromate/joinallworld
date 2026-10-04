/**
 * OWNER: accounts
 * Settings tab of the Sim sheet: sound, notifications, recovery email, log out, new life.
 *
 * Placeholder panel, already registered by panels/index.js. Replace render() (and add bind,
 * keys, enabled, live as needed). The panel contract is at the top of src/ui/shell.js.
 * Styles: create ./settings.css and import it here; use the shared values in ../tokens.css.
 */
import { placeholder } from '../dom.js';

export default {
  id: 'settings', title: 'Settings', icon: '⚙️', placement: 'sim-tab', order: 70,
  render() { return placeholder('Settings', 'Coming soon.'); },
};
