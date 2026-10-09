# Native rest-contact V7 (isolated candidate)

V7 is a new copy of the rejected V6 candidate. V6 and its remote receipt remain unchanged. No production files are modified.

This candidate contains two targeted corrections from the V6 actual run:

- The prop-rest transition result now maps the computed local `rootCorrection` into the public `rootWorldCorrection` field. V6 returned an undeclared identifier and threw for every tested woman prop-rest transition.
- A seated entry/exit frame uses a dedicated `transition` foot-contact mode. It selects the sole currently nearest its measured floor as the planted side, corrects that side in either vertical direction, and leaves the other foot at its animated height. The factory still checks every sole sample for more than 4 mm of penetration and requires at least one sole sample within 4 mm of the floor. Stable seated poses retain the two-foot grounded requirement. This is intended to respect the source clip's lifted swing foot rather than forcing both feet onto the floor at every transition frame.

Neither correction is accepted until the unchanged remote actual-GLB 15-pose, chair/stair, and render checks pass. In particular, this candidate has not demonstrated that the chosen planted foot remains reachable or that its correction preserves natural transition motion. It does not change contact tolerances, supported pose metadata, body masks, clothing, shoes, or assets.

## V7 verification status

Prepared for the same remote checks as V6. No V7 CPU, browser, build, or typecheck result is claimed yet. The V6 remote run `37993508775` failed with `rootWorldCorrection is not defined`; its chair transition had minimum sole gaps of 6.757 mm and 31.9 mm, which remain failures under the unchanged 4 mm threshold.
