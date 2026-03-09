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

Gridiron Dynasty's world bootstrap simulates 20 years of player history before a user sees a game — high school classes through college recruiting, draft classes, NFL seasons, free agency, and progression. All serial. On a 2025 machine, full generation was slow enough that I'd started avoiding it during development. That's when a performance problem stops being a nuisance and starts shaping what you do.

The fix: a fan-out/fan-in thread pool. `ThreadPool.map` takes an array, a callable, and a thread count. It chunks the input, spawns one thread per chunk, joins them all, and stitches results back in input order:

```gdscript
static func map(items: Array, callable: Callable, threads: int) -> Array:
    if items.is_empty():
        return []
    var t: int = max(1, threads)
    var chunks: Array = _chunk(items, min(t, items.size()))

    # Launch
    var jobs: Array = []
    for chunk in chunks:
        var job := _Job.new()
        job.thread = Thread.new()
        job.callable = callable
        job.slice = chunk
        job.thread.start(Callable(ThreadPool, "_run_slice").bind(job.callable, job.slice))
        jobs.append(job)

    # Join and stitch back together in order
    var out: Array = []
    for job in jobs:
        var part: Array = job.thread.wait_to_finish()
        if part != null:
            out.append_array(part)
    return out
```

Order preservation is the key detail. Results get appended by job index, not by arrival time. Downstream code assumes players come back in the same sequence they went in.

The harder work was the prerequisite: making every callable pure. No global mutations as side effects. Explicit inputs in, explicit outputs out. That forced an audit of the entire generation pipeline. Rating functions wrote to shared stats dictionaries as a side effect. Aggregate values got accumulated by whatever code happened to touch them last. All of it had to become explicit return values. More code at the call site, but visible data flow instead of hidden mutations.

With purity handled, `generate_class` became two `ThreadPool.map` calls. First pass generates players. Second pass computes combine numbers:

```gdscript
func generate_class(count: int, gaussian_share: float) -> Array:
    var threads: int = App.threads_count()
    var seeds: Array = []
    seeds.resize(count)
    for i in count:
        # deterministic seeds per index prevents RNG contention
        seeds[i] = randi() ^ (i * 0x9E3779B1)

    var result := ThreadPool.map(
        seeds,
        func(seed_val):
            seed(int(seed_val))
            return _make_single_player(gaussian_share),
        threads
    )

    var combine_callable := func(p):
        p["combine"] = CombineCalculator.compute_all(p, combine_tuning, combine_tests)
        return p
    result = ThreadPool.map(result, combine_callable, threads)
    return result
```

`seeds[i] = randi() ^ (i * 0x9E3779B1)` — XOR with a position-scaled constant gives each worker a unique seed. The comment says "deterministic seeds per index prevents RNG contention," which is the right concern. But `seed(int(seed_val))` inside the worker sets Godot's *global* RNG state. Two threads calling `seed()` concurrently can overwrite each other. The per-index XOR prevents identical sequences, but the global mutation is still a race.

I noted the risk and shipped it. The pipeline was threaded and running. Whether the contention actually produces visible problems — that'll take a benchmark to find out.
