# A2 source checkpoint

A2 source changes are in the isolated checkout `/workspace/remote-verification/repositories/worker-household-identity`, branch `codex/cloud-household-consent-a2-20261010`, based on e52 `e52cae83fcbc31348f8b7160790ff37c9c22855c`. A1 source work has since begun in the same assigned checkout; therefore this is a frozen historical A2 checkpoint, not a test result for the current combined worktree.

The A2 change limits `server/households/durableStorage.ts` root classification to own descriptors: missing own root is absent without a property get; own accessor, non-enumerable, and own undefined root are invalid. Creating an absent root avoids inherited getters/setters by inspecting descriptors and installs an own root. `durableApply.ts` uses this classification. The tests cover inherited getter hit count zero and no-invocation rejection for malformed roots; direct point reads of existing Home rows run through the actual Node Store and the production Worker SQLite adapter over Node's SQLite test storage.

Focused command ran under the shared `agent-slot` heavy lease with `NODE_OPTIONS=--max-old-space-size=1536`:

`node --experimental-strip-types --test --test-concurrency=1 server/households/durable.test.ts`

Result: 7 passed, 0 failed. Raw terminal log: `a2-focused-terminal.log`, SHA-256 `6e8716a1f47064a784d2a320a8db258d40ade1e5a0933c06bd3ef781b6e673b6`.

Exact tested source pins:

| Path | SHA-256 |
| --- | --- |
| `server/households/durableStorage.ts` | `fa0bc5942e7d49187176472333118c63bfff73f6508189b456c649c85f126447` |
| `server/households/durableApply.ts` | `c33f25f9c361916b475c62f7be7493f0a95c00f85579a02d218284658b64c5ba` |
| `server/households/durable.test.ts` | `b7a332f702919a16172acec8fa14d46076b83708305c84502e225176a2c25e1a` |
| `server/households/durableService.ts` at test time (unchanged e52) | `ce2eed20b0ecfdf4b0f7a455e6227a0988e138046d2e4357683b068bd35da9fa` |
| `server/keyed.ts` | `fcb0980c057d9e658c64e5e69512c2b60cb7eb39365a9c9d5475872b9e92af68` |
| `server/routes/once.ts` | `6072fa044253a38d35b948a33163ea0a2e787ef197bcce3d3760393be94b7046` |

These tests prove Node file-store transactions and the production SQLite adapter exercised on Node SQLite. They do not prove actual Cloudflare Worker/Durable Object HTTP behavior. The larger transaction costs remain as previously scoped: Node rewrites a full JSON document; Worker adapter tests here use Node's SQLite runtime; once quota recount retains its existing global scan/aggregate behavior.
