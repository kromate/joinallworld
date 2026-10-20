/**
 * OWNER: news (docs/OPEN-SOURCE-PLAN.md, Phase 4)
 * WHAT A REGULAR SAYS WHEN THEY REMEMBER YOU: thirty short lines for each kind of memory (ten in each register: Lagos pidgin-light, Kano,
 * plain English), one chosen by who the regular is, so the same person says the same thing all day. Like the conductor's lines
 * (docs/DANFO.md) the pidgin and Hausa-flavoured phrases are BETA and await review by fluent speakers; only everyday words are used.
 * Fetched only when a regular in the scene turns out to remember the player (acquaintance.ts), never with the first page.
 */
import { cityRules } from '../game/cities/registry.ts'
import { registerFor } from './banks.ts'
import type { Register } from './banks.ts'
import type { Kind } from './acquaintance.ts'

export const MEMORY_LINES: Readonly<Record<Kind, Readonly<Record<Register, readonly string[]>>>> = {
  greeted: {
    lagos: ['Ah, na you wey greet me before!', 'Oga, I remember you o.', 'You again! How far?', 'Welcome back, my person.', 'I know this face!', 'Hello o, I no forget.', 'Ehen, my greeting person!', 'How body? You don greet me before.', 'Na you be that, abi?', 'The one wey get sweet mouth!'],
    kano: ['Sannu, I remember you.', 'Ah, you who greeted me before!', 'You are back, welcome.', 'I know this face, wallahi.', 'Sannu da zuwa, my friend.', 'Yawwa, the one who said hello.', 'Good to see you again.', 'You again! How is the day?', 'I have not forgotten you.', 'The polite one is back.'],
    english: ['Ah, you said hello before!', 'I remember you.', 'You again! How are you?', 'Welcome back, friend.', 'I know that face!', 'Hello again, I have not forgotten.', 'My friendly stranger!', 'How have you been? You greeted me earlier.', 'Is that you? Hello again.', 'The one with the kind word!'],
  },
  bought: {
    lagos: ['Ah, the one wey buy me drink!', 'Oga, that drink sweet o.', 'My drink person don return!', 'God bless you for that drink.', 'Ah, the one with the change.', 'I no forget that drink o.', 'You dey try, the drink still dey my head.', 'Na you buy me drink! Thank you o.', 'Drink man! How far?', 'Come, I owe you one.'],
    kano: ['Ah, you who bought me a drink!', 'Barka, that drink was good.', 'God bless you for the drink.', 'The generous one is back.', 'I have not forgotten the drink, wallahi.', 'My friend with the drink, welcome.', 'You are a good person, I remember.', 'Yawwa, I owe you one.', 'That drink made my day.', 'Ah, the one with the open hand.'],
    english: ['Ah, you bought me a drink!', 'That drink was lovely, thank you.', 'My drink friend is back!', 'Bless you for that drink.', 'The one with the kind hand!', 'I have not forgotten the drink.', 'You are generous. I remember.', 'Come here, I owe you one.', 'That drink made my whole day.', 'Hello, drink buyer!'],
  },
}

/** The line for a regular, the same all day: chosen by the regular's seed. */
export function memoryLine(kind: Kind, register: Register, seed: string): string {
  const lines = MEMORY_LINES[kind][register]
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  return lines[hash % lines.length]!
}

/** The line a regular of this city says. */
export const memoryLineIn = (city: string, kind: Kind, seed: string): string => memoryLine(kind, registerFor(city, cityRules(city)?.country?.id), seed)
