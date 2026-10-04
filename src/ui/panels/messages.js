/**
 * OWNER: social
 * Messages app (Chats and Updates) and the always-visible inbox chip in the HUD stack.
 *
 * Chats: find a player and message them, conversation list with unread counts, groups
 * (create, rename, add/remove members, leave). Every message you send appears immediately as
 * "Sending…", then becomes sent, or "Not sent" with the reason and a Retry that can never
 * duplicate it. Updates is the game's one notice surface: friend requests, knocks, gifts and
 * report receipts (the server's social updates) together with what the life itself posts
 * through 'notice.posted' — rent due, paid and missed, loan payments, promotions, illness and
 * the Governor's news — newest first. Which life notices you have already seen is remembered
 * on this device only.
 * All text is escaped; nothing a player typed is ever rendered as markup or as a link.
 * The panel contract is at the top of src/ui/shell.js.
 */
import { esc, json, empty, avatar, glyph } from '../dom.js';
import { formatClock } from '../../game/clock.js';
import { S, start, bindCommon, gate, socketNote, call, perform, sync, openThread, threadView, send, retry, discard, cityId, newClientId } from './social-client.js';

const ui = { tab: 'chats', open: null, draft: '', find: '', results: null, finding: false, group: null, manage: false, focus: null };

function setOpen(key) { ui.open = key; S.openConv = key; ui.manage = false; ui.draft = ''; ui.focus = key ? 'draft' : null; }
const convOf = (key) => S.me?.conversations.find((conv) => conv.id === key) || null;
// A waiting friend or Bae request is counted once, as a request, not again as the update that announced it.
const REQUEST_KINDS = ['friend-request', 'bae-request'];
const unreadUpdates = () => (S.me?.updates || []).filter((update) => !update.read && !REQUEST_KINDS.includes(update.kind)).length;
const unreadChats = () => (S.me?.conversations || []).reduce((sum, conv) => sum + conv.unread, 0);
const time = (at) => formatClock(at).split('· ')[1] ?? '';

const NOTICE_ICONS = { 'rent-due': '🗓️', rent: '🏠', 'rent-missed': '⚠️', loan: '🏦', 'loan-missed': '⚠️', promotion: '🎉', illness: '🤒', recovered: '💪', gov: '🏛️', transfer: '💸', bae: '💞' };
const UPDATE_ICONS = { transfer: '💸', report: '🛡️', 'friend-request': '🤝', 'friend-accepted': '🤝', 'invite-knock': '🚪', 'invite-answer': '🚪', 'group-added': '👥', 'bae-request': '💞', 'bae-answer': '💞' };
const SEEN_KEY = 'joinallworld-notices-seen';
let seenAt = null;
/** Server time of the newest life notice already read on this device, per city. */
function noticesSeen(view) {
  if (seenAt === null) { try { seenAt = JSON.parse(window.localStorage.getItem(SEEN_KEY)) || {}; } catch { seenAt = {}; } }
  return Number(seenAt[view.cityId]) || 0;
}
const freshNotices = (view) => (view.social?.notices || []).filter((notice) => notice.at > noticesSeen(view)).length;
function markNoticesSeen(view) {
  const newest = Math.max(0, ...(view.social?.notices || []).map((notice) => notice.at));
  if (newest <= noticesSeen(view)) return false;
  seenAt[view.cityId] = newest;
  try { window.localStorage.setItem(SEEN_KEY, JSON.stringify(seenAt)); } catch {}
  return true;
}

/** Which app a line of Updates belongs to: where tapping it in the Phone's notification list goes. */
const NOTICE_APPS = { 'rent-due': 'bank', rent: 'bank', 'rent-missed': 'bank', loan: 'bank', 'loan-missed': 'bank', promotion: 'jobs', illness: 'health', recovered: 'health', gov: 'governor', transfer: 'statement', bae: 'people' };
const UPDATE_APPS = { transfer: 'statement', 'friend-request': 'people', 'friend-accepted': 'contacts', 'invite-knock': 'invite', 'invite-answer': 'invite', 'bae-request': 'people', 'bae-answer': 'people' };
const UPDATES_TAB = { tab: 'updates' };
/**
 * The Phone's notification list: what is waiting for an answer (knocks, friend and Bae requests)
 * and the newest Updates, each with the app it opens. Built from what is already loaded — the
 * social overview and view.social.notices — so it never fetches.
 */
function notifications(state, view) {
  if (!view.connected || !S.me) return [];
  const now = view.now, seen = noticesSeen(view);
  const lines = [];
  for (const knock of S.me.house.knocks) lines.push({ id: `knock:${knock.from.id}`, at: now, fresh: true, app: 'invite', text: `${knock.from.name} is knocking at your door` });
  for (const request of S.me.requests.in) lines.push({ id: `friend:${request.id}`, at: now - 1, fresh: true, app: 'people', text: `${request.name} wants to be friends` });
  for (const request of S.me.baeRequests) lines.push({ id: `bae:${request.id}`, at: now - 2, fresh: true, app: 'people', text: `${request.name} asked you to be their Bae` });
  for (const conv of S.me.conversations) if (conv.unread && conv.last) lines.push({ id: `chat:${conv.id}`, at: conv.last.at || now - 3, fresh: true, app: 'messages', params: { conv: conv.id }, text: `${conv.name}: ${conv.last.body}` });
  for (const update of S.me.updates) if (!REQUEST_KINDS.includes(update.kind)) lines.push({ id: `update:${update.at}:${update.kind}`, at: update.at, fresh: !update.read, app: UPDATE_APPS[update.kind] || 'messages', params: UPDATE_APPS[update.kind] ? undefined : UPDATES_TAB, text: update.text });
  for (const notice of view.social?.notices || []) lines.push({ id: `notice:${notice.id ?? notice.at}`, at: notice.at, fresh: notice.at > seen, app: NOTICE_APPS[notice.kind] || 'messages', params: NOTICE_APPS[notice.kind] ? undefined : UPDATES_TAB, text: notice.text });
  return lines;
}

function bubble(item, meId, group) {
  if (item.status) {
    const failed = item.status === 'failed';
    return `<div class="social-msg is-mine ${failed ? 'is-failed' : 'is-pending'}"><span>${esc(item.body)}</span><small>${failed ? `Not sent · ${esc(item.reason)}` : 'Sending…'}</small>${failed
      ? `<span class="social-actions"><button class="social-btn is-primary" data-m-retry="${esc(item.clientId)}">Retry</button><button class="social-btn" data-m-discard="${esc(item.clientId)}">Delete</button></span>` : ''}</div>`;
  }
  if (item.sys) return `<div class="social-msg is-sys">${esc(item.body)}</div>`;
  const mine = item.from?.id === meId;
  return `<div class="social-msg ${mine ? 'is-mine' : ''}">${group && !mine ? `<b>${esc(item.from?.name)}</b>` : ''}<span>${esc(item.body)}</span><small>${esc(time(item.at))}${mine ? ' · Sent' : ''}</small></div>`;
}

function threadHtml(view) {
  const key = ui.open, conv = convOf(key), meId = S.me.me.id;
  const houseHost = key.startsWith('h.') ? key.slice(2) : null;
  const endedVisit = houseHost && houseHost !== meId && S.me.visiting?.host.id !== houseHost;
  const readOnly = !view.connected ? 'Not connected: messages cannot be sent right now.' : endedVisit ? 'Your visit has ended. Knock again to join the house chat.' : null;
  const title = conv?.name ?? ui.openName ?? (houseHost ? 'House chat' : 'New chat');
  const thread = S.threads.get(key);
  const items = threadView(key);
  const group = conv && conv.kind !== 'dm';
  const friends = S.me.friends.filter((friend) => !conv?.members.some((member) => member.id === friend.id));
  const manage = conv?.kind === 'group' && ui.manage ? `<div class="ui-card msg-manage"><p>${conv.members.map((member) => `${esc(member.name)}${member.id === conv.owner ? ' (runs the group)' : ''}${conv.owner === meId && member.id !== meId ? ` <button class="social-link" data-m-group="${json({ op: 'remove', id: member.id })}">Remove</button>` : ''}`).join(' · ')}</p>${conv.owner === meId
    ? `<form class="social-form" data-m-rename><input name="name" maxlength="${S.me.limits.groupName}" value="${esc(conv.name)}" aria-label="Group name" required><button class="social-btn">Rename</button></form>${friends.length && conv.members.length < S.me.limits.groupSize
      ? `<p>${friends.map((friend) => `<button class="social-btn" data-m-group="${json({ op: 'add', id: friend.id })}">+ ${esc(friend.name)}</button>`).join(' ')}</p>` : `<p class="social-note">${conv.members.length >= S.me.limits.groupSize ? `This group is full (${S.me.limits.groupSize} people).` : 'Only your friends can be added, and all of them are already here.'}</p>`}`
    : '<p class="social-note">Only the person who runs the group can rename it or change members.</p>'}<button class="social-btn is-danger" data-m-group="${json({ op: 'leave' })}">Leave group</button></div>` : '';
  const body = !thread?.loaded && conv ? (thread?.error ? `<p class="social-note is-warn">${esc(thread.error)} <button class="social-link" data-m-reload>Retry</button></p>` : '<p class="social-note">Loading messages…</p>')
    : items.length ? items.map((item) => bubble(item, meId, group)).join('') : '<p class="social-note">No messages yet. Say something.</p>';
  const face = conv?.kind === 'group' ? '<span class="ui-avatar is-group" aria-hidden="true">👥</span>' : houseHost ? '<span class="ui-avatar is-group" aria-hidden="true">🏠</span>' : avatar(title, conv?.with ?? key);
  return `<div class="msg-chat"><div class="msg-head"><button class="msg-back" data-m-back aria-label="Back to chats">${glyph('back')}</button>${face}<h3>${esc(title)}<small>${conv?.kind === 'group' ? `${conv.members.length} people` : conv?.kind === 'house' ? 'House chat' : 'Direct message'}</small></h3>${conv?.kind === 'group' ? `<button class="social-btn" data-m-manage>${ui.manage ? 'Done' : 'Members'}</button>` : ''}</div>
    ${conv?.kind === 'house' ? '<p class="social-note msg-info">House chat: only the host and the guests inside can read this.</p>' : ''}${manage}
    <div class="social-thread" data-m-thread aria-live="polite">${body}</div>
    <div class="msg-foot">${readOnly ? `<span class="social-why">${esc(readOnly)}</span>` : ''}<form class="msg-compose" data-m-compose><input name="body" maxlength="${S.me.limits.body}" autocomplete="off" placeholder="Message" aria-label="Message" value="${esc(ui.draft)}" required ${readOnly ? 'disabled' : ''}><button aria-label="Send" title="Send" ${readOnly ? 'disabled' : ''}>${glyph('earn')}</button></form></div></div>`;
}

function chatsHtml() {
  const convs = S.me.conversations;
  const row = (conv) => `<button class="ui-row msg-conv${conv.unread ? ' is-unread' : ''}" data-m-open="${esc(conv.id)}">${conv.kind === 'group' ? '<span class="ui-avatar is-group" aria-hidden="true">👥</span>' : conv.kind === 'house' ? '<span class="ui-avatar is-group" aria-hidden="true">🏠</span>' : avatar(conv.name, conv.with ?? conv.id)}<span class="ui-row-body"><b>${esc(conv.name)}</b><small>${conv.last ? `${conv.last.from ? `${esc(conv.last.from.id === S.me.me.id ? 'You' : conv.last.from.name)}: ` : ''}${esc(conv.last.body)}` : 'No messages yet'}</small></span><span class="ui-row-end msg-when">${conv.last?.at ? `<small>${esc(time(conv.last.at))}</small>` : ''}${conv.unread ? `<span class="social-badge" aria-label="${conv.unread} unread">${conv.unread}</span>` : ''}</span></button>`;
  const results = ui.finding ? '<p class="social-note">Searching…</p>' : ui.results === null ? '' : ui.results.error ? `<p class="social-note is-warn">${esc(ui.results.error)}</p>`
    : ui.results.length ? `<div class="ui-rows">${ui.results.map((player) => `<div class="ui-row">${avatar(player.name, player.id)}<span class="ui-row-body"><b>${esc(player.name)}</b><small>Real player${player.friend ? ' · Friend' : ''} · #${esc(player.id.slice(0, 6))}</small></span><span class="ui-row-end"><button class="social-btn is-primary" data-m-new="${json({ id: player.id, name: player.name })}">Message</button></span></div>`).join('')}</div>`
      : '<p class="social-note">Nobody found with that name. Players appear here once they have opened the game.</p>';
  const group = ui.group ? `<form class="ui-card" data-m-newgroup><input class="social-field" name="name" maxlength="${S.me.limits.groupName}" placeholder="Group name" aria-label="Group name" value="${esc(ui.group.name)}" required>
      ${S.me.friends.length ? `<div class="social-checks">${S.me.friends.map((friend) => `<label><input type="checkbox" name="member" value="${esc(friend.id)}" ${ui.group.members.includes(friend.id) ? 'checked' : ''}> ${esc(friend.name)}</label>`).join('')}</div>` : '<p class="social-note">Groups are for friends. Add a friend first, then create a group.</p>'}
      <p class="social-note">Up to ${S.me.limits.groupSize} people including you.</p><span class="social-actions"><button class="social-btn is-primary" ${S.me.friends.length ? '' : 'disabled'}>Create group</button><button type="button" class="social-btn" data-m-groupcancel>Cancel</button></span>${S.me.friends.length ? '' : '<span class="social-why">You need at least one friend to create a group.</span>'}</form>` : '';
  return `<form class="social-form is-search" data-m-find><input name="q" maxlength="36" placeholder="Find a player by name" aria-label="Find a player by name" value="${esc(ui.find)}" autocomplete="off"><button class="social-btn">Find</button></form>${results}
    <div class="social-head"><h3 class="ui-section">Chats</h3>${ui.group ? '' : '<button class="social-btn" data-m-groupnew>New group</button>'}</div>${group}
    ${convs.length ? `<div class="ui-rows">${convs.map(row).join('')}</div>` : empty('💬', 'No chats yet', 'Find a player by name above, or tap someone at a venue and press Chat.', '<button class="ui-button" data-open="people">See who is here</button>')}`;
}

function updatesHtml(view) {
  const requests = S.me.requests.in.map((request) => `<div class="social-row is-ask">${avatar(request.name, request.id)}<div><strong>${esc(request.name)}</strong><small>wants to be friends</small></div><span class="social-actions"><button class="social-btn is-primary" data-m-friend="${json({ from: request.id, accept: true })}">Accept</button><button class="social-btn" data-m-friend="${json({ from: request.id, accept: false })}">Decline</button></span></div>`).join('');
  const bae = S.me.baeRequests.map((request) => `<div class="social-row is-ask"><span class="social-avatar" aria-hidden="true">💞</span><div><strong>${esc(request.name)}</strong><small>asked you to be their Bae</small></div><span class="social-actions"><button class="social-btn is-primary" data-m-bae="${json({ from: request.id, accept: true })}">Yes</button><button class="social-btn" data-m-bae="${json({ from: request.id, accept: false })}">Not now</button></span></div>`).join('');
  const knocks = S.me.house.knocks.length ? `<div class="social-row is-ask"><span class="social-avatar" aria-hidden="true">🚪</span><div><strong>${esc(S.me.house.knocks.map((knock) => knock.from.name).join(', '))}</strong><small>knocking at your door</small></div><span class="social-actions"><button class="social-btn is-primary" data-open="invite">Answer</button></span></div>` : '';
  const seen = ui.noticesSeenBefore ?? noticesSeen(view);
  const lines = [...S.me.updates.map((update) => ({ at: update.at, text: update.text, fresh: !update.read, icon: UPDATE_ICONS[update.kind] || '🔔' })),
    ...(view.social?.notices || []).map((notice) => ({ at: notice.at, text: notice.text, fresh: notice.at > seen, icon: NOTICE_ICONS[notice.kind] || '📣' }))].sort((a, b) => b.at - a.at);
  const asks = requests || bae || knocks ? `<h3 class="ui-section">Waiting for you</h3><div class="social-list">${requests}${bae}${knocks}</div>` : '';
  return `${asks}${lines.length ? `${asks ? '<h3 class="ui-section">Earlier</h3>' : ''}<div class="ui-rows">${lines.map((line) => `<div class="ui-row msg-update${line.fresh ? ' is-unread' : ''}"><span class="ui-row-icon is-round" aria-hidden="true">${line.icon}</span><span class="ui-row-body"><b>${esc(line.text)}</b><small>${esc(formatClock(line.at))}${line.fresh ? ' · New' : ''}</small></span></div>`).join('')}</div>`
    : asks ? '' : empty('🔔', 'Nothing yet', 'Friend requests, knocks at your door, gifts, rent and loan notices, promotions, illness and news from the Governor appear here.')}`;
}

const chip = {
  id: 'social-inbox', title: 'Inbox', icon: '✉️', placement: 'hud', order: 30,
  /** Someone at the door cannot wait in the tray: a knock is shown as an alert. */
  slot: (state, view) => (view.connected && S.me?.house.knocks?.length ? 'alert' : 'hud'),
  render(state, view) {
    if (!view.connected) return '<button class="life-job" disabled><span>✉️</span><div><strong>Messages</strong><small>Not connected</small></div></button>';
    const knocks = S.me?.house.knocks || [];
    if (knocks.length) return `<button class="life-job is-active" data-open="invite"><span>🚪</span><div><strong>${esc(knocks[0].from.name)} is knocking</strong><small>Let them in or not now</small></div></button>`;
    const chats = unreadChats(), updates = unreadUpdates() + (S.me?.requests.in.length || 0) + freshNotices(view);
    if (view.onboarding?.required) return '';
    const hint = !S.me ? (S.error ? 'Could not load · tap to retry' : 'Loading…') : chats || updates ? [chats ? `${chats} unread` : '', updates ? `${updates} update${updates === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ') : 'No new messages';
    return `<button class="life-job ${chats || updates ? 'is-active' : ''}" data-open="messages"><span>✉️</span><div><strong>Messages</strong><small>${esc(hint)}</small></div></button>`;
  },
  bind(root, api) { start(api); },
};

const app = {
  id: 'messages', title: 'Messages', icon: '✉️', placement: 'phone', order: 12, group: 'people',
  /** Unread chats plus unread Updates. Requests and knocks are counted on People and Invite, where they are answered. */
  badge: (state, view) => (view.connected && S.me ? unreadChats() + unreadUpdates() + freshNotices(view) : 0),
  notifications,
  render(state, view) {
    // Opened from a person card or contact: api.open('messages', { to, name } | { conv }).
    const params = view.params;
    if (params && params !== ui.params) {
      ui.params = params;
      if (params.tab === 'updates' || params.tab === 'chats') { setOpen(null); ui.tab = params.tab; }
      else if (params.conv) setOpen(params.conv);
      else if (params.to) { const existing = S.me?.conversations.find((conv) => conv.with === params.to); setOpen(existing ? existing.id : `to:${params.to}`); ui.openName = params.name; ui.tab = 'chats'; }
    }
    const blocked = gate(view);
    if (blocked) return blocked;
    if (S.openConv !== ui.open) ui.open = S.openConv; // a new chat received its real conversation id
    if (ui.open) return `${socketNote()}${threadHtml(view)}`;
    const chats = unreadChats(), updates = unreadUpdates() + S.me.requests.in.length + S.me.baeRequests.length + freshNotices(view);
    return `${socketNote()}<div class="ui-seg" role="tablist"><button role="tab" aria-selected="${ui.tab === 'chats'}" class="${ui.tab === 'chats' ? 'is-selected' : ''}" data-m-tab="chats">Chats${chats ? `<span class="social-badge">${chats}</span>` : ''}</button><button role="tab" aria-selected="${ui.tab === 'updates'}" class="${ui.tab === 'updates' ? 'is-selected' : ''}" data-m-tab="updates">Updates${updates ? `<span class="social-badge">${updates}</span>` : ''}</button></div>${ui.tab === 'chats' ? chatsHtml() : updatesHtml(view)}`;
  },
  /** Esc inside a conversation goes back to the list first; the next Esc leaves the app. */
  keys(action, api) {
    if (action !== 'cancel' || !ui.open) return false;
    setOpen(null); void sync(); api.refresh();
    return true;
  },
  bind(root, api) {
    bindCommon(root, api);
    // Reading the Updates tab marks the life's notices as seen; the ones that were new stay marked "New" while it is open.
    if (ui.tab === 'updates' && !ui.open && S.me) { if (ui.noticesSeenBefore === undefined) ui.noticesSeenBefore = noticesSeen(api.view()); markNoticesSeen(api.view()); } else ui.noticesSeenBefore = undefined;
    const on = (selector, event, handler) => { for (const node of root.querySelectorAll(selector)) node.addEventListener(event, handler); };
    const data = (event, key) => JSON.parse(event.currentTarget.dataset[key]);
    if (ui.open && !ui.open.startsWith('to:') && !S.threads.get(ui.open)?.loaded && !S.threads.get(ui.open)?.error && S.me) void openThread(ui.open);
    const thread = root.querySelector('[data-m-thread]');
    if (thread) thread.scrollTop = thread.scrollHeight;
    const field = root.querySelector('[data-m-compose] input');
    if (field && ui.focus === 'draft') { field.focus(); field.setSelectionRange(field.value.length, field.value.length); }
    field?.addEventListener('input', () => { ui.draft = field.value; });
    field?.addEventListener('blur', () => { ui.focus = null; });
    field?.addEventListener('focus', () => { ui.focus = 'draft'; });
    on('[data-m-tab]', 'click', (event) => { ui.tab = event.currentTarget.dataset.mTab; if (ui.tab === 'updates' && (S.me?.updates || []).some((update) => !update.read)) void call('/api/social/updates/read', {}).then(sync); api.refresh(); });
    on('[data-m-open]', 'click', (event) => { setOpen(event.currentTarget.dataset.mOpen); void openThread(ui.open); api.refresh(); });
    on('[data-m-back]', 'click', () => { setOpen(null); void sync(); api.refresh(); });
    on('[data-m-reload]', 'click', () => { S.threads.get(ui.open).error = null; void openThread(ui.open); });
    on('[data-m-manage]', 'click', () => { ui.manage = !ui.manage; api.refresh(); });
    on('[data-m-retry]', 'click', (event) => retry(event.currentTarget.dataset.mRetry));
    on('[data-m-discard]', 'click', (event) => discard(event.currentTarget.dataset.mDiscard));
    on('[data-m-compose]', 'submit', (event) => {
      event.preventDefault();
      const body = ui.draft.trim();
      if (!body) return;
      ui.draft = ''; ui.focus = 'draft';
      send(ui.open, ui.open.startsWith('to:') ? { to: ui.open.slice(3) } : { conv: ui.open }, body);
    });
    on('[data-m-find]', 'submit', async (event) => {
      event.preventDefault();
      ui.find = new FormData(event.currentTarget).get('q').trim();
      if (ui.find.length < 2) { ui.results = { error: 'Type at least two letters of their name.' }; api.refresh(); return; }
      ui.finding = true; api.refresh();
      const result = await call(`/api/social/search?q=${encodeURIComponent(ui.find)}`);
      ui.finding = false; ui.results = result.ok ? result.results : { error: result.reason };
      api.refresh();
    });
    on('[data-m-new]', 'click', (event) => { const player = data(event, 'mNew'); const existing = S.me.conversations.find((conv) => conv.with === player.id); setOpen(existing ? existing.id : `to:${player.id}`); ui.openName = player.name; ui.results = null; ui.find = ''; if (existing) void openThread(existing.id); api.refresh(); });
    on('[data-m-groupnew]', 'click', () => { ui.group = { name: '', members: [], clientId: newClientId() }; api.refresh(); });
    on('[data-m-groupcancel]', 'click', () => { ui.group = null; api.refresh(); });
    on('[data-m-newgroup]', 'input', (event) => { const form = new FormData(event.currentTarget); ui.group.name = form.get('name'); ui.group.members = form.getAll('member'); });
    on('[data-m-newgroup]', 'submit', async (event) => {
      event.preventDefault();
      const result = await perform('/api/social/groups', { name: ui.group.name, members: ui.group.members, clientId: ui.group.clientId }, 'Group created');
      if (result.ok) { ui.group = null; setOpen(result.conv.id); void openThread(result.conv.id); }
      api.refresh();
    });
    on('[data-m-rename]', 'submit', async (event) => { event.preventDefault(); await perform(`/api/social/groups/${encodeURIComponent(ui.open)}`, { op: 'rename', name: new FormData(event.currentTarget).get('name') }); void openThread(ui.open); });
    on('[data-m-group]', 'click', async (event) => {
      const body = data(event, 'mGroup'), key = ui.open;
      const result = await perform(`/api/social/groups/${encodeURIComponent(key)}`, body);
      if (result.ok && body.op === 'leave') { S.threads.delete(key); setOpen(null); api.refresh(); } else void openThread(key);
    });
    on('[data-m-friend]', 'click', async (event) => { const body = data(event, 'mFriend'); await perform('/api/social/friends/answer', { ...body, cityId: cityId() }, body.accept ? 'You are now friends' : null); });
    on('[data-m-bae]', 'click', async (event) => { const body = data(event, 'mBae'); await perform('/api/social/bae/answer', { ...body, cityId: cityId() }); });
  },
};

export default [chip, app];
