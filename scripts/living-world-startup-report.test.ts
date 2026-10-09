import test from 'node:test'
import assert from 'node:assert/strict'
import { linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  createLivingWorldStartupReport,
  MAX_REPORT_BYTES,
  startupClosure,
  writeBoundedStartupReport,
  type ModuleGraphInfo,
  type StartupBundle,
  type StartupChunk,
  type StartupReportIdentity,
} from './living-world-startup-report.ts'

const identity: StartupReportIdentity = {
  sourceSha: 'a'.repeat(40),
  workingTreeDirty: false,
  workingTreeStatusSha256: 'b'.repeat(64),
}
const repoRoot = '/synthetic/project'
function chunk(fileName: string, code: string, options: Partial<StartupChunk> = {}): StartupChunk {
  return {
    type: 'chunk', fileName, code, isEntry: false, isDynamicEntry: false,
    facadeModuleId: null, imports: [], dynamicImports: [], exports: [], importedBindings: {}, modules: {},
    ...options,
  }
}
function fixture(): { bundle: Record<string, StartupBundle[string]>; moduleGraph: Record<string, ModuleGraphInfo> } {
  const mainId = `${repoRoot}/src/app/main.ts`
  const bundle: Record<string, StartupBundle[string]> = {
    html: { type: 'asset', fileName: 'index.html', source: '<script type="module" src="/assets/app-12345678.js"></script><link rel="stylesheet" href="/assets/app-87654321.css">' },
    css: { type: 'asset', fileName: 'assets/app-87654321.css', source: 'body{color:#111}' },
    app: chunk('assets/app-12345678.js', 'import "./shared-00000001.js"; import("./lazy-00000002.js");', {
      isEntry: true, imports: ['assets/shared-00000001.js'], dynamicImports: ['assets/lazy-00000002.js'],
      modules: { [mainId]: { renderedLength: 90, originalLength: 130, renderedExports: ['start'], removedExports: ['debugOnly'] } },
    }),
    shared: chunk('assets/shared-00000001.js', 'export const answer=42;', {
      modules: { [`${repoRoot}/src/app/shared.ts`]: { renderedLength: 24, originalLength: 28, renderedExports: ['answer'], removedExports: [] } },
    }),
    shell: chunk('assets/startApp-11111111.js', 'export const shell=1;'),
    routes: chunk('assets/city-routes-22222222.js', 'export const routes=1;'),
    rules: chunk('assets/city-lagos-rules-33333333.js', 'export const rules=1;'),
    content: chunk('assets/city-lagos-content-44444444.js', 'export const content=1;'),
    lazy: chunk('assets/lazy-00000002.js', 'export const deferred=1;', {
      isDynamicEntry: true,
      modules: { [`${repoRoot}/src/app/lazy-only.ts`]: { renderedLength: 600, originalLength: 800, renderedExports: ['deferred'], removedExports: [] } },
    }),
  }
  const moduleGraph: Record<string, ModuleGraphInfo> = {
    [mainId]: {
      importedIds: [`${repoRoot}/src/app/shared.ts`, '/Users/private-workspace/dependency/opaque.ts'],
      dynamicallyImportedIds: [`${repoRoot}/src/app/lazy-only.ts`], moduleSideEffects: false,
    },
    [`${repoRoot}/src/app/shared.ts`]: { importedIds: [], dynamicallyImportedIds: [], moduleSideEffects: false },
  }
  return { bundle, moduleGraph }
}

test('uses the download-budget startup closure and excludes dynamic-only chunks/modules', () => {
  const { bundle, moduleGraph } = fixture()
  const closure = startupClosure(bundle)
  assert.ok(closure.files.has('assets/shared-00000001.js'))
  assert.ok(!closure.files.has('assets/lazy-00000002.js'))
  const before = JSON.stringify(bundle)
  const report = createLivingWorldStartupReport(bundle, identity, moduleGraph, repoRoot)
  assert.equal(JSON.stringify(bundle), before, 'observation must not rewrite output, code, or dependency metadata')
  assert.deepEqual(report.startupFiles, [...closure.files].sort())
  assert.ok(report.chunks.some(item => item.file === 'assets/shared-00000001.js'))
  assert.ok(!report.chunks.some(item => item.file === 'assets/lazy-00000002.js'))
  const app = report.chunks.find(item => item.file === 'assets/app-12345678.js')!
  const appOutput = bundle.app
  if (!appOutput || appOutput.type !== 'chunk') throw new Error('Fixture app chunk missing.')
  assert.deepEqual(app.dynamicImports, ['assets/lazy-00000002.js'])
  assert.equal(app.rawBytes, Buffer.byteLength(appOutput.code, 'utf8'))
  assert.equal(typeof app.gzipBytes, 'number')
  assert.deepEqual(app.modules[0], {
    id: 'src/app/main.ts', renderedLength: 90, originalLength: 130,
    renderedExports: ['start'], removedExports: ['debugOnly'],
    importedIds: ['src/app/shared.ts', app.modules[0]!.importedIds[1]], dynamicallyImportedIds: ['src/app/lazy-only.ts'],
    moduleSideEffects: false,
    lengthMeaning: 'pre-minifier module contribution; not final or compressed byte attribution',
  })
  assert.match(app.modules[0]!.importedIds[1]!, /^external:opaque\.ts:[a-f0-9]{10}$/)
  assert.equal(JSON.stringify(report).includes('/Users/private-workspace'), false)
  assert.match(report.moduleLengthRule, /do not sum as final or compressed attribution/)
  assert.equal(report.startupTotals.gzipChunkBytes, report.chunks.reduce((sum, item) => sum + item.gzipBytes, 0))
})

test('fails when required startup roots or a static startup dependency are missing', () => {
  const noRoots = fixture().bundle
  delete noRoots.content
  assert.throws(() => startupClosure(noRoots), /requires exactly one app shell, routes chunk, and Lagos rules\/content chunk/)

  const broken = fixture().bundle
  broken.shared = chunk('assets/shared-00000001.js', 'import "./missing-00000003.js"; export const answer=42;')
  assert.throws(() => startupClosure(broken), /references missing output/)
})

test('requires a Rollup module graph record for every emitted startup module', () => {
  const { bundle, moduleGraph } = fixture()
  delete moduleGraph[`${repoRoot}/src/app/shared.ts`]
  assert.throws(() => createLivingWorldStartupReport(bundle, identity, moduleGraph, repoRoot), /Missing Rollup module graph record/)
})

test('rejects oversized reports and invalid source identities', () => {
  const { bundle, moduleGraph } = fixture()
  const entry = bundle.app
  if (!entry || entry.type !== 'chunk') throw new Error('Fixture app chunk missing.')
  const modules: Record<string, StartupChunk['modules'][string]> = {}
  const graph: Record<string, ModuleGraphInfo> = { ...moduleGraph }
  for (let index = 0; index < 1_500; index += 1) {
    const id = `src/${index}-${'x'.repeat(800)}.ts`
    modules[id] = { renderedLength: 1, originalLength: 1, renderedExports: [], removedExports: [] }
    graph[id] = { importedIds: [], dynamicallyImportedIds: [], moduleSideEffects: false }
  }
  bundle.app = chunk('assets/app-12345678.js', entry.code, { ...entry, modules })
  assert.throws(() => createLivingWorldStartupReport(bundle, identity, graph, repoRoot), new RegExp(`${MAX_REPORT_BYTES}-byte output cap`))
  assert.throws(() => createLivingWorldStartupReport(fixture().bundle, { ...identity, sourceSha: 'dirty' }, {}, repoRoot), /Invalid source identity/)
})

function smallReport() {
  const { bundle, moduleGraph } = fixture()
  return createLivingWorldStartupReport(bundle, identity, moduleGraph, repoRoot)
}

test('bounded writer writes only the fixed regular-file path under canonical .tmp', t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'living-world-report-')))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const path = writeBoundedStartupReport(root, smallReport())
  assert.equal(path, join(root, '.tmp', 'living-world-startup-report.json'))
  assert.equal(lstatSync(path).isFile(), true)
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).sourceSha, identity.sourceSha)
})

test('writer refuses a symlinked .tmp parent without touching its sentinel', t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'living-world-report-parent-')))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const outside = join(root, 'outside')
  mkdirSync(outside)
  const sentinel = join(outside, 'sentinel.txt')
  writeFileSync(sentinel, 'preserve-parent-target')
  symlinkSync(outside, join(root, '.tmp'), 'dir')
  assert.throws(() => writeBoundedStartupReport(root, smallReport()), /\.tmp directory must be a real directory/)
  assert.equal(readFileSync(sentinel, 'utf8'), 'preserve-parent-target')
  assert.equal(lstatSync(join(root, '.tmp')).isSymbolicLink(), true)
})

test('writer refuses symlink, hardlink, and directory targets before altering sentinels', t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'living-world-report-target-')))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const temp = join(root, '.tmp')
  mkdirSync(temp)
  const sentinel = join(root, 'sentinel.txt')
  writeFileSync(sentinel, 'preserve-target')
  const target = join(temp, 'living-world-startup-report.json')
  symlinkSync(sentinel, target)
  assert.throws(() => writeBoundedStartupReport(root, smallReport()), /Report target must be a non-symlink regular file/)
  assert.equal(readFileSync(sentinel, 'utf8'), 'preserve-target')
  assert.equal(lstatSync(target).isSymbolicLink(), true)
  rmSync(target)

  linkSync(sentinel, target)
  assert.throws(() => writeBoundedStartupReport(root, smallReport()), /one link/)
  assert.equal(readFileSync(sentinel, 'utf8'), 'preserve-target')
  rmSync(target)

  mkdirSync(target)
  assert.throws(() => writeBoundedStartupReport(root, smallReport()), /Report target must be a non-symlink regular file/)
  assert.equal(lstatSync(target).isDirectory(), true)
})

test('writer enforces the byte cap before creating the report directory', t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'living-world-report-cap-')))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const oversize = { ...smallReport(), startupFiles: ['x'.repeat(MAX_REPORT_BYTES + 1)] }
  assert.throws(() => writeBoundedStartupReport(root, oversize), /output cap/)
  assert.throws(() => lstatSync(join(root, '.tmp')))
})
