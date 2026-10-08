import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { StreetAssetReader } from './types.ts'

/** Files are generated offline; a request never generates geography or reads a supplied path. */
export function nodeStreetAssets(roots: readonly string[]): StreetAssetReader {
  const cityOk = (city: string) => /^[a-z][a-z0-9-]{0,60}$/.test(city)
  async function read(city: string, file: string, cap: number): Promise<string | null> {
    if (!cityOk(city) || !/^[a-z0-9_-]{1,240}\.txt$/.test(file)) return null
    for (const root of roots) {
      const path = join(root, city, file)
      try {
        const info = await stat(path)
        if (!info.isFile() || info.size > cap) throw Error('Street asset exceeds its byte limit')
        const bytes = await readFile(path)
        if (bytes.byteLength > cap) throw Error('Street asset exceeds its byte limit')
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      } catch (error) { if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') continue; throw error }
    }
    return null
  }
  return {
    async readManifest(city, version) {
      if (version !== undefined && !/^street-v1-[a-z0-9_-]{1,120}$/.test(version)) return null
      const text = await read(city, version ? `manifest-${version}.txt` : 'manifest.txt', 4 * 1024 * 1024)
      return text === null ? null : JSON.parse(text) as unknown
    },
    readTile: (city, _version, file) => read(city, file, 256 * 1024),
  }
}
