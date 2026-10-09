# Neck complement v5 candidate

This is an isolated candidate copied from v4; the production renderer and source geometry remain untouched. The v4 browser run failed on generated complement vertex 0 because the output skin weights were zero. Source GLBs use normalized integer skin-weight accessors, while v4 fed fractional barycentric values directly into the same integer typed-array constructor. JavaScript truncated each sub-unit weight to zero.

V5 stores the computed complement weights as float32, preserving the full barycentric weights used to calculate per-bone bind points. It rejects non-finite, negative, or non-unit weight rows, with focused tests for the previous integer-accessor failure. The existing strict posed source-corner equality guard is unchanged. This fixes a proven data-encoding defect only; geometry coverage, visual continuity, shader behavior, and actual GPU capture still require the frozen remote review.
