# Codex Usage Lens

**Per-turn token usage, directly beneath your Codex replies.**

An independent, MIT-licensed Codex Desktop plugin. Click a compact usage button
to inspect input, cached input, output, reasoning, and the session total.
An optional draggable meter keeps the current session total visible.

[中文说明](README.zh-CN.md)

![Usage button and detail panel, using synthetic demo data](assets/preview.png)

## Install From The Plugin Marketplace

In Codex, open **Plugins → Add marketplace**, and enter:

```text
https://github.com/LoveYouEndless/codex-usage-lens
```

1. Install and enable **Codex Usage Lens**.
2. Review the plugin hooks in Codex and decide whether to trust them.
3. Start/resume a conversation or send a message. The helper prepares itself
   automatically and displays usage buttons when a usable connection exists.

Normal use needs no terminal commands or Lens API key. Setup adds no desktop
shortcuts or login entries by default.

If buttons do not appear initially, or you previously stopped monitoring,
select `@Codex Usage Lens` in a conversation and send:

```text
@Codex Usage Lens Start usage monitoring.
```

If prompted that a one-time reopen is ready, finish your current work, then
**fully quit Codex within 15 minutes** and wait for it to reopen automatically.
Continue using Codex normally.

See below for recovery after restarts and differences between launch methods.

## Restart And Upgrade Behavior

Automatic recovery requires the user to trust the hooks in Codex. Lens never
writes trust records or confirms that choice for the user. On Windows,
`SessionStart` handles new/resumed sessions and `UserPromptSubmit` provides
recovery when submitting a message. Both run asynchronously and reuse one helper.
Opening the app solely to browse past replies does not guarantee a hook fired.
CLI clients are out of scope.

| Desktop launch | After trusting the hooks |
| --- | --- |
| Codex++, API key or official login | Restore the helper and display buttons when a usable CDP connection exists; discover the launcher's actual port |
| Launch after configuring CC Switch | Restore the helper; display buttons with a connection, otherwise wait |
| Direct Codex launch | Restore the helper; wait when an ordinary launch lacks a connection |

Hooks never arm a client reopen. Explicit activation can prepare one when no
connection exists; it does not permanently change ordinary launch arguments.
Stop, disabling the plugin, expiration, or detecting a manual reopen cancels
a pending reopen.

| Scenario | Behavior |
| --- | --- |
| Trusted session start/resume or message submission | Deploy/upgrade once, then reuse the running helper |
| Hook without a usable connection | Keep waiting; never arm a client reopen |
| Explicit activation without a usable connection | Wait up to 15 minutes for normal exit, then reopen once |
| Renderer reload or compatible client restart | The running helper reconnects |
| Full exit and ordinary launch | Session hooks restore the helper; explicitly prepare a reopen if no connection exists |
| Computer restart | Restore the unpaused helper at the next session hook |
| Stop | Persist a pause, cancel pending reopens, remove statistics, and stop; hooks cannot revive it |
| Reopen timeout | Cancel only the pending reopen; keep waiting for a usable connection |
| Plugin disabled | Withdraw statistics and exit; no config files are edited |
| Codex upgrade | Discover the new installed executable instead of retaining a version-specific shortcut |
| Incompatible UI | Pause injection for the affected renderer; continue using Codex normally |

The existing Codex plugin switch is honored:

```toml
[plugins."codex-usage-lens@codex-usage-lens"]
enabled = true
```

Setting it to `false` stops the running helper at its next policy check.
Missing/uninstalled plugin entries also stop it. Temporarily invalid TOML pauses
statistics without quoting settings into logs. Re-enabling takes effect on the
next trusted hook, unless explicitly paused; use Start to clear that pause.
Dedicated shortcuts and login recovery are explicit advanced
options; recovery registration alone cannot enable a client launched without a
usable local connection.

### Optional Background Waiting

The running helper already waits for usable local connections and mounts the
buttons when one appears. Detecting a Codex process alone does not grant an
injection connection; another process watcher or Windows service cannot replace
that prerequisite.

Users can explicitly opt into helper recovery after Windows login. This starts
only the helper: it never opens or restarts Codex and does not install a Windows
service. An ordinary launch without a usable connection still requires
conversation activation and the requested one-time reopen. This option is not
a promise of automatic button recovery after every reboot, and is off by default.
Ask to enable or disable helper recovery at login, or use the advanced commands
below to configure it yourself.

Lens runs separately from Codex. The dedicated launcher falls back to ordinary
startup on missing Node, unavailable configuration, or a busy debug port. If
debug launch throws or the client exits immediately, it tries ordinary startup
once. It never terminates Codex or alters installed client files. Unknown future
client changes cannot be guaranteed compatible. Normal Codex launch remains
available. The next trusted hook or explicit activation deploys an updated Lens.
Changed hook definitions require the user to review and trust them again. Completing
the one-time reopen does not by itself prove that buttons are visible.

## Controls

- Click **Usage** after the native branch control to open details. Narrow action
  rows keep Usage on a separate line.
- Usage follows the native action color and has a borderless idle state, with a
  subtle background on hover or while open. Historical controls appear on reply
  hover or keyboard focus; the trigger stays visible while its panel is open.
- Click outside the panel or press Escape to dismiss it.
- Select Auto, Raw, K, or M for display units.
- Enable **Show session meter** in the panel for a draggable floating total.
- Meter details remain open during usage refreshes and stay next to the meter.
- Ask **Stop Codex Usage Lens** to remove the UI and persist a pause; explicitly start to resume.

The interface uses Chinese for `zh` locales, and English otherwise.

CLI controls from the plugin root:

```sh
node src/cli.mjs start
node src/cli.mjs resume
node src/cli.mjs status
node src/cli.mjs stop
node src/cli.mjs start --port 9229
```

`CODEX_HOME` selects the log home. `--codex-home` and `--state-dir` override log
and helper-state locations. Default state is `%LOCALAPPDATA%\CodexUsageLens` on
Windows and `$CODEX_HOME/usage-lens` (or `~/.codex/usage-lens`) elsewhere.

## Advanced Setup

Node.js 22 or newer is required. Windows activation discovers system Node or
Codex's cached runtime. The TOML parser is bundled; users do not run `npm install`.
The renderer connection uses loopback Chrome DevTools Protocol. Automatic recovery
checks Codex++'s `latest-status.json` (honoring `CODEX_PLUS_STATE_DIR`), the installed
Lens port, and ports 9229, 9222, 9230, and 9223. Status files are hints only; the
endpoint must expose a Codex main page. An explicit port is exclusive.
The one-time reopen prepares the selected connection automatically.

```powershell
.\scripts\control.ps1 -Action Start
.\scripts\control.ps1 -Action Status
.\scripts\control.ps1 -Action Stop
.\scripts\control.ps1 -Action Uninstall
# Only when these extra entries are explicitly wanted:
.\scripts\control.ps1 -Action Setup -DesktopShortcut
.\scripts\control.ps1 -Action Setup -LoginRecovery
.\scripts\control.ps1 -Action DisableLoginRecovery
# Troubleshooting only:
.\scripts\control.ps1 -Action Start -CodexPath "C:\path\to\Codex.exe" -Port 9229
```

`Stop` persists a pause and cancels a pending reopen. Hooks, login recovery, and
the dedicated launcher respect it; only explicit `Start` clears it. Previously opted-in
login recovery stays registered until `DisableLoginRecovery` or `Uninstall`,
and resumes only while the Codex plugin remains enabled. Disabling recovery
does not stop the current monitor. Runtime
code is installed into `%LOCALAPPDATA%\CodexUsageLens\runtimes\<version>`, with
stable launcher scripts and `install.json` beside it. Plugin-cache deletion
does not invalidate the login entry. Launcher and helper diagnostics are local
`launcher-status.json`, `restart-request.json`, `status.json`, `hook-status.json`
(recovery failures), and `helper.log`. The `paused` file stores the pause.

## What The Numbers Mean

Turn usage sums cumulative counter differences across the user turn, including
tool-related model requests. A usage update count is **not** an exact request
count. Duplicate cumulative records add no usage.

Cached input is included in input; reasoning is included in output. They are
shown as breakdowns and are never added to the total a second time. Context
shows the most recently recorded input occupancy, not all-time spending.
Totals are token records, **not** subscription credits or a billing estimate.

If a resumed log starts with earlier cumulative totals, Lens uses the recorded
last-call usage for the first observable increment and marks the turn
incomplete. Counter decreases start a new local counting epoch; after such a
reset the displayed session total includes both epochs. Missing records cannot
be reconstructed, and incomplete logs may undercount a turn.

Historical rollouts with the same session ID are merged by turn ID. Their
cumulative session totals are not summed together.

## Compatibility And Privacy

- Automatic hooks currently target Windows Desktop. macOS/Linux hook commands
  are no-ops; their launcher setup has not been validated.
- The client must load trusted plugin hooks. A running helper is not evidence
  that hooks are trusted or usage buttons are visible.
- The UI currently targets desktop builds exposing response annotation message
  IDs and assistant action timestamps. It does not inject into browser ChatGPT.
- Only local UUID sessions with matching log metadata are supported. Remote
  sessions without local logs show no usage.
- Message IDs bind a final reply to its recorded turn; Lens does not use reply
  text, guessed ordering, or another session's totals as a fallback.
- The helper connects to one main renderer. Multiple windows are not covered
  by the first release.
- This is temporary DOM injection through Chrome DevTools Protocol, not an
  official native footer extension. App DOM/log changes can require an update.
- Runtime operation sends no data to remote servers. Logs are read locally;
  only counters, session/turn/message IDs, model names, and timestamps are
  transferred to the local renderer. Hook input is discarded without parsing,
  retaining, logging, or interpolating user messages. Conversation bodies are not retained or
  transferred by Lens. No Codex installation files or session logs are written.
- A debugging port allows local software to control the renderer. Keep it
  bound to loopback; do not expose or forward it to a network.

To uninstall, ask **Uninstall Codex Usage Lens startup configuration** before
removing the plugin, or run `control.ps1 -Action Uninstall`. It removes only its
owned desktop/login shortcuts and stops the helper. It leaves local state/code
for optional manual cleanup. Existing 0.2.x shortcuts and login entries are
preserved on upgrade rather than silently removed. Use Uninstall to remove
those old entries, then activate the new version; default activation will not
recreate them.

## Development

```sh
npm ci
npm test
npm run test:windows
npx playwright install chromium
npm run test:ui
npm run demo
```

The demo and published screenshots use synthetic data. Browser tests cover
desktop/mobile widths, light/dark mode, popup bounds, units, session switching,
repeat injection, and cleanup. `PLAYWRIGHT_CHANNEL=chrome` can use an installed
Chrome browser instead of a downloaded Chromium.

The session parser, runtime integration, and UI were written independently for this project.
Codex Monitor was a visual feasibility reference; no code was copied from it.

MIT licensed. See [LICENSE](LICENSE).
The Lucide database icon and bundled TOML parser are covered by
[third-party notices](THIRD_PARTY_NOTICES.md).
