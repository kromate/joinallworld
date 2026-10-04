/**
 * OWNER: world
 * In-city map: venue hotspots for the current city, drawn behind the Map panel
 * (src/ui/panels/map.js). Not wired in yet — the schematic world map (src/world-map.js) is
 * still what shows in Map mode.
 *
 * Contract when you build it (src/life-main.js will call exactly this):
 *   createCityMap(container, { onSelectVenue(venueId) }) → { setCity(cityId), setState(state), resize(), destroy() }
 * Call onSelectVenue when a hotspot is tapped; the host then opens the Map panel with that
 * destination. Static rendering only: draw when something changes — no requestAnimationFrame
 * loop, no intervals (src/venue-world.test.js scans this file).
 */
export function createCityMap(container, { onSelectVenue = () => {} } = {}) {
  return { setCity() {}, setState() {}, resize() {}, destroy() {}, ready: false };
}
