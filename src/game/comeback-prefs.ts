/**
 * OWNER: growth
 * The kinds of comeback mail and the switches that govern them. Names only, with no imports, so the browser (Stay in
 * touch) can use them without the rules (src/game/comeback.ts) that decide when each is sent.
 */
/** `ping` is the one kind a friend asks for (src/game/ping.ts): it has caps of its own and is never chosen by the schedule. */
export type ComebackType = 'waiting' | 'nudge' | 'need' | 'milestone' | 'event' | 'away' | 'week' | 'ping';
/** What the shared ledger of one player's mails records: comeback types, and the welcome message of a new account (which counts against the same caps). */
export type LedgerType = ComebackType | 'welcome';
export type PrefKey = 'needs' | 'friends' | 'milestones' | 'events' | 'away' | 'week';
export const PREF_KEYS: readonly PrefKey[] = Object.freeze(['needs', 'friends', 'milestones', 'events', 'away', 'week'] as const);
export const PREF_LABELS: Readonly<Record<PrefKey, string>> = Object.freeze({
  needs: 'Needs', friends: 'Friends', milestones: 'Milestones', events: 'Events', away: 'When I’ve been away', week: 'Weekly digest',
});
/** Which switch a type of mail answers to. */
export const PREF_OF: Readonly<Record<ComebackType, PrefKey>> = Object.freeze({ waiting: 'friends', nudge: 'friends', need: 'needs', milestone: 'milestones', event: 'events', away: 'away', week: 'week', ping: 'friends' });
export const COMEBACK_TYPES: readonly ComebackType[] = Object.freeze(['waiting', 'nudge', 'need', 'milestone', 'event', 'away', 'week', 'ping'] as const);
