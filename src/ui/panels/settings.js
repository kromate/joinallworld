/**
 * OWNER: foundation (integration wave)
 * Settings tab of the Sim sheet: sound and music preferences, the device-session explanation
 * and the privacy switches the server already offers.
 *
 * Sound effects and Music are PREFERENCES ONLY in this build: the game ships no audio, so the
 * switches change nothing audible yet and the panel says so. They are stored on this device
 * (localStorage) and nowhere else; nothing here is sent to the server.
 *
 * There is no account section: accounts are a separate proposal that is not merged. The panel
 * explains what a device session is instead, so nobody mistakes it for a password-protected
 * account. The panel contract is at the top of src/ui/shell.js.
 */
import './settings.css';
import { esc } from '../dom.js';

export const SETTINGS_KEY = 'joinallworld-settings-v1';
const DEFAULTS = Object.freeze({ sound: true, music: true });
const OPTIONS = [
  { id: 'sound', label: 'Sound effects', hint: 'Taps, coins and arrivals.' },
  { id: 'music', label: 'Music', hint: 'Background music in venues.' },
];
let cached = null, warning = '';

/** The saved preferences, with anything missing or malformed replaced by its default. */
export function readSettings(storage) {
  let saved = null;
  try { saved = JSON.parse(storage?.getItem(SETTINGS_KEY)); } catch { saved = null; }
  const source = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  return Object.fromEntries(Object.keys(DEFAULTS).map((key) => [key, typeof source[key] === 'boolean' ? source[key] : DEFAULTS[key]]));
}
function store() { try { return window.localStorage; } catch { return null; } }
function settings() { return cached || (cached = readSettings(store())); }
function save(next) {
  cached = next;
  try { const target = store(); if (!target) throw Error('no storage'); target.setItem(SETTINGS_KEY, JSON.stringify(next)); warning = ''; }
  catch { warning = 'This browser would not save the setting, so it lasts only until you close the tab.'; }
}

export default {
  id: 'settings', title: 'Settings', icon: '⚙️', placement: 'sim-tab', order: 70,
  render(state, view) {
    const current = settings();
    const session = view.session;
    const toggles = OPTIONS.map((option) => `<label class="settings-row"><span><strong>${esc(option.label)}</strong><small>${esc(option.hint)}</small></span>
      <input type="checkbox" role="switch" data-setting="${esc(option.id)}" ${current[option.id] ? 'checked' : ''} aria-label="${esc(option.label)}"><span class="settings-state">${current[option.id] ? 'On' : 'Off'}</span></label>`).join('');
    return `<h3>Sound</h3>${toggles}
      <p class="settings-note">This beta has no audio yet, so these switches change nothing you can hear today. Your choice is saved on this device and will apply when sound ships.</p>
      ${warning ? `<p class="ui-error" role="alert">${esc(warning)}</p>` : ''}
      <h3>This device</h3>
      <p class="settings-note">You are playing as <strong>${esc(state.name)}</strong>${session ? ` · player code #${esc(session.id.slice(0, 6))}` : ''}. ${view.connected ? 'Your progress is saved on the server.' : 'You are offline: what you see is the last saved copy.'}</p>
      <ul class="settings-list">
        <li>This is a <strong>device session</strong>, not an account: there is no password, no email and no sign-in.</li>
        <li>A cookie in this browser is the only key to this life. Clearing cookies, or not playing for 30 days, ends the session; the life is kept on the server but cannot be recovered from another device yet.</li>
        <li>Other players only ever see your name and player code — never the cookie.</li>
        <li>Change your name and look in the Profile tab.</li>
      </ul>
      <h3>Privacy</h3>
      <p class="settings-note">You can hide your home from the Neighbours directory and your balance from the Rich List. Blocked players are listed in People.</p>
      <span class="settings-actions"><button class="ui-button" data-open="neighbours">Neighbours directory</button><button class="ui-button" data-open="richlist">Rich List</button><button class="ui-button" data-open="people">People &amp; blocks</button></span>
      <h3>Accounts</h3>
      <p class="settings-note">Accounts (sign up, log in, recovery email, moving a life to another device) are not part of this build. Notifications outside the game are not available either: news arrives in Phone → Messages → Updates.</p>`;
  },
  bind(root, api) {
    for (const input of root.querySelectorAll('[data-setting]')) {
      input.addEventListener('change', () => {
        save({ ...settings(), [input.dataset.setting]: input.checked });
        api.refresh();
      });
    }
  },
};
