/** The untrusted answer of POST /api/social/join, as far as the landing banner reads it. */
export interface JoinAnswer { ok?: boolean; code?: string; host?: { name?: string }; venue?: string; /** The city the inviter is in, when it is another one. */ elsewhere?: string }
export interface JoinBanner { tone: 'good' | 'info'; title: string; text: string; knock: boolean }

/** What a visitor who came through a friend's link is told about the gift: it is paid only after real work. */
export const GIFT_LINE = 'Work a paid shift and you both get a gift.'

/** What the landing says for an answer of POST /api/social/join. */
export function joinBanner(answer: JoinAnswer | null, venueLabel: (venueId: string) => string, { gift = false }: { gift?: boolean } = {}): JoinBanner | null {
  const banner = joinWords(answer, venueLabel)
  return banner && gift ? { ...banner, text: `${banner.text} ${GIFT_LINE}` } : banner
}

/** A share link whose owner could not be joined still says whose link it was. */
export const linkBanner = (name: string): JoinBanner => ({ tone: 'good', title: `You came through ${name}’s link`, text: GIFT_LINE, knock: false })

function joinWords(answer: JoinAnswer | null, venueLabel: (venueId: string) => string): JoinBanner | null {
  const name = typeof answer?.host?.name === 'string' && answer.host.name ? answer.host.name : null
  if (!answer?.ok || !name) return null
  const title = `You’re joining ${name}`
  switch (answer.code) {
    case 'joined': case 'here': return { tone: 'good', title, text: `${name} is at ${venueLabel(answer.venue ?? '')} right now — so are you. Look for their name tag.`, knock: false }
    case 'at_home': return { tone: 'good', title, text: `${name} is at home. Knock, and they can let you in.`, knock: true }
    case 'reconnecting': return { tone: 'info', title, text: `${name} is reconnecting. Have a look around; you can knock from Phone → Invite in a moment.`, knock: false }
    case 'out': if (typeof answer.elsewhere === 'string' && answer.elsewhere) return { tone: 'info', title, text: `${name} is in ${answer.elsewhere.slice(0, 40)} right now — you can travel there once you have settled in. Have a look around here first.`, knock: false }
      return { tone: 'info', title, text: `${name} is out in the city right now. Have a look around; add them from Phone → People and you will see when they are near.`, knock: false }
    default: return { tone: 'info', title, text: `${name} is offline right now. Have a look around — their link still works when they are back.`, knock: false }
  }
}
