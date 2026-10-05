// The tour: its steps, which of them can be shown right now, and when a step that waits for the player is done.
// Pure (the page is passed in as `has`), so the sequencing is tested without a browser.
import type { Side } from './placement.ts'
import { capOf } from './shortcutsModel.ts'

/** What the player has to do for a step to be done: start an activity, open the map, open the phone. */
export type Wait = 'activity' | 'map' | 'phone'

export interface StepContext {
  /** The player stands in their own home. */
  home: boolean
  /** A device without a keyboard or a mouse. */
  touch: boolean
  /** Is a `data-tour` target on screen? */
  has: (id: string) => boolean
}
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
  prefer?: Side
  keys?: (context: StepContext) => KeyRow[]
  /** The last card: an extra button. */
  action?: { label: string; run: 'shortcuts' }
}

const text = (home: string, away: string) => (context: StepContext): string => (context.home ? home : away)

export const STEPS: readonly TourStep[] = [
  { id: 'welcome', title: 'Welcome to Allworld', text: 'Let me show you around. It takes a minute, and you can skip any time.' },
  { id: 'needs', title: 'Your needs', targets: ['needs'], prefer: 'bottom', text: 'These bars show how you are doing: energy, food and more. They fall slowly as time passes. Tap your avatar any time to see them in full.' },
  { id: 'hud', title: 'Time, mood and cash', targets: ['hud'], prefer: 'bottom', text: 'The clock shows the day and the hour, with your mood beside it. Your cash is on the right: tap it to open your Bank.' },
  { id: 'goal', title: 'Your next step', targets: ['goal'], text: 'This line always tells you what to do next. Tap it and it takes you there.' },
  { id: 'place', title: 'Spots and activities', targets: ['place'], expand: true, wait: 'activity', advance: true, prefer: 'top',
    text: text('Your home has spots too. Pick one, then tap something to do. Each one runs on a timer and finishes even if you close the tab.', 'Every place has spots to stand at. Pick one, then tap an activity. Each one runs on a timer and finishes even if you close the tab.'),
    task: 'Try one now: tap an activity.' },
  { id: 'move', title: 'Getting around', prefer: 'center',
    text: (context) => (context.touch ? 'Drag the stick to walk, or tap where you want to go. Drag anywhere to look around and pinch to zoom.' : 'Walk with the keys, or click where you want to go. Drag to look around and scroll to zoom.'),
    keys: (context) => (context.touch ? [] : [{ caps: ['walk:up', 'walk:left', 'walk:down', 'walk:right'].map(capOf), text: 'Walk' }, { caps: [capOf('walk:jog')], text: 'Hold to jog' }, { caps: ['Click'], text: 'Walk there' }, { caps: ['Drag'], text: 'Look around' }, { caps: ['Scroll'], text: 'Zoom' }]) },
  { id: 'map', title: 'The Map', targets: ['nav-map'], doneTargets: ['map-card'], wait: 'map',
    text: 'Travel from here to anywhere in the city.', task: 'Tap Map to open it.',
    doneText: 'Pick a place to see the trip first: how long it takes, and what each way of travelling costs. The world atlas shows the bigger picture, and more places are opening.' },
  { id: 'phone', title: 'Your phone', targets: ['nav-phone'], doneTargets: ['phone-apps'], wait: 'phone', allows: 'phone',
    text: 'Jobs, Bank, Messages, Missions and more are apps in your phone.', task: 'Tap Phone to open it.',
    doneText: 'These are your apps. Jobs finds you work, Bank keeps your money, Messages keeps you in touch and Missions gives you something to aim for.' },
  { id: 'people', title: 'People', targets: ['online', 'community'], needs: ['online', 'community', 'invite', 'call'],
    text: (context) => `Other people live here too. Open Community to talk to whoever is around.${context.has('call') ? ' Call a friend when they are online.' : ''}${context.has('invite') ? ' Tap Invite to bring a friend with your link.' : ''}` },
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
/** Has the player done the thing a step waits for? */
export function isDone(wait: Wait | undefined, facts: WaitFacts): boolean {
  if (wait === 'activity') return facts.activeAction
  if (wait === 'map') return facts.mode === 'map'
  if (wait === 'phone') return facts.sheet === 'phone'
  return false
}
