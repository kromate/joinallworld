/**
 * OWNER: foundation
 * Device-session entry: the nickname prompt for a new device, and what to do when the server no
 * longer knows this browser's session.
 *
 * A nickname identifies a browser, not a person. When the server refuses the nickname (not
 * allowed, malformed, or the player is muted) the form comes back with its reason.
 *
 * `reason: 'expired'` is the case where the server is reachable but answers 401 to a browser that
 * still holds a cached life: the server's data was reset (a local server restarted with an empty
 * data folder) or the session ran out. This is NOT "offline" and the panel never says so: it says
 * what happened and puts "Start a new life" one tap away, with "Try again" beside it.
 */
import { esc } from '../dom.js';

/** The way back to the original Allworld world, offered before a city identity is started or replaced: ordinary navigation, a separate save. */
export const LEGACY_CHARACTER_URL = 'https://joinallworld.com/old-character.html';
export const legacyCharacterHtml = () => `<p class="session-legacy"><a class="legacy-character-link" href="${LEGACY_CHARACTER_URL}">Open your original Allworld character</a><span>Your original world and this city life have separate saves.</span></p>`;

export default {
  id: 'session', title: 'Your city life', placement: 'modal', role: 'session-gate', live: false,
  /** A new device stays in nickname entry until the server has accepted its session; an expired saved preview stays dismissible. */
  required(state, view) {
    return view.params?.reason === 'new' && !view.connected ? 'Choose a nickname and start your life first.' : null;
  },
  render(state, view) {
    if (view.params?.reason === 'expired') {
      return `<div class="session-card is-warn"><h3>This device’s saved life is no longer on this server</h3>
        <p>The server is running, but it has no record of the life this browser remembers. That happens when the server’s data was reset, or when a session is not used for 30 days.</p>
        <p>What you see behind this sheet is the copy kept on this device: you can look, but nothing can change.</p></div>
        <div class="session-actions"><button class="ui-button is-primary is-block" data-session-new>Start a new life</button><button class="ui-button is-block" data-session-retry>Try again</button></div>
        <p class="session-note">Starting a new life keeps your nickname${view.name && view.name !== 'New Lagosian' ? ` (${esc(view.name)})` : ''} and begins with a quick character and a fresh start in the city. The old life cannot be brought back from this device.</p>${legacyCharacterHtml()}`;
    }
    const problem = view.params?.problem;
    return `<div class="session-card"><h3>Start your city life</h3><p>Choose a nickname for this device. There is no password and no e-mail: a cookie in this browser is the key to your life.</p></div>
      ${problem?.reason ? `<p class="ui-error" role="alert">${esc(problem.reason)}</p>` : ''}
      <form class="session-form" data-session-form><label>Your nickname <input name="name" minlength="3" maxlength="24" required autocomplete="nickname" value="${esc(problem?.name ?? (view.name === 'New Lagosian' ? '' : view.name))}"></label><button class="ui-button is-primary is-block">Start life</button></form>${legacyCharacterHtml()}`;
  },
  bind(root, api) {
    // The nickname gate of a new device is locked until the session exists (required above): the shell releases it once connected.
    const start = (name) => { api.close(); window.dispatchEvent(new CustomEvent('jaw:start-life', { detail: { name } })); };
    root.querySelector('[data-session-form]')?.addEventListener('submit', (event) => { event.preventDefault(); start(new FormData(event.target).get('name').trim()); });
    root.querySelector('[data-session-new]')?.addEventListener('click', () => start(null));
    // "Try again" asks the server once more; if it still does not know this session, this sheet comes back.
    root.querySelector('[data-session-retry]')?.addEventListener('click', () => { api.close(); window.dispatchEvent(new CustomEvent('jaw:reconnect')); });
  },
};
