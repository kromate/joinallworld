# A connected living world

Persistent implementation goal, revised 8 October 2026. This task publishes documentation only and does not launch implementation. The user’s separate implementation assignment includes deployment to production in phases. Record that standing scope when the goal is assigned; follow the release checks and exceptional approval boundaries below. Proposed features are not claimed to exist.

The outcome is a city in which players **learn → qualify → serve → earn → improve**. A driving lesson makes a delivery possible; a delivery restocks a shop; a barber serves its customers; earned income improves the player's life. These activities must work together, persist, and remain playable when no other person is online.

## Start here

1. Read [the source baseline and ownership map](BASELINE.md), then verify the receiving machine’s repository, current branch, SHA, dirty state, applicable agent instructions, published branches/PRs and scope records. Completion means a recorded baseline and non-conflicting write scopes. Access to another machine or its local agents is not required or assumed.
2. Read [the design](DESIGN.md) for domain boundaries and the first complete player journey. Use [the research register](RESEARCH.md) when selecting map data, business verification, booking or transaction behavior.
3. Execute [the phases and persistent delivery loop](PHASES.md). Start with one district; then continue through the programme and evidence-backed improvements. Each batch has finite acceptance, production verification and a resumable checkpoint.
4. Give [the orchestrator prompt](ORCHESTRATOR.md) to the implementation lead. It specifies Sol orchestration, bounded Luna execution, repeated real play/simulation, independent review, phased release and continuation across sessions. Use a native persistent-goal feature only if that runtime actually supports it; otherwise use the plain-language goal and checkpoint.

Every linked instruction uses repository-relative paths. Resolve those paths from your own checkout; historical documents may contain another machine's locations, which are context rather than commands to follow.

## Repository and baseline

| Item | Verified value |
| --- | --- |
| Repository | [kromate/joinallworld](https://github.com/kromate/joinallworld) |
| Clone URL | `https://github.com/kromate/joinallworld.git` |
| Default branch | `main` |
| Source snapshot inspected | [`9f9bed3616ac43e0989ce42d856490cb57d94dba`](https://github.com/kromate/joinallworld/commit/9f9bed3616ac43e0989ce42d856490cb57d94dba), “Record live app redesign verification” |
| Implementation and release status of this plan | Proposed; no gameplay changes or production actions performed |

The remote metadata and `main` commit were checked through GitHub's repository and branch APIs, and the source was inspected at that SHA. Local remote-tracking refs may be stale; they were not used to establish the live remote default or its tip. This is the new JoinAllworld repository. The old `kromate/allworld` repository and historical prototypes are not interchangeable baselines. A current repository commit also does not prove which build is live.

## Ownership boundaries

Existing agents own Goalmatic integration, graphics and worldbuilding. Remote executors cannot inspect this Mac or contact its local agents. Discover available ownership, contracts and changes from authorized GitHub branches, PRs and published handoffs. Use the supported browser and the user’s existing signed-in GitHub session to try private Goalmatic reads before declaring access unavailable; browser access is not terminal git credentials. Do not claim coordination that did not occur. Keep reserved paths untouched unless an accessible handoff establishes a compatible scope.

The programme owns its scoped gameplay contracts and journeys. Consume published world/appearance/Goalmatic interfaces and current source. If a contract or private repository is unavailable, implement an isolated mock and disabled adapter, record the precise contract/access handoff needed, and continue independent gameplay. [Goalmatic repository visibility and public contract entry points](BASELINE.md#goalmatic-handoff) identify what another machine can actually read.

## What counts as delivery

The first accepted slice is **district school → simulated licence → permitted rental → actual driving → shop restocking delivery → consenting barber service → payment → tool improvement → reload with progress intact**. A solo player uses NPC counterparts; two people can complete the same contracts together. A menu label, timer, decorative car, mock payment or successful compile is not proof of this journey.

Later phases add richer professions, fictional civic institutions and an opt-in real-business pilot. Simulated points, real NGN commerce and Goalmatic usage credits retain separate authority and accounting. Real clinical and legal services are outside the business pilot.

Keep one implementation tracker using the schema in [PHASES.md](PHASES.md#evidence-record). The goal persists after the first slice and across sessions: play → observe → choose a bounded improvement → implement → test/repair → independent review → stage → deploy the phase → verify live → update the backlog/checkpoint. The user’s phased-production direction supplies standing intent within this feature programme; do not impose a new generic approval question for every phase. Preserve existing release rules and required action-time approvals. If no safe, valuable in-scope work remains, report the evidence and await direction rather than inventing tasks or claiming a scheduler exists.
