+++
title = "Two Coordinate Systems, One Handoff Bug"
date = 2026-03-12T00:00:00-08:00
draft = false
tags = ["x11", "electron", "linux"]
author = "Patrick Smith"
+++

At first this looked like a flaky focus bug. Price-check sometimes opened on the wrong side. The inspect circle pointed at the wrong item. Sometimes the overlay was only clickable if you moved the mouse fast enough. Multi-monitor made it obvious, but display scaling alone could reproduce it.

Two bugs: coordinates and handoff timing. Then two more after those.

## The coordinate mismatch

I added geometry logging behind `APOE_DEBUG_GEOMETRY=1`, hooked into `Shortcuts.ts` where the main process has access to `pressPosition`, `gameBounds`, and `screen.getAllDisplays()`:

```text
debug [Geometry] copy-item:
  rawCursor=(2314,242)
  cursor=(2892,302)
  scaleFactor=1.25
  gameBounds=(0,0 3440x1400)
```

`rawCursor` is Electron DIP coordinates from `screen.getCursorScreenPoint()`. `gameBounds` comes from X11, which reports physical pixels. On a 1.25x scaled display, those two numbers describe different points on screen.

In `main/src/shortcuts/Shortcuts.ts`, the cursor position needs a `screen.dipToScreenPoint()` conversion on Linux before it goes to the renderer:

```typescript
const rawCursor = screen.getCursorScreenPoint()
const cursor = process.platform === 'linux'
  ? screen.dipToScreenPoint(rawCursor)
  : rawCursor
```

Both visible symptoms gone. The inspect circle renders over the correct item, and price-check side selection uses the same coordinate space as the X11 game bounds.

## The handoff bug

With the coordinate space fixed, a separate problem. The overlay would activate, then immediately deactivate before you could reach it.

`WidgetAreaTracker` deactivates on the first mouse movement outside the active region. On Windows, the transition is instantaneous. On Linux, the pointer has to physically travel to wherever the widget appeared. Every pixel of that journey counts as "leaving."

A boolean solves it. Track whether the pointer has entered the active region at least once:

```typescript
private hasEnteredArea = false

onMouseMove(x: number, y: number) {
  if (this.isInsideArea(x, y)) {
    this.hasEnteredArea = true
    // overlay stays active
  } else if (this.hasEnteredArea) {
    // user left after entering — deactivate
    this.deactivate()
  }
  // else: haven't entered yet, tolerate outside movement
}
```

Before entry, outside movement is tolerated. After entry, leaving deactivates. Clicking outside while the overlay is interactable still deactivates immediately, regardless of whether the pointer ever entered.

Even with the smarter tracker, the application is guessing when the pointer crosses into the input region. X11 already knows. It tracks the input shape per-pixel. In `x11.c`, subscribing the overlay window to `XCB_ENTER_NOTIFY` gives us a native signal:

```c
uint32_t mask = XCB_EVENT_MASK_ENTER_WINDOW;
xcb_change_window_attributes(x_conn, overlay_info.window_id,
  XCB_CW_EVENT_MASK, &mask);
```

When the pointer enters the input shape, X11 fires `EnterNotify`. The native layer emits this as `input-enter` to JS. `OverlayWindow.ts` uses it to reassert overlay focus, but only while a widget handoff is armed.

The alternative was `XGrabPointer`. Simpler and worse. It fights the window manager, conflicts with click-through, and if you get the release wrong the user's mouse is stuck. The input-shape approach lets X11 handle hit-testing per-pixel. `input-enter` provides a narrow native hint only during the armed handoff window.

## Deactivating while you're still reading

Once the overlay was stable enough to actually use, a different pattern showed up in the debug log:

```text
assertOverlayActive: activating
setInputRegions: 1 region(s): (2645,0 575x1752)
[2–13 seconds pass]
assertGameActive: deactivating
```

The price-check panel would appear, then close on its own while I was still reading prices. Two to thirteen seconds in, every time.

`assertGameActive: deactivating` fires from `WidgetAreaTracker.handleMouseMove` when the mouse moves outside the tracked area while `overlay.isInteractable` is true:

```typescript
} else if (this.overlay.isInteractable) {
  if (!this.hasEnteredArea) return
  this.removeListeners()
  this.overlay.assertGameActive()   // fires as soon as mouse leaves panel x-range
}
```

The price-check panel occupies a vertical strip on the right side of the screen. On a 3440px wide display, roughly x=2645 to 3220. Any mouse movement left of x=2645 while reading triggers immediate deactivation. That's normal reading behavior. You look at prices, you move your mouse.

On Linux, this guard is unnecessary. The X11 input shape mask (`xcb_shape_rectangles`) already handles click-through: clicks outside the active region pass directly to the game regardless of `isInteractable`. The guard exists for Windows. On Linux it actively kills the overlay.

One guard in `handleMouseMove`: when the overlay is already interactable on Linux, stop tracking and re-arm `input-enter` reactivation, but skip the `assertGameActive()` call. The overlay stays active. `input-enter` stays live so the mouse re-entering a widget region can reactivate correctly. Explicit deactivation still works: Escape, Ctrl+W, the close button, and clicking outside the panel (via `handleMouseDown`, unchanged) all hand focus back to the game. Nine lines added, none removed, in `main/src/windowing/WidgetAreaTracker.ts`.

## The packaging bug

After all of that worked in development, the AppImage launched with `Cannot find module 'uiohook-napi'`. Unrelated to the first three.

Native addons like `uiohook-napi` and `electron-overlay-window` are `esbuild` externals. They can't be bundled, but the packager doesn't include them automatically either. They need explicit entries in `main/electron-builder.yml`:

```yaml
files:
  - "!node_modules"
  - node_modules/uiohook-napi/**
  - node_modules/electron-overlay-window/**
  - node_modules/node-gyp-build/**
  - node_modules/throttle-debounce/**
```

The geometry log confirms everything lines up:

```text
debug [Geometry] copy-item:
  rawCursor=(2314,242)
  cursor=(2892,302)
  scaleFactor=1.25
  gameBounds=(0,0 3440x1400)

setInputRegions: (2645,0 575x1752)
```

`rawCursor` at 2314 became `cursor` at 2892 after DIP conversion (2314 * 1.25 = 2892.5, rounded). `gameBounds` matches the physical coordinate space. The input region lands on the expected side.

"Overlay input bug" was four separate bugs: coordinate space, handoff timing, deactivation policy, and packaging. Debugging got easier once the app logged both raw and normalized geometry.
