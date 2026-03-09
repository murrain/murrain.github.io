+++
title = "From CSV Tailing to a Local Weather API"
date = 2026-03-01T09:00:00-08:00
draft = false
tags = ["docker", "truenas", "sqlite", "weather-station"]
author = "Patrick Smith"
original_date = "2026-03-01"
source_repo = "weather-station"
ogTitle = "From CSV Tailing to a Local Weather API"
description = "TrueNAS SCALE killed FreeBSD jails. The Docker migration was boring, but it made the CSV-as-database problem worth fixing."
+++

TrueNAS SCALE replaced FreeBSD with Linux. FreeBSD jails still technically worked, but the writing was on the wall: first-class support was Docker now, and jails were getting the slow fade. The weather station moved to a container. Maintenance with a deadline.

## Docker and USB

The Dockerfile is `python:3.9-alpine` with `rtl_433` and `libusb`. Nothing worth showing. The interesting part was USB passthrough.

The RTL-SDR dongle needs to be visible inside the container. TrueNAS runs app containers as uid/gid 568, and if you don't match that, the device node shows up in `/dev` but reads fail silently. The compose file:

```yaml
devices:
  - /dev/bus/usb:/dev/bus/usb
environment:
  - PUID=568
  - PGID=568
```

The device has to be present when the container starts. Hot-plug doesn't work. The device node that Docker mounted at startup is the one you get. [The polling loop from the previous post](/posts/2026-02-27-hardening-usb-sensor-startup-and-runtime-supervision/) handles the "device not ready yet" case. The "device was never plugged in" case is your problem.

## Replacing CSV-as-Database

`rtl_433` writes CSV. That's what it does, and I'm not fighting it. But the old architecture used the CSV file directly as the data store. Want the last hour of temperatures? Scan the file. Want the current reading? Scan the file. The file only grows.

`data_writer.py` sits between the CSV and SQLite. It tails the CSV by tracking inode and byte offset, persisted in `csv_watcher_state.json`:

```json
{"inode": 12345, "offset": 204800}
```

On startup, it stats the file. If the inode changed, `rtl_433` rotated the CSV. Reset the offset to zero and start reading from the top.

```python
if saved_state["inode"] != current_inode:
    offset = 0  # file was rotated
```

The reader stops at any line without a trailing `\n`. `rtl_433` doesn't write atomically; it can flush mid-line. Reading a partial line means inserting garbage into SQLite or crashing on a parse error. Stopping early and picking up the rest on the next pass costs nothing. `INSERT OR IGNORE` handles the duplicate packets that `rtl_433` occasionally sends. Two defense mechanisms, both cheap, both from actual failures.

That covers the write path. The read path is separate. SQLite handles historical queries, but for current conditions the API doesn't touch the database at all. A background loop runs every 20 seconds, reads the latest row, and writes `current.json`. The write is atomic:

```python
os.replace(tmp_path, CURRENT_JSON)
```

`os.replace()` is a rename, which is atomic on POSIX. The API server never reads a half-written file. The hot path is a file read.

## The API

The endpoint is `/data/3.0/onecall` on port 8002. The response shape matches the OpenWeatherMap OneCall format, not because I love their API, but because the [KDE widget](/posts/2026-02-28-building-a-kde-plasma-widget-for-local-and-remote-weather-sources/) already had a parser for it.

Current conditions come from the sensor: temperature, humidity. NWS fills in wind speed, barometric pressure, sky condition, and the hourly and daily forecasts. Everything else (dew point, feels-like, moon phase, sunrise) is calculated locally from the Magnus formula and standard meteorological thresholds. No external API calls beyond NWS.

That's the whole point of matching the OWM response shape: the widget pointed at `localhost:8002` and worked without modification.
