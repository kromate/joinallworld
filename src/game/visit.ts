/**
 * OWNER: social
 * VISITING A HOME: the numbers and the words that need no stored state, as pure functions, so the server
 * (server/social/visit.ts, visit-book.ts, visit-token.ts) and the browser (src/app/features/visit) read one module.
 * What is stored and how it is checked is written at the top of server/social/visit.ts.
 *
 *   VISIT          every number, named
 *   DOOR_CHOICES   the four answers to "Who can come into my home"
 *   visitButton    what the button on a friend's card says, and why it is off
 *   linkExpiry     the words of how long a house link has left
 *
 * Nothing here reads a message, a balance or an address.
 */

const MINUTE = 60000, HOUR = 3600000;

export const VISIT = Object.freeze({
  /** A player with more friends than this is never defaulted to "walk in": a crowd could fill the house. */
  walkFriendsMax: 100,
  /** Guests a house takes at once: the home scene stands five people by the door (src/scene/home-scene.ts MAX_GUESTS_SHOWN). */
  guests: 5,
  /** An invitation to come over is good for this long, and is one permission: it bypasses the knock for that visit. */
  inviteMinutes: 30,
  /** Invitations one host has open at once. */
  invitesPerHost: 30,
  /** Friends asked at once with "Everyone here". */
  inviteAll: 12,
  /** A house link lives this long unless the host chooses another time (never longer than linkMaxHours). */
  linkHours: 2,
  linkMaxHours: 24,
  /** Links one host has open at once. */
  linksPerHost: 5,
  /** The most people one link may be limited to. */
  linkMaxUses: 50,
  /** People who may come in through one link in an hour, however many it allows in all. */
  linkPerHour: 20,
  /** Tries per address per minute at the landing and at the door. */
  perAddressPerMinute: 20,
  /** A guest the host asked to leave cannot come back by themselves for this long. */
  barredMinutes: 30,
  /** "Close the door" holds this long. */
  closedHours: 2,
  /** Links and invitations kept in all (the oldest go first). */
  kept: 4000,
});
export const VISIT_MS = Object.freeze({ invite: VISIT.inviteMinutes * MINUTE, link: VISIT.linkHours * HOUR, linkMax: VISIT.linkMaxHours * HOUR, barred: VISIT.barredMinutes * MINUTE, closed: VISIT.closedHours * HOUR });

/** Who may come into a home. */
export type DoorWho = 'walk' | 'knock' | 'invited' | 'nobody';
export const DOOR_CHOICES: readonly { id: DoorWho; label: string; hint: string }[] = Object.freeze([
  { id: 'walk', label: 'Friends walk in', hint: 'A friend taps Visit home and is inside, while you are home.' },
  { id: 'knock', label: 'Friends knock first', hint: 'You see a knock and choose Let in or Not now.' },
  { id: 'invited', label: 'Only people I invite', hint: 'Nobody comes in unless you invite them or send a link.' },
  { id: 'nobody', label: 'Nobody', hint: 'Your door is shut, links and invitations too.' },
]);
export const isDoorWho = (value: unknown): value is DoorWho => DOOR_CHOICES.some((choice) => choice.id === value);

/**
 * What a friend's door is to the one looking, as `me` answers it: 'walk' (walk in while they are home), 'walk+' (walk in even
 * while they are out), 'knock', 'invited' (only people they ask) or 'closed' (nobody, or the door was closed).
 */
export type VisitHow = 'walk' | 'walk+' | 'knock' | 'invited' | 'closed';

export interface VisitButton {
  /** 'visit': walk in; 'knock': ring and wait; 'off': nothing to press (the reason says why). */
  kind: 'visit' | 'knock' | 'off';
  label: string;
  reason: string | null;
}
export interface VisitFacts {
  name: string;
  how: VisitHow | undefined;
  /** They are at home and online right now. */
  home: boolean;
  /** Online, but not at home. */
  online: boolean;
  /** The house has no room for one more. */
  full: boolean;
  /** The viewer holds a live invitation from them. */
  invited: boolean;
}
const first = (name: string): string => name.trim().split(/\s+/)[0] || 'They';

/** The one button on a friend's card, the friends list, the chat header and the map: Visit home, Knock, or a plain reason. */
export function visitButton(facts: VisitFacts): VisitButton {
  const { how, home, online, full, invited } = facts, who = first(facts.name);
  if (how === 'closed' || (how === undefined && !invited)) return { kind: 'off', label: 'Visit home', reason: how === 'closed' ? `${who} is not taking visitors.` : `${who}’s home is not open to visits.` };
  const present = home || (how === 'walk+' && online);
  if (!invited && !present) return { kind: 'off', label: 'Visit home', reason: `${who} is not home.` };
  if (full) return { kind: 'off', label: 'Visit home', reason: `Home is full: ${VISIT.guests} friends are inside.` };
  if (invited) return { kind: 'visit', label: 'Come in', reason: null };
  if (how === 'invited') return { kind: 'off', label: 'Visit home', reason: 'Only invited guests.' };
  return how === 'knock' ? { kind: 'knock', label: 'Knock', reason: null } : { kind: 'visit', label: 'Visit home', reason: null };
}

/** "Ends in 1 h 20 min" for a house link or an invitation. */
export function timeLeft(expires: number, now: number): string {
  const left = Math.max(0, expires - now), minutes = Math.ceil(left / MINUTE);
  if (minutes <= 0) return 'ended';
  if (minutes < 60) return `${minutes} min left`;
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  return rest ? `${hours} h ${rest} min left` : `${hours} h left`;
}

/** The words of a refusal at the door that the server may answer, for a screen that has only the code. */
export const VISIT_REFUSALS: Readonly<Record<string, string>> = Object.freeze({
  door_closed: 'That home is not taking visitors.',
  only_invited: 'Only invited guests can come in.',
  host_not_home: 'They are not home.',
  house_full: `Home is full: ${VISIT.guests} friends are inside.`,
  door_shut: 'They have closed the door for now.',
  link_ended: 'That link has ended.',
  link_expired: 'That link has run out.',
  link_full: 'That link has been used as many times as it allows.',
});
