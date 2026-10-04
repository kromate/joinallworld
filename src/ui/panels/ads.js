/**
 * OWNER: civic
 * Billboards and Sea plots: rent a slot for in-game naira and put a short text line, a colour
 * and an icon on it. No uploaded pictures and no links in this wave — the panel says so.
 * Data: GET /api/civic/ads (one request for every ad). A form, so `live: false`.
 */
import { esc, money, json } from '../dom.js';
import { AD_COLOURS, AD_ICONS, AD_TEXT, BILLBOARDS, SEA_PLOTS } from '../../game/content/civic.js';
import { button, busy, dateTime, entry, load, put, send, stale, status, requestId, requestDone } from './civic-ui.js';

const PANEL = 'ads';
let tab = 'billboard';
const draft = { text: '', colour: AD_COLOURS[0].id, icon: AD_ICONS[0].id };
let plot = { row: 4, col: 4 };
const rentRequest = { what: null, id: null }; // the id of the rent being asked for, kept for a retry
let seenParams = null;

const key = (view) => `ads:${view.cityId}`;
const path = (view) => `/api/civic/ads?city=${view.cityId}`;
const colourOf = (id) => AD_COLOURS.find((item) => item.id === id) ?? AD_COLOURS[0];
const iconOf = (id) => AD_ICONS.find((item) => item.id === id)?.icon ?? '⭐';
const board = (ad) => `<div class="ads-preview" style="background:${esc(colourOf(ad.colour).bg)};color:${esc(colourOf(ad.colour).ink)}"><span aria-hidden="true">${esc(iconOf(ad.icon))}</span><span>${esc(ad.text)}</span></div>`;

/** Why the Rent button is off, or ''. The server checks all of this again. */
function rentWhy(state, view, price, owned, limit, noun) {
  if (!view.connected) return 'Not connected: you cannot rent right now.';
  if (owned >= limit) return `You already rent ${limit} ${noun}, the most allowed at once.`;
  if (state.cash < price) return `Costs ${money(price)}; you have ${money(state.cash)}.`;
  return '';
}

function form() {
  return `<div class="civic-form is-card"><label>Ad text (${AD_TEXT.min}–${AD_TEXT.max} characters, no links)<input data-ads-text maxlength="${AD_TEXT.max}" value="${esc(draft.text)}" autocomplete="off" placeholder="Mama Put — best jollof on the island"></label>
    <div><span class="civic-note">Colour</span><div class="ads-swatches" role="group" aria-label="Ad colour">${AD_COLOURS.map((item) => `<button data-ads-colour="${esc(item.id)}" aria-pressed="${item.id === draft.colour}" aria-label="${esc(item.label)}" title="${esc(item.label)}" style="background:${esc(item.bg)}"></button>`).join('')}</div></div>
    <div><span class="civic-note">Icon</span><div class="ads-swatches" role="group" aria-label="Ad icon">${AD_ICONS.map((item) => `<button data-ads-icon="${esc(item.id)}" aria-pressed="${item.id === draft.icon}" aria-label="${esc(item.id)}">${esc(item.icon)}</button>`).join('')}</div></div>
    <div data-ads-preview><span class="civic-note">Preview</span>${board({ ...draft, text: draft.text.trim() || 'Your ad text' })}</div></div>`;
}

function billboards(state, view, data) {
  const owned = data.billboards.slots.filter((slot) => slot.ad?.mine).length;
  const rows = data.billboards.slots.map((slot) => {
    const place = view.venues.find((venue) => venue.id === slot.near);
    const where = view.cityId === 'lagos' ? slot.road : `Roadside ${slot.slot.slice(3)}`;
    const head = `<strong>${esc(where)}</strong><small>${place ? `Near ${esc(place.label)}` : 'Roadside'}</small>`;
    if (!slot.ad) return `<li class="ads-slot"><span>${head}</span>${button(`Rent · ${money(slot.price)}`, `data-ads-rent="${json({ kind: 'billboard', slot: slot.slot })}"`, { primary: true, working: busy(`rent:${slot.slot}`), reason: rentWhy(state, view, slot.price, owned, data.billboards.maxPerPlayer, 'billboards') })}</li>`;
    const until = `until ${esc(dateTime(slot.ad.expiresAt))}`;
    return `<li class="ads-slot is-taken"><span>${head}${board(slot.ad)}<small>${slot.ad.mine ? `Yours ${until}` : `Rented by ${esc(slot.ad.by.name)} ${until}`}</small></span>${slot.ad.mine ? button('Take down', `data-ads-remove="${json({ kind: 'billboard', slot: slot.slot })}"`, { working: busy(`remove:${slot.slot}`), reason: view.connected ? '' : 'Not connected.' }) : ''}</li>`;
  }).join('');
  return `<p class="civic-note">A billboard costs ${money(data.billboards.price)} for ${esc(data.billboards.days)} days. You can hold ${esc(data.billboards.maxPerPlayer)} at a time; taking one down early is not refunded.</p><ul class="civic-list is-card">${rows}</ul>`;
}

function sea(state, view, data) {
  const taken = new Map(data.sea.plots.map((item) => [item.slot, item]));
  const owned = data.sea.plots.filter((item) => item.mine).length;
  const cells = [];
  for (let row = 0; row < data.sea.rows; row++) for (let col = 0; col < data.sea.cols; col++) {
    const ad = taken.get(`sea-${row}-${col}`), picked = plot.row === row && plot.col === col;
    cells.push(`<button data-ads-plot="${row}-${col}" class="${row < data.sea.shoreRows ? 'is-shore' : ''}" aria-pressed="${picked}" aria-label="Plot row ${row + 1}, column ${col + 1}${ad ? `, rented by ${esc(ad.by.name)}` : ', free'}" ${ad ? `style="background:${esc(colourOf(ad.colour).bg)}"` : ''}>${ad ? esc(iconOf(ad.icon)) : ''}</button>`);
  }
  const slot = `sea-${plot.row}-${plot.col}`, ad = taken.get(slot);
  const price = plot.row < data.sea.shoreRows ? data.sea.shorePrice : data.sea.price;
  const options = (size, value) => Array.from({ length: size }, (_, i) => `<option value="${i}" ${i === value ? 'selected' : ''}>${i + 1}</option>`).join('');
  const chosen = ad
    ? `${board(ad)}<p class="civic-note">${ad.mine ? 'Yours' : `Rented by ${esc(ad.by.name)}`} until ${esc(dateTime(ad.expiresAt))}.</p>${ad.mine ? button('Take down', `data-ads-remove="${json({ kind: 'sea', slot })}"`, { working: busy(`remove:${slot}`), reason: view.connected ? '' : 'Not connected.' }) : button(`Rent · ${money(price)}`, 'data-ads-none', { reason: 'This plot is taken. Pick a free one.' })}`
    : button(`Rent this plot · ${money(price)}`, `data-ads-rent="${json({ kind: 'sea', slot })}"`, { primary: true, working: busy(`rent:${slot}`), reason: rentWhy(state, view, price, owned, data.sea.maxPerPlayer, 'sea plots') });
  return `<p class="civic-note">Rent a patch of sea from ${money(data.sea.price)} a plot: your ad floats there for ${esc(data.sea.days)} days. The ${esc(data.sea.shoreRows)} rows nearest the shore cost ${money(data.sea.shorePrice)}. ${esc(data.sea.plots.length)} of ${esc(data.sea.rows * data.sea.cols)} plots are rented; you hold ${esc(owned)} of ${esc(data.sea.maxPerPlayer)}.</p>
    <div class="ads-sea" role="group" aria-label="Sea plots">${cells.join('')}</div>
    <div class="civic-form ads-pick"><label>Row<select data-ads-row>${options(SEA_PLOTS.rows, plot.row)}</select></label><label>Column<select data-ads-col>${options(SEA_PLOTS.cols, plot.col)}</select></label></div>
    <h3 class="ui-section">Plot ${plot.row + 1}·${plot.col + 1}</h3><div class="civic-actions is-stack">${chosen}</div>`;
}

export default {
  id: PANEL, title: 'Billboards', icon: '📢', placement: 'phone', order: 44, live: false,
  render(state, view) {
    // Opened from the map with { tab: 'billboard' | 'sea' }.
    if (view.params && view.params !== seenParams) { seenParams = view.params; if (view.params.tab === 'sea' || view.params.tab === 'billboard') tab = view.params.tab; }
    const item = entry(key(view)), data = item.data;
    const tabs = `<div class="ui-seg" role="group" aria-label="Ad type"><button data-ads-tab="billboard" aria-pressed="${tab === 'billboard'}">Billboards</button><button data-ads-tab="sea" aria-pressed="${tab === 'sea'}">Sea plots</button></div>`;
    const body = data ? `${stale(item)}${form()}${tab === 'sea' ? sea(state, view, data) : billboards(state, view, data)}<div class="civic-actions">${button('Refresh', 'data-civic-retry', { working: item.loading })}</div>` : status(item, view);
    return `${tabs}<p class="civic-note">Balance <b>${money(state.cash)}</b></p>${body}
      <p class="civic-beta">Beta limitation: an ad is one line of text, a colour and an icon. Picture uploads and links are switched off until moderation exists, and ad text is never clickable. Rent is paid in in-game naira only. Ads are drawn on the city map behind its Billboards and Sea layers; they are never links. Billboard pricing and the sea grid are original beta values (${esc(BILLBOARDS.slots.length)} billboard slots).</p>`;
  },
  bind(root, api) {
    const view = api.view(), again = () => api.open(PANEL);
    load(api, key(view), path(view), { maxAge: 30000, panel: PANEL });
    root.querySelector('[data-civic-retry]')?.addEventListener('click', () => load(api, key(api.view()), path(api.view()), { force: true, panel: PANEL }));
    // Typing updates the preview in place; the sheet is not re-rendered, so focus is kept.
    root.querySelector('[data-ads-text]')?.addEventListener('input', (event) => {
      draft.text = event.target.value;
      const preview = root.querySelector('[data-ads-preview] span:last-child');
      if (preview) preview.textContent = draft.text.trim() || 'Your ad text';
    });
    root.querySelector('[data-ads-row]')?.addEventListener('change', (event) => { plot = { ...plot, row: Number(event.target.value) }; again(); });
    root.querySelector('[data-ads-col]')?.addEventListener('change', (event) => { plot = { ...plot, col: Number(event.target.value) }; again(); });
    root.addEventListener('click', async (event) => {
      const hit = (name) => event.target.closest(`[data-ads-${name}]`);
      if (hit('tab')) { tab = hit('tab').dataset.adsTab; again(); }
      else if (hit('colour')) { draft.colour = hit('colour').dataset.adsColour; again(); }
      else if (hit('icon')) { draft.icon = hit('icon').dataset.adsIcon; again(); }
      else if (hit('plot')) { const [row, col] = hit('plot').dataset.adsPlot.split('-').map(Number); plot = { row, col }; again(); }
      else if (hit('rent') && !hit('rent').disabled) {
        const target = JSON.parse(hit('rent').dataset.adsRent);
        if ([...draft.text.trim()].length < AD_TEXT.min) { api.toast(`Write your ad text first (at least ${AD_TEXT.min} characters). Nothing was charged.`, 'error'); root.querySelector('[data-ads-text]')?.focus(); return; }
        const order = { ...target, text: draft.text, colour: draft.colour, icon: draft.icon };
        const result = await send(api, `rent:${target.slot}`, '/api/civic/ads/rent', { ...order, requestId: requestId(api, rentRequest, [api.view().cityId, order]) }, { panel: PANEL, success: 'Your ad is up.' });
        requestDone(rentRequest, result);
        if (result.ads) put(key(api.view()), result.ads);
        if (result.ok) draft.text = '';
        if (result.ads || result.ok) rerenderSoon(api);
      } else if (hit('remove') && !hit('remove').disabled) {
        const target = JSON.parse(hit('remove').dataset.adsRemove);
        const result = await send(api, `remove:${target.slot}`, '/api/civic/ads/remove', target, { panel: PANEL, success: 'Ad taken down. Rent is not refunded.' });
        if (result.ads) { put(key(api.view()), result.ads); rerenderSoon(api); }
      }
    });
  },
};

/** Redraw this sheet, and everything behind it: the city map draws the same cached listing. */
function rerenderSoon(api) { if (document.querySelector(`dialog [data-panel="${PANEL}"]`)?.closest('dialog')?.open) api.open(PANEL); api.refresh(); }
