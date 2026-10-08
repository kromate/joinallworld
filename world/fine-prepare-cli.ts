import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runFinePreparation } from './fine-prepare-run.ts';

async function main(): Promise<void> {
  const controller = new AbortController();
  const stop = (): void => controller.abort(new Error('fine preparation interrupted'));
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    const [configPath, ...args] = process.argv.slice(2);
    if (!configPath) throw new TypeError('usage: fine-prepare-cli.ts world/fine-promotion-sources.json [--max-jobs 1..16] [--duration-ms 1..120000] [--cache-only]');
    const flags = new Map<string, string>();
    let cacheOnly = false;
    for (let index = 0; index < args.length; index++) {
      const flag = args[index]!;
      if (flag === '--cache-only' && !cacheOnly) { cacheOnly = true; continue; }
      if (!['--max-jobs','--duration-ms'].includes(flag) || flags.has(flag)) throw new TypeError('unknown or duplicate fine preparation argument');
      const value = args[++index];
      if (!value || !/^[1-9][0-9]{0,5}$/.test(value)) throw new TypeError('fine preparation numeric arguments require canonical positive decimal integers');
      flags.set(flag, value);
    }
    const result = await runFinePreparation({ repositoryRoot: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), configPath, signal: controller.signal, cacheOnly,
      ...(flags.has('--max-jobs') ? { maxJobs: Number(flags.get('--max-jobs')) } : {}),
      ...(flags.has('--duration-ms') ? { durationMs: Number(flags.get('--duration-ms')) } : {}) });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) { process.stderr.write(`fine preparation failed: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
  finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
