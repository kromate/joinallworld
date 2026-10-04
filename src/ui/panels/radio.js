/**
 * OWNER: civic
 * Club radio: the Radio app and the banner chip shown while you stand in a club.
 * A shout-out is a song title and an artist as plain text, bought with in-game naira. No audio
 * is played and no link is accepted or rendered. Data: GET /api/civic/radio.
 * The banner follows the server's schedule whenever the HUD is redrawn (each state poll); it runs
 * no timer of its own, so a new shout-out can take up to a poll interval to appear.
 */
import { esc, money } from '../dom.js';
import { RADIO } from '../../game/content/civic.js';
import { button, busy, entry, load, put, send, stale, status, until } from './civic-ui.js';
import { isDeparting } from '../../game/registry.js';

const PANEL = 'radio';
const draft = { title: '', artist: '', requestId: null };

const inClub = (state) => RADIO.venues.includes(state.location) && state.activeAction?.kind !== 'travel';
const key = (view, venue) => `radio:${view.cityId}:${venue}`;
const path = (view, venue) => `/api/civic/radio?city=${view.cityId}&venue=${venue}`;
/** What is on air at `now`, from the cached schedule. */
function schedule(data, now) {
  const all = [...(data?.playing ? [data.playing] : []), ...(data?.queue ?? [])].filter((item) => item.endsAt > now);
  const playing = all.find((item) => item.startsAt <= now) ?? null;
  return { playing, queue: all.filter((item) => item !== playing) };
}
const song = (item) => `${item.title} — ${item.artist}`;


const app = {
  id: PANEL, title: 'Radio', icon: '📻', placement: 'phone', order: 46, live: false, group: 'city',
  render(state, view) {
    const clubs = view.venues.filter((venue) => RADIO.venues.includes(venue.id));
    const beta = `<p class="civic-beta">Beta limitation: a shout-out is text only — a song title and an artist. No audio is played and links are not allowed. It costs ${money(RADIO.price)} of in-game naira, plays for ${esc(RADIO.slotSeconds)} seconds on the club banner, and each player gets ${esc(RADIO.perPlayerPerDay)} a day. These are original beta values.</p>`;
    if (!inClub(state)) {
      const here = view.venues.find((venue) => venue.id === state.location)?.label ?? 'here';
      const list = clubs.length ? clubs.map((venue) => button(`Go to ${venue.label}`, `data-radio-go="${esc(venue.id)}"`, { reason: !view.connected ? 'Not connected.' : state.activeAction ? 'Finish your current action first.' : '' })).join('') : '<p class="civic-note">No club is open in this city yet.</p>';
      return `<section class="radio-now is-off"><small>${esc(RADIO.label)}</small><strong>Off air here</strong><small>You are ${isDeparting(state) ? 'on the road' : `at ${esc(here)}`}. Club radio plays inside clubs: walk in to see what is on and buy a shout-out for your song.</small><span class="radio-bars" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span></section><div class="civic-actions is-stack">${list}</div>${beta}`;
    }
    const venue = view.venues.find((item) => item.id === state.location);
    const item = entry(key(view, state.location)), data = item.data;
    if (!data) return `${status(item, view)}${beta}`;
    const { playing, queue } = schedule(data, view.now);
    const why = !view.connected ? 'Not connected: you cannot buy a shout-out right now.'
      : data.usedToday >= data.perDay ? `You have used all ${data.perDay} shout-outs today. They reset at midnight, Lagos time.`
          : queue.length + (playing ? 1 : 0) >= data.queueMax ? 'The queue is full. Try again in a few minutes.'
            : state.cash < data.price ? `Costs ${money(data.price)}; you have ${money(state.cash)}.` : '';
    return `<section class="radio-now${playing ? ' is-on' : ''}"><small>${esc(RADIO.label)} · ${esc(venue?.label ?? '')}</small><strong>${playing ? esc(song(playing)) : 'Nothing is playing'}</strong><small>${playing ? `Shout-out from @${esc(playing.by.name)} · about ${esc(until(playing.endsAt, view.now))} left` : 'Be the first: play your song here.'}</small><span class="radio-bars" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span></section>${stale(item)}
      <h3 class="ui-section">Up next<small>${esc(queue.length)} in the queue</small></h3>${queue.length ? `<ol class="ui-rows">${queue.map((entryItem, index) => `<li class="ui-row${entryItem.mine ? ' is-you' : ''}"><span class="ui-row-icon is-round" aria-hidden="true">${index + 1}</span><span class="ui-row-body"><b>${esc(song(entryItem))}</b><small>@${esc(entryItem.by.name)}${entryItem.mine ? ' (you)' : ''} · in about ${esc(until(entryItem.startsAt, view.now))}</small></span></li>`).join('')}</ol>` : '<p class="civic-note">The queue is empty.</p>'}
      <h3 class="ui-section">${esc(RADIO.cta)}</h3>
      <div class="civic-form is-card"><label>Song title<input data-radio-title maxlength="${RADIO.titleMax}" value="${esc(draft.title)}" autocomplete="off"></label><label>Artist<input data-radio-artist maxlength="${RADIO.artistMax}" value="${esc(draft.artist)}" autocomplete="off"></label></div>
      <div class="civic-actions">${button(`Buy shout-out · ${money(data.price)}`, 'data-radio-buy', { primary: true, working: busy('shoutout'), reason: why })}${button('Refresh', 'data-civic-retry', { working: item.loading })}</div>
      <p class="civic-note">Balance ${money(state.cash)} · ${esc(data.usedToday)} of ${esc(data.perDay)} shout-outs used today.</p>${beta}`;
  },
  bind(root, api) {
    const view = api.view(), state = api.state(), again = () => api.open(PANEL);
    if (inClub(state)) load(api, key(view, state.location), path(view, state.location), { maxAge: 12000, panel: PANEL });
    root.querySelector('[data-civic-retry]')?.addEventListener('click', () => load(api, key(api.view(), api.state().location), path(api.view(), api.state().location), { force: true, panel: PANEL }));
    for (const field of ['title', 'artist']) {
      const input = root.querySelector(`[data-radio-${field}]`);
      input?.addEventListener('input', () => { draft[field] = input.value; draft.requestId = null; });
    }
    for (const node of root.querySelectorAll('[data-radio-go]')) node.addEventListener('click', () => { api.close(); api.goTo(node.dataset.radioGo); });
    root.querySelector('[data-radio-buy]')?.addEventListener('click', async () => {
      if (!draft.title.trim() || !draft.artist.trim()) { api.toast('Enter a song title and an artist first. Nothing was charged.', 'error'); root.querySelector(draft.title.trim() ? '[data-radio-artist]' : '[data-radio-title]')?.focus(); return; }
      // The same request id is reused if this attempt has to be retried, so it cannot be charged twice.
      draft.requestId ||= api.newId(); // one id per shout-out, kept for a retry
      const result = await send(api, 'shoutout', '/api/civic/radio/shoutout', { title: draft.title, artist: draft.artist, requestId: draft.requestId }, { panel: PANEL, success: 'Your shout-out is in the queue.' });
      if (result.radio) put(key(api.view(), result.radio.venue), result.radio);
      if (result.ok) { draft.title = ''; draft.artist = ''; draft.requestId = null; }
      if (result.radio && document.querySelector(`dialog [data-panel="${PANEL}"]`)?.closest('dialog')?.open) again();
      if (result.radio) api.refresh(); // the club banner behind the sheet shows the same queue
    });
  },
};

const banner = {
  id: 'radio-banner', title: 'Club radio', icon: '📻', placement: 'hud', order: 30,
  render(state, view) {
    if (!inClub(state)) return '';
    const { playing } = schedule(entry(key(view, state.location)).data, view.now);
    return `<button class="life-job civic-chip ${playing ? 'is-active' : ''}" data-open="${PANEL}" data-tick="${Math.floor(view.now / 12000)}" data-live="${view.connected ? 1 : 0}" aria-label="Club radio"><span aria-hidden="true">📻</span><div><strong>${playing ? `THE DJ — shout-out from @${esc(playing.by.name)}` : esc(RADIO.label)}</strong><small>${playing ? esc(song(playing)) : esc(RADIO.cta)}</small></div></button>`;
  },
  bind(root, api) {
    const view = api.view(), state = api.state();
    if (inClub(state)) load(api, key(view, state.location), path(view, state.location), { maxAge: 12000 });
  },
};

export default [app, banner];
