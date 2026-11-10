/**
 * Sending a share-loop card or clip made on this device (docs/SHARE-LOOPS.md). The phone's own share sheet first, with the file, the words
 * and the link; where the browser cannot share files (or refuses), the Allworld share sheet (ShareSheet.vue) with WhatsApp, X, Copy and
 * Save. Nothing is uploaded: the file goes only where the person sends it.
 */
import { useApp } from '../../state/app.ts'
import { cleanFacts } from '../../../game/share-model.ts'
import { channelLinks } from '../../../ui/share-links.ts'
import { feedApi } from '../feed/feedApi.ts'
import { track } from '../growth/growthModel.ts'
import { useGrowth } from '../growth/useGrowth.ts'
import { loopHandle } from './loopsModel.ts'
import type { LoopKind } from './loopsModel.ts'

let identity: { at: number; handle: string | null; id: string | null } | null = null
/** The player's public handle and id (for the mark and the profile link); asked once every five minutes at most. */
export async function whoAmI(): Promise<{ handle: string | null; id: string | null }> {
  if (identity && Date.now() - identity.at < 300_000) return identity
  let handle: string | null = null, id: string | null = null
  try {
    const answer = await feedApi((path, options) => useApp().game.fetchJson(path, options)).me()
    if (answer.ok) { handle = loopHandle(answer.profile.handle); id = answer.profile.id }
  } catch { /* no profile: the mark is the site alone and the link is the front door */ }
  identity = { at: Date.now(), handle, id }
  return identity
}

export interface LoopShare { loop: LoopKind; file: File; text: string; link: string }
const urls: string[] = []

/** The Allworld share sheet on a made file: the picture (or clip), the words, WhatsApp, X, Copy and Save. */
export function openLoopSheet(made: LoopShare): void {
  for (const old of urls.splice(0)) URL.revokeObjectURL(old)
  const url = URL.createObjectURL(made.file)
  urls.push(url)
  const links = channelLinks(made.text, made.link), video = made.file.type.startsWith('video/')
  useGrowth().state.sharing = {
    facts: cleanFacts({ kind: 'gist' }),
    prepared: { text: made.text, link: made.link, file: made.file, url: video ? null : url, whatsapp: links.whatsapp, x: links.x, ...(video ? { clip: { url, name: made.file.name, type: made.file.type } } : {}) },
    surface: 'other',
  }
  track('share_opened', { surface: `loop-${made.loop}` })
  useApp().shell.open('share-sheet')
}

/**
 * Shares a made file. 'again': the tap was too long ago for the browser (a long recording), so the caller keeps a "Share now" button.
 * 'sheet': the Allworld sheet opened instead.
 */
export async function sendLoop(made: LoopShare): Promise<'shared' | 'cancelled' | 'sheet' | 'again'> {
  track('share_card_created', { kind: made.loop })
  const nav = globalThis.navigator
  const can = typeof nav?.share === 'function' && typeof nav.canShare === 'function' && nav.canShare({ files: [made.file] })
  if (!can) { openLoopSheet(made); return 'sheet' }
  try {
    await nav.share({ files: [made.file], text: made.text, title: 'Allworld' })
    track('share_channel', { channel: 'native' })
    void useGrowth().call('/api/growth/client', { signals: ['share-native'] })
    return 'shared'
  } catch (error) {
    const name = (error as { name?: unknown } | null)?.name
    if (name === 'AbortError') return 'cancelled'
    if (name === 'NotAllowedError') return 'again'
    openLoopSheet(made)
    return 'sheet'
  }
}
