/**
 * OWNER: foundation
 * City card: the city you are in and its places, each a link to its card on the Map.
 * One city is open (Lagos); the others on the Nigeria map are "coming soon" and have no card,
 * so there is nothing to enter from here.
 */
import { esc, json, iconFor } from '../dom.js';

export default {
  id: 'city', title: 'City', placement: 'modal',
  render(state, view) {
    const city = view.city || { name: 'Lagos', region: 'Lagos State' };
    const places = `<div id="city-places">${view.venues.map((venue) => `<button data-open="map" data-params="${json({ destination: venue.id })}">${iconFor('venue', venue.id, venue.icon)} ${esc(venue.label)}</button>`).join('')}</div>`;
    return `<h3>${esc(city.name)}</h3><p>${esc(city.region)}, Nigeria</p><p>You are here. Choose somewhere to go.</p>${places}<p class="preview-note">More places and activities are coming to ${esc(city.name)}.</p>`;
  },
};
