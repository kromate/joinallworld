// The preferences the Settings tab keeps on this device. Pure (storage is passed in), so it is
// tested without a browser. Nothing here is sent to the server.

/** Hints (the pointer to the next step) live under their own key, shared with the × on the coach line: '1' = off. */
export const HINTS_KEY = 'joinallworld-coach-off'

export type Reader = Pick<Storage, 'getItem'> | null | undefined

/** Are hints on? Anything but '1' under the hints key. */
export function hintsOn(storage: Reader): boolean {
  try { return storage?.getItem(HINTS_KEY) !== '1' } catch { return true }
}
