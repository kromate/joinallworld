# Native wrist-orientation diagnostic

This isolated helper maps a source clip's measured wrist rotation after the native positional IK
has placed the hand bone. The source sampler currently returns joint positions only, and the native
solver aims the forearm-to-hand segment without applying clip-driven wrist articulation. Because
props are parented under the native hand alias, omitting a real wrist delta is a plausible cause of
rigid or incorrectly oriented props; it is not established until the pinned asset check reports
the source deltas.

`native-wrist-orientation-check.mjs` loads the pinned compressed authored body and shipped clip
pack, corrects the family rig, samples actual `idle`, `cook`, `eat`, and `drink` clips, solves native
hand positions, then applies the standalone mapped wrist quaternion. It checks both sides and both
families, verifies that wrist origins stay fixed, and exercises a translated/rotated actor parent.
The helper expects source and target quaternions relative to their actor roots; it does not use
guessed Euler angles. The wrist delta is represented in the source forearm-parent frame and
conjugated into the target forearm rest frame.

Run from the repository root with the project's Node TypeScript stripping enabled:

```sh
node --experimental-strip-types evidence/graphics-loop/authored-complete-body-v1/native-wrist-orientation/native-wrist-orientation-check.mjs
```

The result JSON reports the source wrist-delta angles. A small or absent delta means this mapping
does not explain prop orientation in those clips. A meaningful delta demonstrates omitted source
data, but does not establish attractive prop contact, finger grip, or rendered quality. The helper
is not wired into production, and no pixel or integration acceptance is claimed.
