# DeepSeekPanel

Adds a small DeepSeek usage panel to the OpenCode desktop app: balance, total
cost, and cost / API requests / tokens for a selected period, with a daily chart
and an API key filter.

It works by patching the packaged `app.asar` (append-only and reversible). Data
comes from the DeepSeek Platform account session, captured automatically when you
log in from the integrated window.

## Features

- DeepSeek login in an integrated window; the session is captured automatically.
- Balance, total cost, and period cost / API requests / tokens.
- Daily cost or token chart (Cost / Token toggle).
- Time range filter (today, yesterday, 7/30 days, this month, last month, custom)
  with a calendar range picker, plus an API key filter.
- Daily chart with a metric selector (cost / tokens) and an API requests mode
  (area chart), plus a model selector: stacked per-model bars, or a two chart
  view (API requests and tokens) when a single model is selected.
- Status dot on the launcher: green above 1, yellow between 0.50 and 1, red below
  0.50, black at 0, hidden when not logged in.
- Follows the system / OpenCode language (English fallback).
- Flat styling using OpenCode theme variables.

## Requirements

- OpenCode desktop (Electron) installed.
- Node.js 18 or newer (to run the installer).
- A DeepSeek Platform account.

## Apply the patch

Close OpenCode first.

    cd DeepSeekPanel
    node apply.js install

Start OpenCode. The DeepSeek button appears in the bottom-left rail, above the
settings and help icons. Click it and log in.

Other commands:

    node apply.js verify    # check the patched app.asar
    node apply.js status    # show install state

## Restore

Close OpenCode first.

    node apply.js restore

Restores the original `app.asar` from the backup created during install
(`resources/app.asar.deepseek-backup`).

## Notes

- An OpenCode update replaces `app.asar`; run `node apply.js install` again after
  updating.
- Login opens a DeepSeek window and captures the account session token, stored
  locally in the OpenCode user data folder.
- After the first login the session is remembered across restarts: the DeepSeek
  cookies are persisted on disk (with a file backup as a fallback), so you
  normally do not need to log in again.
- The panel shows the last loaded data immediately on open and refreshes in the
  background, also while the panel is closed and at startup, so the launcher
  status dot stays current. The refresh interval is well above the cache TTL to
  avoid rate limiting.

## Files

- `apply.js` - installer (install / restore / status / verify).
- `deepseek-main.js` - main-process module (login window, token capture, usage
  proxy).
- `deepseek-panel.js` - renderer panel UI.
