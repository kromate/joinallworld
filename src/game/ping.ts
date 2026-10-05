/**
 * OWNER: social
 * PING: "I am here, come and join me". The numbers and the decisions that need no stored state, as pure functions, so the
 * server (server/social/ping.ts, server/growth/ping-mail.ts) and the browser (src/app/features/ping) read one module.
 * The design and the reason for every number are written down in docs/COMEBACK-MAIL.md ("Ping").
 *
 *   PING              every number, named
 *   pingMailDecision  may a ping be sent to this friend as an e-mail now? (the switches, online, night, the caps, the back-off)
 *   placeWords        "at Freedom Park, Lagos" · "at home in Lagos" — a home is never more than the city it is in
 *   nightAt           the quiet hours of comeback mail (the same clock: Lagos time)
 *
 * Nothing here reads a message, a balance or an address.
 */
import { lagosTime } from './clock.ts';

const MINUTE = 60000, HOUR = 3600000, DAY = 86400000;

export const PING = Object.freeze({
  /** A ping, and the join link made for it, is live this long. It also ends when the pinger leaves the game or cancels. */
  liveMinutes: 60,
  /** The same friend may be pinged again after this long. */
  pairMinutes: 30,
  /** Pings one player may send, to anyone: the same for every player, the founder included. */
  perHour: 10, perDay: 30,
  /** Quiet hours, Lagos time: the hours of comeback mail (COMEBACK.quietFrom / quietTo). Nothing leaves the game then. */
  quietFrom: 21, quietTo: 8,
  mail: {
    /** One friend's pings reach a player's inbox at most once in this many hours, and this many times in 24 hours. */
    pairHours: 4, pairPerDay: 2,
    /** Ping mails one player receives from everybody together, in 24 hours and in 7 days. Counted apart from the automatic mails. */
    recipientPerDay: 2, recipientPerWeek: 5,
    /** After this many ping mails from one friend with no visit since, that friend's pings are not mailed until the player has been back. */
    unansweredPerSender: 3,
    /** After this many ping mails from anybody with no visit since, none at all until the player has been back. */
    unansweredInAll: 5,
    /** Ping mails remembered per player (a week of them fits several times over). */
    kept: 24,
  },
  /** Ping notifications one player's devices are sent in 24 hours. */
  pushPerDay: 6,
  /** Journeys to another city a player may make free of charge by joining a friend, in 24 hours. The way home is paid as usual. */
  freeJoinsPerDay: 3,
  /** Pending pings kept on the server at once (the oldest go first). */
  open: 5000,
});

export const PING_LIVE_MS = PING.liveMinutes * MINUTE;
export const PING_PAIR_MS = PING.pairMinutes * MINUTE;

/** Is it night for mail (Lagos time, as for every other mail)? */
export function nightAt(now: number): boolean {
  const hour = lagosTime(now).hour;
  return hour >= PING.quietFrom || hour < PING.quietTo;
}

/** One ping mail already sent to a player: when, and which friend's ping it was. */
export interface PingMailEntry { at: number; from: string }
export interface PingMailFacts {
  now: number
  /** The friend who pinged. */
  from: string
  /** The recipient's choices, or null when they have made none (then nothing is sent). */
  prefs: { on: boolean; pausedUntil: number; friends: boolean } | null
  /** The recipient is connected to the game on some device, or was a moment ago. */
  online: boolean
  /** Ping mails already sent to the recipient, oldest first. */
  ledger: readonly PingMailEntry[]
  /** The recipient's latest sign of play (server ms). */
  lastActive: number
}
export type PingMailWhy = 'send' | 'off' | 'online' | 'night' | 'pair' | 'recipient' | 'backoff';

/**
 * May this ping go out as an e-mail now? A ping is asked for by a friend and is only worth anything in the next hour, so
 * it is not held back because the recipient played recently and it is not folded into a later mail. Everything that
 * protects the recipient still holds: their switches, never while they are in the game, never at night, and the caps.
 */
export function pingMailDecision({ now, from, prefs, online, ledger, lastActive }: PingMailFacts): PingMailWhy {
  if (!prefs || !prefs.on || !prefs.friends || prefs.pausedUntil > now) return 'off';
  if (online) return 'online';
  if (nightAt(now)) return 'night';
  const sent = ledger.filter((entry) => entry.at <= now);
  const mine = sent.filter((entry) => entry.from === from);
  if (mine.some((entry) => now - entry.at < PING.mail.pairHours * HOUR) || mine.filter((entry) => now - entry.at < DAY).length >= PING.mail.pairPerDay) return 'pair';
  if (sent.filter((entry) => now - entry.at < DAY).length >= PING.mail.recipientPerDay || sent.filter((entry) => now - entry.at < 7 * DAY).length >= PING.mail.recipientPerWeek) return 'recipient';
  const unanswered = sent.filter((entry) => entry.at > lastActive);
  if (unanswered.length >= PING.mail.unansweredInAll || unanswered.filter((entry) => entry.from === from).length >= PING.mail.unansweredPerSender) return 'backoff';
  return 'send';
}
/** The ledger with one more mail in it, bounded and without what is older than a week. */
export const pingMailNoted = (ledger: readonly PingMailEntry[], from: string, now: number): PingMailEntry[] => [...ledger.filter((entry) => now - entry.at < 7 * DAY), { at: now, from }].slice(-PING.mail.kept);

/** A value for one line of a notice or a mail: no control characters, trimmed and bounded. */
export const pingLine = (value: unknown, max: number): string => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/** Where a pinger is, in words. A home is only ever "at home in <city>": no street, no plot, no local government. */
export function placeWords(place: { home: boolean; venueLabel: string; cityName: string }): string {
  const city = pingLine(place.cityName, 40) || 'Allworld';
  return place.home ? `at home in ${city}` : `at ${pingLine(place.venueLabel, 60) || 'a place'}, ${city}`;
}

/** What the pinger is told. It never depends on whether the friend has an address or a notification: only on the clock and on whether they are in the game. */
export type PingNote = 'told' | 'later' | 'night';
export const pingNoteWords = (note: PingNote, name: string): string => (note === 'told' ? `${name} is in the game and has been told.`
  : note === 'night' ? `It is night for ${name}; they will see it when they are back.`
    : `Pinged. ${name} will see it when they are back.`);

/** "in 12 minutes" · "in 1 hour" — for "you can ping again …". */
export function waitWords(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / MINUTE));
  if (minutes < 60) return `in ${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.ceil(minutes / 60);
  return `in ${hours} hour${hours === 1 ? '' : 's'}`;
}
