import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** @param {string} source @param {string} sha */
export function checkSource(source, sha) {
  if (!/^[a-f0-9]{40}$/.test(sha)) throw Error('Invalid source SHA');
  /** @param {string[]} args */
  const git = args => {
    const result = spawnSync('git', ['-C', source, ...args], { encoding: 'utf8' });
    if (result.status !== 0) throw Error('Source must be an ancestor of public main');
    return result.stdout.trim();
  };
  if (!/^https:\/\/github\.com\/kromate\/joinallworld(?:\.git)?$/.test(git(['remote', 'get-url', 'origin']))) throw Error('Wrong source repository');
  if (git(['rev-parse', 'HEAD']) !== sha) throw Error('Source checkout mismatch');
  git(['merge-base', '--is-ancestor', sha, 'refs/remotes/origin/main']);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2] || !process.argv[3]) throw Error('Missing source and SHA');
  checkSource(process.argv[2], process.argv[3]);
  console.log('PASS reviewed source is on public main');
}
