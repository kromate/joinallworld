import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireAccraTerrain } from './terrain.ts';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const python = process.env.WORLD_PYTHON ?? path.join(root, '.cache/world-build/tooling/terrain-venv/bin/python3.12');
try {
  if (process.argv.length !== 2) throw new Error('Usage: node --experimental-strip-types world/terrain-cli.ts');
  const result = await acquireAccraTerrain({ buildRoot: path.join(root, '.cache/world-build'), pythonExecutable: python });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
