/**
 * OWNER: civic
 * Daily gem hunt chip in the top-left HUD stack.
 *
 * Placeholder panel, already registered by panels/index.js. A 'hud' panel renders a small
 * chip that is always visible; return '' to hide it (as this placeholder does). The panel
 * contract is at the top of src/ui/shell.js. Styles: create ./hunt.css and import it here.
 */
export default {
  id: 'hunt', title: 'Daily hunt', icon: '💎', placement: 'hud', order: 20,
  render() { return ''; },
};
