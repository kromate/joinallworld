# Critic brief: independent check of one model against its photo

You did not build this model. Your job is to find what is wrong with it. Do not edit anything.

For each place you are given:
1. Read `scripts/places/models/<city>/<venueId>.json`, especially `evidence`, `review` and `verified`.
2. Look with Read at the comparison image `scripts/places/out/cmp-<city>-<venueId>.png` (photo left, model right). If it is missing,
   look at the photo files named in `evidence` and at `scripts/places/out/<city>/<venueId>.png` and `.photo.png`.
   If `verified` is `text`, there is no photo; judge only whether the model is a plausible, specific building for this city and place
   (brief: `scripts/places/briefs/<city>.json`), and whether it looks like a copy of a generic template.
3. Judge it as a person who knows this place would. Would they recognise it? Compare in this order:
   - overall massing and proportions;
   - silhouette (towers, domes, roof forms);
   - wrong concepts (glass where the real building is open, square where it is round, missing big elements);
   - colours and materials;
   - signature details.
4. Return `match` (close|fair|rough) and up to 3 fixes, most important first. Each fix must be concrete enough to apply to the spec
   without looking again, for example: "minaret balconies must be round drums with 8 arched openings (use revolve with arcade);
   currently square boxes", or "stands must be open raked tiers under the ring beam (use stand); remove the glazed infill".
   Also say whether the evidence photo really shows this place (`evidenceOk`).
