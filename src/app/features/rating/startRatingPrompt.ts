// The Play rating ask is a lazy, default-off feature. When enabled for the public app, it listens for either a completed table game or a
// newly added friend. A loss or abandoned game never triggers it, and it offers no reward or sentiment screen before Google Play.
import { watch } from 'vue'
import { isPlayApp } from '../../playMode.ts'
import { social } from '../social/useSocial.ts'
import { PLAY_RATING_URL, markRatingAsked, ratingAsked, ratingDue, ratingMomentFromTrack } from './ratingPromptModel.ts'
import type { RatingMoment } from './ratingPromptModel.ts'

let pageAsked = false

function storage(): Storage | null {
  try { return globalThis.localStorage ?? null } catch { return null }
}

function showPrompt(): void {
  const dialog = document.createElement('dialog')
  dialog.setAttribute('aria-labelledby', 'play-rating-title')
  dialog.style.cssText = 'box-sizing:border-box;width:min(420px,calc(100% - 24px));padding:22px;border:0;border-radius:18px;background:#fff;color:#183b2a;font:15px/1.45 system-ui,sans-serif;box-shadow:0 18px 60px #0006'
  const title = document.createElement('h2'); title.id = 'play-rating-title'; title.textContent = 'Rate Allworld'; title.style.cssText = 'margin:0 0 8px;font-size:22px'
  const words = document.createElement('p'); words.textContent = 'You can rate Allworld on Google Play.'; words.style.cssText = 'margin:0 0 18px'
  const actions = document.createElement('div'); actions.style.cssText = 'display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px'
  const later = document.createElement('button'); later.type = 'button'; later.textContent = 'Not now'; later.style.cssText = 'min-height:44px;padding:0 16px;border:1px solid #cbd5cf;border-radius:10px;background:#fff;color:inherit;font:700 15px system-ui,sans-serif'
  const rate = document.createElement('a'); rate.textContent = 'Rate Allworld'; rate.href = PLAY_RATING_URL; rate.target = '_blank'; rate.rel = 'noopener noreferrer'; rate.style.cssText = 'display:inline-flex;align-items:center;min-height:44px;padding:0 16px;border-radius:10px;background:#183b2a;color:#fff;text-decoration:none;font-weight:700'
  const done = (): void => { dialog.close(); dialog.remove() }
  later.addEventListener('click', done)
  rate.addEventListener('click', done)
  dialog.addEventListener('cancel', done)
  actions.append(later, rate); dialog.append(title, words, actions); document.body.append(dialog); dialog.showModal(); later.focus()
}

/** Start the once-only listeners. The build switch is checked before this lazy chunk is imported. */
export function startRatingPrompt(): void {
  const kept = storage()
  if (!ratingDue({ enabled: true, playApp: isPlayApp(), asked: pageAsked || ratingAsked(kept), moment: 'finished-game' })) return
  let friendCount: number | null = social.me?.friends.length ?? null
  let offered = false
  let stopFriends = (): void => undefined
  const onTrack = (event: Event): void => {
    if (!('detail' in event)) return
    const moment = ratingMomentFromTrack(event.detail)
    if (moment) offer(moment)
  }
  const stop = (): void => { stopFriends(); globalThis.window?.removeEventListener('jaw:track', onTrack) }
  const offer = (moment: RatingMoment): void => {
    if (offered || !ratingDue({ enabled: true, playApp: isPlayApp(), asked: pageAsked || ratingAsked(kept), moment })) return
    offered = true; pageAsked = true; markRatingAsked(kept); stop(); showPrompt()
  }
  stopFriends = watch(() => social.me?.friends.length ?? null, (next) => {
    if (next === null) { friendCount = null; return }
    if (friendCount === null) { friendCount = next; return }
    if (next > friendCount) offer('new-friend')
    friendCount = next
  })
  globalThis.window?.addEventListener('jaw:track', onTrack)
}
