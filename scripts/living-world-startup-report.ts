/**
 * Optional read-only Vite output observer. Run with:
 *   node --experimental-strip-types scripts/living-world-startup-report.ts
 * The ordinary Vite config still owns every transform, chunk, and output decision.
 * Module lengths are Rollup pre-minifier contributions, never compressed-byte attribution.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { closeSync, constants, fstatSync, fsyncSync, ftruncateSync, lstatSync, mkdirSync, openSync, realpathSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { startupFiles, staticImports, type Dist } from './download-budget.ts'
import type { Plugin } from 'vite'

export const MAX_REPORT_BYTES = 1024 * 1024

export interface RenderedModule {
  renderedLength: number
  originalLength: number
  renderedExports: readonly string[]
  removedExports: readonly string[]
}

export interface StartupChunk {
  type: 'chunk'
  fileName: string
  code: string
  isEntry: boolean
  isDynamicEntry: boolean
  facadeModuleId: string | null
  imports: readonly string[]
  dynamicImports: readonly string[]
  exports: readonly string[]
  importedBindings: Readonly<Record<string, readonly string[]>>
  modules: Readonly<Record<string, RenderedModule>>
  viteMetadata?: { importedCss?: ReadonlySet<string> }
}

export interface StartupAsset { type: 'asset'; fileName: string; source: string | Uint8Array }
export type StartupOutput = StartupChunk | StartupAsset
export type StartupBundle = Readonly<Record<string, StartupOutput>>

export interface ModuleGraphInfo {
  importedIds: readonly string[]
  dynamicallyImportedIds: readonly string[]
  moduleSideEffects: boolean | string | null
}

export interface StartupReportIdentity { sourceSha: string; workingTreeDirty: boolean; workingTreeStatusSha256: string }

export interface LivingWorldStartupReport extends StartupReportIdentity {
  schemaVersion: 1
  city: 'lagos'
  closureRule: 'scripts/download-budget.ts startupFiles(dist, city); static imports only'
  gzipRule: 'Node zlib gzipSync of each final emitted startup chunk; sum matches per-file startup gzip accounting'
  moduleLengthRule: 'Rollup renderedLength/originalLength are pre-minifier module contributions; do not sum as final or compressed attribution'
  startupFiles: string[]
  startupTotals: { rawChunkBytes: number; gzipChunkBytes: number; chunks: number; modules: number }
  chunks: Array<{
    file: string
    rawBytes: number
    gzipBytes: number
    entry: boolean
    dynamicEntry: boolean
    facadeModuleId: string | null
    imports: string[]
    dynamicImports: string[]
    exports: string[]
    importedBindings: Record<string, string[]>
    importedCss: string[]
    modules: Array<{
      id: string
      renderedLength: number
      originalLength: number
      renderedExports: string[]
      removedExports: string[]
      importedIds: Array<string | null>
      dynamicallyImportedIds: Array<string | null>
      moduleSideEffects: boolean | string | null
      lengthMeaning: string
    }>
  }>
}

function bytes(source: string | Uint8Array): Uint8Array {
  return typeof source === 'string' ? Buffer.from(source, 'utf8') : source
}

/** Uses the exact startup closure helper that powers scripts/download-budget.ts. */
export function startupClosure(bundle: StartupBundle): { files: Set<string>; dist: Dist } {
  const dist = new Map<string, Uint8Array>()
  for (const output of Object.values(bundle)) {
    if (output.type === 'asset') dist.set(output.fileName, bytes(output.source))
    else dist.set(output.fileName, Buffer.from(output.code, 'utf8'))
  }
  const files = startupFiles(dist, 'lagos')
  if (!files) throw new Error('Startup report requires exactly one app shell, routes chunk, and Lagos rules/content chunk.')
  for (const file of files) {
    if (!file.endsWith('.js')) continue
    const output = Object.values(bundle).find(item => item.fileName === file)
    if (!output || output.type !== 'chunk') throw new Error(`Startup JavaScript output is not a Rollup chunk: ${file}`)
    const missing = staticImports(output.code).filter(imported => !dist.has(imported))
    if (missing.length) throw new Error(`Startup closure references missing output from ${file}: ${missing.join(', ')}`)
  }
  return { files, dist }
}

function safeId(value: string | null | undefined, repoRoot: string): string | null {
  if (value === null || value === undefined) return null
  if (value.startsWith('\0')) return `virtual:${safeId(value.slice(1), repoRoot) ?? 'unknown'}`
  let id = value
  if (id.startsWith('file://')) {
    try { id = fileURLToPath(id) } catch { return 'external:file-url' }
  }
  const query = id.indexOf('?'), suffix = query < 0 ? '' : id.slice(query)
  const path = (query < 0 ? id : id.slice(0, query)).replaceAll('\\', '/')
  const absolute = isAbsolute(path) || /^[A-Za-z]:\//.test(path) || path.startsWith('//')
  if (!absolute && !path.startsWith('../') && path !== '..' && !/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) return `${path}${suffix}`
  if (!absolute) {
    const shortHash = createHash('sha256').update(path).digest('hex').slice(0, 10)
    return `external:${basename(path)}:${shortHash}${suffix}`
  }
  const local = relative(repoRoot, path)
  if (local === '') return `.${suffix}`
  if (local !== '..' && !local.startsWith(`..${sep}`) && !isAbsolute(local)) return `${local.split(sep).join('/')}${suffix}`
  const nodeModules = path.lastIndexOf('/node_modules/')
  if (nodeModules >= 0) return `node_modules/${path.slice(nodeModules + '/node_modules/'.length)}${suffix}`
  const shortHash = createHash('sha256').update(path).digest('hex').slice(0, 10)
  return `external:${basename(path)}:${shortHash}${suffix}`
}

function nonnegativeInteger(value: number): boolean { return Number.isSafeInteger(value) && value >= 0 }

/** Builds only the startup report. Dynamic-only chunks and their module bodies are excluded. */
export function createLivingWorldStartupReport(
  bundle: StartupBundle,
  identity: StartupReportIdentity,
  moduleGraph: Readonly<Record<string, ModuleGraphInfo>>,
  repoRoot: string,
): LivingWorldStartupReport {
  if (!/^[a-f0-9]{40}$/.test(identity.sourceSha) || typeof identity.workingTreeDirty !== 'boolean'
    || !/^[a-f0-9]{64}$/.test(identity.workingTreeStatusSha256)) throw new Error('Invalid source identity.')
  const { files, dist } = startupClosure(bundle)
  const byName = new Map(Object.values(bundle).map(output => [output.fileName, output] as const))
  const chunkNames = [...files].filter(file => file.endsWith('.js')).sort()
  const chunks: LivingWorldStartupReport['chunks'] = chunkNames.map(file => {
    const output = byName.get(file)
    if (!output || output.type !== 'chunk') throw new Error(`Startup JavaScript output is not a Rollup chunk: ${file}`)
    const code = Buffer.from(output.code, 'utf8')
    const modules = Object.entries(output.modules).map(([id, rendered]) => {
      if (!nonnegativeInteger(rendered.renderedLength) || !nonnegativeInteger(rendered.originalLength)
        || !Array.isArray(rendered.removedExports) || !Array.isArray(rendered.renderedExports)) throw new Error(`Invalid Rollup module size record: ${id}`)
        const info = moduleGraph[id]
        if (!info) throw new Error(`Missing Rollup module graph record: ${id}`)
        if (!Array.isArray(info.importedIds) || !Array.isArray(info.dynamicallyImportedIds)
          || !(typeof info.moduleSideEffects === 'boolean' || typeof info.moduleSideEffects === 'string' || info.moduleSideEffects === null)) {
          throw new Error(`Invalid Rollup module graph record: ${id}`)
        }
        return {
        id: safeId(id, repoRoot) ?? 'unknown',
        renderedLength: rendered.renderedLength,
        originalLength: rendered.originalLength,
        renderedExports: [...rendered.renderedExports].sort(),
        removedExports: [...rendered.removedExports].sort(),
        importedIds: info.importedIds.map(id => safeId(id, repoRoot)),
        dynamicallyImportedIds: info.dynamicallyImportedIds.map(id => safeId(id, repoRoot)),
        moduleSideEffects: info.moduleSideEffects,
        lengthMeaning: 'pre-minifier module contribution; not final or compressed byte attribution',
      }
    }).sort((a, b) => a.id.localeCompare(b.id))
    return {
      file,
      rawBytes: code.byteLength,
      gzipBytes: gzipSync(code).byteLength,
      entry: output.isEntry,
      dynamicEntry: output.isDynamicEntry,
      facadeModuleId: safeId(output.facadeModuleId, repoRoot),
      imports: [...output.imports].sort(),
      dynamicImports: [...output.dynamicImports].sort(),
      exports: [...output.exports].sort(),
      importedBindings: Object.fromEntries(Object.entries(output.importedBindings)
        .map(([name, bindings]) => [name, [...bindings].sort()] as const).sort(([a], [b]) => a.localeCompare(b))),
      importedCss: [...(output.viteMetadata?.importedCss ?? [])].sort(),
      modules,
    }
  })
  const startupFilesList = [...files].sort()
  const startupChunks = chunks.filter(chunk => chunk.file.endsWith('.js'))
  const report: LivingWorldStartupReport = {
    schemaVersion: 1,
    ...identity,
    city: 'lagos',
    closureRule: 'scripts/download-budget.ts startupFiles(dist, city); static imports only',
    gzipRule: 'Node zlib gzipSync of each final emitted startup chunk; sum matches per-file startup gzip accounting',
    moduleLengthRule: 'Rollup renderedLength/originalLength are pre-minifier module contributions; do not sum as final or compressed attribution',
    startupFiles: startupFilesList,
    startupTotals: {
      rawChunkBytes: startupChunks.reduce((sum, chunk) => sum + chunk.rawBytes, 0),
      gzipChunkBytes: startupChunks.reduce((sum, chunk) => sum + chunk.gzipBytes, 0),
      chunks: startupChunks.length,
      modules: startupChunks.reduce((sum, chunk) => sum + chunk.modules.length, 0),
    },
    chunks,
  }
  if (Buffer.byteLength(`${JSON.stringify(report, null, 2)}\n`, 'utf8') > MAX_REPORT_BYTES) {
    throw new Error(`Startup report exceeds the ${MAX_REPORT_BYTES}-byte output cap.`)
  }
  // Keep a direct check that closure files came from the generated dist map before returning.
  if (![...files].every(file => dist.has(file))) throw new Error('Incomplete startup closure.')
  return report
}

/** Writes only to the fixed .tmp report path, refusing symlinked parents/targets and hard-linked files. */
export function writeBoundedStartupReport(repoRoot: string, report: LivingWorldStartupReport): string {
  const payload = `${JSON.stringify(report, null, 2)}\n`
  if (Buffer.byteLength(payload, 'utf8') > MAX_REPORT_BYTES) throw new Error(`Startup report exceeds the ${MAX_REPORT_BYTES}-byte output cap.`)
  const root = resolve(repoRoot)
  const rootInfo = lstatSync(root)
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory() || realpathSync(root) !== root) {
    throw new Error('Report repository root must be a canonical, non-symlink directory.')
  }
  const tmp = resolve(root, '.tmp')
  let tmpInfo: ReturnType<typeof lstatSync>
  try { tmpInfo = lstatSync(tmp) } catch (error) {
    if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') throw error
    // The root is canonical and this is the only parent created; never recurse through a symlink.
    mkdirSync(tmp)
    tmpInfo = lstatSync(tmp)
  }
  if (tmpInfo.isSymbolicLink() || !tmpInfo.isDirectory() || realpathSync(tmp) !== tmp) {
    throw new Error('Report .tmp directory must be a real directory inside the repository.')
  }
  const target = resolve(tmp, 'living-world-startup-report.json')
  const noFollow = constants.O_NOFOLLOW
  if (typeof noFollow !== 'number') throw new Error('This platform does not support O_NOFOLLOW; refusing report output.')
  let previous: ReturnType<typeof lstatSync> | null = null
  try { previous = lstatSync(target) } catch (error) {
    if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') throw error
  }
  if (previous && (previous.isSymbolicLink() || !previous.isFile() || previous.nlink !== 1)) {
    throw new Error('Report target must be a non-symlink regular file with one link.')
  }
  const flags = constants.O_WRONLY | noFollow | (previous ? 0 : constants.O_CREAT | constants.O_EXCL)
  const fd = openSync(target, flags, 0o600)
  try {
    const opened = fstatSync(fd), named = lstatSync(target)
    const currentRoot = lstatSync(root), currentTmp = lstatSync(tmp)
    if (!opened.isFile() || opened.nlink !== 1 || named.isSymbolicLink()
      || currentRoot.isSymbolicLink() || !currentRoot.isDirectory() || realpathSync(root) !== root
      || currentTmp.isSymbolicLink() || !currentTmp.isDirectory() || realpathSync(tmp) !== tmp || realpathSync(target) !== target
      || opened.dev !== named.dev || opened.ino !== named.ino
      || previous && (opened.dev !== previous.dev || opened.ino !== previous.ino)) {
      throw new Error('Report target changed or is not a private regular file.')
    }
    ftruncateSync(fd, 0)
    writeFileSync(fd, payload, 'utf8')
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  return target
}

async function cli(): Promise<void> {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  if (resolve(process.cwd()) !== repoRoot) throw new Error('Run the startup observer from this repository root so Vite and source identity refer to the same checkout.')
  if (process.argv.length > 2) throw new Error('Usage: node --experimental-strip-types scripts/living-world-startup-report.ts')
  const git = (args: string[]) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim()
  const sourceSha = git(['rev-parse', 'HEAD'])
  const status = git(['status', '--porcelain', '--untracked-files=all'])
  const identity: StartupReportIdentity = {
    sourceSha,
    workingTreeDirty: status.length > 0,
    workingTreeStatusSha256: createHash('sha256').update(status).digest('hex'),
  }
  const moduleGraph: Record<string, ModuleGraphInfo> = Object.create(null) as Record<string, ModuleGraphInfo>
  // Loading Vite lazily keeps pure report construction importable by Node tests.
  const { build } = await import('vite')
  const observer: Plugin = {
    name: 'living-world-startup-report',
    enforce: 'post',
    writeBundle(_options, bundle) {
      if (git(['rev-parse', 'HEAD']) !== sourceSha
        || createHash('sha256').update(git(['status', '--porcelain', '--untracked-files=all'])).digest('hex') !== identity.workingTreeStatusSha256) {
        throw new Error('Source identity changed during the observed build; refuse stale exact-SHA evidence.')
      }
      const typedBundle = bundle as unknown as StartupBundle
      const { files } = startupClosure(typedBundle)
      for (const output of Object.values(typedBundle)) {
        if (output.type !== 'chunk' || !files.has(output.fileName)) continue
        for (const id of Object.keys(output.modules)) {
          const info = this.getModuleInfo(id)
          if (!info) throw new Error(`Missing Rollup module graph record: ${id}`)
          moduleGraph[id] = {
            importedIds: info.importedIds,
            dynamicallyImportedIds: info.dynamicallyImportedIds,
            moduleSideEffects: typeof info?.moduleSideEffects === 'boolean' || typeof info?.moduleSideEffects === 'string'
              ? info.moduleSideEffects : null,
          }
        }
      }
      const report = createLivingWorldStartupReport(typedBundle, identity, moduleGraph, repoRoot)
      const reportPath = writeBoundedStartupReport(repoRoot, report)
      console.log(`Wrote startup report (${report.startupTotals.chunks} chunks, ${report.startupTotals.modules} modules): ${reportPath}`)
    },
  }
  await build({ plugins: [observer] })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void cli().catch(error => { console.error(error); process.exitCode = 1 })
}
