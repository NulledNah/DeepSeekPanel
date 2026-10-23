# DeepSeekPanel

Adds a small DeepSeek usage panel to the OpenCode desktop app: balance, total
cost, and cost / API requests / tokens for a selected period, with a daily chart
and an API key filter.

It works by patching the packaged `app.asar` (append-only and reversible). Data
comes from the DeepSeek Platform account session, captured automatically when you
log in from the integrated window.

Recommended release: **v1.1.1** (stable).

## Features

- DeepSeek login in an integrated window; the session is captured automatically.
- Balance, total cost, and period cost / API requests / tokens.
- Free credit (granted balance) shown when present, with a hover explaining it is
  used before the topped-up balance.
- Top up button in the balance card (with external link arrow): opens the DeepSeek
  top up page in the browser; the balance is refreshed when the OpenCode window
  regains focus.
- Daily cost or token chart (Cost / Token toggle).
- Time range filter (today, yesterday, 7/30 days, this month, last month, custom)
  with a calendar range picker, plus an API key filter.
- Daily chart with a metric selector (cost / tokens) and an API requests mode
  (area chart), plus a model selector: stacked per-model bars, or a two chart
  view (API requests and tokens) when a single model is selected.
- Status dot on the launcher (based on the available balance = topped-up + free
  credit, in USD): green above $1, yellow between $0.50 and $1, red below $0.50,
  black at $0, hidden when not logged in.
- Follows the system / OpenCode language (English fallback).
- Flat styling using OpenCode theme variables.

## Requirements

- OpenCode desktop (Electron) installed.
- Node.js 18 or newer (to run the installer).
- A DeepSeek Platform account.

## Compatibility

- Current OpenCode desktop UI: use this release (v1.1.1). The button is placed
  in the prompt bar, after the model / effort controls.
- Older OpenCode desktop UI (bottom-left rail with Settings / Help): use the
  previous release, **v1.0.12**, where the button sits above the settings and
  help icons.

The installer and the shared addon loader are the same as v1.0.12, so installing
over it is fine.

## Apply the patch

Close OpenCode first.

    cd DeepSeekPanel
    node apply.js install

Start OpenCode. The DeepSeek button appears in the prompt bar at the bottom of
the chat, right after the model / effort controls (centered in the free space
before the send button). Click it and log in.

Other commands:

    node apply.js verify        # check the patched app.asar
    node apply.js status        # show install state
    node apply.js remove        # remove only this addon (keeps other addons)
    node apply.js restore-all   # restore the original app.asar (all addons)

`restore` is kept as an alias of `restore-all`.

## Remove / Restore

Close OpenCode first.

    node apply.js remove        # remove DeepSeek only
    node apply.js restore-all   # restore the original app.asar (all addons)

`remove` neutralises this addon's module and drops its preload and index.html
hooks without touching other addons. `restore-all` copies the pristine shared
backup (`resources/app.asar.ocaddons-backup`) back over `app.asar`, removing every
addon at once.

Addons share a single `main` entry (`out/main/oc-addons.js`) that loads the base
app and then each installed addon, so they can be installed and removed
independently and in any order.

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
- The version shown in the panel header is read from the `VERSION` file and
  injected at patch time; bump it for each release.

## Files

- `apply.js` - installer (install / remove / restore-all / status / verify).
- `deepseek-main.js` - main-process module (login window, token capture, usage
  proxy).
- `deepseek-panel.js` - renderer panel UI.
- `VERSION` - panel version shown in the UI (injected at patch time).
