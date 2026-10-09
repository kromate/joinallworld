# Trusted teaching display capability proposal

Baseline: `c1f7c1f7369139ce559292318ba9842c23a28267`. The patch transports an optional literal-`true` host capability on authenticated life/action snapshots. Node enables it only from the trusted `ServerOptions` boolean; Worker enables it only when `INTERACTIVE_TEACHING_STARTS === "1"`. Default, missing, malformed, and older-host responses stay off and preserve the existing default response key sets.

The client adopts the capability only alongside a normally accepted life snapshot. It is bound in memory to the authenticated owner, the actually accepted city, and existing connection/snapshot generations captured when that request began. Reconnect and explicit city/character switches clear the effective capability; an obsolete response cannot restore it. The value is never copied into `LifeState`, saved storage, or an action request. Existing marked lessons remain readable and answerable when new starts are off. Snapshot acceptance retains the original authoritative `estate.city` behavior, including valid intercity action responses. The Vue store publishes immediately after a switch begins, so its derived career view does not keep showing an enabled start while a city transition is pending.

The client regression is transport-level only: it checks a valid intercity action envelope is adopted, that capability follows the accepted city, and that the same action intent settles. It does not claim a real journey was executed. The Vue-store regression uses a held failed city-switch response to check immediate presentation clearing while preserving the accepted life.

Changed paths and base/proposal SHA-256 values are in the JSON manifest below. Prior draft hashes are recorded as superseded.

Verification is limited to source review and an exact-baseline `git apply --check` on a temporary copy (pending final run). Tests, typecheck, build, Worker/browser execution, startup-budget measurement, and native walkthrough remain for the Integration owner. This is an unapplied proposal; it does not activate the feature or establish release acceptance.

```json
{
  "baseline_commit": "c1f7c1f7369139ce559292318ba9842c23a28267",
  "supersedes_source_draft_sha256": [
    "aa1e9f4166189a6a570b1f3db7f3bee4e05186f75530058f0b631d2d446ecd7e",
    "4ee397c19ecea3d24bb4f7ef7a021cc943f593b3984605e65f5b837930541f90",
    "572cd3cf50d292ba6c24193eb28766001da330e583f8c0f211a108274c32dbf6"
  ],
  "patch_sha256": "6aee4d5183111c661a728010ad4e609b75c1c67dc06149feb9e8bf96c70e0ff2",
  "runtime_model_evidence": "Parent-verified session turn_context at 2026-10-09T21:03:04.617Z: gpt-6-luna/high",
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
      "proposal_sha256": "b6d654bb733786539323c4d77c1f5f2e64ab2b46a74117d98ec61960ee6b3ed0"
    },
    {
      "path": "src/app/types/client.ts",
      "base_sha256": "4870de8118f38f2661b260e340d7569f3e2984451d00c9ad62d288c254725b2f",
      "proposal_sha256": "7484ed025e4366cb719e8607fb7dda39e7fac5f0dd3dfa3f0979383b0df25743"
    },
    {
      "path": "src/app/state/game.ts",
      "base_sha256": "4502912aab6c6ab451838d99703b33ba8627f862a97c9467de71bf652082f7ad",
      "proposal_sha256": "38c1739d007ea9202fcb49fcb898652f9e6c63d13ec34b541493abed3c5d3829"
    },
    {
      "path": "src/app/state/game.test.ts",
      "base_sha256": "e5b7e0aae5aa92f77f4f4e002e80552ae50c7c43ec9126ba91cd3f04c118e937",
      "proposal_sha256": "6672ba427b45113fbade910f0b30b7aaee2ea71c39c7353e7d94dd56f87a31f2"
    },
    {
      "path": "src/types/protocol.test.ts",
      "base_sha256": "476b9af095c65c2ad721bda29a0e97635504029be714666d6a28d5224d30470c",
      "proposal_sha256": "7b9fea1ddb80ce2a7d04cca5ecf861302862bfe3786e224cc8d7105e9a05b8bf"
    },
    {
      "path": "deploy/living-world-teaching.edge.test.ts",
      "base_sha256": "f2b5f50459cf10fa0ff464c4b7439ae4600f25a936e56b0ac88fa96921aa6d94",
      "proposal_sha256": "849ce04158cc4d9745a16b44a0403fd27c58f4e677dee9193647281c58f3aaaf"
    },
    {
      "path": "src/client.test.ts",
      "base_sha256": "750c31b9ee86521f3c6a7f7bafacd920fc3594a89e5e76a7fa9a28b13de10e57",
      "proposal_sha256": "92f9de265cfdd0adcd389f5b0d8b8f8ee102a77fa4117f5d926d44179503ed4c"
    }
  ],
  "source_only_checks": {
    "exact_baseline_git_apply_check": "passed on temporary source copy",
    "tests": "not run",
    "typecheck": "not run",
    "build": "not run",
    "worker_browser_native": "not run"
  },
  "status": "unapplied proposal; Integration owns assembly and verification"
}
```
