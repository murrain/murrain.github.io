+++
title = "The Smallest Honest Fix for APoE Hotkeys on KDE Wayland"
date = 2026-03-09T00:00:00-08:00
draft = true
tags = ["wayland", "electron", "rust", "kde", "linux"]
author = "Patrick Smith"
+++

Awakened-PoE-Trade runs under XWayland. Its hotkeys don't work on KDE Wayland. The obvious fixes -- make Electron more Wayland-native, use a desktop automation daemon, build a generic IPC layer -- all turned out to be either impossible, brittle, or much larger than the actual problem. The real solution was to stop asking the X11 app to grow a Wayland conscience, build a tiny Rust helper that registers shortcuts natively on KDE Wayland, and connect the two with the smallest possible seam. The result is boring on purpose.

---

**Core tension:** shortcut registration is a Wayland-native privilege. The compositor hands it to Wayland-native processes. XWayland apps don't get it. APoE runs under XWayland — but that's currently a forced quirk, not a permanent constraint. The goal is to let PoE run natively on Wayland; the XWayland mode exists only as a workaround until the helper is in place.

**Architecture:** APoE gets a small Unix socket command ingress. Existing shortcut-to-action code gets refactored into a shared execution path. A small Rust binary registers shortcuts via the XDG Desktop Portal global shortcuts API. When a shortcut fires, it sends a small JSON command over the socket. One-way. No response. No sync. No framework.

**The `copy-item` problem:** most actions (overlay toggle, stash search, widget triggers) are portal-native and unprivileged. The exception is `copy-item` — price check, map check, and related workflows that require PoE to copy item text to the clipboard. That requires synthesizing the copy keypress into the game. When PoE runs under XWayland, X11 XTEST can do this without privilege. When PoE runs natively on Wayland (the actual goal), XTEST can't touch it. This is where `input` group / uinput / evdev pressure comes from.

**Portal-native path for copy injection:** `org.freedesktop.portal.RemoteDesktop` allows keyboard event injection globally — no `input` group, just a one-time portal permission dialog. Helper starts a RemoteDesktop session requesting keyboard device access, user approves once. When a copy-item shortcut fires: PoE is already focused (user was playing), helper injects Ctrl+C via RemoteDesktop portal, PoE copies item text, APoE reads clipboard. Needs a proof-of-concept to confirm KDE's RemoteDesktop portal implementation is solid enough before committing this as the design.

**Key rejected alternatives:** Electron's own Wayland shortcut path (app runs through XWayland, portal path not available), raw D-Bus kglobalaccel (fragile, underdocumented), telling users to configure KDE shortcuts manually (user-hostile), evdev/ydotool/uinput (requires `input` group or udev rule — wrong tradeoff for a user-facing tool), XTEST within XWayland (only works while PoE is forced XWayland, not the end state).

**Key insight:** Wayland made explicit the boundary X11 left fuzzy. Stop fighting it. Shortcut registration belongs to the Wayland-native side. App behavior belongs to the app. Connect them with the smallest seam that works.

**UX requirement shaped the design:** normal users need "install, launch, works." That means deterministic socket path, shipped default config, optional power-user edits, maybe autostart. Every knob is a support ticket. Every missing default is a user who can't figure out why nothing fires.

**Why boring was the win:** the helper reads config, registers shortcuts, forwards commands. That's it. No reverse channel, no exposed server, no bridge platform. Small because the job is small.

**Note to self:** once the actual code is written, reference concrete details -- the socket path, the config format, the portal API call, the action execution path inside APoE. The draft should feel anchored to real implementation, not the abstract shape of it.
