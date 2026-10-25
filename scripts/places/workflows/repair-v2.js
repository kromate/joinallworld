export const meta = {
  name: 'unique-places-repair-v2',
  description: 'Repair places that failed packing (budgets, size, render errors), then critic + fix',
  phases: [
    { title: 'Repair', detail: 'Sonnet repairer fixes each spec against its exact pack/render errors' },
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
// args.batches: [{city, places:[{id, errors:[...]}]}]
const batches = (typeof args !== 'undefined' && args && args.batches) || []
const ids = (b) => b.places.map(p => p.id)
const repairPrompt = (b) => `Read ${ROOT}/docs/agent-plans/unique-places/MODELLER.md and follow it (including its Shape toolbox and budgets). City: ${b.city}. These places already have specs in scripts/places/models/${b.city}/<venueId>.json, but their last render failed the packing gates with the errors below (from scripts/places/out/${b.city}/<venueId>.json). Fix each spec so it passes while staying true to the photo: for triangle or brotli overruns, cut hidden or back-side detail first (raise facetDeg, fewer rows/bays, plainer rear walls, simpler LOD1/LOD2 stand-ins), and keep the recognisable front; for "largest horizontal side" or "height not sane", re-check the real dimensions and fix the site/scale (model only the main building if the site is huge); for "raw GLB missing", re-render; for Python errors such as "'int' object is not iterable" or KeyError, find the wrong parameter type with python3 scripts/places/blender/parts/list.py <part> and correct it. If a spec is missing, build it from scratch per MODELLER.md. Re-render each with the shared queue (submit.ts, with --photo when a photo exists; the queue is already running, never start/stop it), check the new report in scripts/places/out has no errors, and validate with validate-model.ts. Touch only these spec files.\nErrors:\n${JSON.stringify(b.places, null, 1)}\nReturn per-place results.`
const critPrompt = (b, v) => `Read ${ROOT}/docs/agent-plans/unique-places/CRITIC.md and follow it. City: ${b.city}. Places: ${v.join(', ')}. Return one entry per place.`
const fixPrompt = (b, crit) => `Read ${ROOT}/docs/agent-plans/unique-places/MODELLER.md (incl. Shape toolbox). An independent critic reviewed these models in city ${b.city}. Apply its fixes to scripts/places/models/${b.city}/<venueId>.json while staying inside the LOD triangle budgets and brotli gates (these places previously failed them), re-render each with the shared queue (submit.ts with --photo when a photo exists), look at the new cmp image, make at most 2 rounds per place, update review {rounds, match, gaps}, and validate with validate-model.ts. If the critic says evidenceOk=false, find a correct photo or downgrade verified honestly. Touch only these spec files; never start/stop the queue. Critic findings:\n${JSON.stringify(crit, null, 1)}\nReturn per-place results.`

const results = await pipeline(batches,
  (b) => agent(repairPrompt(b), { label: `repair:${b.city}:${b.places[0].id}`, phase: 'Repair', schema: MODEL_SCHEMA, model: 'sonnet' }),
  (m, b) => {
    const photo = (m?.places || []).filter(p => p.verified === 'photo' && p.validated).map(p => p.venueId)
    if (!photo.length) return { m, c: { places: [] } }
    return agent(critPrompt(b, photo), { label: `critic:${b.city}:${b.places[0].id}`, phase: 'Critique', schema: CRIT_SCHEMA, model: 'sonnet' })
      .then(c => ({ m, c }))
  },
  ({ m, c }, b) => {
    const todo = (c?.places || []).filter(p => p.match !== 'close' && p.fixes?.length)
    if (!todo.length) return { model: m, critic: c, fixed: null }
    return agent(fixPrompt(b, todo), { label: `fix:${b.city}:${b.places[0].id}`, phase: 'Fix', schema: MODEL_SCHEMA, model: 'sonnet' })
      .then(f => ({ model: m, critic: c, fixed: f }))
  })
const ok = results.filter(Boolean)
const final = ok.flatMap(r => {
  const fixed = new Map((r.fixed?.places || []).map(p => [p.venueId, p]))
  return (r.model?.places || []).map(p => fixed.get(p.venueId) || p)
})
const done = final.filter(p => p.validated).map(p => `${p.city}/${p.venueId}`)
const failedBatches = batches.filter((b, i) => !results[i] || !results[i].model)
log(`repaired ${done.length}/${batches.reduce((n, b) => n + b.places.length, 0)}; failed batches ${failedBatches.length}`)
return { done, notValid: final.filter(p => !p.validated).map(p => `${p.city}/${p.venueId}`), failedBatches }
