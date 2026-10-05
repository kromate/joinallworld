// "Make this life yours" without a DOM: which card a life starts on, the look kept on the device
// while it is edited, why the sheet opened, what each card's one primary action says and what is
// still missing, and the sentence a refused step shows. Every step is confirmed by a server action
// (src/game/systems/onboarding.ts); the screen only keeps the draft being edited.
import { APPEARANCE, DREAM_REWARD, TRAITS_REQUIRED } from '../../../game/content/traits.ts'
import type { DreamId, Look, StartHomeId, TraitId } from '../../../types/life.ts'
import { hairOptions, outfitOptions, slotOf, starterWardrobe } from './lookModel.ts'
import { money } from '../../ui/format.ts'
import { cityUnit } from '../../../game/cities/terminology.ts'

export const DRAFT_KEY = 'joinallworld-look-draft'
/** The index of the Home card: the last of ONBOARDING_STEPS. */
export const LAST_STEP = 4
/** The first card a life sees: a guest's look is already chosen. */
export const firstStep = (guest: boolean): number => (guest ? 1 : 0)

/** Where a life that moved in lives: the local government it chose, and how it was found. */
export interface AreaChoice { lga: string; via: 'device' | 'manual' }
/** The settle-in draft: what is being edited, sent card by card. */
export interface Draft { look: Look; traits: TraitId[]; dream: DreamId | null; house: StartHomeId | null; extra: { area?: AreaChoice } }

// ---- the look kept on the device ------------------------------------------------------------
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>
const deviceStorage = (): Storage | null => { try { return globalThis.localStorage ?? null } catch { return null } }

/** The look kept on this device for `key`, if every part of it is still a valid choice. */
export function storedLook(key: string, storage: Storage | null = deviceStorage()): Look | null {
  try {
    const saved = JSON.parse(storage?.getItem(DRAFT_KEY) || 'null') as { owner?: string; look?: Record<string, unknown> } | null
    const look = saved?.owner === key ? saved.look as Partial<Look> | undefined : undefined
    if (!look || !APPEARANCE.bodies.some((body) => body.id === look.body) || !look.body) return null
    const has = (group: 'skin' | 'hairColours' | 'outfitColours', id: unknown): boolean => APPEARANCE[group].some((swatch) => swatch.id === id)
    const free = starterWardrobe()
    const extras = Array.isArray(look.accessories) ? look.accessories : []
    const slots = new Set(extras.map((id) => slotOf(id)))
    const valid = hairOptions(look.body).includes(look.hair as string) && (free.hair as string[]).includes(look.hair as string) && outfitOptions(look.body).includes(look.outfit as string) && (free.outfit as string[]).includes(look.outfit as string)
      && (APPEARANCE.fabrics as string[]).includes(look.fabric as string)
      && has('skin', look.skin) && has('hairColours', look.hairColor) && has('outfitColours', look.outfitColor) && has('outfitColours', look.bottomsColor)
      && extras.length <= APPEARANCE.accessoryLimit && extras.every((id) => (free.accessories as string[]).includes(id)) && slots.size === extras.length
    if (!valid) return null
    return {
      body: look.body, hair: look.hair as Look['hair'], outfit: look.outfit as Look['outfit'], fabric: look.fabric as Look['fabric'], skin: look.skin as Look['skin'],
      hairColor: look.hairColor as Look['hairColor'], outfitColor: look.outfitColor as Look['outfitColor'], bottomsColor: look.bottomsColor as Look['bottomsColor'],
      accessories: [...extras], face: (APPEARANCE.faces as string[]).includes(look.face as string) ? look.face as Look['face'] : APPEARANCE.faces[0] as Look['face'],
      expression: (APPEARANCE.expressions as string[]).includes(look.expression as string) ? look.expression as Look['expression'] : APPEARANCE.expressions[0] as Look['expression'],
    }
  } catch { return null }
}
/** Keep the look being edited (or forget it, with null). A device without storage keeps the draft in memory only. */
export function keepLook(owner: string | null, look: Look | null, storage: Storage | null = deviceStorage()): void {
  try { if (look) storage?.setItem(DRAFT_KEY, JSON.stringify({ owner, look })); else storage?.removeItem(DRAFT_KEY) } catch { /* storage is off: the draft still lives in memory */ }
}

// ---- why the sheet opened -------------------------------------------------------------------
export interface Intro { kind: 'why' | 'reward' | 'nudge'; strong: string; text: string }
/** params of the sheet: { nudge?: 'first-reward' | 'third-activity' | 'next-day', why?: 'home' | 'buy' }. */
export function reasonOf(params: unknown): { why?: string; nudge?: string } {
  const value = params && typeof params === 'object' ? params as { why?: unknown; nudge?: unknown } : {}
  return { ...(typeof value.why === 'string' && value.why ? { why: value.why } : {}), ...(typeof value.nudge === 'string' && value.nudge ? { nudge: value.nudge } : {}) }
}
/** Said once at the top of a guest's sheet: the home-only thing that was tapped, or the reward that was just earned. */
export function introFor(params: unknown, facts: { guest: boolean; name: string; cash: number; stars: number }): Intro | null {
  if (!facts.guest) return null
  const { why, nudge } = reasonOf(params)
  if (why) return { kind: 'why', strong: 'Settle in to get your home.', text: `${why === 'buy' ? 'Buy mode furnishes your own room.' : 'You are a guest in the city for now.'} A few quick choices and it is yours — everything you have earned is kept.` }
  if (nudge === 'first-reward') return { kind: 'reward', strong: `Nice start, ${facts.name}! You have ${money(facts.cash)} and ${facts.stars} ${facts.stars === 1 ? 'star' : 'stars'}.`, text: 'Save this character: a few quick choices give it traits, a dream, start cash and a home. Everything you have earned is kept.' }
  if (nudge) return { kind: 'nudge', strong: 'Ready to make this life yours?', text: `A few quick choices give ${facts.name} traits, a dream, start cash and a home. Everything you have earned is kept.` }
  return null
}
/** The funnel event's trigger. */
export const triggerOf = (params: unknown): string => { const { why, nudge } = reasonOf(params); return nudge ?? why ?? 'asked' }

// ---- the cards' one primary action ----------------------------------------------------------
export type FootAction = 'look' | 'traits' | 'dream' | 'lottery' | 'to-home' | 'home'
export interface Foot { label: string; action: FootAction; disabled: boolean; why: string }

export const lookFoot = (connected: boolean, short: string): Foot => ({
  label: 'Looks good — next: personality', action: 'look', disabled: false,
  why: connected ? 'Still to choose: 2 traits, a dream, the birth lottery and a home.' : `${short || 'Not connected'}: your look is kept on this device and is saved when you are connected again.`,
})
export function traitsFoot(chosen: number): Foot {
  const left = TRAITS_REQUIRED - chosen
  return { label: left > 0 ? `Choose ${left} more` : 'Next: your dream', action: 'traits', disabled: left > 0, why: left > 0 ? `${chosen} of ${TRAITS_REQUIRED} traits chosen.` : '' }
}
export const dreamFoot = (dream: DreamId | null): Foot => ({ label: dream ? 'Next: birth lottery' : 'Choose a dream', action: 'dream', disabled: !dream, why: dream ? '' : 'Tap one of the dreams above to continue.' })
export const lotteryFoot = (rolled: boolean): Foot => (rolled ? { label: 'Choose where to live', action: 'to-home', disabled: false, why: '' } : { label: 'Roll the birth lottery', action: 'lottery', disabled: false, why: '' })
/** What is still missing on the Home card ('' when nothing). */
export const homeMissing = (area: AreaChoice | undefined, cityId = 'lagos'): string => (area?.lga ? '' : `Choose your ${cityUnit(cityId)} to continue.`)
export function homeFoot(missing: string, areaName: string, cityId = 'lagos'): Foot {
  return { label: missing ? `Choose your ${cityUnit(cityId)}` : `Move in${areaName ? ` to ${areaName}` : ''}`, action: 'home', disabled: Boolean(missing), why: missing }
}
/** The sentence about the wallet on the Home card for a guest who has already earned something. */
export function keptCash(facts: { guest: boolean; cash: number; seed: number; start: number | null }): string {
  const { guest, cash, seed, start } = facts
  return guest && cash !== seed && start !== null ? ` You keep the ${money(cash)} you have now: start cash tops your wallet up to ${money(Math.max(start, seed) + cash - seed)}.` : ''
}
/** What the server is asked besides where to live: the local government the player chose, and "stay here". */
export function homePayload(area: AreaChoice | undefined, stay: boolean): Record<string, unknown> {
  return { ...(area?.lga ? { lga: area.lga, via: area.via === 'device' ? 'device' : 'manual' } : {}), ...(stay ? { stay: true } : {}) }
}

/** A trait picked or put back; a third pick swaps out the first. */
export const toggleTrait = (traits: readonly TraitId[], id: TraitId): TraitId[] => (traits.includes(id) ? traits.filter((other) => other !== id) : [...traits, id].slice(-TRAITS_REQUIRED))

/** The sentence under a step the server refused (or could not be reached for). */
export function failureText(result: { code: string; reason?: string | undefined }, connected: boolean, why: string | undefined): string {
  return result.code === 'offline' || !connected
    ? `${why || 'The game server did not answer.'} This step cannot be saved yet. Nothing is lost — try again when you are connected.`
    : result.reason || 'That could not be saved. Check your connection and try again.'
}

/** Dream reward line, for the card's lead. */
export const dreamLead = (): string => `Choose a dream — reaching it pays ${money(DREAM_REWARD.cash)} and ${DREAM_REWARD.stars} stars.`
