# Office patch exact-pixel attribution V3

V3 fixes two schema defects in the V2 diagnostic: it treats a missing raw face index as null, and the runner consumes the actual `inspectPagePixel` fields (`rawBodyFaceIndex`, `bodyHit`, `garmentHit`, `garmentBehindBodyMetres`). The probe remains a single female-office idle/front ray; it does not install a mask or prove a visual repair.

Run `workflow-office-pixel-attribution-v3.yml` on `codex/graphics-office-pixel-attribution-v3`. This source packet is prepared and awaiting remote verification.
