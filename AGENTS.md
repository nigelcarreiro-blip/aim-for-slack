# AGENTS.md

Instructions for a coding agent asked to build and install **AIM for Slack** for its user. Follow these steps in order. Every step has a check, so you can prove it worked instead of assuming.

## What you're building

A macOS app (`AIM.app`, Electron) that looks like AOL Instant Messenger 5.5. It shows the user's Slack DMs, group DMs and channels as a Buddy List, with pop-up IM windows. It does **not** use a Slack API token or a Slack app. It connects to the user's already signed-in **Slack desktop app** over Chromium's local debug port (`127.0.0.1:9333`) and calls Slack's Web API from inside Slack's own page. See README.md, "How it works".

The finished result is identical for everyone: the same code, the same pinned Electron (33.4.11), and the same sounds and art (in `assets/`, committed).

## 1. Check the requirements

```sh
sw_vers -productName                      # must print macOS
node -v                                   # must be v20 or newer
ls -d /Applications/Slack.app             # the Slack desktop app must be installed
```

- If Node is missing or older than 20, ask the user before installing it (for example `brew install node`).
- If Slack isn't installed, stop and tell the user to install it from slack.com/downloads and sign in. The browser version of Slack won't work.
- Windows and Linux aren't supported.

## 2. Install dependencies

```sh
npm ci
```

Use `npm ci`, not `npm install`, so the lockfile's exact versions are used.

## 3. Run the self-test

```sh
npm run check
```

This syntax-checks the code, then boots the real app against a built-in **fake workspace** ("Cobalt Coffee Co."). Nothing touches the user's Slack. It signs on, renders the Buddy List, opens an IM, sends a message, opens Preferences, and exits.

- **Pass:** the last line is JSON with `"ok":true`, and the exit code is 0.
- **Fail:** `"ok":false` with a `why` and the checks that ran, and the exit code is 1. Don't continue past a failure.

## 4. Build and install

```sh
npm run install-app      # builds dist/AIM.app, ad-hoc signs it, copies it to /Applications/AIM.app
ls -d /Applications/AIM.app
```

To build without installing, use `npm run build` (output: `dist/AIM.app`). If an older AIM.app is running, the install step quits it first.

## 5. First launch (needs the user)

```sh
open /Applications/AIM.app
```

Tell the user:
1. Click **Sign On**. Their Slack handle is pre-filled as the screen name, and the password field is decorative.
2. If Slack is already running normally, AIM shows a dialog: **"AIM needs to restart Slack once."** The user has to click **Restart Slack**. Slack quits and reopens with the local bridge, still signed in.
3. The Buddy List opens. Double-click a buddy to IM them.
4. Optionally, open Preferences (My AIM > Preferences, or the Setup button) and click **Test Banner** so macOS asks permission for notifications.

**Don't quit or relaunch the user's Slack yourself.** Let AIM's dialog do it, so the user gets to agree to it.

To try the app without Slack, run `npm run demo`.

## Rules

- **Don't modify** `/Applications/Slack.app`, its `app.asar`, or its Electron fuses. Slack's integrity checks are on, and patching it breaks the code signature and signs the user out. This project never needs it.
- **Don't ask the user for a Slack token or to create a Slack app.** That isn't how this works, and many workspaces block custom apps.
- **Don't change the user's Slack settings** (notifications, status) except through AIM's own UI when the user uses it.
- **Keep secrets and personal data out of the repo.** Settings live in `~/Library/Application Support/aim-for-slack/`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Sign On says "Slack (not running)" | Slack isn't open with the bridge. Click Sign On anyway: AIM offers to restart Slack. |
| "Could not find a signed-in Slack workspace" | Open a workspace in the Slack app and make sure it has finished loading, then sign on again. |
| Wrong workspace shown | AIM uses whichever workspace is open in Slack. Switch workspaces in Slack, then quit AIM and sign on again. |
| Port 9333 already in use | Another app is using it. Find it with `lsof -i :9333`. The port is set in `bridge.js` (`PORT`). |
| macOS blocks AIM.app on first open | It's ad-hoc signed because it was built locally. Open it from System Settings > Privacy & Security ("Open Anyway"). |
| No notification banners | Allow AIM in System Settings > Notifications, then use Test Banner. Banners only show while AIM isn't the app in front. |
| Buddy List is missing people | It shows the same DMs, group DMs and channels as Slack's sidebar. To IM anyone else, click IM with nobody selected. |

## Code map

| File | What it does |
|---|---|
| `main.js` | Electron main process: windows, live events, notifications, IPC, starting Slack, `--demo` and `--smoke` |
| `bridge.js` | Slack connection over the debug port (`SlackBridge`) |
| `demo.js` | Fake workspace with the same interface (`DemoBridge`), used by demo mode and the self-test |
| `settings.js` | Preferences stored as JSON in userData |
| `preload.js` | The `window.aim` bridge for the UI |
| `ui/` | Windows: `signon.html`, `buddylist.html`, `im.html`, `prefs.html`, with shared `xp.css` and `common.js` |
| `assets/` | Original AIM 5.5 sounds and art (see NOTICE.md) and the app icon |
| `scripts/build-mac.sh` | Builds and signs `dist/AIM.app`; `--install` copies it to /Applications |
| `scripts/screenshot.mjs`, `scripts/compose_screenshots.py` | How the README screenshots were made (demo mode, fake data) |
