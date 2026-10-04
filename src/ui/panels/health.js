/**
 * OWNER: world
 * Health app and the HUD health warning.
 *
 *   'health'       Phone app: how you are, the weather, how close you are to falling sick,
 *                  what to do about it, and every cure with its price and where to get it.
 *   'health-chip'  HUD alert, shown only when there is something to act on: sick or run down.
 *   'weather-chip' HUD tray chip: the weather now (and the rain warning). Both open the Health app.
 * Everything shown comes from view.health (src/game/systems/health.js) and view.travel.
 * The panel contract is at the top of src/ui/shell.js.
 */
import './health.css';
import { esc, json, money, meter } from '../dom.js';
import { VENUES } from '../../game/content/venues.js';

function cureRow(cure, state, view) {
  const def = cure.activity ? Object.values(VENUES[cure.where].spots).flatMap((spot) => spot.activities).find((item) => item.id === cure.activity) : null;
  const cost = def ? def.cost || 0 : cure.cost || 0;
  const price = cost ? money(cost) : 'Free';
  const time = def ? ` · ${def.duration}s` : '';
  const short = cost > state.cash;
  const place = cure.where ? view.travel.destinations.find((item) => item.id === cure.where) : null;
  const go = place ? (place.here
    ? '<span class="health-here">You are here — pick it in the venue panel.</span>'
    : `<button class="ui-button" data-open="map" data-params="${json({ destination: place.id })}">Go to ${esc(place.label)}</button>`) : '';
  return `<li><div><b>${esc(cure.label)}</b><small>${esc(price)}${esc(time)} · ${esc(cure.text)}${short ? ` You have ${esc(money(state.cash))}, so this one is out of reach for now.` : ''}</small></div>${go}</li>`;
}

const healthPanel = {
  id: 'health', title: 'Health', icon: '🩺', placement: 'phone', order: 22,
  render(state, view) {
    const health = view.health;
    const tone = health.sick ? 'is-sick' : health.rundown ? 'is-rundown' : 'is-well';
    const cause = health.cause === 'rain' ? 'You caught it after being soaked by rain.' : health.cause === 'neglect' ? 'It came from going hungry or unwashed for too long.' : '';
    const summary = health.sick
      ? `${cause} It lowers your mood by 35 and makes trekking cost more, but it blocks nothing. It will pass by itself in about ${Math.max(1, Math.round(health.healsInMinutes / 60))}h.`
      : health.rundown ? 'You are wearing yourself down. Eat and wash before it turns into sickness.'
        : health.immune ? `You are protected from falling sick for about ${health.immuneMinutes} more min.` : 'Nothing is wrong.';
    const feelings = health.feelings.map((feeling) => `<li><b>${esc(feeling.label)}</b> <span>${feeling.value > 0 ? '+' : '−'}${Math.abs(feeling.value)} mood</span></li>`).join('');
    return `<section class="health-status ${tone}"><span aria-hidden="true">${health.sick ? '🤒' : health.rundown ? '🧼' : '💪🏾'}</span><div><h3>${esc(health.status)}</h3><p>${esc(summary)}</p></div></section>
      ${feelings ? `<ul class="health-feelings">${feelings}</ul>` : ''}
      <h3>Weather</h3><p class="health-weather">${esc(health.weather.icon)} <b>${esc(health.weather.label)}</b> for about ${esc(health.weather.minutesLeft)} more min. ${esc(health.weather.text)}</p>
      <h3>Risk of falling sick</h3>${meter('Worn down', Math.round((1 - health.strain) * 100), 50).replace('Worn down', health.sick ? 'Already sick' : 'Resistance')}
      <p class="preview-note">Resistance drops while Hunger or Hygiene is under 15 and you keep playing. Time away does not count. At zero you fall sick.</p>
      <h3>What to do</h3><ul class="ui-list">${health.advice.map((line) => `<li>${esc(line)}</li>`).join('')}</ul>
      <h3>${health.sick ? 'Ways to get well' : 'If you ever fall sick'}</h3><ul class="health-cures">${health.cures.map((cure) => cureRow(cure, state, view)).join('')}</ul>`;
  },
};

/** Something to act on now (sick, run down) stays in view; the weather is information and lives in the tray. */
const chip = (warning) => `<button class="health-chip is-${esc(warning.level)}" data-open="health" aria-label="${esc(warning.text)}. Open the Health app."><span aria-hidden="true">${esc(warning.icon)}</span><b>${esc(warning.text)}</b></button>`;
const healthChip = {
  id: 'health-chip', title: 'Health', placement: 'hud', slot: 'alert', order: 6,
  render(state, view) {
    const warning = view.health?.warning;
    return warning && warning.level !== 'rain' ? chip(warning) : '';
  },
};
const weatherChip = {
  id: 'weather-chip', title: 'Weather', placement: 'hud', order: 6,
  render(state, view) {
    const health = view.health, warning = health?.warning;
    if (warning?.level === 'rain') return chip(warning);
    const sky = health?.weather;
    return sky ? `<button class="health-chip" data-open="health" aria-label="Weather: ${esc(sky.label)}. Open the Health app."><span aria-hidden="true">${esc(sky.icon)}</span><b>${esc(sky.label)}</b></button>` : '';
  },
};

export default [healthPanel, healthChip, weatherChip];
