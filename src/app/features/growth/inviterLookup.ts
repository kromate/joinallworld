// Who invited a visitor: the name behind the share code their link carried, read from the server's
// public lookup (GET /api/growth/share/:code, no session needed) so the first screen can say it
// before they press Play. Only the sharer's display name is used, and only ever as text.
import type { FetchJson } from '../../types/client.ts'

interface ShareAbout { ok?: boolean; by?: { name?: unknown } }

/** The sharer's name, or null when the code is unknown, expired, or the server cannot be reached. */
export async function inviterName(fetchJson: FetchJson, code: string): Promise<string | null> {
  try {
    const about = await fetchJson<ShareAbout>(`/api/growth/share/${encodeURIComponent(code)}`)
    const name = about.ok === true && typeof about.by?.name === 'string' ? about.by.name.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 24) : ''
    return name || null
  } catch { return null }
}

/** The bold line and the sentence of the quick start's "invited you" note. */
export const invitedWords = (name: string | null): { title: string; text: string } => ({
  title: name ? `${name} invited you.` : 'A friend invited you.',
  text: name ? `Make your Sim, tap Play and you land where ${name} is.` : 'Tap Play and you land where they are.',
})
