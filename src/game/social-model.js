/**
 * OWNER: social
 * Pure client-side model for Messages and People: the outbox that takes a message from
 * pending to sent or failed (and retries it under the SAME client id, so the server can never
 * store it twice), merging of server messages, and the words used for presence.
 * No DOM, no network, no clock other than the `now` passed in — tested in social.test.js.
 */

export const SEND_TIMEOUT_MS = 12000;
export const FAILURE_TEXT = 'No answer from the server. Check your connection and retry.';

/** Insert or replace server messages by sequence number; result is ordered and free of duplicates. */
export function mergeMessages(existing, incoming) {
  const bySeq = new Map((existing || []).map((message) => [message.seq, message]));
  for (const message of incoming || []) if (message && Number.isSafeInteger(message.seq)) bySeq.set(message.seq, message);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

/**
 * Outbox of messages the server has not confirmed yet.
 *   add(key, body, clientId, now)  → entry { clientId, key, body, at, status: 'pending', tries: 1 }
 *   confirm(clientId)              the server stored it (first time or as a duplicate): drop the entry
 *   fail(clientId, reason, code)   keep it, marked failed, with the reason and a Retry
 *   retry(clientId, now)           → the same entry, pending again, same clientId; null if unknown or not failed
 *   expire(now)                    pending entries older than SEND_TIMEOUT_MS become failed
 *   thread(key, serverMessages)    server messages followed by this conversation's unconfirmed entries;
 *                                  an entry whose clientId the server already shows is dropped, never doubled
 */
export function createOutbox() {
  const entries = new Map();
  return {
    add(key, body, clientId, now) {
      const entry = { clientId, key, body, at: now, status: 'pending', tries: 1, reason: null, code: null };
      entries.set(clientId, entry);
      return entry;
    },
    get: (clientId) => entries.get(clientId) || null,
    confirm(clientId) { return entries.delete(clientId); },
    fail(clientId, reason = FAILURE_TEXT, code = 'failed') {
      const entry = entries.get(clientId);
      if (!entry) return null;
      Object.assign(entry, { status: 'failed', reason, code });
      return entry;
    },
    retry(clientId, now) {
      const entry = entries.get(clientId);
      if (!entry || entry.status !== 'failed') return null;
      Object.assign(entry, { status: 'pending', reason: null, code: null, at: now, tries: entry.tries + 1 });
      return entry;
    },
    discard(clientId) { return entries.delete(clientId); },
    expire(now) {
      let changed = false;
      for (const entry of entries.values()) if (entry.status === 'pending' && now - entry.at >= SEND_TIMEOUT_MS) { Object.assign(entry, { status: 'failed', reason: FAILURE_TEXT, code: 'timeout' }); changed = true; }
      return changed;
    },
    /** Move entries filed under a provisional key (a new chat) to the real conversation id. */
    rekey(from, to) { for (const entry of entries.values()) if (entry.key === from) entry.key = to; },
    thread(key, serverMessages) {
      const confirmed = new Set((serverMessages || []).map((message) => message.clientId).filter(Boolean));
      for (const id of confirmed) entries.delete(id);
      return [...(serverMessages || []), ...[...entries.values()].filter((entry) => entry.key === key).sort((a, b) => a.at - b.at)];
    },
    size: () => entries.size,
  };
}

/** One definition of each presence word, used everywhere a player's status is shown. */
export const PRESENCE = Object.freeze({
  online: { label: 'Online', dot: 'on', hint: 'Connected and in a venue right now.' },
  away: { label: 'Away', dot: 'away', hint: 'Connected, but travelling or between places.' },
  reconnecting: { label: 'Reconnecting…', dot: 'wait', hint: 'Their connection dropped a moment ago. They may be back within seconds.' },
  offline: { label: 'Offline', dot: 'off', hint: 'Not connected.' },
});

/** How long ago a server time was, from the server's `now`: "just now", "5 min ago", "3 h ago", "2 days ago". */
export function agoText(at, now) {
  const minutes = Math.floor(Math.max(0, now - at) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} h ago`;
  const days = Math.floor(minutes / 1440);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/**
 * "Online · Freedom Park", "Online · at home", "Online · visiting a friend", "Away", "Reconnecting…",
 * "Offline". Given the server's `now`, an offline player whose listing carries `seenAt` (the time
 * their last connection closed) reads "Offline · last seen 5 min ago".
 */
export function presenceText(person, venueName = (id) => id, now = null) {
  const entry = PRESENCE[person?.status] || PRESENCE.offline;
  if (entry === PRESENCE.offline && Number.isFinite(person?.seenAt) && Number.isFinite(now)) return `${entry.label} · last seen ${agoText(person.seenAt, now)}`;
  if (person?.status !== 'online' || !person.venue) return entry.label;
  return `${entry.label} · ${person.venue === 'home' ? 'at home' : person.venue === 'visit' ? 'visiting a friend' : venueName(person.venue)}`;
}

/** The line above the people list: what the count means and why it may be empty. */
export function roomSummary(list, venueName) {
  if (!list) return 'Checking who is here…';
  if (list.venue === 'home') return list.count ? `${list.count} guest${list.count === 1 ? '' : 's'} in your home` : 'Your home is private. Only guests you let in appear here.';
  if (list.self === 'travelling') return 'You are on the move. People appear when you arrive.';
  if (list.self === 'not_joined') return `Connecting you to ${venueName}… other players cannot see you here yet.`;
  return `${list.count} other player${list.count === 1 ? '' : 's'} here — the same people who see this venue’s chat.`;
}

/** A house-invite id from a pasted link (`…/v/<id>`, `?v=<id>`) or a bare id; null if there is none. */
export function inviteIdFrom(text) {
  const match = /(?:\/v\/|[?&](?:v|join)=|^)([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?:[/?#&]|$)/i.exec(String(text ?? '').trim());
  return match ? match[1].toLowerCase() : null;
}
