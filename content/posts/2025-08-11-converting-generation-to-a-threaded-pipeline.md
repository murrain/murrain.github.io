+++
title = "Threading Gridiron Dynasty's 20-Year World Bootstrap"
date = 2025-08-11T09:00:00-08:00
draft = false
tags = ["concurrency", "performance"]
author = "Patrick Smith"
original_date = "2025-08-11"
source_repo = "gridiron-dynasty"
source_commit = "505bbddfb0"
ogTitle = "Parallelizing a 20-Year World Bootstrap in Godot with a Thread Pool"
description = "A fan-out/fan-in thread pool for Godot that cut world generation time, but the real win was the purity audit it forced on every mutation path."
+++

Gridiron Dynasty's world bootstrap simulates 20 years of player history before a user ever sees a game. High school classes, college recruiting, draft classes, NFL seasons, free agency, player lifecycle progression. All of it runs serially, year by year, phase by phase, player by player. On a 2025 machine, generating a full world was taking long enough that I'd started avoiding it during development. That's the sign that performance has crossed from "not ideal" to "actually in the way."

The fix was a fan-out/fan-in thread pool: split the input array across N workers, run the callable in parallel, collect results in input order. The API ended up simple enough to use in one line:

```gdscript
var results := ThreadPool.map(players, func(p): return rate_player(p), threads)
```

The implementation is straightforward: chunk the input, enqueue slices, wait on a semaphore per chunk, write results back at the correct offset so output order matches input order regardless of which worker finished first:

```gdscript
static func map(items: Array, callable: Callable, threads: int) -> Array:
    if items.is_empty():
        return []
    var chunks := _chunk(items, min(threads, items.size()))
    var out: Array = []
    out.resize(items.size())
    var done := Semaphore.new()
    var pool := _get_pool(min(threads, chunks.size()))
    var offset := 0
    for chunk in chunks:
        pool.enqueue(callable, chunk, out, offset, done)
        offset += chunk.size()
    for i in range(chunks.size()):
        done.wait()
    return out
```

The order-preservation matters: downstream code assumes players are in the same sequence they went in. Without explicit offset tracking and writing results by index rather than by arrival, you'd get a race between chunks finishing and one fast chunk silently overwriting another's results.

Turning on threads took an afternoon. The harder work was the prerequisite: making each callable genuinely pure. No writes to shared autoloads. No global state mutations as side effects. Explicit inputs in, explicit outputs out, per item.

That requirement forced an audit of every mutation path in the generation pipeline. Some of what turned up was obvious: player counts that could just become return values. Some was less obvious: rating functions that wrote to a shared stats dictionary as a side effect of doing their actual job, aggregate values accumulated by whatever code happened to touch them last rather than by anything specifically responsible for computing them. All of it had to become explicit return values of each stage. The caller collects the outputs and merges them after all workers finish. That's more code at the call site, but it's honest code: the data flow is visible rather than hidden inside side effects.

Two things came out of that audit. First, the generation pipeline got cleaner. When you're forced to name every output, you start noticing which outputs you were generating just because the code happened to pass through a shared place, not because anything actually needed them. Second, most of the latency wasn't in the computation itself. It was in the contention: functions grabbing and releasing shared dictionaries, writing intermediate values that nothing was reading yet, doing work whose only purpose was to update a counter that could have been computed at the end.

Parallelism only runs cleanly when stages produce values rather than mutate globals, and that constraint has a way of exposing the same problems that were making the pipeline slow in the first place.
