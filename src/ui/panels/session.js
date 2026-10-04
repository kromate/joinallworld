/**
 * OWNER: foundation
 * Device-session entry: nickname prompt for a new device, and the expired-session notice.
 * Unchanged behaviour: a nickname identifies a browser, not a person.
 */
import { esc } from '../dom.js';

export default {
  id: 'session', title: 'Your city life', icon: '🌍', placement: 'modal', role: 'session-gate', live: false,
  render(state, view) {
    if (view.params?.reason === 'expired') {
      return '<h3>Your device session has expired</h3><p>Your saved preview is still on this browser. The server has retained the old life, but recovery is not available yet. Starting a new life creates a separate identity.</p><button class="ui-button" data-close>Keep my saved preview</button> <button class="ui-button is-primary" data-session-new>Start a separate new life</button>';
    }
    return `<h3>Start your city life</h3><p>Choose a nickname for this device. This is not a verified account.</p><form data-session-form><label>Your nickname <input name="name" minlength="3" maxlength="24" required autocomplete="nickname" value="${esc(view.name === 'New Lagosian' ? '' : view.name)}"></label><button class="ui-button is-primary">Start life</button></form>`;
  },
  bind(root, api) {
    const start = (name) => { api.close(); window.dispatchEvent(new CustomEvent('jaw:start-life', { detail: { name } })); };
    root.querySelector('[data-session-form]')?.addEventListener('submit', (event) => { event.preventDefault(); start(new FormData(event.target).get('name').trim()); });
    root.querySelector('[data-session-new]')?.addEventListener('click', () => start(null));
  },
};
