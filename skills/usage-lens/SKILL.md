---
name: usage-lens
description: Activate, stop, uninstall, or check Codex Usage Lens token statistics. Windows activation configures a stable optional launcher and login recovery, then starts the local helper.
---

# Codex Usage Lens

Resolve the plugin root as two directories above this skill directory.
Run commands from that root. On Windows use:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/control.ps1 -Action Start
```

Activation discovers Node.js 22 (including Codex's cached runtime), deploys
shipped code outside the plugin cache, creates an owned desktop shortcut and a
login-recovery shortcut, and starts the helper. Explain this persistent setup
when reporting activation. It never edits the normal Codex shortcut, client
resources, or user config. Use `-Action Status` to verify the result.

If status is `waiting` and no connection is present, the only user step is to
finish active work, close Codex normally, and open the new **Codex Usage Lens**
shortcut. Do not ask users to type debugging arguments. Existing compatible
debug launchers need no additional restart. Never terminate Codex or re-open
it while a task is running.

- `-Action Stop` removes statistics and stops the current helper. Login recovery
  remains registered; the enabled plugin can resume on next login/launcher use.
- `-Action Uninstall` stops the helper and removes only the owned Lens shortcuts.
  Run this before removing the plugin from Codex.
- Turning the existing `plugins."<plugin-id>".enabled` switch off stops the
  running helper. Enabling it again takes effect on the next Lens activation,
  dedicated launch, or login. Do not invent another Codex config field.
- `-Port`, `-StateDir`, `-CodexHome`, and `-CodexPath` are troubleshooting options.
  Preserve a configured `CODEX_HOME`.

On macOS/Linux, Windows setup is unavailable. The portable CLI is
`node src/cli.mjs start|resume|stop|status`; it still needs an existing local
desktop connection and an enabled installed plugin.

If status is `incompatible`, explain that statistics are paused for the
affected renderer and Codex can continue normally. Do not patch, restart, or
repeatedly inject into the client to work around it. A Lens update is the
appropriate fix. Do not claim universal compatibility with future clients,
that a helper spawn proves visible UI, or that tokens equal subscription credits.
