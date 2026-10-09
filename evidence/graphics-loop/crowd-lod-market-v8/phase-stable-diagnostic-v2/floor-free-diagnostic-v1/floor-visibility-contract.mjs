/** A visual-reference toggle must leave the actor's already-sampled rig untouched. */
export function assertPoseCheckpointUnchanged(before, after) {
  if (typeof before !== 'string' || typeof after !== 'string' || before !== after) {
    throw new Error('Ground-reference visibility toggle changed the sampled actor pose');
  }
  return true;
}
