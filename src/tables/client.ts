/**
 * OWNER: growth
 * The browser's side of the game tables: one socket to /socket for the `table-*` messages
 * (server/ws/tables.js), the latest state of the table on screen, and the calls a board makes.
 * It decides nothing: every button sends a message, and what is drawn is what the server sent.
 *
 * The socket is opened the first time the Tables app is used and re-opened, with a bounded
 * back-off, while a table is on screen. On every (re)connection the list and the table on screen
 * are asked for again, so a dropped connection picks the game up where the server has it: the
 * seat is kept on the server, not here. No timer repeats while nothing is happening.
 */
import type { PanelApi } from '../app/types/panel.ts';
import type { TableGameId, TableOptionValue, TableRating, TableServerFrame, TableStateFrame, TableSummary, TablesClaimResult } from '../types/growth.ts';

/** A refusal frame: only `code` and `reason` are read here, the socket also carries other modules' errors. */
interface ErrorFrame { type: 'error'; code?: string; reason?: string }
/** The Worker host's liveness probe (deploy/): the answer is a 'heartbeat-ack'. */
interface HeartbeatFrame { type: 'heartbeat' }
type ServerMessage = TableServerFrame | ErrorFrame | HeartbeatFrame;
type Claimed = Extract<TablesClaimResult, { ok: true }>['results'][number];

/** The state of the Tables app (one shared object, read by the panel). */
interface TablesStore {
  api: PanelApi | null;
  socket: 'idle' | 'connecting' | 'open' | 'closed';
  list: TableSummary[] | null;
  listAt: number;
  tableId: string | null;
  state: TableStateFrame | null;
  error: string | null;
  pending: boolean;
  claimed: Claimed | null;
  ratings: Partial<Record<TableGameId, TableRating>> | null;
}

export const T: TablesStore = {
  api: null, socket: 'idle',
  /** table summaries by venue (null = all in the city) */
  list: null, listAt: 0,
  /** the table on screen: its id and the last table-state the server sent */
  tableId: null, state: null,
  error: null, pending: false,
  /** what the last finished game earned, from POST /api/growth/tables/claim */
  claimed: null, ratings: null,
};
let ws: WebSocket | null = null, attempts = 0, timer: ReturnType<typeof setTimeout> | null = null, sent = 0;
const MAX_ATTEMPTS = 6;
const refresh = () => T.api?.refresh();
/** The panel's API: the app is started (T.api set) before anything here runs. */
const panelApi = (): PanelApi => { if (!T.api) throw new TypeError('The Tables app has not started'); return T.api; };
const cityId = () => panelApi().view().cityId;
const track = (name: string, props: Record<string, unknown> = {}): void => { try { window.dispatchEvent(new CustomEvent('jaw:track', { detail: { name, props } })); } catch { /* no listener is fine */ } };

function send(type: string, body: Record<string, unknown> = {}): boolean {
  if (ws?.readyState !== 1) return false;
  ws.send(JSON.stringify({ type, cityId: cityId(), ...(T.tableId ? { table: T.tableId } : {}), ...body }));
  sent += 1;
  return true;
}

async function claim(): Promise<void> {
  try {
    const result = await panelApi().fetchJson<TablesClaimResult>('/api/growth/tables/claim', { method: 'POST', body: { cityId: cityId() } });
    if (!result.ok) return;
    T.ratings = result.ratings;
    if (result.results.length) {
      T.claimed = result.results.at(-1) ?? null;
      // The life changed on the server (a win was paid, a mission moved): read it again.
      await panelApi().command('missions.refresh');
      if (T.claimed?.code === 'paid') panelApi().toast(panelApi().state().message || 'You won.', 'earn');
    }
    refresh();
  } catch { /* the result stays owed on the server and is collected at the next visit */ }
}

function onMessage(message: ServerMessage): void {
  // The Worker host cannot ping a hibernating socket: it asks, and the answer proves this connection is alive.
  if (message.type === 'heartbeat') { if (ws?.readyState === 1) ws.send(JSON.stringify({ type: 'heartbeat-ack' })); return; }
  if (message.type === 'tables') { T.list = message.tables; T.listAt = Date.now(); }
  else if (message.type === 'tables-changed') send('table-list', { venue: undefined, table: undefined });
  else if (message.type === 'table-state') {
    if (message.table.id !== T.tableId) return;
    const before = T.state;
    T.state = message; T.pending = false; T.error = null;
    if (before?.table.status !== 'playing' && message.table.status === 'playing' && message.you !== null) track('match_started', { game: message.table.game, vs: message.table.seats.filter((seat) => !seat.bot).length > 1 ? 'player' : 'bot' });
    if (before?.table.status === 'playing' && message.table.status === 'over') {
      if (message.you !== null) track('match_finished', { game: message.table.game, result: message.result?.calledOff ? 'called_off' : message.result?.mine?.won ? 'won' : message.result?.mine?.draw ? 'draw' : 'lost' });
      if (message.result?.mine) void claim();
    }
  } else if (message.type === 'error') {
    T.pending = false;
    // Only refusals about tables are shown here; the socket also carries other modules' errors.
    if (/table|seat|game|move|turn|here|host|players|rate/.test(message.code ?? '')) { T.error = message.reason || 'That could not be done.'; T.api?.toast(T.error, 'error'); }
  } else return;
  refresh();
}

function connect(): void {
  if (ws || !T.api?.view().connected) return;
  T.socket = 'connecting';
  const socket = ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/socket`);
  socket.onopen = () => {
    attempts = 0; T.socket = 'open';
    send('table-list', { table: undefined });
    if (T.tableId) send('table-watch');
    void claim();
    refresh();
  };
  socket.onmessage = (event: MessageEvent<string>) => { try { onMessage(JSON.parse(event.data)); } catch { /* not ours */ } };
  socket.onclose = () => {
    if (ws === socket) ws = null;
    T.socket = 'closed'; T.pending = false;
    // Try again while a table is on screen; otherwise wait until the app is used again.
    if (T.tableId && attempts < MAX_ATTEMPTS && !timer) timer = setTimeout(() => { timer = null; attempts += 1; connect(); }, Math.min(8000, 500 * 2 ** attempts));
    refresh();
  };
  socket.onerror = () => {};
}

// The device session changed: the socket was opened with the previous identity's cookie, and the seat and results were theirs.
try {
  window.addEventListener('jaw:session', () => {
    if (timer) { clearTimeout(timer); timer = null; }
    const old = ws; ws = null; attempts = 0;
    Object.assign(T, { socket: 'idle', list: null, listAt: 0, tableId: null, state: null, error: null, pending: false, claimed: null, ratings: null });
    try { old?.close(); } catch { /* already closed */ }
  });
} catch { /* not a browser */ }

/** Called from the Tables app's bind(): idempotent. */
export function start(api: PanelApi): void {
  T.api = api;
  if (!api.view().connected || api.view().onboarding?.required) return;
  if (!ws && !timer) { attempts = 0; connect(); }
}
export function reconnect(): void { attempts = 0; if (timer) { clearTimeout(timer); timer = null; } connect(); }
export function refreshList(): void { send('table-list', { table: undefined }); }

/** Put a table on screen (watching it). */
export function openTable(id: string): void {
  if (T.tableId === id && T.state) return;
  T.tableId = id; T.state = null; T.error = null; T.claimed = null;
  if (!send('table-watch')) connect();
  refresh();
}
export function closeTable(): void {
  send('table-unwatch');
  T.tableId = null; T.state = null; T.error = null;
  send('table-list', { table: undefined });
  refresh();
}
const act = (type: string, body?: Record<string, unknown>): void => { if (send(type, body)) { T.pending = true; refresh(); } else { T.api?.toast('Not connected to the table. Reconnecting…', 'error'); reconnect(); } };
export const sit = (): void => { act('table-sit'); track('table_sat', { game: T.state?.table.game ?? 'unknown' }); };
export const leave = (): void => act('table-leave');
export const begin = (bots = 0): void => act('table-start', { bots });
export const again = (): void => act('table-again');
export const setOption = (name: string, value: TableOptionValue): void => act('table-options', { options: { [name]: value } });
/** Play a move. `n` is the number of moves made when the player chose: the server applies it once. */
export const play = (move: unknown): void => { if (T.state) act('table-move', { n: T.state.n, move }); };
export const messagesSent = (): number => sent;
