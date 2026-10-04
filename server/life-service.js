import { createLife, advanceLife, startActivity, cancelActivity, startTravel, applyJob, VENUES } from '../src/life.js';

export function settleCity(session, cityId, now) {
  session.cities ||= {};
  const entry = session.cities[cityId] ||= { state: createLife({ name: session.name }), updatedAt: now };
  entry.state = createLife(entry.state);
  const elapsed = Number.isFinite(entry.updatedAt) ? Math.max(0, (now - entry.updatedAt) / 1000) : 0;
  if (entry.state.activeAction && elapsed > 0) advanceLife(entry.state, elapsed);
  entry.updatedAt = now;
  entry.state.name = session.name;
  return entry.state;
}

export function applyLifeAction(state, body) {
  if (body.type === 'apply-job') return applyJob(state, body.id);
  if (body.type === 'activity') return startActivity(state, body.id);
  if (body.type === 'cancel') return cancelActivity(state);
  if (body.type === 'travel') return startTravel(state, body.id, body.mode);
  if (body.type === 'spot') {
    const valid = !state.activeAction && typeof body.id === 'string' && Object.hasOwn(VENUES[state.location].spots, body.id);
    if (valid) state.spot = body.id;
    return { ok: valid, code: valid ? 'selected' : state.activeAction ? 'busy' : 'invalid_spot', state };
  }
  throw new Error('Invalid action type');
}
