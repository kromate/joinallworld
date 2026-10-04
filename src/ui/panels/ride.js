/**
 * OWNER: world
 * Ride-hailing app: order a ride to a venue.
 *
 * Placeholder panel, already registered by panels/index.js. Replace render() (and add bind,
 * keys, enabled, live as needed). The panel contract is at the top of src/ui/shell.js.
 * Styles: create ./ride.css and import it here; use the shared values in ../tokens.css.
 */
import { placeholder } from '../dom.js';

export default {
  id: 'ride', title: 'Ride', icon: '🚕', placement: 'phone',
  render() { return placeholder('Ride', 'Coming soon.'); },
};
