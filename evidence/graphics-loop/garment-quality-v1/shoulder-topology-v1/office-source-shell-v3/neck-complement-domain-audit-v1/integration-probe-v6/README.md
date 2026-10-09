# Neck complement v6 diagnostic

V6 preserves the tested v5 geometry and float32 skin-weight fix. The v5 remote run generated 516 complement vertices and passed all eight male pose witnesses (maximum position mismatch below 8e-8 m) before failing at its first screenshot. The remaining exception was a fixture contract mismatch: pose snapshots include the independent neck-domain detail, while ordinary render-state captures expose only its compact summary. V6 requires the full detail during pose-witness validation, and checks the compact summary during screenshot capture. It does not relax the domain result; full details must still match in pose probes.

A pure contract regression covers summary-only render states, required full pose detail, and inconsistent face counts. No v6 tests, build, GLB parse, or browser capture have run yet.
