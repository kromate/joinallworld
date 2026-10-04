/**
 * OWNER: home
 * Cars app: the dealer list, buying, choosing which owned car to drive, and selling back.
 * Actions: 'property.car-buy', 'property.car-use', 'property.car-sell'. An owned car adds a
 * "Drive" travel mode that costs fuel only (systems/property.js contributes it to the travel
 * system). Every disabled button says what is missing.
 */
import './cars.css';
import { esc, money, json } from '../dom.js';
import { CAR_RESALE_RATE } from '../../game/content/cars.js';

export default {
  id: 'cars', title: 'Cars', icon: '🚗', placement: 'phone', order: 34,
  render(state, view) {
    const property = view.property;
    if (!property) return '<p class="ui-error">The dealer list could not be loaded. Close this app and open it again.</p>';
    const offline = view.connected ? '' : 'Offline — reconnect to trade';
    const busy = state.activeAction ? 'Finish your current action first' : '';
    const cards = property.cars.map((car) => {
      const buyWhy = offline || car.blocked || '';
      const ownWhy = offline || busy;
      const controls = car.owned
        ? `<div class="cars-row">${car.driving ? '<span class="cars-driving">🔑 Driving this</span>' : `<button class="ui-button is-primary" data-action="property.car-use" data-payload="${json({ id: car.id })}" ${ownWhy ? 'disabled' : ''}>Drive this</button>`}<button class="ui-button" data-action="property.car-sell" data-payload="${json({ id: car.id })}" ${ownWhy ? 'disabled' : ''}>Sell · +${money(car.resale)}</button></div>${ownWhy ? `<p class="cars-why">${esc(ownWhy)}</p>` : ''}`
        : `<button class="ui-button is-primary" data-action="property.car-buy" data-payload="${json({ id: car.id })}" ${buyWhy ? 'disabled' : ''}>Buy · ${money(car.price)}</button>${buyWhy ? `<p class="cars-why">${esc(buyWhy)}</p>` : ''}`;
      return `<article class="ui-card cars-card ${car.owned ? 'is-owned' : ''}"><header><span class="cars-icon" aria-hidden="true">${esc(car.icon)}</span><div><h3>${esc(car.label)}</h3><p>“${esc(car.nickname)}”</p></div><b class="${car.affordable ? 'is-afford' : ''}">${car.price < car.listPrice ? `<s>${money(car.listPrice)}</s> ` : ''}${money(car.price)}</b></header><p class="cars-facts">Fuel ${money(car.fuel)} per trip · ${Math.round((1 - car.speed) * 100)}% quicker than public transport</p>${controls}</article>`;
    }).join('');
    const driving = property.car ? `You drive the <strong>${esc(property.car.label)}</strong>: choose Drive on the map and pay ${money(property.car.fuel)} of fuel per trip.` : 'Own a car and every trip costs fuel only — no fares.';
    return `<p class="cars-intro">${driving}</p>${cards}<p class="preview-note">Prices follow the reference game (the last one was reported, not seen). Vehicle names, fuel costs and speeds are original beta values. Selling returns ${Math.round(CAR_RESALE_RATE * 100)}% of the list price.</p>`;
  },
};
