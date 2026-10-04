/**
 * CONNECTION WORDING — one table for every place that has to say why the game cannot change
 * anything right now. `view.link` (src/client.js) is one of:
 *   'online'       connected: nothing to say
 *   'connecting'   the first request is still on its way
 *   'new'          no life on this device yet: a nickname starts one
 *   'expired'      the server is up but no longer knows this browser's saved life
 *   'offline'      THIS DEVICE has no network — the only state that is called "offline"
 *   'unreachable'  the device is online but the game server did not answer
 * and `view.storage` ({ reason } | null) says the server is connected but cannot save.
 *
 * linkWords(link) → null when online, else
 *   { state, short, why, cannot(what), action: { label, menu?: 'reconnect', gate?: 'new' | 'expired' } }
 *     short     two or three words for a button, a chip or a pill ("No internet")
 *     why       one plain sentence saying what is true ("This device has no internet connection.")
 *     cannot()  a full line for a toast or a note: why + what it stops + what to do
 *     action    the one thing that resolves it. `menu` is a shell menu id (data-menu="reconnect");
 *               `gate` opens the session panel (data-open-gate="new" | "expired").
 * linkOf(view) reads the state from a view, treating an older host that sends no `link` as 'unreachable'.
 * linkAttrs(action) → the attribute the shell acts on for that action: 'data-menu="reconnect"' or
 *   'data-open-gate="new"' ('' when there is nothing to do but wait). linkButton(link, className) is the
 *   whole button, or '' — for a note that says why and offers the way out in one tap.
 * Pure data and strings: no DOM. The shell keeps its own pill/notice table next to this one.
 */
const WORDS = {
  connecting: { short: 'Connecting…', why: 'Still connecting to the game server.', next: 'Try again in a moment.', action: null },
  new: { short: 'Not started', why: 'You have not started a life yet.', next: 'Choose a nickname to start.', action: { label: 'Choose a nickname', gate: 'new' } },
  expired: { short: 'Saved life not found', why: 'The server no longer has the life this device remembers.', next: 'Start a new life, or try again.', action: { label: 'Start a new life', gate: 'expired' } },
  offline: { short: 'No internet', why: 'This device has no internet connection.', next: 'Reconnect, then try again.', action: { label: 'Try again', menu: 'reconnect' } },
  unreachable: { short: 'Server unreachable', why: 'The game server is not answering.', next: 'Your life is safe there. Try again shortly.', action: { label: 'Try again', menu: 'reconnect' } },
};

export const LINK_STATES = Object.freeze(['online', ...Object.keys(WORDS)]);

/** The connection state a view reports ('online' when connected). */
export function linkOf(view) {
  if (view?.connected) return 'online';
  return Object.hasOwn(WORDS, view?.link) ? view.link : 'unreachable';
}

/** The attribute of the control that runs a state's action (the shell handles both, anywhere in the UI). */
export const linkAttrs = (action) => (!action ? '' : action.menu ? `data-menu="${action.menu}"` : `data-open-gate="${action.gate}"`);
/** The one-tap way out of a connection state as a button, or '' when online or still connecting. Labels are our own text. */
export function linkButton(link, className = 'ui-button') {
  const action = linkWords(link)?.action;
  return action ? `<button type="button" class="${className}" ${linkAttrs(action)}>${action.label}</button>` : '';
}

/** Words for a connection state, or null when it is 'online'. Accepts a state name or a view. */
export function linkWords(link) {
  const state = typeof link === 'string' ? link : linkOf(link);
  if (state === 'online' || !Object.hasOwn(WORDS, state)) return null;
  const words = WORDS[state];
  return {
    state, short: words.short, why: words.why, action: words.action,
    /** "This device has no internet connection. You cannot <what> until … " — `what` is lower-case, e.g. 'travel'. */
    cannot: (what) => `${words.why} ${what ? `You cannot ${what} right now. ` : ''}${words.next}`,
  };
}
