# Portable stage artifact for the mobile guide

Recorded 2026-10-10T01:11:03.487511+00:00. Source `8a48405963ca526bfe059b413be250d834d50b90`; verification tooling `fa8ba00ac63be7ddf0edf80be27ea1a81a7ed6fe`. WORLD owns dispatch, artifact download, original-store staging and provider upload. Sol reviews evidence and acceptance; no Root dispatch, local build or upload was performed.

The cloud coordinator confirmed that its runtime has no upload tool for the existing `/workspace` archive. The published handoff and hashes do not deliver those bytes to the native-stage owner. Preserve that archive, but do not assume cross-machine file access.

The existing `africa-starter-audit-ci.yml` workflow accepts `sealed_source_sha`. At published branch `codex/world-sealed-eec-tools`, it calls `world-sealed-africa-ci.yml`, builds the exact source once, checks unchanged download caps, seals the Worker and actual assets with `publish=false`, exercises the sealed SQLite Worker, then archives and retains that same package. Prior run [38002567221](https://github.com/kromate/joinallworld/actions/runs/38002567221) used this exact tooling branch/SHA and completed successfully. The current branch pin and public repository visibility were independently read; no Actions run was in progress at the preflight read.

For the existing WORLD owner, within existing quota and zero-extra-spending controls:

```sh
gh workflow run africa-starter-audit-ci.yml --repo kromate/joinallworld --ref codex/world-sealed-eec-tools -f sealed_source_sha=8a48405963ca526bfe059b413be250d834d50b90
```

This is a required portable artifact for a new changed source. Its actual run ID, source, package digest, archive SHA, artifact ID and downloaded bytes must be recorded. It must not inherit the cloud-local archive `990eb62b…` or package digest `88c19314…`. Check the downloaded package again before stage use. The workflow's synthetic travel/SQLite/Assets checks do not prove native guide, teaching or Clerk behavior or original-save continuity.

The existing workflow uses standard `ubuntu-24.04`; GitHub documents free standard runners for public repositories ([runner reference](https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job)). Preserve existing artifact/storage allowances and provider limits; no overage, upgrade, new grant or new hosting is authorized. If existing capacity cannot support this export, park that exact transfer lane and continue ordinary Clerk gameplay on an already accepted compatible artifact/stage.

The dispatch has been requested from WORLD; execution and artifact delivery are not yet claimed. Corrected Clerk phone checks cover the `shell.inPhone` hiding rule. Active teaching choices require separate ordinary eligible-lesson evidence, without resetting completed original A or creating an actor for evidence.

Exact workflow pins:

| File | SHA-256 |
| --- | --- |
| `.github/workflows/africa-starter-audit-ci.yml` | `5f4b8e5f1c3be490ba04afc18e150802e7d8b4244b89f449a77f098f499e822f` |
| `.github/workflows/world-sealed-africa-ci.yml` | `6d7d355a13b727d7e32153a2d5892e5ff585673f79ea6a2d3e6e244f28c6348e` |
