+++
title = "How the Resume Pipeline Earned Its Architecture"
date = 2026-02-17T09:00:00-08:00
draft = false
tags = ["ai", "architecture", "agents"]
author = "Patrick Smith"
original_date = "2026-02-17"
ogTitle = "How the Resume Pipeline Went From One Agent to Five"
description = "A single-agent resume builder looked complete until real job applications broke it. Three specific failures dictated the three architectural splits."
+++

The resume-builder started as a single AGENTS.md. One agent did everything: interview the candidate, select bullets, write the profile, write the cover letter, verify accuracy. The initial commit had comprehensive documentation: invariants, output formats, examples, edge cases. It looked like a complete system.

It wasn't. It was a complete document. The system got revealed by actually using it.

The first real test was a job application to Descript. The agent ran the full pipeline and produced output that was technically correct and obviously mass-produced. The bullet selector had made small phrasing improvements where it should have copied verbatim. The verifier found one issue and explained it away. The cover letter was warm but generic in the specific way warm-but-generic things are when produced by something that just finished doing four other jobs. The problems weren't random. They were predictable consequences of asking one context to do incompatible things in sequence.

Eight days after the initial commit: "Replace monolithic agent guide with specialized multi-agent system."

That's the whole rewrite. Five agents, named modes, explicit I/O contracts. The curator became specifically and only a curation tool: select or omit, never improve. The cover letter writer received a context that had never seen the curation reasoning. The verifier was explicitly instructed to distrust everything the other agents produced. The architectural split wasn't designed before the failure. It was designed from the failure.

## The rules come after the failures

The Selection Principle, "bullets are receipts, they cannot be altered in meaning, scope, tools, or metrics," doesn't appear in the February 1st version. It was added February 6th, after the Descript run made the violation visible. The rule is precisely shaped by what broke: the selector had been editing meaning while believing it was editing presentation. The prohibition wasn't theoretical. It was the specific observed failure written as a constraint.

The same pattern repeated after the architectural split. Two more structural problems surfaced quickly, and both got fixed by adding structure, not by refining instructions.

First: the system was built for one user. Data files, output directories, everything assumed a single candidate. When a second person tried to use it, data directories collided. The fix was a per-user directory layout with a `data/current` symlink that all agents and templates read through:

```
data/
├── janedoe/
│   ├── experiences.toml
│   └── info.toml
└── johnsmith/
    ├── experiences.toml
    └── info.toml
data/current -> data/janedoe/  (symlink, set by build.py --user janedoe)
```

Every agent is user-unaware; the indirection handles it. Build scripts, Typst templates, and all agent instructions read from `data/current/`. Switching users is one command. The agents don't change.

Second: the system kept repeating the same mistakes for the same users. A cover letter writer with no memory of prior runs would make the same structural choices already identified as wrong for that person: too formal, too much emphasis on a certain project, a framing that a particular recruiter type doesn't respond to. The system can't remember between runs, but the lessons can travel. The February 14th commit adds `TEACHABLE_MOMENTS.md`, a per-user file in their data directory with field notes on what works and what doesn't for that specific candidate. Agents are instructed to read it before starting.

## Architecture by accumulation

The AGENTS.md on February 14th looks nothing like the one on February 1st. Five specialized agents instead of one general one. Named modes with explicit prohibitions. Multi-user data layout. Per-user lesson files. A full application workflow document. Role-specific instruction files split into their own directory.

Every difference maps to something that broke. The multi-agent split came from the Descript run. The Selection Principle came from watching the selector edit meaning. The multi-user layout came from a second user. TEACHABLE_MOMENTS came from repeated structural failures for specific people.

None of it was designed upfront. The initial single-agent design was the simplest thing that could plausibly work, and it worked well enough to surface its own failure modes. That's the useful property of using a system for real work instead of synthetic test cases: real failures are specific. A bullet selector that edits meaning doesn't fail abstractly. It makes a specific edit to a specific bullet in a specific way, and that gives you something concrete to prohibit.

You can reason from first principles about why context separation matters, why a skeptical agent shouldn't share context with the thing it's skeptical of. The reasoning is correct. But you won't write "bullets are receipts" until you've watched the agent alter a bullet and understood exactly why it happened and exactly what rule would have prevented it. The design document at the end is a record of what broke.
