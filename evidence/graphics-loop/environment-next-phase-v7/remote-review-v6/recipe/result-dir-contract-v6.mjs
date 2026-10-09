import { lstatSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const EXPECTED = ['browser.log', 'supervisor-events.jsonl']

export function assertOwnedResultDirectory(directory, ownerToken) {
  if (typeof ownerToken !== 'string' || !/^[a-f0-9]{32}$/.test(ownerToken)) {
    throw new Error('Supervisor ownership token is missing or malformed')
  }
  const names = readdirSync(directory).sort()
  if (names.length !== EXPECTED.length || names.some((name, index) => name !== EXPECTED[index])) {
    throw new Error('Refusing to overwrite existing render evidence')
  }
  for (const name of EXPECTED) {
    const stat = lstatSync(path.join(directory, name))
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Result entry is not an owned regular file: ${name}`)
  }
  const contents = readFileSync(path.join(directory, 'supervisor-events.jsonl'), 'utf8')
  const firstLineEnd = contents.indexOf('\n')
  if (firstLineEnd < 0) throw new Error('Supervisor ownership marker is incomplete')
  const completeLines = contents.slice(0, contents.endsWith('\n') ? -1 : contents.lastIndexOf('\n')).split('\n')
  const records = completeLines.map(line => JSON.parse(line))
  const marker = records[0]
  if (marker.stage !== 'supervisor-initialized' || marker.ownerToken !== ownerToken || records.some(record => record.ownerToken !== ownerToken)) {
    throw new Error('Supervisor result file is not owned by this run')
  }
  return true
}
