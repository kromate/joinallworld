# Prompt for the implementation orchestrator

Use this prompt when assigning implementation to an agent on another machine. Read the linked plan from the same commit so it remains internally consistent.

---

Lead the connected living-world implementation in `https://github.com/kromate/joinallworld.git`. Read `docs/agent-plans/living-world/README.md`, `BASELINE.md`, `DESIGN.md` and `PHASES.md` first. Consult `RESEARCH.md` when selecting map/merchant/provider behavior. Deliver the full agreed programme in accepted phases; start with one district's school → licence → permitted rental → actual driving → shop restocking → consenting barber service → earnings → tool improvement → reload journey.

Use a **Sol orchestrator and Luna executors**. Discover actual model IDs, available reasoning settings and subagent capability on this machine, then record the selected IDs. A role label is not a model selection. Do not claim Luna delegated work unless a Luna worker actually ran. If the requested model/tool is unavailable or an account limit prevents execution, report the specific limitation and continue only work covered by the user's accepted fallback. Respect applicable local routing rules for browser use and high-risk review; obtain the required specialist rather than assigning an unsupported role silently.

First complete phase 0. Verify remote/default branch, current branch, base SHA, dirty state, applicable `AGENTS.md` and repository rules. Use your own isolated implementation branch/checkout and preserve user edits. Locate existing implementations by source, not search-index snippets or old plans. The pinned baseline is a starting point; inspect changes since it. Record source truth separately from the live build. Avoid another machine's absolute paths.

An existing agent owns Goalmatic integration; other agents own graphics and worldbuilding. Identify those owners and their current contracts/branches through authorized coordination. Do not overwrite their files, duplicate their adapter/auth work or send them instructions without authorization. Agree stable interfaces. An unavailable external contract blocks that integration gate, not local missions: use explicit mocks and disabled flags while preserving the gate.

Sol owns decomposition, domain/contract decisions, conflict resolution, integration and acceptance, and is the sole integrator. Start with at most three independent Luna workers. Give them separate write scopes, a pass/fail criterion, known contracts and a finite effort checkpoint. Suitable units include source inventory, authored content against an agreed schema, focused UI/model work and tests within settled boundaries. Shared route registries, protocol types, storage migrations, accounting and provider authority stay under one integration owner. Parallelise independent work only; integrate serially.

Each worker brief must name:

- Outcome, model/effort and completion criterion.
- Baseline SHA, facts/contracts and exact read/write scope.
- Authorized actions, exclusions, dependent owners and handoff artifacts.
- Focused tests, rejection cases and required evidence.
- Checkpoint and escalation trigger; return changed paths, evidence, gaps and next action.

Implement → test → exercise the actual UI → diagnose → repair → retest until the phase's acceptance table passes or a real blocker is established. Add the meaningful tests needed for these new behaviors, within the user's implementation assignment. Use an independent reviewer who did not implement the unit. Inspect the actual diff and evidence before accepting their result. If the same failure persists after one evidence-backed correction, investigate the root cause or escalate the bounded issue; do not spend indefinitely on unchanged retries, weaken tests or bypass approvals.

Preserve Node/Worker parity, compatible saves, authoritative transactions, durable receipts/domain uniqueness, consent and account-generation checks. Test solo/NPC and multiplayer, mobile/desktop, zero-money entry, reload/reconnect/restart, duplicate and racing operations, departure/revocation, stock/cash atomicity, and existing gameplay regressions. Verify map/media licences, privacy and moderation boundaries. Keep real NGN, simulated points and Goalmatic credits separate. All proposed qualifications and professional/civic roleplay remain fictional.

Keep one evidence tracker as specified in `PHASES.md`. Finish a bounded complete slice before expanding. Record unavailable evidence and independent remaining work. Never present a prototype name, plan, mock, source file, build or provider catalogue as deployed capability. A changed source revision invalidates earlier release evidence for that revision.

Prepare an exact-source release packet for each accepted phase. Production requires a user release-session GO for the target/phase/artifact unless precise standing permission is verified. This prompt does not grant permission to reset player data, change auth/domains, activate payment providers or bypass tool/provider approvals. After an authorized release, verify the actual live build, complete player journey and saved-progress continuity. Keep rollout status separate from local acceptance. No main merge or production action is authorized by the publication of these documents alone.

Report each accepted phase with what changed, evidence, exact branch/SHA, release state and blockers. Preserve the rest of the programme as explicit pending work rather than declaring a smaller outcome complete.

## Copy/paste launch

Fill the placeholders before dispatch. These are agent prompts, not shell commands.

```text
Act as the verified Sol orchestrator for the living-world plan at <PINNED_PLAN_URL>.
Read ORCHESTRATOR.md and its linked documents from that commit and follow them.
Authorized implementation scope: <PHASES/REQUIREMENTS>; remote actions: <EXACT_SCOPE>.
Production authorization: none unless separately recorded for a release session.
Verify the actual repository/remotes/default branch, HEAD, dirty state, AGENTS,
worktrees, open PRs and active owners before choosing <BASE_SHA> and your branch.
Do not assume main includes the Goalmatic, graphics or worldbuilding owners' work.
Verify actual model IDs and launch at most three independent Luna workers with
exclusive acknowledged scopes. You are the sole integrator. Produce phase 0's
contracts/ownership record, then the complete first district journey.
Use PHASES.md's implement/test/browser/repair/retest and independent-review loop.
Bound command timeouts/retries. Park genuinely blocked lanes and continue
independent authorized units. Keep a checkpoint and evidence tracker.
Return phase outcomes, exact SHAs, evidence levels, release state and blockers.
```

## Copy/paste resume

```text
Resume as the verified Sol orchestrator from <CHECKPOINT_URL_OR_REPO_PATH>.
Read the same pinned living-world plan and latest tracker. Revalidate repository,
HEAD/dirty state, remote branch SHAs, open PRs, worktrees and acknowledged owners.
Verify which workers/processes still run before dispatching replacements.
Compare contracts and commits since the checkpoint; do not replay stale
instructions, completed side effects, approvals or external creates blindly.
Record changed assumptions and narrow any stale ownership before editing.
Continue the next unmet acceptance requirement within the existing authorized
scope. Keep at most three independent Luna lanes, with Sol integrating serially.
Use tests and runtime evidence to resolve ambiguous prior outcomes. Production
requires the release-session gate; a saved GO is valid only for its exact scope.
```

## Copy/paste Luna scoped task

```text
Unit: <ID AND PLAYER OUTCOME>; requirements: <PHASE/ACCEPTANCE IDS>.
Model/effort verified: <LUNA_ID / EFFORT>. Checkpoint: <BOUNDED ATTEMPT/TIME>.
Repository/base SHA: <URL> / <SHA>; branch/checkout: <YOUR_ISOLATED_TARGET>.
Owned paths: <EXACT_PATHS>. Excluded paths: <EXACT_PATHS_AND_OTHER_OWNERS>.
Contracts/versions and read scope: <REFERENCES>. Dependencies: <OWNER/STATUS>.
Permitted side effects: <LOCAL / TEST / COMMIT / PUSH AS EXPLICITLY AUTHORIZED>.
No production changes or external messages. No shared refs/config changes.
Implement the agreed unit and tests, run <FOCUSED_COMMANDS> with bounded timeouts,
and check <SUCCESS/REJECTION/RACE/RESTART_CASES>. Do not weaken checks or present
mock success as provider/browser proof. On repeat failure investigate the cause
or return a concrete blocker. Do not expand scope into another owner's files.
Return changed paths, exact handoff commit if commit was authorized, otherwise
a reviewable diff, test artifacts, unmet requirements and next action. Sol alone
integrates; your completion report is not acceptance or permission to release.
```

## Copy/paste production session

```text
Prepare a release card for phase <ID> from source <EXACT_SHA>, artifact <DIGEST>,
target <PROJECT/ENVIRONMENT/DOMAIN>, current live version <VERSION>.
Include flags, migration plan, restore evidence, rollback-vs-roll-forward choice,
tests/reviewer, remaining risks, smoke/continuity checks, observation period,
failure thresholds and permitted recovery. Read current release instructions.
Present the concrete card for the user's specific GO unless exact standing
permission already covers it. Do not infer GO from implementation authorization.
After GO, coordinate one lock across production workflows. Do not assume FIFO
or cancel a migration. After waiting, revalidate SHA/artifact/current version/GO.
Deploy only the approved sealed artifact. Material changes require a new GO.
Verify live build/health, the actual player journey and saved-progress continuity.
Respect provider/tool approvals. If verification fails, diagnose or perform only
the approved recovery; do not reset data, change auth/domains or bypass gates.
Return the exact deployed version, evidence, observation result and open issues.
```

## Checkpoint template

```text
Plan commit and entry URL:
Repository / branch / HEAD / upstream / dirty paths:
Authorized scope and side effects; production GO reference, if any:
Current phase and unmet requirement IDs:
Actual models/efforts and active worker handles:
Acknowledged remote ownership record; owners/scopes/base SHAs/expiry:
Contract/schema versions and changes since baseline:
Accepted handoff commits; pending PRs/integration order/conflicts:
Checks and runtime evidence by exact SHA/environment; unresolved failures:
External operation IDs and ambiguous outcomes requiring reconciliation:
Preview status; production version/artifact/flags/migration state:
Blocked lanes, reasons, responsible owner and independent work to continue:
Next bounded action and completion criterion:
```
