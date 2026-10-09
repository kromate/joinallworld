/** Tiny state helpers shared by the isolated review fixture and its Node tests. */
export function createReadinessEpoch() {
  let sequence = 0
  let active = 0
  return Object.freeze({
    begin() { active = ++sequence; return active },
    cancel() { active = 0; sequence += 1; return sequence },
    owns(id) { return id > 0 && active === id },
    finish(id) { if (active !== id) return false; active = 0; return true },
  })
}

export function homeReadiness(input) {
  const reasons = []
  const body = input.validatedBody
  if (!body || body.bodyGeneration < 1) reasons.push('no validated Home body generation exists')
  else {
    if (body.hostGeneration !== input.hostGeneration || body.hostGeneration !== input.entry.hostGeneration) reasons.push('validated body belongs to another host generation')
    if (body.identityKey !== input.identityKey) reasons.push('validated body identity does not match the current player')
    if (input.currentBodyGeneration !== body.bodyGeneration) reasons.push('the player body was replaced after the witness')
  }
  if (input.entry.id !== input.currentEntryId) reasons.push('Home entry changed')
  if (input.currentPlace !== 'home' || input.host?.location !== 'home') reasons.push('Home is not the current host location')
  if (input.host?.avatarRendering !== 'canonical' || input.host?.canonicalBodyEligible !== true) reasons.push('current player body is not canonical and eligible')
  if (!Number.isFinite(input.host?.renderCount) || input.host.renderCount <= input.entry.renderCount) reasons.push('current Home entry has not rendered a new frame')
  return { ready: reasons.length === 0, reasons, hostGeneration: input.hostGeneration,
    entryId: input.currentEntryId, bodyGeneration: body?.bodyGeneration ?? null,
    renderCount: input.host?.renderCount ?? null, identityKey: input.identityKey }
}

/** The global Home-frame event has no source-generation payload; only current host diagnostics prove readiness. */
export function observeCurrentHomeBody(input) {
  const reasons = []
  if (input.currentPlace !== 'home' || input.host?.location !== 'home') reasons.push('Home is not the current rendered location')
  if (input.currentHostGeneration !== input.entry.hostGeneration) reasons.push('current host differs from the Home entry host')
  if (input.currentEntryId !== input.entry.id) reasons.push('Home entry changed')
  if (input.identityKey !== input.expectedIdentityKey) reasons.push('player identity differs from the fixture identity')
  if (input.host?.avatarRendering !== 'canonical' || input.host?.canonicalBodyEligible !== true) reasons.push('current player body is not canonical and eligible')
  if (!Number.isFinite(input.host?.renderCount) || input.host.renderCount <= input.entry.renderCount) reasons.push('current Home entry has not rendered after selection')
  return { accepted: reasons.length === 0, reasons,
    witness: reasons.length ? null : Object.freeze({ hostGeneration: input.currentHostGeneration,
      entryId: input.currentEntryId, identityKey: input.identityKey, renderCount: input.host.renderCount }) }
}

export function walkRequestRecord(id, accepted, dx, dz, at, before, context = {}) {
  return Object.freeze({ id, accepted: accepted === true, dx, dz, at, before: before ? Object.freeze({ x: before.x, z: before.z }) : null,
    context: Object.freeze({ ...context }) })
}
