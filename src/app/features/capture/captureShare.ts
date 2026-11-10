/**
 * Sharing a capture (docs/AD-READY-PLAN.md, Phase 2). The corner mark is drawn on this device; the marked file is made only when the person
 * asks to share, and nothing leaves the device until they pick a target in the phone's own share sheet (or the Allworld sheet's WhatsApp link).
 *
 * The phone's share sheet needs a tap that just happened, so a long preparation (a clip is re-recorded in real time) ends in a "ready"
 * state with a second tap; a photo is quick enough to share from the first tap.
 */
import { reactive } from 'vue'
import { useApp } from '../../state/app.ts'
import { cleanFacts } from '../../../game/share-model.ts'
import { channelLinks } from '../../../ui/share-links.ts'
import { feedApi } from '../feed/feedApi.ts'
import { track } from '../growth/growthModel.ts'
import { useGrowth } from '../growth/useGrowth.ts'
import { MarkFailure, canMarkVideo, markFailureText, markPhoto, markVideo } from './captureMark.ts'
import type { MarkJob } from './captureMark.ts'
import { capturedPhoto, capturedVideo, captureSession, onCaptureClear } from './captureSession.ts'
import { baseVideoType, clipLink, clipText, markHandle, markText, shareFileName } from './captureShareModel.ts'

export type ShareKind = 'photo' | 'video'

interface ShareState {
  /** Crop to a phone story (9:16). */
  story: boolean
  phase: 'idle' | 'preparing' | 'ready'
  kind: ShareKind | null
  /** While a clip is re-recorded: seconds still to go. */
  secondsLeft: number
  note: string
  error: string
  /** The words that will be drawn in the corner (the handle once it is known). */
  mark: string
}
export const captureShare = reactive<ShareState>({ story: false, phase: 'idle', kind: null, secondsLeft: 0, note: '', error: '', mark: markText(null) })

interface Prepared {
  kind: ShareKind
  source: Blob
  file: File
  marked: boolean
  story: boolean
  handle: string | null
  link: string
  text: string
  /** Addresses made for the Allworld share sheet; revoked when this is replaced. */
  urls: string[]
}
let prepared: Prepared | null = null
let job: MarkJob | null = null
let identity: { at: number; handle: string | null; id: string | null } | null = null

/** Can this browser put the corner mark on a video? (When not, the clip is offered unmarked and the photo marked; the panel says so.) */
export function videoMarkable(): boolean { return canMarkVideo() !== null }

async function whoAmI(): Promise<{ handle: string | null; id: string | null }> {
  if (identity && Date.now() - identity.at < 300_000) return identity
  let handle: string | null = null, id: string | null = null
  try {
    const answer = await feedApi((path, options) => useApp().game.fetchJson(path, options)).me()
    if (answer.ok) { handle = markHandle(answer.profile.handle); id = answer.profile.id }
  } catch { /* no profile: the link is the site's front door */ }
  identity = { at: Date.now(), handle, id }
  captureShare.mark = markText(handle)
  return identity
}
/** Asks who the player is ahead of the tap, so the share that follows it is not waiting for the answer (a share needs a fresh tap). */
export function warmIdentity(): void { void whoAmI() }

function dropPrepared(): void {
  if (prepared) for (const url of prepared.urls) URL.revokeObjectURL(url)
  prepared = null
}
export function resetShare(): void {
  if (job) job.cancelled = true
  job = null
  dropPrepared()
  captureShare.phase = 'idle'; captureShare.kind = null; captureShare.secondsLeft = 0; captureShare.note = ''; captureShare.error = ''
}
onCaptureClear(resetShare)

const sourceOf = (kind: ShareKind): Blob | null => (kind === 'photo' ? capturedPhoto() : capturedVideo())
function fresh(kind: ShareKind, handle: string | null): boolean {
  const source = sourceOf(kind)
  return Boolean(prepared && source && prepared.kind === kind && prepared.source === source && prepared.story === captureShare.story && prepared.handle === handle)
}
/** The crop toggle was changed: a file made for the other shape is no longer the one to send. */
export function shapeChanged(): void {
  if (job) job.cancelled = true
  dropPrepared()
  captureShare.phase = 'idle'; captureShare.kind = null; captureShare.note = ''; captureShare.error = ''
}

/** Makes the file to share: the mark drawn on a photo, or a clip recorded again with the mark (an unmarked clip when this browser cannot). */
export async function prepareShare(kind: ShareKind): Promise<boolean> {
  const source = sourceOf(kind)
  if (!source || captureShare.phase === 'preparing') return false
  captureShare.error = ''; captureShare.note = ''
  captureShare.phase = 'preparing'; captureShare.kind = kind
  const mine: MarkJob = { cancelled: false }
  job = mine
  const who = await whoAmI()
  const options = { handle: who.handle, story: captureShare.story }
  let file: File, marked = true
  try {
    if (kind === 'photo') file = new File([await markPhoto(source, options)], shareFileName('photo', 'image/jpeg'), { type: 'image/jpeg' })
    else {
      try {
        const expected = captureSession.videoMs || 30_000
        captureShare.secondsLeft = Math.ceil(expected / 1000)
        const made = await markVideo(source, options, mine, expected, (left) => { if (job === mine) captureShare.secondsLeft = left })
        file = new File([made.blob], shareFileName('video', made.choice.type), { type: made.choice.type })
      } catch (error) {
        if (error instanceof MarkFailure && (error.code === 'cancelled' || error.code === 'hidden')) throw error
        // The mark could not be drawn on the clip here: the clip itself is still shareable, and the panel says it has no mark.
        const type = baseVideoType(source.type)
        file = new File([source], shareFileName('video', type), { type })
        marked = false
      }
    }
  } catch (error) {
    if (job === mine) {
      captureShare.phase = 'idle'; captureShare.kind = null
      if (!(error instanceof MarkFailure && error.code === 'cancelled')) captureShare.error = markFailureText(error instanceof MarkFailure ? error.code : 'record_failed')
    }
    return false
  }
  if (mine.cancelled || job !== mine || sourceOf(kind) !== source) return false
  job = null
  dropPrepared()
  const link = clipLink(globalThis.location?.origin ?? '', who.handle, who.id)
  prepared = { kind, source, file, marked, story: captureShare.story, handle: who.handle, link, text: clipText(who.handle, link, kind), urls: [] }
  captureShare.phase = 'ready'; captureShare.secondsLeft = 0
  captureShare.note = marked ? '' : 'This clip has no corner mark: this browser could not add it. The photo has one.'
  track('share_card_created', { kind: 'clip' })
  return true
}

/** What the "ready" file is, for the panel: its name, whether it carries the mark. */
export function readyInfo(): { kind: ShareKind; marked: boolean; name: string } | null {
  return prepared && captureShare.phase === 'ready' ? { kind: prepared.kind, marked: prepared.marked, name: prepared.file.name } : null
}

function canShareFile(file: File): boolean {
  const nav = globalThis.navigator
  return typeof nav?.share === 'function' && typeof nav.canShare === 'function' && nav.canShare({ files: [file] })
}

/** Opens the Allworld share sheet on the marked file: the WhatsApp link, X, Copy text and Save. */
export function openShareSheet(): void {
  const made = prepared
  if (!made) return
  const url = URL.createObjectURL(made.file)
  made.urls.push(url)
  const links = channelLinks(made.text, made.link)
  const growth = useGrowth()
  growth.state.sharing = {
    facts: cleanFacts({ kind: 'gist' }),
    prepared: { text: made.text, link: made.link, file: made.file, url: made.kind === 'photo' ? url : null, whatsapp: links.whatsapp, x: links.x, clip: { url, name: made.file.name, type: made.file.type } },
    surface: 'capture',
  }
  track('share_opened', { surface: 'capture' })
  useApp().shell.open('share-sheet')
}

/**
 * Shares the prepared file through the phone's own share sheet (a File of the right type, so WhatsApp accepts it); where the browser
 * cannot share files, or refuses, the Allworld sheet opens instead. A tap that was too long ago for the browser to allow a share keeps the
 * file "ready" for another tap.
 */
export async function shareReady(): Promise<'shared' | 'cancelled' | 'sheet' | 'again'> {
  const made = prepared
  if (!made || captureShare.phase !== 'ready') return 'cancelled'
  if (!canShareFile(made.file)) { openShareSheet(); return 'sheet' }
  try {
    await globalThis.navigator.share({ files: [made.file], text: made.text, title: 'Allworld' })
    track('share_channel', { channel: 'native' })
    void useGrowth().call('/api/growth/client', { signals: ['share-native'] })
    return 'shared'
  } catch (error) {
    const name = (error as { name?: unknown } | null)?.name
    if (name === 'AbortError') return 'cancelled'
    if (name === 'NotAllowedError') { captureShare.note = 'Ready. Tap Share to send it.'; return 'again' }
    openShareSheet()
    return 'sheet'
  }
}

/**
 * The Share button. A file that is already made is shared at once; otherwise it is made first and then shared if the browser still
 * counts the tap (a photo does; a long clip asks for one more tap).
 */
export async function shareCapture(kind: ShareKind): Promise<void> {
  const who = await whoAmI()
  if (captureShare.phase === 'ready' && fresh(kind, who.handle)) { await shareReady(); return }
  if (captureShare.phase === 'preparing') return
  if (!(await prepareShare(kind))) return
  await shareReady()
}

/** Stops a clip being re-recorded. */
export function cancelPrepare(): void { shapeChanged() }
