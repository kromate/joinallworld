# Bounded remote neck-domain review, monitor-gate v2

This recipe preserves the v1 source/domain fixture and its original failed-run artifact. The v1 monitor could sample one zero-RSS row, sleep 25 ms, then observe a successful child exit at the top of the next loop and fail before honoring its configured 1.25 s zero-RSS grace. It remained fail-closed, but the build's 0.266 s lifetime made that path reproducible.

The v2 runner puts a small bootstrap and the exact build/test/browser command in one owned process group. The bootstrap announces readiness and blocks. The runner samples `/proc` until it sees positive RSS for the bootstrap itself, enforces the existing mode cap, then releases the gate. It separately requires a positive RSS witness whose `/proc/<pid>/exe` equals the actual Node executable. A command that exits before that witness, or a bootstrap that never produces a positive sample, remains a monitor failure. Peak RSS includes all live processes in that process group; there is no zero-witness exception.

The launch handshake test proves that the command does not run before release and that closing the gate fails without launching it. Fake `/proc` tests cover command names containing `)`, group membership, zombie/zero rows, bootstrap identity, actual-Node identity, and cap decisions. These tests do not replace the remote measurement.

Remote limits are unchanged: build and synthetic checks use a 96 MiB Node heap, 220 MiB process-group RSS, and 25 seconds; the headless browser diagnostic uses the existing 2 GiB and 60 second bounds. The workflow uploads every result, including failed receipts. The browser images and independent-domain report still require root/Sol review. Nothing in this diagnostic accepts the garment or changes runtime code.
