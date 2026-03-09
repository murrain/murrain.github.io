+++
title = "A 2.26x Speedup and Why That's Fine"
date = 2026-01-08T09:00:00-08:00
draft = false
tags = ["concurrency", "performance", "godot"]
author = "Patrick Smith"
original_date = "2026-01-08"
source_repo = "gridiron-dynasty"
description = "Parallelizing Gridiron Dynasty's player generation cut bootstrap time from 2.4s to 1.05s. The speedup is modest. The timing was right."
+++

Player generation has been [running threaded since August](/posts/2025-08-11-converting-generation-to-a-threaded-pipeline/). The pipeline fans out per-player work across a thread pool, fans back in when everyone's done. It's been stable for months. Time to find out if it's actually fast.

I wrote `player_generation_bench.gd` to validate the decision. It generates a class of 10,000 players, rates each one with `RecruitRater`, then runs 250 through scout scoring. Three trials, averaged, with a warmup pass first. My desktop is a Ryzen 5 7600X: 6 physical cores, 12 logical threads, capped at 8 for the benchmark.

```
class_size=10000  trials=3  include_rating=true  include_scouts=true
CPU cores=12  max_threads(used)=8

Results (avg over 3 trials):
 - 1 thread:    2382.00 ms  |  4198.2 players/sec
 - 8 threads:   1054.33 ms  |  9484.7 players/sec
 - Speedup: ×2.26
```

2.26x on 8 threads. Not close to 8x. Scout scoring is the most parallelizable phase, but it only runs on 250 of 10,000 players. The bulk of the work — class generation, attribute assignment, rating — is serial or near-serial. The 7600X also has 6 physical cores behind those 12 logical threads, so 8 workers are competing for real hardware.

2.4 seconds down to 1.05 seconds is still a real difference when someone is waiting for their game world to exist.

But ×2.26 on 8 threads leaves headroom unaccounted for. Core count and workload shape explain some of it. Part of it was a race condition in the RNG.

The August code tried to give each thread a deterministic seed:

```gdscript
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
```

The comment says "prevents RNG contention." The concern was right, but `seed()` is Godot's global state setter — it sets the RNG seed for the entire engine. Thread A calls `seed(42)`, Thread B calls `seed(99)` before Thread A's next `randi()` fires. Thread A generates a player using Thread B's seed. No errors, no crashes. Just wrong outputs, invisible unless you're checking reproducibility.

The fix creates a local `RandomNumberGenerator` per work item:

```gdscript
var result := ThreadPool.map(
    seeds,
    func(seed_val):
        var rng := RandomNumberGenerator.new()
        rng.seed = int(seed_val)
        var player := _make_single_player(gaussian_share, rng)
        var combine_rng := RandomNumberGenerator.new()
        combine_rng.seed = int(seed_val) ^ 0x85EBCA6B
        player["combine"] = CombineCalculator.compute_all(
            player, combine_tuning, combine_tests, combine_rng
        )
        return player,
    threads
)
```

Every function that used to call `randi()` or `randf()` — `NamesHelper.random_full`, `PositionHelper.pick_position`, `PhysicalsHelper.roll_for_position`, `StatsHelper.roll_all` — now takes an explicit `rng` parameter instead. Same seed in, same player out, regardless of which thread picks up the work.

The combine step fuses into the same pass too. Old version ran two `ThreadPool.map` calls; now it's one, with a second RNG per item derived from the same seed XOR'd with `0x85EBCA6B`.

The remaining speedup gap isn't fully explained yet. Profiler is the next step.
