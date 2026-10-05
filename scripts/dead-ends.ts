/**
 * Dead-end search: lists the states from which a sensible player, doing only what the rules allow and what they can afford, cannot
 * recover their needs, earn, or (as a visitor) get home within three days. Run it with the safety nets left out to see what they are
 * for, and with them in to see that nothing is left.
 *
 *   node --experimental-strip-types scripts/dead-ends.ts [--samples 1500] [--seed 1] [--no-nets]
 *
 * The same search runs as a test (src/game/stuck.test.ts). The rules and the numbers it reads: src/game/stuckSearch.ts.
 */
import { loadCityContent, playableCityIds } from '../src/game/cities/registry.ts';
import { playOut, rng, sampleOf, stuck } from '../src/game/stuckSearch.ts';
import type { Outcome } from '../src/game/stuckSearch.ts';

await Promise.all(['lagos', 'ibadan', 'abeokuta', 'ota', 'ijebu-ode', 'sagamu', 'port-harcourt', 'abuja', 'kano'].map(loadCityContent));
const arg = (name: string, fallback: number): number => { const at = process.argv.indexOf(`--${name}`); return at >= 0 ? Number(process.argv[at + 1]) : fallback; };
const nets = !process.argv.includes('--no-nets');
const samples = arg('samples', 1500), next = rng(arg('seed', 1));
const cities = playableCityIds();
const failing: Outcome[] = [];
for (let i = 0; i < samples; i++) {
  const outcome = playOut(sampleOf(next, cities, ['lagos', 'port-harcourt', 'kano']), { nets });
  if (stuck(outcome)) failing.push(outcome);
}
const band = (value: number, edges: number[]): string => { const at = edges.findIndex((edge) => value < edge); return at < 0 ? `${edges.at(-1)}+` : at === 0 ? `<${edges[0]}` : `${edges[at - 1]}-${edges[at]}`; };
const table = new Map<string, number>();
for (const { sample, needsOk, earned, home } of failing) {
  const where = sample.city === sample.home ? 'resident' : sample.midTrip !== undefined ? 'visitor mid-trip' : 'visitor';
  const lacks = [needsOk ? '' : 'needs', earned ? '' : 'cash', home ? '' : 'home'].filter(Boolean).join('+');
  const key = `${where} | cash ${band(sample.cash, [1000, 5000, 12000])} | a need under 20: ${sample.hunger < 20 || sample.energy < 20 ? 'yes' : 'no'} | no way out: ${lacks}`;
  table.set(key, (table.get(key) ?? 0) + 1);
}
console.log(`${samples} sampled states, safety nets ${nets ? 'in' : 'out'}: ${failing.length} dead ends`);
for (const [key, count] of [...table].sort((a, b) => b[1] - a[1])) console.log(String(count).padStart(5), key);
if (nets && failing.length) { console.log(JSON.stringify(failing.slice(0, 3), null, 1)); process.exitCode = 1; }
