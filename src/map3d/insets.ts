/**
 * Which part of the screen a map panel covers, for keeping the camera's picture out of it.
 *
 * On a wide screen the place list and a place's card sit in a column at the left edge: the map is centred in the room that
 * is left to their right. A trip bar is a strip along the bottom, in the middle: it takes room from the bottom, not from
 * the left. A phone's panel is a sheet at the bottom whenever it is not most of the screen.
 */
export interface Box { left: number; right: number; top: number; width: number; height: number }

export type Dock = { side: 'left'; amount: number } | { side: 'bottom'; amount: number } | null

/** The edge a panel is docked to and how much room it takes, in pixels of the map's own box (`page`). */
export function dockOf(panel: Box, page: Box & { bottom: number }, wide: boolean): Dock {
  if (wide && panel.left - page.left < page.width * 0.25 && panel.width < page.width * 0.5) return { side: 'left', amount: panel.right - page.left + 12 };
  if (panel.height < page.height * 0.62) return { side: 'bottom', amount: page.bottom - panel.top + 10 };
  return null;
}
