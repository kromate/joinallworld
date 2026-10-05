/**
 * ROOM GROUPS: a public venue's room is split into groups of bounded size, so nobody is sent, draws or hears a crowd.
 * The numbers and the words the server (server/ws/groups.ts, server/ws/rooms.ts) and the browser share. Pure: no state.
 *
 *   target    the size strangers are placed up to; a group this full is "full" for anyone who is not a friend of someone in it
 *   max       the most a group holds when somebody is placed or hops in by choice
 *   overflow  how far past `max` friends are let in rather than being separated from each other
 *   min       a group below this is merged into another at the next quiet moment
 * A host may set the three sizes (ROOM_GROUP_TARGET, ROOM_GROUP_MAX, ROOM_GROUP_MIN; server/host-context.ts capacityConfig).
 */
import type { RoomCounts } from '../types/protocol.ts';

export const ROOM_GROUP_TARGET = 12;
export const ROOM_GROUP_MAX = 16;
export const ROOM_GROUP_MIN = 4;
/** Friends are placed together up to `max` plus this many. */
export const ROOM_GROUP_OVERFLOW = 2;
/** A player who spoke in the venue chat this recently is mid-conversation: their group is not merged away from them. */
export const ROOM_CHAT_QUIET_MS = 30000;
/** Two friends this close (scene units) are standing together: a merge moves both or neither. */
export const ROOM_FRIEND_NEAR = 6;
/** Groups listed by "See other groups" at most. */
export const ROOM_GROUP_LIST = 24;
/** The move frames of a group are gathered and sent at most this often. */
export const ROOM_MOVE_FLUSH_MS = 120;

export interface RoomGroupLimits { target: number; max: number; min: number }
export const ROOM_GROUP_DEFAULTS: Readonly<RoomGroupLimits> = Object.freeze({ target: ROOM_GROUP_TARGET, max: ROOM_GROUP_MAX, min: ROOM_GROUP_MIN });


/** "12 here with you · 128 in this place" (a venue that is one group says only the first part). */
export function groupHeader(counts: Pick<RoomCounts, 'here' | 'total'> | null | undefined): string {
  if (!counts || !Number.isFinite(counts.here) || !Number.isFinite(counts.total)) return '';
  const others = Math.max(0, counts.here - 1);
  const near = others === 0 ? 'Nobody else here with you' : `${others} here with you`;
  return counts.total > counts.here ? `${near} · ${counts.total} in this place` : near;
}
/** "You are now with 9 others". */
export const groupNotice = (here: number): string => {
  const others = Math.max(0, here - 1);
  return others === 0 ? 'You are on your own here for now.' : `You are now with ${others} ${others === 1 ? 'other' : 'others'}.`;
};
/** The first line said about venue chat: it is the people around you. */
export const GROUP_CHAT_NOTE = 'You are chatting with the people around you.';
