+++
title = "Getting Fifty Phones on a LAN Audio Stream Without Help"
date = 2025-08-22T09:00:00-08:00
draft = false
tags = ["networking", "audio", "ux"]
author = "Patrick Smith"
original_date = "2025-08-22"
source_repo = "silentdisco"
ogTitle = "Getting 50 Phones on a LAN Audio Stream Without Tech Support"
description = "A DNS trick, a QR code, and a user-agent redirect that routes media players to the stream and browsers to the instructions page. Same URL, both paths."
+++

Getting the stream working was step one. Getting fifty non-technical people onto it, at an event, on their own phones, with no one standing there to help, was a different problem.

The naive version of "tell people how to connect" involves handing someone an IP address and asking them to open a network stream in VLC. This works on exactly the people who would have figured it out without your help. Everyone else either can't find the setting, types the IP wrong, or asks you to do it for them. At scale that's not a UX problem, it's a staffing problem.

The onboarding layer handles it at several levels. The router runs a DNS override mapping `dj.dance` to the DJ laptop's LAN IP. Instead of `192.168.1.42`, attendees see a name they can remember and type. The QR code generated at container startup points to the playlist URL directly. Scan it and the stream opens. No IP, no address bar.

The landing page detects the client's device via user agent and shows the right thing. iOS gets VLC and nPlayer links with the specific tap sequence for opening a network stream. Android gets its own set. Desktop gets mpv and VLC. No version of the page gives iOS users Android instructions.

The more interesting case is someone who already has VLC installed. They shouldn't have to see the instructions page at all. They should be able to type `dj.dance` into VLC's "Open Network Stream" dialog and have it work. The lighttpd config handles this by inspecting the user agent on every request to `/`:

```
$HTTP["useragent"] =~ "(VLC|libvlc|mpv|Kodi|MXPlayer|nPlayer|OPlayer|Infuse|BSPlayer)" {
  url.redirect = ( "^/$" => "/stream.m3u" )
}
```

VLC, mpv, and a handful of other players send recognizable user agents. If the server sees one of those hitting the root path, it skips the HTML page and 302s directly to `stream.m3u`. The player gets the playlist, starts buffering, plays audio. A browser gets the onboarding page. The same URL serves both paths, with no action required from the user beyond opening it in their player of choice.

The `/stream` shortcut redirects to `/stream.m3u` as well, so both `dj.dance/stream` and `dj.dance` work as network stream URLs for people who prefer typing to QR codes.

The system is finished when the non-technical user path requires no interpretation.
