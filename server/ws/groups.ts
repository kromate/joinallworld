/**
 * OWNER: foundation
 * ROOM GROUPS — who is placed with whom, and when a small group is merged away. Pure rules over player ids: no sockets, no
 * clock, no store, so both hosts and every test read the same decisions. server/ws/rooms.ts holds the state and does the sending.
 *
 * A public venue's room is split into groups (src/game/roomGroups.ts has the sizes). A venue is `{ groups, where }`: each group
 * is a set of PLAYERS (a player with two sockets counts once) and `where` says which group a player is in.
 *
 * PLACEMENT (`place`), in this order:
 *   1. the group of the person they came to be with (a ping join, an invite, following a friend), if there is room for one more
 *      up to `max` plus the overflow;
 *   2. the group with the most of their mutual friends in it (an automatic friendship does not count), the same room rule;
 *   3. the group they were in a moment ago (a page reload), if it has room under `max`;
 *   4. the fullest group below `target` — preferring one that holds nobody they have a block with — so groups feel alive;
 *   5. a new group.
 * When the friend's group is past `max` plus the overflow they are placed by 3-5 and told who they could not be placed with
 * (`apart`), so the page can offer a one-tap "Join <name>'s group". A block is never a reason to be placed anywhere: a blocked
 * pair is not a friend or a follow, and a group that holds one is only chosen when no other would do.
 *
 * MERGING (`planMerge`): a group below `min` is moved into another group in one go, whole units together — a unit is a
 * voice circle, people who spoke in the chat lately, or two friends standing together. A unit with somebody seated at a game
 * table does not move. The target must stay within `target` and the voice circle's cap, and hold nobody a mover has a block with.
 */
import { ROOM_GROUP_OVERFLOW } from '../../src/game/roomGroups.ts';
import type { RoomGroupLimits } from '../../src/game/roomGroups.ts';

export interface Group { id: string; no: number; players: Set<string> }
export interface Venue { groups: Map<string, Group>; where: Map<string, string>; next: number }
export const newVenue = (): Venue => ({ groups: new Map(), where: new Map(), next: 1 });
export const groupName = (no: number): string => `g${no}`;
const numberOf = (id: string): number => { const n = Number(id.slice(1)); return Number.isSafeInteger(n) && n > 0 ? n : 0; };

/** Put a player in a group: the one named (made if it is not there — a Worker that woke), or a new one. */
export function seat(venue: Venue, player: string, id: string | null = null): Group {
  let group = id === null ? undefined : venue.groups.get(id);
  if (!group) {
    const no = id !== null && numberOf(id) ? numberOf(id) : venue.next;
    group = { id: groupName(no), no, players: new Set() };
    venue.groups.set(group.id, group);
    venue.next = Math.max(venue.next, no + 1);
  }
  const before = venue.where.get(player);
  if (before !== undefined && before !== group.id) venue.groups.get(before)?.players.delete(player);
  group.players.add(player); venue.where.set(player, group.id);
  return group;
}
/** Take a player out of their group; an empty group goes with the last player. Returns the group they left. */
export function unseat(venue: Venue, player: string): Group | undefined {
  const id = venue.where.get(player);
  if (id === undefined) return undefined;
  venue.where.delete(player);
  const group = venue.groups.get(id);
  if (!group) return undefined;
  group.players.delete(player);
  if (!group.players.size) venue.groups.delete(id);
  return group;
}

export interface Wish {
  player: string
  /** Their mutual (non-automatic) friends. */
  friends: ReadonlySet<string>
  /** Who they came to be with, if anybody. */
  follow: string | null
  /** The group they were in a moment ago. */
  previous: string | null
  blocked: (a: string, b: string) => boolean
}
export interface Placement { group: string | null; why: 'follow' | 'friend' | 'previous' | 'fullest' | 'new'; apart: string | null }

const fullerFirst = (a: Group, b: Group): number => b.players.size - a.players.size || a.no - b.no;

export function place(venue: Venue, limits: RoomGroupLimits, wish: Wish): Placement {
  const reach = limits.max + ROOM_GROUP_OVERFLOW;
  let apart: string | null = null;
  if (wish.follow !== null && wish.follow !== wish.player && !wish.blocked(wish.player, wish.follow)) {
    const gid = venue.where.get(wish.follow), group = gid === undefined ? undefined : venue.groups.get(gid);
    if (group) { if (group.players.size < reach) return { group: group.id, why: 'follow', apart: null }; apart = wish.follow; }
  }
  const tally = new Map<string, { group: Group; friends: string[] }>();
  for (const friend of wish.friends) {
    if (friend === wish.player || wish.blocked(wish.player, friend)) continue;
    const gid = venue.where.get(friend), group = gid === undefined ? undefined : venue.groups.get(gid);
    if (!group) continue;
    const entry = tally.get(group.id) ?? { group, friends: [] };
    entry.friends.push(friend); tally.set(group.id, entry);
  }
  const homes = [...tally.values()].sort((a, b) => b.friends.length - a.friends.length || fullerFirst(a.group, b.group));
  for (const home of homes) if (home.group.players.size < reach) return { group: home.group.id, why: 'friend', apart };
  if (homes[0]) apart ??= homes[0].friends[0] ?? null;
  const previous = wish.previous === null ? undefined : venue.groups.get(wish.previous);
  if (previous && previous.players.size < limits.max) return { group: previous.id, why: 'previous', apart };
  const open = [...venue.groups.values()].filter((group) => group.players.size < limits.target).sort(fullerFirst);
  const calm = open.find((group) => ![...group.players].some((other) => wish.blocked(wish.player, other)));
  const chosen = calm ?? open[0];
  return chosen ? { group: chosen.id, why: 'fullest', apart } : { group: null, why: 'new', apart };
}

export interface MergeFacts {
  /** Sits at a game table: never moved, and neither is anyone in their unit. */
  seated: (player: string) => boolean
  /** In the voice circle. */
  voice: (player: string) => boolean
  /** Spoke in the venue chat lately. */
  chatting: (player: string) => boolean
  /** Two friends standing together. */
  together: (a: string, b: string) => boolean
  blocked: (a: string, b: string) => boolean
  /** The most people one voice circle holds. */
  voiceCap: number
}
export interface MergePlan { from: string; to: string; movers: string[] }

export function planMerge(venue: Venue, limits: RoomGroupLimits, small: Group, facts: MergeFacts): MergePlan | null {
  const people = [...small.players];
  const parent = new Map(people.map((id) => [id, id]));
  const root = (id: string): string => { let at = id; while (parent.get(at) !== at) { const up = parent.get(at) ?? at; parent.set(at, parent.get(up) ?? up); at = parent.get(at) ?? at; } return at; };
  const join = (a: string, b: string): void => { parent.set(root(a), root(b)); };
  const voices = people.filter(facts.voice), talkers = people.filter(facts.chatting);
  for (const list of [voices, talkers]) for (const id of list.slice(1)) join(list[0] ?? id, id);
  for (let i = 0; i < people.length; i++) for (let j = i + 1; j < people.length; j++) { const a = people[i], b = people[j]; if (a !== undefined && b !== undefined && facts.together(a, b)) join(a, b); }
  const fixed = new Set<string>();
  for (const id of people) if (facts.seated(id)) fixed.add(root(id));
  const movers = people.filter((id) => !fixed.has(root(id)));
  if (!movers.length) return null;
  const circle = movers.filter(facts.voice).length;
  const targets = [...venue.groups.values()].filter((group) => group !== small && group.players.size + movers.length <= limits.target)
    .filter((group) => [...group.players].filter(facts.voice).length + circle <= facts.voiceCap)
    .filter((group) => ![...group.players].some((other) => movers.some((mover) => facts.blocked(mover, other))))
    .sort(fullerFirst);
  const to = targets[0];
  return to ? { from: small.id, to: to.id, movers } : null;
}
