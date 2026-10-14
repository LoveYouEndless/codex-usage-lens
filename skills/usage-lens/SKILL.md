---
name: usage-lens
description: Start, stop, or check the Codex Usage Lens local token display when requested. Requires Node.js 22 and a Codex desktop renderer with localhost debugging enabled.
---

# Codex Usage Lens

Resolve the plugin root as two directories above this skill directory.
Run commands from that root. On Windows, prefer
`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/control.ps1 -Action Start`
(or `Stop` / `Status`), which also discovers Codex's bundled Node runtime when
`node` is not on PATH. The runtime reads local session JSONL files;
it does not call a model API or send conversation content to a remote service.

- Start: `node src/cli.mjs start`. It discovers existing debug ports and starts
  a detached helper. Check `node src/cli.mjs status` after activation.
- Stop: `node src/cli.mjs stop`. It removes Lens UI and stops only its own helper.
- Check: `node src/cli.mjs status`. Report the selected session and connection state.

If no debug-enabled renderer exists, explain that a one-time launch setup is
required. On Windows, `scripts/launch-windows.ps1` can discover the desktop
executable or accept `-CodexPath`, create a dedicated desktop shortcut with
loopback debugging enabled, or launch it. The launcher refuses to restart a
running client. Have the user finish active work and close it normally before
launching. Do not kill Codex processes or patch installed application files.

Use `--port PORT` to select a specific existing debug endpoint. If a custom
`CODEX_HOME` is configured, the runtime uses it for session logs and Lens state.
The plugin's cached checkout is never used to store personal conversation logs.
After an upgrade, starting Lens stops the prior Lens helper before replacing it.

Do not claim that installation alone enables debugging, that token counts equal
subscription credits, or that a successful helper spawn confirms rendered UI.
For those checks inspect status and the visible usage button.
