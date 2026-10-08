import path from 'node:path';
import { validateCampaign } from './campaign.ts';
import { canonicalJson, sha256 } from './pack.ts';
import type { WorldCampaign } from './production-types.ts';
import type { RegionalFanoutPublished } from './regional-fanout-types.ts';

/** Existing local jobs carry derived inputs; index cell accounting stays separate from country rollups. */
export function createRegionalFanoutCampaign(product: RegionalFanoutPublished, id: string): WorldCampaign {
  if (sha256(`${canonicalJson(product.index)}\n`) !== product.indexHash) throw new Error('regional index pin is inconsistent');
  const root = path.dirname(path.dirname(product.indexPath));
  const expected = product.index.cells;
  if (product.plans.length !== expected.length || new Set(product.plans.map(plan => plan.region.id)).size !== expected.length) throw new Error('regional campaign must retain every declared cell, including empty-owned cells');
  const byId = new Map(product.plans.map(plan => [plan.region.id, plan]));
  // Keep all cells in the index; the existing runner deliberately rejects zero-tile
  // local plans. An empty owner cell can still depend on geometry in another cell.
  const units = expected.filter(cell => cell.status === 'owned-features').map((cell, priority) => {
    const plan = byId.get(cell.region.id);
    if (!plan || canonicalJson(plan) !== canonicalJson({ ...cell.plan, input: { ...cell.plan.input, path: path.join(root, cell.input.path) } })) throw new Error('regional campaign plan differs from pinned cell plan');
    return { id: cell.region.id, inventoryUnitId: product.index.request.inventoryUnitId, priority, kind: 'local' as const, plan };
  });
  for (const cell of expected.filter(cell => cell.status === 'empty-owned')) {
    const plan = byId.get(cell.region.id);
    if (!plan || cell.ownedFeatureKeys.length || canonicalJson(plan) !== canonicalJson({ ...cell.plan, input: { ...cell.plan.input, path: path.join(root, cell.input.path) } })) throw new Error('empty-owned cell differs from pinned regional plan');
  }
  const campaign = validateCampaign({ schemaVersion: 1, id, inventoryHash: product.index.request.inventoryHash,
    units: [...units, { id: 'legacy-ng', inventoryUnitId: 'legacy-ng', priority: units.length, kind: 'protected', reason: 'Nigeria remains with its existing map/provider; regional fan-out is isolated.' }],
    limits: { durationMs: 600_000, jobDurationMs: 60_000, networkBytes: 1, inputBytes: 30_000_000, outputBytes: 100_000_000, diskBytes: 256_000_000, memoryMb: 512, maxAttempts: 2 } });
  if(campaign.schemaVersion!==1)throw new Error('regional fan-out requires the unchanged schema1 campaign');
  return campaign;
}
