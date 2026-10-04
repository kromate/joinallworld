/**
 * OWNER: foundation
 * City card: where you are, entering another city, and the places in the current one.
 * Opened from the world map and the city button with params { city: cityId }.
 */
import { esc, json } from '../dom.js';

const CITY_INFO = { lagos: { name: 'Lagos', region: 'Lagos State' }, ibadan: { name: 'Ibadan', region: 'Oyo State' } };

export default {
  id: 'city', title: 'City', icon: '🌍', placement: 'modal',
  render(state, view) {
    const id = Object.hasOwn(CITY_INFO, view.params?.city) ? view.params.city : view.cityId;
    const city = CITY_INFO[id], here = id === view.cityId;
    const places = here ? `<div id="city-places">${view.venues.map((venue) => `<button data-open="map" data-params="${json({ destination: venue.id })}">${esc(venue.icon || '')} ${esc(venue.label)}</button>`).join('')}</div>` : '';
    return `<h3>${esc(city.name)}</h3><p>${esc(city.region)}, Nigeria</p><p>${here ? 'You are here. Choose somewhere to go.' : 'Start or continue your own life in this city. City switching is free during the beta.'}</p>${here ? '' : `<button class="city-primary" data-city-enter="${esc(id)}">Enter ${esc(city.name)}</button>`}${places}<p class="preview-note">More places and activities are coming to ${esc(city.name)}.</p>`;
  },
  bind(root) {
    root.querySelector('[data-city-enter]')?.addEventListener('click', (event) => window.dispatchEvent(new CustomEvent('jaw:switch-city', { detail: { city: event.currentTarget.dataset.cityEnter } })));
  },
};
