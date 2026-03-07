+++
title = "Coordinating Parallel Agent Teams With Git and Prose"
date = 2026-02-24T09:00:00-08:00
draft = false
tags = ["ai", "architecture", "agents"]
author = "Patrick Smith"
original_date = "2026-02-24"
ogTitle = "Coordinating Parallel Agent Teams With Git and Prose Protocols"
description = "Before swarm APIs existed, we ran parallel agent teams using git workspaces and a Director defined in markdown. Here's what broke and what fixed it."
+++

January 2026. Gridiron Dynasty needed parallel development across several feature areas simultaneously. The native tooling for agent swarm coordination, Claude's sub-agent spawning, proper worktree isolation, lifecycle management, either didn't exist yet or wasn't available. So the coordination layer got built from scratch: AGENTS.md files, git, and a Director role defined entirely in prose.

It worked. It also produced a detailed failure record, because the first real multi-team run went badly in several specific ways before the protocols that prevented those failures existed.

## The coordination architecture

The Director role is defined in a protocol document. It specifies how to analyze incoming work, partition it by file boundary to prevent conflicts, spawn Architect agents with explicit work packages, monitor checkpoint progress, and coordinate merges in dependency order. The Architect role is separate: design system boundaries and decompose work for engineers, implement nothing. Engineers implement per-Architect spec and own specific files exclusively. Reviewers audit completed code and produce nothing except assessments.

Each role has explicit prohibitions, not just responsibilities. The Architect doesn't implement UI. The Engineer doesn't make architectural decisions. The Reviewer doesn't implement anything. It has one job, which is specifically to distrust what the engineers produced.

Workspace isolation is the physical layer. Each team gets a separate git checkout, created by the Director before teams are spawned, outside the main repository:

```
workspaces/
├── team-alpha/
│   ├── architect/   ← independent clone, team-alpha/architect branch
│   ├── eng-1/       ← independent clone, team-alpha/feature-x branch
│   └── eng-2/       ← independent clone, team-alpha/feature-y branch
└── team-beta/
    ├── architect/
    └── eng-1/
```

Not a branch in the main repo. A completely separate clone, on an explicitly named branch, in a directory that only that agent touches. The main repository is read-only reference material. File ownership is assigned before implementation begins. If two engineers need to touch the same file, the work gets redesigned so they don't, or one engineer is designated the owner and the other waits.

The checkpoint system gives the Director visibility into team progress without shared state. CP1 is design complete. CP2 is 50% implementation. CP3 is 100% implementation. CP4 is review passed (9.5/10 minimum). CP5 is all fixes complete. CP6 is PR ready with CI passing. Teams report at each checkpoint using a mandatory template that includes commit hashes, file change summaries, and explicit review scores. No checkpoint gets approved on a report alone. The Director verifies claims against git state before accepting them.

## The failures that built the protocol

Team 5 produced the checkpoint verification requirement. Team 5 reported PR-Ready status: CP6, all features complete, code reviewed, CI passing. No code had been written. The team had produced a thorough analysis of what needed to be implemented and reported completion of the implementation. Those are different things. The mandatory template with commit hashes and the Director verification step against git state exist to make this class of failure impossible to repeat.

Team 3 gave us the pre-flight feature audit protocol. Team 3 spent an entire work cycle analyzing features that already existed in the codebase. The Director had created a work package from a planning document; the planning document was stale; the features had shipped in a prior sprint. The pre-flight audit now requires the Director to verify what actually exists before spawning any teams, because agents handed vague instructions will confidently work on nonexistent problems.

Workspace enforcement came from a simpler failure: teams wrote to the main repository directly. Instead of working in their isolated checkouts, they made changes in the reference clone and left untracked files and modifications that had to be cleaned up. The fix was adding explicit absolute paths to every spawn directive: "You MUST NOT modify files in `/path/to/main/`. This is a read-only reference. ALL changes must be in your workspace: `/path/to/workspaces/team-alpha/architect/`." Ambiguity about which directory to work in resolved in the wrong direction every time.

Code quality reviews weren't happening, and that produced the 9.5/10 quality gate. The threshold was defined. The Reviewer role was defined. The reviews weren't running because nothing in the flow made them mandatory before the Director accepted a completion report. Fix: make the score a required field in the completion report template, and make the Director responsible for rejecting any report that doesn't include it.

These failures are a project retrospective. The difference is that the retrospective is written directly into the coordination protocol for future runs, where it governs agents who have never heard of the run that produced the lessons.

## The limits of prose-defined coordination

The system worked. Multiple parallel teams shipped large feature sets: Draft Phase 2 (163 tests, 11 features) and Draft Phase 3A (trading, scheme fit, performance optimization) both came out of multi-team runs using this protocol. The Director Protocols document is a living record of what failed and what was added to prevent it from failing again.

The overhead compared to native swarm tooling is real. The Director manually sets up workspaces, manually verifies completion claims, and manually coordinates merges in dependency order. False reports require manual investigation. Workspace setup is error-prone enough to have its own checklist. A platform-level isolation guarantee would eliminate entire categories of failure from the possible space.

But the coordination model translates well. The Director role becomes a swarm coordinator. Workspace isolation becomes worktree isolation managed by the platform. The checkpoint protocol maps to agent lifecycle management. The I/O contracts between roles stay the same regardless of how the isolation is implemented. What the prose-based system forced was explicit design of everything a platform might handle invisibly: what does each agent see, what does it produce, when does it hand off, who verifies the handoff, and what does verification mean in terms of observable state.

A platform that handles workspace isolation mechanically doesn't eliminate the need to design those boundaries. It just removes the cost of enforcing them manually. The pre-flight audit, the completion report structure, the quality gate, the file ownership assignment: these are design decisions, not implementation overhead. They'd be needed with native swarm tooling too.

The lessons-learned section of the Director Protocols isn't about tooling limitations. It's about the failure modes of parallel work under coordination, agent or human, and those don't change because the isolation is handled by a platform instead of a shell script.
