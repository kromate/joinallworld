import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBoundedLocalFile } from './inventory-reader.ts';
import { publishRegionalFanout } from './regional-fanout-publish.ts';
import { validateRegionalFanoutRequest } from './regional-fanout.ts';
import { createRegionalFanoutCampaign } from './regional-fanout-campaign.ts';
import { canonicalJson, sha256 } from './pack.ts';
import { createOutputStore } from './storage.ts';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ROOT = path.join(REPO, '.cache', 'world-build');
async function main(): Promise<void> {
  const [command, config, ...flags] = process.argv.slice(2);
  if (command !== 'build' || !config || flags.length) throw new Error('usage: regional-fanout-cli.ts build <request.json>');
  const bytes = await readBoundedLocalFile(path.resolve(REPO, config), 256_000);
  const raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  // Checked-in request pins remain portable; invocation resolves paths before freezing request identity.
  if (raw?.parentPlan?.input && typeof raw.parentPlan.input.path === 'string') raw.parentPlan.input.path = path.resolve(REPO, raw.parentPlan.input.path);
  if (raw?.parentAcquisition?.receipt && typeof raw.parentAcquisition.receipt.path === 'string') raw.parentAcquisition.receipt.path = path.resolve(REPO, raw.parentAcquisition.receipt.path);
  const request = validateRegionalFanoutRequest(raw);
  const controller = new AbortController(), stop = () => controller.abort(new Error('regional fan-out interrupted'));
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    const outputRoot = path.join(ROOT, 'regional-fanout', request.id);
    const product = await publishRegionalFanout(request, { allowedRoot: ROOT, outputRoot, durationMs: 60_000, memoryMb: 512, signal: controller.signal });
    if (controller.signal.aborted) throw controller.signal.reason;
    const campaign = createRegionalFanoutCampaign(product, `${request.id}-local`);
    const campaignBytes = new TextEncoder().encode(`${canonicalJson(campaign)}\n`), campaignHash = sha256(campaignBytes);
    const store = await createOutputStore(outputRoot, ROOT);
    const campaignPath = await store.writeImmutable(`campaigns/${campaignHash}.json`, campaignBytes);
    process.stdout.write(`${JSON.stringify({ ...product, campaignPath, campaignHash, campaignUnits: campaign.units.length })}\n`);
  } finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
}
main().catch(error => { process.stderr.write(`${Buffer.from(error instanceof Error ? error.message : String(error)).subarray(0, 2048).toString('utf8')}\n`); process.exitCode = 1; });
