+++
title = "Waiting for the USB Sensor Before Starting the Container"
date = 2026-02-27T09:00:00-08:00
draft = false
tags = ["iot", "docker", "reliability"]
author = "Patrick Smith"
original_date = "2026-02-27"
source_repo = "weather-station"
source_commit = "7916802"
ogTitle = "A Docker Container That Looked Healthy While Doing Nothing"
description = "The weather station container started before the USB sensor was ready. Green status, zero data. A while loop and a grep fixed it."
+++

The goal here, stated plainly, is to have the actual weather outside my house displayed in my taskbar rather than the reading from an airport five miles away. The engineering surface required to achieve this has, at no point, caused me to reconsider the goal.

The weather station runs in Docker on a home server. After a host reboot, the container would sometimes start before the USB RTL-SDR sensor was ready. The process showed healthy. No data came in. No error. `docker ps` said running. The sensor just wasn't there yet, and the entrypoint had assumed it would be.

The original `startup.sh` was optimistic -- install packages, configure the environment, start the process:

```sh
#!/bin/sh
apk add --no-cache --update tzdata rtl_433 libusb

cp "/usr/share/zoneinfo/${TZ}" /etc/localtime
echo "${TZ}" > /etc/timezone

echo 'blacklist dvb_usb_rtl28xxu' > /etc/modprobe.d/blacklist-rtl.conf

chmod +x /weather-station/entrypoint.sh /weather-station/tail_csv.sh
exec /weather-station/entrypoint.sh
```

Nothing in there asks whether the hardware exists. It installs, configures, and launches. If the USB device isn't enumerated yet -- which happens reliably after a cold boot -- the process starts anyway, finds nothing, and sits there producing nothing. Green status. Zero data.

The fix was a polling loop before launch:

```sh
#!/bin/sh
set -eu

apk add --no-cache --update tzdata rtl_433 libusb usbutils

echo "Waiting for RTL2838 device (0bda:2838)..."
while true; do
    if lsusb | grep -q "0bda:2838"; then
        echo "RTL device detected."
        break
    fi
    sleep 2
done

chmod +x /weather-station/entrypoint.sh /weather-station/tail_csv.sh
exec /weather-station/entrypoint.sh
```

`lsusb | grep -q "0bda:2838"` checks for the specific USB vendor/product ID of the RTL2838 dongle. The loop runs every two seconds until it finds it, then hands off to the actual entrypoint. `usbutils` gets added to the install step because `lsusb` lives there. `set -eu` at the top means any failure in the startup sequence stops the script rather than silently continuing -- the other half of "optimistic startup" worth fixing at the same time.

The loop adds a few seconds of startup time after a reboot. That's the entire cost. What it removes is a recurring failure mode where the container appeared healthy while the thing it existed to do wasn't happening. Debugging that by looking at `docker ps` got you nowhere. You had to know to look at the ingest logs, know that silence wasn't normal, and connect that to boot ordering. A while loop and a grep replace all of that knowledge.
