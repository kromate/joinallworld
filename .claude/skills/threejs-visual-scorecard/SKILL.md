---
name: threejs-visual-scorecard
description: >
  Score a three.js game's screenshots against a ten-category visual scorecard with calibration images, and measure the pixels
  (colour entropy, dominant colour, edge density, contrast). Use when judging how a graphics change looks, before and after,
  when acting as the critic for a graphics phase, or when the owner asks whether a scene is "premium".
---

# Visual scorecard

> Written for three r186; this repo is on r180. Reference text from majidmanzarpour/threejs-game-skills (MIT, see LICENSE in this folder).

Allworld's version of the scorecard, with its own anchors and its own names for the categories, is [docs/EVIDENCE.md](../../../docs/EVIDENCE.md). Read that first; this folder keeps the original for reference.

- `visual-scorecard.md`: the original scorecard: categories, thresholds, automatic failures, measured evidence, reporting.
- `anchors/scene-1.jpg`, `scene-2.jpg`, `scene-3.jpg`: the original calibration pictures: a 1, a 2 and a 2.5 to 3 (a racing game, not ours). Look at them before scoring World, Hero, Materials or Lighting.
- `qa-release-reference.md`: the original QA and release skill, which describes the canvas inspector and the bot walk this repo reimplements.

## The inspector, in this repo

The original inspector needs Playwright. Allworld's does not: `scripts/evidence/inspect.ts` reads PNG files itself and uses the same method and thresholds (sample about 160 by 90 points; 4-bit colour buckets; a brightness step over 12 counts as an edge).

```sh
node --experimental-strip-types scripts/evidence/inspect.ts docs/evidence/out/*-scene.png     # exits 1 when a picture misses a threshold
node --experimental-strip-types scripts/evidence/inspect.ts --advisory docs/evidence/anchors   # print only
```

- Colour entropy under 3.0 bits, or a dominant colour above 0.6 of the points: sparse, flat. Evidence against World and Materials above 2.
- Edge density under 0.04: primitive-dominant or empty framing. Evidence against World and Hero above 2.
- Luminance contrast (95th minus 5th percentile) under 60: fog or darkness compression. Evidence against Lighting above 2.

These are advisory: a low number needs an explanation, not a higher score; never add noise or clutter to raise them. Measure the canvas alone (`<view>-scene.png`), not the whole page, because the HUD adds edges and colours that are not the world's.

A software-drawn run (a computer without a GPU, or `--gpu swiftshader`) is good for pictures and counts and useless for frame times.
