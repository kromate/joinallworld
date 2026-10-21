export const PLAY_RATING_URL = 'https://play.google.com/store/apps/details?id=com.joinallworld.app'
export const PLAY_RATING_KEY = 'allworld-play-rating-asked'

export type RatingMoment = 'finished-game' | 'new-friend'

export interface RatingFacts {
  readonly enabled: boolean
  readonly playApp: boolean
  readonly asked: boolean
  readonly moment: RatingMoment
}

/** Eligibility is about app state and the once-only marker; the trigger adapter separately excludes losses and abandoned games. */
export const ratingDue = (facts: RatingFacts): boolean => facts.enabled && facts.playApp && !facts.asked

export function ratingMomentFromTrack(detail: unknown): RatingMoment | null {
  if (!detail || typeof detail !== 'object' || !('name' in detail) || detail.name !== 'match_finished' || !('props' in detail)) return null
  const props: unknown = detail.props
  if (!props || typeof props !== 'object' || !('result' in props)) return null
  return props.result === 'won' || props.result === 'draw' ? 'finished-game' : null
}

type Reader = Pick<Storage, 'getItem'> | null | undefined
type Writer = Pick<Storage, 'setItem'> | null | undefined

export function ratingAsked(storage: Reader): boolean {
  try { return storage?.getItem(PLAY_RATING_KEY) === '1' } catch { return false }
}

export function markRatingAsked(storage: Writer): void {
  try { storage?.setItem(PLAY_RATING_KEY, '1') } catch { /* the caller still keeps the page-level decision */ }
}
