+++
title = "Writing Code for an AI Collaborator"
date = 2026-03-30T00:00:00-08:00
draft = false
tags = ["ai", "godot", "game-dev", "architecture", "claude-code"]
author = "Patrick Smith"
original_date = "2026-03-30"
source_repo = "gridiron-dynasty"
+++

A human teammate remembers their mistakes. They don't suggest the approach that caused a regression six months ago, because they were there.

An AI assistant starts fresh every session. The code carries forward. The lessons don't. So you write them into the codebase.

A README explains what the project does. Code comments explain what the code does. Architecture docs explain why it's structured a certain way. `AGENT_GUIDELINES.md` explains what the AI assistant will do wrong.

Each entry is an observed failure: something that happened in a real session, got fixed, got written down so the next session doesn't repeat it. Not "here is good practice." Here is what you will break if I don't tell you otherwise.

## The `_optimized()` failure

When asked to "make this faster" or "add a cached version," AI assistants reliably default to parallel function variants. Ask it to speed up a function and it will hand you back the original plus a `_optimized` copy:

```gdscript
# What the AI produces without guidance:
func process_data(data: Array) -> Array: ...
func process_data_optimized(data: Array, config: Config) -> Array: ...

# What the guideline enforces:
func process_data(data: Array, config: Config = null) -> Array: ...
```

The first version creates two functions that do the same thing with different signatures. Callers have to pick which one. Some pick the old one. The two implementations drift apart. Six weeks later, someone finds a bug in `process_data` and fixes it without touching `process_data_optimized`, because they didn't know it existed.

The guideline says: extend the existing function. One entry point, optional parameters for the new behavior, old callers unaffected.

## The RNG constraint

This is the hardest one to get right because the AI cannot infer it from reading the code.

The simulation uses SplitMix64 for reproducibility. Fixed seed, identical results, every run. That guarantee requires consuming RNG calls in the same sequence every time, regardless of what else happens in the system.

Performance work added caching to the scouting system. The constraint: cache hits must consume identical RNG calls as cache misses.

Say scouting a player consumes several RNG calls to compute their attributes. First run, cache is cold: the calls happen, the RNG state advances. Second run, same seed, cache is warm: scouting hits the cache and skips the computation. Those RNG calls never happen. The state doesn't advance. Now the *next* player's attribute draw starts at the wrong position in the sequence. Different player, different attributes. The simulation is no longer deterministic across warm and cold runs.

The fix: even on a cache hit, consume the same RNG calls. Throw away the results. The cache saves computation time. The RNG state advances the same amount either way.

The test that catches this is simple:

```
assert run(seed=12345) == run(seed=12345)
```

First run populates the cache. Second run reads from it. If the outputs differ, something consumed RNG differently.

But before that test existed, the constraint didn't live in any test suite. It lived in design intent. The AI would read the caching code, see an opportunity to skip unnecessary computation, and remove the "redundant" RNG calls. Existing tests would pass, because nothing was comparing results across cache states. The bug would surface later when someone noticed that first-boot results differed from subsequent runs.

Writing this into AGENT_GUIDELINES.md is what makes the scouting system safe to collaborate on. Without it, the AI will add the cache correctly, the tests will pass, and the failure will be invisible until it isn't.

## Where the AI works best

Not everything in the codebase needs a constraint written around it. The AI is good at profiling, identifying bottlenecks, systematic application of known optimization patterns, writing test scaffolding. Tasks where the pattern is known and the job is applying it at scale.

Game mechanics, data model structure, decisions about what the simulation should actually do: those need human judgment. Letting the AI loose on the wrong problems wastes both our time.

The document grows the same way architecture docs do: something breaks, someone writes it down. The difference is that an architecture doc's lessons accumulate in the minds of the people who were there. This one accumulates in a file, because that's the only memory that carries forward between sessions. Which works, until the file gets long enough that loading it burns context before the AI has done anything. At some point, that's a problem of its own.
