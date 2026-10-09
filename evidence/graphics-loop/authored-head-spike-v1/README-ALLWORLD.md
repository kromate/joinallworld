# Authored face experiment

Pinned source: ibrews/VitruvianGodot bdecdcd537b4031fdd0fb299b7e4f93f084fffa0. The downloaded head and textures are CC0 character assets per the copied NOTICE.md. The upstream tool code is MIT; no Godot engine or shaders are shipped by this experiment.

The converter preserves real Happy, closed-lip smile, jaw, blink and brow morphs, with the same moving mouth interior. It removes extra attributes/morphs and embeds downsampled 1024px face / 512px mouth / 256px eye textures. Retained triangle count is measured, not yet reduced. The prototype keeps current game character on the left and renders the authored head on the right under matched camera/lighting. This is a facial asset experiment, not a full body family, game implementation or mobile acceptance.

Next work: actual pixel review, close-up/distant geometry levels, mapping to the existing skeleton, matching neck/body tone, male/female family shape, wardrobe, persistent identity and actual phone measurement. Do not merge this diagnostic branch wholesale or stall the existing consolidated release.
