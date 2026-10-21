"""Builder proxy that places everything built through it at `at` (x, y, z) rotated `rot` degrees (yaw about +Z, counter-clockwise
seen from above). Lets a part or the composer write geometry in a local frame (origin at the part, front = -Y) with the normal
`lib` helpers, and get it translated/rotated for free. Underscore file: not a parts module, never registered."""
import math


class Xform:
    def __init__(self, inner, at=(0.0, 0.0, 0.0), rot=0.0):
        self.inner = inner
        a = tuple(float(v) for v in at) + (0.0,) * (3 - len(at))
        self.at = a[:3]
        self.rot = float(rot)
        r = math.radians(self.rot)
        self.c, self.s = math.cos(r), math.sin(r)

    @staticmethod
    def make(b, at=(0.0, 0.0, 0.0), rot=0.0):
        """The proxy, or `b` itself when the placement is the identity."""
        at = tuple(at or (0.0, 0.0, 0.0))
        at = tuple(float(v) for v in at) + (0.0,) * (3 - len(at))
        if not rot and not any(at):
            return b
        return Xform(b, at, rot)

    def T(self, p):
        x, y, z = p[0], p[1], p[2]
        return (self.at[0] + self.c * x - self.s * y, self.at[1] + self.s * x + self.c * y, self.at[2] + z)

    def R(self, v):
        return (self.c * v[0] - self.s * v[1], self.s * v[0] + self.c * v[1], v[2])

    # the Builder surface that lib and the parts use
    def face(self, pts, slot='plain', col=None, **kw):
        return self.inner.face([self.T(p) for p in pts], slot, col, **kw)

    def facing(self, pts, hint, slot='plain', col=None, **kw):
        return self.inner.facing([self.T(p) for p in pts], self.R(hint), slot, col, **kw)

    def shared_grid(self, grid, slot, col, **kw):
        return self.inner.shared_grid([[self.T(p) for p in row] for row in grid], slot, col, **kw)

    def site(self):
        return self.inner.site()

    def section(self, label):
        return self.inner.section(label)

    @property
    def detail(self):
        return self.inner.detail

    @property
    def flat(self):
        return self.inner.flat

    def __getattr__(self, name):
        return getattr(self.inner, name)
