# Bounded remote neck-domain review, v6

V6 retains v5's float32 output skin weights and strict exact-pose/domain checks. It fixes the v5 harness mismatch by requiring full independent domain details in the explicit pose-witness snapshots, while accepting the same validated compact domain summary in render-state screenshot calls. A focused Node test locks that contract. CPU/build/browser resource limits and all geometry/domain acceptance checks remain unchanged.
