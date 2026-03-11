+++
title = "Making the Overlay Unclickable Again"
date = 2026-03-10T00:00:00-08:00
draft = false
tags = ["x11", "electron", "linux"]
author = "Patrick Smith"
+++

The previous problem was that nothing was clickable. The fix for that took a few hundred lines of C and a forked npm package. The new problem is that everything is clickable. Toggle the overlay on and every click lands on Electron. None of them reach the game.

I then spent several more hours making most of it unclickable again.

On Windows, `electron-overlay-window` uses `setIgnoreMouseEvents(true/false)` to flip the whole window between click-through and interactive. Binary toggle. We want something more granular: only the visible widget areas capture input, everything else passes through.

## X11 Shape Extension

The X11 Shape Extension (1991) has exactly what we need. `XCB_SHAPE_SK_INPUT` lets you define which pixels of a window accept mouse input as a list of rectangles. Only those rects get clicks. Everything else passes through to whatever's underneath.

Set the rectangle count to zero and you get an empty input shape: full click-through. Set it to a list of widget bounds and those widgets are interactive while the rest of the overlay is transparent to input.

## Native implementation

New function `ow_set_input_regions()` in `x11.c`. The struct is layout-compatible with `xcb_rectangle_t`, verified at compile time:

```c
typedef struct {
  int16_t x;
  int16_t y;
  uint16_t width;
  uint16_t height;
} ow_rect_t;

_Static_assert(sizeof(ow_rect_t) == sizeof(xcb_rectangle_t),
  "ow_rect_t must match xcb_rectangle_t size");
_Static_assert(offsetof(ow_rect_t, x) == offsetof(xcb_rectangle_t, x),
  "x offset mismatch");
_Static_assert(offsetof(ow_rect_t, y) == offsetof(xcb_rectangle_t, y),
  "y offset mismatch");
_Static_assert(offsetof(ow_rect_t, width) == offsetof(xcb_rectangle_t, width),
  "width offset mismatch");
_Static_assert(offsetof(ow_rect_t, height) == offsetof(xcb_rectangle_t, height),
  "height offset mismatch");
```

The actual X11 call is four lines:

```c
xcb_shape_rectangles(x_conn, XCB_SHAPE_SO_SET, XCB_SHAPE_SK_INPUT,
  XCB_CLIP_ORDERING_UNSORTED, overlay_info.window_id,
  0, 0, // x/y offset
  count, (xcb_rectangle_t*)rects);
xcb_flush(x_conn);
```

Thread-safe via the existing `pthread_mutex_t` on the XCB connection.

On the JS side, the N-API binding in `addon.c` marshals arrays of `{x, y, width, height}` into the C struct array:

```c
#define OW_INPUT_REGIONS_STACK_MAX 50

struct ow_input_rect stack_rects[OW_INPUT_REGIONS_STACK_MAX];
struct ow_input_rect* rects = stack_rects;
if (count > OW_INPUT_REGIONS_STACK_MAX) {
  rects = malloc(count * sizeof(struct ow_input_rect));
  if (rects == NULL) {
    NAPI_THROW(env, NULL, "setInputRegions: failed to allocate memory", NULL);
  }
}

// per-element loop:

/* xcb_rectangle_t fields are int16_t (x, y) and uint16_t (width, height).
 * JS passes int32/uint32, so range-check before narrowing to avoid UB. */
if (raw_x < INT16_MIN || raw_x > INT16_MAX ||
    raw_y < INT16_MIN || raw_y > INT16_MAX ||
    raw_w > UINT16_MAX || raw_h > UINT16_MAX) {
  if (rects != stack_rects) free(rects);
  NAPI_THROW(env, NULL, "setInputRegions: coordinate value out of int16/uint16 range", NULL);
}

rects[i].x = (int16_t)raw_x;
rects[i].y = (int16_t)raw_y;
rects[i].width = (uint16_t)raw_w;
rects[i].height = (uint16_t)raw_h;
```

If JS hands you a coordinate that doesn't fit in `int16_t`, you want to know about it. Stack allocation handles the common case (under 50 rects); heap kicks in above that.

## The xcb_shape_mask bug

First attempt at the zero-regions case used `xcb_shape_mask(XCB_PIXMAP_NONE)`. The idea: "no shape means no input." The actual behavior: removing the input shape entirely restores the X11 default, which is "full window accepts input." The exact opposite.

The fix: always use `xcb_shape_rectangles`. With `count=0` it sets an empty shape. One function, both cases handled correctly.

## Suppressing Electron's setIgnoreMouseEvents

`electron-overlay-window` calls `setIgnoreMouseEvents(true)` on blur and `setIgnoreMouseEvents(false)` on focus. On Linux with input shapes, this stomps the shape mask. Electron tells X11 "ignore all mouse events" or "accept all mouse events," overwriting the rectangles we just set.

Fix: a `usingInputRegions` flag and a wrapper method.

```javascript
_setIgnoreMouseEvents(ignore) {
  if (this.usingInputRegions) return;
  this.electronWindow.setIgnoreMouseEvents(ignore);
}
```

```typescript
setInputRegions (regions: Array<{x: number, y: number, width: number, height: number}>) {
  if (isLinux) {
    this.usingInputRegions = true
    lib.setInputRegions(regions)
  }
}
```

Once `setInputRegions` is called, `usingInputRegions` stays true for the rest of the session. All four call sites that touch mouse events (`attach`, `focus`, `activateOverlay`, `focusTarget`) become no-ops, and the X11 shape mask owns click routing from that point on.

## Getting accurate measurements

Widget root elements (`#widget-N`) are full-screen positioned wrappers. `getBoundingClientRect()` on them returns the entire viewport (3440x1440). Useless.

First attempt: measure `.widget-default-style` children, the rounded dark background panels. Failed. `PriceCheckWindow`, `SettingsWindow`, and several others don't use that class. Final approach: an explicit `data-input-region` HTML attribute.

```html
<div data-input-region class="widget-default-style ...">
```

Added to `Widget.vue`, which covers 7 of 9 widget types automatically. The remaining two got the attribute manually.

That gets the right elements. But `getBoundingClientRect()` returns CSS pixels, and `xcb_shape_rectangles` operates in X11 device pixels. At 2x scaling, a 460px-wide widget needs a 920px-wide input rectangle.

```javascript
const ratio = window.devicePixelRatio;
const rect = el.getBoundingClientRect();
regions.push({
  x: Math.round(rect.x * ratio),
  y: Math.round(rect.y * ratio),
  width: Math.round(rect.width * ratio),
  height: Math.round(rect.height * ratio),
});
```

Missed this initially. Regions were half-size and clicks only registered on the left half of each widget.

Vue updates the DOM asynchronously, so measuring immediately after a state change returns stale layout. The pipeline:

```javascript
function scheduleUpdate() {
  clearTimeout(debounceTimer);
  cancelAnimationFrame(rafId);

  debounceTimer = setTimeout(() => {
    nextTick(() => {       // Vue DOM flush
      rafId = requestAnimationFrame(() => {  // browser layout
        measureAndSend();
      });
    });
  }, 50);
}
```

Debounce 50ms, then `nextTick` (Vue DOM flush), then `requestAnimationFrame` (browser layout complete), then measure. The `cancelAnimationFrame` on reschedule was a bug fix; without it, a stale rAF callback could fire and send outdated region data.

One more measurement problem: `SettingsWindow` has a `slideInDown` CSS animation (1s duration). `getBoundingClientRect()` during the animation returns the animated position, so the settings window measured at `y = -760`, above the viewport. Pragmatic fix: clamp negative coordinates to 0. The shape is slightly too large during the 1s animation but correct once it settles. You're not trying to click behind an actively animating window.

## Debugging sequence

Renderer `console.log` goes to DevTools, not the terminal. Added a temporary log in the main process IPC handler so I could see what the renderer was actually sending.

What appeared in sequence:

1. Empty arrays. Correct: no visible widgets on startup.
2. Full-screen rectangles: `[{"x":0,"y":0,"width":3440,"height":1440}]`. Measuring the wrapper divs. This led to `data-input-region`.
3. Correct small rectangles for most widgets, but settings window at `y:-760`. The CSS animation problem.
4. After the coordinate clamp, correct rectangles everywhere.

Around 220 lines of new code across 7 files in two repos. The X11 call itself is four lines. The hard part was getting accurate measurements out of a Vue/Electron renderer with CSS animations, async DOM updates, and HiDPI scaling.

## The Price-Check Bug on Multi-Monitor

Every other widget in the overlay is keyboard-activated. Shift+space opens the menu. Settings has its own shortcut. The main process calls `assertOverlayActive()` directly and everything works.

Price-check is different. It uses `WidgetAreaTracker`, which compares absolute screen coordinates from two sources: `uiohook-napi` (the global mouse hook) and Chromium's own window properties. Those two sources need to agree on where things are.

On a single monitor, they do. The second monitor doesn't know it's the second monitor.

`window.screenX` reports where Chromium thinks its window is on screen. For normal windows this is reliable. Override-redirect windows are not normal windows. They have no window manager decorations, no taskbar entry. X11 doesn't manage their position the same way, and Chromium returns `screenX = 0` regardless of where the window actually sits in the virtual desktop.

Single monitor: 0 is correct. Secondary monitor to the left: 0 is wrong by the entire width of that monitor.

The overlay renders perfectly. CSS layout is relative to the viewport, so the widget appears exactly where it should. Nothing looks broken. The breakage is in the IPC message sent to the main process, where the clickable track-area rectangle ends up 1920 pixels to the left of where it should be.

`uiohook-napi` reports physical virtual-desktop coordinates straight from the OS. Cursor on the primary monitor at position 2400, it says `x=2400`. Meanwhile the renderer says "I'm at `x=0`" and computes the clickable area starting at 0. The main process compares 2400 against a rectangle starting at 0.

Never matches.

The original calculation trusts `window.screenX`:

```javascript
const width = 28.75 * AppConfig().fontSize
const screenX = ((e.position.x - window.screenX) > window.innerWidth / 2)
  ? (window.screenX + window.innerWidth) - wm.poePanelWidth.value - width
  : window.screenX + wm.poePanelWidth.value
```

`xcb_translate_coordinates` returns the window's position in the X11 virtual desktop in physical pixels, the same coordinate space uiohook uses. It was already being called for the game window bounds. Just had to pipe it through.

```javascript
const originX = gb ? gb.x : Math.round(window.screenX * dpr)
const areaX = cursorInRightHalf
  ? (originX + totalWidth) - panelWidth - width
  : originX + panelWidth
```

Same math. Only the origin changed. `gb.x` (from xcb) vs `window.screenX` (from Chromium). The fallback still uses `window.screenX` scaled by DPR for cases where game bounds aren't available, but on any setup where `xcb_translate_coordinates` has data, the coordinates are correct.
