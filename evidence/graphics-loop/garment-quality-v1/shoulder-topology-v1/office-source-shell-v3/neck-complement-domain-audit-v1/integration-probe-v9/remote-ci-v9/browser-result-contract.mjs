import path from 'node:path';

/** The browser controller writes screenshot artifacts below this unique per-run root. */
export function browserResultPaths(resultDir) {
  if (typeof resultDir !== 'string' || !resultDir || !path.isAbsolute(resultDir)) {
    throw new Error('Browser RESULT_DIR must be an explicit absolute per-run directory');
  }
  const root = path.resolve(resultDir);
  return Object.freeze({
    root,
    output: path.join(root, 'browser-artifacts'),
    stages: path.join(root, 'browser-stages.jsonl'),
  });
}

/** Mirror the runner/controller contract: only browser workloads need a result root. */
export function gatedEnvironment(mode, resultDir, inherited = {}) {
  if (!['build', 'synthetic', 'browser'].includes(mode)) throw new Error(`Unknown workload mode: ${mode}`);
  const env = { ...inherited };
  if (mode === 'browser') env.RESULT_DIR = browserResultPaths(resultDir).root;
  else delete env.RESULT_DIR;
  return env;
}
