+++
title = "Fixing Mouse Input on Awakened PoE Trade's Linux Overlay"
date = 2026-03-09T00:00:00-08:00
draft = true
tags = ["x11", "electron", "linux", "proton"]
author = "Patrick Smith"
+++

Awakened PoE Trade is an Electron overlay for Path of Exile. On Linux, PoE runs through Proton. The overlay shows up fine, keyboard shortcuts work, but mouse clicks pass straight through. You can see the buttons. You just can't click them.

SDL2 (via Wine/Proton) calls `XGrabPointer` to capture the mouse for the game window. When the overlay activates, `electron-overlay-window` calls `xcb_set_input_focus()` to grab keyboard focus:

```c
void ow_activate_overlay() {
  xcb_set_input_focus(x_conn, XCB_INPUT_FOCUS_PARENT,
    overlay_info.window_id, XCB_CURRENT_TIME);
  xcb_flush(x_conn);
}
```

This works for keyboards. It does nothing for the pointer. In X11, keyboard focus and pointer grabs are orthogonal. The game still owns the mouse.

The fix is to send a `_NET_ACTIVE_WINDOW` client message before setting input focus. This EWMH hint asks the window manager to mediate the focus change. The WM generates a `FocusOut` event on the currently focused window, and SDL2/Wine responds to `FocusOut` by releasing `XGrabPointer`.

```c
void ow_activate_overlay() {
  if (overlay_info.window_id == XCB_WINDOW_NONE) return;

  pthread_mutex_lock(&x_conn_mutex);

  xcb_client_message_event_t msg = {0};
  msg.response_type = XCB_CLIENT_MESSAGE;
  msg.type = ATOM_NET_ACTIVE_WINDOW;
  msg.window = overlay_info.window_id;
  msg.format = 32;
  msg.data.data32[0] = 2; // source indication: pager

  xcb_send_event(x_conn, 0, root,
    XCB_EVENT_MASK_SUBSTRUCTURE_NOTIFY | XCB_EVENT_MASK_SUBSTRUCTURE_REDIRECT,
    (const char*)&msg);

  xcb_set_input_focus(x_conn, XCB_INPUT_FOCUS_PARENT,
    overlay_info.window_id, XCB_CURRENT_TIME);
  xcb_flush(x_conn);

  pthread_mutex_unlock(&x_conn_mutex);
}
```

The source indication is `2` (pager). KDE's focus-steal prevention ignores the message if you use `1` (application), something the upstream author already discovered in an earlier commit. Setting it to `2` bypasses that check.

The `xcb_set_input_focus` call stays as a fallback. If the WM ignores the EWMH message, keyboard focus still transfers. You lose mouse clicks but keep keyboard input. Better than losing both.

The overlay window is override-redirect, so the WM doesn't manage it. You might expect `_NET_ACTIVE_WINDOW` to be useless here. But the message triggers `FocusOut` on the *currently active* managed window, which is what matters. We don't need the WM to focus our window. We need it to unfocus the game window.

The `pthread_mutex_t` is new. The original code accessed `x_conn` from both the Node.js main thread and the hook thread with no synchronization. Fixing the mouse bug while leaving a threading bug felt wrong.

This isn't a new idea. The upstream author (SnosMe) explored `_NET_ACTIVE_WINDOW` before, just on the wrong function. Commit `943c3c2` added it to `ow_focus_target()`, which returns focus *back to the game* after the overlay closes, fixing a KDE bug where the game wouldn't regain focus. Commit `131dba9` removed it: "try to focus using X11 directly instead of EWMH."

Both commits touched `ow_focus_target()`. The mouse problem lives in `ow_activate_overlay()`. Different function, different direction. They were handing focus to a managed window. We're breaking a pointer grab by triggering `FocusOut` on one.

With the X11 side sorted, I forked `electron-overlay-window`, applied the fix on a feature branch, and had the changes reviewed. There were a couple of extra fixes: a `uint8_t*` vs `void*` compilation error in `addon.c` that showed up with newer Node.js versions, and a `prepare` script so the native addon builds correctly when installed as a git dependency. Built APoE locally with the patched dep, packaged it as an AppImage. Clicks work.

Maintaining a fork manually gets old fast. Every upstream release means checking out the new tag, patching, building, publishing. So I set up a GitHub Actions workflow (`.github/workflows/linux-appimage.yml`) that handles it.

The workflow polls upstream every 6 hours. When it finds a new release, it checks out the upstream tag and patches in the fixed overlay dependency at build time:

```javascript
const fs = require('fs');
const pkg = require('./package.json');
pkg.dependencies['electron-overlay-window'] =
  'github:murrain/electron-overlay-window';
pkg.repository.url =
  'https://github.com/murrain/awakened-poe-trade.git';
fs.writeFileSync('./package.json', JSON.stringify(pkg, null, 2) + '\n');
```

It also patches the auto-updater so users get updates from the fork, not upstream:

```typescript
autoUpdater.setFeedURL({
  provider: 'github',
  owner: 'murrain',
  repo: 'awakened-poe-trade'
})
```

The workflow builds and publishes an AppImage as a GitHub release. New upstream version drops, patched Linux build follows automatically.

I've only tested this on KDE Plasma 6 with a single GPU. Other compositors, other WMs, multi-monitor setups with mixed DPI -- no idea. I sent the AppImage to a friend and I'm waiting to hear back, which will bring the total QA department headcount to two.
