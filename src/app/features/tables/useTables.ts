// The Tables app's state and actions as a composable over src/tables/client.js.
//
// The client keeps one plain object, `T`, and calls `api.refresh()` after every change to it (a
// socket frame, a press). This module gives it a typed `api` built from the application and turns
// each refresh into one new shallow copy of `T`, which is what a component reads: no timer, no
// polling and no render loop that the client did not have. The socket and its back-off belong to
// the client and outlive the screen (as before); the listener this adds for a changed device
// session is removed when the screen goes.
//
//   const tables = useTables()
//   tables.t.value        the latest copy of T (list, tableId, state, pending, socket, claimed, ratings)
//   tables.openTable(id)  …and the other actions of the client: closeTable, sit, leave, begin, again, play, setOption, reconnect
//
// The rule "the list is asked for again when it is older than 20 seconds" is checked when the screen
// opens and whenever the client reports a change while the list is showing.
import { onBeforeUnmount, onMounted, shallowRef, watch } from 'vue'
import type { ShallowRef } from 'vue'
import { useApp } from '../../state/app.ts'
import type { App } from '../../state/app.ts'
import { LIST_STALE_MS, listIsStale } from './tablesModel.ts'
import {
  T, again, begin, closeTable, leave, openTable, play, reconnect, refreshList, setOption, sit, start,
} from './tablesBoundary.ts'
import type { TablesApi, TablesClientState } from './tablesBoundary.ts'

const snapshot: ShallowRef<Readonly<TablesClientState>> = shallowRef({ ...T })
/** Read `T` again. The client's refresh does this; a test that sets `T` by hand calls it. */
export function syncTables(): void { snapshot.value = { ...T } }

let api: TablesApi | null = null
/** The `api` of the legacy panel contract, over the application: only what client.js uses. */
function createApi({ game }: App): TablesApi {
  return {
    refresh: syncTables,
    view: () => game.view.value,
    toast: (text, kind) => game.toast(text, kind),
    fetchJson: game.fetchJson,
    command: (type) => game.command(type),
    state: () => game.state.value,
  }
}

/** Ask for the city's tables again when the list showing is stale. */
export function refreshStaleList(now: number = Date.now()): boolean {
  if (!listIsStale(T.tableId === null, T.listAt, T.list !== null, now)) return false
  refreshList()
  return true
}

export function useTables() {
  const app = useApp()
  api ??= createApi(app)
  const { game } = app

  /** Open the socket when the life is connected and past onboarding. Idempotent. */
  function connect(): void { if (api) start(api) }
  // A changed device session (the client has already reset T): start afresh, as the first screen does.
  const onSession = (): void => { syncTables(); connect() }
  // Connected (or past onboarding) after the screen opened: now the socket may open. Not a render loop: it fires on a change of the flag.
  watch(() => game.view.value.connected && game.view.value.onboarding?.required !== true, (ready) => { if (ready) connect() })
  // The client reported a change: the list on screen may be stale.
  watch(snapshot, () => { refreshStaleList() }, { flush: 'post' })
  onMounted(() => {
    window.addEventListener('jaw:session', onSession)
    connect()
    refreshStaleList()
  })
  onBeforeUnmount(() => window.removeEventListener('jaw:session', onSession))

  return {
    t: snapshot,
    connect,
    refreshStaleList,
    openTable, closeTable, sit, leave, begin, again, play, setOption, reconnect,
  }
}
export type Tables = ReturnType<typeof useTables>
export { LIST_STALE_MS }
