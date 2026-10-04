/**
 * OWNER: social
 * People tab of the Sim sheet (also the target of the E shortcut) and the person card.
 *
 * People tab: who is in this venue right now — real players (from the server's live presence,
 * marked "Real player") and the venue's NPC regulars (marked with their role) — then friends
 * with their presence, friend requests, and every relationship with its closeness meter.
 * Person card ('person', opened from a card): an NPC's quote and timed interactions, or a
 * player's Chat, Add friend, interactions, Ask to be my Bae, Send money, Block and Report.
 * Every disabled control says why. All names and text are escaped.
 * The panel contract is at the top of src/ui/shell.js.
 */
import { esc, json, money, empty, avatar, mark, iconFor } from '../dom.js';
import { linkWords } from '../link.js';
import { NPCS } from '../../game/content/npcs.ts';
import { PRESENCE, presenceText, roomSummary } from '../../game/social-model.ts';
import { S, start, bindCommon, gate, perform, loadPeople, loadProfile, cityId, newClientId, refreshLife } from './social-client.js';

const STALE_MS = 20000;
const ui = { form: null, amount: '', reason: 'harassment', text: '', clientId: null, busy: false, loadedFor: null };
const venueName = (view, id) => view.venues.find((venue) => venue.id === id)?.label ?? id;
const dot = (status) => `<i class="social-dot is-${PRESENCE[status]?.dot ?? 'off'}" title="${esc(PRESENCE[status]?.hint ?? '')}"></i>`;
const meterHtml = (points, max, label) => `<div class="social-meter" role="meter" aria-label="${esc(label)}" aria-valuemin="0" aria-valuemax="${max}" aria-valuenow="${Math.floor(points)}"><i style="width:${Math.min(100, (points / max) * 100)}%"></i></div>`;
const closeness = (rel, view) => `${esc(rel.tierLabel)} · ${Math.floor(rel.points)}/${rel.next ? rel.next.min : view.social.maxCloseness}${rel.next ? ` to ${esc(rel.next.label)}` : ''}`;

const peopleTab = {
  id: 'people', title: 'People', placement: 'sim-tab', order: 50,
  render(state, view) {
    const social = view.social, here = social.here;
    const list = S.people && !S.people.error && S.people.venue === state.location && S.people.cityId === view.cityId ? S.people : null;
    const stale = Math.floor(Math.max(0, view.now - S.peopleAt) / STALE_MS);
    const players = (list?.players || []).map((player) => `<button class="social-card" data-open="person" data-params="${json({ player: player.id, name: player.name })}">${avatar(player.name, player.id, dot('online'))}<strong>${esc(player.name)}</strong><small class="is-player">Real player${player.friend ? ' · Friend' : ''}</small></button>`).join('');
    const npcs = here.map((npc) => `<button class="social-card" data-open="person" data-params="${json({ npc: npc.id })}"><span class="social-avatar" aria-hidden="true">${avatar(npc.name, npc.id)}</span><strong>${esc(npc.name)}</strong><small>${esc(npc.role)} · NPC</small></button>`).join('');
    const summary = !view.connected ? `${linkWords(view).why} The list of players cannot be checked right now.` : S.people?.error ? `Could not check who is here: ${S.people.error}` : roomSummary(list, venueName(view, state.location));
    const hereHtml = `<div class="social-head"><h3>Here at ${esc(venueName(view, state.location))}</h3><button class="social-btn" data-p-refresh ${view.connected ? '' : 'disabled'}>Refresh</button></div>
      <p class="social-note" data-stale="${stale}">${esc(summary)}${here.length ? ` ${here.length} local${here.length === 1 ? '' : 's'} (NPCs) ${here.length === 1 ? 'is' : 'are'} always around.` : ''}</p>
      ${players || npcs ? `<div class="social-cards">${players}${npcs}</div>` : ''}${state.location !== 'home' && view.connected ? '<button class="social-btn" data-p-community>Open venue chat</button>' : ''}`;
    const blocked = gate(view);
    let friendsHtml = blocked;
    if (!blocked) {
      const requests = S.me.requests.in.map((request) => `<div class="social-row is-ask">${avatar(request.name, request.id)}<div><strong>${esc(request.name)}</strong><small>wants to be friends</small></div><span class="social-actions"><button class="social-btn is-primary" data-p-answer="${json({ from: request.id, accept: true })}">Accept</button><button class="social-btn" data-p-answer="${json({ from: request.id, accept: false })}">Decline</button></span></div>`).join('');
      const friends = S.me.friends.map((friend) => `<div class="social-row">${avatar(friend.name, friend.id, dot(friend.status))}<div><strong>${esc(friend.name)}${friend.bae ? ` ${mark('heart')}<span class="ui-sr">your Bae</span>` : ''}</strong><small class="social-presence is-${esc(PRESENCE[friend.status] ? friend.status : 'offline')}">${esc(presenceText(friend, (id) => venueName(view, id), view.now))}</small></div><span class="social-actions"><button class="social-btn is-primary" data-open="messages" data-params="${json({ to: friend.id, name: friend.name })}">Chat</button><button class="social-btn" data-open="person" data-params="${json({ player: friend.id, name: friend.name })}">View</button></span></div>`).join('');
      const waiting = S.me.requests.out.length ? `<p class="social-note">Waiting for an answer from: ${esc(S.me.requests.out.map((request) => request.name).join(', '))}</p>` : '';
      const blockedList = S.me.blocked.length ? `<h3>Blocked</h3>${S.me.blocked.map((player) => `<div class="social-row"><div><strong>${esc(player.name)}</strong><small>Cannot message, invite or see you</small></div><span class="social-actions"><button class="social-btn" data-p-unblock="${esc(player.id)}">Unblock</button></span></div>`).join('')}` : '';
      friendsHtml = `${requests || friends ? `<div class="social-list">${requests}${friends}</div>` : ''}${friends ? '' : empty('hand', 'No friends yet', 'Go to places around town, greet people, and add the players you meet.', '<button class="ui-button" data-open="map">Find somewhere to go</button>')}${waiting}${blockedList}`;
    }
    const rels = social.relationships.map((rel) => `<div class="social-row"><span class="social-avatar" aria-hidden="true">${avatar(rel.name, rel.id)}</span><div><strong>${esc(rel.name)}</strong><small>${esc(rel.role)} · ${closeness(rel, view)}</small>${meterHtml(rel.points, rel.next ? rel.next.min : view.social.maxCloseness, `Closeness with ${rel.name}`)}</div></div>`).join('');
    return `${hereHtml}<h3 class="ui-section">Friends</h3>${friendsHtml}<h3 class="ui-section">Relationships</h3>${rels ? `<div class="social-list">${rels}</div>` : empty('handshake', 'Nobody yet', 'Say hello to one of the regulars at a venue to start.')}
      <p class="preview-note">Closeness tiers (Acquaintance 5, Friend 20, Paddy Mi 40) and points are original beta values. ${social.paddyCount} Paddy Mi so far.</p>`;
  },
  bind(root, api) {
    bindCommon(root, api);
    const state = api.state(), view = api.view();
    const key = `${view.cityId}:${state.location}:${Boolean(state.activeAction)}`;
    if (view.connected && (key !== ui.loadedFor || view.now - S.peopleAt >= STALE_MS)) { ui.loadedFor = key; void loadPeople(); }
    root.querySelector('[data-p-refresh]')?.addEventListener('click', () => void loadPeople());
    root.querySelector('[data-p-community]')?.addEventListener('click', () => { api.close(); api.toggleCommunity(true); });
    for (const node of root.querySelectorAll('[data-p-answer]')) node.addEventListener('click', async () => { const body = JSON.parse(node.dataset.pAnswer); await perform('/api/social/friends/answer', { ...body, cityId: cityId() }, body.accept ? 'You are now friends' : null); refreshLife(); });
    for (const node of root.querySelectorAll('[data-p-unblock]')) node.addEventListener('click', () => perform('/api/social/unblock', { id: node.dataset.pUnblock }, 'Unblocked'));
  },
};

function npcCard(state, view, id) {
  const here = view.social.here.find((npc) => npc.id === id);
  const base = NPCS[id];
  if (!base) return '<p class="ui-error">That person is not around.</p>';
  const rel = view.social.relationships.find((item) => item.id === id);
  const why = !view.connected ? linkWords(view).cannot('interact') : !here ? `${base.name} is at ${venueName(view, base.venue)}. Go there to interact.` : here.blocked ? here.blocked : state.activeAction ? 'Finish or cancel your current action first.' : null;
  const actions = (here?.actions || []).map((action) => {
    const poor = action.cost > state.cash ? `You need ${money(action.cost)} (you have ${money(state.cash)}).` : null;
    const reason = why || poor;
    return `<button class="social-act" data-n-act="${esc(action.activity)}" ${reason ? 'disabled' : ''}><strong>${iconFor('npc-action', action.id, action.icon)} ${esc(action.label)}</strong><small>${mark('clock')} ${action.duration}s · ${action.cost ? money(action.cost) : 'Free'} · ${action.tags.map((tag) => `+${esc(tag[0].toUpperCase() + tag.slice(1))}`).join(' ')}${action.chance !== null ? ` · ${action.chance}% chance` : ''}</small>${reason ? `<span class="social-why">${esc(reason)}</span>` : ''}</button>`;
  }).join('');
  const points = rel?.points ?? 0, target = rel?.next ?? { min: 5, label: 'Acquaintance' };
  return `<div class="social-head people-who"><span class="social-avatar is-big" aria-hidden="true">${avatar(base.name, base.id)}</span><h3>${esc(base.name)}</h3></div><p>${esc(base.role)} · NPC${here ? ` · ${here.left} of ${view.social.dailyInteractions} interactions left today` : ''}</p>
    ${here ? `<p class="social-quote">“${esc(here.quote)}”</p>` : ''}<p>${rel ? closeness(rel, view) : 'Stranger · 0/5 to Acquaintance'}</p>${meterHtml(points, rel?.next ? target.min : rel ? view.social.maxCloseness : 5, `Closeness with ${base.name}`)}
    ${actions ? `<div class="social-grid">${actions}</div>` : `<p class="social-why">${esc(why)}</p>`}<p class="preview-note">Each interaction takes a few seconds and can be cancelled. Effects other than Say Hello are original beta values.</p>`;
}

function playerCard(state, view, id) {
  const blocked = gate(view);
  if (blocked) return blocked;
  const card = S.profiles.get(id);
  if (!card) return '<p class="social-note">Loading player…</p>';
  if (card.error) return `<p class="social-note is-warn">${esc(card.error)}</p><button class="social-btn" data-c-reload>Retry</button>`;
  if (card.self) return `<p>This is you, ${esc(card.name)}.</p>`;
  const social = view.social, rel = social.relationships.find((item) => item.id === id);
  const points = Math.floor(rel?.points ?? 0);
  const hereList = S.people && !S.people.error ? S.people : null;
  const together = Boolean(hereList?.players.some((player) => player.id === id)) && hereList.venue === state.location && state.location !== 'home';
  const left = rel ? rel.left : social.dailyInteractions;
  const whyAct = card.blocked ? 'You blocked this player.' : !together ? `${card.name} is not in this venue with you right now.` : !left ? `You have used today’s ${social.dailyInteractions} interactions with ${card.name}.` : ui.busy ? 'Working…' : null;
  const actions = social.playerActions.map((action) => `<button class="social-act" data-c-act="${esc(action.id)}" ${whyAct ? 'disabled' : ''}><strong>${iconFor('npc-action', action.id, action.icon)} ${esc(action.label)}</strong><small>${action.tags.map((tag) => `+${esc(tag[0].toUpperCase() + tag.slice(1))}`).join(' ')}${action.success ? ' · may flop' : ''}</small></button>`).join('');
  const whyBae = card.bae ? null : social.bae || S.me.bae ? 'You already have a Bae.' : !card.friend ? 'Become friends first.' : points < social.baeUnlock ? `Opens when you are closer (${points}/${social.baeUnlock}).` : card.baeAsked ? 'Asked. Waiting for an answer.' : null;
  const t = social.transfer;
  const whyMoney = !card.friend ? 'You can only send money to friends.' : t.earned < t.minEarned ? `Earn ${money(t.minEarned)} from paid work first (earned so far: ${money(t.earned)}).` : !t.giftsLeftToday ? `You have sent ${t.dailyCount} gifts today.` : t.leftToday < t.min ? 'You have given away all you may for now. You can only give money you earned from work.' : null;
  const friendButton = card.blocked ? '' : card.friend ? `<button class="social-btn" data-c-do="unfriend">Remove friend</button>` : card.incoming ? `<button class="social-btn is-primary" data-c-do="accept">Accept friend request</button>` : card.requested ? '<button class="social-btn" disabled>Friend request sent</button>' : '<button class="social-btn" data-c-do="friend">Add friend</button>';
  const forms = ui.form === 'money' ? `<form class="ui-card" data-c-money><label>Amount to send (₦${t.min}–₦${Math.min(t.maxPerTransfer, t.leftToday)})<input class="social-field" name="amount" inputmode="numeric" pattern="[0-9]*" maxlength="5" value="${esc(ui.amount)}" required></label><p class="social-note">Gifts are capped: ${money(t.maxPerTransfer)} each, ${t.dailyCount} a day, and never more than you have earned from work. You have ${money(state.cash)}.</p><span class="social-actions"><button class="social-btn is-primary" ${ui.busy ? 'disabled' : ''}>${ui.busy ? 'Sending…' : 'Send'}</button><button type="button" class="social-btn" data-c-form="">Cancel</button></span></form>`
    : ui.form === 'report' ? `<form class="ui-card" data-c-report><label>What is wrong?<select class="social-field" name="reason">${S.me.limits.reasons.map((reason) => `<option value="${esc(reason)}" ${ui.reason === reason ? 'selected' : ''}>${esc(reason[0].toUpperCase() + reason.slice(1).replace('-', ' '))}</option>`).join('')}</select></label><label>Details (optional)<input class="social-field" name="text" maxlength="${S.me.limits.reportText}" value="${esc(ui.text)}"></label><p class="social-note">A moderator reviews reports. You get a receipt in Messages → Updates.</p><span class="social-actions"><button class="social-btn is-primary" ${ui.busy ? 'disabled' : ''}>Send report</button><button type="button" class="social-btn" data-c-form="">Cancel</button></span></form>` : '';
  return `<div class="social-head people-who">${avatar(card.name, id, dot(card.status))}<h3>${esc(card.name)}</h3></div>
    <p>Real player · <span class="social-presence is-${esc(PRESENCE[card.status] ? card.status : 'offline')}">${esc(presenceText(card, (venue) => venueName(view, venue), view.now))}</span>${together ? ' · here with you' : ''}${card.bae ? ` · your Bae ${mark('heart')}` : card.friend ? ' · Friend' : ''}</p>
    <button class="ui-button is-primary is-block" data-open="messages" data-params="${json({ to: id, name: card.name })}" ${card.blocked ? 'disabled' : ''}>Chat</button>${card.blocked ? '<span class="social-why">Unblock this player to chat.</span>' : ''}
    <p>${rel ? closeness(rel, view) : 'Stranger · 0/5 to Acquaintance'}</p>${meterHtml(points, social.baeUnlock, `Closeness with ${card.name}`)}
    <div class="social-grid">${actions}</div>${whyAct ? `<span class="social-why">${esc(whyAct)}</span>` : ''}
    <div class="social-grid">${card.bae ? `<button class="social-act" data-c-do="bae-end"><strong>${mark('heart-off')} End things</strong><small>Stop being Bae</small></button>` : `<button class="social-act" data-c-do="bae" ${whyBae ? 'disabled' : ''}><strong>${mark('heart')} Ask to be my Bae</strong><small>${esc(whyBae || 'Ask them now')}</small></button>`}
      <button class="social-act" data-c-form="money" ${whyMoney ? 'disabled' : ''}><strong>${mark('coin')} Send money</strong><small>${esc(whyMoney || `Up to ${money(Math.min(t.maxPerTransfer, t.leftToday))} now`)}</small></button></div>
    ${forms}<span class="social-actions">${friendButton}${card.blocked ? '<button class="social-btn" data-c-do="unblock">Unblock</button>' : '<button class="social-btn is-danger" data-c-do="block">Block</button>'}<button class="social-btn is-danger" data-c-form="report">Report</button></span>
    <p class="preview-note">Blocking removes you from each other’s lists and stops messages, invites and friend requests. Closeness numbers are original beta values.</p>`;
}

const personCard = {
  id: 'person', title: 'Person', placement: 'modal',
  render(state, view) {
    const params = view.params || {};
    if (typeof params.npc === 'string') return npcCard(state, view, params.npc);
    // bind() is not given the params, so the card carries the player's id for its handlers.
    if (typeof params.player === 'string') return `<div data-c-player="${esc(params.player)}">${playerCard(state, view, params.player)}</div>`;
    return '<p class="ui-error">Nobody selected.</p>';
  },
  bind(root, api) {
    bindCommon(root, api);
    for (const node of root.querySelectorAll('[data-n-act]')) node.addEventListener('click', async () => {
      if (api.state().spot !== 'people') { const moved = await api.command('spot', { id: 'people' }); if (!moved.ok) return; }
      const result = await api.command('activity', { id: node.dataset.nAct });
      if (result.ok) api.close();
    });
    const id = root.querySelector('[data-c-player]')?.dataset.cPlayer;
    if (!id || !api.view().connected) return;
    if (ui.player !== id) { ui.player = id; ui.form = null; ui.amount = ''; ui.text = ''; S.profiles.delete(id); void loadProfile(id); void loadPeople(); }
    else if (!S.profiles.has(id)) void loadProfile(id);
    const name = () => S.profiles.get(id)?.name ?? 'this player';
    const run = async (path, body, good) => {
      ui.busy = true; api.refresh();
      const result = await perform(path, body, good);
      ui.busy = false;
      await loadProfile(id);
      return result;
    };
    root.querySelector('[data-c-reload]')?.addEventListener('click', () => { S.profiles.delete(id); void loadProfile(id); api.refresh(); });
    for (const node of root.querySelectorAll('[data-c-act]')) node.addEventListener('click', async () => {
      const result = await run(`/api/social/players/${encodeURIComponent(id)}/interact`, { action: node.dataset.cAct, cityId: cityId(), clientId: newClientId() }, (done) => done.message);
      if (result.ok) refreshLife(); else void loadPeople();
    });
    for (const node of root.querySelectorAll('[data-c-form]')) node.addEventListener('click', () => { ui.form = node.dataset.cForm || null; ui.clientId = newClientId(); api.refresh(); });
    const actions = {
      friend: () => run('/api/social/friends/request', { to: id, cityId: cityId() }, (done) => (done.code === 'accepted' ? 'You are now friends' : 'Friend request sent')),
      accept: () => run('/api/social/friends/answer', { from: id, accept: true, cityId: cityId() }, 'You are now friends'),
      unfriend: () => run('/api/social/friends/remove', { id, cityId: cityId() }, 'Removed from friends'),
      block: () => run('/api/social/block', { id, cityId: cityId() }, `Blocked ${name()}`),
      unblock: () => run('/api/social/unblock', { id }, 'Unblocked'),
      bae: () => run('/api/social/bae/ask', { id, cityId: cityId() }, 'Asked. They will see it in Updates.'),
      'bae-end': () => run('/api/social/bae/end', { cityId: cityId() }, 'Ended'),
    };
    for (const node of root.querySelectorAll('[data-c-do]')) node.addEventListener('click', async () => { await actions[node.dataset.cDo]?.(); refreshLife(); });
    const moneyForm = root.querySelector('[data-c-money]');
    moneyForm?.addEventListener('input', () => { ui.amount = new FormData(moneyForm).get('amount'); });
    moneyForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const amount = Number(ui.amount);
      if (!Number.isSafeInteger(amount) || amount <= 0) { api.toast('Enter a whole amount in naira.', 'error'); return; }
      // The client id is fixed when the form opens, so a double tap or a retry cannot send twice.
      const result = await run('/api/social/transfers', { to: id, amount, cityId: cityId(), clientId: ui.clientId }, (done) => `Sent ${money(done.amount)} to ${done.to.name}${done.duplicate ? ' (already sent)' : ''}`);
      if (result.ok || !result.transport) { ui.form = result.ok ? null : ui.form; ui.clientId = newClientId(); if (result.ok) ui.amount = ''; }
      refreshLife(); api.refresh();
    });
    const reportForm = root.querySelector('[data-c-report]');
    reportForm?.addEventListener('input', () => { const form = new FormData(reportForm); ui.reason = form.get('reason'); ui.text = form.get('text'); });
    reportForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const result = await run('/api/social/reports', { id, reason: ui.reason, text: ui.text.trim() }, (done) => `Report ${done.receipt.id} received`);
      if (result.ok) { ui.form = null; ui.text = ''; }
      api.refresh();
    });
  },
};

export default [peopleTab, personCard];
