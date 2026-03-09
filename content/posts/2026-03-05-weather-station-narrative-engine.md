+++
title = "Teaching a Weather Dashboard to Describe the Air"
date = 2026-03-05T09:00:00-08:00
draft = false
tags = ["weather-station", "javascript", "ux"]
author = "Patrick Smith"
original_date = "2026-03-05"
source_repo = "weather-station"
ogTitle = "Teaching a Weather Dashboard to Describe the Air"
description = "The weather station dashboard had the numbers right. It still felt like reading a meter. So I built a narrative engine that describes what it's like to stand outside."
+++

The dashboard had correct numbers. Temperature, humidity, wind speed and direction, sky condition. All accurate, all updating. It still felt like reading a meter. The question the page needed to answer wasn't "what are the conditions." It was "what does it feel like to stand outside right now." That's not a number.

So I built a narrative engine. It reads the same sensor data the dashboard already displays and assembles a short paragraph describing the moment. Here's what it produced last night at dusk, partly cloudy, light wind, mild temperature:

> The light is doing that thing it does at dusk, clouds drifting through like they have somewhere else to be eventually — this is the weather that makes you feel like you've won something small but real. There's the gentlest wind from the north-northwest — more suggestion than presence. Humidity is low enough to be kind, high enough to not be arid. A walk would feel almost effortless out here, the air doing half the work.

That's the `pleasantWalk` arc. One of nine the engine can select. The trick is getting from raw numbers to prose without writing a thousand if-statements. The engine maps conditions into bands (`tempBand`, `humidityBand`, `windBand`, `skyCondition`, `timeBand`, `season`, `moonPhase`) and from those picks a dominant arc: `snowScene`, `fogScene`, `rainLead`, `windLead`, `clearNight`, `extremeCold`, `extremeHeat`, `pleasantWalk`, `seasonalMoment`.

Each arc assembles 2–4 sentences from vocabulary pools grouped by scene element: air, wind, clouds. Pools within an arc share a subject, so assembled sentences read as continuous prose.

The RNG is seeded from `tempC + humidity + date + counter`, run through FNV hash into Mulberry32. Same conditions produce the same narrative. Different conditions produce a different one.

## Stability

Sensor data jitters. Temperature wanders by fractions of a degree. Humidity ticks up and down. If the narrative regenerated on every reading, the page would chatter: a new paragraph every few seconds saying roughly the same thing slightly differently. That's worse than a meter.

Two mechanisms prevent it. Band boundaries have hysteresis: ±0.3°C on temperature, ±2% on humidity. A reading has to cross the boundary by that margin before the band shifts. A hold timer locks the narrative for 5–30 minutes after generation. The narrative only regenerates when a band actually changes, wind shifts, sky condition updates, or precipitation probability crosses 40%.

The seeded RNG creates a second problem: identical conditions produce identical output. Fine across days, boring within a single afternoon. So the engine tracks the last 12 phrases selected from each vocabulary pool per day and excludes them from the next draw. Same conditions at 2 PM and 4 PM still produce different sentences, drawn from the same pool.

That handles changing conditions and repeating conditions. But what about no conditions at all? When the sensors go stale (no fresh reading for 90 minutes), the engine stops narrating conditions it can't verify:

> Step outside and the air feels uncertain, like a paused conversation. The latest signals are old enough that the moment may have shifted. The weather is still listening, and we are listening with it.

A dashboard that confidently displays stale data is lying to you. This one admits when it doesn't know.

## File split

Vocabulary lives in `weather-narrative-config.js` (arc templates, phrase pools, scene groupings). Engine logic (band classification, arc selection, phrase assembly, hold timer, hysteresis) lives in `weather-narrative.js`. Editing the words doesn't touch the engine. Adding a new arc means adding a template to the config and a selection condition to the engine.

The separation matters because vocabulary is the part that gets iterated on. I've rewritten phrase pools a dozen times. The engine hasn't changed since the hold timer went in.
