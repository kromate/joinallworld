/**
 * OWNER: social
 * House invites: share your link, visitors knock, you choose Let them in or Not now.
 * Up to five guests. Guests share a house chat and a guest list with the host. A knock only
 * rings when the server sees the host connected and at home, and says which it is otherwise.
 * The link carries only the public player id and is shown as text to copy, never as markup
 * from another player.
 * The panel contract is at the top of src/ui/shell.js.
 */
import { esc, json, avatar, glyph } from '../dom.js';
import { inviteIdFrom } from '../../game/social-model.js';
import { S, bindCommon, gate, call, perform, sync, cityId } from './social-client.js';
import { how, rules as ruleList, bindHow } from '../phone/how.js';

const ui = { paste: '', host: null, house: null, loading: false, params: null };
const STATUS = { home: 'At home', out: 'Online, but not at home', reconnecting: 'Reconnecting…', offline: 'Offline' };

async function lookUp(api, host) {
  ui.host = host; ui.house = null; ui.loading = true; api.refresh();
  const result = await call(`/api/social/house/${encodeURIComponent(host)}`);
  ui.loading = false;
  ui.house = result.ok ? result : { error: result.reason };
  if (result.ok && result.knock?.status === 'pending') S.knock = { host, name: result.house.host.name, status: 'knocking', expiresAt: result.knock.expiresAt };
  api.refresh();
}

function visitHtml(view) {
  if (ui.loading) return '<p class="social-note">Finding that house…</p>';
  if (!ui.house) return '';
  if (ui.house.error) return `<p class="social-note is-warn">${esc(ui.house.error)}</p>`;
  // Once you are inside, the overview's copy of the house is the current one; the looked-up copy predates the answer.
  const house = S.me.visiting?.host.id === ui.house.house.host.id ? S.me.visiting : ui.house.house, knock = S.knock?.host === house.host.id ? S.knock : null;
  if (house.role === 'host') return '<p class="social-note">That is your own house. Share the link with someone else.</p>';
  // The overview is authoritative; a cached lookup or accepted knock can outlive the visit.
  const inside = S.me.visiting?.host.id === house.host.id;
  const waiting = knock && (knock.status === 'knocking' || knock.status === 'sending') && (knock.status === 'sending' || knock.expiresAt > view.now);
  const expired = knock?.status === 'knocking' && knock.expiresAt <= view.now;
  const why = inside ? null : house.hostStatus !== 'home' ? `${house.host.name} must be at home to answer (${STATUS[house.hostStatus] ?? 'unavailable'}).` : house.guests.length >= house.capacity ? `The house is full (${house.capacity} guests).` : waiting ? 'Knocking… waiting for an answer.' : null;
  return `<div class="ui-card"><h3>${esc(house.host.name)}’s house</h3><p>${esc(STATUS[house.hostStatus] ?? 'Unavailable')} · ${house.guests.length}/${house.capacity} guests</p>
    ${inside ? `<p><strong>You are inside.</strong></p><span class="social-actions"><button class="social-btn is-primary" data-open="messages" data-params="${json({ conv: `h.${house.host.id}` })}">Open house chat</button><button class="social-btn" data-i-leave="${esc(house.host.id)}">Leave</button></span>`
      : `<button class="ui-button is-primary is-block" data-i-knock="${json({ host: house.host.id, name: house.host.name })}" ${why ? 'disabled' : ''}>Knock</button>${why ? `<span class="social-why">${esc(why)}</span>` : ''}
        ${knock?.status === 'declined' ? `<p class="social-note is-warn">${esc(house.host.name)} said not now. You can knock again in a minute.</p>` : ''}${knock?.status === 'failed' ? `<p class="social-note is-warn">${esc(knock.reason)}</p>` : ''}${expired ? '<p class="social-note is-warn">Nobody answered. Knock again if they are still home.</p>' : ''}
        <button class="social-link" data-i-check="${esc(house.host.id)}">Check again</button>`}</div>`;
}

export default {
  id: 'invite', title: 'Invite', placement: 'phone', order: 38,
  render(state, view) {
    // Opened from an invite link: api.open('invite', { host }).
    if (view.params?.host && view.params !== ui.params) { ui.params = view.params; ui.pending = view.params.host; }
    const blocked = gate(view);
    if (blocked) return blocked;
    const me = S.me, house = me.house;
    const link = `${typeof location === 'undefined' ? '' : location.origin}${me.invitePath}`;
    const knocks = house.knocks.map((knock) => `<div class="social-row is-ask">${avatar(knock.from.name, knock.from.id)}<div><strong>${esc(knock.from.name)}</strong><small>is knocking${knock.expiresAt <= view.now ? ' · expired' : ''}</small></div><span class="social-actions"><button class="social-btn is-primary" data-i-answer="${json({ visitor: knock.from.id, answer: 'accept' })}" ${house.guests.length >= house.capacity ? 'disabled' : ''}>Let them in</button><button class="social-btn" data-i-answer="${json({ visitor: knock.from.id, answer: 'decline' })}">Not now</button></span></div>${house.guests.length >= house.capacity ? `<span class="social-why">Your house is full (${house.capacity} guests). Ask someone to leave first.</span>` : ''}`).join('');
    const guests = house.guests.map((guest) => `<div class="social-row">${avatar(guest.name, guest.id)}<div><strong>${esc(guest.name)}</strong><small>Inside · the visit ends after 30 minutes, or when you go out</small></div><span class="social-actions"><button class="social-btn" data-i-remove="${esc(guest.id)}">Ask to leave</button></span></div>`).join('');
    const visiting = me.visiting ? `<h3 class="ui-section">You are visiting</h3><div class="social-list"><div class="social-row"><span class="social-avatar" aria-hidden="true">${glyph('home', 'ui-glyph')}</span><div><strong>${esc(me.visiting.host.name)}’s house</strong><small>${esc(STATUS[me.visiting.hostStatus] ?? '')} · ${me.visiting.guests.length}/${me.visiting.capacity} guests · ${S.houseRoom?.host === me.visiting.host.id ? `in the room now: ${esc(S.houseRoom.members.map((member) => member.name).join(', '))}` : 'joining the room…'}</small></div><span class="social-actions"><button class="social-btn is-primary" data-open="messages" data-params="${json({ conv: `h.${me.visiting.host.id}` })}">House chat</button><button class="social-btn" data-i-leave="${esc(me.visiting.host.id)}">Leave</button></span></div></div>` : '';
    return `<section class="invite-card" aria-label="Your house link"><span class="invite-mark" aria-hidden="true">${glyph('invite')}</span><small>Your house link</small><strong>${esc(state.name)}’s place</strong><output class="social-code" data-i-link>${esc(link)}</output>
        <button class="ui-button is-block" data-i-copy>Copy link</button><p>${house.guests.length} of ${house.capacity} guests inside · ${state.location === 'home' ? 'you are home, knocks will ring' : 'you are out, so knocks will not ring'}</p></section>
      <p class="ui-note">Share the link: people knock, you decide who comes in. A visit lasts up to 30 minutes.</p>
      ${knocks ? `<h3 class="ui-section">At your door</h3><div class="social-list">${knocks}</div>` : ''}<h3 class="ui-section">Guests<small>${house.guests.length}/${house.capacity}</small></h3>${guests ? `<div class="social-list">${guests}</div>` : '<p class="social-note">Nobody is visiting.</p>'}
      ${house.conv ? `<button class="ui-button is-block" data-open="messages" data-params="${json({ conv: house.conv })}">Open house chat</button>` : ''}${visiting}
      <h3 class="ui-section">Visit a house</h3><form class="social-form is-search" data-i-visit><input name="link" maxlength="200" placeholder="Paste a house link" aria-label="House link" value="${esc(ui.paste)}" autocomplete="off"><button class="social-btn">Find</button></form>${visitHtml(view)}
      ${how('invite-rules', ruleList(['Anyone with the link can knock while you are at home. You decide who comes in.', 'A guest joins the host’s home room (the host sees them standing by the door), and everyone inside shares the guest list and the house chat.', 'A visit ends after 30 minutes, when the guest leaves or is asked to, or when the host goes out.', 'Beta: guests do not see the host’s furniture yet, and there is no voice in a house visit from this screen.']), 'How visits work', true)}`;
  },
  bind(root, api) {
    bindHow(root, api);
    bindCommon(root, api);
    if (ui.pending && S.me) { const host = ui.pending; ui.pending = null; void lookUp(api, host); }
    const each = (selector, handler) => { for (const node of root.querySelectorAll(selector)) node.addEventListener('click', () => handler(node)); };
    root.querySelector('[data-i-copy]')?.addEventListener('click', async () => {
      const link = root.querySelector('[data-i-link]').textContent;
      try { await navigator.clipboard.writeText(link); api.toast('Link copied', 'good'); } catch { api.toast('Could not copy. Select the link and copy it yourself.', 'error'); }
    });
    each('[data-i-answer]', async (node) => { const body = JSON.parse(node.dataset.iAnswer); await perform('/api/social/house/answer', body, (done) => (done.code === 'accepted' ? 'They are in' : 'You said not now')); });
    each('[data-i-remove]', (node) => perform('/api/social/house/leave', { host: S.me.me.id, guest: node.dataset.iRemove }));
    each('[data-i-leave]', async (node) => { await perform('/api/social/house/leave', { host: node.dataset.iLeave }, 'You left'); S.knock = null; if (ui.host) void lookUp(api, ui.host); });
    each('[data-i-check]', (node) => lookUp(api, node.dataset.iCheck));
    each('[data-i-knock]', async (node) => {
      const { host, name } = JSON.parse(node.dataset.iKnock);
      S.knock = { host, name, status: 'sending' }; api.refresh();
      const result = await call('/api/social/house/knock', { host, cityId: cityId() });
      S.knock = result.ok ? { host, name, status: result.code === 'inside' ? 'accepted' : 'knocking', expiresAt: result.expiresAt } : { host, name, status: 'failed', reason: result.reason };
      await sync(); void lookUp(api, host);
    });
    const form = root.querySelector('[data-i-visit]');
    form?.querySelector('input').addEventListener('input', (event) => { ui.paste = event.currentTarget.value; });
    form?.addEventListener('submit', (event) => {
      event.preventDefault();
      const host = inviteIdFrom(ui.paste);
      if (!host) { ui.house = { error: 'That does not look like a house link. Paste the whole link.' }; api.refresh(); return; }
      void lookUp(api, host);
    });
  },
};
