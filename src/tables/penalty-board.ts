/**
 * OWNER: growth
 * The penalty shoot-out as HTML: the score as a row of kicks for each side, the goal with three
 * places to aim (or to dive), and what the last kick was. It draws what the server's view holds
 * and sends a choice when a side is tapped. A choice stays secret on the server until both are in.
 * Three real buttons: it works by keyboard and at 360 px, and needs no reflexes or fast network.
 */
import { esc, glyph } from '../ui/dom.js';
import { ZONES } from './penalty.ts';

const dots = (history, seat, each) => {
  const mine = history.filter((kick) => kick.kicker === seat);
  return Array.from({ length: Math.max(each, mine.length) }, (_, index) => `<i class="${mine[index] ? (mine[index].goal ? 'is-goal' : 'is-miss') : ''}"></i>`).join('');
};

/** @param {object} state the server's table-state  @param {object} ui unused  @param {number} now server time at this draw */
export function penaltyBoard(state, ui, now = 0) {
  const view = state.view, seats = state.table.seats, me = state.you, over = state.table.status === 'over';
  const shooting = me !== null && view.kicker === me, playing = me !== null && !over;
  const waiting = playing && view.mine !== null;
  const last = view.history.at(-1);
  const left = state.clock ? Math.max(0, (state.clock.deadline - Math.max(now, state.clock.now)) / 1000) : 0;
  const clock = state.clock && !over ? `<div class="wh-clock" aria-hidden="true"><i style="animation-duration:${Math.max(1, Math.round(left))}s;--from:${Math.min(1, left / state.clock.seconds).toFixed(2)}" data-n="${state.n}"></i></div>` : '';
  const score = seats.map((seat, index) => `<li class="${view.kicker === index ? 'is-turn' : ''}"><b>${esc(seat.name)}</b><span class="pn-goals">${view.goals[index]}</span><span class="pn-dots" aria-label="${view.goals[index]} scored of ${view.taken[index]}">${dots(view.history, index, view.options.kicks)}</span></li>`).join('');
  const prompt = over ? '' : !playing ? `${esc(seats[view.kicker].name)} is shooting`
    : waiting ? `You chose ${ZONES[view.mine].toLowerCase()}. Waiting for ${esc(seats[1 - me].name)}…`
      : shooting ? 'You are shooting. Pick your side.' : `You are in goal. Which way will ${esc(seats[1 - me].name)} shoot?`;
  const zones = ZONES.map((zone, index) => `<button class="pn-zone${view.mine === index ? ' is-mine' : ''}${last && over ? '' : ''}" data-pn-zone="${index}" ${playing && !waiting ? '' : 'disabled'} aria-label="${shooting ? 'Shoot' : 'Dive'} ${zone.toLowerCase()}">${esc(zone)}</button>`).join('');
  const lastLine = last ? `<p class="pn-last ${last.goal ? 'is-goal' : 'is-save'}">${last.goal ? 'Goal' : 'Saved'} · ${esc(seats[last.kicker].name)} shot ${ZONES[last.shot].toLowerCase()}, ${esc(seats[1 - last.kicker].name)} went ${ZONES[last.dive].toLowerCase()}</p>` : '<p class="pn-last">Best of the kicks. Same side as the keeper is a save.</p>';
  return `<div class="wh-table pn-table"><ul class="pn-score">${score}</ul>
    <div class="pn-goal" role="group" aria-label="The goal"><span class="pn-net" aria-hidden="true">${glyph('goal')}</span><div class="pn-zones">${zones}</div></div>
    ${view.sudden && !over ? '<p class="wh-need is-warn">Sudden death</p>' : ''}<p class="wh-turn" role="status">${prompt}</p>${clock}${lastLine}
    ${playing ? '' : over ? '' : '<p class="gr-note">You are watching.</p>'}</div>`;
}

export function bindPenalty(root, state, ui, play) {
  for (const node of root.querySelectorAll('[data-pn-zone]')) node.addEventListener('click', () => play({ z: Number(node.dataset.pnZone) }));
}
export const penaltyRules = ['You take turns to shoot; the other keeps goal. Five kicks each.', 'For every kick you both pick a side at the same time: left, centre or right. Neither sees the other’s pick until both are in.',
  'The keeper who picks the same side saves it. Any other side is a goal.', 'Level after five each? Sudden death, one kick each, for up to five more rounds.', 'You have 15 seconds to pick. If you do not, a side is picked for you.'];
