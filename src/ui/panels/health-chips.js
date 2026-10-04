/**
 * OWNER: world
 * The HUD's health warning and weather chips. First download; the Health app they open is
 * ./health.js (fetched with the life panel group).
 *   'health-chip'  HUD alert, shown only when there is something to act on: sick or run down.
 *   'weather-chip' HUD tray chip: the weather now (and the rain warning). Both open the Health app.
 * Everything shown comes from view.health (src/game/systems/health.js).
 */
import './health.css';
import { esc, iconFor } from '../dom.js';

/** Something to act on now (sick, run down) stays in view; the weather is information and lives in the tray. */
const chip = (warning) => `<button class="health-chip is-${esc(warning.level)}" data-open="health" aria-label="${esc(warning.text)}. Open the Health app."><span aria-hidden="true">${iconFor('health', warning.level, warning.icon)}</span><b>${esc(warning.text)}</b></button>`;
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
    return sky ? `<button class="health-chip" data-open="health" aria-label="Weather: ${esc(sky.label)}. Open the Health app."><span aria-hidden="true">${iconFor('weather', sky.id, sky.icon)}</span><b>${esc(sky.label)}</b></button>` : '';
  },
};

export default [healthChip, weatherChip];
