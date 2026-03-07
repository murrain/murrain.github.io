+++
title = "Pre-Packing Docker Images for Venues Without Internet"
date = 2025-08-21T09:00:00-08:00
draft = false
tags = ["docker", "ops", "deployment"]
author = "Patrick Smith"
original_date = "2025-08-21"
source_repo = "silentdisco"
source_commit = "3107fa2"
ogTitle = "Pre-Packing Docker Images So Venue WiFi Can't Kill the Event"
description = "Build and save Docker images at home, load from a local tar at the venue. Zero network dependency at showtime. A two-phase Makefile workflow."
+++

The original deployment for Silent Disco was standard Docker Compose: `docker compose up`, images pull from the registry if they're not cached, containers start. Reasonable when you have a reliable internet connection and time to troubleshoot. At a headphone event in a venue with spotty WiFi and a hard start time, a failed image pull means no audio and no useful error message anyone can act on.

The failure mode was specific: arrive at the venue, plug in the laptop, run `make up`, and Docker starts pulling from Docker Hub. If the venue WiFi was bad -- and it often was, because consumer-grade event WiFi at capacity is not where you want to be depending on a registry pull -- the pull would stall or fail. No good recovery path. You could wait for a pull that might not complete, or you could explain to the room why the music hadn't started. Neither got easier with experience.

The fix splits the workflow into two phases at two locations.

**At home, before the event:**

```sh
make save-cache-gz
# → docker compose build
# → docker save -o cache/silentdisco-images.tar silentdisco-web:offline silentdisco-streamer:offline
# → gzip -f cache/silentdisco-images.tar
```

Both images build against the `:offline` tag and get written to a compressed tar archive. That archive travels with the laptop.

**At the venue:**

```sh
make up-offline
# → runs scripts/offline_boot.sh
```

```sh
#!/usr/bin/env bash
set -euo pipefail

if docker image inspect silentdisco-web:offline >/dev/null 2>&1 && \
   docker image inspect silentdisco-streamer:offline >/dev/null 2>&1; then
  echo "[i] Images already present."
else
  echo "[i] Loading cached images..."
  if [[ -f "$CACHE_TARGZ" ]]; then
    gunzip -c "$CACHE_TARGZ" | docker load
  elif [[ -f "$CACHE_TAR" ]]; then
    docker load -i "$CACHE_TAR"
  else
    echo "ERROR: Cache not found"
    exit 1
  fi
fi

exec docker compose up -d --no-build
```

The script checks whether the images are already loaded. If so, it goes straight to starting containers -- re-running `make up-offline` at an event where you already ran it costs nothing. If not, it loads from the local archive. `--no-build` tells Docker Compose not to try building anything. The network state at the venue is irrelevant to whether the system starts.

The `:offline` tag is intentional. It keeps the offline workflow visually distinct from the standard one and prevents a casual `docker compose up` from accidentally starting the wrong images. The explicit naming makes it harder to end up not knowing which version is running.

The extra step at home -- build, save, transfer -- is the entire cost. A few minutes once, in an environment where you have time and a good connection. What it removes is a failure mode that can't be debugged in thirty seconds with a crowd waiting. Complexity that can live at home shouldn't travel to the venue.
