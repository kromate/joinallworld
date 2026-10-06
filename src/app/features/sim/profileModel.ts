// What the Profile tab decides: whether the name is acceptable, what the save button says, and the
// words for a refusal. Pure, so it is tested without a browser.

/** Why a display name is not acceptable, or ''. */
export const nameProblem = (name: string): string => (name.trim().length < 3 ? 'A display name needs at least 3 characters.' : name.trim().length > 24 ? 'A display name can be at most 24 characters.' : '')

export interface SaveState { disabled: boolean; label: string }

export interface SaveInput {
  connected: boolean
  /** The connection's two or three words ('No internet'). */
  short: string
  pending: boolean
  done: boolean
  guest: boolean
  /** Neither the name nor the look differs from what is saved. */
  unchanged: boolean
  name: string
}

/** The save button: its label is the reason while it is disabled. */
export function saveState(input: SaveInput): SaveState {
  if (!input.connected) return { disabled: true, label: `${input.short} — cannot save right now` }
  if (input.pending) return { disabled: true, label: 'Saving…' }
  if (!input.done) return { disabled: true, label: input.guest ? 'Settle in to change your look' : 'Finish creating your character first' }
  if (input.unchanged) return { disabled: true, label: 'No changes yet' }
  const problem = nameProblem(input.name)
  return problem ? { disabled: true, label: problem } : { disabled: false, label: 'Save changes' }
}

/** What a refused rename says: the server's own sentence when it sent one. */
export function saveFailure(problem: unknown): string {
  const error = (problem ?? {}) as { reason?: unknown; code?: unknown; message?: unknown }
  if (typeof error.reason === 'string' && error.reason) return error.reason
  if (error.code === 'invalid_name') return 'That display name is not allowed. Use 3–24 ordinary characters.'
  if (error.code === 'name_not_allowed') return 'That display name is not allowed. Choose another one.'
  if (error.code === 'muted') return 'A moderator has muted you, so your display name cannot be changed right now.'
  return `Your name could not be saved: ${typeof error.message === 'string' && error.message ? error.message : 'connection problem'}. Try again.`
}
