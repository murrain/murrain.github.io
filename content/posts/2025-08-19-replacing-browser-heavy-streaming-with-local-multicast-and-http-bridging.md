+++
title = "Why the LAN Audio Stream Needed a Multicast-to-HTTP Proxy"
date = 2025-08-19T09:00:00-08:00
draft = false
tags = ["networking", "audio", "streaming"]
author = "Patrick Smith"
original_date = "2025-08-19"
source_repo = "silentdisco"
source_commit = "4ce1e56"
ogTitle = "Why iOS Killed My LAN Multicast Stream (and the One-Proxy Fix)"
description = "UDP multicast gets 50ms latency for LAN audio events -- until iOS and consumer WiFi silently drop it. A udpxy proxy on the router bridges the gap."
+++

Silent Disco is a LAN audio streaming system for headphone events: one DJ, one network, fifty phones with headphones. The early version streamed through the browser using HLS. HLS works fine for internet video. For a local event with a DJ in the same room, it brought a lot of protocol surface that wasn't serving the problem -- buffering tuned for variable internet links, latency measured in seconds, infrastructure assumptions that didn't apply when everything was within ten meters.

The transport I wanted was UDP multicast. FFmpeg captures the DJ software's PulseAudio output, encodes it to AAC, and broadcasts an MPEG-TS stream to a single multicast group on the LAN. Any client that joins `239.255.0.1:1234` gets the stream. The sender doesn't know or care how many clients there are. Latency is 50--200ms. The whole thing runs without touching the internet.

```sh
exec ffmpeg -hide_banner -loglevel error \
  -f pulse -i "${PULSE_SOURCE}" \
  -c:a aac -b:a "${BITRATE}" -ar 48000 -ac 2 \
  -f mpegts "udp://${GROUP}:${PORT}?localaddr=${LOCALADDR}&ttl=1&pkt_size=1316&reuse=1&fifo_size=500000"
```

`ttl=1` keeps the packets on the local network. `pkt_size=1316` fits UDP packets inside 1500-byte Ethernet frames with room for headers -- avoiding fragmentation, which matters on busy event WiFi. `fifo_size=500000` is a 500KB write buffer to absorb jitter. These aren't defaults; they're choices made after seeing what breaks at an event with fifty devices on the same AP.

iOS does not receive UDP multicast reliably on consumer WiFi. You learn this either from reading the relevant RFC carefully or from half a room of silent phones at an event that has already started. WiFi access points suppress multicast at the wireless layer to avoid flooding every associated device with every multicast packet. iOS doesn't work around this the way desktop operating systems do -- it doesn't join multicast groups at the IP level in a way that forces the AP to forward the traffic. Desktop VLC works. Android often works. iPhones frequently don't.

The fix was `udpxy` on the router. `udpxy` is a small proxy that joins a multicast group on the wired side and re-serves the stream as individual HTTP connections. Each client connects over HTTP unicast. The router holds one multicast subscription; every client sees a normal HTTP stream and has no idea there's a multicast group involved.

The system generates two playlists at startup: `stream.m3u` pointing at `udpxy` over HTTP (the default, works on every device), and `stream-udp.m3u` pointing at the raw multicast address (for desktop clients that want to bypass the proxy). Most people get the HTTP playlist. The proxy absorbs the iOS/WiFi problem invisibly.

Half the room with no audio because iOS and consumer WiFi have a complicated relationship with multicast wasn't something I could leave unsolved. "WiFi supports multicast" is more aspiration than guarantee on consumer hardware. The right place to absorb that gap is one proxy on the router, not every client.
