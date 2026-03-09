+++
title = "Same Seed, Different Output — Then a Hierarchy to Keep It That Way"
date = 2026-01-15T09:00:00-08:00
draft = false
tags = ["concurrency", "correctness", "game-design"]
author = "Patrick Smith"
original_date = "2026-01-15"
source_repo = "gridiron-dynasty"
description = "Thread-keyed RNG broke determinism under parallelism. Item-keyed seeds with SplitMix64 fixed the local problem. A four-level seed hierarchy — session to year to phase to step — fixed the structural one."
+++

[Last week's fix](/posts/2026-01-08-parallelizing-player-generation-early/) made individual work items deterministic by keying seeds on item position instead of thread identity. But it only solved the local problem. Each call to `rng_for_index(i)` still needs a base seed, and the simulation has structure above that — 20 simulated years, 12+ phases per year, multiple steps per phase, all running in parallel. Every seed needs to be a pure function of where you are in the simulation, not what's running it. That meant building a seed hierarchy. Four levels.

The two core utilities live in `Rand.gd`:

```gdscript
const MASK_64: int = -1
const SM64_GAMMA: int = -7046029254386353131
const SM64_MUL1: int = -4658895280553007687
const SM64_MUL2: int = -7723592293110705685

static func splitmix64(x: int) -> int:
    var z := (x + SM64_GAMMA) & MASK_64
    z = (z ^ (z >> 30)) * SM64_MUL1 & MASK_64
    z = (z ^ (z >> 27)) * SM64_MUL2 & MASK_64
    return (z ^ (z >> 31)) & MASK_64

func rng_for_index(i: int, base_override: int = -1) -> RandomNumberGenerator:
    var base := _base_seed_64 if base_override == -1 else (base_override & MASK_64)
    return rng_for_seed(splitmix64(base + i))
```

Every level of the hierarchy feeds through `splitmix64`. At the top, a session seed fans out across years:

```gdscript
func _resolve_year_seed(base_seed: int, year: int) -> int:
    if base_seed != 0:
        return Rand.splitmix64(base_seed ^ year)
    return Rand.splitmix64(year)
```

Each of the 20 years gets an independent starting point — session seed XOR'd with the year number. Different base seed, different world. Different year, different slice of the same world.

Below that, each year seed fans out to phases and steps. The actual function is `_step_rng` in ClassGenerator.gd:

```gdscript
func _step_rng(seed: int, label: String) -> RandomNumberGenerator:
    var rng := RandomNumberGenerator.new()
    rng.seed = Rand.splitmix64(seed ^ _fnv1a_64(label))
    return rng

func _fnv1a_64(text: String) -> int:
    var hash: int = -3750763034362895579
    var prime: int = 1099511628211
    for b in text.to_utf8_buffer():
        hash = int(hash ^ b) & -1
        hash = int(hash * prime) & -1
    return hash
```

Each phase — `hs_generation`, `college_recruiting`, `nfl_draft`, `nfl_season`, eight others — gets its seed by hashing the label with FNV1a-64 and XOR-ing with the year seed. Steps within a phase use compound labels like `"hs_generation:hs_player_gen"`. Two steps sharing a parent produce different seeds because the labels differ. No magic numbers.

FNV1a-64 instead of something fancier: it's one loop over the UTF-8 bytes, it's fast, and it distributes strings well enough that `"nfl_draft"` and `"nfl_free_agency"` don't collide. That's all it needs to do.

That covers three levels — session, year, phase/step. The fourth is the thread boundary. Every ThreadPool callable receives an explicit seed and returns an explicit output dict. No callable reads or writes shared state. Pure fan-out/fan-in. Thread count becomes a deployment parameter — the simulation produces identical output with one thread or eight.

The hierarchy also makes debugging surgical. If a player's stats look wrong in year 14, `nfl_season` phase, I can re-run that phase with its exact seed and inspect in isolation. `SimLogger.step_seed` logs the seed at each level — year, phase, step — so the full lineage from session seed to a specific RNG call is recoverable after the fact.
