export const meta = {
  name: 'unique-places-review-v2',
  description: 'Critic + fix pass for live photo-verified places that never got an independent review',
  phases: [
    { title: 'Critique', detail: 'independent Sonnet critic per batch reads comparison images' },
    { title: 'Fix', detail: 'Sonnet fixer applies critic fixes, re-renders, validates' },
  ],
}
const ROOT = '/Users/anthonyakpan/work/allworld-unique'
const PLACE = { type: 'object', properties: {
  city: { type: 'string' }, venueId: { type: 'string' }, verified: { type: 'string' }, match: { type: 'string' },
  rounds: { type: 'number' }, lod0Triangles: { type: 'number' }, validated: { type: 'boolean' }, gaps: { type: 'string' } },
  required: ['city', 'venueId', 'verified', 'validated'] }
const MODEL_SCHEMA = { type: 'object', properties: { places: { type: 'array', items: PLACE }, problems: { type: 'string' } }, required: ['places'] }
const CRIT_SCHEMA = { type: 'object', properties: { places: { type: 'array', items: { type: 'object', properties: {
  city: { type: 'string' }, venueId: { type: 'string' }, match: { type: 'string' }, evidenceOk: { type: 'boolean' },
  fixes: { type: 'array', items: { type: 'string' } } }, required: ['city', 'venueId', 'match', 'fixes'] } } }, required: ['places'] }
// args.batches: [{city, venues:[ids]}]
const batches = args.batches
const critPrompt = (b) => `Read ${ROOT}/docs/agent-plans/unique-places/CRITIC.md and follow it. City: ${b.city}. Places: ${b.venues.join(', ')}. These models are already built and live; if a place has no recent cmp image, render one with the shared queue first (submit.ts with --photo; never start/stop the queue). Return one entry per place.`
const fixPrompt = (b, crit) => `Read ${ROOT}/docs/agent-plans/unique-places/MODELLER.md (incl. Shape toolbox). An independent critic reviewed these models in city ${b.city}. Apply its fixes to scripts/places/models/${b.city}/<venueId>.json, re-render each with the shared queue (submit.ts with --photo when a photo exists), look at the new cmp image, make at most 2 rounds per place, update review {rounds, match, gaps}, and validate with validate-model.ts. If the critic says evidenceOk=false, find a correct photo or downgrade verified honestly. Other agents work on other places in parallel; touch only these spec files. The render queue is already running (never start/stop it). Critic findings:\n${JSON.stringify(crit, null, 1)}\nReturn per-place results.`

const results = await pipeline(batches,
  (b) => agent(critPrompt(b), { label: `critic:${b.city}:${b.venues[0]}`, phase: 'Critique', schema: CRIT_SCHEMA, model: 'sonnet' }),
  (c, b) => {
    const todo = (c?.places || []).filter(p => p.match !== 'close' && p.fixes?.length)
    if (!todo.length) return { b, critic: c, fixed: null }
    return agent(fixPrompt(b, todo), { label: `fix:${b.city}:${b.venues[0]}`, phase: 'Fix', schema: MODEL_SCHEMA, model: 'sonnet' })
      .then(f => ({ b, critic: c, fixed: f }))
  })
const ok = results.filter(Boolean)
const fixed = ok.flatMap(r => r.fixed?.places || [])
const changed = fixed.map(p => `${p.city}/${p.venueId}`)
const notValid = fixed.filter(p => !p.validated).map(p => `${p.city}/${p.venueId}`)
log(`critiqued ${ok.length}/${batches.length} batches; fixed ${changed.length}; not validated ${notValid.length}`)
return { changed, notValid, critics: ok.map(r => r.critic) }
