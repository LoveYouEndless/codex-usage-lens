# Changelog

## 0.3.0 (Unreleased)

- Add opt-in trusted Windows SessionStart and UserPromptSubmit hooks. They
  deploy/upgrade once, restore one helper asynchronously, discard hook input,
  and never reopen Codex or register startup entries. Trust remains a user choice.
- Persist Stop across hooks, login recovery, launchers, and reboots; explicit
  Start clears the pause. Serialize overlapping lifecycle requests and replace
  outdated helper versions instead of spawning duplicates.
- Discover Codex++'s actual debug port from local launcher status, with owned
  Lens/default port fallbacks. Document Codex++, CC Switch, and direct desktop
  launch behavior without assuming a CDP connection or covering CLI clients.
- Retain explicit conversation activation for connection setup and clearing
  pauses, without creating desktop or login startup shortcuts by default.
- On explicit activation without a local connection, prepare a one-time reopen after the user
  normally exits Codex within 15 minutes. Never terminate the client.
- Cancel pending reopens on Stop, plugin disable, expiration, or a manually
  reopened client. Repeated activation replaces the older request.
- Keep shortcut and login setup explicitly opt-in, preserve existing 0.2.x
  entries, and document full-exit/reboot limits without promising automatic
  recovery from an ordinary launch.
- Add independent login-recovery disable and status reporting. Login recovery
  starts only the waiting helper; it never opens or restarts Codex. Verify that
  a running helper mounts automatically when a usable connection appears.

## 0.2.0

- Windows activation configures the helper, a stable dedicated launcher, and
  login recovery; users no longer need to enter debugging commands.
- Ship the runtime outside the plugin cache so cache cleanup does not break
  registered startup entries.
- Read Codex's existing plugin enable switch with a bundled TOML parser. Disable,
  removal, and invalid-config cases stop or pause statistics without editing
  user configuration.
- Re-discover the Codex executable after upgrades. A missing runtime, disabled
  switch, busy port, or immediately rejected debug launch falls back to ordinary
  startup; the original Codex launcher remains untouched.
- Probe interface compatibility before injection. Unsupported markup and
  repeated renderer failures withdraw statistics and pause further injection
  into that renderer.
- Add owned-shortcut uninstall and idempotent helper recovery.

## 0.1.2

- Match native action text colors with a borderless idle state and subtle
  hover/open backgrounds.
- Add the compact Lucide database icon with third-party attribution.
- Follow native historical action visibility on reply hover or keyboard focus.
- Keep the usage trigger visible and marked expanded while its details are open.

## 0.1.1

- Restore visible checkboxes under Codex's global input reset.
- Keep the meter button stable so polling no longer dismisses session details.
- Anchor session details to the outer meter edge with a four-pixel gap.
- Place Usage after the native branch controls when space permits, with a
  separate-row fallback for narrow layouts.
- Preserve focused panel controls through counter updates and skip unchanged
  panel rebuilds.

## 0.1.0

- Initial independent release: per-turn usage buttons, local session statistics,
  an optional draggable meter, and plugin marketplace installation.
