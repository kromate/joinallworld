import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readBoundedLocalFile } from './inventory-reader.ts';
import { validateFineSourcePin } from './fine.ts';
import { buildFineCampaignPlan, type ReviewedFineCampaignInput } from './fine-campaign-plan.ts';
import { runFineCampaign } from './fine-campaign-run.ts';
import type { FineDirectoryCatalogueReport } from './fine-directory-catalogue.ts';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, keys: string[], label: string): void {
  if (Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) throw new TypeError(`${label} contains missing or unknown fields`);
}
async function json(filename: string, maxBytes: number): Promise<unknown> {
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBoundedLocalFile(filename, maxBytes))) as unknown;
}
function worldPinPath(value: unknown): string {
  if (typeof value !== 'string' || !/^world\/[a-z0-9][a-z0-9-]*\.json$/.test(value)) throw new TypeError('reviewed pin files must be named JSON files in world/');
  return path.join(repositoryRoot, value);
}
export async function loadFineCampaignInputs(configPath: string): Promise<ReviewedFineCampaignInput[]> {
  const config = object(await json(worldPinPath(configPath), 64 * 1024), 'fine campaign source config');
  exact(config, ['schemaVersion', 'reviewed'], 'fine campaign source config');
  if (config.schemaVersion !== 1 || !Array.isArray(config.reviewed) || config.reviewed.length > 300) throw new TypeError('fine campaign source config requires schema 1 and at most 300 reviewed entries');
  const reviewed: ReviewedFineCampaignInput[] = [];
  for (const raw of config.reviewed) {
    const entry = object(raw, 'reviewed campaign entry');
    exact(entry, ['pinFile', 'topologyReportPath'], 'reviewed campaign entry');
    if (typeof entry.topologyReportPath !== 'string') throw new TypeError('reviewed topology report path must be a string');
    reviewed.push({ pin: validateFineSourcePin(await json(worldPinPath(entry.pinFile), 64 * 1024)), topologyReportPath: entry.topologyReportPath });
  }
  return reviewed;
}
function positive(value: string, maximum: number, label: string): number {
  if (!/^[1-9][0-9]{0,6}$/.test(value) || Number(value) > maximum) throw new RangeError(`${label} must be 1..${maximum}`);
  return Number(value);
}
async function main(): Promise<void> {
  const controller = new AbortController();
  const stop = (): void => controller.abort(new Error('fine campaign interrupted by signal'));
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    const [command, configPath, ...args] = process.argv.slice(2);
    if ((command !== 'plan' && command !== 'run') || !configPath) throw new TypeError('usage: fine-campaign-cli.ts plan|run world/fine-campaign-sources.json --catalogue .cache/world-build/fine-directory-catalogue/reports/<hash>.json [--max-jobs <1..300>] [--duration-ms <1..120000>]');
    const flags = new Map<string, string>();
    for (let index = 0; index < args.length; index += 2) {
      const flag = args[index]!, value = args[index + 1];
      if (!['--catalogue', ...(command === 'run' ? ['--max-jobs', '--duration-ms'] : [])].includes(flag) || !value || flags.has(flag)) throw new TypeError('invalid or duplicate fine campaign CLI argument');
      flags.set(flag, value);
    }
    const relative = flags.get('--catalogue');
    const match = relative && /^\.cache\/world-build\/fine-directory-catalogue\/reports\/([a-f0-9]{64})\.json$/.exec(relative);
    if (!relative || !match) throw new TypeError('catalogue must be the exact private hash-addressed directory report path');
    const catalogueReportPath = path.join(repositoryRoot, relative);
    const bytes = await readBoundedLocalFile(catalogueReportPath, 1_000_000);
    if (sha(bytes) !== match[1]) throw new Error('catalogue report content hash mismatch');
    const report = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as FineDirectoryCatalogueReport;
    const plan = buildFineCampaignPlan(report, match[1]!, await loadFineCampaignInputs(configPath));
    if (controller.signal.aborted) throw controller.signal.reason;
    if (command === 'plan') process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    else {
      const result = await runFineCampaign({ repositoryRoot, plan, catalogueReportPath, signal: controller.signal,
        ...(flags.has('--max-jobs') ? { maxJobs: positive(flags.get('--max-jobs')!, 300, '--max-jobs') } : {}),
        ...(flags.has('--duration-ms') ? { durationMs: positive(flags.get('--duration-ms')!, 120_000, '--duration-ms') } : {}) });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    }
  } catch (error) {
    process.stderr.write(`fine campaign failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  } finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
