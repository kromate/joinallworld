// What a player opens next is fetched when the browser has nothing else to do, so it is already there when they tap: the phone, the
// map, Jobs, Groceries, Buy mode and the Boutique. Nothing here draws or runs anything: each is an `import()` whose answer is dropped.
//
// It starts after the first screen has what it asked for (a device that opens on the landing waits for the landing's code and its
// 3D preview, so the preview is never competing with it), one chunk at a time, and not at all on a connection that asks to save data
// or is slower than 3G. A chunk that fails is skipped: the panel asks for it again, with its own retry, when it is opened.
type Loader = () => Promise<unknown>

const NEXT: Loader[] = [
  // The rules of the city's conditions (the grid, the go-slow; src/game/conditions/pack.ts): the Home, the Map and the Bank show what the server applies once they are in.
  () => import('../../game/conditions/pack.ts'),
  () => import('../features/phone/PhoneDevice.vue'),
  () => import('../features/travel/MapApp.vue'),
  () => import('../features/jobs/JobsApp.vue'),
  () => import('../features/home/GroceriesApp.vue'),
  () => import('../features/home/BuyMode.vue'),
  () => import('../features/life/BoutiqueApp.vue'),
]

interface Connection { saveData?: boolean; effectiveType?: string }
const connectionOf = (): Connection => (globalThis.navigator as Navigator & { connection?: Connection } | undefined)?.connection ?? {}

/** True on a connection where fetching what nobody asked for yet would cost the player something. */
export function holdsBack(connection: Connection = connectionOf()): boolean {
  return connection.saveData === true || connection.effectiveType === 'slow-2g' || connection.effectiveType === '2g'
}

type Idle = (run: () => void) => void
const whenIdle: Idle = (run) => {
  const request = (globalThis as { requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number }).requestIdleCallback
  if (request) request(run, { timeout: 4000 }); else globalThis.setTimeout(run, 1500)
}

/** Fetch the chunks, one per idle moment, after `ready` settles. Returns at once; never throws. */
export function preloadNext(ready: Promise<unknown>, loaders: Loader[] = NEXT, idle: Idle = whenIdle, hold: () => boolean = holdsBack): void {
  void ready.then(() => {
    if (hold()) return
    let index = 0
    const step = (): void => {
      const load = loaders[index++]
      if (!load) return
      void load().then(() => undefined, () => undefined).then(() => idle(step))
    }
    idle(step)
  }, () => undefined)
}
