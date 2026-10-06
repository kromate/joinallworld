// The one badge feed of the page, made the first time a screen shows a badge.
import { useApp } from '../../state/app.ts'
import { createBadgeFeed } from './badgeFeed.ts'
import type { BadgeFeed } from './badgeFeed.ts'

let feed: BadgeFeed | null = null
export function useBadges(): BadgeFeed {
  if (!feed) {
    const { game } = useApp()
    feed = createBadgeFeed({ fetchJson: (path, options) => game.fetchJson(path, options), connected: () => game.connected.value })
  }
  return feed
}
