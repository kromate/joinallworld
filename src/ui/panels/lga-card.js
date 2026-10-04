/**
 * OWNER: world
 * THE LOCAL-GOVERNMENT CARD — a self-contained piece of UI, not a panel. It can be mounted
 * anywhere a life chooses or changes where it lives: the "settle in" sequence (at "where you
 * live") and Profile both use it, and neither knows how it works.
 *
 *   renderLgaCard(state, view, { heading?, compact? }) → html
 *   bindLgaCard(root, api, { onChosen?(lgaId), redraw? })   wire it up after each render of the host;
 *                                                       `redraw` re-renders the host (default api.refresh();
 *                                                       a `live: false` sheet passes () => api.open(its id))
 *   track(name, props)                                  the decoupled analytics event ('jaw:track')
 *
 * THE ACTION is the ordinary game action 'estate.set-lga' { lga, via } (src/game/systems/estate.js):
 * validated on the server, applied once per action id, and the free house on a plot is allocated
 * by the server as soon as it is saved (server/world/service.js).
 *
 * LOCATION PRIVACY. "Find my local government" asks the browser for a position, works out the
 * local government ON THIS DEVICE from the boxes bundled in the city pack (src/map3d/lga.js
 * resolveLga) and keeps only the resulting id. The position is a local variable of one function:
 * it is never stored, never logged, never put in an event and never sent — the action carries
 * `{ lga, via: 'device' }` and nothing else. The player always confirms the answer before it is sent.
 */
import './world.css';
import { esc, money } from '../dom.js';
import { linkWords } from '../link.js';
import { loadCityPack, hasCityPack } from '../../map3d/regions.js';
import { resolveLga } from '../../map3d/lga.js';

/** Analytics, decoupled: whoever listens to 'jaw:track' records it. Never a name, never a coordinate. */
export function track(name, props = {}) {
  try { window.dispatchEvent(new CustomEvent('jaw:track', { detail: { name, props } })); } catch { /* no window: nothing to tell */ }
}

// What the card is showing between renders: { finding, found: { id, name, sure } | null, note, picking, sending }.
const ui = { finding: false, found: null, note: '', picking: false, sending: false };
const WHY = {
  1: 'Location is switched off for this site. Pick your local government from the list instead.',
  2: 'This device could not work out where it is. Pick your local government from the list instead.',
  3: 'Finding you took too long. Pick your local government from the list instead.',
};

export function renderLgaCard(state, view, { heading = 'Where you live', compact = false } = {}) {
  const e = view.estate;
  if (!e || !e.lgas?.length) return '';
  const offline = view.connected ? '' : `${linkWords(view).short} — this needs the server`;
  const current = e.placed && e.lga ? e.lga : null, guess = !e.placed && !e.lgaConfirmed && e.lga ? e.lga : null;
  const blocked = current && e.change.blocked ? e.change.blocked : '';
  const list = ui.picking || (!current && !ui.found) ? `<label class="world-field">Choose from the ${e.lgas.length} local governments of ${esc(e.cityName)}
      <select data-lga-pick ${offline || blocked ? 'disabled' : ''}><option value="">Choose…</option>${e.lgas.map((item) => `<option value="${esc(item.id)}" ${item.id === (ui.found?.id ?? guess?.id) ? 'selected' : ''}>${esc(item.name)}${current && item.levy ? ` · ${money(item.levy)} to move your house` : ''}</option>`).join('')}</select></label>
      <button type="button" class="ui-button is-primary is-block" data-lga-send="manual" ${offline || blocked || ui.sending ? 'disabled' : ''}>${ui.sending ? 'Saving…' : current ? 'Move here' : 'This is my local government'}</button>` : '';
  const found = ui.found ? `<div class="world-found" role="status"><p>${ui.found.sure ? 'You are in' : 'Nearest to you is'} <b>${esc(ui.found.name)}</b>. Is that right?</p>
      <div class="world-row"><button type="button" class="ui-button is-primary" data-lga-send="device" ${offline || blocked || ui.sending ? 'disabled' : ''}>${ui.sending ? 'Saving…' : `Yes, ${esc(ui.found.name)}`}</button><button type="button" class="ui-button" data-lga-list>No, let me pick</button></div></div>` : '';
  const head = current
    ? `<p class="world-now"><b>${esc(current.name)}</b><small>${esc(current.line)}</small></p>${e.plot ? `<p class="ui-note">Your house: ${esc(e.plot.address)}</p>` : '<p class="ui-note">Your plot is being set aside…</p>'}`
    : `<p class="ui-note">Pick your local government and a starter house on your own plot there is yours, free. ${guess ? `Your home is in ${esc(guess.name)}.` : ''}</p>`;
  const actions = current && !ui.picking && !ui.found
    ? `<div class="world-row"><button type="button" class="ui-button" data-lga-list ${blocked ? 'disabled' : ''}>Change</button><button type="button" class="ui-button" data-lga-find ${blocked || ui.finding ? 'disabled' : ''}>${ui.finding ? 'Finding…' : 'Find my local government'}</button></div>${blocked ? `<p class="ui-why">${esc(blocked)}</p>` : `<p class="ui-note">You can change once every ${e.change.cooldownDays} days. Your house moves with you.</p>`}`
    : !ui.found ? `<button type="button" class="ui-button is-block" data-lga-find ${ui.finding ? 'disabled' : ''}>${ui.finding ? 'Finding…' : 'Find my local government'}</button><p class="ui-note">Worked out on this device. Your position is never sent or stored — only the local government you confirm.</p>` : '';
  return `<section class="world-card${compact ? ' is-compact' : ''}" data-lga-card><h3>${esc(heading)}</h3>${head}${found}${actions}${list}${ui.note ? `<p class="ui-why" role="status">${esc(ui.note)}</p>` : ''}${offline ? `<p class="ui-why">${esc(offline)}</p>` : ''}</section>`;
}

export function bindLgaCard(root, api, { onChosen = () => {}, redraw = () => api.refresh() } = {}) {
  const card = root.querySelector('[data-lga-card]');
  if (!card) return;
  card.addEventListener('click', async (event) => {
    const target = event.target.closest('[data-lga-find],[data-lga-list],[data-lga-send]');
    if (!target || target.disabled) return;
    if (target.hasAttribute('data-lga-list')) { ui.picking = true; ui.found = null; ui.note = ''; redraw(); return; }
    if (target.hasAttribute('data-lga-find')) { await find(api, redraw); redraw(); return; }
    const via = target.dataset.lgaSend;
    const lga = via === 'device' ? ui.found?.id : card.querySelector('[data-lga-pick]')?.value;
    if (!lga) { ui.note = 'Choose a local government first.'; redraw(); return; }
    ui.sending = true; ui.note = ''; redraw();
    const result = await api.command('estate.set-lga', { lga, via });
    ui.sending = false;
    if (result?.ok) {
      Object.assign(ui, { found: null, picking: false, note: '' });
      track('lga_chosen', { method: via === 'device' ? 'device' : 'manual' });
      // The server allocates the house now; the maps are told what they cached is stale.
      window.dispatchEvent(new CustomEvent('jaw:world-changed'));
      onChosen(lga);
    } else ui.note = result?.reason || 'That could not be saved. Try again.';
    redraw();
  });
}

/** Ask the browser where the device is and turn the answer into a local government — here, and nowhere else. */
async function find(api, redraw) {
  const cityId = api.view().estate?.city ?? api.view().cityId;
  ui.note = ''; ui.found = null;
  if (!globalThis.navigator?.geolocation || !hasCityPack(cityId)) { ui.note = 'This device cannot share a location. Pick your local government from the list instead.'; ui.picking = true; return; }
  ui.finding = true; redraw();
  try {
    const pack = await loadCityPack(cityId);
    const found = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(
      // The position exists only inside this callback: it is reduced to an id and dropped.
      (position) => resolve(resolveLga(pack, position.coords.latitude, position.coords.longitude)),
      (error) => reject(error), { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 }));
    if (found) ui.found = found;
    else { ui.note = `You do not seem to be in ${pack.name} right now. Pick the local government you call home.`; ui.picking = true; }
  } catch (error) { ui.note = WHY[error?.code] || WHY[2]; ui.picking = true; } finally { ui.finding = false; }
}
