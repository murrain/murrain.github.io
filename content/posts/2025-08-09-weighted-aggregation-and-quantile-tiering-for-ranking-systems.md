+++
title = "Weighted Aggregation and Quantile Tiering for Rankings"
date = 2025-08-09T09:00:00-08:00
draft = false
tags = ["ranking", "statistics", "game-design"]
author = "Patrick Smith"
original_date = "2025-08-09"
source_repo = "gridiron-dynasty"
source_commit = "cbc5eb4"
+++

Early in Gridiron Dynasty's recruiting system, a quarterback with elite arm talent and mediocre athleticism and a running back with elite athleticism and mediocre hands were coming out with the same composite score. Adjusting any single weight to fix one case broke several others. The star ratings -- the number the player actually sees -- were swinging wildly across minor tuning passes. The model wasn't wrong, but the output was chaotic in a way that made it hard to trust.

The problem was that I'd mixed two things together: how to compute a score, and how to assign a tier from that score. Both lived in the same function, and both were sensitive to the same weights. Change the athletic multiplier for quarterbacks and you'd shift the score curve, which would shift who crossed the fixed star boundaries, which would produce a completely different tier distribution even if the relative rankings hadn't meaningfully changed.

The fix was to separate these into two independent passes.

**Pass 1: composite score.** `RecruitRater` computes a weighted aggregate of position-specific core stats, secondary stats, athleticism, and mentals -- with diminishing returns via power functions so that a player who's elite in one dimension doesn't completely dominate a player who's good across all of them:

```gdscript
var ath_eff: float = pow(ath_pct, 0.90)
var core_eff: float = pow(core_pct, 0.95)
var sec_eff: float  = pow(sec_pct, 1.00)
var men_eff: float  = pow(men_pct, 0.85)

var synergy: float = sqrt(max(0.0, ath_eff * core_eff))
var comp_pct: float = (w_ath*ath_eff + w_cor*core_eff + w_sec*sec_eff + w_men*men_eff) / w_sum
comp_pct = comp_pct * (1.0 + synergy_gain * (synergy - 0.5))
```

This produces a value per player that reflects their actual quality within their position. The `synergy` term rewards players who are both athletic and technically skilled -- that combination is more than additive in football and the model should reflect it.

**Pass 2: star rating.** Once composite scores exist for the whole class, each position group gets sorted and star ratings are assigned by percentile -- not by fixed cutoffs:

```gdscript
static func _stars_from_percentile(pct: float, thresholds: Dictionary, pos: String, ...) -> int:
    if pct >= float(thresholds.get("5", 0.98)): return 5
    if pct >= float(thresholds.get("4", 0.90)): return 4
    if pct >= float(thresholds.get("3", 0.70)): return 3
    if pct >= float(thresholds.get("2", 0.40)): return 2
    if pct >= float(thresholds.get("1", 0.15)): return 1
    return 0
```

A 5-star quarterback is in the top 2% of quarterbacks in his class. A 5-star kicker is in the top 2% of kickers. The absolute composite scores differ -- kickers have lower athletic ceilings and narrower stat distributions -- but the star distribution within each position stays stable regardless of how those distributions shift when you tune the weights.

Change the athletic weight for wide receivers and the composite scores shift. The ranking order might change. But the top 2% are still 5-star and the top 30% are still 3-star-or-better. The tier structure doesn't destabilize just because the underlying scores moved.

Players can forgive a tough ranking model. They will not forgive one that feels random. The players in question are entirely fictional, which does not appear to matter.
