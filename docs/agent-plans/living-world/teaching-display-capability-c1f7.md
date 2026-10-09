# Trusted teaching display capability proposal

Baseline: `c1f7c1f7369139ce559292318ba9842c23a28267`. This patch transports an optional literal-`true` host capability on authenticated life/action snapshots. Node enables it only from the trusted `ServerOptions` boolean; Worker enables it only when `INTERACTIVE_TEACHING_STARTS === "1"`. Default, missing, malformed, and older-host responses stay off and preserve existing default response key sets. Request payload fields cannot enable it: gate-off Node and Worker HTTP fixtures send `interactiveTeachingStarts: true` with a normal teacher activity start and still receive an unmarked legacy timed shift with generation zero.

The client adopts the capability only alongside a normally accepted life snapshot. It remains in memory and is bound to the response owner, the actually accepted city, and existing connection/snapshot generations. Reconnect and city/character transitions clear it. While a transition is pending, ordinary life/action snapshots can still update authoritative game state and settle their existing intents, but cannot restore the capability; reads started during a transition remain unable to restore it even when they resolve after success or refusal. Only a fresh later read may restore it after a refusal. The direct SettingsTab legacy-character switch path publishes the immediate clear into the Vue store without emitting a synthetic accepted-life event. Both refused and successful held-switch cases are covered; the successful accepted response installs the capability and emits one normal accepted event. A delayed old-actor literal-true response cannot restore the replacement actor's capability. The value is never copied into `LifeState`, storage, or an action request. Existing marked lessons remain readable and answerable when new starts are off.

Snapshot acceptance retains original authoritative `estate.city` behavior, including valid city-moving action responses. Client regressions cover strict literal parsing, missing/older host fields, same-revision ON-to-OFF, reconnect and actor races, transition/refresh interleavings, and city-moving action acceptance. These are source fixtures, not actual browser/native acceptance.

Changed paths and exact source hashes are listed in the JSON manifest below. Previous source-draft hashes are recorded as superseded.

Verification is limited to source review and an exact-baseline `git apply --check` on a temporary copy. Tests, typecheck, build, Worker/browser execution, startup-budget measurement, and native walkthrough remain for the Integration owner. This is an unapplied proposal; it does not activate the feature or establish release acceptance.

```json
{
  "baseline_commit": "c1f7c1f7369139ce559292318ba9842c23a28267",
  "supersedes_source_draft_sha256": [
    "aa1e9f4166189a6a570b1f3db7f3bee4e05186f75530058f0b631d2d446ecd7e",
    "4ee397c19ecea3d24bb4f7ef7a021cc943f593b3984605e65f5b837930541f90",
    "572cd3cf50d292ba6c24193eb28766001da330e583f8c0f211a108274c32dbf6",
    "6aee4d5183111c661a728010ad4e609b75c1c67dc06149feb9e8bf96c70e0ff2",
    "71083b61ac52a4cb11162847f1cbea09cfa19008c255fc53571ec80904a61dba"
  ],
  "patch_sha256": "9853a38d9b6a0f0a240a695325991dc710bc85a8d14d96173389ddc1c0168254",
  "runtime_model_evidence": "Parent-verified session turn_context at 2026-10-09 21:31 UTC: gpt-6-luna/high",
  "changed_files": [
    {
      "path": "server/types.ts",
      "base_sha256": "59eaee81667763b6d36bf3bf12f4b1611c5ca0ffebed28dc096b060cf9f969c0",
      "proposal_sha256": "a52d440d33c878a38c9d99c28757cf0064f224466a573726c88cc579a46672fd"
    },
    {
      "path": "server/server.ts",
      "base_sha256": "c3b7fb310c3f45c56ef4049e3f0e7d01cb1ba9dc92013e40494b4c0f6353f26c",
      "proposal_sha256": "c551d2a3f1b157b908cbc7ab6dc57d993019d43cf73494bb0f5cf9e49722d5e7"
    },
    {
      "path": "server/routes/core.ts",
      "base_sha256": "322c1409c63dfaffb3da34ad74923622770e3bfebfa429afeacb661dff6ff5be",
      "proposal_sha256": "d54c1ad916a5e69fc261038c9c2ca3ef2bb1f1b41a8563da6e549c185e91b4a5"
    },
    {
      "path": "server/teaching-career.test.ts",
      "base_sha256": "96b3314f0b91fdce69eae87ead11a1de7dc295b56d437df36a04d001c8c61598",
      "proposal_sha256": "f3a62b9ca815dbf8dc91b1ee5aadb04197af8d25bb9490ece09b2c41a6ea1fb8"
    },
    {
      "path": "deploy/cloudflare-worker.ts",
      "base_sha256": "a36e7587f98f7a0e13a1861d9eec37910c669f2c7151018e90d5d6ba34187093",
      "proposal_sha256": "b53d611a9d3cf71c400a186eef8aa8c0495dce7df14c6623ada4ca42d68a6982"
    },
    {
      "path": "src/types/protocol.ts",
      "base_sha256": "d909b407bcb96e1daaafecfb87cff61d0e49a76692aa6ac475d20482723623ef",
      "proposal_sha256": "7b972723925af563ecd982b94efc8ab08f0e7272a33011bd213213e205358912"
    },
    {
      "path": "src/client.ts",
      "base_sha256": "d0f2da50b4f9df4525d08cb89e971601a82d0528383d5039ce70aacceb544b32",
      "proposal_sha256": "f6bff3fb471d7ee49071ccf88af3454d29668a1cf29c93c76bc35e78d384adc4"
    },
    {
      "path": "src/app/types/client.ts",
      "base_sha256": "4870de8118f38f2661b260e340d7569f3e2984451d00c9ad62d288c254725b2f",
      "proposal_sha256": "7484ed025e4366cb719e8607fb7dda39e7fac5f0dd3dfa3f0979383b0df25743"
    },
    {
      "path": "src/app/state/game.ts",
      "base_sha256": "4502912aab6c6ab451838d99703b33ba8627f862a97c9467de71bf652082f7ad",
      "proposal_sha256": "2158a603d61a4d0c44ef9d6ddbbf7638b081a3bef64649a7541e0ac6603042e9"
    },
    {
      "path": "src/app/state/game.test.ts",
      "base_sha256": "e5b7e0aae5aa92f77f4f4e002e80552ae50c7c43ec9126ba91cd3f04c118e937",
      "proposal_sha256": "7991686d665120c60e1d833050215b1d25926227ca6aa5c5032200784dec2b44"
    },
    {
      "path": "src/types/protocol.test.ts",
      "base_sha256": "476b9af095c65c2ad721bda29a0e97635504029be714666d6a28d5224d30470c",
      "proposal_sha256": "7b9fea1ddb80ce2a7d04cca5ecf861302862bfe3786e224cc8d7105e9a05b8bf"
    },
    {
      "path": "deploy/living-world-teaching.edge.test.ts",
      "base_sha256": "f2b5f50459cf10fa0ff464c4b7439ae4600f25a936e56b0ac88fa96921aa6d94",
      "proposal_sha256": "42eac60accb6ea3f183ba69b4132af46dac5960e4a66b9ef5b9792f98ad1a6dc"
    },
    {
      "path": "src/client.test.ts",
      "base_sha256": "750c31b9ee86521f3c6a7f7bafacd920fc3594a89e5e76a7fa9a28b13de10e57",
      "proposal_sha256": "5ceb123b0481a3c0e6a33353903a7abc0d22d509f276bf6673cc26234600ca57"
    }
  ],
  "source_only_checks": {
    "exact_baseline_git_apply_check": "pending final check",
    "tests": "not run",
    "typecheck": "not run",
    "build": "not run",
    "worker_browser_native": "not run"
  },
  "status": "unapplied proposal; Integration owns assembly and verification"
}
```
