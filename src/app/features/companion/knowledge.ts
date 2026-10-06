// What the companion can explain: a small authored table of the game's own ideas, in its own voice.
// Each entry names the labels a player will see on screen (`labels`); a test checks that every one exists in the interface, so an
// explanation can never point at a button that was renamed. The words follow docs/REFERENCE.md and docs/BUSINESS.md.
import { route } from './registry.ts'
import type { CompanionAction } from './types.ts'

export interface Concept {
  id: string
  /** Words a player may use for it (canonical words: see text.ts normalize). */
  terms: string[]
  text: string
  /** UI labels this text names: each is searched for in the interface source by the test. */
  labels: string[]
  action?: CompanionAction
}

export const CONCEPTS: readonly Concept[] = [
  { id: 'needs', terms: ['need', 'energy', 'hunger', 'bladder', 'hygiene', 'bars', 'meter'],
    text: 'Your needs are energy, food, fun, social, hygiene and bladder. They fall slowly as time passes, and a low one drags your mood down. The line under the bars always says what to do next.',
    labels: ['Needs'], action: { kind: 'sim', tab: 'needs', label: 'Open Needs' } },
  { id: 'mood', terms: ['mood', 'feeling', 'happiness', 'happy'],
    text: 'Mood is how you feel overall: the average of your needs, plus any feelings you are carrying. Keep the needs topped up and it stays good.',
    labels: ['Needs'], action: { kind: 'sim', tab: 'needs', label: 'Open Needs' } },
  { id: 'cash', terms: ['cash', 'naira', 'money', 'wallet', 'balance', 'currency'],
    text: 'Cash is in naira (₦). It is in the top bar: tap it to open your Bank, where you can see what came in and went out.',
    labels: ['Bank', 'Statement'], action: { kind: 'open', id: 'bank', label: 'Open Bank' } },
  { id: 'bank', terms: ['bank', 'deposit', 'savings', 'loan', 'invest', 'investment', 'interest'],
    text: 'Bank keeps your money: pay rent and bills, borrow a little, save, and grow money in Invest. Pay a loan on time and it stays friendly.',
    labels: ['Bank', 'Invest'], action: { kind: 'open', id: 'bank', label: 'Open Bank' } },
  { id: 'jobs', terms: ['job', 'work', 'pay', 'career', 'shift', 'promotion', 'employer', 'workplace', 'boss'],
    text: 'Jobs pays you for every shift, and Career shows how to move up the ladder. Turn on Go automatically and the game walks you to work for you.',
    labels: ['Jobs', 'Career'], action: { kind: 'open', id: 'jobs', label: 'Open Jobs' } },
  { id: 'missions', terms: ['mission', 'daily', 'weekly', 'quest', 'task', 'challenge'],
    text: 'Missions are three daily and three weekly goals, made from ordinary play. Finish one, tap to collect, and a full set earns stars. Nothing is lost if you miss a day.',
    labels: ['Missions'], action: { kind: 'open', id: 'missions', label: 'Open Missions' } },
  { id: 'stars', terms: ['star', 'perk', 'wish', 'dream'],
    text: 'Stars come from goals, full sets of missions and bringing friends in. You use them on perks in Goals, which give small lasting boosts.',
    labels: ['Goals'], action: { kind: 'open', id: 'goals', label: 'Open Goals' } },
  { id: 'rent', terms: ['rent', 'landlord', 'arrears', 'bills', 'eviction'],
    text: 'Rent comes due every Saturday. Keep enough in your Bank and it is paid; miss it and a late fee builds up, so pay what you can early.',
    labels: ['Bank'], action: { kind: 'open', id: 'bank', label: 'Open Bank' } },
  { id: 'stall', terms: ['stall', 'shop', 'kiosk', 'vendor', 'reputation', 'customer'],
    text: 'A stall is your own shop in a market. You stock it, set prices and collect the cash box; customers come while the market is open. Pay its rent or the market closes it.',
    labels: ['Business'], action: route.business() },
  { id: 'billboard', terms: ['billboard', 'advert', 'advertise', 'ads'],
    text: 'Billboards are roadside signs you can rent with game naira to put one short line on the city map. There are no pictures or links.',
    labels: ['Billboards'], action: { kind: 'open', id: 'ads', label: 'Open Billboards' } },
  { id: 'ping', terms: ['ping', 'knock', 'summon'],
    text: 'A ping tells a friend you would like to join them, with a link that takes them straight to the place. They choose whether to come.',
    labels: ['People'], action: { kind: 'open', id: 'people', label: 'Open People' } },
  { id: 'bae', terms: ['bae', 'partner', 'dating', 'romance'],
    text: 'Bae is a special friend you both agree to. You can ask someone from their card in People once you are close enough.',
    labels: ['People'], action: { kind: 'open', id: 'people', label: 'Open People' } },
  { id: 'richlist', terms: ['richlist', 'rich', 'leaderboard', 'ranking', 'richest', 'neighbour'],
    text: 'The Rich List shows top balances and top earners of the week. You can hide yourself from it in Settings if you prefer.',
    labels: ['Rich List', 'Settings'], action: { kind: 'open', id: 'richlist', label: 'Open Rich List' } },
  { id: 'governor', terms: ['governor', 'election', 'state', 'government', 'politics', 'voting'],
    text: 'The Governor is chosen by an election in each city. Players who meet the requirements can vote or run; the State House has the details.',
    labels: ['Governor'], action: { kind: 'open', id: 'governor', label: 'Open Governor' } },
  { id: 'trip', terms: ['trip', 'travel', 'journey', 'fare', 'intercity'],
    text: 'A trip takes real time, and your home stays yours while you visit another city. On a long trip you can pay to arrive now, if the Map offers it.',
    labels: ['Map'], action: { kind: 'open', id: 'map', label: 'Open Map' } },
  { id: 'home', terms: ['house', 'home', 'estate', 'plot', 'furniture'],
    text: 'Your home is yours in every city you visit. You can pick a local government and a house, then place furniture in Buy mode.',
    labels: ['Houses', 'Buy'], action: { kind: 'open', id: 'houses', label: 'Open Houses' } },
  { id: 'health', terms: ['health', 'sick', 'illness', 'doctor', 'hospital', 'medicine'],
    text: 'If you feel run down or ill, Health says what is wrong and what helps. A hospital visit or rest usually sets you right. I am not a doctor, so for anything real, please see one.',
    labels: ['Health'], action: { kind: 'open', id: 'health', label: 'Open Health' } },
  { id: 'skills', terms: ['skill', 'level', 'xp', 'cooking', 'fitness', 'charisma'],
    text: 'Skills grow as you do things: cooking, fitness, charisma and more. Higher skills help you earn and unlock better work.',
    labels: ['Skills'], action: { kind: 'sim', tab: 'skills', label: 'Open Skills' } },
  { id: 'tables', terms: ['table', 'whot', 'ayo', 'card', 'board'],
    text: 'Tables are games like Ayo and Whot that you can play against others at a venue. Walk up to a table and sit, watch or invite someone.',
    labels: ['Tables'], action: { kind: 'open', id: 'tables', label: 'Open Tables' } },
  { id: 'guest', terms: ['guest', 'settle', 'progress', 'signup'],
    text: 'A guest plays without an account. Sign up free and your character is kept so you can carry on from any device.',
    labels: ['Account'], action: { ...route.signUp(), label: 'Save my progress' } },
  { id: 'community', terms: ['community', 'voice', 'circle', 'room'],
    text: 'Community is the chat of the place you are in, for everyone who is there. You can join its voice circle to talk to people nearby.',
    labels: ['Community'], action: { kind: 'ask', text: 'show me around friends', label: 'Show me' } },
]

/** The concept a message is about, from the words of it; null when none is named. */
export function conceptOf(words: readonly string[], same: (typed: string, known: string) => boolean): Concept | null {
  let best: Concept | null = null
  for (const concept of CONCEPTS) {
    if (words.some((word) => concept.terms.some((term) => same(word, term)))) { best = concept; break }
  }
  return best
}

export function conceptById(id: string): Concept | null { return CONCEPTS.find((concept) => concept.id === id) ?? null }
