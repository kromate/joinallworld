/**
 * OWNER: news (docs/OPEN-SOURCE-PLAN.md, Phase 4)
 * THE TICKER'S WORDS: one small bank per register, in the shape of the conductor's and the talk banks' (docs/DANFO.md, docs/TALK-BANKS.md):
 * short lines by topic, with `{placeholders}`. Three registers: Lagos pidgin-light (the southern and middle Nigerian cities), Kano (the northern
 * Nigerian cities: Nigerian English with a few Hausa words that every Nigerian knows) and plain English everywhere else.
 *
 * Like the conductor's lines, the pidgin and Hausa-flavoured phrases are BETA and await review by fluent speakers (docs/DANFO.md). Only common
 * everyday words are used; none is a translation of a sentence from a source. Lines hold no name of a person, no price and no money amount: the
 * gist ledger's privacy rules (docs/GIST.md) cover what is passed through, and the lines written here follow the same ones.
 *
 * Pure data and two small helpers (no Vue, no DOM). Lives in src/news/, which only lazy chunks import: it is never in the first download.
 */

export type Register = 'lagos' | 'kano' | 'english'

/** What a line is about. `news`, `arrest`, `crowd` and `plain` wrap a gist line's own words in `{text}`. */
export type Topic =
  | 'stall-first' | 'stall-nth' | 'news' | 'arrest' | 'crowd' | 'plain'
  | 'outage' | 'cash' | 'goal' | 'level'
  | 'dawn' | 'morning' | 'afternoon' | 'evening' | 'night'

export type Bank = Readonly<Record<Topic, readonly string[]>>

/** How long a line holds the ticker, beyond the base cooldown, in seconds: a bigger story keeps the board longer. */
export const WEIGHT: Readonly<Record<Topic, number>> = {
  'stall-first': 2, 'stall-nth': 3, news: 5, arrest: 4, crowd: 2, plain: 3,
  outage: 6, cash: 3, goal: 2, level: 3,
  dawn: 1, morning: 1, afternoon: 1, evening: 1, night: 1,
}

const LAGOS: Bank = {
  'stall-first': ['A new {what} don open for {where}.', 'Fresh {what} for {where}: market dey grow.', 'Somebody open {what} for {where} today.'],
  'stall-nth': ['{ord} {what} don open for {where} this hour!', 'Ehen, na the {ord} {what} for {where} this hour.', 'Business dey boom: {ord} {what} for {where} this hour.'],
  news: ['Oya, news: {text}.', '{text}. Na the talk for town.', 'E don land: {text}.'],
  arrest: ['{text}. Law no dey sleep.', 'Eyah. {text}.'],
  crowd: ['{text}. Come see for yourself.', 'Gist dey ground: {text}.'],
  plain: ['{text}.', 'Make you hear am: {text}.'],
  outage: ['NEPA don take light for {district}; the generators don start.', 'Light don go for {district}. Generators dey roar.', '{district} dey dark: NEPA take light, generators wake up.'],
  cash: ['Word for street: somebody just collect good money today.', 'Alert! Somebody for {city} just have a sweet day.', 'Money dey move for {city} this minute.'],
  goal: ['Another person don tick one goal for {city}.', 'Small win for {city}: one person finish their target.', 'Somebody for {city} don hit their mark.'],
  level: ['Somebody for {city} just level up o!', 'Promotion talk: one person for {city} don move up.', 'Level up for {city}: hard work dey pay.'],
  dawn: ['Cock don crow and the first danfo dey warm up.', 'Early morning, and the street dey wake small small.', 'The sun dey climb; hawkers don hit the road.'],
  morning: ['Market people dey open shutters, make the day begin.', 'Rush hour thick: everybody dey run go work.', 'Morning don set; the go-slow don start.'],
  afternoon: ['The sun dey vex, but business no stop.', 'Afternoon heat: shade under any umbrella na gold.', 'Lunch time: buka dey full.'],
  evening: ['The suya smoke dey rise as the sun drop.', 'Evening don land; traffic dey crawl go house.', 'Pepper soup and cold drink: the evening begin.'],
  night: ['Night don fall; the generators dey sing for every street.', 'The city no dey sleep; one more bottle for the road.', 'Quiet small now, but the night shift dey on.'],
}

const KANO: Bank = {
  'stall-first': ['A new {what} has opened in {where}.', 'Fresh {what} in {where}: the market is growing.', 'Somebody has opened a {what} in {where} today, yawwa.'],
  'stall-nth': ['The {ord} {what} opens in {where} this hour!', 'Business is booming: {ord} {what} in {where} this hour.', 'Wallahi, {ord} {what} in {where} this hour.'],
  news: ['News: {text}.', '{text}. It is the talk of the city.', 'Sannu, listen: {text}.'],
  arrest: ['{text}. The law is awake.', 'Allah ya kiyaye. {text}.'],
  crowd: ['{text}. Come and see.', 'The talk in the city: {text}.'],
  plain: ['{text}.', 'Have you heard? {text}.'],
  outage: ['NEPA has taken light in {district}; the generators are starting.', 'No light in {district} again, wallahi. Generators on.', '{district} is dark: NEPA took the light, the generators wake up.'],
  cash: ['Word in the market: somebody just had a good day.', 'Somebody in {city} has money in hand today.', 'Money is moving in {city} right now, barka.'],
  goal: ['Another person in {city} has finished a goal.', 'A small win in {city}: someone reached their target.', 'Someone in {city} has hit their mark, yawwa.'],
  level: ['Somebody in {city} has moved up a level.', 'Promotion talk: one person in {city} climbs the ladder.', 'A level up in {city}: hard work pays.'],
  dawn: ['The first call to prayer has gone out over the city.', 'Early morning: the streets are waking slowly.', 'The sun climbs and the first traders reach their stalls.'],
  morning: ['The shutters of the market go up, and the day begins.', 'Morning rush: everyone is heading to work.', 'The morning is set; the roads are filling.'],
  afternoon: ['The sun is fierce, but trade does not stop.', 'Afternoon heat: shade is worth gold.', 'Lunch time, and the food sellers are busy.'],
  evening: ['The suya smoke rises as the sun drops.', 'Evening arrives and the traffic crawls home.', 'The evening begins with tea and roasted meat.'],
  night: ['Night has fallen; the generators hum on every street.', 'The city is quiet, but the night shift is on.', 'A cool night, and a few lamps still burn in the market.'],
}

const ENGLISH: Bank = {
  'stall-first': ['A new {what} has opened in {where}.', 'Fresh {what} in {where}: the market is growing.', 'Somebody has opened a {what} in {where} today.'],
  'stall-nth': ['The {ord} {what} opens in {where} this hour!', 'Business is booming: {ord} {what} in {where} this hour.', 'That is the {ord} {what} in {where} this hour.'],
  news: ['News: {text}.', '{text}. It is the talk of the city.', 'Just in: {text}.'],
  arrest: ['{text}. The law is awake.', 'Tough news: {text}.'],
  crowd: ['{text}. Come and see.', 'Out and about: {text}.'],
  plain: ['{text}.', 'Have you heard? {text}.'],
  outage: ['The power is out in {district}; the generators are starting up.', 'Lights out in {district}. Generators are coming on.', '{district} is dark: the grid is down and the generators wake up.'],
  cash: ['Word on the street: somebody just had a good day.', 'Somebody in {city} has money in hand today.', 'Money is moving in {city} right now.'],
  goal: ['Another person in {city} has finished a goal.', 'A small win in {city}: someone reached their target.', 'Someone in {city} has hit their mark.'],
  level: ['Somebody in {city} has moved up a level.', 'Promotion talk: one person in {city} climbs the ladder.', 'A level up in {city}: hard work pays.'],
  dawn: ['The first light reaches the rooftops and the first bus warms up.', 'Early morning: the streets are waking slowly.', 'The sun climbs and the first traders set up.'],
  morning: ['Shutters go up across the market and the day begins.', 'Morning rush: everyone is heading to work.', 'The morning is set; the roads are filling.'],
  afternoon: ['The sun is fierce, but trade does not stop.', 'Afternoon heat: shade is worth gold.', 'Lunch time, and the food sellers are busy.'],
  evening: ['The grill smoke rises as the sun drops.', 'Evening arrives and the traffic crawls home.', 'The evening begins with something hot and a cold drink.'],
  night: ['Night has fallen; the street lamps hum.', 'The city is quiet, but the night shift is on.', 'A cool night, and a few lights still burn in the market.'],
}

const BANKS: Readonly<Record<Register, Bank>> = { lagos: LAGOS, kano: KANO, english: ENGLISH }
export const bankOf = (register: Register): Bank => BANKS[register]

/** The northern Nigerian cities that speak in the Kano register; every other Nigerian city is Lagos pidgin-light, every other country plain English. */
const NORTH: ReadonlySet<string> = new Set(['kano', 'kaduna', 'katsina', 'sokoto', 'birnin-kebbi', 'maiduguri', 'bauchi', 'gombe', 'yola', 'jalingo', 'damaturu', 'dutse', 'jos', 'minna', 'lafia'])
/** The register of a city. `country` is the city's country id (`ng` for Nigeria); an unknown one reads as plain English. */
export function registerFor(city: string, country: string | null | undefined): Register {
  if (NORTH.has(city)) return 'kano'
  return country === 'ng' ? 'lagos' : 'english'
}

/** 1st, 2nd, 3rd, 4th ... 11th, 12th, 13th ... 21st. */
export function ordinal(n: number): string {
  const whole = Math.max(1, Math.floor(n)), last = whole % 100
  if (last >= 11 && last <= 13) return `${whole}th`
  return `${whole}${['th', 'st', 'nd', 'rd'][whole % 10] ?? 'th'}`
}

/** A line with its `{placeholders}` filled; a placeholder with no value is left out along with nothing else changing (the tests keep the banks complete). */
export function fill(line: string, values: Readonly<Record<string, string | number>>): string {
  return line.replace(/\{(\w+)\}/g, (whole, key: string) => (key in values ? String(values[key]) : whole))
}
