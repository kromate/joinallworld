/**
 * OWNER: character
 * Character creation flow: look, personality, dream, birth lottery, home. Open with api.open('onboarding').
 *
 * Placeholder panel, already registered by panels/index.js. Replace render() (and add bind,
 * keys, enabled, live as needed). The panel contract is at the top of src/ui/shell.js.
 * Styles: create ./onboarding.css and import it here; use the shared values in ../tokens.css.
 */
import { placeholder } from '../dom.js';

export default {
  id: 'onboarding', title: 'Create your Sim', icon: '✨', placement: 'modal',
  render() { return placeholder('Create your Sim', 'Coming soon.'); },
};
