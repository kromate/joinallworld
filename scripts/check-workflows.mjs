// Validates the protected release workflow and its pins without a YAML dependency. The parser reads only
// the subset these workflows use (block maps and lists, plain and quoted scalars, short flow lists,
// "|" block scalars) and refuses anything else, so an exotic construct cannot hide from the rules.
// Reads repository files only. Prints one PASS or FAIL line per rule and exits non-zero on a failure.
// Run: node scripts/check-workflows.mjs
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

// ── A small YAML subset parser ──

const KEY = /^(?:"([^"]*)"|'([^']*)'|([A-Za-z0-9_./-]+)):(?: (.*))?$/
const ITEM = /^ *-(?: |$)/

/** @param {string} text @returns {any} Parsed YAML is validated by checkWorkflow. */
export function parseYaml(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  let at = 0
  /** @param {string} line */
  const indentOf = line => line.length - line.trimStart().length
  const skip = () => { while (at < lines.length && /^\s*(#.*)?$/.test(lineAt(at))) at++ }
  /** @param {string} message @returns {never} */
  const err = message => { throw new Error(`YAML line ${at + 1}: ${message}`) }
  /** @param {number} index @returns {string} */
  const lineAt = index => lines[index] ?? err('missing line')
  lines.forEach((line, i) => { if (/^ *\t/.test(line)) { at = i; err('tab indentation') } })

  /** @param {string} raw @returns {any} */
  function scalar(raw) {
    const s = raw.trim()
    let m
    if (s.startsWith('"')) { m = s.match(/^("(?:[^"\\]|\\.)*")\s*(?:#.*)?$/); if (!m) err('malformed double-quoted scalar'); return JSON.parse((m[1] ?? err('missing scalar'))) }
    if (s.startsWith("'")) { m = s.match(/^'((?:[^']|'')*)'\s*(?:#.*)?$/); if (!m) err('malformed single-quoted scalar'); return (m[1] ?? err('missing scalar')).replace(/''/g, "'") }
    const plain = s.replace(/\s+#.*$/, '')
    if (/^[&*!%@`]/.test(plain) || /^[|>]/.test(plain)) err('anchors, aliases, tags and folded scalars are not supported')
    if (plain.startsWith('{')) err('flow maps are not supported')
    if (plain.startsWith('[')) {
      if (!plain.endsWith(']')) err('multi-line flow lists are not supported')
      const inner = plain.slice(1, -1).trim()
      return inner === '' ? [] : inner.split(',').map(scalar)
    }
    if (plain === 'true') return true
    if (plain === 'false') return false
    if (plain === 'null' || plain === '~') return null
    if (/^-?\d+$/.test(plain)) return Number(plain)
    return plain
  }

  /** @param {number} parentIndent @param {string} header */
  function blockScalar(parentIndent, header) {
    if (header.startsWith('>')) err('folded scalars are not supported')
    /** @type {string[]} */
    const body = []
    while (at < lines.length && (lineAt(at).trim() === '' || indentOf(lineAt(at)) > parentIndent)) body.push(lineAt(at++))
    const first = body.find(line => line.trim() !== '')
    const strip = first === undefined ? 0 : indentOf(first)
    while (body.length && body.at(-1)?.trim() === '') body.pop()
    return body.map(line => line.slice(Math.min(strip, indentOf(line)))).join('\n') + (/^\|-/.test(header) ? '' : '\n')
  }

  /** @param {number} indent @returns {Record<string, any>} */
  function mapping(indent) {
    /** @type {Record<string, any>} */
    const out = {}
    for (;;) {
      skip()
      if (at >= lines.length) break
      const line = lineAt(at), here = indentOf(line)
      if (here < indent) break
      if (here > indent) err('unexpected indentation')
      if (ITEM.test(line)) err('a list at the same indent as its key is not supported')
      const match = line.slice(indent).match(KEY)
      if (!match) err('expected "key: value"')
      const key = match[1] ?? match[2] ?? match[3] ?? err('missing key')
      if (Object.hasOwn(out, key)) err(`duplicate key "${key}"`)
      const rest = (match[4] ?? '').trim()
      at++
      if (rest === '' || rest.startsWith('#')) {
        skip()
        out[key] = at < lines.length && indentOf(lineAt(at)) > indent ? block(indentOf(lineAt(at))) : null
      } else if (/^[|>][+-]?\s*(?:#.*)?$/.test(rest)) out[key] = blockScalar(indent, rest)
      else out[key] = scalar(rest)
    }
    return out
  }

  /** @param {number} indent @returns {any[]} */
  function sequence(indent) {
    const out = []
    for (;;) {
      skip()
      if (at >= lines.length || indentOf(lineAt(at)) < indent) break
      if (indentOf(lineAt(at)) > indent || !ITEM.test(lineAt(at))) err('expected a list item')
      const afterDash = lineAt(at).slice(indent + 1)
      const rest = afterDash.replace(/^ +/, ''), column = indent + 1 + (afterDash.length - rest.length)
      if (rest === '' || rest.startsWith('#')) { at++; skip(); out.push(at < lines.length && indentOf(lineAt(at)) > indent ? block(indentOf(lineAt(at))) : null) }
      else if (KEY.test(rest)) { lines[at] = ' '.repeat(column) + rest; out.push(mapping(column)) }
      else { at++; out.push(scalar(rest)) }
    }
    return out
  }

  /** @param {number} indent @returns {any} */
  function block(indent) {
    skip()
    if (at >= lines.length) return null
    if (indentOf(lineAt(at)) !== indent) err('unexpected indentation')
    return ITEM.test(lineAt(at)) ? sequence(indent) : mapping(indent)
  }

  skip()
  const document = at >= lines.length ? null : block(indentOf(lineAt(at)))
  skip()
  if (at < lines.length) err('unexpected content after the document')
  return document
}

// ── Workflow policy ──

/** @param {any} value */
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const TRIGGERS = ['pull_request', 'push', 'workflow_dispatch']
/** @type {Record<string, string[]>} */
const SECRETS_ALLOWED = { 'joinallworld-release.yml': ['CLOUDFLARE_API_TOKEN'] }
/** @type {Record<string, string>} */
const DEPLOY_COMMAND = { 'joinallworld-release.yml': 'node scripts/guard-joinallworld-package.mjs deploy "$RUNNER_TEMP/joinallworld-package" "$SOURCE_SHA" "$PUBLISH" "$PACKAGE_SHA" "$GITHUB_WORKSPACE/.github/wrangler/node_modules/wrangler/bin/wrangler.js"' }
const LOCAL_PATH = /\/(?:Users|home|private\/tmp|tmp)\//

/** Returns a list of problems. Empty means the workflow keeps every rule. */
/** @param {string} file @param {any} document */
export function checkWorkflow(file, document) {
  /** @type {string[]} */
  const bad = []
  /** @param {string} message */
  const say = message => bad.push(`${file}: ${message}`)
  if (!object(document) || typeof document.name !== 'string') { say('needs a name'); return bad }
  const triggers = object(document.on) ? Object.keys(document.on) : []
  if (!triggers.length) say('needs an "on" mapping')
  for (const trigger of triggers) if (!TRIGGERS.includes(trigger)) say(`trigger "${trigger}" is not allowed (pull_request_target and workflow_run run privileged code)`)
  /** @param {any} permissions */
  const permissionsOk = permissions => object(permissions) && Object.values(permissions).every(value => value === 'read' || value === 'none')
  if (!permissionsOk(document.permissions)) say('top-level permissions must be an explicit read-only mapping')
  if (!object(document.concurrency) || typeof document.concurrency.group !== 'string') say('needs a concurrency group')
  if (!object(document.jobs) || !Object.keys(document.jobs).length) { say('needs jobs'); return bad }
  const untrusted = triggers.includes('pull_request')
  for (const [id, job] of Object.entries(document.jobs)) {
    const at = `job "${id}"`
    if (!object(job)) { say(`${at} is not a mapping`); continue }
    if (!Number.isInteger(job['timeout-minutes']) || job['timeout-minutes'] < 1 || job['timeout-minutes'] > 60) say(`${at} needs timeout-minutes between 1 and 60`)
    if (typeof job['runs-on'] !== 'string' || !/^ubuntu-\d\d\.\d\d$/.test(job['runs-on'])) say(`${at} must run on a pinned ubuntu image`)
    if (job.permissions !== undefined && !permissionsOk(job.permissions)) say(`${at} permissions must be read-only`)
    if (job.uses !== undefined || job.secrets !== undefined) say(`${at} may not call a reusable workflow or pass secrets`)
    const steps = Array.isArray(job.steps) ? job.steps : []
    if (!steps.length) say(`${at} needs steps`)
    const deploys = job.environment !== undefined
    if (deploys) {
      if (untrusted) say(`${at} uses an environment in a workflow that runs on pull_request`)
      if (job.environment !== 'production') say(`${at} must use the protected "production" environment`)
      if (!job.needs) say(`${at} must depend on the package job`)
      if (typeof job.if !== 'string' || !job.if.includes("github.ref == 'refs/heads/main'")) say(`${at} must be limited to refs/heads/main`)
      if (document.concurrency?.['cancel-in-progress'] !== false) say('a deploying workflow must not cancel runs in progress')
    }
    const allowed = deploys ? SECRETS_ALLOWED[file] ?? [] : []
    steps.forEach((/** @type {any} */ step, /** @type {number} */ n) => {
      const where = `${at} step ${n + 1}`
      if (!object(step)) { say(`${where} is not a mapping`); return }
      const uses = step.uses
      if (uses !== undefined) {
        if (typeof uses !== 'string' || !/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/.test(uses)) say(`${where} must pin its action to a full commit SHA`)
        else if (uses.startsWith('actions/cache@')) say(`${where} may not restore a shared cache`)
        if (typeof uses === 'string' && uses.startsWith('actions/checkout@') && step.with?.['persist-credentials'] !== false) say(`${where} must set persist-credentials: false`)
        if (typeof uses === 'string' && uses.startsWith('actions/setup-node@')) {
          if (typeof step.with?.['node-version'] !== 'string' || !/^\d+\.\d+\.\d+$/.test(step.with['node-version'])) say(`${where} must pin an exact Node version`)
          if (step.with?.cache !== undefined) say(`${where} may not enable a package cache`)
        }
      }
      if (step.run !== undefined) {
        const run = String(step.run)
        if (run.includes('${{')) say(`${where} interpolates an expression into a shell script; pass it through env`)
        if (LOCAL_PATH.test(run)) say(`${where} names a local absolute path`)
        if (/\|\s*(?:ba)?sh\b/.test(run) || /\bnpx\b/.test(run) || /\bsudo\b/.test(run)) say(`${where} runs unpinned or privileged code`)
        for (const line of run.split('\n')) if (/\bnpm (?:ci|install|i)\b/.test(line) && !line.includes('--ignore-scripts')) say(`${where} installs without --ignore-scripts`)
      }
      const text = JSON.stringify({ ...step, env: undefined })
      if (/\bsecrets\b/.test(text)) say(`${where} may use secrets only in its env`)
      for (const [name, value] of Object.entries(step.env ?? {})) {
        if (/\bsecrets\b(?!\.[A-Z][A-Z0-9_]*\b)/.test(String(value))) say(`${where} env ${name} reads secrets as a whole`)
        for (const m of String(value).matchAll(/\bsecrets\.([A-Za-z0-9_]+)/g)) {
          if (!allowed.includes(m[1] ?? '')) say(`${where} reads secret ${m[1]} outside the reviewed deploy job`)
          else if (!DEPLOY_COMMAND[file] || (file === 'release.yml' ? !String(step.run ?? '').includes(DEPLOY_COMMAND[file]) : String(step.run ?? '').trim() !== DEPLOY_COMMAND[file])) say(`${where} gives secret ${m[1]} to a step that is not the guarded deploy`)
        }
      }
    })
  }
  return bad
}

/** Parse only exact, non-prerelease numeric Node versions. */
const NODE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

/** @param {unknown} value @returns {[number, number, number] | null} */
function parseNodeVersion(value) {
  if (typeof value !== 'string') return null
  const match = NODE_VERSION.exec(value)
  if (!match) return null
  const major = Number(match[1]), minor = Number(match[2]), patch = Number(match[3])
  return [major, minor, patch].every(Number.isSafeInteger) ? [major, minor, patch] : null
}

/** @param {unknown} enginesNode @param {unknown[]} pins @returns {string[]} */
export function nodePinProblems(enginesNode, pins) {
  const problems = []
  const minimumText = typeof enginesNode === 'string' && enginesNode.startsWith('>=')
    ? enginesNode.slice(2)
    : null
  const minimum = parseNodeVersion(minimumText)
  if (!minimum) {
    problems.push('package.json engines.node must use the supported >=X.Y.Z minimum syntax')
    return problems
  }
  if (!pins.length) problems.push('release workflow has no exact Node version pin')
  for (const [index, pin] of pins.entries()) {
    const version = parseNodeVersion(pin)
    if (!version) {
      problems.push(`release workflow Node pin ${index + 1} must be an exact X.Y.Z version`)
      continue
    }
    const belowMinimum = version[0] < minimum[0]
      || (version[0] === minimum[0] && version[1] < minimum[1])
      || (version[0] === minimum[0] && version[1] === minimum[1] && version[2] < minimum[2])
    if (belowMinimum) problems.push(`workflow Node ${pin} is below package.json minimum ${enginesNode}`)
  }
  return problems
}

// ── Release pins and private-path exclusion ──

/** @param {string} root */
export function checkRepository(root) {
  /** @param {string} path */
  const read = path => readFileSync(join(root, path), 'utf8')
  /** @type {{name: string, detail: string, problems: string[]}[]} */
  const results = []
  /** @param {string} name @param {string} detail @param {string[]} problems */
  const rule = (name, detail, problems) => results.push({ name, detail, problems })

  const dir = join(root, '.github/workflows')
  /** @type {string[]} */
  const files = existsSync(dir) ? readdirSync(dir).filter(file => file === 'joinallworld-release.yml') : []
  /** @type {Record<string, any>} */
  const parsed = {}
  const problems = []
  for (const required of ['joinallworld-release.yml']) if (!files.includes(required)) problems.push(`${required} is missing`)
  for (const file of files) {
    if (!/\.ya?ml$/.test(file)) { problems.push(`${file} is not a workflow`); continue }
    try { parsed[file] = parseYaml(read(`.github/workflows/${file}`)); problems.push(...checkWorkflow(file, parsed[file])) } catch (error) { problems.push(`${file}: ${error instanceof Error ? error.message : String(error)}`) }
    if (LOCAL_PATH.test(read(`.github/workflows/${file}`))) problems.push(`${file}: names a local absolute path`)
  }
  rule('workflows-keep-policy', `${files.length} workflows`, problems)

  const engines = JSON.parse(read('package.json')).engines?.node
  const nodes = [...new Set(Object.values(parsed['joinallworld-release.yml']?.jobs ?? {}).flatMap(job => (job.steps ?? []).flatMap((/** @type {any} */ step) => typeof step?.uses === 'string' && step.uses.startsWith('actions/setup-node@') ? [step.with?.['node-version']] : [])))]
  rule('node-pin-meets-engines', `${nodes.map(value => typeof value === 'string' ? value : '<invalid>').join(', ')} against ${typeof engines === 'string' ? engines : '<invalid>'}`, nodePinProblems(engines, nodes))

  const tool = JSON.parse(read('.github/wrangler/package.json')), lock = JSON.parse(read('.github/wrangler/package-lock.json'))
  const pins = []
  if (!/^\d+\.\d+\.\d+$/.test(tool.dependencies?.wrangler ?? '') || Object.keys(tool.dependencies).length !== 1 || tool.devDependencies) pins.push('the deploy tool must declare exactly one dependency at an exact version')
  if (lock.packages?.['']?.dependencies?.wrangler !== tool.dependencies?.wrangler || lock.packages?.['node_modules/wrangler']?.version !== tool.dependencies?.wrangler) pins.push('the lockfile does not match the declared tool version')
  const locked = Object.entries(lock.packages ?? {}).filter(([path]) => path !== '')
  for (const [path, entry] of locked) if (entry.link || !/^https:\/\/registry\.npmjs\.org\//.test(entry.resolved ?? '') || !/^sha512-/.test(entry.integrity ?? '')) pins.push(`${path} is not pinned to a registry tarball with an integrity hash`)
  rule('deploy-tool-pinned', `wrangler ${tool.dependencies?.wrangler}, ${locked.length} locked packages`, pins)

  return results
}

function cli() {
  const root = realpathSync(join(here, '..'))
  let failed = false
  for (const { name, detail, problems } of checkRepository(root)) {
    if (problems.length) { failed = true; console.log(`FAIL ${name}: ${detail}`); for (const problem of problems) console.log(`  - ${problem}`) } else console.log(`PASS ${name}: ${detail}`)
  }
  process.exitCode = failed ? 1 : 0
}
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) cli()
