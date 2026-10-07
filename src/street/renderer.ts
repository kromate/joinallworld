import type { Kit } from '../scene/kit.ts'
import { createBatch, releaseObjects, sceneMaterials } from '../scene/build.ts'
import { createWalkGrid } from '../scene/walk-grid.ts'
import { globalPoint, localPoint, tileGroundAt, tileKey, tileOf, tileOrigin } from './frame.ts'
import type { MetrePoint, StreetDoor, StreetTile, TileCoord } from './types.ts'

const WALLS = ['#cfbc9c', '#dac9ae', '#bfaf99', '#d0bb91']
const ROOFS = ['#986649', '#7c6f60', '#8f7058', '#6b7976']
const seedOf = (id: string): number => { let seed = 2166136261; for (const char of id) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619); return seed >>> 0 }
/** Consecutive cells share one surface; every masked hole remains a hole. */
export function streetGroundRows(tile: StreetTile): { x: number; z: number; width: number }[] {
  const runs: { x: number; z: number; width: number }[] = []
  for (let row = 0; row < 64; row++) { let start = -1; for (let col = 0; col <= 64; col++) { const free = col < 64 && tileGroundAt(tile, { x: col * 2 + 1, z: row * 2 + 1 }); if (free && start < 0) start = col; if (!free && start >= 0) { runs.push({ x: start * 2, z: row * 2, width: (col - start) * 2 }); start = -1 } } }
  return runs
}

/** Tile-local batched scenery; rebasing moves groups only and never rebuilds their geometry. */
export function buildStreetTile(kit: Kit, tile: StreetTile) {
  const group = new kit.THREE.Group(), b = createBatch(kit.THREE)
  const ground = streetGroundRows(tile)
  for (const run of ground) b.quad(run.x + run.width / 2, 0, run.z + 1, run.width, 2, '#c5b899', { rx: -Math.PI / 2 })
  let roadDetails = 240, facadeDetails = 768
  for (const road of tile.roads) for (let i = 1; i < road.points.length; i++) {
    const a = road.points[i - 1]!, c = road.points[i]!, length = Math.hypot(c.x - a.x, c.z - a.z); if (length <= 0.01) continue
    const yaw = Math.atan2(c.x - a.x, c.z - a.z)
    b.at((a.x + c.x) / 2, 0.015, (a.z + c.z) / 2, yaw, batch => {
      batch.quad(0, 0, 0, road.width, length, road.source === 'generated' ? '#958878' : '#687577', { rx: -Math.PI / 2 })
      if (road.source === 'generated' || roadDetails < 4) return
      for (const side of [-1, 1]) batch.quad(side * (road.width / 2 - 0.2), 0.007, 0, 0.22, length, '#a6aeaa', { rx: -Math.PI / 2 })
      roadDetails -= 4
      const ux = (c.x - a.x) / length, uz = (c.z - a.z) / length, phase = ((a.x + tile.origin.x) * ux + (a.z + tile.origin.z) * uz) % 14
      for (let along = (14 - phase) % 14; along < length && roadDetails >= 2; along += 14) { const dash = Math.min(3, length - along); if (dash < 0.2) continue; batch.quad(0, 0.008, -length / 2 + along + dash / 2, 0.16, dash, '#bfc2b4', { rx: -Math.PI / 2 }); roadDetails -= 2 }
    })
  }
  // Generator footprints are convex clipped rectangles. Keep those exact outlines rather than
  // drawing bounding boxes that could cover a road while the authoritative mask permits it.
  const positions: number[] = [], colours: number[] = []
  for (const building of tile.buildings) {
    const points = [...building.footprint], area = points.reduce((sum, p, i) => { const q = points[(i + 1) % points.length]!; return sum + p.x * q.z - q.x * p.z }, 0)
    if (area < 0) points.reverse()
    const seed = seedOf(building.id), wall = WALLS[seed % WALLS.length]!, roof = ROOFS[(seed >>> 5) % ROOFS.length]!
    const tint = new kit.THREE.Color(building.source === 'generated-venue' ? '#ddd0b5' : wall)
    const vertex = (p: MetrePoint, y: number) => { positions.push(p.x, y, p.z); colours.push(tint.r, tint.g, tint.b) }
    const first = points[0]; if (!first) continue
    tint.set(roof)
    for (let i = 1; i + 1 < points.length; i++) { vertex(first, building.height); vertex(points[i + 1]!, building.height); vertex(points[i]!, building.height) }
    tint.set(building.source === 'generated-venue' ? '#ddd0b5' : wall)
    for (let i = 0; i < points.length; i++) { const a = points[i]!, c = points[(i + 1) % points.length]!; vertex(a, 0); vertex(c, building.height); vertex(c, 0); vertex(a, 0); vertex(a, building.height); vertex(c, building.height)
      const dx = c.x - a.x, dz = c.z - a.z, length = Math.hypot(dx, dz)
      if (length < 3 || facadeDetails < 6) continue
      const nx = dz / length, nz = -dx / length, yaw = Math.atan2(nx, nz), count = Math.min(2, Math.floor(length / 3)), floors = Math.min(2, Math.floor(building.height / 2.8))
      for (let floor = 0; floor < floors && facadeDetails >= 6; floor++) for (let window = 0; window < count && facadeDetails >= 6; window++) {
        const share = (window + 1) / (count + 1), x = a.x + dx * share + nx * 0.018, z = a.z + dz * share + nz * 0.018, y = 1.6 + floor * 2.8
        b.at(x, y, z, yaw, batch => { batch.quad(0, 0, 0, 1.1, 1.3, '#d8cbb1'); batch.quad(0, 0, 0.008, 0.86, 1.07, '#526665'); batch.quad(-0.43, 0, 0.015, 0.18, 1.07, roof) })
        facadeDetails -= 6
      }
    }
  }
  for (const door of tile.doors) {
    const yaw = Math.atan2(door.approach.x - door.at.x, door.approach.z - door.at.z)
    b.at(door.at.x, 0, door.at.z, yaw, batch => { batch.box(-0.82, 1.15, 0, 0.18, 2.3, 0.22, '#796852'); batch.box(0.82, 1.15, 0, 0.18, 2.3, 0.22, '#796852'); batch.box(0, 2.3, 0, 1.82, 0.2, 0.24, '#aa8b67') })
    b.disc(door.approach.x, 0.025, door.approach.z, 0.6, '#b5ad8d', { seg: 12 })
  }
  const built = b.build(sceneMaterials(kit))
  if (positions.length) { const geometry = new kit.THREE.BufferGeometry(); geometry.setAttribute('position', new kit.THREE.Float32BufferAttribute(positions, 3)); geometry.setAttribute('color', new kit.THREE.Float32BufferAttribute(colours, 3)); geometry.computeVertexNormals(); built.meshes.push(new kit.THREE.Mesh(geometry, sceneMaterials(kit).solid)); built.triangles += positions.length / 9 }
  if (built.meshes.length) group.add(...built.meshes)
  if (built.triangles > 25000) { releaseObjects(built.meshes); throw Error('Street tile geometry exceeds triangle limit') }
  let disposed = false
  return { group, groundQuads: ground.length, decorationTriangles: 1008 - roadDetails - facadeDetails, triangles: built.triangles, drawCalls: built.meshes.length, dispose() { if (disposed) return; disposed = true; releaseObjects(built.meshes); group.clear() } }
}
export function createStreetRenderer(kit: Kit) {
  const group = new kit.THREE.Group(), views = new Map<string, { tile: StreetTile; view: ReturnType<typeof buildStreetTile> }>()
  let origin: MetrePoint = { x: 0, z: 0 }, closed = false
  return {
    group,
    add(tile: StreetTile) { if (closed || views.has(tileKey(tile.tile))) return; if (views.size >= 9) throw Error('Street resident tile limit exceeded'); const view = buildStreetTile(kit, tile); view.group.position.set(tile.origin.x - origin.x, 0, tile.origin.z - origin.z); views.set(tileKey(tile.tile), { tile, view }); group.add(view.group) },
    remove(tile: StreetTile) { const entry = views.get(tileKey(tile.tile)); if (!entry) return; group.remove(entry.view.group); entry.view.dispose(); views.delete(tileKey(tile.tile)) },
    rebase(tile: TileCoord) { origin = tileOrigin(tile); for (const { tile: data, view } of views.values()) view.group.position.set(data.origin.x - origin.x, 0, data.origin.z - origin.z) },
    local(point: MetrePoint): MetrePoint { return { x: point.x - origin.x, z: point.z - origin.z } },
    global(point: MetrePoint): MetrePoint { return { x: point.x + origin.x, z: point.z + origin.z } },
    doors(): StreetDoor[] { return [...views.values()].flatMap(({ tile }) => tile.doors.map(door => ({ ...door, at: globalPoint(door.at, tile.tile), approach: globalPoint(door.approach, tile.tile) }))) },
    grid(centre: TileCoord) {
      const start = tileOrigin({ x: centre.x - 1, z: centre.z - 1 }), grid = createWalkGrid({ bounds: [start.x, start.z, start.x + 384, start.z + 384], cell: 2, radius: 0 })
      grid.cells.fill(1)
      for (let r = 0; r < grid.rows; r++) for (let c = 0; c < grid.cols; c++) { const point = { x: start.x + c * 2 + 1, z: start.z + r * 2 + 1 }, coord = tileOf(point), entry = views.get(tileKey(coord)); if (entry && tileGroundAt(entry.tile, localPoint(point, coord))) grid.cells[r * grid.cols + c] = 0 }
      return grid
    },
    diagnostics() { return { resident: views.size, triangles: [...views.values()].reduce((n, e) => n + e.view.triangles, 0), drawCalls: [...views.values()].reduce((n, e) => n + e.view.drawCalls, 0), origin: { ...origin }, disposed: closed } },
    dispose() { closed = true; for (const entry of views.values()) entry.view.dispose(); views.clear(); group.clear() },
  }
}
