// Regular inflection rules used by the word-list generator (see docs/WORDS.md). Conservative on
// purpose: a rule fires only when the shape allows it and the source gives evidence that the base
// really takes that ending.

const VOWELS = 'aeiou'
const isVowel = (c: string | undefined): boolean => c !== undefined && VOWELS.includes(c)

/** Endings that mark a base as not a plain verb or adjective stem. */
const NOT_STEM = /(ness|less|ful|ous|ive|ic|ish|ity|ment|tion|sion|ing|ed|ly|al|ism|ist|ize|ise|ate|ure|age|ance|ence|ant|ent|ory|ary|ern|oid|ose|ine|ide|ite|ase|ol|yl|um|us|ia|es|s)$/

/** One-syllable consonant-vowel-consonant words double the last letter (hop to hopped). */
function doubles(base: string): boolean {
  if (base.length < 3 || base.length > 5) return false
  const [a, b, c] = [base[base.length - 3], base[base.length - 2], base[base.length - 1]]
  if (isVowel(a) || !isVowel(b) || isVowel(c) || 'wxyh'.includes(c ?? '')) return false
  let groups = 0
  for (let i = 0; i < base.length; i++) if (isVowel(base[i]) && !isVowel(base[i - 1])) groups++
  return groups === 1
}

export function pluralOf(base: string): string {
  if (/[^aeiou]y$/.test(base)) return `${base.slice(0, -1)}ies`
  if (/(s|x|z|ch|sh)$/.test(base)) return `${base}es`
  return `${base}s`
}

export function edOf(base: string): string | null {
  if (NOT_STEM.test(base) || base.length < 3) return null
  if (base.endsWith('e')) return `${base}d`
  if (/[^aeiou]y$/.test(base)) return `${base.slice(0, -1)}ied`
  if (/c$/.test(base)) return null
  if (doubles(base)) return `${base}${base[base.length - 1]}ed`
  return `${base}ed`
}

export function ingOf(base: string): string | null {
  if (NOT_STEM.test(base) || base.length < 3) return null
  if (base.endsWith('ie')) return `${base.slice(0, -2)}ying`
  if (base.endsWith('ee') || base.endsWith('ye') || base.endsWith('oe')) return `${base}ing`
  if (base.endsWith('e')) return `${base.slice(0, -1)}ing`
  if (/c$/.test(base)) return null
  if (doubles(base)) return `${base}${base[base.length - 1]}ing`
  return `${base}ing`
}

export function erOf(base: string): string | null {
  if (NOT_STEM.test(base) || base.length < 3 || base.length > 7) return null
  if (base.endsWith('e')) return `${base}r`
  if (/[^aeiou]y$/.test(base)) return `${base.slice(0, -1)}ier`
  if (/c$/.test(base)) return null
  if (doubles(base)) return `${base}${base[base.length - 1]}er`
  return `${base}er`
}

export function estOf(base: string): string | null {
  const er = erOf(base)
  return er ? `${er.slice(0, -2)}est` : null
}

export function lyOf(base: string): string | null {
  if (base.length < 3 || /(ly|s)$/.test(base)) return null
  if (/[^aeiou]y$/.test(base)) return `${base.slice(0, -1)}ily`
  if (/[^aeiou]le$/.test(base)) return `${base.slice(0, -1)}y`
  if (/ic$/.test(base)) return `${base}ally`
  return `${base}ly`
}

/**
 * Derived forms of `base`, given the set of source words. Verb forms need a verb witness
 * (an agent noun, -able, -ment or re-/un- form in the source); comparatives need an adjective witness
 * (-ness or -ly form in the source).
 */
export function derive(base: string, source: ReadonlySet<string>): string[] {
  const out: string[] = []
  const stem = base.endsWith('e') ? base.slice(0, -1) : base
  const verb = source.has(`${base}er`) || source.has(`${base}r`) || source.has(`${stem}or`) || source.has(`${base}able`)
    || source.has(`${stem}able`) || source.has(`${base}ment`) || source.has(`un${base}`) || source.has(`re${base}`)
    || source.has(`${base}ing`) || source.has(`${base}ed`)
  const adjective = source.has(`${base}ness`) || source.has(`${base}ly`) || source.has(`${stem}ily`)
  if (base.length >= 3 && !(base.length > 5 && /(ed|ly)$/.test(base)) && (!/s$/.test(base) || /(ss|us)$/.test(base))) out.push(pluralOf(base))
  if (verb) {
    const ed = edOf(base)
    const ing = ingOf(base)
    if (ed) out.push(ed)
    if (ing) out.push(ing)
  }
  if (adjective && base.length <= 7) {
    const er = erOf(base)
    const est = estOf(base)
    if (er) out.push(er)
    if (est) out.push(est)
    if (source.has(`${base}ness`)) { const ly = lyOf(base); if (ly) out.push(ly) }
  }
  return out
}
