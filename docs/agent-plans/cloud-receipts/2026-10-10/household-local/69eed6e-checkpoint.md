# Household consent TypeScript repair checkpoint

Local successor `69eed6eca2b4feea0a2b1523449a0ce94432beca` on `codex/cloud-household-consent-a1-tsfix-20261010`, parent `cfb384f243f7e097839a235f4b234adf2316996e`. Frozen cfb and its original failing compiler log and rejected push receipt are preserved. This successor adds only type-safe corrections in `durableService.ts` and `durable.test.ts`; the full source patch from cfb to this candidate is retained locally as `69eed6e-tsfix.patch`, SHA-256 `4b6c66809ea9cca828f2a941b6c549f4680ca67a412bc0af7fc4ff8306e2dd20`. It was not sent externally.

## Corrections

- Replay-probe calls use the actual `ctx.once` generic constraint `{ ok?: boolean }`; their returned values are still assigned to `unknown` and validated through the inert receipt parser.
- Test fixture brands are obtained by the existing UUID validator and the existing life locator parser. Alternate actor identity is sourced from the parsed locator.
- Receipt lookup accepts the actual template-literal once ID type.
- Direct storage point tests first prove the returned value is an object before calling `Reflect.get`.
- Changed-body replay varies the valid epoch field, avoiding a made-up home ID.

No casts, `any`, non-null assertions, suppressions, foundation/once changes, or unallocated source files were added.

## Exact-candidate validation

The canonical focused suite ran against this commit under the actual shared heavy lease, with escalated Node execution. It passed 8/8 (exit 0). Captured terminal output is `69eed6e-canonical-focused.log`, SHA-256 `d4632bbdd1bb465aafad6febdee966617c09d34ae265379bc24beca3382e1fb2`. The Node SQLite test uses the production SQLite adapter with Node's SQLite database; it does not execute inside workerd.

The full serial five-project compiler-only command ran against this commit with escalated execution, shared heavy lease slot 1, Node 24.19.0 and the authorized 4096 MiB compiler heap:

`AGENT_SLOT_DIR=/workspace/remote-verification/agent-slots AGENT_SLOT_HEAVY=1 NODE_OPTIONS=--max-old-space-size=4096 node --experimental-strip-types scripts/agent-slot.ts heavy -- node --experimental-strip-types scripts/typecheck.ts --serial`

Exit code 0: `Typecheck clean: 5 projects, 0 errors in .ts and .vue, 0 baselined in existing JavaScript.` Raw log `69eed6e-five-project-typecheck-4096.raw.log`, SHA-256 `dd746544cb303e0051d73dfae02f231d3dd61011f2a35388381a12d0b5bbd961`. The compiler pass made no source or baseline changes.

Current pins:

- `server/households/durableStorage.ts`: `fa0bc5942e7d49187176472333118c63bfff73f6508189b456c649c85f126447`
- `server/households/durableApply.ts`: `c33f25f9c361916b475c62f7be7493f0a95c00f85579a02d218284658b64c5ba`
- `server/households/durableService.ts`: `7f72027f3722f1b6ed1047a2781268a76d78b0cad92281a2eefcb53e5555a1f7`
- `server/households/durable.test.ts`: `480fd15ef1624fa1ef2d3932cd1b19bf2deba884c4ad133dd5f15c836fa653a5`
- unchanged `server/households/records.ts`: `ec8b77b1ba951e5b26f2a17e885b13f22a28c5de404c64d366f21ed7935f146d`
- unchanged `server/types.ts`: `4c21ae4c7b1166c9cd83bd8052a8e63ca6b634335168954b5a3b237c51c91b07`
- unchanged `server/keyed.ts`: `fcb0980c057d9e658c64e5e69512c2b60cb7eb39365a9c9d5475872b9e92af68`
- unchanged `server/routes/once.ts`: `6072fa044253a38d35b948a33163ea0a2e787ef197bcce3d3760393be94b7046`

The worktree is clean. No push was attempted; the prior cfb origin push rejection remains in force, with no alternate publisher used. This compiler and test evidence does not activate routes or close remaining authority/lifecycle/liability integration gaps.
