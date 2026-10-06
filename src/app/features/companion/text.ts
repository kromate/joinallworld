// Reading what a player typed: lower-casing, Nigerian English and Pidgin phrasings turned into plain words, and a forgiving
// word comparison (a letter missed, doubled or swapped still counts). Pure.

/** Pidgin and Nigerian English words, and the plain word each stands for. A phrase is replaced before the words are. */
const PHRASES: readonly [RegExp, string][] = [
  [/\bhow far\b/g, 'hello'],
  [/\bhow (e|it) dey\b/g, 'hello'],
  [/\bwetin (i|we|you|u) (go|fit|suppose) do\b/g, 'what should i do'],
  [/\bwetin dey (happen|sup)\b/g, 'hello'],
  [/\bwetin be\b/g, 'what is'],
  [/\bwetin\b/g, 'what'],
  [/\bwhat dey\b/g, 'what is'],
  [/\bi no get\b/g, 'i have no'],
  [/\bi no (sabi|know|understand)\b/g, 'i do not know'],
  [/\bno wahala\b/g, 'ok'],
  [/\bsharp sharp\b/g, 'quickly'],
  [/\bhow i go take\b/g, 'how do i'],
  [/\bhow i go\b/g, 'how do i'],
  [/\bhow we go\b/g, 'how do we'],
  [/\bwhere i fit\b/g, 'where can i'],
  [/\bwhere (we|una) fit\b/g, 'where can i'],
  [/\bi fit\b/g, 'can i'],
  [/\bi wan\b/g, 'i want to'],
  [/\bi dey\b/g, 'i am'],
  [/\bwe dey\b/g, 'we are'],
  [/\bi no dey\b/g, 'i am not'],
  [/\bna wetin\b/g, 'what'],
  [/\bdon do\b/g, 'is done'],
  [/\bi don\b/g, 'i have'],
  [/\bcan i fit\b/g, 'can i'],
  [/\bhow much (i|you) get\b/g, 'how much money i have'],
]
const WORDS: Readonly<Record<string, string>> = {
  abeg: 'please', pls: 'please', plz: 'please', plss: 'please',
  wan: 'want', wann: 'want', wanna: 'want', gonna: 'will', gotta: 'must',
  chop: 'eat', chopping: 'eat', eating: 'eat', food: 'food', hungry: 'hungry', hungary: 'hungry', hungery: 'hungry',
  dey: 'is', na: 'is', fit: 'can', sabi: 'know', wey: 'that', una: 'you', oga: '', abi: '', sef: '', jare: '', o: '', ooo: '', oo: '', ke: '',
  naija: 'nigeria', waka: 'walk', comot: 'leave', wahala: 'trouble', pikin: 'child', money: 'money', moni: 'money', cash: 'money', naira: 'money', kudi: 'money', owo: 'money',
  u: 'you', ur: 'your', r: 'are', thx: 'thanks', tnx: 'thanks', thnx: 'thanks', tanks: 'thanks', thank: 'thanks',
  hw: 'how', shud: 'should', wher: 'where', werk: 'work', wrk: 'work', shld: 'should', shuld: 'should', wia: 'where', wea: 'where', tire: 'tired', paid: 'pay', earned: 'earn', earning: 'earn', wat: 'what', wht: 'what', wats: 'what is', whats: 'what is', wots: 'what is', wetins: 'what', hows: 'how is', im: 'i am', ive: 'i have', dont: 'do not', cant: 'can not', cannot: 'can not', wont: 'will not', doesnt: 'does not', isnt: 'is not',
  bored: 'bored', boring: 'bored', yawn: 'bored',
  salary: 'pay', wage: 'pay', hustle: 'work', hustling: 'work', jobs: 'job', gig: 'job', gigs: 'job', employment: 'job', employ: 'job',
  sleep: 'sleep', sleeping: 'sleep', rest: 'sleep', nap: 'sleep', tired: 'tired', sleepy: 'tired', exhausted: 'tired', weary: 'tired',
  travel: 'travel', travelling: 'travel', traveling: 'travel', journey: 'travel', trip: 'travel', fly: 'travel', flight: 'travel', flights: 'travel', bus: 'travel', train: 'travel', drive: 'travel', ride: 'travel', commute: 'travel',
  friends: 'friend', buddy: 'friend', buddies: 'friend',
}
const FILLER = new Set(['the', 'a', 'an', 'to', 'of', 'on', 'in', 'at', 'for', 'my', 'me', 'please', 'just', 'so', 'then', 'again', 'also', 'really', 'very', 'some', 'with', 'and', 'or', 'it', 'this', 'that', 'there', 'here'])

/** Lower-case, no accents or punctuation, Pidgin phrases and words replaced, single spaces. */
export function normalize(input: string): string {
  let text = input.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9₦\s]/g, ' ').replace(/\s+/g, ' ').trim()
  for (const [pattern, plain] of PHRASES) text = text.replace(pattern, plain)
  const words = text.split(' ').flatMap((word) => { const plain = Object.hasOwn(WORDS, word) ? WORDS[word] as string : word; return plain ? plain.split(' ') : [] })
  return words.join(' ')
}

/** The words that carry meaning: the normalised text without small filler words. */
export function tokens(input: string): string[] {
  return normalize(input).split(' ').filter((word) => word && !FILLER.has(word))
}

const NEVER_FUZZY = new Set(['what', 'when', 'where', 'which', 'while', 'who', 'whom', 'whose', 'why', 'how', 'that', 'this', 'there', 'their', 'these', 'those', 'with', 'have', 'from', 'about', 'would', 'could', 'should', 'other'])

/** A crude stem: plural and -ing/-ed endings come off, so "jobs", "working" and "worked" meet "job" and "work". */
export function stem(word: string): string {
  if (word.length > 5 && word.endsWith('ing')) return word.slice(0, -3)
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`
  if (word.length > 4 && word.endsWith('es')) return word.slice(0, -2)
  if (word.length > 4 && word.endsWith('ed')) return word.slice(0, -2)
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1)
  return word
}

/** Damerau-Levenshtein distance (a swapped pair of letters is one change), stopping early past `limit`. */
export function distance(a: string, b: string, limit = 3): number {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > limit) return limit + 1
  const rows: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) (rows[0] as number[])[j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let best = Math.min((rows[i - 1] as number[])[j]! + 1, (rows[i] as number[])[j - 1]! + 1, (rows[i - 1] as number[])[j - 1]! + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) best = Math.min(best, (rows[i - 2] as number[])[j - 2]! + 1)
      ;(rows[i] as number[])[j] = best
    }
  }
  return (rows[a.length] as number[])[b.length] as number
}

/** Do a typed word and a known word mean the same? Exact, same stem, or a small slip in a word long enough to allow one. */
export function same(typed: string, known: string): boolean {
  if (typed === known) return true
  const a = stem(typed), b = stem(known)
  if (a === b) return true
  const length = Math.min(a.length, b.length)
  // Question and joining words are never "close" to another word: "what" is not "whot".
  if (length < 5 || NEVER_FUZZY.has(a) || NEVER_FUZZY.has(b)) return false
  const allowed = length >= 8 ? 2 : 1
  // A different first letter is rarely a typo of the same word; allow it only for the longer words.
  if (a[0] !== b[0] && length < 7) return false
  return distance(a, b, allowed) <= allowed
}
