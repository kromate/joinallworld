// "Share" for a short address: the phone's share sheet when there is one, otherwise the address is copied. Fetched when first pressed.
import { loadShareModule } from '../growth/boundary.ts'

/** The full address of a path on this site (the page's own origin). */
export const addressOf = (path: string): string => `${globalThis.location?.origin ?? ''}${path}`

/** Share `line` with the address after it. `toast` says what happened when the address was copied instead. */
export async function shareAddress(path: string, line: string, toast: (text: string, kind?: 'good' | 'error') => void): Promise<void> {
  const link = addressOf(path)
  const share = await loadShareModule()
  const outcome = await share.systemShare({ text: `${line} ${link}`, link, file: null, url: null, whatsapp: '', x: '' })
  if (outcome !== 'unavailable') return
  if (await share.copyText(link)) toast('Link copied. Paste it into any chat.', 'good')
  else toast(`Could not copy. The address is ${link}`, 'error')
}
