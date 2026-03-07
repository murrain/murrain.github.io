+++
title = "Define What Each Agent Must Not Think"
date = 2026-02-10T09:00:00-08:00
draft = false
tags = ["ai", "architecture", "agents"]
author = "Patrick Smith"
original_date = "2026-02-10"
ogTitle = "Define What Each Agent Must Not Think"
description = "Splitting AI agents by cognitive mode: fidelity, voice, compression, skepticism. Not by task. Why shared context kills verification."
+++

The first version of my document assembly pipeline used a single agent to select bullets, write the profile, draft the cover letter, and check everything for accuracy. The output was technically complete and thoroughly mediocre. The bullet selector would occasionally improve phrasing where it should have been picking verbatim. The writer would cite metrics where it should have been finding a voice. The verifier, running in the same context that produced the content, would nod along at things it should have caught. None of them was bad at its job. They just kept doing each other's.

The problem wasn't capability. It was cognitive mode. Selecting bullets is a fidelity task: you pick or you omit, you never edit meaning. Writing a cover letter is a voice task: warmth and specificity, not fidelity. A two-sentence profile is a compression task: nothing that doesn't earn its word count. Verification is a skepticism task: actively hunting for claims that are unsupported, inconsistent, or overstated. These modes are genuinely incompatible. A context in fidelity mode will underserve the voice task. A context in voice mode will embellish where it shouldn't. Force them together and you get the mediocre middle.

## Why adding more agents doesn't fix it

When you first hit this, the temptation is to add agents. More agents, more specialization, better output. This is wrong. Adding agents without defining their modes just spreads the same dysfunction across more API calls.

I went through a phase where the pipeline had seven agents and was performing worse than three. I'd split the work without splitting the modes. The bullet selector and profile writer were running in sequence, and the writer was "inheriting" the selector's framing. I thought they were isolated because they were separate API calls. They weren't. I was manually forwarding the selector's reasoning into the writer's context as "background." The verifier was getting the full chain of outputs and nodding along more confidently than a single agent would have, because by that point the chain was so long and internally consistent that nothing looked wrong.

What finally worked was defining the mode before designing the agent. Not "I need a verifier" but "I need a context that has never seen the reasoning that produced these claims, and whose only job is to find things to reject." The agent follows from the mode definition. If you can't articulate what kind of thinking is *prohibited* inside a given boundary, you don't have a mode. You have a label.

## Making prohibitions explicit

The resume pipeline now has five agents with explicit mode names written into their system prompts: ONBOARDING, CURATION, CREATIVE WRITING, CONSTRAINED CREATION, and VERIFICATION. Each mode definition includes not just what the agent does, but what it is explicitly forbidden to do.

The clearest example is the curator, running in CURATION mode. Its central rule: **bullets are receipts**. They document what happened. They cannot be altered in meaning, scope, tools, or metrics. The curator selects from source data, or it omits. It does not improve phrasing. It does not add warmth. It does not adjust a metric to sound better. Minor syntactic edits, verb tense, combining two closely related bullets, are permitted only by designated agents with full audit trails. Everything else is prohibited.

That prohibition sounds obvious stated plainly. Before I wrote it down, the curator was routinely violating it because nothing in its context told it not to. It was trying to be helpful. The mode definition is what converts "trying to be helpful" into "staying in its lane."

The profile writer runs in CONSTRAINED CREATION mode: two to three sentences, under seventy-five words, no tools mentioned, no metrics cited. The cover letter writer runs in CREATIVE WRITING mode: warmth, specificity, company research, original voice. The review team runs in VERIFICATION mode: distrust everything the other agents produced, find things to reject. These modes cannot coexist in a single context. A context generating warm prose is not simultaneously a good skeptic of that prose.

## The context window is not a neutral observer

There's a mechanical reason for all of this too.

A context window is not a passive transcript. It is an active constraint on what the model attends to and how it weighs evidence.

Every token a model generates increases the probability it will generate tokens consistent with what it already said. This is not a bug. It is the core mechanism of autoregressive generation. But it means a model asked to evaluate its own outputs at the end of a long context isn't evaluating from a neutral position. It is inside a gravity well of its own prior outputs. The longer the generation chain, the stronger the pull toward consistency over correctness.

I ran the same verifier prompt against the same outputs in two configurations: one with the full generation context, one with only the structured output. No reasoning, no intermediate steps, just the claims. The context-clean verifier caught roughly three times as many issues. Same model. Same capability. The context was doing most of the work, and in the shared-context case it was doing the wrong work: building a case for why everything was fine.

This changes what context window budget actually means. A shared context is not free. Every intermediate reasoning step you carry forward is bias you are paying for in tokens. Trimming context is not just a cost optimization. It is a correctness optimization. The cleaner the input to a given agent, the more attention it can spend on the actual task instead of reconciling everything that came before.

Current LLMs have no way to selectively forget. Everything in the context window is live and attending. Multi-agent architecture can partially work around this, not by making the model smarter, but by controlling what each agent is allowed to see.

## Scaling up: the Gridiron Dynasty hierarchy

The same problem shows up at larger scale when multiple agents are working on the same codebase concurrently. Gridiron Dynasty's development pipeline has five distinct roles: Director, Architect, Engineer, Test Engineer, and Reviewer. Each with explicit mode definitions and explicit prohibitions.

The Architect designs systems and decomposes work. It does not implement UI, does not add features without lifecycle consideration, and does not claim completion without a quality score above 9.5 out of 10. The Engineer implements per-Architect specification. It does not make architectural decisions, does not bypass determinism constraints, and does not skip the four-layer testing protocol. The Reviewer audits completed work. It does not implement anything. Its only output is an assessment, and it is specifically instructed to distrust everything the Engineer produced.

That 9.5/10 threshold is not arbitrary. Reviewer agents drift. A reviewer that has been running in the same pipeline context for a while, seeing mostly passing output, starts approving things it should question. The hard threshold is a mode-enforcement mechanism: structural pressure on the Reviewer to stay skeptical rather than converging toward agreement with the engineers.

The simulation pipeline follows the same pattern. `AdvanceWorldYear` fans out to twelve named phase handlers:

```gdscript
func _phase_handlers() -> Dictionary:
    return {
        "hs_generation":      Callable(self, "_handle_hs_generation"),
        "hs_assignment":      Callable(self, "_handle_hs_assignment"),
        "hs_season":          Callable(self, "_handle_hs_season"),
        "college_recruiting": Callable(self, "_handle_college_recruiting"),
        "college_season":     Callable(self, "_handle_college_season"),
        "nfl_draft":          Callable(self, "_handle_nfl_draft"),
        "nfl_free_agency":    Callable(self, "_handle_nfl_free_agency"),
        "nfl_season":         Callable(self, "_handle_nfl_season"),
        # ...
    }
```

Each handler receives an explicit year seed and a snapshot of world state, and returns an explicit output dictionary. No handler queries shared state mid-execution. No handler knows what another handler is doing. The pipeline coordinator merges outputs after each phase completes.

## Physical context isolation

The Gridiron Dynasty agent architecture takes this one step further: parallel engineers work in separate git checkouts on separate branches, outside the main repository entirely. Each workspace is an independent clone. No engineer touches another engineer's directory. The Architect owns the integration branch. File ownership is assigned before implementation begins, so two engineers never work on the same file simultaneously.

This is the physical-layer version of the same principle. Shared state is a side channel. Whether that shared state is a context window full of prior reasoning or a git working directory two agents can both write to, the result is the same: outputs that look plausible in isolation and compound into errors in aggregate. The fix in both cases is to define the boundary explicitly, eliminate the side channel, and merge only structured outputs through a designated integration point.

## The real cost of orchestration

Mode separation is not free. The architectural pitch glosses over this.

Writing I/O contracts between agents is actual work. Each handoff requires deciding exactly what structured data passes from one mode to the next: which fields, which formats, what gets excluded. Get this wrong and you are either leaking reasoning you did not intend to carry forward, or starving a downstream agent of context it actually needs. The contracts are where most of the design thinking lives, and they are completely invisible in diagrams that just show boxes and arrows.

Debugging is harder. A single-agent failure is usually obvious. The output is wrong and you can read the reasoning. A multi-agent failure might be correct at every individual step and wrong in aggregate. I have had pipelines where each agent's output looked completely reasonable in isolation and the final result was still wrong because a mode boundary was subtly permeable. Tracing that requires logging every agent's input and output explicitly, which you have to build yourself.

Agents drift from their modes. A verifier that has been running in the same pipeline for a while will start finding fewer issues not because the content is better, but because the prompt has been gradually tuned toward the outputs it already approved. Mode definitions need active maintenance. The skeptic needs to stay skeptical.

The overhead is real, worth it, and not zero. Pretending otherwise leads to pipelines that are architecturally correct and operationally fragile.

## What this means in practice

The right question when designing a multi-agent pipeline is not "how many agents do I need?" It is "how many distinct cognitive modes does this task require, and which of those modes are incompatible?" The agent count follows from the answer to the second question. One agent per mode, not one agent per task.

Capability decomposition, giving each agent a specialty, is the easy part. It's what most architectural diagrams show. Mode decomposition, defining what kind of thinking is permitted inside each boundary, writing down the prohibitions explicitly, and structuring inputs so prohibited modes cannot bleed in through context, is the decision that determines whether a multi-agent system earns its overhead or just adds indirection.

An agent that selects and writes is not twice as useful. It is half as reliable at both. And an agent that writes and then verifies its own writing is not verifying. It is rationalizing, with a full context window of reasons to agree with itself.
