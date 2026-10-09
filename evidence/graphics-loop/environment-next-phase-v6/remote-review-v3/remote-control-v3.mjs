import { createReadStream, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { persistCaptureProgress, validateCaptureSnapshot } from './scope-plan-v3.mjs'

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

/** Poll structured fixture state; UI text is intentionally not part of transition completion. */
export async function waitForSceneSnapshot(readSnapshot, expected, { timeoutMs = 12000, pollMs = 100, now = () => Date.now(), pause = sleep } = {}) {
  const deadline = now() + timeoutMs
  let latest = null
  while (now() < deadline) {
    latest = await readSnapshot()
    if (latest?.fixture?.place === expected.place && latest?.fixture?.time === expected.time && latest?.host?.location === expected.place) {
      return Object.freeze({ settled: true, snapshot: latest, elapsedMs: timeoutMs - Math.max(0, deadline - now()) })
    }
    await pause(pollMs)
  }
  return Object.freeze({ settled: false, snapshot: latest, elapsedMs: timeoutMs })
}

/** Wait for this request's own structured receipt; later transitions cannot satisfy it. */
export async function waitForReadinessReceipt(readSnapshot, clickWait, { afterId = 0, timeoutMs = 16000, pollMs = 100, now = () => Date.now(), pause = sleep } = {}) {
  const started = now()
  const waitId = await clickWait()
  if (!Number.isInteger(waitId) || waitId <= afterId) throw new Error('Wait control did not return a fresh owned wait ID')
  const deadline = started + timeoutMs
  let latest = null
  while (now() < deadline) {
    latest = await readSnapshot()
    const receipt = latest?.controlState?.readinessWaitReceipts?.find(item => item.id === waitId)
    if (receipt && receipt.state !== 'running') return Object.freeze({ waitId, receipt, snapshot: latest, timedOut: false })
    await pause(pollMs)
  }
  return Object.freeze({ waitId, receipt: null, snapshot: latest, timedOut: true })
}

export async function sha256File(file) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

/** Caller writes the PNG first, then this creates the durable per-capture JSONL receipt. */
export async function persistCaptureReceipt(resultDir, { sequence, label, imageFile, snapshot, expected, wait }) {
  const target = path.resolve(resultDir, imageFile)
  const root = path.resolve(resultDir)
  const relative = path.relative(root, target)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Capture image path escaped the per-run directory')
  const image = { path: relative.split(path.sep).join('/'), bytes: statSync(target).size, sha256: await sha256File(target) }
  const validation = validateCaptureSnapshot(snapshot, expected)
  const record = Object.freeze({ sequence, label, capturedAt: snapshot?.capture?.capturedAt ?? new Date().toISOString(),
    image, expected, valid: validation.valid, invalidReasons: validation.reasons, readiness: snapshot?.readiness ?? null,
    wait: wait ? { waitId: wait.waitId, receipt: wait.receipt, timedOut: wait.timedOut } : null,
    fixture: snapshot?.fixture ?? null, host: snapshot?.host ?? null, controlState: snapshot?.controlState ?? null })
  persistCaptureProgress(resultDir, record)
  return record
}
