import { ANCHORS } from '../../../campus/unilag/layout.ts'
import { title } from './campusModel.ts'

/** A content spot can exist without an authored map anchor. Keep it visible, but don't promise a walk. */
export function campusWalkReason(spot: string, label = title(spot)): string {
  return Object.hasOwn(ANCHORS, spot) ? '' : `The current campus map has no walkable anchor for ${label}.`
}
