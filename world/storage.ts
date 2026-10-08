import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, mkdir, open, readFile, realpath, rename, unlink } from 'node:fs/promises';
import path from 'node:path';

function digest(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
function inside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
}
async function existsNoSymlink(target: string): Promise<boolean> {
  try {
    const info = await lstat(target);
    if (info.isSymbolicLink()) throw new Error(`symlink path component refused: ${target}`);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

/** Creates an output store whose root must be a dedicated child of allowedRoot. */
export async function createOutputStore(root: string, allowedRoot: string): Promise<{
  writeImmutable(relativePath: string, bytes: Uint8Array): Promise<string>;
  writeAtomic(relativePath: string, bytes: Uint8Array): Promise<string>;
}> {
  if (!path.isAbsolute(root) || !path.isAbsolute(allowedRoot)) throw new TypeError('output roots must be absolute paths');
  const base = path.resolve(allowedRoot), output = path.resolve(root);
  if (output === base || !inside(base, output)) throw new Error('output root must be a dedicated directory inside allowedRoot');
  // The caller designates allowedRoot; canonicalize it once, then refuse symlinks beneath it.
  const realBase = await realpath(base);
  const baseInfo = await lstat(realBase);
  if (baseInfo.isSymbolicLink() || !baseInfo.isDirectory()) throw new Error('allowedRoot must resolve to a directory');
  const outputRelative = path.relative(base, output);
  let cursor = realBase;
  const canonicalOutput = path.resolve(realBase, outputRelative);
  for (const part of outputRelative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    if (await existsNoSymlink(cursor)) {
      const info = await lstat(cursor);
      if (!info.isDirectory()) throw new Error(`output path component is not a directory: ${cursor}`);
    } else await mkdir(cursor);
  }
  const realOutput = await realpath(canonicalOutput);
  if (!inside(realBase, realOutput) || realOutput === realBase) throw new Error('resolved output root escapes allowedRoot');

  const resolveSafe = async (relativePath: string): Promise<string> => {
    if (typeof relativePath !== 'string' || !relativePath || path.isAbsolute(relativePath) || relativePath.includes('\\') || relativePath.includes('\0')) {
      throw new TypeError('relative output path required');
    }
    const parts = relativePath.split('/');
    if (parts.some((part) => !part || part === '.' || part === '..')) throw new Error('path traversal refused');
    const target = path.resolve(realOutput, ...parts);
    if (!inside(realOutput, target) || target === realOutput) throw new Error('output path escapes output root');
    let parent = realOutput;
    for (const part of parts.slice(0, -1)) {
      parent = path.join(parent, part);
      if (!(await existsNoSymlink(parent))) await mkdir(parent);
      const info = await lstat(parent);
      if (!info.isDirectory()) throw new Error(`output parent is not a directory: ${parent}`);
      if (!inside(realOutput, await realpath(parent))) throw new Error('output parent escapes output root');
    }
    const parentReal = await realpath(path.dirname(target));
    if (!inside(realOutput, parentReal)) throw new Error('output parent escapes output root');
    return target;
  };
  const recheckSafe = async (target: string): Promise<void> => {
    const nowBase = await realpath(base);
    const nowOutput = await realpath(canonicalOutput);
    if (nowBase !== realBase || nowOutput !== realOutput || !inside(nowBase, nowOutput) || nowOutput === nowBase) {
      throw new Error('output root changed or escaped allowedRoot');
    }
    const parent = path.dirname(target);
    const parentInfo = await lstat(parent);
    if (parentInfo.isSymbolicLink() || !parentInfo.isDirectory() || await realpath(parent) !== parent) {
      throw new Error('output parent changed or contains a symlink');
    }
  };
  const verifyImmutableCollision = async (target: string, bytes: Uint8Array): Promise<void> => {
    await recheckSafe(target);
    if (!(await existsNoSymlink(target))) throw new Error('immutable publication collision disappeared');
    const info = await lstat(target);
    if (!info.isFile()) throw new Error('immutable collision is not a regular file');
    const existing = await readFile(target);
    if (digest(existing) !== digest(bytes)) throw new Error('immutable output collision has different content');
  };
  const writeAtomic = async (relativePath: string, bytes: Uint8Array): Promise<string> => {
    const target = await resolveSafe(relativePath);
    const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${randomBytes(12).toString('hex')}.tmp`);
    const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    try {
      // Recheck immediately before publication; symlink target replacement is refused.
      if (await existsNoSymlink(target)) {
        const info = await lstat(target);
        if (!info.isFile()) throw new Error('output target must be a regular file');
      }
      await recheckSafe(target);
      await rename(temporary, target);
      const dirHandle = await open(path.dirname(target), constants.O_RDONLY);
      try { await dirHandle.sync(); } finally { await dirHandle.close(); }
      return target;
    } catch (error) { await unlink(temporary).catch(() => {}); throw error; }
  };
  const writeImmutable = async (relativePath: string, bytes: Uint8Array): Promise<string> => {
    const target = await resolveSafe(relativePath);
    const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${randomBytes(12).toString('hex')}.tmp`);
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), 0o600);
      await handle.writeFile(bytes);
      await handle.sync();
      await handle.close();
      handle = undefined;
      await recheckSafe(target);
      try {
        // link() publishes atomically and fails with EEXIST instead of replacing a prior immutable file.
        await link(temporary, target);
        const dirHandle = await open(path.dirname(target), constants.O_RDONLY);
        try { await dirHandle.sync(); } finally { await dirHandle.close(); }
        return target;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        await verifyImmutableCollision(target, bytes);
        return target;
      }
    } catch (error) {
      throw error;
    } finally {
      if (handle) await handle.close().catch(() => {});
      await unlink(temporary).catch(() => {});
    }
  };
  return { writeImmutable, writeAtomic };
}
