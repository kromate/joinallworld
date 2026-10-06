// What was asked: a table of phrasings (each a few words that must all be there, in any order, with a slip or two allowed)
// mapped to an intent. English, Nigerian English and Pidgin all go through text.ts first, so "wetin I go do" and
// "what should I do" are the same question. Nothing here guesses: when no pattern is strong enough the answer is
// "unknown", and the brain says so honestly.
import { conceptOf } from './knowledge.ts'
import type { Concept } from './knowledge.ts'
import { normalize, same, tokens } from './text.ts'
import type { CityFact, CompanionContext, PlaceFact } from './types.ts'

export type IntentId =
  | 'greet' | 'thanks' | 'bye' | 'joke' | 'encourage' | 'safety' | 'insult' | 'howareyou' | 'who' | 'capabilities'
  | 'next' | 'earn' | 'cash' | 'eat' | 'sleep' | 'travel' | 'skip' | 'friends' | 'online' | 'call' | 'ping' | 'sendmoney'
  | 'business' | 'home' | 'vote' | 'look' | 'save' | 'sound' | 'report' | 'where' | 'whatis' | 'whatsnew' | 'tour'
  | 'quiet' | 'lively' | 'messages' | 'time' | 'games' | 'group' | 'picture' | 'callfail' | 'unknown'

/** Strongest first when two score the same. */
const PRIORITY: readonly IntentId[] = ['safety', 'quiet', 'lively', 'callfail', 'picture', 'group', 'games', 'tour', 'travel', 'skip', 'where', 'sendmoney', 'call', 'ping', 'online', 'friends', 'business', 'cash', 'earn', 'eat', 'sleep', 'home', 'vote', 'look', 'save', 'sound', 'report', 'messages', 'whatsnew', 'whatis', 'next', 'time', 'who', 'howareyou', 'capabilities', 'insult', 'encourage', 'joke', 'thanks', 'bye', 'greet']

interface Rule { boost?: number; patterns: string[] }
/** A pattern is words separated by spaces, all of which must be present; "a/b" in one place means either. */
const RULES: Record<Exclude<IntentId, 'unknown' | 'where' | 'whatis'>, Rule> = {
  safety: { boost: 3, patterns: ['kill/hurt/harm myself', 'suicide', 'suicidal', 'end life', 'want die', 'self harm', 'no reason live'] },
  greet: { boost: -0.4, patterns: ['hello/hi/hey/hiya/howdy/yo/sup/greetings/hola', 'good morning/afternoon/evening', 'what up', 'whats up/good'] },
  thanks: { boost: 0.4, patterns: ['thanks/appreciate/cheers/gracias/thankful', 'well done', 'good job', 'nice one', 'you are great/best/amazing'] },
  bye: { boost: 0.2, patterns: ['bye/goodbye/cya/later', 'see you', 'good night', 'goodnight', 'got go', 'talk later'] },
  joke: { boost: 0.8, patterns: ['joke/jokes/funny/laugh/riddle/pun', 'make laugh', 'tell something funny'] },
  encourage: { boost: 0.6, patterns: ['sad/lonely/stressed/depressed/discouraged/frustrated/upset/anxious/nervous', 'give up', 'not good enough', 'i hate this', 'feel down', 'cheer me', 'encourage', 'motivate/motivation'] },
  insult: { boost: 0.6, patterns: ['stupid/useless/dumb/idiot/rubbish/nonsense/trash', 'you suck', 'shut up'] },
  howareyou: { boost: 0.4, patterns: ['how you doing', 'how are you', 'how you', 'you ok/fine/well'] },
  who: { boost: 1, patterns: ['who/what you', 'your name', 'you human/real/person/ai/bot/robot/alive/machine', 'human/person/real/ai/bot/robot you', 'who made/built/created you', 'who is lumo', 'what is lumo', 'are you anthony', 'are you founder'] },
  capabilities: { boost: 0.4, patterns: ['what can you do', 'help', 'how you help', 'what you do', 'your job', 'commands', 'what can you help', 'menu', 'options', 'topics'] },
  next: { boost: 0.8, patterns: ['what should do', 'what next', 'what do next', 'next', 'what now', 'now what', 'what do now', 'bored/boring', 'nothing do', 'suggest/suggestion/recommend', 'mission', 'something do', 'anything do', 'idea', 'lost', 'where start', 'how start', 'what can i do', 'give task', 'do something', 'what to do', 'what do', 'stuck', 'dont know do', 'not know do'] },
  earn: { boost: 0.8, patterns: ['earn/make money', 'get money', 'find/get job', 'how work', 'where work', 'can work', 'want work', 'work/job', 'broke', 'poor', 'no money', 'need money', 'get/receive/earn pay', 'get rich', 'pay/wage', 'income', 'rich', 'afford', 'make cash', 'make living', 'employ/employment/hire/hiring', 'unemployed', 'jobless'] },
  cash: { boost: 1, patterns: ['how much money have/got', 'my balance', 'balance', 'my wallet', 'wallet', 'how much have'] },
  eat: { boost: 1, patterns: ['eat/hungry/food/meal/starving/starve/hunger/snack/breakfast/lunch/dinner/cook/groceries/restaurant/buka', 'something eat', 'stomach', 'thirsty/drink/water'] },
  sleep: { boost: 1, patterns: ['sleep/tired/bed/energy/exhausted/drowsy/nap', 'lie down', 'rest/relax', 'low energy'] },
  travel: { boost: 0.5, patterns: ['travel/visit/flight/fly/train/bus/road/journey/intercity', 'go another city', 'leave city', 'other city/cities', 'new city', 'go to'] },
  skip: { boost: 1.2, patterns: ['skip', 'arrive', 'faster travel', 'travel faster', 'long travel', 'too long', 'speed travel', 'cut travel short', 'instantly/immediately travel'] },
  friends: { boost: 0.8, patterns: ['friend', 'make/find/add/meet friend', 'meet people', 'someone talk', 'lonely friend', 'people play', 'befriend', 'follow'] },
  online: { boost: 1.1, patterns: ['who online', 'anyone online', 'friend online', 'online now', 'who here', 'anyone here', 'who around', 'who playing', 'who is on', 'online'] },
  call: { boost: 1.2, patterns: ['call', 'ring', 'phone friend', 'voice call', 'video call', 'talk voice', 'speak someone', 'talk friend', 'dial'] },
  ping: { boost: 1.4, patterns: ['ping', 'knock', 'join friend', 'visit friend', 'go friend', 'find where friend'] },
  sendmoney: { boost: 1.6, patterns: ['send/transfer/give/gift/pay money', 'transfer', 'send naira', 'gift friend', 'give friend money', 'borrow friend', 'lend', 'send cash', 'tip'] },
  business: { boost: 1, patterns: ['business', 'stall/kiosk/shop/store/vendor/trader', 'sell/selling/trade', 'open shop', 'customer', 'entrepreneur', 'startup', 'boss myself', 'own business', 'run shop', 'market stall'] },
  home: { boost: 0.8, patterns: ['pay rent', 'buy house/home/apartment/flat/property/land/plot', 'house/home/apartment/flat', 'rent', 'landlord', 'where live', 'accommodation', 'room', 'furniture', 'decorate/decoration', 'estate', 'sleep home'] },
  vote: { boost: 1.2, patterns: ['vote/voting/election/ballot/poll/polling', 'governor', 'run office', 'politics/political', 'campaign'] },
  look: { boost: 1.1, patterns: ['change look/hair/outfit/clothes/style/appearance/avatar/character/skin/face/body', 'outfit', 'boutique', 'dress/clothes/wear/fashion/hairstyle', 'new look', 'customise/customize', 'my look', 'redo character'] },
  save: { boost: 1.2, patterns: ['save progress/game/character', 'sign up', 'signup', 'sign in', 'log in', 'login', 'account', 'lose progress/character', 'keep character', 'password', 'email', 'register', 'another device', 'other device', 'guest', 'create account'] },
  sound: { boost: 1.2, patterns: ['sound/music/audio/volume/noise/sfx/radio', 'mute/unmute', 'turn sound off', 'turn sound on', 'too loud', 'no sound', 'cant hear', 'hear anything'] },
  report: { boost: 1.2, patterns: ['report', 'harass/harassing/abuse/abusing/bully/bullying/cheat/cheating/scam/scammer/hacker', 'bug/glitch/crash/rude/toxic/offensive/creepy', 'not work', 'wont load', 'cant load', 'block player', 'block someone', 'threat/threatening', 'inappropriate', 'something wrong', 'have problem'] },
  whatsnew: { boost: 1.2, patterns: ['what new', 'whats new', 'new feature', 'new features', 'changelog', 'latest', 'news', 'update/updates', 'anything new', 'what changed', 'new stuff', 'recent'] },
  tour: { boost: 1.5, patterns: ['show around', 'tour', 'walkthrough', 'tutorial', 'guide me', 'teach me', 'show me how', 'explain game', 'how play', 'how game work', 'how this work', 'learn game', 'basics', 'show me', 'walk me'] },
  quiet: { boost: 1.6, patterns: ['quiet', 'stop talk/talking/nudge/nudging/popping/pestering/disturbing/disturb', 'leave alone', 'go away', 'annoying', 'be silent', 'too much talk', 'not now', 'stop bothering', 'stop interrupting', 'dont disturb', 'mute you', 'stay quiet', ] },
  lively: { boost: 1.6, patterns: ['talk more', 'be lively', 'speak up', 'more tips', 'be chatty', 'more suggestions'] },
  messages: { boost: 1, patterns: ['message/messages/inbox/unread/mail/text', 'any message', 'new message', 'who texted', 'who wrote', 'chat'] },
  games: { boost: 3, patterns: ['chess', 'oro', 'weave', 'wordle/scrabble/crossword', 'word game/puzzle/games', 'daily/todays word', 'play word/words', 'tile game', 'games app', 'board game/games', 'play game/games'] },
  group: { boost: 3, patterns: ['group', 'group chat', 'create/make/start/new group', 'add people group'] },
  picture: { boost: 3, patterns: ['picture/pictures/photo/photos/image/images/pic/pics/selfie', 'send/share/post picture/photo/image/pic'] },
  callfail: { boost: 3, patterns: ['call connect/connecting/connected/fail/failed/drop/dropped/cut/hear/audio', 'call not connect/work', 'voice not work/connect', 'why call', 'cant call', 'call problem/issue/trouble/wahala', 'call no go/connect', 'no hear call'] },
  time: { boost: 0.6, patterns: ['what time', 'time now', 'market open', 'is it day', 'is it night', 'what day', 'when open', 'opening hours', 'when close', 'closing time'] },
}

const PLACE_WORDS: Readonly<Record<string, string[]>> = {
  food: ['food', 'eat', 'buka', 'restaurant', 'canteen', 'eatery', 'kitchen', 'cafe', 'chop', 'meal', 'snack', 'drink', 'bar'],
  care: ['hospital', 'clinic', 'doctor', 'pharmacy', 'health', 'salon', 'gym', 'barber', 'spa'],
  work: ['office', 'workplace', 'factory'],
  fun: ['park', 'beach', 'game', 'cinema', 'mall', 'fun', 'play', 'viewing', 'rooftop'],
  nightlife: ['club', 'party', 'nightclub', 'lounge'],
  civic: ['church', 'mosque', 'police', 'station', 'government', 'airport', 'bank', 'radio', 'polling', 'shrine'],
}
const PLACE_QUESTION = ['where', 'find', 'locate', 'nearest', 'near', 'nearby', 'directions', 'location', 'show', 'take', 'bring', 'lead', 'guide']

export interface Match {
  intent: IntentId
  score: number
  city?: CityFact
  place?: PlaceFact
  concept?: Concept
  /** The words asked for, normalised. */
  words: string[]
}

const slotMatches = (slot: string, words: readonly string[]): boolean => slot.split('/').some((option) => words.some((word) => same(word, option)))
function scorePatterns(rule: Rule, words: readonly string[]): number {
  let best = 0
  for (const pattern of rule.patterns) {
    const slots = pattern.split(' ')
    if (!slots.every((slot) => slotMatches(slot, words))) continue
    best = Math.max(best, slots.length + (slots.length === 1 ? 0.6 : 0) + (rule.boost ?? 0))
  }
  return best
}

/** The city a message names (any one word of its name, a slip allowed), or null. */
export function cityIn(words: readonly string[], cities: readonly CityFact[]): CityFact | null {
  let found: CityFact | null = null
  for (const city of cities) {
    const parts = tokens(city.name).filter((part) => part.length > 2)
    if (parts.some((part) => words.some((word) => word.length > 2 && same(word, part)))) { if (!found || (found.here && !city.here)) found = city }
  }
  return found
}
/** The place a message names, best match first: a word of its name, then a kind of place ("food", "hospital"). */
export function placeIn(words: readonly string[], places: readonly PlaceFact[]): PlaceFact | null {
  const joined = words.flatMap((word, at) => (at + 1 < words.length ? [`${word}${words[at + 1]}`] : []))
  const named = places.filter((place) => {
    const parts = tokens(place.label)
    return parts.some((part) => part.length > 3 && words.some((word) => word.length > 3 && same(word, part))) || joined.some((pair) => same(pair, parts.join('')))
  })
  if (named.length) return named.sort((a, b) => Number(b.open) - Number(a.open) || Number(a.here) - Number(b.here))[0] ?? null
  for (const [category, list] of Object.entries(PLACE_WORDS)) {
    if (!words.some((word) => list.some((known) => same(word, known)))) continue
    const pool = places.filter((place) => place.category === category || list.some((known) => tokens(`${place.label} ${place.description}`).some((part) => same(part, known))))
    const choice = pool.sort((a, b) => Number(b.open) - Number(a.open) || Number(a.here) - Number(b.here))[0]
    if (choice) return choice
  }
  return null
}

/** Read a message. The context is used only to recognise the names of cities and places. */
export function matchIntent(message: string, context?: Pick<CompanionContext, 'cities' | 'places'>): Match {
  const words = tokens(message)
  const base = { words }
  if (!words.length) return { intent: 'unknown', score: 0, ...base }
  const scores = new Map<IntentId, number>()
  for (const [id, rule] of Object.entries(RULES) as [keyof typeof RULES, Rule][]) {
    const score = scorePatterns(rule, words)
    if (score > 0) scores.set(id, score)
  }
  const city = context ? cityIn(words, context.cities) : null
  const place = context ? placeIn(words, context.places) : null
  const concept = conceptOf(words, same)
  const asks = (list: readonly string[]): boolean => words.some((word) => list.some((known) => same(word, known)))
  const questioning = asks(['what', 'meaning', 'mean', 'explain', 'define', 'tell', 'about', 'how'])
  // "what is my balance" asks about the player's own thing, not about an idea.
  const mine = normalize(message).split(' ').some((word) => word === 'my' || word === 'mine')
  // Entities lift the intents they belong to.
  if (city) scores.set('travel', Math.max(scores.get('travel') ?? 0, 2.4 + (asks(['how', 'go', 'take', 'travel', 'visit', 'fly', 'get', 'reach']) ? 0.8 : 0)))
  if (place && !city && asks(PLACE_QUESTION)) scores.set('where', 3.2)
  else if (place && !city && words.length <= 3) scores.set('where', 2.2)
  if (concept && questioning && !mine && !scores.has('where')) scores.set('whatis', 1.4 + (asks(['what', 'meaning', 'mean', 'explain', 'define']) ? 1.4 : 0))
  else if (concept && words.length <= 2) scores.set('whatis', 1.8)
  // "how far" was a greeting only when nothing else was asked; a question word with a real intent wins over a greeting.
  let best: IntentId = 'unknown', top = 0
  for (const id of PRIORITY) {
    const score = scores.get(id)
    if (score !== undefined && score > top + 1e-9) { best = id; top = score }
  }
  // A skip question is also a travel question: the skip answer is more exact. A "where is the bank" is the Bank app, not a place, when it names the concept first.
  if (top < 1.5 && best !== 'safety') {
    const loose = best === 'greet' || best === 'thanks' || best === 'bye' ? best : 'unknown'
    return { intent: loose, score: top, ...(city ? { city } : {}), ...(place ? { place } : {}), ...(concept ? { concept } : {}), ...base }
  }
  return { intent: best, score: top, ...(city ? { city } : {}), ...(place ? { place } : {}), ...(concept ? { concept } : {}), ...base }
}

/** The three nearest topics to offer when nothing matched: the intents whose patterns share the most words with the message. */
export function nearTopics(message: string): IntentId[] {
  const words = tokens(message)
  const found: [IntentId, number][] = []
  for (const [id, rule] of Object.entries(RULES) as [IntentId, Rule][]) {
    if (id === 'safety' || id === 'insult' || id === 'greet' || id === 'thanks' || id === 'bye' || id === 'joke' || id === 'howareyou' || id === 'encourage' || id === 'quiet' || id === 'lively') continue
    let hits = 0
    for (const pattern of rule.patterns) for (const slot of pattern.split(' ')) if (slotMatches(slot, words)) hits++
    if (hits) found.push([id, hits])
  }
  return found.sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id]) => id)
}
