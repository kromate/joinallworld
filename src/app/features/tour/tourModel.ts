// The tour: its steps, which of them can be shown right now, and when a step that waits for the player is done.
// Pure (the page is passed in as `has`), so the sequencing is tested without a browser.
import type { Side } from './placement.ts'
import { capOf } from './shortcutsModel.ts'

/** What the player has to do for a step to be done: start an activity, open the map, open the phone. */
export type Wait = 'activity' | 'map' | 'phone'

export interface StepContext {
  /** The player stands in their own home. */
  home: boolean
  /** A device that is touched: gestures are offered. */
  touch: boolean
  /** A device with keys or a mouse: key shortcuts are offered. A device can be both. Defaults to "not touch". */
  keys?: boolean
  /** Is a `data-tour` target on screen? */
  has: (id: string) => boolean
  /** The other cities that are open, by name, and the country the player is in (tourWorld.ts reads them from the city registry). */
  world?: TourWorld
}
export interface TourWorld { cities: readonly string[]; country: string }
export interface KeyRow { caps: string[]; text: string }
export interface TourStep {
  id: string
  title: string
  text: string | ((context: StepContext) => string)
  /** The `data-tour` ids to light, in order of preference; the first on screen wins. None: a card in the middle. */
  targets?: string[]
  /** The step is shown only when one of these is on screen (the people step on a build that has none skips). */
  needs?: string[]
  /** For a step that waits: what to do, in a line of its own. */
  task?: string
  wait?: Wait
  /** Once done, say this instead, and light these. */
  doneText?: string
  doneTargets?: string[]
  /** Move on by itself a moment after it is done (Next is always there). */
  advance?: boolean
  /** Show the activities while this step is up. */
  expand?: boolean
  /** The step's own sheet is allowed to be open (the phone). */
  allows?: 'phone'
  /** What the step before opened stays open for this one (the map, the phone), and is closed after it. */
  keeps?: 'map' | 'phone'
  prefer?: Side
  keys?: (context: StepContext) => KeyRow[]
  /** The last card: an extra button. */
  action?: { label: string; run: 'shortcuts' }
}

const text = (home: string, away: string) => (context: StepContext): string => (context.home ? home : away)

/** Up to three names as words: "Ibadan", "Ibadan and Ota", "Ibadan, Ota and Abeokuta", and "… and more" past three. */
export function cityWords(names: readonly string[]): string {
  const [first = '', ...rest] = names.slice(0, 3)
  if (names.length > 3) return `${[first, ...rest].join(', ')} and more`
  const last = rest.pop()
  return last ? `${[first, ...rest].join(', ')} and ${last}` : first
}
/** The travel step: only cities that are open are named, and nothing is promised as open that is not. */
function travelText(context: StepContext): string {
  const { cities, country } = context.world ?? { cities: [], country: 'Nigeria' }
  if (!cities.length) return `Allworld is the real world, one city at a time, and you will travel between them to see what there is to do in each. ${country} comes first, and more of Africa and the world are coming.`
  return `Tap World at the top of the Map, a city like ${cityWords(cities)}, then the bus, train or flight: you are on your way, and your home stays yours while you visit. Cities in ${country} are open now, and more of Africa and the world are coming.`
}

export const STEPS: readonly TourStep[] = [
  { id: 'welcome', title: 'Welcome to Allworld', text: 'Let me show you around. It takes about two minutes, and you can skip any time.' },
  { id: 'needs', title: 'Your needs', targets: ['needs'], prefer: 'bottom', text: 'These bars show how you are doing: energy, food and more. They fall slowly as time passes. The line under them always says what to do next: tap it and it takes you there.' },
  { id: 'hud', title: 'Time, mood and cash', targets: ['hud'], prefer: 'bottom', text: 'The clock shows the day and the hour, with your mood beside it. Your cash is on the right: tap it to open your Bank.' },
  { id: 'signup', title: 'Save your progress', targets: ['signup'], needs: ['signup'], prefer: 'bottom', text: 'You are playing as a guest, which is fine. Sign up free to keep your character and play on from any device. Log in is next to it if you have an account already.' },
  { id: 'place', title: 'Spots and activities', targets: ['place'], expand: true, wait: 'activity', advance: true, prefer: 'top',
    text: text('Your home has spots too. Pick one, then tap something to do. Each one runs on a timer and finishes even if you close the tab.', 'Every place has spots to stand at. Pick one, then tap an activity. Each one runs on a timer and finishes even if you close the tab.'),
    task: 'Try one now: tap an activity.' },
  { id: 'move', title: 'Getting around', prefer: 'center',
    text: (context) => {
      const keys = context.keys ?? !context.touch
      if (context.touch && keys) return 'Walk with the keys or the stick, or click or tap where you want to go. Drag to look around; scroll or pinch to zoom.'
      return context.touch ? 'Drag the stick to walk, or tap where you want to go. Drag anywhere to look around and pinch to zoom.' : 'Walk with the keys, or click where you want to go. Drag to look around and scroll to zoom.'
    },
    keys: (context) => ((context.keys ?? !context.touch) ? [{ caps: ['walk:up', 'walk:left', 'walk:down', 'walk:right'].map(capOf), text: 'Walk' }, { caps: [capOf('walk:jog')], text: 'Hold to jog' }, { caps: ['Click'], text: 'Walk there' }, { caps: ['Drag'], text: 'Look around' }, { caps: ['Scroll'], text: 'Zoom' }] : []) },
  { id: 'map', title: 'The Map', targets: ['nav-map'], doneTargets: ['map-card'], wait: 'map',
    text: 'Travel from here to anywhere in the city.', task: 'Tap Map to open it.',
    doneText: 'Pick a place to see the trip first: how long it takes, and what each way of travelling costs.' },
  { id: 'travel', title: 'Travel the world', targets: ['map-world', 'nav-map'], keeps: 'map', text: travelText },
  { id: 'phone', title: 'Your phone', targets: ['nav-phone'], doneTargets: ['phone-apps'], wait: 'phone', allows: 'phone',
    text: 'Jobs, Bank, Messages, Missions and more are apps in your phone.', task: 'Tap Phone to open it.',
    doneText: 'These are your apps. Jobs finds you work, Bank keeps your money, Messages keeps you in touch and Missions gives you something to aim for.' },
  { id: 'work', title: 'Work and business', targets: ['phone-dock', 'nav-phone'], allows: 'phone', keeps: 'phone',
    text: 'Jobs pays you for every shift, and a Career moves you up. Rent a stall in Business to sell for yourself, keep your money in Bank, grow it in Invest and rent Billboards to advertise.' },
  { id: 'people', title: 'Talk to people', targets: ['online', 'invite'], needs: ['online', 'invite', 'call'],
    text: (context) => `${context.has('online') ? 'Tap the green count to see who is online, then a player to chat or press Call to ring them; they choose whether to answer.' : 'Other people live here too: find one in People in your phone, then chat or press Call to ring them; they choose whether to answer.'} ${context.has('invite') ? 'Messages keeps your chats and groups, and Invite brings a friend in with your link.' : 'Messages in your phone keeps your chats and groups.'}` },
  { id: 'community', title: 'Community', targets: ['community'], needs: ['community'],
    text: 'This opens the chat of the place you are in, for everyone who is here. Join the voice circle there to talk out loud with people nearby.' },
  { id: 'done', title: 'You’re set', text: 'Need this again? Open Phone, then Help, then Take the tour. Press ? any time for the shortcuts.', action: { label: 'See the shortcuts', run: 'shortcuts' } },
]

/** The words of a step for the state it is in. */
export function wordsOf(step: TourStep, context: StepContext, done: boolean): { title: string; text: string; task: string | null } {
  const text = done && step.doneText ? step.doneText : typeof step.text === 'function' ? step.text(context) : step.text
  return { title: step.title, text, task: !done && step.task ? step.task : null }
}

/** Which steps can be shown: a step with `needs` only when one of them is on screen. A target that is missing later skips its step. */
export function playlist(steps: readonly TourStep[], context: StepContext): TourStep[] {
  return steps.filter((step) => !step.needs || step.needs.some(context.has))
}
/** Is a step lit by something that is on screen now? A step with no target is always showable (a card in the middle). */
export const showable = (step: TourStep, context: StepContext, done = false): boolean => {
  const ids = done && step.doneTargets ? step.doneTargets : step.targets
  return !ids || ids.some(context.has)
}
/**
 * The next step to show from `from` going `way` (+1 or −1), skipping the ones whose target is not on screen; -1 when
 * there is none before the end (+1: the tour is over) or the start (−1: stay).
 */
export function seek(list: readonly TourStep[], from: number, way: 1 | -1, context: StepContext): number {
  for (let at = from + way; at >= 0 && at < list.length; at += way) if (showable(list[at] as TourStep, context)) return at
  return -1
}

export interface WaitFacts { activeAction: boolean; mode: string; sheet: string | null }
/** What a step has open (it waited for it, or kept it from the step before) that the step coming next does not carry on with. */
export function closes(now: TourStep, next: TourStep | null): 'map' | 'phone' | null {
  const open = now.keeps ?? (now.wait === 'map' || now.wait === 'phone' ? now.wait : null)
  return open && next?.keeps !== open && next?.wait !== open ? open : null
}
/** Has the player done the thing a step waits for? */
export function isDone(wait: Wait | undefined, facts: WaitFacts): boolean {
  if (wait === 'activity') return facts.activeAction
  if (wait === 'map') return facts.mode === 'map'
  if (wait === 'phone') return facts.sheet === 'phone'
  return false
}

/**
 * The tour steps aside — its dim layer hidden, its step kept — while something else is in front: a sheet that is not the step's
 * own, or a call (ringing, calling or connected): an incoming call must be answerable at once, and the tour resumes when it ends.
 */
export const tourPaused = (facts: { sheet: string | null; allows: string | undefined; call: boolean }): boolean => facts.call || (facts.sheet !== null && facts.allows !== facts.sheet)
/** Layers that are urgent and interactive sit above the tour (z-index 60) and are never trapped under its dim. */
export const TOUR_Z = 60
