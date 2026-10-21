// OWNER: scenes (unique places)
// After the first place model has been fetched: (1) make sure the service worker that keeps place files is registered (public/sw.js caches only
// /assets/places/*, cache-first, in Cache Storage 'allworld-places-v1'), and (2) ask the browser to keep this site's storage
// (navigator.storage.persist) so that cache is not evicted under storage pressure. Each happens at most once per page and is guarded: no service
// worker support, an insecure page, no storage manager, a refusal or an error is simply ignored. Nothing here prompts the player.
interface StorageLike { persisted?(): Promise<boolean>; persist?(): Promise<boolean> }
interface WorkerContainerLike { register(url: string, options?: { scope?: string }): Promise<unknown> }
interface NavigatorLike { storage?: StorageLike; serviceWorker?: WorkerContainerLike }
let asked = false;

export function rememberPlaces(nav: NavigatorLike | undefined = (globalThis as { navigator?: NavigatorLike }).navigator): void {
  if (asked || !nav) return;
  asked = true;
  const { storage, serviceWorker } = nav;
  if (serviceWorker && typeof serviceWorker.register === 'function') void Promise.resolve().then(() => serviceWorker.register('/sw.js', { scope: '/' })).catch(() => { /* the HTTP cache still holds the file */ });
  if (storage && typeof storage.persist === 'function') {
    void (async () => {
      try { if (typeof storage.persisted === 'function' && await storage.persisted()) return; await storage.persist!(); } catch { /* a refusal changes nothing */ }
    })();
  }
}
/** For tests. */
export function forgetPersistRequest(): void { asked = false; }
