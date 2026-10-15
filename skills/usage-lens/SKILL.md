---
name: usage-lens
description: Activate, stop, uninstall, or check Codex Usage Lens token statistics. Trusted Windows session hooks restore the helper automatically; explicit activation can prepare a one-time reopen when no local connection exists.
---

# Codex Usage Lens

The bundled SessionStart and UserPromptSubmit hooks restore the Windows helper
only after the user reviews and trusts them in Codex. Never grant trust on the
user's behalf or edit trusted_hash entries. Installation alone does not mean
the hooks are trusted. Hooks are asynchronous, reuse one helper, honor persistent
pause, and never reopen the client or register startup entries.

Resolve the plugin root as two directories above this skill directory.
Run commands from that root. On Windows use:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/control.ps1 -Action Start
```

Activation discovers Node.js 22 (including Codex's cached runtime), deploys
shipped code outside the plugin cache, and starts the helper. It does not create
desktop shortcuts or login startup entries by default, or edit the normal Codex
shortcut, client resources, or user config. Use `-Action Status` to verify.

If the command reports a one-time restart, tell the user to finish active work
and fully quit Codex normally within 15 minutes. The waiting process reopens it
once with the required local connection; do not instruct them to open it again
manually. This is an armed reopen, not proof that buttons are visible yet.
Existing compatible connections need no restart. Never terminate Codex or
restart it during a task. If restart preparation fails, report that failure
instead of claiming the reopen is ready.

The helper reconnects after renderer reloads or compatible client restarts.
After a client/computer restart, the next trusted session hook restores an
unpaused helper. Opening the app to browse history is not proof the hook fired.
Codex++ connections are discovered using its actual status port. CC Switch and
direct launch do not necessarily provide CDP; when missing, explicit activation
can prepare the one-time reopen. Never claim hooks can add a missing connection.
Desktop clients are the current scope; CLI hook behavior is not supported.

- `-Action Stop` persists a pause, cancels a pending one-time reopen, removes
  statistics, and stops the helper. Hooks/login/launcher recovery respect that
  pause; explicit Start clears it. Previously opted-in login recovery remains registered.
- `-Action Uninstall` stops the helper and removes only the owned Lens shortcuts.
  It also cancels a pending reopen. Run this before removing the plugin.
- Turning the existing `plugins."<plugin-id>".enabled` switch off stops the
  running helper. Enabling it again takes effect on the next trusted session hook,
  activation, or configured recovery entry unless explicitly paused. Do not invent
  another Codex config field.
- Only if requested, `-Action Setup -DesktopShortcut` creates a dedicated
  shortcut. Existing 0.2.x shortcuts are preserved, not silently removed.
- `-Action Setup -LoginRecovery` restores only the helper, without opening
  Codex. It cannot add a missing connection to an ordinarily launched client.
  It is opt-in and must never launch or restart Codex at login. Detecting a
  running process does not grant an injection connection; the helper already
  waits for usable local connections. Never describe this helper-only option
  as automatic button recovery after any ordinary client launch.
- `-Action DisableLoginRecovery` removes the owned login entry independently
  of the current monitor and does not require Node. Use this for requests to
  disable automatic startup; do not substitute Stop. Status reports
  `loginRecovery` for this setting.
- `-Port`, `-StateDir`, `-CodexHome`, and `-CodexPath` are troubleshooting options.
  Preserve a configured `CODEX_HOME`.

On macOS/Linux, automatic hooks are no-ops and Windows setup is unavailable. The portable CLI is
`node src/cli.mjs start|resume|stop|status`; it still needs an existing local
desktop connection and an enabled installed plugin.

If status is `incompatible`, explain that statistics are paused for the
affected renderer and Codex can continue normally. Do not patch, restart, or
repeatedly inject into the client to work around it. A Lens update is the
appropriate fix. Do not claim universal compatibility with future clients,
that a helper spawn proves visible UI, or that tokens equal subscription credits.
