import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { brotliCompressSync, gzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { defineConfig, mergeConfig, type Plugin } from 'vite'
import productionConfig from '../../../vite.config.ts'
import { prepareCandidateSources } from './prepare-candidate-sources.mjs'

const fixtureRoot = import.meta.dirname
const projectRoot = resolve(fixtureRoot, '../../..')
const outputDir = resolve(fixtureRoot, 'static-fixture')
const fastInputFiles = ['vite.fixture.config.ts', 'prepare-candidate-sources.mjs']
const sha256 = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex')
let candidateRecord: { sourceInputs: { path: string; sha256: string; rawBytes: number }[]; [key: string]: unknown } | null = null
let buildFailure: string | null = null
const rollupFiles = new Set<string>()

/** Hash every output; compress only assets/chunks reported by Rollup's output metadata. */
const prepareCandidateClones: Plugin = {
  name: 'environment-next-phase:v3-fast-inventory',
  enforce: 'pre',
  apply: 'build',
  buildStart() {
    rollupFiles.clear()
    const prepared = prepareCandidateSources() as typeof candidateRecord
    if (!prepared) throw new Error('Candidate source preparation returned no provenance')
    const extraInputs = fastInputFiles.map((relativePath) => {
      const content = readFileSync(resolve(fixtureRoot, relativePath))
      return { path: `evidence/graphics-loop/environment-next-phase-v3/${relativePath}`, sha256: sha256(content), rawBytes: content.length }
    })
    candidateRecord = { ...prepared, sourceInputs: [...prepared.sourceInputs, ...extraInputs] }
  },
  buildEnd(error) { if (error) buildFailure = error.message },
  generateBundle(_options, bundle) {
    for (const fileName of Object.keys(bundle)) rollupFiles.add(fileName.replaceAll('\\', '/'))
  },
  closeBundle() {
    if (buildFailure) return
    if (!candidateRecord) throw new Error('Candidate source clones were not prepared before static build')
    const htmlPath = resolve(outputDir, 'index.html')
    if (!existsSync(htmlPath)) throw new Error('Fast static fixture build did not emit index.html')
    const html = readFileSync(htmlPath, 'utf8')
    if (/\/\@vite\/client/.test(html)) throw new Error('Static fixture HTML still contains the Vite development client')
    const files: { path: string; rawBytes: number; gzipBytes: number | null; brotliBytes: number | null; sha256: string; compressionScope: 'rollup-emitted' | null }[] = []
    const walk = (directory: string) => {
      for (const item of readdirSync(directory, { withFileTypes: true })) {
        const path = resolve(directory, item.name)
        if (item.isDirectory()) walk(path)
        else {
          const content = readFileSync(path)
          const relative = path.slice(outputDir.length + 1).replaceAll('\\', '/')
          const emitted = rollupFiles.has(relative)
          files.push({ path: relative, rawBytes: content.length,
            gzipBytes: emitted ? gzipSync(content, { level: 9 }).length : null,
            brotliBytes: emitted ? brotliCompressSync(content).length : null,
            sha256: sha256(content), compressionScope: emitted ? 'rollup-emitted' : null })
        }
      }
    }
    walk(outputDir)
    files.sort((a, b) => a.path.localeCompare(b.path))
    const emitted = files.filter((file) => file.compressionScope === 'rollup-emitted')
    const notCompressed = files.filter((file) => file.compressionScope === null)
    const sum = (subset: typeof files, key: 'rawBytes' | 'gzipBytes' | 'brotliBytes') => subset.reduce((total, file) => total + (file[key] ?? 0), 0)
    mkdirSync(outputDir, { recursive: true })
    writeFileSync(resolve(outputDir, 'build-record-fast.json'), `${JSON.stringify({
      status: 'static Vite build output inventory; emitted HTML checked for the Vite development client',
      compressionScope: 'diagnostic subset only: Rollup output metadata files; copied/public files have null gzip/Brotli sizes',
      provenance: candidateRecord,
      entryHtml: 'index.html',
      rollupOutputMetadata: [...rollupFiles].sort(),
      files,
      totals: {
        files: files.length,
        rawBytes: sum(files, 'rawBytes'),
        gzipBytes: sum(emitted, 'gzipBytes'),
        brotliBytes: sum(emitted, 'brotliBytes'),
        allOutput: { files: files.length, rawBytes: sum(files, 'rawBytes') },
        rollupEmittedCompressedSubset: { files: emitted.length, rawBytes: sum(emitted, 'rawBytes'), gzipBytes: sum(emitted, 'gzipBytes'), brotliBytes: sum(emitted, 'brotliBytes') },
        notCompressed: { files: notCompressed.length, rawBytes: sum(notCompressed, 'rawBytes') },
      },
      note: 'Diagnostic turnaround inventory only. Compressed totals cover Rollup-emitted chunks/assets, not copied public files or the entire distribution. Not comparable to whole-distribution download budgets and not a product-size certificate.',
    }, null, 2)}\n`)
  },
}

/** Mirrors package.json browser condition for #city-map/* without eagerly importing any map. */
const browserCityMapAlias: Plugin = {
  name: 'environment-fixture:browser-city-map-condition',
  enforce: 'pre',
  apply: 'build',
  resolveId(source) {
    const match = /^#city-map\/([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(source)
    if (!match) return null
    const id = match[1]!
    const target = resolve(projectRoot, 'src/game/cities', id, 'map.ts')
    if (!existsSync(target)) throw new Error(`No browser city-map target for ${source}`)
    return target
  },
}

const config = mergeConfig(productionConfig, defineConfig({
  root: fixtureRoot,
  publicDir: resolve(projectRoot, 'public'),
  base: './',
  resolve: { alias: [{ find: /^\/src\//, replacement: `${resolve(projectRoot, 'src')}/` }] },
  plugins: [prepareCandidateClones, browserCityMapAlias],
  build: { outDir: outputDir, emptyOutDir: true, assetsDir: 'assets', rollupOptions: { input: resolve(fixtureRoot, 'index.html') } },
}))
config.build ??= {}
config.build.rollupOptions ??= {}
config.build.rollupOptions.input = resolve(fixtureRoot, 'index.html')
export default config
