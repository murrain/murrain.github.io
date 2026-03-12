+++
title = "When the Overlay Is Visible but Unclickable: Fixing Price Check on Linux"
date = 2026-03-11T00:00:00-08:00
draft = false
tags = ["x11", "electron", "linux"]
author = "Patrick Smith"
+++

On a single monitor, price check works fine. On multimonitor Linux, the price-check window appears exactly where it should, but clicks land like the clickable region is somewhere else entirely. The window was where I could see it. X11 thought something was clickable. Chromium thought something else.

The price-check window needs a position in desktop coordinates. The old code derived it from `window.screenX`, Chromium's idea of where its own window sits on screen. For normal windows this works. Override-redirect windows are not normal windows. X11 doesn't manage their position the same way, and Chromium returns `screenX = 0` regardless of where the overlay actually sits in the virtual desktop.

Single monitor: 0 is correct. Secondary monitor to the left: 0 is wrong by the entire width of that monitor.

CSS layout doesn't care. It's relative to the viewport, so widgets render in the right place. The breakage shows up in the IPC message sent to the main process, where the clickable track-area rectangle ends up displaced from the visible widget. `uiohook-napi` reports physical virtual-desktop coordinates. Cursor on the primary monitor at position 2400, it says `x=2400`. The renderer says "I'm at `x=0`" and computes the clickable area from there. The main process compares 2400 against a rectangle starting at 0. Never matches.

`electron-overlay-window` already tracks the game window on Linux using XCB. It already calls `xcb_translate_coordinates()` and `xcb_get_geometry()` to get the game window's position in the X11 virtual desktop. It already had the authoritative coordinates. Nobody was reading them. The fix was to expose them and use them instead of asking Chromium for the part of reality it doesn't own.

The library's `OW_ATTACH` and `OW_MOVERESIZE` events already carried physical-pixel bounds from the native bridge. The TypeScript side stored them as `OverlayController.targetBounds`. The fix formalized the contract: these are integer X11 virtual-desktop coordinates, not CSS/DIP values. No conversion applied. The coordinates come from `xcb_translate_coordinates()` (window origin relative to root) and `xcb_get_geometry()` (dimensions). Same coordinate space that `uiohook-napi` uses for mouse positions. Same coordinate space that `xcb_shape_rectangles` uses for input regions.

On the application side, the main process now includes `gameBounds` (from `OverlayController.targetBounds`) in the IPC event that fires when you trigger a price check:

```typescript
gameBounds: this.poeWindow.bounds,  // GameWindow.bounds = OverlayController.targetBounds
```

The renderer's `computePriceCheckTrackArea()` prefers `gameBounds` over Chromium-derived bounds on Linux:

```typescript
const authoritativeBounds = isFiniteBounds(input.gameBounds) ? input.gameBounds : undefined
const anchorBoundsRaw = (input.isLinux && authoritativeBounds)
  ? authoritativeBounds
  : input.overlayBounds
```

If `gameBounds` isn't available, the old path runs. On Windows, where `window.screenX` behaves, nothing changes. `WidgetAreaTracker` on the main side also explicitly asserts the Linux invariant: track-area coordinates are already physical X11 virtual-desktop pixels. No DIP conversion.

This is a targeted fix for the price-check path. It doesn't mean Chromium's coordinate model is universally broken. It means that for this path, on this platform, Chromium was the wrong dependency for placement math.

Sometimes the bug is not that the window is in the wrong place. It's that two different subsystems believe in two different places, and both are prepared to fight for them.
