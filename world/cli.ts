import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlan, runPlan, status } from './pipeline.ts';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
function usage(): never {
  console.error('Usage:\n  node --experimental-strip-types world/cli.ts plan <plan.json>\n  node --experimental-strip-types world/cli.ts run <plan.json> [--max-jobs N] [--duration-ms N]\n  node --experimental-strip-types world/cli.ts status');
  process.exit(2);
}
function option(args: string[], name: string, fallback: number): number {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  const value = Number(args[index + 1]);
  if (!Number.isSafeInteger(value) || value < 1) usage();
  return value;
}
function runOptions(args: string[]): { maxJobs: number; durationMs: number } {
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== '--max-jobs' && args[i] !== '--duration-ms') usage();
    if (!args[i + 1] || args[i + 1]!.startsWith('--')) usage();
    i++;
  }
  if (args.filter(x => x === '--max-jobs').length > 1 || args.filter(x => x === '--duration-ms').length > 1) usage();
  return { maxJobs: option(args, '--max-jobs', 20), durationMs: option(args, '--duration-ms', 60_000) };
}
try {
  const [command, target, ...flags] = process.argv.slice(2);
  if (command === 'status' && !target && flags.length === 0) {
    const jobs = await status(); console.log(JSON.stringify(jobs, null, 2));
    if (jobs.some(job => job.status === 'failed')) process.exitCode = 1;
    else if (jobs.some(job => job.status === 'queued' || job.status === 'leased')) process.exitCode = 2;
  } else if ((command === 'plan' || command === 'run') && target) {
    const planPath = path.resolve(root, target);
    const plan = await loadPlan(planPath);
    if (command === 'plan') {
      if (flags.length) usage();
      const raw = await readFile(planPath);
      console.log(JSON.stringify({ plan: planPath, planBytes: raw.byteLength, region: plan.region.id, countryCode: plan.region.countryCode, source: plan.source.id, input: plan.input }, null, 2));
    } else {
      const result = await runPlan(plan, runOptions(flags));
      console.log(JSON.stringify(result, null, 2));
      if (result.failures.length || result.jobs.some(job => job.status === 'failed')) process.exitCode = 1;
      else if (result.stopped || result.jobs.some(job => job.status === 'queued' || job.status === 'leased')) process.exitCode = 2;
    }
  } else usage();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
