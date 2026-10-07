/**
 * OWNER: trust. The no-fee filter: refuses a text that asks someone to pay before they get work or goods, or promises to
 * grow their money. Pure and portable; applied with the text filter (server/moderation/text.ts) wherever strangers read.
 *
 *   screenFee(text, { what }) → null | { code: 'fee_request' | 'money_doubling', category: 'fee', reason }
 *
 * It reads English and Pidgin ("pay 5k to register", "registration na 2k", "you go first pay", "your money go double").
 * A warning is not a request: a match right after no / never / don't / without, or followed by "is a scam" / "is free",
 * is let through, and a fee named after JAMB, WAEC, school or exams is just talk about fees. Like the text filter it is
 * a seatbelt, refused and never altered; reports and moderators are the real tools.
 */

export interface FeeVerdict { code: 'fee_request' | 'money_doubling'; category: 'fee'; reason: string }

const INVISIBLE = /[\u00ad\u200b-\u200f\u2028-\u202f\u2060-\u206f\ufeff]/g
const SWAP: Record<string, string> = { b4: 'before', ur: 'your', pls: 'please', abeg: 'please', kindly: 'please', upfront: 'up front', percent: '%' }

/** Lower case, accents and invisible characters gone, naira signs read as "n", digits and "%" kept, one space between words. */
export function feeText(text: unknown): string {
  const base = String(text).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(INVISIBLE, '').toLowerCase()
    .replace(/[₦#](?=\s?\d)/g, ' n').replace(/(\d)[,.](?=\d)/g, '$1').replace(/['’`]/g, '').replace(/%/g, ' % ')
  const words = base.replace(/[^a-z0-9%\s]+/g, ' ').split(/\s+/).filter(Boolean)
  return words.map((word) => SWAP[word] ?? word).join(' ')
}

const AMOUNT = '(?:(?:n|ngn) ?)?\\d+(?:k|m)?(?: (?:k|naira|thousand|grand))?'
const GAP = (most: number): string => `(?: \\S+){0,${most}}`
const PAY = '(?:pay|paying|transfer|transferring|deposit|remit)'
const MONEY_VERB = `(?:${PAY}|(?:send|sending|drop|bring) (?:(?:me|us|am|the|your|small|some) )?(?:money|cash|${AMOUNT}))`
const PURPOSE = '(?:apply|register|registration|join|secure|start|begin|book|reserve|claim|collect|receive|unlock|activate|qualify|enrol|enroll|confirm|be (?:registered|considered|hired|employed|shortlisted|added)|get (?:(?:the|this|a|your|my) )?(?:job|slot|spot|position|gig|work|offer|form|item|goods|card|kit|access|link|approved|hired))'
const BEFORE = '(?:you|u|una|we|i|they|the|delivery|starting|work|resumption|seeing|interview)'
const FEE_WORD = '(?:registration|reg|processing|up front|training|application|form|joining|activation|commitment|clearance|onboarding|admin|handling|security|starter|kit|medical|screening|interview|verification|placement|agency|consultation|caution)'
const FEE = `${FEE_WORD} (?:fee|fees|charge|charges|money|levy)`

const FEE_RULES: RegExp[] = [
  new RegExp(` ${MONEY_VERB}${GAP(5)} (?:to|2) ${PURPOSE}\\b`, 'g'),
  new RegExp(` ${MONEY_VERB}${GAP(5)} before ${BEFORE}\\b`, 'g'),
  new RegExp(` ${MONEY_VERB}${GAP(4)} (?:first|up front)\\b`, 'g'),
  new RegExp(` first ${MONEY_VERB}\\b`, 'g'),
  new RegExp(` ${MONEY_VERB}${GAP(3)} ${FEE}\\b`, 'g'),
  new RegExp(` ${MONEY_VERB}${GAP(3)} for (?:(?:the|your|my|ma|una) )?(?:form|registration|reg|slot|processing|training|application|uniform|onboarding|screening|interview|verification|medical|clearance|activation|placement)\\b`, 'g'),
  new RegExp(` ${FEE}${GAP(3)} ${AMOUNT}\\b`, 'g'),
  new RegExp(` ${AMOUNT}${GAP(1)} (?:for )?(?:the |your )?${FEE}\\b`, 'g'),
  new RegExp(` (?:registration|reg|form|fee|fees|deposit) (?:na|is|go be|be|cost|costs|of|wey be) ${AMOUNT}\\b`, 'g'),
  new RegExp(` (?:${PAY}|send|drop|make|small|refundable|caution|commitment) (?:a )?(?:small )?(?:refundable )?deposit\\b`, 'g'),
  new RegExp(` deposit (?:of )?${AMOUNT}\\b`, 'g'),
]
const DOUBLING_RULES: RegExp[] = [
  / double (?:your |una |my |the |their )?(?:money|cash|funds|investment|naira)\b/g,
  / (?:money|cash|investment|funds) (?:go|will|wey go|go just|dey) double\b/g,
  new RegExp(` invest(?:ing|ed)?${GAP(3)} ${AMOUNT}${GAP(3)} (?:get|receive|earn|collect|cash out|withdraw|make|return)${GAP(1)} ${AMOUNT}\\b`, 'g'),
  new RegExp(` (?:flip|turn|grow) (?:your )?${AMOUNT} (?:to|into|2) ${AMOUNT}\\b`, 'g'),
  / \d+ % (?:\S+ ){0,3}(?:returns?|profit|profits|roi|interest)\b/g,
  / (?:returns?|profit|profits|roi|interest) (?:of )?\d+ %/g,
  / (?:forex|crypto|bitcoin|btc|usdt|binary) (?:investment|investments|trading platform|returns|profit|profits|signals|account manager|mining)\b/g,
  / guaranteed (?:returns?|profit|profits|income|roi|payout|payouts)\b/g,
]

const NEGATE = new Set(['no', 'never', 'dont', 'do not', 'not', 'without', 'zero', 'nobody', 'avoid', 'beware', 'refuse', 'nor', 'neva', 'no need'])
const HARMLESS_AFTER = new Set(['none', 'waived', 'free', 'zero', 'nothing', 'scam', 'scams', 'fraud', 'fake'])
const SCHOOL = new Set(['jamb', 'waec', 'neco', 'nysc', 'utme', 'gce', 'bece', 'school', 'exam', 'exams', 'tuition', 'hospital', 'acceptance'])

/** Is the match starting at `at` (length `size`) a warning, or about school fees, rather than a request? */
function harmless(line: string, at: number, size: number, school: boolean): boolean {
  const before = line.slice(0, at).trim().split(' ').slice(-4)
  const after = line.slice(at + size).trim().split(' ').slice(0, 4)
  const pairs = before.slice(0, -1).map((word, i) => `${word} ${before[i + 1]}`)
  if ([...before, ...pairs].some((word) => NEGATE.has(word))) return true
  if (after.some((word) => HARMLESS_AFTER.has(word))) return true
  return school && before.slice(-3).some((word) => SCHOOL.has(word))
}
function hits(line: string, rules: RegExp[], school: boolean): boolean {
  for (const rule of rules) {
    rule.lastIndex = 0
    for (let found = rule.exec(line); found; found = rule.exec(line)) {
      if (!harmless(line, found.index, found[0].length, school)) return true
      rule.lastIndex = found.index + 1
    }
  }
  return false
}

export function screenFee(text: unknown, { what = 'Your message' }: { what?: string } = {}): FeeVerdict | null {
  if (typeof text !== 'string' || !text.trim()) return null
  const line = ` ${feeText(text)} `
  if (hits(line, DOUBLING_RULES, false)) {
    return { code: 'money_doubling', category: 'fee', reason: `${what} was not sent: it promises to grow money (doubling, fixed returns, forex or crypto profits). Offers like that are how people lose their money.` }
  }
  if (hits(line, FEE_RULES, true)) {
    return { code: 'fee_request', category: 'fee', reason: `${what} was not sent: it asks someone to pay before they get work or goods (a fee, a deposit or "pay to apply"). On Allworld nobody pays to apply, register or see goods.` }
  }
  return null
}
