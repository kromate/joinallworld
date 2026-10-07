Implement deeper progression and replay value in Allworld, based on the advice in /Users/anthonyakpan/Downloads/Video-57247.mp4.

Repository: /Users/anthonyakpan/Desktop/JoinAllworld

The reel’s main points:
1. Money must retain value through balanced earning and meaningful purchases.
2. Players need aspirations, stories, and consequential interactions.
3. Community activities and ongoing content should give people reasons to return.

Read AGENTS.md and the applicable engineering skills before starting. Use cheaper subagents for bounded research and implementation; Astra owns design decisions, integration, verification, and browser use. Preserve existing dirty changes. Do not create branches or worktrees, add or modify tests, commit, push, deploy, or publish without explicit authorization.

First inspect the current implementation. Prior source inspection found careers, university progression, wishes, missions, NPC relationships, events, multiplayer tables, and an economy simulator. Confirm their current behavior and reuse them.

Phase 1: Establish the baseline and implementation design

Trace:
- All income sources, daily limits, purchases, recurring costs, and transfers.
- University enrolment, semesters, assignments, campus jobs, and hostel accommodation.
- Starter goals, aspirations, wishes, and missions.
- NPC relationships, saved progression, events, and multiplayer tables.

Produce a concise design with:
- Existing systems to reuse.
- Required changes and their ownership.
- The saved story state and progression rules.
- Acceptance criteria for each phase.

Do not assume documentation proves runtime behavior.

Phase 2: Check and improve economic progression

Use the existing economy simulator and focused checks to compare ordinary careers, gigs, social rewards, referrals, table games, and combined strategies.

Measure:
- Income and spending over 1, 7, and 30 game days.
- Time to afford a first home upgrade and basic car.
- Whether ongoing ownership costs are sustainable.
- Whether repetitive activities or reward combinations dominate careers.
- Whether a broke player can recover without payment.

Fix demonstrated problems with the smallest coherent changes. Preserve free basic recovery and accessible social play. Do not make poverty or excessive grinding the retention mechanism.

Use reputation, relationships, cosmetics, and access as some rewards so progression does not depend entirely on printing more money. Document the reasoning behind balance changes.

Phase 3: Implement one complete aspiration storyline, “Hostel Hustle”

Build a playable university story using existing campus systems.

Suggested chapters:
1. Meet a recurring campus character and choose an ambition.
2. Prepare for enrolment or the next semester using existing requirements.
3. Complete a campus gig and establish a relationship.
4. Choose between extra work, studying, and helping a friend.
5. Help organise or participate in a campus Whot tournament.
6. Receive a lasting outcome and a clear next ambition.

Keep the story adaptable:
- Guests can encounter its introduction before settling in.
- Current students can enter without repeating completed requirements.
- Players who do not want university can decline or postpone it.
- Solo players can complete it using NPCs or house bots.
- Online players can participate together when available.
- Closing the game or reconnecting must preserve progress.

Choices must affect later dialogue, relationships, opportunities, or rewards. Avoid fake choices and a sequence of timers with flavour text.

Use named recurring NPCs with recognisable motivations. Store meaningful choices and reference them later. Keep the first storyline small enough to finish and polish.

Phase 4: Make the story playable in the world

Present story interactions through relevant characters and locations. Keep guidance short and show one useful next step.

Deepen a small number of activities with decisions, such as:
- Handling a campus job problem.
- Choosing how to prepare for an assignment.
- Negotiating responsibilities for an event.

Reuse established UI patterns. Provide clear feedback for requirements, progress, decisions, and rewards. Ensure mobile players can complete every interaction.

Phase 5: Add one recurring community event

Connect a campus tournament or neighbourhood event to the storyline.

Allow useful contributions from different players without requiring donations or wealth. Include a solo fallback and a visible shared result, such as venue decoration, a commemorative item, or an event title.

Use a configurable schedule and reusable content definitions. Avoid building a general-purpose content editor for this first release.

Provide a simple feedback route using the existing problem-reporting or feedback system.

Phase 6: Verify and deliver

Run relevant existing checks permitted by the repository and current authorization. Do not add or modify tests.

Exercise the real player flow in an authorised preview:
- New guest encounters the introduction.
- Existing student joins at the correct chapter.
- Each meaningful choice produces its intended outcome.
- Solo and multiplayer paths work.
- Reload and reconnect preserve progress.
- Repeated actions cannot duplicate rewards or contributions.
- Failed or unavailable actions explain what to do next.
- Mobile controls remain usable.
- Wallet changes have correct ledger entries.

For delivery, report:
- What changed and where.
- Economic findings and adjustments.
- The complete playable storyline and its outcomes.
- Verification evidence and remaining limitations.
- What remains local versus released.

Success means a player can complete one coherent story, make a decision that matters later, earn a lasting reward, and see a reason to return. Complete that experience before expanding into additional aspirations or cities.