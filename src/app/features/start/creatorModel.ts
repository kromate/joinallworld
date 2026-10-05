// The character creator without a DOM: which steps a player sees, where each kind of player starts,
// what each step still needs, what the stage looks at while a tab is open, and the list of server
// actions that turns the choices on screen into a settled life. Every step is still confirmed by
// the existing onboarding actions (src/game/systems/onboarding.ts); nothing here decides a rule.
import { DREAMS, TRAITS, TRAITS_REQUIRED } from '../../../game/content/traits.ts'
import type { PreviewFocus } from '../../../scene/avatar-preview.ts'
import type { DreamId, Look, OnboardingState, TraitId } from '../../../types/life.ts'
import type { AreaChoice } from './onboardingModel.ts'
import { sameLook } from './lookModel.ts'

export type StepId = 'who' | 'look' | 'spirit' | 'home' | 'ready'
/** 'new': a device with no life yet (the landing); 'settle': a guest, or a life without a character, finishing it. */
export type CreatorMode = 'new' | 'settle'
export interface StepDef { id: StepId; label: string; title: string; lead: string }

export const STEPS: readonly StepDef[] = [
  { id: 'who', label: 'You', title: 'Who are you?', lead: 'Start from a character you like. Every part of it can change on the next step.' },
  { id: 'look', label: 'Look', title: 'Make it yours', lead: 'Change anything. The character on the left follows every choice, and you can turn it around.' },
  { id: 'spirit', label: 'Spirit', title: 'What drives you?', lead: 'Two traits and a dream shape how your life plays out. We picked some for you: keep them, or choose your own.' },
  { id: 'home', label: 'Home', title: 'Where do you live?', lead: 'Everyone gets their own free starter house on a plot of their own. Pick the area it stands in.' },
  { id: 'ready', label: 'Ready', title: 'Ready to start your life?', lead: 'This is you. Everything can still be changed later, in your character’s profile.' },
]
export const stepDef = (id: StepId): StepDef => STEPS.find((step) => step.id === id) ?? STEPS[0] as StepDef

/** The steps a player goes through: a life that already has its name has no "Who are you?". */
export const stepsFor = (mode: CreatorMode): readonly StepDef[] => (mode === 'new' ? STEPS : STEPS.filter((step) => step.id !== 'who'))

/**
 * Where a player starts: a new device on the first step; a guest on the first thing the server still
 * waits for (its look was confirmed at Play, so the personality); a life that never had a character on the look.
 */
export function startStep(mode: CreatorMode, saved: Pick<OnboardingState, 'step' | 'traits' | 'dream'>): StepId {
  if (mode === 'new') return 'who'
  if (saved.step <= 0) return 'look'
  return 'spirit'
}

export interface Progress { index: number; count: number; label: string; percent: number }
/** "Step 2 of 5": the position of a step among the steps this player sees. */
export function progressOf(steps: readonly StepDef[], current: StepId): Progress {
  const at = Math.max(0, steps.findIndex((step) => step.id === current))
  return { index: at + 1, count: steps.length, label: steps[at]?.label ?? '', percent: Math.round(((at + 1) / Math.max(1, steps.length)) * 100) }
}
export const nextStep = (steps: readonly StepDef[], current: StepId): StepId | null => steps[steps.findIndex((step) => step.id === current) + 1]?.id ?? null
export const previousStep = (steps: readonly StepDef[], current: StepId): StepId | null => steps[steps.findIndex((step) => step.id === current) - 1]?.id ?? null

/** What the primary button of a step says, and why it is not available yet ('' when it is). */
export function nextLabel(steps: readonly StepDef[], current: StepId): string {
  const next = nextStep(steps, current)
  return next ? `Next: ${stepDef(next).label}` : 'Start your life'
}
export function stepBlocked(step: StepId, facts: { nameProblem: string | null; area: AreaChoice | undefined; traits: number }): string {
  if (step === 'who') return facts.nameProblem ?? ''
  if (step === 'spirit') return facts.traits < TRAITS_REQUIRED ? `Choose ${TRAITS_REQUIRED - facts.traits} more ${TRAITS_REQUIRED - facts.traits === 1 ? 'trait' : 'traits'}, or tap Pick for me.` : ''
  if (step === 'home' || step === 'ready') return facts.area?.lga ? '' : 'Choose where you live: find your area, or pick one from the list.'
  return ''
}

// ---- the stage -------------------------------------------------------------------------------
export interface FocusChoice { id: PreviewFocus; label: string }
/** The three views of the stage's zoom control. */
export const FOCUS_CHOICES: readonly FocusChoice[] = [{ id: 'body', label: 'Body' }, { id: 'head', label: 'Face' }, { id: 'outfit', label: 'Outfit' }]
/** What the stage looks at while a tab of the look editor is open (a manual choice wins until the next tab). */
export function focusForTab(tab: string): PreviewFocus {
  if (tab === 'hair') return 'head'
  if (tab === 'outfit' || tab === 'colours') return 'outfit'
  return 'body'
}
/** The same for the field that was just changed: hair, skin tone and face come up close. */
export function focusForField(field: string): PreviewFocus | null {
  if (['hair', 'hairColor', 'skin', 'face', 'expression'].includes(field)) return 'head'
  if (['outfit', 'fabric', 'outfitColor', 'bottomsColor'].includes(field)) return 'outfit'
  return null
}

// ---- undo and reset ----------------------------------------------------------------------------
export const HISTORY_LIMIT = 30
/** The looks to go back to: the last `HISTORY_LIMIT` before the current one; a change to the same look is not recorded. */
export function pushHistory(history: readonly Look[], previous: Look, next: Look): Look[] {
  if (sameLook(previous, next)) return [...history]
  return [...history, previous].slice(-HISTORY_LIMIT)
}

// ---- defaults ---------------------------------------------------------------------------------
/** Two different traits and a dream, drawn with `random`: what a player who skips the step gets. */
export function defaultSpirit(random: () => number = Math.random): { traits: TraitId[]; dream: DreamId } {
  const ids = Object.keys(TRAITS) as TraitId[]
  const first = ids[Math.floor(random() * ids.length) % ids.length] as TraitId
  const rest = ids.filter((id) => id !== first)
  const second = rest[Math.floor(random() * rest.length) % rest.length] as TraitId
  const dreams = Object.keys(DREAMS) as DreamId[]
  return { traits: [first, second], dream: dreams[Math.floor(random() * dreams.length) % dreams.length] as DreamId }
}

// ---- the actions that settle a life ------------------------------------------------------------
export type SettleType = 'onboarding.look' | 'onboarding.traits' | 'onboarding.dream' | 'onboarding.lottery' | 'onboarding.home'
export interface SettleAction { type: SettleType; payload: Record<string, unknown>; label: string }
export interface SettleInput {
  saved: Pick<OnboardingState, 'step' | 'look' | 'traits' | 'dream' | 'lottery'>
  draft: { look: Look; traits: readonly TraitId[]; dream: DreamId | null; area: AreaChoice | undefined }
  /** Move in without leaving the venue the Sim is in. */
  stay?: boolean
}
const sameTraits = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && [...a].sort().join() === [...b].sort().join()

/**
 * The server actions that take the saved life to a settled one, in order, skipping what the server already holds:
 * the look (when it was changed, or never confirmed), the two traits, the dream, the birth lottery (rolled once, for the
 * player, because it only decides start cash) and the move-in with the local government. null = something is missing.
 */
export function settlePlan({ saved, draft, stay = false }: SettleInput): SettleAction[] | null {
  if (!draft.area?.lga || draft.traits.length !== TRAITS_REQUIRED || !draft.dream) return null
  const plan: SettleAction[] = []
  if (saved.step <= 0 || !sameLook(saved.look, draft.look)) plan.push({ type: 'onboarding.look', payload: { look: draft.look }, label: 'Saving your look…' })
  if (!sameTraits(saved.traits, draft.traits)) plan.push({ type: 'onboarding.traits', payload: { traits: [...draft.traits] }, label: 'Choosing your traits…' })
  if (saved.dream !== draft.dream) plan.push({ type: 'onboarding.dream', payload: { dream: draft.dream }, label: 'Choosing your dream…' })
  if (!saved.lottery) plan.push({ type: 'onboarding.lottery', payload: {}, label: 'Rolling your birth lottery…' })
  plan.push({ type: 'onboarding.home', payload: { lga: draft.area.lga, via: draft.area.via === 'device' ? 'device' : 'manual', ...(stay ? { stay: true } : {}) }, label: 'Moving you in…' })
  return plan
}
