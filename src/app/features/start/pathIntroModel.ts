// What the landing says to a new visitor who opened a short address (`/games`, `/games/oro`, `/abuja`, …), without a DOM: the one line,
// the button, and whether "Find my city" is offered. The address table is src/paths.ts.
import { placeFacts } from '../../../paths.ts'
import type { GameSlug, PathIntent } from '../../../paths.ts'

export interface IntroLine {
  strong: string
  text: string
  button: string
  /** What the button does: start (in `city`, when there is one), or open the sign-up or log-in sheet. */
  action: 'start' | 'signup' | 'login'
  city: string | null
}

const GAME_LINES: Readonly<Record<GameSlug, { strong: string; text: string; button: string }>> = {
  chess: { strong: 'Chess against the computer.', text: 'Easy, medium or hard. Free in your browser, no password.', button: 'Play chess' },
  oro: { strong: 'Today’s word is waiting.', text: 'One puzzle a day, the same for everyone. Play now; sign up later to keep your streak.', button: 'Play today’s word' },
  weave: { strong: 'Weave: word tiles against the computer.', text: 'Free in your browser, no password.', button: 'Play Weave' },
  whot: { strong: 'Whot against the computer.', text: 'The card game, free in your browser, no password.', button: 'Play Whot' },
  penalties: { strong: 'Penalties against the computer.', text: 'A shootout in your browser, free, no password.', button: 'Play penalties' },
}

/** The line for an address a visitor with no life opened, or null when the plain landing says it all. */
export function introFor(intent: PathIntent | null): IntroLine | null {
  if (!intent) return null
  if (intent.kind === 'games') {
    const game = intent.game ? GAME_LINES[intent.game] : null
    return { ...(game ?? { strong: 'Play chess, today’s word and more — free in your browser.', text: 'No password, no e-mail: you are playing in seconds.', button: 'Play now' }), action: 'start', city: null }
  }
  if (intent.kind === 'city') {
    const rules = placeFacts(intent.city)
    if (!rules || !rules.open) return null
    const games = intent.page === 'games'
    return { strong: games ? `Games in ${rules.name}.` : `Live in ${rules.name}.`, text: games ? 'Tables at its venues, chess, today’s word and more.' : rules.teaser, button: `Start in ${rules.name}`, action: 'start', city: rules.id }
  }
  if (intent.kind === 'panel' && intent.panel === 'signup') return { strong: 'Keep your character safe.', text: 'A free account keeps your life and your streaks on any device.', button: 'Sign up free', action: 'signup', city: null }
  if (intent.kind === 'panel' && intent.panel === 'login') return { strong: 'Welcome back.', text: 'Log in to play the character you saved.', button: 'Log in', action: 'login', city: null }
  return null
}

/** "Find my city" is offered at `/` and at `/games`. */
export const offersFind = (intent: PathIntent | null): boolean => intent === null || (intent.kind === 'games' && intent.game === null)
