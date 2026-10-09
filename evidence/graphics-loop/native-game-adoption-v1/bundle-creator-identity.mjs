import path from 'node:path';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(process.env.ALLWORLD_INTEGRATION_ROOT ?? process.cwd());
const fixtureSource = path.join(here, 'game-fixture.ts');
const fixture = await readFile(fixtureSource, 'utf8');
function constantExpression(name) {
  const marker = `const ${name} = `;
  const start = fixture.indexOf(marker);
  if (start < 0) throw new Error(`Game fixture is missing ${name}`);
  const valueStart = start + marker.length;
  let depth = 0, quote = '', escape = false;
  for (let index = valueStart; index < fixture.length; index += 1) {
    const character = fixture[index];
    if (quote) {
      if (escape) escape = false;
      else if (character === '\\') escape = true;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'" || character === '`') { quote = character; continue; }
    if (character === '(' || character === '[' || character === '{') depth += 1;
    else if (character === ')' || character === ']' || character === '}') depth -= 1;
    else if (character === ';' && depth === 0) return fixture.slice(valueStart, index).trim();
  }
  throw new Error(`Could not parse ${name} from game fixture source`);
}
const seed = constantExpression('PLAYER_SEED');
const look = constantExpression('PLAYER_LOOK');
if (!/^['"][^'"]+['"]$/.test(seed) || !look.startsWith('Object.freeze(')) {
  throw new Error('Game fixture identity source has an unexpected shape');
}
const generatedInput = path.join(here, 'creator-identity.game-input.ts');
await writeFile(generatedInput,
  `export const GAME_PLAYER_SEED = ${seed};\nexport const GAME_PLAYER_LOOK = ${look} as Readonly<Record<string, unknown>>;\n`);

await stat(path.join(repo, 'src/scene/avatar-preview.ts')).catch(() => {
  throw new Error(`Run creator identity bundling from the frozen 3af checkout after staging source: ${repo}`);
});
const outfile = path.resolve(process.argv[2] ?? path.join(here, 'creator-identity.bundle.js'));
const result = await esbuild.build({
  absWorkingDir: repo,
  entryPoints: [path.join(here, 'creator-identity.ts')],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2022'],
  packages: 'bundle',
  splitting: false,
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'silent',
  plugins: [{
    name: '3af-creator-identity-static-asset-urls',
    setup(build) {
      build.onResolve({ filter: /\?url$/ }, (args) => {
        const asset = path.resolve(args.resolveDir, args.path.slice(0, -4));
        const relative = path.relative(repo, asset);
        if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Asset escaped frozen repository: ${args.path}`);
        return { path: asset, namespace: 'native-creator-static-url' };
      });
      build.onLoad({ filter: /.*/, namespace: 'native-creator-static-url' }, (args) => {
        const relative = path.relative(repo, args.path).split(path.sep).join('/');
        return { contents: `export default ${JSON.stringify(`/${relative}`)};`, loader: 'js' };
      });
    },
  }],
});
if (result.errors.length) throw new Error(result.errors.map((error) => error.text).join('\n'));
const { size } = await stat(outfile);
console.log(JSON.stringify({ status: 'bundled', repo, entry: path.join(here, 'creator-identity.ts'), outfile,
  bytes: size, identitySource: path.relative(repo, fixtureSource), generatedInput: path.relative(repo, generatedInput) }));
