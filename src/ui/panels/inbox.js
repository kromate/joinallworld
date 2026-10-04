/**
 * OWNER: social
 * The inbox chip in the HUD, and what the Messages app shows on the Phone before its code is here:
 * the unread badge and the lines of the Phone's notification list. This file is in the first
 * download; the Messages app itself (./messages.js — chats, groups, Updates) is fetched with the
 * social panel group the first time it is opened.
 * The panel contract is at the top of src/ui/shell.js.
 */
import { esc, mark } from '../dom.js';
import { linkWords } from '../link.js';
import { S, start } from './social-client.js';

// A waiting friend or Bae request is counted once, as a request, not again as the update that announced it.
export const REQUEST_KINDS = ['friend-request', 'bae-request'];
export const unreadUpdates = () => (S.me?.updates || []).filter((update) => !update.read && !REQUEST_KINDS.includes(update.kind)).length;
export const unreadChats = () => (S.me?.conversations || []).reduce((sum, conv) => sum + conv.unread, 0);

const SEEN_KEY = 'joinallworld-notices-seen';
let seenAt = null;
/** Server time of the newest life notice already read on this device, per city. */
export function noticesSeen(view) {
  if (seenAt === null) { try { seenAt = JSON.parse(window.localStorage.getItem(SEEN_KEY)) || {}; } catch { seenAt = {}; } }
  return Number(seenAt[view.cityId]) || 0;
}
export const freshNotices = (view) => (view.social?.notices || []).filter((notice) => notice.at > noticesSeen(view)).length;
export function markNoticesSeen(view) {
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
export function notifications(state, view) {
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


const chip = {
  id: 'social-inbox', title: 'Inbox', icon: 'messages', placement: 'hud', order: 30,
  /** Someone at the door cannot wait in the tray: a knock is shown as an alert. */
  slot: (state, view) => (view.connected && S.me?.house.knocks?.length ? 'alert' : 'hud'),
  render(state, view) {
    if (!view.connected) return `<button class="life-job" disabled><span aria-hidden="true">${mark('messages')}</span><div><strong>Messages</strong><small>${esc(linkWords(view)?.short || 'Not connected')}</small></div></button>`;
    const knocks = S.me?.house.knocks || [];
    if (knocks.length) return `<button class="life-job is-active" data-open="invite"><span aria-hidden="true">${mark('invite')}</span><div><strong>${esc(knocks[0].from.name)} is knocking</strong><small>Let them in or not now</small></div></button>`;
    const chats = unreadChats(), updates = unreadUpdates() + (S.me?.requests.in.length || 0) + freshNotices(view);
    if (view.onboarding?.required) return '';
    const hint = !S.me ? (S.error ? 'Could not load · tap to retry' : 'Loading…') : chats || updates ? [chats ? `${chats} unread` : '', updates ? `${updates} update${updates === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ') : 'No new messages';
    return `<button class="life-job ${chats || updates ? 'is-active' : ''}" data-open="messages"><span aria-hidden="true">${mark('messages')}</span><div><strong>Messages</strong><small>${esc(hint)}</small></div></button>`;
  },
  bind(root, api) { start(api); },
};

/** Unread chats plus unread Updates. Requests and knocks are counted on People and Invite, where they are answered. */
export const messagesBadge = (state, view) => (view.connected && S.me ? unreadChats() + unreadUpdates() + freshNotices(view) : 0);

export default [chip];
