// The session sheet without a DOM.

/** The nickname as it is sent: the form trims what was typed. */
export const nicknameOf = (typed: string): string => typed.trim()

/** The way back to the original Allworld world, offered before a city identity is started or replaced: ordinary navigation, a separate save. */
export const LEGACY_CHARACTER_URL = 'https://joinallworld.com/old-character.html'

/** Why a new device cannot leave the nickname sheet yet; null once it is connected, and always for an expired saved life (which stays dismissible). */
export function sessionRequired(params: unknown, connected: boolean): string | null {
  const reason = params && typeof params === 'object' ? (params as { reason?: unknown }).reason : null
  return reason === 'new' && !connected ? 'Choose a nickname and start your life first.' : null
}
