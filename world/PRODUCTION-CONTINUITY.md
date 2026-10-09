# Production continuity check

Run the retained continuity check with an exact 40-character source commit:

```sh
python3 scripts/world/check-production-continuity.py --source-sha 'EXACT_40_CHARACTER_SOURCE_COMMIT'
```

Replace the quoted placeholder with the exact source commit from the release handoff. The checker reads the existing private witness from `.cache/world-build/evidence` and compares the named public build with that commit. It verifies the retained synthetic actor, checks the original before-state, and replays only the original accepted same-spot action using its original action ID. The action must still be inside its 24-hour retry window with at least a 90-second margin. It does not create an actor or submit a new intent. A wrong build is rejected before any action replay.

This is a narrow continuity check. It does not upload or export saves, prove full provider/source identity, validate rollback compatibility, or verify browser bundles, reconnect behavior, or physical-phone behavior. It writes its latest result beside the private witness. The private witness and its credentials must remain private; tests use only synthetic temporary files and never call the production request path. The operator requires a macOS or Linux host with `fcntl` support.
