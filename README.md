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

Install **Codex Usage Lens**, then ask:

```text
Start Codex Usage Lens.
```

On Windows, activation automatically prepares the local helper, a **Codex Usage
Lens** desktop shortcut, and login recovery. No API key or terminal commands are
needed in the normal installation flow.

If activation says a first-time reopen is needed, finish active work, close
Codex normally, and use the new shortcut. An existing compatible launcher works
without this additional step. Use the dedicated shortcut for future launches;
the original shortcut remains available and unchanged.

## Restart And Upgrade Behavior

| Scenario | Behavior |
| --- | --- |
| First activation | Detect the runtime, deploy stable helper code, and register dedicated shortcuts |
| Codex restart | Reconnect when Codex is opened through Lens or another compatible launcher |
| Computer restart | Restore the helper after login and wait; do not open Codex automatically |
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
next activation, dedicated launch, or login. Recovery registration alone cannot
enable an app launched without a usable local connection.

Lens runs separately from Codex. The dedicated launcher falls back to ordinary
startup on missing Node, unavailable configuration, or a busy debug port. If
debug launch throws or the client exits immediately, it tries ordinary startup
once. It never terminates Codex or alters installed client files. Unknown future
client changes cannot be guaranteed compatible; keep the original shortcut as
a direct fallback. Updating Lens and activating it once resumes updated code.

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
- Ask **Stop Codex Usage Lens** to remove the UI and stop its helper.

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
The renderer connection uses loopback Chrome DevTools Protocol. Existing ports
9229, 9222, 9230, and 9223 are detected at setup; the dedicated launcher prepares
the selected connection automatically.

```powershell
.\scripts\control.ps1 -Action Start
.\scripts\control.ps1 -Action Status
.\scripts\control.ps1 -Action Stop
.\scripts\control.ps1 -Action Uninstall
# Troubleshooting only:
.\scripts\control.ps1 -Action Start -CodexPath "C:\path\to\Codex.exe" -Port 9229
```

`Stop` affects the current helper. Login recovery stays registered until
`Uninstall`, and resumes only while the Codex plugin remains enabled. Runtime
code is installed into `%LOCALAPPDATA%\CodexUsageLens\runtimes\<version>`, with
stable launcher scripts and `install.json` beside it. Plugin-cache deletion
does not invalidate the login entry. Launcher and helper diagnostics are local
`launcher-status.json`, `status.json`, and `helper.log`.

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

- Windows is the first supported setup path. The core runtime is portable, but
  macOS/Linux launcher setup has not been validated.
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
  transferred to the local renderer. Conversation bodies are not retained or
  transferred by Lens. No Codex installation files or session logs are written.
- A debugging port allows local software to control the renderer. Keep it
  bound to loopback; do not expose or forward it to a network.

To uninstall, ask **Uninstall Codex Usage Lens startup configuration** before
removing the plugin, or run `control.ps1 -Action Uninstall`. It removes only its
owned desktop/login shortcuts and stops the helper. It leaves local state/code
for optional manual cleanup. Removing or disabling the Codex plugin stops a
running 0.2.x helper but does not itself delete the shortcut files.

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
