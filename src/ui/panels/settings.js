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
import { esc, chevron, mark } from '../dom.js';
import { linkWords } from '../link.js';
import { WALLPAPERS, getWallpaper, setWallpaper } from '../phone/wallpapers.js';
import { how, rules as ruleList, bindHow } from '../phone/how.js';

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
  id: 'settings', title: 'Settings', placement: 'sim-tab', order: 70,
  render(state, view) {
    const current = settings();
    const session = view.session;
    const toggles = OPTIONS.map((option) => `<label class="ui-row settings-row"><span class="ui-row-body"><b>${esc(option.label)}</b><small>${esc(option.hint)}</small></span>
      <span class="settings-state">${current[option.id] ? 'On' : 'Off'}</span><input type="checkbox" role="switch" data-setting="${esc(option.id)}" ${current[option.id] ? 'checked' : ''} aria-label="${esc(option.label)}"><i class="ui-switch" aria-hidden="true"></i></label>`).join('');
    const wall = getWallpaper();
    const walls = WALLPAPERS.map((item) => `<button class="settings-wall wall-${esc(item.id)}" data-wallpaper="${esc(item.id)}" aria-pressed="${item.id === wall}" aria-label="${esc(item.label)} wallpaper"><span>${esc(item.label)}</span></button>`).join('');
    const link = (id, icon, title, text) => `<button class="ui-row" data-open="${id}"><span class="ui-row-icon" aria-hidden="true">${mark(icon)}</span><span class="ui-row-body"><b>${title}</b><small>${text}</small></span><span class="ui-row-end">${chevron()}</span></button>`;
    return `<h3 class="ui-section">Phone wallpaper</h3><div class="settings-walls" role="group" aria-label="Phone wallpaper">${walls}</div>
      <p class="settings-note">Saved on this device only. Open the Phone to see it.</p>
      <h3 class="ui-section">Sound</h3><div class="ui-rows">${toggles}</div>
      <p class="settings-note">No audio in this beta yet: your choice is saved on this device for when sound ships.</p>
      ${warning ? `<p class="ui-error" role="alert">${esc(warning)}</p>` : ''}
      <h3 class="ui-section">This device</h3>
      <div class="ui-rows"><div class="ui-row"><span class="ui-row-icon" aria-hidden="true">${mark('id')}</span><span class="ui-row-body"><b>${esc(state.name)}</b><small>${session ? `Player code #${esc(session.id.slice(0, 6))} · ` : ''}${view.connected ? 'progress saved on the server' : `${esc(linkWords(view).short)}: this is the last copy kept on this device`}</small></span></div></div>
      <p class="settings-note">A <strong>device session</strong>, not an account: a cookie in this browser is the only key. Clearing cookies, or 30 days without playing, ends it.</p>
      ${how('settings-session', ruleList(['This is a device session, not an account: there is no password, no email and no sign-in.', 'A cookie in this browser is the only key to this life. Clearing cookies, or not playing for 30 days, ends the session; the life is kept on the server but cannot be recovered from another device yet.', 'Other players only ever see your name and player code — never the cookie.', 'Change your name and look in your Sim’s Profile tab.']), 'How a device session works', true)}
      <h3 class="ui-section">Privacy</h3>
      <div class="ui-rows">${link('neighbours', 'neighbours', 'Neighbours directory', 'Hide or list your home')}${link('richlist', 'richlist', 'Rich List', 'Hide or show your balance')}${link('people', 'people', 'People and blocks', 'Blocked players are listed there')}<button class="ui-row" data-privacy-analytics><span class="ui-row-icon" aria-hidden="true">${mark('id')}</span><span class="ui-row-body"><b>Analytics and error reports</b><small>What we collect, and your choice</small></span><span class="ui-row-end">${chevron()}</span></button></div>
      <h3 class="ui-section">Accounts</h3>
      <p class="settings-note">Accounts (sign up, log in, recovery email, moving a life to another device) are not part of this build. Notifications outside the game are not available either: news arrives in Phone → Messages → Updates.</p>
      <div class="ui-rows">${link('support', 'support', 'Report a problem', 'File a report and get a receipt')}</div>`;
  },
  bind(root, api) {
    bindHow(root, api);
    // Opens the telemetry sheet (src/telemetry): what is collected and the Accept / Reject choice for this device.
    root.querySelector('[data-privacy-analytics]')?.addEventListener('click', () => window.dispatchEvent(new CustomEvent('jaw:privacy')));
    for (const button of root.querySelectorAll('[data-wallpaper]')) {
      button.addEventListener('click', () => {
        warning = setWallpaper(button.dataset.wallpaper) ? '' : 'This browser would not save the wallpaper, so it lasts only until you close the tab.';
        api.refresh();
        document.querySelector(`[data-wallpaper="${CSS.escape(button.dataset.wallpaper)}"]`)?.focus();
      });
    }
    for (const input of root.querySelectorAll('[data-setting]')) {
      input.addEventListener('change', () => {
        save({ ...settings(), [input.dataset.setting]: input.checked });
        api.refresh();
      });
    }
  },
};
