/**
 * OWNER: social
 * Pure client-side model for Messages and People: the outbox that takes a message from
 * pending to sent or failed (and retries it under the SAME client id, so the server can never
 * store it twice), merging of server messages, and the words used for presence.
 * No DOM, no network, no clock other than the `now` passed in — tested in social.test.ts.
 */
import type {
  ConversationId, KnockState, Message, OutboxEntry, PeopleListing, PersonCard, PresenceStatus, SocialOverview, ThreadItem,
} from '../types/social.ts';
import { freshLive } from './live-model.ts';
import type { LiveTable } from './live-model.ts';

export const SEND_TIMEOUT_MS = 12000;
export const FAILURE_TEXT = 'No answer from the server. Check your connection and retry.';

/** Insert or replace server messages by sequence number; result is ordered and free of duplicates. */
export function mergeMessages<M extends Pick<Message, 'seq'> & { version?: number }>(existing: readonly M[] | null | undefined, incoming: readonly (M | null | undefined)[] | null | undefined): M[] {
  const bySeq = new Map<number, M>((existing || []).map((message) => [message.seq, message]));
  for (const message of incoming || []) if (message && Number.isSafeInteger(message.seq) && (message.version ?? 0) >= (bySeq.get(message.seq)?.version ?? 0)) bySeq.set(message.seq, message);
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
export interface Outbox {
  /** Forget everything (the device session changed: these were another identity's messages). */
  clear(): void
  add(key: string, body: string, clientId: string, now: number): OutboxEntry
  get(clientId: string): OutboxEntry | null
  confirm(clientId: string): boolean
  fail(clientId: string, reason?: string, code?: string): OutboxEntry | null
  retry(clientId: string, now: number): OutboxEntry | null
  discard(clientId: string): boolean
  expire(now: number): boolean
  /** Move entries filed under a provisional key (a new chat) to the real conversation id. */
  rekey(from: string, to: string): void
  thread(key: string, serverMessages: readonly Message[] | null | undefined): ThreadItem[]
  size(): number
}
export function createOutbox(): Outbox {
  const entries = new Map<string, OutboxEntry>();
  return {
    /** Forget everything (the device session changed: these were another identity's messages). */
    clear() { entries.clear(); },
    add(key, body, clientId, now) {
      const entry: OutboxEntry = { clientId, key, body, at: now, status: 'pending', tries: 1, reason: null, code: null };
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
      const confirmed = new Set((serverMessages || []).map((message) => message.clientId).filter((id): id is string => Boolean(id)));
      for (const id of confirmed) entries.delete(id);
      return [...(serverMessages || []), ...[...entries.values()].filter((entry) => entry.key === key).sort((a, b) => a.at - b.at)];
    },
    size: () => entries.size,
  };
}

/** One definition of each presence word, used everywhere a player's status is shown. */
/** One presence word: what it says, the dot class and the hint. */
export interface PresenceEntry {
  label: string
  dot: string
  hint: string
}
export const PRESENCE: Readonly<Record<PresenceStatus, PresenceEntry>> = Object.freeze({
  online: { label: 'Online', dot: 'on', hint: 'Connected and in a venue right now.' },
  away: { label: 'Away', dot: 'away', hint: 'Connected, but travelling or between places.' },
  reconnecting: { label: 'Reconnecting…', dot: 'wait', hint: 'Their connection dropped a moment ago. They may be back within seconds.' },
  offline: { label: 'Offline', dot: 'off', hint: 'Not connected.' },
});

/** How long ago a server time was, from the server's `now`: "just now", "5 min ago", "3 h ago", "2 days ago". */
export function agoText(at: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - at) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} h ago`;
  const days = Math.floor(minutes / 1440);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

// What a person's status and a room read as in words are in ./social-lines.ts: only the people screens read them.

/** A house-invite id from a pasted link (`…/v/<id>`, `?v=<id>`) or a bare id; null if there is none. */
export function inviteIdFrom(text: unknown): string | null {
  const match = /(?:\/v\/|[?&](?:v|join)=|^)([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?:[/?#&]|$)/i.exec(String(text ?? '').trim());
  return match?.[1]?.toLowerCase() ?? null; // group 1 always takes part in a match
}

/**
 * The social state of a browser that knows nobody yet: what the social client starts with, and what it goes back to when
 * the device session changes (a new life, an expired one) — so a new identity can never be shown the previous one's friends,
 * requests, threads, profiles, knocks or house room, not even for the moment before the first answer arrives.
 */
/** One conversation as the social client holds it. */
export interface ThreadRecord {
  messages: Message[]
  loaded: boolean
  error: string | null
}
/** What the social client keeps about one person: their card, or why it could not be had. */
export type ProfileRecord = PersonCard | { error: string };
/** The social client's state. */
export interface SocialClientState {
  me: SocialOverview | null
  loading: boolean
  error: string | null
  people: PeopleListing | null
  peopleAt: number
  peopleLoading: boolean
  threads: Map<ConversationId, ThreadRecord>
  profiles: Map<string, ProfileRecord>
  openConv: ConversationId | null
  knock: KnockState | null
  /** While this socket is in a host's Home room as a guest. */
  houseRoom: { host: string; members: { id: string; name: string }[] } | null
  /** Where friends are right now, from the live frames (live-model.ts). */
  live: LiveTable
}

export const freshSocial = (): SocialClientState => ({ me: null, loading: false, error: null, people: null, peopleAt: 0, peopleLoading: false,
  threads: new Map(), profiles: new Map(), openConv: null, knock: null, houseRoom: null, live: freshLive() });
