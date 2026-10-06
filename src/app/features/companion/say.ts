// A line from the rest of the page for the companion to say: held until the companion's own app is up (it is fetched after the first frame), and
// announced to it as the window event 'jaw:companion-say' when it already is. Nothing here imports the companion.
export interface Say { id: string; text: string; actions?: { kind: 'open'; id: string; label: string }[] }
let held: Say | null = null
export function sayLine(line: Say): void {
  held = line
  try { globalThis.window?.dispatchEvent(new CustomEvent('jaw:companion-say', { detail: line })) } catch { /* nobody is listening yet: the companion takes it when it starts */ }
}
/** What was said before the companion could hear, once. */
export function takeLine(): Say | null { const line = held; held = null; return line }
/** The companion heard it live: nothing is left to hand over. */
export function heard(line: Say): void { if (held?.id === line.id) held = null }
