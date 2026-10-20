// Small planar-geometry helpers (equirectangular local metres).
export type LL = { lat: number; lon: number }
export type XY = [number, number]

const R = 6371008.8
const RAD = Math.PI / 180

export function toLocal(ring: LL[], lat0: number, lon0: number): XY[] {
  const k = Math.cos(lat0 * RAD)
  return ring.map((p) => [(p.lon - lon0) * RAD * R * k, (p.lat - lat0) * RAD * R] as XY)
}

export function pointToLocal(lat: number, lon: number, lat0: number, lon0: number): XY {
  return [(lon - lon0) * RAD * R * Math.cos(lat0 * RAD), (lat - lat0) * RAD * R]
}

/** Signed area (positive when CCW). */
export function signedArea(p: XY[]): number {
  let a = 0
  for (let i = 0, n = p.length; i < n; i++) {
    const [x1, y1] = p[i]!
    const [x2, y2] = p[(i + 1) % n]!
    a += x1 * y2 - x2 * y1
  }
  return a / 2
}

export function centroid(p: XY[]): XY {
  let a = 0
  let cx = 0
  let cy = 0
  for (let i = 0, n = p.length; i < n; i++) {
    const [x1, y1] = p[i]!
    const [x2, y2] = p[(i + 1) % n]!
    const c = x1 * y2 - x2 * y1
    a += c
    cx += (x1 + x2) * c
    cy += (y1 + y2) * c
  }
  if (Math.abs(a) < 1e-9) {
    let sx = 0
    let sy = 0
    for (const [x, y] of p) {
      sx += x
      sy += y
    }
    return [sx / p.length, sy / p.length]
  }
  return [cx / (3 * a), cy / (3 * a)]
}

export function pointInPoly(x: number, y: number, p: XY[]): boolean {
  let inside = false
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i]!
    const [xj, yj] = p[j]!
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const l2 = dx * dx + dy * dy
  let t = l2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / l2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/** 0 when inside, else distance to the boundary. */
export function distToPoly(x: number, y: number, p: XY[]): number {
  if (pointInPoly(x, y, p)) return 0
  let d = Infinity
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    d = Math.min(d, segDist(x, y, p[j]![0], p[j]![1], p[i]![0], p[i]![1]))
  }
  return d
}

function perpDist(p: XY, a: XY, b: XY): number {
  return segDist(p[0], p[1], a[0], a[1], b[0], b[1])
}

function dpOpen(pts: XY[], eps: number): XY[] {
  if (pts.length < 3) return pts
  const keep = new Uint8Array(pts.length)
  keep[0] = keep[pts.length - 1] = 1
  const stack: [number, number][] = [[0, pts.length - 1]]
  while (stack.length) {
    const [s, e] = stack.pop()!
    let md = 0
    let mi = -1
    for (let i = s + 1; i < e; i++) {
      const d = perpDist(pts[i]!, pts[s]!, pts[e]!)
      if (d > md) {
        md = d
        mi = i
      }
    }
    if (mi >= 0 && md > eps) {
      keep[mi] = 1
      stack.push([s, mi], [mi, e])
    }
  }
  return pts.filter((_, i) => keep[i])
}

/** Simplify a closed ring (no repeated closing point) to at most `max` vertices. */
export function simplifyRing(ring: XY[], max = 64): XY[] {
  if (ring.length <= 3) return ring
  // split at the two farthest-apart anchor points so both halves are open polylines
  let i0 = 0
  for (let i = 1; i < ring.length; i++) if (ring[i]![0] < ring[i0]![0]) i0 = i
  let i1 = 0
  let best = -1
  for (let i = 0; i < ring.length; i++) {
    const d = Math.hypot(ring[i]![0] - ring[i0]![0], ring[i]![1] - ring[i0]![1])
    if (d > best) {
      best = d
      i1 = i
    }
  }
  const rot = [...ring.slice(i0), ...ring.slice(0, i0)]
  const k = (i1 - i0 + ring.length) % ring.length
  const half1 = rot.slice(0, k + 1)
  const half2 = [...rot.slice(k), rot[0]]
  let eps = 0.25
  for (let iter = 0; iter < 30; iter++) {
    const a = dpOpen(half1, eps)
    const b = dpOpen(half2 as XY[], eps)
    const out = [...a.slice(0, -1), ...b.slice(0, -1)]
    if (out.length <= max || iter === 29) return out.length >= 3 ? out : ring.slice(0, 3)
    eps *= 1.5
  }
  return ring
}

export function convexHull(pts: XY[]): XY[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (p.length < 3) return p
  const cross = (o: XY, a: XY, b: XY) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lo: XY[] = []
  for (const q of p) {
    while (lo.length >= 2 && cross(lo[lo.length - 2]!, lo[lo.length - 1]!, q) <= 0) lo.pop()
    lo.push(q)
  }
  const up: XY[] = []
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i]!
    while (up.length >= 2 && cross(up[up.length - 2]!, up[up.length - 1]!, q) <= 0) up.pop()
    up.push(q)
  }
  return [...lo.slice(0, -1), ...up.slice(0, -1)]
}

/** Minimum-area enclosing rectangle: long side, short side, bearing (deg 0..180, clockwise from north) of long axis. */
export function minAreaRect(pts: XY[]): { w: number; d: number; angle: number } {
  const h = convexHull(pts)
  if (h.length < 3) return { w: 0, d: 0, angle: 0 }
  let best = { area: Infinity, w: 0, d: 0, ang: 0 }
  for (let i = 0; i < h.length; i++) {
    const [ax, ay] = h[i]!
    const [bx, by] = h[(i + 1) % h.length]!
    const len = Math.hypot(bx - ax, by - ay)
    if (len < 1e-9) continue
    const ux = (bx - ax) / len
    const uy = (by - ay) / len
    let minU = Infinity
    let maxU = -Infinity
    let minV = Infinity
    let maxV = -Infinity
    for (const [x, y] of h) {
      const u = (x - ax) * ux + (y - ay) * uy
      const v = -(x - ax) * uy + (y - ay) * ux
      if (u < minU) minU = u
      if (u > maxU) maxU = u
      if (v < minV) minV = v
      if (v > maxV) maxV = v
    }
    const wu = maxU - minU
    const wv = maxV - minV
    const area = wu * wv
    if (area < best.area) {
      // direction of the long axis in (x east, y north)
      const longAlongU = wu >= wv
      const dx = longAlongU ? ux : -uy
      const dy = longAlongU ? uy : ux
      let bearing = (Math.atan2(dx, dy) * 180) / Math.PI // clockwise from north
      bearing = ((bearing % 180) + 180) % 180
      best = { area, w: Math.max(wu, wv), d: Math.min(wu, wv), ang: bearing }
    }
  }
  return { w: best.w, d: best.d, angle: best.ang }
}

/** Join way geometries (arrays of LL) into closed rings. */
export function assembleRings(ways: LL[][]): LL[][] {
  const same = (a: LL, b: LL) => a.lat === b.lat && a.lon === b.lon
  const rings: LL[][] = []
  const open = ways.filter((w) => w.length >= 2).map((w) => [...w])
  while (open.length) {
    let cur = open.pop()!
    let guard = 0
    while (!same(cur[0]!, cur[cur.length - 1]!) && guard++ < 10000) {
      const end = cur[cur.length - 1]!
      let found = -1
      let rev = false
      for (let i = 0; i < open.length; i++) {
        if (same(open[i]![0]!, end)) {
          found = i
          break
        }
        if (same(open[i]![open[i]!.length - 1]!, end)) {
          found = i
          rev = true
          break
        }
      }
      if (found < 0) break
      const nxt = open.splice(found, 1)[0]!
      if (rev) nxt.reverse()
      cur = cur.concat(nxt.slice(1))
    }
    if (cur.length >= 4 && same(cur[0]!, cur[cur.length - 1]!)) rings.push(cur)
  }
  return rings
}
