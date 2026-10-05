/**
 * Whether this build PLAYS lives (applies actions, settles time, runs event listeners) or only READS them (createLife, viewLife).
 * The servers, the Worker, the scripts and the tests play: PLAYS is true. The browser only shows lives the server has played
 * (client.ts rebuilds each answer and derives its views; nothing there applies a rule), so the browser build replaces this module
 * with `export const PLAYS = false` (vite.config.ts) and the bundler leaves the code that only playing needs out of the page.
 * Nothing about how a life is rebuilt or viewed depends on it.
 */
export const PLAYS: boolean = true;

/** Stands for the code a reading build leaves out. Typed as `never`, so a system keeps the type it has with the code in it. */
export const LEFT_OUT = {} as never;
