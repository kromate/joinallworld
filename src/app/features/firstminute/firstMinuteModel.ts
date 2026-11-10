// THE FIRST MINUTE (docs/FEED.md, "First minute"), as pure functions: which few things of Near you the strip shows, what it says about
// the people here, and the ONE next action it offers. Nothing here touches the page, so the choice is tested under node --test.
//
// A player back after three hours or more is greeted first, and the one action is their current goal (`back`).
// The action, the first that exists:
//   1. someone else is in this room or place now, and it has a chat      → Say hello (the room's chat)
//   2. a person from your local government posted, and you may reply     → Say hello (a reply to that post)
//   3. an open community of your area, else of your city, you are not in → Join <community>
//   4. a person from your city posted, and you may reply                 → Say hello (a reply to that post)
//   5. a regular of this venue is standing here                          → Say hello to <name> (their card)
//   6. you can walk now and are not in the Square                         → Walk to the Square
//   7. otherwise                                                          → Say hello (a post on Near you)
// Each of them is already counted as activation by the server when it happens (a reply or post, a join, a walk): nothing is counted here.
import { nearness } from '../../../feed/model.ts'
import type { CrewView, PostView } from '../../../types/feed.ts'

/** The location badge as the Near you read gives it (`FeedPage.near`): absent for a player without one. */
export interface Badge { city: string; lga?: string }

export interface MinuteFacts {
  /** The first page of Near you, as the server ranked it. */
  posts: readonly PostView[]
  /** Open communities of the badge's city (or the player's city). */
  communities: readonly CrewView[]
  badge: Badge | null
  /** The city the player's character is in. */
  city: string
  /** Other people in this room, place or street now; null when it is not known. */
  others: number | null
  /** The room has a chat to open (not a street walk). */
  canChat: boolean
  /** The player can step into the Square now (not travelling, not on a street walk, not already there). */
  canWalk: boolean
  /** The venue's regulars standing here now (game characters, not people). Empty in a place, on a street walk and where there are none. */
  regulars?: readonly { id: string; name: string }[]
  /** Set for a player who was away three hours or more and has a current goal: its title. */
  back?: string | null
}

export type NextAction =
  | { kind: 'room'; label: string }
  | { kind: 'reply'; label: string; post: string; who: string }
  | { kind: 'join'; label: string; crew: string; name: string }
  | { kind: 'npc'; label: string; npc: string; name: string }
  | { kind: 'goal'; label: string }
  | { kind: 'square'; label: string }
  | { kind: 'post'; label: string }

export interface StripItem { id: string; who: string; text: string; event: boolean }

/** At most this many things of Near you on the strip. */
export const STRIP_ITEMS = 3
const TEXT_MAX = 90

const cut = (text: string): string => { const one = text.replace(/\s+/g, ' ').trim(); return one.length > TEXT_MAX ? `${one.slice(0, TEXT_MAX - 1).trimEnd()}…` : one }
const shown = (post: PostView): boolean => !post.mine && !post.hidden && (Boolean(post.event) || post.body.trim().length > 0)

/** "in 20 min", "in 3 h", "tomorrow", "in 4 days"; "on now" once it has started. */
export function whenText(start: number, now: number, phase?: string): string {
  if (phase === 'live' || start <= now) return 'on now'
  const minutes = Math.max(1, Math.round((start - now) / 60000))
  if (minutes < 60) return `in ${minutes} min`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `in ${hours} h`
  const days = Math.round(hours / 24)
  return days === 1 ? 'tomorrow' : `in ${days} days`
}

/** Up to three things of Near you: one event first (the soonest that is not over), then posts as ranked. The player's own are left out. */
export function stripItems(posts: readonly PostView[], now: number): StripItem[] {
  const usable = posts.filter(shown)
  const event = usable.filter((post) => post.event && post.event.phase !== 'over').sort((a, b) => (a.event?.start ?? 0) - (b.event?.start ?? 0))[0]
  const rest = usable.filter((post) => !post.event)
  return [...(event ? [event] : []), ...rest].slice(0, STRIP_ITEMS).map((post) => ({
    id: post.id, who: post.by.name, event: Boolean(post.event),
    text: post.event ? cut(`${post.event.title} · ${whenText(post.event.start, now, post.event.phase)}${post.event.place.label ? ` · ${post.event.place.label}` : ''}`) : cut(post.body),
  }))
}

/** "3 people here now", "1 person here now"; with nobody else, the regulars ("Tunji is here", "3 regulars here") or "Nobody else here yet"; null when the count is not known. */
export function hereText(others: number | null, regulars: readonly { name: string }[] = []): string | null {
  if (others === null) return null
  if (others <= 0) return regulars.length === 1 ? `${regulars[0]!.name} is here` : regulars.length ? `${regulars.length} regulars here` : 'Nobody else here yet'
  return `${others} ${others === 1 ? 'person' : 'people'} here now`
}

/** A post a person (not an AI character) made near the player that they may answer: `lga` asks for the same local government (`nearness`). */
function neighbourPost(facts: MinuteFacts, lga: boolean): PostView | undefined {
  const viewer = facts.badge ?? { city: facts.city }
  return facts.posts.find((post) => shown(post) && post.canReply && !post.ai && !post.by.ai && nearness(viewer, post.by.located, post.place?.city) === (lga ? 'lga' : 'city'))
}

/** An open community the player is not in and may join: of the badge's local government first, then of the city, then any of the list. */
function openCommunity(facts: MinuteFacts): CrewView | undefined {
  const joinable = facts.communities.filter((crew) => crew.open && !crew.mine && crew.qualifies !== false && crew.size < crew.cap)
  const city = facts.badge?.city ?? facts.city, lga = facts.badge?.lga
  return (lga ? joinable.find((crew) => crew.place?.lga === lga) : undefined) ?? joinable.find((crew) => crew.place?.city === city) ?? joinable[0]
}

export function nextAction(facts: MinuteFacts): NextAction {
  if (facts.back) return { kind: 'goal', label: facts.back }
  if (facts.canChat && (facts.others ?? 0) > 0) return { kind: 'room', label: 'Say hello' }
  const local = neighbourPost(facts, true)
  if (local) return { kind: 'reply', label: 'Say hello', post: local.id, who: local.by.name }
  const crew = openCommunity(facts)
  if (crew) return { kind: 'join', label: `Join ${crew.name}`, crew: crew.id, name: crew.name }
  const near = neighbourPost(facts, false)
  if (near) return { kind: 'reply', label: 'Say hello', post: near.id, who: near.by.name }
  const regular = facts.regulars?.[0]
  if (regular) return { kind: 'npc', label: `Say hello to ${regular.name}`, npc: regular.id, name: regular.name }
  if (facts.canWalk) return { kind: 'square', label: 'Walk to the Square' }
  return { kind: 'post', label: 'Say hello' }
}

/** The few words beside the action button: what pressing it does. */
export function actionHint(action: NextAction): string {
  switch (action.kind) {
    case 'room': return 'Open the chat of the people here'
    case 'reply': return `Reply to ${action.who}`
    case 'join': return 'One tap: you are in, with its chat and its world'
    case 'npc': return `${action.name} is a regular here`
    case 'goal': return 'Welcome back: your next goal'
    case 'square': return 'Everyone in Allworld meets there'
    case 'post': return 'Write the first post near you'
  }
}
