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
 *   lgaHomeExtra                                        the same choice as a section of the settle-in Home card
 *                                                       (src/ui/panels/onboarding.js HOME_EXTRAS): there nothing is sent
 *                                                       by the card — the choice rides in the 'onboarding.home' payload
 *                                                       ({ lga, via }), so settling in and taking a house are one step
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
import { mark, esc, money } from '../dom.ts';
import { linkWords } from '../link.ts';
import { loadCityPack, hasCityPack } from '../../map3d/regions.ts';
import { resolveLga } from '../../map3d/lga.ts';

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
  const list = ui.picking || (!current && !ui.found) ? `<label class="ui-labelled"><span>Choose from the ${e.lgas.length} local governments of ${esc(e.cityName)}</span>
      <select data-lga-pick aria-label="Local government" ${offline || blocked ? 'disabled' : ''}><option value="">Choose…</option>${e.lgas.map((item) => `<option value="${esc(item.id)}" ${item.id === (ui.found?.id ?? guess?.id) ? 'selected' : ''}>${esc(item.name)}${current && item.levy ? ` · ${money(item.levy)} to move your house` : ''}</option>`).join('')}</select></label>
      <button type="button" class="ui-button is-primary is-block${ui.sending ? ' is-loading' : ''}" data-lga-send="manual" ${offline || blocked || ui.sending ? 'disabled' : ''}>${ui.sending ? 'Saving…' : current ? 'Move here' : 'This is my local government'}</button>` : '';
  const found = ui.found ? `<div class="world-found" role="status"><p>${ui.found.sure ? 'You are in' : 'Nearest to you is'} <b>${esc(ui.found.name)}</b>. Is that right?</p>
      <div class="ui-actions"><button type="button" class="ui-button is-primary" data-lga-send="device" ${offline || blocked || ui.sending ? 'disabled' : ''}>${ui.sending ? 'Saving…' : `Yes, ${esc(ui.found.name)}`}</button><button type="button" class="ui-button" data-lga-list>No, let me pick</button></div></div>` : '';
  const head = current
    ? `<p class="world-now"><b>${esc(current.name)}</b><small>${esc(current.line)}</small></p>${e.plot ? `<p class="ui-note">Your house: ${esc(e.plot.address)}</p>` : '<p class="ui-note">Your plot is being set aside…</p>'}`
    : `<p class="ui-note">Pick your local government and a starter house on your own plot there is yours, free. ${guess ? `Your home is in ${esc(guess.name)}.` : ''}</p>`;
  const actions = current && !ui.picking && !ui.found
    ? `<div class="ui-actions"><button type="button" class="ui-button" data-lga-list ${blocked ? 'disabled' : ''}>Change</button><button type="button" class="ui-button is-quiet" data-lga-find ${blocked || ui.finding ? 'disabled' : ''}>${ui.finding ? 'Finding…' : 'Find my local government'}</button></div>${blocked ? `<p class="ui-why">${esc(blocked)}</p>` : `<p class="ui-note">You can change once every ${e.change.cooldownDays} days. Your house moves with you.</p>`}`
    : !ui.found ? `<div class="ui-cluster is-between"><button type="button" class="ui-button is-quiet" data-lga-find ${ui.finding ? 'disabled' : ''}>${mark('compass')}<span>${ui.finding ? 'Finding…' : 'Find it for me'}</span></button></div><p class="ui-help">Worked out on this device. Your position is never sent or stored — only the local government you confirm.</p>` : '';
  // One primary per view: the list and "This is my local government" lead; finding it by device is the quiet way underneath.
  return `<section class="ui-panel" data-lga-card><h3>${esc(heading)}</h3>${head}${found}${current ? `${actions}${list}` : `${list}${actions}`}${ui.note ? `<p class="ui-why" role="status">${esc(ui.note)}</p>` : ''}${offline ? `<p class="ui-why">${esc(offline)}</p>` : ''}</section>`;
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
      track('lga_chosen', { method: via === 'device' ? 'device' : 'manual', lga });
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

/**
 * THE SAME CHOICE AT SETTLE-IN, as a section of the "Make this life yours" Home card (see HOME_EXTRAS in ./onboarding.js).
 * The player finds their local government on the device or picks it from the list; the choice is kept in the sheet's draft
 * (draft.extra.area = { lga, via }) and sent with the move-in — never before, so a guest who closes the sheet has taken nothing.
 * The privacy rule is the one above: a position never leaves find().
 */
export const lgaHomeExtra = {
  id: 'area',
  render(state, view, draft) {
    const e = view.estate;
    if (!e?.lgas?.length) return '';
    const picked = e.lgas.find((item) => item.id === draft.extra.area?.lga) ?? null;
    const found = ui.found && !picked ? `<div class="world-found" role="status"><p>${ui.found.sure ? 'You are in' : 'Nearest to you is'} <b>${esc(ui.found.name)}</b>. Is that right?</p>
      <div class="world-row"><button type="button" class="ui-button is-primary" data-extra="yes" data-key="area:yes">Yes, ${esc(ui.found.name)}</button><button type="button" class="ui-button" data-extra="no" data-key="area:no">No, let me pick</button></div></div>` : '';
    const chosen = picked ? `<p class="world-now" role="status"><b>${esc(picked.name)}</b><small>${esc(picked.line)}</small></p>` : '';
    return `<section class="world-card is-compact" data-lga-card><h3>Your local government</h3>
      <p class="ui-note">Your house stands on a plot in the local government you choose. You can move to another one later (once every ${e.change.cooldownDays} days).</p>
      ${chosen}${found}
      <button type="button" class="ui-button is-block" data-extra="find" data-key="area:find" ${ui.finding ? 'disabled' : ''}>${ui.finding ? 'Finding…' : 'Find my local government'}</button>
      <p class="ui-note">Worked out on this device. Your position is never sent or stored — only the local government you confirm.</p>
      <label class="world-field">Or choose from the ${e.lgas.length} local governments of ${esc(e.cityName)}
        <select data-lga-pick data-key="area:pick"><option value="">Choose…</option>${e.lgas.map((item) => `<option value="${esc(item.id)}" ${item.id === picked?.id ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}</select></label>
      ${ui.note ? `<p class="ui-why" role="status">${esc(ui.note)}</p>` : ''}</section>`;
  },
  /** A tap inside the section. Finding is asynchronous: the sheet is redrawn again when the answer is in. */
  click(target, draft, { api, redraw } = {}) {
    const what = target.dataset.extra;
    if (what === 'yes' && ui.found) { draft.extra.area = { lga: ui.found.id, via: 'device' }; Object.assign(ui, { found: null, note: '' }); return true; }
    if (what === 'no') { Object.assign(ui, { found: null, note: '' }); return true; }
    if (what === 'find' && api) { delete draft.extra.area; void find(api, redraw).then(redraw); return true; }
    return false;
  },
  /** The list is a <select>: its change is the manual choice. */
  bind(root, api, draft, redraw) {
    root.querySelector('[data-extra-root="area"] [data-lga-pick]')?.addEventListener('change', (event) => {
      const lga = event.target.value;
      if (lga) draft.extra.area = { lga, via: 'manual' }; else delete draft.extra.area;
      Object.assign(ui, { found: null, note: '' });
      redraw();
    });
  },
  ready: (draft) => (draft.extra.area?.lga ? null : 'Choose your local government to continue.'),
  payload: (draft) => (draft.extra.area?.lga ? { lga: draft.extra.area.lga, via: draft.extra.area.via === 'device' ? 'device' : 'manual' } : {}),
  /** Told when the move-in was accepted: the analytics event, and the maps are told what they cached is stale. */
  done(draft) {
    track('lga_chosen', { method: draft.extra.area?.via === 'device' ? 'device' : 'manual', lga: draft.extra.area?.lga });
    try { window.dispatchEvent(new CustomEvent('jaw:world-changed')); } catch { /* no window */ }
  },
};
