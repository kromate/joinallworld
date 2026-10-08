# A connected living world

Implementation proposal, prepared 8 October 2026. This publication changes documentation only. It does not claim that the proposed features exist, authorize a production release, or replace work already owned by other agents.

The outcome is a city in which players **learn → qualify → serve → earn → improve**. A driving lesson makes a delivery possible; a delivery restocks a shop; a barber serves its customers; earned income improves the player's life. These activities must work together, persist, and remain playable when no other person is online.

## Start here

1. Read [the source baseline and ownership map](BASELINE.md), then verify the receiving machine's repository, current branch, SHA, dirty state, applicable agent instructions and active owners. Completion means a recorded baseline and exclusive write scopes, not an assumption that this snapshot is still current.
2. Read [the design](DESIGN.md) for domain boundaries and the first complete player journey. Use [the research register](RESEARCH.md) when selecting map data, business verification, booking or transaction behavior.
3. Execute [the phases and acceptance gates](PHASES.md). Start with one district and complete its connected journey before expanding the city or professions.
4. Give [the orchestrator prompt](ORCHESTRATOR.md) to the implementation lead. It specifies Sol orchestration, bounded Luna execution, independent review, and the test → repair → retest loop.

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

An existing agent owns Goalmatic integration. Other agents own graphics and worldbuilding. Discover their exact branches, interfaces and file ownership before assigning implementation. Their names and current branch SHAs were not established by this documentation pass. Do not invent them or take over their files.

The new programme owns the gameplay contracts and player journey agreed at phase 0. It consumes the existing Goalmatic boundary and requests small, documented world/appearance interfaces from those owners. Mock contracts and disabled integration flags let game work proceed while external contracts are resolved.

## What counts as delivery

The first accepted slice is **district school → simulated licence → permitted rental → actual driving → shop restocking delivery → consenting barber service → payment → tool improvement → reload with progress intact**. A solo player uses NPC counterparts; two people can complete the same contracts together. A menu label, timer, decorative car, mock payment or successful compile is not proof of this journey.

Later phases add richer professions, fictional civic institutions and an opt-in real-business pilot. Simulated points, real NGN commerce and Goalmatic usage credits retain separate authority and accounting. Real clinical and legal services are outside the business pilot.

Keep one implementation tracker using the schema in [PHASES.md](PHASES.md#evidence-record). Record local verification, preview verification and production release separately. Production requires a specific user release-session GO unless an exact standing permission is verified for the same target, phase and artifact.
