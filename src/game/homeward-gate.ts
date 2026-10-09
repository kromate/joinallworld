/** Load the route planner and frozen ticket reader before rebuilding a life that may use them. */
import type { HomewardLinksFrom, HomewardIsOpen, HomewardQuote } from './cities/homewardRoute.ts'
import type { SavedActiveAction } from '../types/registry.ts'
import type { HomewardTicket, LifeContext, LifeState } from '../types/life.ts'

interface HomewardRules {
  planHomewardRoute(from: string, to: string, links: HomewardLinksFrom, open: HomewardIsOpen): HomewardQuote | null
  readHomewardTicket(value: SavedActiveAction, state: LifeState, ctx: LifeContext): HomewardTicket | null
}
let rules: HomewardRules | null = null
let loading: Promise<void> | null = null
export const HOMEWARD_V1_MAX_FARE = 1_000_000

export function installHomewardRules(next: HomewardRules): void {
  if (typeof next.planHomewardRoute !== 'function' || typeof next.readHomewardTicket !== 'function') {
    throw new TypeError('The homeward rules are incomplete.')
  }
  rules = { planHomewardRoute: next.planHomewardRoute, readHomewardTicket: next.readHomewardTicket }
}

export function planHomeward(...args: Parameters<HomewardRules['planHomewardRoute']>): HomewardQuote | null {
  if (!rules) throw new TypeError('Homeward route rules have not loaded.')
  return rules.planHomewardRoute(...args)
}

export function readHomewardTicket(...args: Parameters<HomewardRules['readHomewardTicket']>): HomewardTicket | null {
  if (!rules) throw new TypeError('Homeward ticket rules have not loaded; preserve the saved life for retry.')
  return rules.readHomewardTicket(...args)
}

const record = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
const own = (value: Record<string, unknown>, key: string): unknown => {
  const property = Object.getOwnPropertyDescriptor(value, key)
  return property?.enumerable && Object.hasOwn(property, 'value') ? property.value : undefined
}

/** Conservative loading hints only; the installed rules still validate every field and decide eligibility. */
export function hasHomewardMarker(raw: unknown): boolean {
  try {
    if (!record(raw)) return false
    const active = own(raw, 'activeAction')
    return record(active) && own(active, 'kind') === 'homeward'
  } catch { return false }
}

/** A present malformed liability is never evidence that an issued loan was repaid. */
export function assertHomewardLiability(raw: unknown): void {
  if (!hasHomewardMarker(raw) || !record(raw)) return
  const travel = own(raw, 'travel')
  const debt = record(travel) ? Object.getOwnPropertyDescriptor(travel, 'rideDebt') : undefined
  if (!record(travel) || (debt && (!debt.enumerable || !Object.hasOwn(debt, 'value')
    || typeof debt.value !== 'number' || !Number.isSafeInteger(debt.value) || debt.value < 0 || debt.value > HOMEWARD_V1_MAX_FARE))) {
    throw new TypeError('The trusted homeward ticket has an unusable saved ride debt; preserve the stored life for recovery.')
  }
}

function needsHomewardRules(raw: unknown): boolean {
  try {
    if (!record(raw)) return false
    if (hasHomewardMarker(raw)) return true
    const onboarding = own(raw, 'onboarding')
    if (record(onboarding) && own(onboarding, 'done') !== true
      && (own(onboarding, 'required') === true || own(onboarding, 'stage') === 'guest')) return false
    const travel = own(raw, 'travel')
    const debt = record(travel) ? own(travel, 'rideDebt') : undefined
    if (typeof debt === 'number' && Number.isSafeInteger(debt) && debt > 0) return false
    const estate = own(raw, 'estate')
    if (!record(estate)) return false
    const home = own(estate, 'home')
    if (typeof home === 'string' && home !== own(estate, 'city')) return true
    // Legacy saves may infer the main home from an away residence during estate sanitization.
    const away = own(estate, 'away')
    return record(away) && Object.keys(away).some(key => {
      const residence = own(away, key)
      return record(residence) && typeof own(residence, 'lga') === 'string'
    })
  } catch { return false }
}

export function homewardFor(raw: unknown): Promise<void> | null {
  if (rules || !needsHomewardRules(raw)) return null
  loading ??= import('./homeward-rules.ts').then(installHomewardRules).catch(error => {
    loading = null
    throw error
  })
  return loading
}
