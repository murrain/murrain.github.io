+++
title = "Same Seed, Different Output: Fixing RNG Under Parallelism"
date = 2026-01-08T09:00:00-08:00
draft = false
tags = ["concurrency", "correctness", "testing"]
author = "Patrick Smith"
original_date = "2026-01-08"
source_repo = "gridiron-dynasty"
source_commit = "9279646b68"
ogTitle = "Same Seed, Different Output: Fixing RNG Under Parallelism"
description = "Thread-keyed RNG seeds look safe but produce different results every run. Switching to item-keyed seeds with SplitMix64 made the simulation deterministic again."
+++

After parallelizing Gridiron Dynasty's season simulation, I started getting different results on different runs. Same seed, same config, same code -- different draft classes, different player ratings, different outcomes. The kind of bug that makes you question everything you've done for the last two weeks.

The culprit was `RngBox.gd`, the autoload that handed out RNG instances to whatever code needed one:

```gdscript
# RngBox.gd — the old approach
var _rngs: Dictionary = {}  # { thread_id: RandomNumberGenerator }

func get_rng() -> RandomNumberGenerator:
    var tid := OS.get_thread_caller_id()
    if not _rngs.has(tid):
        var r := RandomNumberGenerator.new()
        r.randomize()  # seeded from the system clock at creation time
        _rngs[tid] = r
    return _rngs[tid]
```

The logic looks reasonable: one RNG per thread, thread-safe by design. The problem is `r.randomize()`. Each new RNG seeds from the system clock at the moment that thread first makes a request. Which thread handles which work item is up to the OS scheduler. Run the simulation twice and thread 2 might process player A one time and player C the next. The random sequence each player receives depends on OS timing, not anything in the simulation. Worst kind of non-determinism: invisible, doesn't error, only shows up when you're specifically looking for it.

The fix was to stop keying RNG instances on thread identity and start keying seeds on work-item identity. Each item in the pipeline has a position in the input array. That position is stable across runs. So the seed should derive from the position:

```gdscript
# Rand.gd — the replacement
static func splitmix64(x: int) -> int:
    var z := (x + SM64_GAMMA) & MASK_64
    z = (z ^ (z >> 30)) * SM64_MUL1 & MASK_64
    z = (z ^ (z >> 27)) * SM64_MUL2 & MASK_64
    return (z ^ (z >> 31)) & MASK_64

func rng_for_index(i: int, base_override: int = -1) -> RandomNumberGenerator:
    var base := _base_seed_64 if base_override == -1 else (base_override & MASK_64)
    return rng_for_seed(splitmix64(base + i))
```

`rng_for_index(i)` returns a deterministic RNG seeded by `SplitMix64(base + i)` -- a pure function of item position. Thread 2 processing item 7 gets the exact same RNG as thread 5 processing item 7, because the seed doesn't involve the thread at all. SplitMix64 is a 64-bit bijective mixer: fast, well-distributed, no shared state. The right tool here because it's pure arithmetic and needs no coordination between callers.

With `RngBox` the question was: "which thread am I?" With `Rand` the question is: "which item am I?" Thread identity is an execution property -- it tells you something about the runtime, not the data. Item index is a data property: stable, predictable, independent of how many cores you have.

The change also made regression testing actually work. Before, "run the simulation twice and compare" was meaningless -- the outputs were legitimately different every time. Now, identical inputs produce identical outputs regardless of thread count or scheduling order. Fix a bug in draft logic, re-run with the same seed, and any differences in the output are caused by your change -- not by the OS deciding to give thread 3 a bigger time slice this Tuesday.
