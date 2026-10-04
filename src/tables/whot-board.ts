/**
 * OWNER: growth
 * The Whot table as HTML: the other players, the pile and the market, your own hand, and the
 * buttons to play. It draws exactly what the server's view holds and sends a move when a card or
 * the market is tapped; it never decides whether a move is allowed (the cards it marks playable
 * are the server's own list). Every card is a real button, so the table works by keyboard and
 * at 360 px. The turn clock is one CSS animation: no script runs while a player thinks.
 */
import { esc, glyph } from '../ui/dom.js';
import { SHAPES, SHAPE_NAMES, SPECIAL, cardName } from './whot.ts';
import type { Card, WhotView } from './whot.ts';
import type { TableStateFrame } from '../types/growth.ts';

/** One card face. `attrs` makes it a button. */
function card(item: Card, { attrs = '', small = false, dim = false }: { attrs?: string; small?: boolean; dim?: boolean } = {}): string {
  const whot = item.s === 'whot', label = `${cardName(item)}${SPECIAL[item.n] && !whot ? `, ${SPECIAL[item.n]}` : ''}`;
  const face = `<span class="wh-n">${whot ? '20' : item.n}</span><span class="wh-s" aria-hidden="true">${whot ? '<b>WHOT</b>' : glyph(item.s)}</span>${SPECIAL[item.n] && !whot ? `<small>${esc(SPECIAL[item.n])}</small>` : ''}`;
  const cls = `wh-card is-${item.s}${small ? ' is-small' : ''}${dim ? ' is-dim' : ''}`;
  return attrs ? `<button class="${cls}" ${attrs} aria-label="${esc(label)}">${face}</button>` : `<span class="${cls}" role="img" aria-label="${esc(label)}">${face}</span>`;
}
const backs = (count: number): string => `<span class="wh-backs" aria-hidden="true">${'<i></i>'.repeat(Math.min(count, 6))}</span>`;

/**
 * @param state  the server's table-state  @param ui  the Whot card waiting for a shape
 * @param now  the server time at this draw (for the turn clock)
 */
export function whotBoard(state: TableStateFrame, ui: { choosing: number | null }, now = 0): string {
  const view = state.view as WhotView, // the server's view of this game (src/tables/whot.ts view)
    seats = state.table.seats, me = state.you, over = state.table.status === 'over';
  const myTurn = me !== null && state.toMove.includes(me);
  const others = seats.map((seat, index) => ({ seat, index })).filter(({ index }) => index !== me);
  const players = others.map(({ seat, index }) => `<li class="wh-player${view.turn === index ? ' is-turn' : ''}${seat.left || view.out[index] ? ' is-out' : ''}"><b>${esc(seat.name)}</b>
    ${over && view.shown ? `<span class="wh-shown">${(view.shown[index] ?? []).map((item) => card(item, { small: true })).join('') || '<small>no cards</small>'}</span>` : `${backs(view.counts[index] ?? 0)}<small>${view.counts[index]} card${view.counts[index] === 1 ? '' : 's'}${view.said[index] ? ' · <em>Last card!</em>' : ''}${seat.away ? ' · away' : ''}${seat.left ? ' · left' : ''}</small>`}</li>`).join('');
  const need = view.pick ? `<p class="wh-need is-warn">${myTurn ? `Answer with a ${view.pickBy}, or pick ${view.pick}` : `${esc(seats[view.turn ?? -1]?.name ?? 'Next')} must answer or pick ${view.pick}`}</p>`
    : view.call ? `<p class="wh-need">${esc(SHAPE_NAMES[view.call])}s were called ${glyph(view.call, 'ui-glyph')}</p>` : '';
  // The bar starts where the turn's time really is (by the server's clock) and runs out with it.
  const left = state.clock ? Math.max(0, (state.clock.deadline - Math.max(now, state.clock.now)) / 1000) : 0;
  const clock = state.clock && !over ? `<div class="wh-clock" aria-hidden="true"><i style="animation-duration:${Math.max(1, Math.round(left))}s;--from:${Math.min(1, left / state.clock.seconds).toFixed(2)}" data-n="${state.n}"></i></div>` : '';
  const turnLine = over ? '' : `<p class="wh-turn" role="status">${myTurn ? 'Your turn' : view.turn === null ? '' : `${esc(seats[view.turn]?.name)} is playing…`}</p>`;
  let hand = '';
  if (view.hand) {
    const cards = view.hand.map((item, index) => {
      const can = myTurn && view.playable.includes(index);
      return card(item, { attrs: `data-wh-card="${index}" ${can ? '' : 'disabled'}`, dim: myTurn && !can });
    }).join('');
    const picker = ui.choosing !== null && view.hand[ui.choosing]?.s === 'whot' ? `<div class="wh-picker" role="group" aria-label="Name the shape you need"><b>I need…</b>${SHAPES.map((shape) => `<button class="ui-button" data-wh-shape="${shape}">${glyph(shape, 'ui-glyph')} ${esc(SHAPE_NAMES[shape])}</button>`).join('')}<button class="gr-swap" data-wh-cancel>Cancel</button></div>` : '';
    hand = `<div class="wh-mine"><div class="wh-hand" role="group" aria-label="Your cards">${cards}</div>${picker}
      ${over ? '' : `<button class="ui-button is-block${myTurn && !view.playable.length ? ' is-primary' : ''}" data-wh-draw ${myTurn ? '' : 'disabled'}>${view.pick && myTurn ? `Pick ${view.pick} from the market` : 'Go to market'}</button>`}</div>`;
  } else if (!over) hand = '<p class="gr-note">You are watching. Hands are hidden from everyone but their owner.</p>';
  return `<div class="wh-table"><ul class="wh-players">${players}</ul>
    <div class="wh-centre"><div class="wh-market" aria-label="Market: ${view.market} cards"><span class="wh-card is-back" aria-hidden="true"></span><small>Market · ${view.market}</small></div>
      <div class="wh-top">${card(view.top)}<small>On the pile</small></div></div>
    ${need}${turnLine}${clock}${hand}
    <ol class="wh-log" aria-label="What just happened">${state.log.slice(-4).map((line) => `<li>${esc(line)}</li>`).join('')}</ol></div>`;
}

/** Wire a drawn board. `play(move)` sends a move; `ui` is the panel's own small state. */
export function bindWhot(root: HTMLElement, state: TableStateFrame, ui: { choosing: number | null }, play: (move: object) => void, redraw: () => void): void {
  const hand = (): Card[] => (state.view as WhotView).hand ?? []; // the server's view of this game; the buttons exist only for a hand
  for (const node of root.querySelectorAll<HTMLElement>('[data-wh-card]')) node.addEventListener('click', () => {
    const index = Number(node.dataset.whCard), item = hand()[index];
    // A Whot needs a shape, unless it is the last card.
    if (item?.s === 'whot' && hand().length > 1) { ui.choosing = index; redraw(); return; }
    ui.choosing = null; play({ t: 'play', i: index });
  });
  for (const node of root.querySelectorAll<HTMLElement>('[data-wh-shape]')) node.addEventListener('click', () => { const index = ui.choosing; ui.choosing = null; play({ t: 'play', i: index, shape: node.dataset.whShape }); });
  root.querySelector('[data-wh-cancel]')?.addEventListener('click', () => { ui.choosing = null; redraw(); });
  root.querySelector('[data-wh-draw]')?.addEventListener('click', () => { ui.choosing = null; play({ t: 'draw' }); });
}
export const whotRules = ['Match the top card’s shape or its number, or play a Whot (20) and name the shape you need.', 'Cannot play, or would rather not? Go to market: take one card and your turn ends.',
  '1 Hold on: you play again. 8 Suspension: the next player misses a turn. 14 General market: everyone else takes a card and you play again.', '2 Pick two and 5 Pick three: the next player answers with the same number or takes the cards.',
  'First to empty their hand wins. “Last card!” is called for you.', 'You have 30 seconds a turn. Miss it and you go to market; miss three in a row and you forfeit.'];
