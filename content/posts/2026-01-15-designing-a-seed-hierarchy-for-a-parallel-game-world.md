+++
title = "A Seed Hierarchy That Survives Thread Scheduling"
date = 2026-01-15T09:00:00-08:00
draft = false
tags = ["game-design", "concurrency", "correctness"]
author = "Patrick Smith"
original_date = "2026-01-15"
source_repo = "gridiron-dynasty"
ogTitle = "A Four-Level Seed Hierarchy for Deterministic Game Simulation"
description = "Organizing RNG seeds across 20 simulated years, 12 phases, and parallel threads so every run produces identical output. Session to year to phase to step."
+++

Gridiron Dynasty's world bootstrap simulates 20 years of player history: high school generation, college recruiting, draft classes, NFL seasons, free agency, player aging and retirement. After fixing the per-item RNG seeding, the next problem was structural: how to organize seeds across a simulation with dozens of phases, each containing multiple steps, running in parallel across 20 simulated years.

The key constraint: every seed must be a pure function of where you are in the simulation, not what's running it. The hierarchy has four levels.

**Level 1, session to year:**

```gdscript
func _resolve_year_seed(base_seed: int, year: int) -> int:
    if base_seed != 0:
        return Rand.splitmix64(base_seed ^ year)
    return Rand.splitmix64(year)
```

Each of the 20 simulated years gets an independent starting point derived from the session seed XOR'd with the year number. Changing the base seed gives you a different world. Changing the year gives you a different slice of the same world. Two distinct operations that shouldn't share state.

**Levels 2 and 3, year to phase to step:**

```gdscript
func _derive_seed(year_seed: int, phase_id: String, step_id: String) -> int:
    var key := "%s:%s" % [phase_id, step_id]
    var hash := _fnv1a_64(key)
    return Rand.splitmix64(year_seed ^ hash)
```

Each phase within a year, `hs_generation`, `college_recruiting`, `nfl_draft`, `nfl_season`, and eight others, derives its seed by hashing the phase label with FNV1a-64 and XOR-ing it with the year seed. Steps within a phase use `"phase:step"` as the key, so `"hs_generation:hs_player_gen"` and `"hs_generation:hs_background"` produce different seeds even though they share a parent. The string label is the identifier. No magic numbers to track.

FNV1a-64 instead of something fancier: it's one loop, it's fast, and it distributes strings well enough that `"nfl_draft:nfl_draft"` and `"nfl_free_agency:nfl_free_agency"` don't collide in the output space. That's all it needs to do.

Every `ThreadPool` callable receives an explicit seed and returns an explicit output dictionary. No callable reads from shared state and none writes to it. The thread pool is pure fan-out/fan-in. Thread count becomes a deployment parameter rather than an architectural constraint. The simulation produces identical output with one thread or eight. You can verify this by running the bootstrap twice with the same seed at different thread counts and diffing the outputs. They match.

The hierarchy also gives you reproducible debugging. If a player's stats look wrong in year 14, the `nfl_season` phase, you can re-run just that phase with its exact seed and inspect the output in isolation. The seed lineage is logged at each level, so you have a full chain from session seed to the specific RNG call that produced a suspicious value.
