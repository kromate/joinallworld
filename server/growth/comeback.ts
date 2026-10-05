/**
 * OWNER: growth
 * Comeback mail: the schedule, the claim, the preferences and the nudge. The rules and the words are pure and tested on
 * their own (src/game/comeback.ts, src/game/comeback-words.ts, ./email/comeback.ts); this file gathers the facts from
 * stored state, asks the rules, claims the answer in a saved transaction and hands the mail to the sender in
 * ./outreach.ts. Design and numbers: docs/COMEBACK-MAIL.md.
 *
 * STORED  growth.comeback  { [publicId]: ComebackRecord }   choices, what was sent, when to look next (no address)
 *         growth.comebackStats  { [lagosDay]: { [type]: counters } }   14 days; no address, name or id
 *         growth.players[id].nudged  { [friendId]: ms }   friends this player nudged, 7 days
 *
 * COST. A tick does nothing at all (no read, no write) when the mailer is not configured, or when no record is due:
 * `wakeAt` is held in memory, set from the records' own `next` times, and moved forward by every change (a confirmed
 * address, a preference, a nudge). When a tick has work it reads the growth collection once, looks at the due records
 * only (at most LIMITS.examine), reads the lives of those players and sends at most LIMITS.batch mails.
 *
 * A FRIEND JOINED THROUGH THE PLAYER'S LINK. The social module tells the inviter in the game (an update of kind
 * 'invite-joined') and raises 'invite-joined'; the inviter is then looked at at once. While that update is unread it
 * is one of the things waiting for them (a Friends mail, under the same caps, quiet hours and switches), and the one
 * thing that may be mailed to a player who was active moments ago — though never while they are connected
 * (COMEBACK.join in src/game/comeback.ts). Before this, a friend joining was not a reason for any mail.
 *
 * EXACTLY ONCE. The chosen mail is claimed in the same transaction that decided it (the ledger, the type's last time,
 * the milestone key, the next check). A crash, a provider failure, a second tick or a restart after that can only skip
 * a mail, never send it twice. The transaction is durable before anything is sent.
 */
import { viewLife } from '../../src/life.ts';
import { lagosDayStart, lagosTime } from '../../src/game/clock.ts';
import { upcomingEvents } from '../../src/game/calendar.ts';
import { composeDigest } from '../../src/game/digest.ts';
import { governorAt, phaseAt } from '../civic/elections.ts';
import { UUID_PATTERN } from '../protocol.ts';
import { COMEBACK, NEVER, PREF_KEYS, PREF_OF, decide, defaultPrefs, firstName, milestoneFacts, remember } from '../../src/game/comeback.ts';
import { comebackMail } from './email/comeback.ts';
import { PING } from '../../src/game/ping.ts';
import { growthOf, playerOf } from './data.ts';
import { maskEmail } from '../../src/game/outreach.ts';
import { cityName } from '../../src/game/cities/index.ts';
import { mailRecipientOf } from './recipient.ts';
import { autoFriend, friendsIn } from '../social/founder.ts';
import { presenceOf } from '../social/presence.ts';
import type { AccountOf, MailRecipient } from './recipient.ts';
import type { ComebackType, Facts, LedgerType, Memory, MilestoneInput, NudgeItem, Plan, PrefKey, Prefs, WaitingItem } from '../../src/game/comeback.ts';
import type { ComebackCounters, ComebackView } from '../../src/types/growth.ts';
import type { CityId } from '../../src/types/protocol.ts';
import type { LifeState } from '../../src/types/life.ts';
import type { ComebackRecord, ComebackStats, Db, GrowthCollection, RouteContext, SessionRecord } from '../types.ts';
import type { MailMessage } from './email/zeptomail.ts';

export const LIMITS = Object.freeze({ batch: 25, examine: 100, tickMs: 60000, statDays: 14, nudged: 50 });
const HOUR = 3600000, DAY = 86400000;
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const no = <Code extends string>(code: Code, reason: string): { ok: false; code: Code; reason: string } => ({ ok: false, code, reason });
export const NUDGE_NOTE = 'We’ll let them know if they’ve asked for e-mails.';
const STAT_FIELDS = ['queued', 'sent', 'failed', 'suppressed', 'unsubscribed'] as const;

/** The stored life a mail is about: the city played most recently. */
export interface MailLife { name: string; cityId: CityId; state: LifeState }
/** What comeback mail takes from the sender in ./outreach.ts. */
export interface Mailing {
  emailReady(): boolean
  contactLine(): string
  origin(): string
  cap(name: string, fallback: number): number
  /** Mails sent today, by any kind. */
  sentToday(g: GrowthCollection): number
  lifeOf(db: Db, id: string): MailLife | null
  /** A signed link token for `purpose` (see outreach.ts). */
  token(purpose: string, id: string, nonce: string, expires: number): Promise<string>
  deliver(id: string, kind: string, to: string, message: Omit<MailMessage, 'to'>): Promise<{ ok: boolean; off?: true; dryRun?: true }>
}
interface Job { id: string; to: string; nonce: string; plan: Plan; name: string; source: 'contact' | 'account' }

const emptyCounters = (): ComebackCounters => ({ queued: 0, sent: 0, failed: 0, suppressed: 0, unsubscribed: 0 });
const types = (value: unknown): Record<PrefKey, boolean> => {
  const base = defaultPrefs().types, found = isRecord(value) ? value : {};
  return Object.fromEntries(PREF_KEYS.map((key) => [key, typeof found[key] === 'boolean' ? found[key] : base[key]])) as Record<PrefKey, boolean>;
};
/** A stored life from before cities were data has no `career.city`: its job is in the city it lives in (the engine says the same when it loads it). */
const withCareerCity = (state: LifeState): LifeState => (state.career && state.career.city === undefined ? { ...state, career: { ...state.career, city: state.estate.city } } : state);
const num = (value: unknown, fallback = 0): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

/**
 * A new record. `on`: the preference "E-mail me about my character". `legacy`: a contact confirmed before this feature, who used to
 * receive the "away" e-mail and the weekly digest: it keeps exactly those (the away type is the successor of the old mail), and every
 * other type stays off until they turn it on.
 */
export const newRecord = (on: boolean, legacy = false): ComebackRecord => ({ on, legacy, pausedUntil: 0, types: legacy ? { needs: false, friends: false, milestones: false, events: false, away: true, week: true } : defaultPrefs().types, sent: [], last: {}, away: {}, keys: [], waitingAt: 0, nudgeAt: 0, nudges: [], next: 0, suppressedDay: -1 });

/** A stored record read defensively: a database from an older build, or a damaged one, never throws here. */
function sane(raw: unknown): ComebackRecord {
  const r = isRecord(raw) ? raw : {};
  const list = <T>(value: unknown, keep: (item: unknown) => item is T, max: number): T[] => (Array.isArray(value) ? value.filter(keep).slice(-max) : []);
  return {
    on: r.on === true, legacy: r.legacy === true, pausedUntil: num(r.pausedUntil), types: types(r.types),
    sent: list(r.sent, (item): item is { at: number; type: LedgerType } => isRecord(item) && typeof item.at === 'number' && typeof item.type === 'string' && (item.type === 'welcome' || Object.hasOwn(PREF_OF, item.type)), COMEBACK.ledger),
    last: isRecord(r.last) ? Object.fromEntries(Object.entries(r.last).filter(([key, at]) => Object.hasOwn(PREF_OF, key) && typeof at === 'number')) : {},
    away: isRecord(r.away) ? Object.fromEntries(Object.entries(r.away).filter(([key, at]) => ['3', '7', '28'].includes(key) && typeof at === 'number')) : {},
    keys: list(r.keys, (item): item is string => typeof item === 'string', COMEBACK.keys),
    waitingAt: num(r.waitingAt), nudgeAt: num(r.nudgeAt),
    nudges: list(r.nudges, (item): item is { from: string; at: number } => isRecord(item) && typeof item.from === 'string' && typeof item.at === 'number', COMEBACK.nudge.kept),
    next: num(r.next), suppressedDay: num(r.suppressedDay, -1),
    ...(r.acct === true ? { acct: true as const } : {}),
    // Ping mails (./ping-mail.ts) have a ledger of their own, with their own caps.
    ...(Array.isArray(r.pings) ? { pings: list(r.pings, (item): item is { at: number; from: string } => isRecord(item) && typeof item.at === 'number' && typeof item.from === 'string', PING.mail.kept) } : {}),
  };
}

export function comebackService(ctx: RouteContext, mailing: Mailing) {
  const now = (): number => ctx.now();
  const presence = presenceOf(ctx);
  /** In memory only: the earliest time any record is due (0 = look; NEVER = nobody is due). */
  let wakeAt = 0;
  /** Rounds that opened the store since this process started (the cost, for the operator). */
  let passes = 0;
  let running = false, lastTick = 0, stopped = false, current: Promise<unknown> | null = null;

  const book = (g: GrowthCollection): Record<string, ComebackRecord> => { if (!isRecord(g.comeback)) g.comeback = {}; return g.comeback; };
  /** The record of a player, repaired in place when it came from an older build; `create` makes one. */
  function recordOf(g: GrowthCollection, id: string, create: false): ComebackRecord | null
  function recordOf(g: GrowthCollection, id: string, create: true, on?: boolean, legacy?: boolean): ComebackRecord
  function recordOf(g: GrowthCollection, id: string, create: boolean, on = false, legacy = false): ComebackRecord | null {
    // Reading never creates the collection: a server nobody has opted in on stores nothing.
    if (!create && !isRecord(g.comeback)) return null;
    const all = book(g);
    if (Object.hasOwn(all, id)) return (all[id] = sane(all[id]));
    if (!create) return null;
    return (all[id] = newRecord(on, legacy));
  }
  const wake = (at = 0): void => { wakeAt = Math.min(wakeAt, at); };

  // ---- who is written to ---------------------------------------------------------------------------
  /** The account whose active character is `id` (read by key: the Worker keeps accounts in rows). `session` saves a lookup when the caller has it. */
  const accountOf = (db: Db, session?: SessionRecord): AccountOf => (id) => {
    const found = session?.publicId === id ? session : ctx.core.sessionByPublicId?.(db, id);
    const key = found?.account, account = typeof key === 'string' && key !== '__proto__' ? db.accounts?.[key] : undefined;
    return account && typeof account === 'object' && account.publicId === id ? account : undefined;
  };
  const recipientOf = (db: Db, g: GrowthCollection, id: string, session?: SessionRecord): MailRecipient | null => mailRecipientOf(g, id, accountOf(db, session));

  // ---- counters ---------------------------------------------------------------------------------
  function bump(g: GrowthCollection, type: ComebackType | 'all', field: (typeof STAT_FIELDS)[number], n = 1): void {
    if (!isRecord(g.comebackStats)) g.comebackStats = {};
    const stats: ComebackStats = g.comebackStats, day = String(lagosTime(now()).day);
    const today = (stats[day] ||= {}), row = (today[type] ||= emptyCounters());
    row[field] = Math.min(Number.MAX_SAFE_INTEGER, row[field] + n);
    const first = lagosTime(now()).day - LIMITS.statDays;
    for (const key of Object.keys(stats)) if (Number(key) < first) delete stats[key];
  }

  // ---- consent and choices ----------------------------------------------------------------------
  /** The address was confirmed (the double opt-in): the preference starts ON, with every type on. */
  function onConfirmed(g: GrowthCollection, id: string): void {
    const record = recordOf(g, id, true, true);
    record.on = true; record.legacy = false; record.pausedUntil = 0; record.next = 0;
    wake();
  }
  /** A visit: nothing is due for 12 hours. Also ends the back-off and the stop after the final away mail (the ledger compares with the visit). */
  function onVisit(db: Db, g: GrowthCollection, id: string, at: number, session?: SessionRecord): void {
    let record = recordOf(g, id, false);
    // The first visit of a character whose account was made with "E-mail me about my character" on: its choice starts here (and only here, so it is made once).
    if (!record && session?.account !== undefined && g.players[id]?.consent?.age !== 'minor') {
      const account = accountOf(db, session)(id);
      if (account?.mailOptIn === true) { record = recordOf(g, id, true, true); record.acct = true; }
    }
    // A contact confirmed before this feature has no record yet: it keeps the away mail it already had (see newRecord).
    if (!record && recipientOf(db, g, id, session)?.source === 'contact') record = recordOf(g, id, true, false, true);
    if (!record) return;
    record.next = at + COMEBACK.activeHours * HOUR;
    wake(record.next);
  }
  function viewOf(db: Db, g: GrowthCollection, id: string, session?: SessionRecord): ComebackView {
    const record = recordOf(g, id, false), player = playerOf(g, id, { create: false }), t = now(), recipient = recipientOf(db, g, id, session);
    const nudged = Object.fromEntries(Object.entries(player?.nudged ?? {}).filter(([, at]) => t - at < COMEBACK.nudge.perFriendDays * DAY));
    const usable = record !== null && recipient !== null;
    return { source: recipient?.source ?? null, ...(recipient?.source === 'account' ? { address: maskEmail(recipient.email) } : {}), on: usable && (record.on || record.legacy), pausedUntil: usable && record.pausedUntil > t ? record.pausedUntil : 0, types: record ? { ...record.types } : defaultPrefs().types, nudged };
  }
  /** The player's choices from Stay in touch. Switching anything on needs a confirmed address. */
  function setPrefs(db: Db, g: GrowthCollection, id: string, body: Record<string, unknown>, session?: SessionRecord) {
    const t = now();
    for (const key of ['on', 'pause']) if (body[key] !== undefined && typeof body[key] !== 'boolean') throw ctx.fail(400, 'invalid_comeback');
    if (body.types !== undefined && !isRecord(body.types)) throw ctx.fail(400, 'invalid_comeback');
    const asked = isRecord(body.types) ? body.types : {};
    for (const [key, value] of Object.entries(asked)) if (!(PREF_KEYS as readonly string[]).includes(key) || typeof value !== 'boolean') throw ctx.fail(400, 'invalid_comeback');
    const recipient = recipientOf(db, g, id, session);
    const wantsOn = body.on === true || body.pause === false || Object.values(asked).includes(true);
    if (!recipient && wantsOn) return no('no_address', 'Confirm an e-mail address first. Phone, Stay in touch.');
    const record = recordOf(g, id, true, false);
    if (recipient?.source === 'account') record.acct = true;
    if (typeof body.on === 'boolean') { record.on = body.on; record.legacy = false; }
    for (const [key, value] of Object.entries(asked)) record.types[key as PrefKey] = value === true;
    if (body.pause === true) record.pausedUntil = t + COMEBACK.pauseDays * DAY;
    if (body.pause === false) record.pausedUntil = 0;
    record.next = 0; wake();
    return { ok: true as const, code: 'saved' as const, comeback: viewOf(db, g, id, session) };
  }
  /** An unsubscribe link: one kind (`type`) or everything (the link's `all`). Returns what it did, for the page. */
  function unsubscribeType(db: Db, g: GrowthCollection, id: string, type: ComebackType | 'all'): void {
    const record = recordOf(g, id, true, false);
    // Everything off for an account holder also ends the account's own "on from the start": nothing re-creates it later. No sign-in is needed: the signed link is the authority.
    if (type === 'all') { const account = accountOf(db)(id); if (account) { delete account.mailOptIn; record.acct = true; } }
    const was = type === 'all' ? record.on : record.types[PREF_OF[type]];
    if (type === 'all') { record.on = false; record.legacy = false; } else record.types[PREF_OF[type]] = false;
    if (was) bump(g, type, 'unsubscribed'); // the same link twice is still one
  }

  // ---- the weekly digest shares the ledger -------------------------------------------------------
  /** May the weekly digest go to this player? It has its own switch, and a pause stops it too. A player with no record is as before. */
  function weekAllowed(g: GrowthCollection, id: string, at: number): boolean {
    const record = recordOf(g, id, false);
    return !record || (record.pausedUntil <= at && record.types.week && (record.on || record.legacy));
  }
  /** The times of mails already sent to this player (the digest's own, until a record exists). */
  const sendsFor = (g: GrowthCollection, id: string, fallback: number[]): number[] => { const record = recordOf(g, id, false); return record ? record.sent.map((entry) => entry.at) : fallback; };
  /** The digest was claimed: it counts as one of the player's mails. */
  function noteDigest(g: GrowthCollection, id: string, at: number): void {
    const record = recordOf(g, id, true, false, true);
    record.sent = [...record.sent, { at, type: 'week' as const }].slice(-COMEBACK.ledger);
    record.last.week = at;
  }

  // ---- gathering facts ---------------------------------------------------------------------------
  /** The latest sign of play: a hello, a saved life, a social request. */
  function lastActiveOf(db: Db, g: GrowthCollection, id: string): number {
    const session = ctx.core.sessionByPublicId?.(db, id);
    let at = Math.max(playerOf(g, id, { create: false })?.seen ?? 0, db.social?.players?.[id]?.seen ?? 0);
    for (const city of Object.values(session?.cities ?? {})) at = Math.max(at, city?.updatedAt ?? 0);
    return at;
  }
  /** True when `sender` may count: not blocked either way, not muted. */
  function usableSender(db: Db, me: string, sender: string): boolean {
    const s = db.social;
    if (!s || s.players[me]?.blocked[sender] || s.players[sender]?.blocked[me]) return false;
    return !ctx.checks?.muted?.(sender);
  }
  const friends = (db: Db, a: string, b: string): boolean => friendsIn(db.social?.players, a, b);
  const nameOf = (db: Db, id: string): string => firstName(db.social?.players[id]?.name);

  /** Unread things from friends, and friend requests (counted, never named). No text of any message. */
  function waitingFor(db: Db, id: string, at: number): WaitingItem[] {
    const s = db.social, me = s?.players[id];
    if (!s || !me) return [];
    const items: WaitingItem[] = [], since = at - 14 * DAY;
    for (const update of me.updates) {
      const from = update.data?.from;
      if (update.read || update.at < since || typeof from !== 'string' || !usableSender(db, id, from)) continue;
      // A request counts while it is still waiting for an answer, not after it was accepted or declined.
      if (update.kind === 'friend-request') { if (me.in[from] !== undefined) items.push({ kind: 'request', from: null, at: update.at }); }
      else if (update.kind === 'invite-joined') items.push({ kind: 'joined', from: nameOf(db, from), at: update.at });
      else if (update.kind === 'transfer' && friends(db, id, from)) items.push({ kind: 'gift', from: nameOf(db, from), at: update.at });
    }
    for (const [convId, mark] of Object.entries(me.convs)) {
      const conv = s.convs[convId];
      if (conv?.kind !== 'dm') continue;
      for (const message of conv.messages) {
        // The founder's automatic welcome note is not something a friend wrote: it never causes a mail.
        if (message.seq <= mark.read || message.sys || message.auto || message.at < since || message.from === null || message.from === id) continue;
        if (friends(db, id, message.from) && usableSender(db, id, message.from)) items.push({ kind: 'message', from: nameOf(db, message.from), at: message.at });
      }
    }
    return items;
  }
  /** Friends who asked for this player, still friends and still allowed. */
  const nudgesFor = (db: Db, record: ComebackRecord, id: string): NudgeItem[] => record.nudges
    .filter((item) => friends(db, id, item.from) && usableSender(db, id, item.from)).map((item) => ({ from: nameOf(db, item.from), at: item.at }));

  function civicFor(db: Db, id: string, cityId: CityId, at: number, lastActive: number): MilestoneInput['civic'] {
    const city = db.civic?.cities?.[cityId];
    if (!city) return { elected: null, voting: null };
    const governor = governorAt(city, at);
    const elected = governor !== null && governor.id === id && governor.termStartedAt > lastActive && at - governor.termStartedAt < 3 * DAY ? governor.week : null;
    const phase = phaseAt(at);
    const voting = phase.phase === 'voting' && at - phase.votingAt < DAY && Object.hasOwn(city.residents, id) && !city.gov.elections[phase.week]?.votes[id] ? phase.week : null;
    return { elected, voting };
  }

  /** Real things to say to a player who has been away: events, what is waiting, finished missions. Counts and titles only. */
  function awayFacts(life: MailLife, id: string, db: Db): string[] {
    const t = now(), view = viewLife(life.state, { now: t, cityId: life.cityId });
    const unread = db.social?.players[id]?.updates.filter((update) => !update.read && update.kind !== 'moderation' && update.kind !== 'report').length ?? 0;
    const lines: { text: string; group: string }[] = [];
    if (unread) lines.push({ text: `${unread} ${unread === 1 ? 'update is' : 'updates are'} waiting in your inbox`, group: 'person' });
    if (view.missions?.claimable) lines.push({ text: `${view.missions.claimable} finished ${view.missions.claimable === 1 ? 'mission' : 'missions'} to collect`, group: 'progress' });
    const digest = composeDigest({ name: life.name, city: cityName(life.cityId) ?? life.cityId, missions: null, events: upcomingEvents(t, 7, life.cityId).slice(0, 2), lines });
    return digest.lines.slice(0, 3);
  }

  /** Everything the rules look at for one player, from stored state. Nothing is settled or written. */
  function gather(db: Db, g: GrowthCollection, id: string, record: ComebackRecord, life: MailLife, lastActive: number): Facts {
    const t = now(), state = life.state;
    // A table win belongs to the city it was won in; only this life's own city counts.
    const wins = (playerOf(g, id, { create: false })?.wins ?? []).filter((win) => (win.cityId ?? 'lagos') === life.cityId);
    return {
      name: life.name, needs: state.needs, needsAt: state.t, waiting: waitingFor(db, id, t), nudges: nudgesFor(db, record, id),
      milestones: milestoneFacts(withCareerCity(state), { now: t, cityId: life.cityId, wins: wins.map((win) => ({ id: win.id, won: win.won })), civic: civicFor(db, id, life.cityId, t, lastActive) }),
      events: upcomingEvents(t, 2, life.cityId).map((event) => ({ key: `event:${event.key}`, title: event.title, venue: event.venueLabel, start: event.start })),
    };
  }
  const prefsOf = (record: ComebackRecord): Prefs => ({ on: record.on || record.legacy, pausedUntil: record.pausedUntil, types: record.types });
  const memoryOf = (record: ComebackRecord): Memory => ({ sent: record.sent, last: record.last, away: record.away, keys: record.keys, waitingAt: record.waitingAt, nudgeAt: record.nudgeAt });

  // ---- the schedule ------------------------------------------------------------------------------
  /**
   * Look at the players who are due and claim the mails to send. Runs inside the transaction. Returns the jobs.
   * `wakeAt` is set from the records' own next times.
   */
  function plan(db: Db): Job[] {
    const g = growthOf(ctx, db), t = now(), jobs: Job[] = [];
    if (!isRecord(g.comeback) || !Object.keys(g.comeback).length) { wakeAt = NEVER; return jobs; } // nobody has opted in: nothing to look at, nothing stored
    const all = book(g), day = lagosTime(t).day;
    if (g.outreach?.off?.email === true) { wakeAt = t + 10 * 60000; return jobs; }
    const dailyCap = mailing.cap('EMAIL_DAILY_CAP', 500);
    let examined = 0, capped = false;
    for (const id of Object.keys(all)) {
      const record = recordOf(g, id, false);
      if (!record || record.next > t) continue;
      if (jobs.length >= LIMITS.batch || examined >= LIMITS.examine) { break; }
      examined++;
      const recipient = recipientOf(db, g, id), life = recipient ? mailing.lifeOf(db, id) : null;
      if (!recipient || !life) { record.next = t + (recipient ? 7 * DAY : DAY); continue; }
      // The welcome message of a new account is one of this player's mails: it is in the same ledger, so the caps hold across both.
      if (recipient.welcome === 'pending') { record.next = t + HOUR; continue; }
      if (typeof recipient.welcome === 'number' && t - recipient.welcome < 8 * DAY && !record.sent.some((entry) => entry.type === 'welcome')) record.sent = [...record.sent, { at: recipient.welcome, type: 'welcome' as const }].sort((a, b) => a.at - b.at).slice(-COMEBACK.ledger);
      const lastActive = lastActiveOf(db, g, id);
      if (lastActive <= 0) { record.next = t + DAY; continue; }
      try {
        // Cheap gates first: a player who is not eligible costs no more than the record itself.
        // A friend who joined through this player's link is the one thing looked at before the "active" gate (it may pass it).
        const joined = waitingFor(db, id, t).filter((item) => item.kind === 'joined'), online = presence.status(id).state !== 'offline';
        const early = decide({ now: t, lastActive, online, facts: { name: life.name, needs: null, needsAt: 0, waiting: joined, nudges: [], milestones: [], events: [] }, memory: memoryOf(record), prefs: prefsOf(record) });
        if (early.why === 'off' || early.why === 'paused' || early.why === 'active' || early.why === 'stopped') { record.next = early.next; continue; }
        const decision = decide({ now: t, lastActive, online, facts: gather(db, g, id, record, life, lastActive), memory: memoryOf(record), prefs: prefsOf(record) });
        if (!decision.plan) {
          record.next = Math.max(decision.next, t + 1000);
          if (decision.suppressed.length && record.suppressedDay !== day) { record.suppressedDay = day; for (const type of decision.suppressed) bump(g, type, 'suppressed'); }
          continue;
        }
        if (mailing.sentToday(g) + jobs.length >= dailyCap) { capped = true; for (const type of [decision.plan.type]) bump(g, type, 'suppressed'); record.next = Math.max(nextDay(t), t + HOUR); continue; }
        // The claim: the ledger, the type's last time, the key, the next look. All of it is saved before anything is sent.
        const chosen: Plan = decision.plan.type === 'away' ? { ...decision.plan, facts: awayFacts(life, id, db) } : decision.plan;
        Object.assign(record, remember(memoryOf(record), chosen, t));
        if (chosen.type === 'nudge') record.nudges = record.nudges.filter((item) => item.at > chosen.newest);
        record.next = t + DAY;
        bump(g, chosen.type, 'queued');
        jobs.push({ id, to: recipient.email, nonce: recipient.nonce, plan: chosen, name: life.name, source: recipient.source });
      } catch (error) {
        // One life the rules cannot read (a stored life that does not fit its city) never stops everyone else's mail: it is looked at again tomorrow.
        ctx.core?.log?.(`Comeback skipped one player: ${String((isRecord(error) ? error.message : undefined) ?? error).split('\n')[0]?.slice(0, 120)}`);
        record.next = t + DAY;
      }
    }
    // When to look again: the earliest record that is due, and at once when this pass stopped early.
    let soon = NEVER;
    for (const id of Object.keys(all)) { const record = all[id]; if (record && record.next < soon) soon = record.next; }
    wakeAt = capped ? Math.max(soon, nextDay(t)) : jobs.length >= LIMITS.batch || examined >= LIMITS.examine ? t : soon;
    return jobs;
  }
  const nextDay = (t: number): number => lagosDayStart(lagosTime(t).day + 1) + COMEBACK.quietTo * HOUR;

  async function send(job: Job): Promise<void> {
    const origin = mailing.origin(), expires = now() + 400 * DAY;
    const [all, stop] = await Promise.all([mailing.token('unsub', job.id, job.nonce, expires), mailing.token(`unsub-${job.plan.type}`, job.id, job.nonce, expires)]);
    const unsubscribeUrl = `${origin}/e/unsub?t=${all}`, stopUrl = `${origin}/e/unsub?t=${stop}`;
    const mail = comebackMail({ plan: job.plan, name: job.name, now: now(), links: { origin, stopUrl, unsubscribeUrl }, contact: mailing.contactLine(), source: job.source });
    const result = await mailing.deliver(job.id, `comeback-${job.plan.type}`, job.to, { ...mail, headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } });
    await ctx.store.transact((db) => { bump(growthOf(ctx, db), job.plan.type, result.off ? 'suppressed' : result.ok ? 'sent' : 'failed'); }, { durable: false });
  }

  /** The state of one round, for the operator and the tests. */
  interface TickResult { ran: boolean; jobs?: number; reason?: 'not_configured' | 'idle' | 'stopping'; failed?: true }
  function tick(options?: { force?: boolean }): Promise<TickResult> {
    if (stopped) return Promise.resolve({ ran: false, reason: 'stopping' });
    const run = runTick(options?.force === true);
    current = run;
    ctx.waitUntil?.(run.catch(() => {}));
    run.then(() => {}, () => {}).then(() => { if (current === run) current = null; });
    return run;
  }
  async function runTick(force: boolean): Promise<TickResult> {
    // Nothing at all unless a mail could really leave: no read, no write.
    if (!mailing.emailReady()) return { ran: false, reason: 'not_configured' };
    if (running) return { ran: false };
    if (!force && now() - lastTick < LIMITS.tickMs) return { ran: false };
    if (!force && now() < wakeAt) return { ran: false, reason: 'idle' };
    running = true; lastTick = now(); passes++;
    let jobs: Job[] = [];
    try {
      await ctx.store.transact((db) => { jobs = plan(db); }, { durable: () => jobs.length > 0 });
      for (const job of jobs) await send(job);
      return { ran: true, jobs: jobs.length };
    } catch (error) {
      ctx.core?.log?.(`Comeback tick failed: ${String((isRecord(error) ? error.message : undefined) ?? error).split('\n')[0]?.slice(0, 200)}`);
      wakeAt = Math.min(wakeAt, now() + 5 * 60000);
      return { ran: true, jobs: jobs.length, failed: true };
    } finally { running = false; }
  }
  ctx.on?.('heartbeat', () => { void tick(); });
  // A friend joined through a player's link: that player's record is due now (the rules decide what, if anything, is sent).
  ctx.on?.('invite-joined', ({ inviter }) => {
    if (!mailing.emailReady()) return;
    ctx.store.transact((db) => { const record = recordOf(growthOf(ctx, db), inviter, false); if (record) record.next = Math.min(record.next, now()); }, { durable: false }).then(() => wake(), () => {});
  });
  ctx.closing?.push(async () => { stopped = true; await current?.catch(() => {}); });

  // ---- nudge -------------------------------------------------------------------------------------
  /**
   * A friend asks an away friend to come back. Runs inside the caller's transaction. The answer is the same
   * sentence whether or not the friend has an address; only the caller's own cooldown and the friendship are checked.
   */
  function nudge(db: Db, g: GrowthCollection, session: SessionRecord, body: Record<string, unknown>) {
    const to = body.to, id = session.publicId, t = now();
    if (typeof to !== 'string' || !UUID_PATTERN.test(to)) throw ctx.fail(400, 'invalid_player');
    if (to === id) throw ctx.fail(400, 'invalid_player');
    if (!ctx.allow(`growth:nudge:${id}`, COMEBACK.nudge.perHour, HOUR)) throw ctx.fail(429, 'rate_limited');
    const them = db.social?.players[to];
    if (!them || !friends(db, id, to) || db.social?.players[id]?.blocked[to] || them.blocked[id]) return no('not_friends', 'You can nudge a friend you have added, who has not blocked you.');
    if (ctx.checks?.muted?.(id)) return no('muted', 'You cannot send nudges right now.');
    const away = t - lastActiveOf(db, g, to);
    if (away < COMEBACK.nudge.awayDays * DAY) return no('not_away', `${firstName(them.name)} was here recently.`);
    const player = playerOf(g, id);
    if (!player) return no('not_ready', 'This is not available right now. Try again later.');
    const mine = (player.nudged ||= {});
    for (const [key, at] of Object.entries(mine)) if (t - at >= COMEBACK.nudge.perFriendDays * DAY) delete mine[key];
    const earlier = mine[to];
    if (earlier !== undefined && t - earlier < COMEBACK.nudge.perFriendDays * DAY) {
      const days = Math.max(1, Math.ceil((earlier + COMEBACK.nudge.perFriendDays * DAY - t) / DAY));
      return no('cooldown', `You nudged ${firstName(them.name)} recently. You can do it again in ${days} ${days === 1 ? 'day' : 'days'}.`);
    }
    mine[to] = t;
    const oldest = Object.entries(mine).sort((a, b) => a[1] - b[1]);
    for (const [key] of oldest.slice(0, Math.max(0, oldest.length - LIMITS.nudged))) delete mine[key];
    // Only a friend with a confirmed address and the Friends switch on keeps the nudge; nothing says which.
    // The founder is everybody's friend without having chosen each of them: a nudge across that friendship is answered the same and kept by nobody.
    const record = autoFriend(db.social?.players, to, id) ? null : recordOf(g, to, false);
    if (record && recipientOf(db, g, to)) {
      record.nudges = [...record.nudges.filter((item) => item.from !== id), { from: id, at: t }].slice(-COMEBACK.nudge.kept);
      record.next = Math.min(record.next, t); wake();
    }
    return { ok: true as const, code: 'nudged' as const, note: NUDGE_NOTE, nudged: t };
  }

  // ---- the operator's view -------------------------------------------------------------------------
  function operatorView(g: GrowthCollection): { days: number; types: Record<string, ComebackCounters>; today: Record<string, ComebackCounters>; waiting: number; passes: number } {
    const stats = isRecord(g.comebackStats) ? g.comebackStats : {}, today = String(lagosTime(now()).day);
    const total: Record<string, ComebackCounters> = {};
    for (const day of Object.values(stats)) for (const [type, row] of Object.entries(day)) { const into = (total[type] ||= emptyCounters()); for (const field of STAT_FIELDS) into[field] += row[field] ?? 0; }
    const waiting = Object.values(isRecord(g.comeback) ? g.comeback : {}).filter((record) => record.on && record.next <= now()).length;
    return { days: LIMITS.statDays, types: total, today: { ...(stats[today] ?? {}) }, waiting, passes };
  }

  return { tick, onConfirmed, onVisit, viewOf, recipientOf, accountOf, setPrefs, unsubscribeType, weekAllowed, sendsFor, noteDigest, nudge, operatorView, wake,
    /** For ./ping-mail.ts: a player's record (never created by a ping), their latest sign of play, and the counters. */
    recordFor: (g: GrowthCollection, id: string): ComebackRecord | null => recordOf(g, id, false), lastActiveOf, bump };
}
