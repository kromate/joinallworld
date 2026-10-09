/** Fail closed unless the getter contains a complete, current published load for actorId. */
export function requireCurrentPublishedActorTrace(trace, actorId) {
  if (!Array.isArray(trace) || trace.length === 0 || typeof actorId !== 'string' || actorId.length === 0) {
    throw new Error('Actor load trace is missing or malformed');
  }
  const generations = trace.map(item => item?.generation);
  if (generations.some(value => !Number.isSafeInteger(value) || value < 1)) {
    throw new Error('Actor load trace contains an invalid generation');
  }
  const generation = Math.max(...generations);
  const events = trace.filter(item => item.generation === generation);
  if (events.some(item => item.actorId !== actorId || typeof item.stage !== 'string')) {
    throw new Error(`Latest actor-load generation ${generation} does not belong solely to ${actorId}`);
  }
  const stage = name => events.find(item => item.stage === name);
  const required = ['selection-start', 'body-load-start', 'body-load-resolved', 'recipe-start', 'recipe-resolved', 'actor-published'];
  if (required.some(name => !stage(name)) || stage('load-failed')) {
    throw new Error(`Actor ${actorId} generation ${generation} did not complete publication`);
  }
  if (stage('body-load-resolved').requestGenerationCurrent !== true
    || stage('recipe-resolved').requestGenerationCurrent !== true
    || typeof stage('actor-published').bodyKey !== 'string') {
    throw new Error(`Actor ${actorId} generation ${generation} is stale or lacks a published body`);
  }
  return Object.freeze({ actorId, generation, events: Object.freeze(events.map(item => Object.freeze({ ...item }))) });
}
