/**
 * OWNER: home
 * Cars app: the dealer list, buying, choosing which owned car to drive, and selling back.
 * Actions: 'property.car-buy', 'property.car-use', 'property.car-sell'. An owned car adds a
 * "Drive" travel mode that costs fuel only (systems/property.js contributes it to the travel
 * system). Every disabled button says what is missing.
 */
import './cars.css';
import { how, rules as ruleList, bindHow } from '../phone/how.js';
import { esc, money, json } from '../dom.js';
import { linkWords } from '../link.js';
import { CAR_RESALE_RATE } from '../../game/content/cars.js';

/**
 * A drawn picture of a vehicle: a silhouette by kind (bike, saloon, SUV, coupé) in a colour of its
 * own, on a road. Original, procedural SVG — no photos.
 */
/** Which silhouette a car id is drawn as; anything not listed is a saloon. */
const SHAPES = { 'agama-150': 'bike', 'boardroom-330': 'coupe', 'marina-v6': 'suv', 'chief-suv': 'suv', 'harmattan-cruiser': 'suv', 'atlantic-x': 'suv', 'atlantic-grand': 'suv' };
const PAINT = ['#e2543b', '#3b82c4', '#1f2937', '#0f766e', '#b7791f', '#7c3aed', '#be123c', '#0e7490', '#111827'];
function carArt(car, index) {
  const paint = PAINT[index % PAINT.length];
  const kind = SHAPES[car.id] || 'saloon';
  const wheel = (x, r = 11) => `<circle cx="${x}" cy="74" r="${r}" fill="#15181d"/><circle cx="${x}" cy="74" r="${r * 0.45}" fill="#cfd5db"/>`;
  const body = kind === 'bike'
    ? `<path d="M118 74l22-26h30l14 26M140 48l-8-12h-12M170 48l16-10h14" fill="none" stroke="${paint}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/><rect x="138" y="40" width="34" height="9" rx="4.5" fill="#15181d"/>${wheel(118, 13)}${wheel(194, 13)}`
    : kind === 'suv'
      ? `<path d="M84 74V50a8 8 0 0 1 7-8l14-2 14-18a8 8 0 0 1 6-3h62a8 8 0 0 1 7 4l10 18 22 5a8 8 0 0 1 6 8v20Z" fill="${paint}"/><path d="M124 40l11-14h26v14Zm43-14h24l8 14h-32Z" fill="#dff1fb"/>${wheel(118, 13)}${wheel(204, 13)}`
      : kind === 'coupe'
        ? `<path d="M80 74V60a8 8 0 0 1 6-8l30-7 24-13a10 10 0 0 1 5-1h30a10 10 0 0 1 7 3l16 14 34 6a8 8 0 0 1 6 8v12Z" fill="${paint}"/><path d="M128 46l18-10h26l12 11Z" fill="#dff1fb"/>${wheel(116)}${wheel(208)}`
        : `<path d="M82 74V56a8 8 0 0 1 6-8l22-4 18-16a8 8 0 0 1 5-2h46a8 8 0 0 1 6 3l14 16 28 5a8 8 0 0 1 7 8v16Z" fill="${paint}"/><path d="M122 44l13-12h22v12Zm41-12h18l11 12h-29Z" fill="#dff1fb"/>${wheel(116)}${wheel(206)}`;
  return `<svg class="cars-art" viewBox="0 0 320 96" preserveAspectRatio="xMidYMid slice" role="img" aria-label="A drawing of the ${esc(car.label)}"><rect width="320" height="96" fill="color-mix(in srgb, ${paint} 14%, #eef2f5)"/><path d="M0 62h60M250 50h70M20 40h34" stroke="#ffffff" stroke-width="3" stroke-linecap="round" opacity=".8"/><rect y="78" width="320" height="18" fill="#2b3038"/><path d="M0 87h320" stroke="#ffffff" stroke-width="2" stroke-dasharray="18 14" opacity=".5"/>${body}</svg>`;
}

export default {
  id: 'cars', title: 'Cars', placement: 'phone', order: 34,
  render(state, view) {
    const property = view.property;
    if (!property) return '<p class="ui-error">The dealer list could not be loaded. Close this app and open it again.</p>';
    const offline = view.connected ? '' : `${linkWords(view).short} — trading needs the server`;
    const busy = state.activeAction ? 'Finish your current action first' : '';
    const cards = property.cars.map((car, index) => {
      const buyWhy = offline || car.blocked || '';
      const ownWhy = offline || busy;
      const controls = car.owned
        ? `<div class="cars-row">${car.driving ? '<span class="ui-chip is-good cars-driving">Driving this</span>' : `<button class="ui-button is-primary" data-action="property.car-use" data-payload="${json({ id: car.id })}" ${ownWhy ? 'disabled' : ''}>Drive this</button>`}<button class="ui-button" data-action="property.car-sell" data-payload="${json({ id: car.id })}" ${ownWhy ? 'disabled' : ''}>Sell · +${money(car.resale)}</button></div>${ownWhy ? `<p class="ui-why">${esc(ownWhy)}</p>` : ''}`
        : `<button class="ui-button is-primary is-block" data-action="property.car-buy" data-payload="${json({ id: car.id })}" ${buyWhy ? 'disabled' : ''}>Buy · ${money(car.price)}</button>${buyWhy ? `<p class="ui-why">${esc(buyWhy)}</p>` : ''}`;
      return `<article class="cars-card ${car.owned ? 'is-owned' : ''}">${carArt(car, index)}<div class="cars-body"><header><div><h3>${esc(car.label)}</h3><p>“${esc(car.nickname)}”</p></div><b class="${car.owned ? '' : car.affordable ? 'is-afford' : 'is-short'}">${car.price < car.listPrice ? `<s>${money(car.listPrice)}</s> ` : ''}${money(car.price)}</b></header><ul class="ui-chips cars-facts"><li class="ui-chip">Fuel ${money(car.fuel)} / trip</li><li class="ui-chip">${Math.round((1 - car.speed) * 100)}% quicker</li>${car.owned ? '<li class="ui-chip is-good">Owned</li>' : ''}</ul>${controls}</div></article>`;
    }).join('');
    const driving = property.car ? `Choose Drive on the map and pay ${money(property.car.fuel)} of fuel per trip.` : 'Own a car and every trip costs fuel only — no fares.';
    return `<section class="ui-hero cars-hero"><small>${property.car ? 'Your car' : 'No car yet'}</small><strong>${property.car ? esc(property.car.label) : 'Public transport'}</strong><p>${driving}</p></section>${how('cars-rules', ruleList(['An owned car adds Drive to every trip: you pay its fuel instead of a fare, and it gets you there quicker.', 'You can own several vehicles and choose which one you drive.', `Selling returns ${Math.round(CAR_RESALE_RATE * 100)}% of the list price — the amount is on each Sell button.`, 'Prices follow the reference game (the last one was reported, not seen). Vehicle names, fuel costs and speeds are original beta values.']), 'How cars work', true)}<div class="cars-list">${cards}</div>`;
  },
  bind(root, api) { bindHow(root, api); },
};
