/**
 * OWNER: world
 * Health app. The HUD's health warning and weather chips are ./health-chips.js.
 *
 *   'health'       Phone app: how you are, the weather, how close you are to falling sick,
 *                  what to do about it, and every cure with its price and where to get it.
 * Everything shown comes from view.health (src/game/systems/health.js) and view.travel.
 * The panel contract is at the top of src/ui/shell.js.
 */
import './health.css';
import { esc, json, money, mark, iconFor } from '../dom.ts';
import { VENUES } from '../../game/content/venues.ts';

function cureRow(cure, state, view) {
  const def = cure.activity ? Object.values(VENUES[cure.where].spots).flatMap((spot) => spot.activities).find((item) => item.id === cure.activity) : null;
  const cost = def ? def.cost || 0 : cure.cost || 0;
  const price = cost ? money(cost) : 'Free';
  const time = def ? ` · ${def.duration}s` : '';
  const short = cost > state.cash;
  const place = cure.where ? view.travel.destinations.find((item) => item.id === cure.where) : null;
  const go = place ? (place.here
    ? '<span class="health-here">You are here — pick it in the venue panel.</span>'
    : `<button class="ui-button is-small" data-open="map" data-params="${json({ destination: place.id })}">Go to ${esc(place.label)}</button>`) : '';
  return `<li class="ui-row"><span class="ui-row-body"><b>${esc(cure.label)} <span class="ui-chip${short ? ' is-bad' : ''}">${esc(price)}${esc(time)}</span></b><small>${esc(cure.text)}${short ? ` You have ${esc(money(state.cash))}, so this one is out of reach for now.` : ''}</small>${go}</span></li>`;
}

const healthPanel = {
  id: 'health', title: 'Health', placement: 'phone', order: 22, group: 'life',
  /** Sick or run down: something to act on. */
  badge: (state, view) => (view.health?.sick || view.health?.rundown ? 1 : 0),
  render(state, view) {
    const health = view.health;
    const tone = health.sick ? 'is-sick' : health.rundown ? 'is-rundown' : 'is-well';
    const cause = health.cause === 'rain' ? 'You caught it after being soaked by rain.' : health.cause === 'neglect' ? 'It came from going hungry or unwashed for too long.' : '';
    const summary = health.sick
      ? `${cause} It lowers your mood by 35 and makes trekking cost more, but it blocks nothing. It will pass by itself in about ${Math.max(1, Math.round(health.healsInMinutes / 60))}h.`
      : health.rundown ? 'You are wearing yourself down. Eat and wash before it turns into sickness.'
        : health.immune ? `You are protected from falling sick for about ${health.immuneMinutes} more min.` : 'Nothing is wrong.';
    const feelings = health.feelings.map((feeling) => `<li class="ui-chip ${feeling.value > 0 ? 'is-good' : 'is-bad'}">${esc(feeling.label)} ${feeling.value > 0 ? '+' : '−'}${Math.abs(feeling.value)} mood</li>`).join('');
    const resistance = Math.round((1 - health.strain) * 100);
    return `<section class="health-status ${tone}"><span aria-hidden="true">${iconFor('health', health.sick ? 'sick' : health.rundown ? 'rundown' : 'well')}</span><div><h3>${esc(health.status)}</h3><p>${esc(summary)}</p></div></section>
      ${feelings ? `<ul class="ui-chips health-feelings">${feelings}</ul>` : ''}
      <div class="ui-rows"><div class="ui-row"><span class="ui-row-icon" aria-hidden="true">${iconFor('weather', health.weather.id, health.weather.icon)}</span><span class="ui-row-body"><b>${esc(health.weather.label)} · about ${esc(health.weather.minutesLeft)} more min</b><small>${esc(health.weather.text)}</small></span></div>
        <div class="ui-row health-risk"><span class="ui-row-icon" aria-hidden="true">${mark('shield')}</span><span class="ui-row-body"><b>${health.sick ? 'Already sick' : 'Resistance'} <span class="ui-chip ${resistance < 50 ? 'is-warn' : 'is-good'}">${resistance}%</span></b><span class="ui-bar${resistance < 50 ? ' is-low' : ''}" role="meter" aria-label="${health.sick ? 'Already sick' : 'Resistance'}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${resistance}"><i style="width:${Math.max(0, Math.min(100, resistance))}%"></i></span><small>Drops while Hunger or Hygiene is under 15 and you keep playing. Time away does not count. At zero you fall sick.</small></span></div></div>
      <h3 class="ui-section">What to do</h3><ul class="health-advice">${health.advice.map((line) => `<li>${esc(line)}</li>`).join('')}</ul>
      <h3 class="ui-section">${health.sick ? 'Ways to get well' : 'If you ever fall sick'}</h3><ul class="ui-rows health-cures">${health.cures.map((cure) => cureRow(cure, state, view)).join('')}</ul>`;
  },
};

export default [healthPanel];
