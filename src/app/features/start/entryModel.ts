// The entry page's decisions without a DOM: whether a visitor is shown it or goes straight to the creator, what its live line and
// its pitch say, and the words of the "Connect an AI agent" sheet. Every number is read from what the page already has (the city
// catalogue and the live count); none is written here.
import type { CityCatalogueEntry } from '../../../game/cities/catalogue.ts'

/** What decides whether a visitor starts on the entry page. */
export interface EntryFacts {
  /** The creator was reopened with a refusal (a name that was not allowed, a full world): it is shown at once, as before. */
  problem: boolean
  /** The address is a short address, /unilag or /signup: the creator carries the line for it. */
  pathAddress: boolean
  /** The device kept a character that was being edited (a name typed or a shuffle pressed). */
  editing: boolean
  /** A Play of the creator is on its way (the creator screen was rebuilt while it was). */
  sending: boolean
}
/** True for the entry page; false when the creator is shown straight away (unchanged behaviour for every one of those). */
export const entryShown = (facts: EntryFacts): boolean => !facts.problem && !facts.pathAddress && !facts.editing && !facts.sending

export { isEntryAddress, isPathAddress } from './pathAddress.ts'

/** What the catalogue says: how many cities are open and in how many countries. */
export function worldFigures(catalogue: readonly Pick<CityCatalogueEntry, 'open' | 'countryISO' | 'countryName'>[]): { cities: number; countries: number } {
  const open = catalogue.filter((city) => city.open)
  const countries = new Set(open.map((city) => city.countryISO ?? city.countryName ?? 'NG'))
  return { cities: open.length, countries: countries.size }
}

const whole = (value: number | null | undefined): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0)
const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many)

/** Below this many online the pill names only the places: "1 in Allworld now" tells a first-time visitor the world is empty. */
export const LIVE_FLOOR = 5

/** The line in the pill: "128 in Allworld now · 60 cities, 21 countries and territories". No count until the page has one of at least LIVE_FLOOR. */
export function liveLine(online: number | null, figures: { cities: number; countries: number }): string {
  const world = `${figures.cities} ${plural(figures.cities, 'city', 'cities')}, ${figures.countries} ${plural(figures.countries, 'country or territory', 'countries and territories')}`
  const here = whole(online)
  return here >= LIVE_FLOOR ? `${here.toLocaleString('en-US')} in Allworld now · ${world}` : world
}

/** What a seller does, in order: the line shown up front on /shops and /services. */
export const SETUP_STEPS: readonly string[] = Object.freeze(['Set up now', 'Sign up to save it', 'Goes live once checked'])
/** What publishing a shop needs, as the server enforces it (server/showcase/service.ts gate, src/game/trust/tiers.ts, SHOWCASE.photosMin). */
export const SETUP_NEEDS: readonly string[] = Object.freeze([
  'A free account, so your shop is saved.',
  'A checked phone number.',
  'An account at least a day old.',
  'Your word that you are 18 or older.',
  'Three photos of your goods or work (up to six).',
  'A quick approval before it goes live.',
  'Prices are yours and are paid outside Allworld: it never holds your money.',
])

/** The public place to read about agents, and the public Agent league. */
export const AGENT_DOCS_URL = 'https://github.com/kromate/joinallworld/blob/main/docs/AGENTS.md'
export const AGENT_LEAGUE_PATH = '/agents/league'
export const SOURCE_URL = 'https://github.com/kromate/joinallworld'

export interface AgentChoice { id: 'mine' | 'own'; title: string; text: string }
/** The sheet's words (docs/AGENTS.md carries the same text). */
export const AGENT_WORDS = Object.freeze({
  title: 'Connect an AI agent',
  intro: 'Your own AI assistant can play Allworld for you. It reads your life and takes actions like travelling, working and eating, through a standard agent-tool connection.',
  rules: Object.freeze([
    'Characters played by an agent are labelled, so everyone knows who is who.',
    'You can disconnect an agent at any time.',
  ]),
  start: 'Set up',
  startText: 'Starting opens Settings at the AI agents section, where you make the key your agent connects with.',
  league: 'See the Agent league',
  docs: 'Read how it works',
  close: 'Close',
})
export const AGENT_CHOICES: readonly AgentChoice[] = Object.freeze([
  { id: 'mine', title: 'Let an agent play my character', text: 'Your agent acts as you. You keep playing too, and you can take over or disconnect whenever you like.' },
  { id: 'own', title: 'Give an agent its own character', text: 'The agent gets a new character of its own, clearly labelled as an agent, living beside you in the same world.' },
])
