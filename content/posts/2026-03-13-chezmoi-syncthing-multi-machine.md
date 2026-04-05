+++
title = "One Script to Clone Any Machine"
date = 2026-03-13T00:00:00-08:00
draft = false
tags = ["chezmoi", "syncthing", "dotfiles", "linux"]
author = "Patrick Smith"
original_date = 2026-03-13T00:00:00-08:00
+++

The bootstrap problem with dotfiles is circular. You need your SSH keys to clone the dotfiles repo. The SSH keys are in the dotfiles repo. A blank machine has neither. Every "just clone your dotfiles" tutorial assumes you already have the thing you're trying to set up.

## Syncthing as the transport

Syncthing doesn't need credentials. Pair the new device, share `~/Sync`, wait for the files to land. The folder syncs over the local network with nothing but a device ID confirmation. No SSH key. No token. No login.

The catch with peer-to-peer sync: if the laptop is asleep when the desktop changes something, the change waits until both are online at the same time. A NAS running Syncthing fixes this. It's always on, so every change lands somewhere immediately. The laptop picks it up whenever it wakes. Dropbox or Google Drive would work for the same purpose. The NAS keeps data on hardware I control.

## Directory layout

`~/Sync/` is the shared Syncthing folder. Inside it:

`~/Sync/dotfiles/chezmoi/` is the chezmoi source directory. `chezmoi.toml` sets `sourceDir` to point here instead of the default `~/.local/share/chezmoi`. Chezmoi doesn't know or care that Syncthing is delivering the files.

`~/Sync/dotfiles/` also has a local git repo for history. Syncthing doesn't sync `.git/`, so each machine initializes its own repo. Same files, independent commit history. If I want to see what changed on the desktop, I check the desktop's log. The laptop has its own.

## Auto-apply with systemd

Two user-level systemd units handle the apply side. The first watches for changes:

```ini
# chezmoi-apply.path
[Unit]
Description=Watch chezmoi source for changes (via Syncthing)

[Path]
PathChanged=%h/Sync/dotfiles/chezmoi

[Install]
WantedBy=default.target
```

`PathChanged` fires when Syncthing writes a new file version into the chezmoi source directory. That triggers the service:

```ini
# chezmoi-apply.service
[Unit]
Description=Apply chezmoi dotfiles after source change

[Service]
Type=oneshot
ExecStartPre=/usr/bin/sleep 15
ExecStart=/usr/bin/chezmoi apply --no-tty --force
StandardOutput=journal
StandardError=journal
```

The 15-second sleep is a debounce. Syncthing writes files one at a time, so editing three dotfiles on the desktop means three separate write events on the laptop over a few seconds. Without the sleep, chezmoi apply runs three times in quick succession. With it, the first trigger starts a 15-second window. By the time it fires, all three files have landed. One apply, about 30 seconds after the edit. No interaction on the receiving end.

## Bootstrap

Five manual steps, then a script.

1. Install CachyOS
2. `sudo pacman -S syncthing && systemctl --user enable --now syncthing`
3. Pair the device in the Syncthing web UI, share `~/Sync`
4. Wait for the initial sync to complete
5. `cd ~/Sync && bash bootstrap.sh`

`bootstrap.sh` asks which role the machine has: desktop, laptop, or server. Then it optimizes mirrors, installs packages from role-specific lists, copies KeePassXC databases and SSH host definitions into place, writes `chezmoi.toml` with `sourceDir` pointing at the already-synced chezmoi directory, runs `chezmoi apply`, initializes the local git repo in `~/Sync/dotfiles/`, and enables the systemd auto-apply units.

The script is idempotent. The third time you run it is always the one where you find out what you forgot to make idempotent.
