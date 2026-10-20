// Measure pictures: colour variety, dominant colour, edge density and contrast, against the scorecard thresholds.
//
//   node --experimental-strip-types scripts/evidence/inspect.ts docs/evidence/out/*.png
//   node --experimental-strip-types scripts/evidence/inspect.ts --advisory docs/evidence/anchors      (a folder: every .png in it)
//   node --experimental-strip-types scripts/evidence/inspect.ts --json shot.png
//
// Prints a table. Exits 1 when any picture misses a threshold, unless --advisory (then it only prints). Scene pictures
// (<view>-scene.png, the 3D canvas alone) are what the thresholds are meant for; a whole-page picture also holds the HUD.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { decodePng } from './png.ts';
import { computeMetrics, judge, type Finding, type Metrics } from './metrics.ts';

export interface Row { file: string; width: number; height: number; metrics: Metrics; findings: Finding[] }

export function expandPaths(paths: readonly string[]): string[] {
  const files: string[] = [];
  for (const path of paths) {
    if (statSync(path).isDirectory()) for (const name of readdirSync(path).sort()) { if (name.toLowerCase().endsWith('.png')) files.push(join(path, name)); }
    else files.push(path);
  }
  return files;
}

export function inspectFile(file: string): Row {
  const image = decodePng(readFileSync(file)), metrics = computeMetrics(image);
  return { file, width: image.width, height: image.height, metrics, findings: judge(metrics) };
}

/** The printed table: one line a picture, a column a measure, and the failing ones marked. */
export function table(rows: readonly Row[]): string {
  const head = ['picture', 'size', 'entropy', 'dominant', 'edges', 'contrast', 'verdict'];
  const lines = rows.map((row) => [basename(row.file), `${row.width}x${row.height}`, String(row.metrics.colorEntropyBits), String(row.metrics.dominantColorShare), String(row.metrics.edgeDensity), String(row.metrics.luminance.contrast), row.findings.length ? `FAIL ${row.findings.map((f) => f.code).join(',')}` : 'ok']);
  const widths = head.map((title, column) => Math.max(title.length, ...lines.map((line) => line[column]!.length)));
  const show = (cells: string[]): string => cells.map((cell, column) => cell.padEnd(widths[column]!)).join('  ').trimEnd();
  return [show(head), show(widths.map((width) => '-'.repeat(width))), ...lines.map(show)].join('\n');
}

function main(): void {
  const args = process.argv.slice(2), advisory = args.includes('--advisory'), json = args.includes('--json');
  const paths = args.filter((arg) => !arg.startsWith('--'));
  if (!paths.length) { console.error('Usage: inspect.ts [--advisory] [--json] <picture.png | folder>...'); process.exit(2); }
  const rows = expandPaths(paths).map(inspectFile);
  if (json) for (const row of rows) console.log(JSON.stringify(row));
  else {
    console.log(table(rows));
    for (const row of rows) for (const finding of row.findings) console.log(`${basename(row.file)}: ${finding.message}`);
  }
  if (!advisory && rows.some((row) => row.findings.length)) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
