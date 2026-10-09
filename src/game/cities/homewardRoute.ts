import type { CityLinkFrom } from '../../types/content.ts'
import { RIDE_CREDIT } from '../content/relief.ts'
import { intercitySeconds } from '../content/travel.ts'
import { routeUnavailable } from './routeAvailability.ts'

export interface HomewardLeg {
  readonly from: string
  readonly to: string
  readonly mode: CityLinkFrom['mode']
  readonly fare: number
  readonly seconds: number
}

export interface HomewardQuote {
  readonly version: 1
  readonly from: string
  readonly to: string
  readonly legs: readonly HomewardLeg[]
  readonly totalFare: number
  readonly totalSeconds: number
  readonly key: string
}

export type HomewardLinksFrom = (cityId: string) => readonly CityLinkFrom[]
export type HomewardIsOpen = (cityId: string) => boolean

export const MAX_HOMEWARD_LEGS = 4
const VERSION = 1 as const

const validAmount = (value: number): boolean => Number.isSafeInteger(value) && value > 0
const validMode = (value: unknown): value is CityLinkFrom['mode'] => value === 'road' || value === 'air' || value === 'rail'
const modeMaxSeconds = { road: intercitySeconds('road', Number.MAX_VALUE), rail: intercitySeconds('rail', Number.MAX_VALUE), air: intercitySeconds('air', Number.MAX_VALUE) }
export const MAX_HOMEWARD_LEG_SECONDS = Object.freeze(modeMaxSeconds)
export const MAX_HOMEWARD_SECONDS = MAX_HOMEWARD_LEGS * Math.max(...Object.values(modeMaxSeconds))
const legKey = (leg: HomewardLeg): string => JSON.stringify([leg.from, leg.to, leg.mode, leg.fare, leg.seconds])

export function homewardQuoteKey(from: string, to: string, legs: readonly HomewardLeg[]): string {
  return JSON.stringify([VERSION, from, to, legs.map(legKey)])
}

function better(candidate: HomewardQuote, current: HomewardQuote | null): boolean {
  return current === null
    || candidate.totalFare < current.totalFare
    || (candidate.totalFare === current.totalFare && candidate.totalSeconds < current.totalSeconds)
    || (candidate.totalFare === current.totalFare && candidate.totalSeconds === current.totalSeconds && candidate.key < current.key)
}

interface SearchState {
  readonly city: string
  readonly totalFare: number
  readonly totalSeconds: number
  readonly legs: readonly HomewardLeg[]
  readonly visited: ReadonlySet<string>
}

function stateKey(state: SearchState, from: string, to: string): string {
  return homewardQuoteKey(from, to, state.legs)
}

function betterState(candidate: SearchState, current: SearchState | undefined, from: string, to: string): boolean {
  return current === undefined
    || candidate.totalFare < current.totalFare
    || (candidate.totalFare === current.totalFare && candidate.totalSeconds < current.totalSeconds)
    || (candidate.totalFare === current.totalFare && candidate.totalSeconds === current.totalSeconds
      && stateKey(candidate, from, to) < stateKey(current, from, to))
}

/** Plans a bounded, cheapest real route from a visitor's current city to their distinct main home. */
export function planHomewardRoute(
  from: string,
  to: string,
  linksFrom: HomewardLinksFrom,
  isOpen: HomewardIsOpen,
): HomewardQuote | null {
  if (!from || !to || from === to || !isOpen(from) || !isOpen(to)) return null

  const outgoing = new Map<string, readonly CityLinkFrom[]>()
  const getLinks = (city: string): readonly CityLinkFrom[] => {
    const cached = outgoing.get(city)
    if (cached) return cached
    const links = [...linksFrom(city)].sort((left, right) =>
      left.fare - right.fare || left.seconds - right.seconds || String(left.to).localeCompare(String(right.to)) || String(left.mode).localeCompare(String(right.mode)))
    outgoing.set(city, links)
    return links
  }

  const layers: Array<Map<string, SearchState>> = Array.from({ length: MAX_HOMEWARD_LEGS + 1 }, () => new Map())
  layers[0]!.set(from, { city: from, totalFare: 0, totalSeconds: 0, legs: [], visited: new Set([from]) })
  let best: HomewardQuote | null = null

  for (let legCount = 0; legCount < MAX_HOMEWARD_LEGS; legCount += 1) {
    const states = [...layers[legCount]!.values()].sort((a, b) => a.city.localeCompare(b.city))
    for (const state of states) {
      for (const link of getLinks(state.city)) {
        const next = link.to
        if (typeof next !== 'string' || !next || state.visited.has(next) || !isOpen(next) || routeUnavailable(link)) continue
        if (!validMode(link.mode) || !validAmount(link.fare) || !validAmount(link.seconds) || link.seconds > modeMaxSeconds[link.mode]) continue
        const totalFare = state.totalFare + link.fare
        const totalSeconds = state.totalSeconds + link.seconds
        if (!Number.isSafeInteger(totalFare) || totalFare > RIDE_CREDIT.max || !Number.isSafeInteger(totalSeconds) || totalSeconds > MAX_HOMEWARD_SECONDS) continue

        const leg: HomewardLeg = { from: state.city, to: next, mode: link.mode, fare: link.fare, seconds: link.seconds }
        const candidate: SearchState = {
          city: next,
          totalFare,
          totalSeconds,
          legs: [...state.legs, leg],
          visited: new Set([...state.visited, next]),
        }
        if (next === to) {
          const path = Object.freeze(candidate.legs.map(item => Object.freeze({ ...item })))
          const quote: HomewardQuote = Object.freeze({ version: VERSION, from, to, legs: path, totalFare, totalSeconds, key: homewardQuoteKey(from, to, path) })
          if (better(quote, best)) best = quote
          continue
        }
        const layer = layers[legCount + 1]!
        if (betterState(candidate, layer.get(next), from, to)) layer.set(next, candidate)
      }
    }
  }
  return best
}
