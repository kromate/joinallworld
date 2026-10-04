// What the page does when it is hidden for good (pagehide) and when the browser brings it back from the
// back/forward cache (pageshow with event.persisted). pagehide ends the community socket and the poll; a page
// restored from the cache keeps its JavaScript state, so without this it would show a dead Community panel.
export interface PageLifecycleGame { stop(): void; refresh(): unknown; connected: { value: boolean } }
export interface PageLifecycleCommunity { destroy(): void; ensure(): Promise<void> }

export function createPageLifecycle(game: PageLifecycleGame, community: PageLifecycleCommunity) {
  return {
    onPageHide(): void { community.destroy(); game.stop() },
    /** Only a restored page needs this; a first load is started by connect(). Voice stays off: ensure() joins the room only. */
    onPageShow(event: { persisted?: boolean }): void {
      if (!event.persisted) return
      void Promise.resolve(game.refresh()).then(() => { if (game.connected.value) return community.ensure() })
    },
  }
}
