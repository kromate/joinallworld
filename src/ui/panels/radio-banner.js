/**
 * OWNER: civic
 * Club radio banner: the HUD chip shown while you stand in a club, and the helpers the Radio app
 * (./radio.js, fetched with the civic panel group) shares with it. First download.
 * The banner follows the server's schedule whenever the HUD is redrawn (each state poll); it runs
 * no timer of its own, so a new shout-out can take up to a poll interval to appear.
 */
import { esc, mark } from '../dom.js';
import { RADIO } from '../../game/content/civic.ts';
import { entry, load } from './civic-ui.js';

export const PANEL = 'radio';
export const inClub = (state) => RADIO.venues.includes(state.location) && state.activeAction?.kind !== 'travel';
export const key = (view, venue) => `radio:${view.cityId}:${venue}`;
export const path = (view, venue) => `/api/civic/radio?city=${view.cityId}&venue=${venue}`;
/** What is on air at `now`, from the cached schedule. */
export function schedule(data, now) {
  const all = [...(data?.playing ? [data.playing] : []), ...(data?.queue ?? [])].filter((item) => item.endsAt > now);
  const playing = all.find((item) => item.startsAt <= now) ?? null;
  return { playing, queue: all.filter((item) => item !== playing) };
}
export const song = (item) => `${item.title} — ${item.artist}`;

const banner = {
  id: 'radio-banner', title: 'Club radio', icon: 'radio', placement: 'hud', order: 30,
  render(state, view) {
    if (!inClub(state)) return '';
    const { playing } = schedule(entry(key(view, state.location)).data, view.now);
    return `<button class="life-job civic-chip ${playing ? 'is-active' : ''}" data-open="${PANEL}" data-tick="${Math.floor(view.now / 12000)}" data-live="${view.connected ? 1 : 0}" aria-label="Club radio"><span aria-hidden="true">${mark('radio')}</span><div><strong>${playing ? `THE DJ — shout-out from @${esc(playing.by.name)}` : esc(RADIO.label)}</strong><small>${playing ? esc(song(playing)) : esc(RADIO.cta)}</small></div></button>`;
  },
  bind(root, api) {
    const view = api.view(), state = api.state();
    if (inClub(state)) load(api, key(view, state.location), path(view, state.location), { maxAge: 12000 });
  },
};

export default [banner];
