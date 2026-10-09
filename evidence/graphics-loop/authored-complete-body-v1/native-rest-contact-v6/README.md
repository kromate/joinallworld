# Native rest-contact V6 (isolated candidate)

V6 is a new experimental copy; V4/V5 and their remote receipts remain unchanged. No production files are modified.

The earlier evidence identified three different problems. The stable `soak` pose sampled `soak-wash@0`, whose pelvis, trunk, and leg tracks are single-key while `soak-wash-enter` carries the 1.4-second sit-down. Because the source sampler restores bind nodes on every sample, the still pose cannot inherit the entry pose. V6 samples the terminal `soak-wash-enter` frame for stable soaking. A later candidate may layer the arm-only `soak-wash` motion over that pose; this version keeps the terminal entry frame intact so contact can be evaluated first.

For stable bed/tub poses, V6 derives a single whole-actor world-Y anchor from the measured posterior contact interval and leaves mapped bone translations unchanged. Lie poses whose pelvis and torso intervals conflict try a contact-derived thoracic rotation about the measured actor-right axis, searching the smallest 0.5-degree step up to 12 degrees; if both measured regions still cannot share a non-penetrating interval, the pose fails closed. Entry/exit anchors use smoothstep progress from the named clip time and solve the actual floor contacts after any anchor shift. This is not visual acceptance and the geometry remains subject to full pose/render review.

The foot-solver `limited` bit is not accepted by itself when its reason is a bounded per-pass cap: the final actual samples must independently show a sole contact within 4 mm for each side, no sample penetrating more than 4 mm, complete support under both sides, and reported residual no greater than 4 mm. Any other limited reason still fails.

The copied browser assertion now expects the actual fixture ID (`home-bed`, `home-mat`, `home-tub`, or `home-shower`). This corrects the prior ID-only test failure and does not weaken surface or contact checks.

V6 also changes seated transitions. It retains the measured seat-anchor source frame, then fits the current phase's actual shoe samples against the host floor. During entry/exit it requires at least one planted sample and rejects any penetration beyond 4 mm; stable sitting still requires both soles and the authored seat solver. Contact solver cap history remains in diagnostics, while the public `limited` result clears only when final sole samples and measured leg reach converge; missing support, nonfinite data, unresolved reach, or residuals above 4 mm remain failures.

Pending root-owned validation: strict TypeScript, actual male/female 15-pose/transition execution under existing limits, browser pixels and full-size prop contact review. No candidate is accepted until those results pass independently.
