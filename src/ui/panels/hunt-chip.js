/**
 * OWNER: civic
 * Daily gem hunt: the chip in the HUD stack. First download; the sheet it opens is ./hunt.js
 * (fetched with the civic panel group).
 *
 * The chip follows the label observed in the reference game ("Daily gem hunt · N found · next
 * prize ₦3,000"). N is the server's own count of gems found in this city; until it has loaded,
 * no number is shown. The chip also carries the real presence counter and is where civic
 * notices (a new Governor, an announcement) surface as toasts. How the hunt works is original.
 */
import { esc, money, mark } from '../dom.js';
import { count, entry, load, put } from './civic-ui.js';

const SEEN_KEY = 'joinallworld-civic-seen';
let lastFound = null;

function unseen(notices) {
  let seen = null;
  try { seen = JSON.parse(window.localStorage.getItem(SEEN_KEY)); } catch {}
  const known = new Set(Array.isArray(seen) ? seen : []);
  const fresh = notices.filter((item) => !known.has(item.id));
  try { window.localStorage.setItem(SEEN_KEY, JSON.stringify(notices.map((item) => item.id).slice(0, 40))); } catch {}
  // First visit on this browser: do not replay a week of old news.
  return Array.isArray(seen) ? fresh : [];
}

const chip = {
  id: 'hunt', title: 'Daily hunt', icon: 'hunt', placement: 'hud', order: 20,
  render(state, view) {
    const hunt = view.civic?.hunt;
    if (!hunt) return '';
    const pulse = entry(`pulse:${view.cityId}`).data;
    const found = pulse ? `${count(pulse.hunt.found)} found · ` : '';
    const prize = hunt.claimed ? 'prize claimed today' : `next prize ${money(hunt.prize)}`;
    const people = pulse ? ` · ${count(pulse.counters.online)} online` : '';
    return `<button class="life-job civic-chip ${hunt.canClaim ? 'is-active' : ''}" data-open="hunt-sheet" data-balance="${esc(state.cash)}" data-tick="${Math.floor(view.now / 60000)}" data-live="${view.connected ? 1 : 0}" aria-label="Daily gem hunt, ${esc(hunt.found)} of ${esc(hunt.total)} found today"><span aria-hidden="true">${mark('hunt')}</span><div><strong>${hunt.canClaim ? 'Claim your gem prize' : 'Daily gem hunt'}</strong><small>${esc(found)}${esc(prize)}</small><small>You: ${esc(hunt.found)}/${esc(hunt.total)} today${esc(people)}</small></div></button>`;
  },
  bind(root, api) {
    const view = api.view(), hunt = view.civic?.hunt;
    if (hunt) {
      const key = `${view.cityId}:${hunt.day}`;
      if (lastFound?.key === key && hunt.found > lastFound.found) api.toast(hunt.found === hunt.total ? `Gem found — that is all ${hunt.total}. Claim your prize from the gem hunt chip.` : `Gem found: ${hunt.found} of ${hunt.total} today.`, 'good');
      lastFound = { key, found: hunt.found };
    }
    // The chip is rebuilt when the hunt or the balance changes, and at most once a minute as the
    // shell redraws; each rebuild is the check-in that keeps the city counters, the directory
    // and the rich list current. No timer runs here.
    load(api, `pulse:${view.cityId}`, `/api/civic/pulse?city=${view.cityId}`, { maxAge: 60000,
      after(item) {
        if (item.data?.radio) put(`radio:${view.cityId}:${item.data.radio.venue}`, item.data.radio);
        if (item.data && !item.error) for (const notice of unseen(item.data.notices).slice(0, 2).reverse()) api.toast(`${notice.title}${notice.kind === 'announcement' ? `: ${notice.text}` : ''}`);
      } });
  },
};

export default [chip];
