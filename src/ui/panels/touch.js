/**
 * OWNER: growth
 * Stay in touch: the Phone app where a player says whether the game may reach them outside the
 * game, and reads exactly what it would say. The age question comes first; under 18, no outside
 * message is offered at all. Every switch is off until the player turns it on, and one tap turns
 * it off again. Rules: server/routes/growth.js (consent) and src/game/digest.js (the words).
 */
import { esc } from '../dom.js';
import { how, rules as ruleList, bindHow } from '../phone/how.js';
import { linkWords } from '../link.js';
import { G, load, call } from './growth-client.js';

const ui = { busy: false };

async function save(api, body) {
  if (ui.busy) return;
  ui.busy = true; api.refresh();
  const result = await call('/api/growth/consent', body);
  ui.busy = false;
  if (result.consent && G.hello) G.hello.consent = result.consent;
  if (!result.ok) api.toast(result.reason || 'That could not be saved.', result.code === 'under_18' ? 'info' : 'error');
  api.refresh();
}

export function digestPreview(digest) {
  if (!digest) return '';
  return `<div class="gr-preview"><b>${esc(digest.subject)}</b>${esc(digest.greeting)}<ul>${digest.lines.map((line) => `<li>${esc(line)}</li>`).join('')}</ul>
    ${digest.more ? `<small>and ${digest.more} more</small>` : ''}<b>This week you could</b><ul>${digest.tasks.map((task) => `<li>${esc(task.text)}</li>`).join('')}</ul><small>${esc(digest.footer)}</small></div>`;
}

const panel = {
  id: 'touch', title: 'Stay in touch', short: 'In touch', placement: 'phone', order: 94, group: 'life', live: false,
  render(state, view) {
    if (!view.connected) return `<p class="gr-note">${esc(linkWords(view).why)}</p>`;
    const hello = G.hello;
    if (!hello) return `<p class="gr-note">${G.error ? esc(G.error) : 'Loading…'}</p>`;
    const consent = hello.consent;
    const age = !consent ? `<div class="gr-card"><h3>First, how old are you?</h3><p>Messages outside the game are only for players who are 18 or older. Your answer is kept with this life and shown to nobody.</p>
        <button class="ui-button is-primary" data-t-age="adult" ${ui.busy ? 'disabled' : ''}>I am 18 or older</button><button class="ui-button" data-t-age="minor" ${ui.busy ? 'disabled' : ''}>I am under 18</button></div>`
      : consent.age === 'minor' ? '<div class="gr-card"><h3>You are all set</h3><p>You told us you are under 18, so the game will never message you outside the game. Everything inside it works the same: Updates, Missions and Events are right here on your Phone.</p></div>'
        : '';
    return `<section class="ui-hero gr-hero"><small>Stay in touch</small><strong>Only if you ask</strong><p>The game never contacts you unless you switch it on here. Nothing below is on by default.</p></section>
      ${age}
      <div class="gr-card"><h3>In the game</h3><p>Updates, the “While you were away” card and the badges on your Phone are always here. They need no permission and leave the game for nowhere.</p></div>
      <h3 class="ui-section">What a weekly message would say<small>preview</small></h3>${digestPreview(hello.digest)}
      <p class="gr-note">This is a preview, drawn from your own life as it is now. Nothing is being sent.</p>
      ${how('touch-rules', ruleList(['At most one message a day and three a week, never between 10 pm and 7 am Lagos time.', 'A message says what happened and what you could do. It never says you lost something by being away.',
    'If messages bring you back less and less, they stop by themselves.', 'One tap here switches everything off.']))}`;
  },
  bind(root, api) {
    bindHow(root, api);
    void load(api);
    for (const node of root.querySelectorAll('[data-t-age]')) node.addEventListener('click', () => save(api, { age: node.dataset.tAge }));
  },
};

export default [panel];
