# AGENTS.md

Instructions for a coding agent asked to build and install **AIM for Slack** for its user. Follow these steps in order. Every step has a check, so you can prove it worked instead of assuming.

## What you're building

A desktop app (Electron) that looks like AOL Instant Messenger 5.5. It shows the user's Slack DMs, group DMs and channels as a Buddy List, with pop-up IM windows. It runs on **macOS and Windows**.

It does **not** use a Slack API token or a Slack app. By default ("built-in Slack"), AIM runs Slack's own web client in a hidden window, where the user signs in once like in a browser. AIM then calls Slack's Web API from inside that page. An optional "desktop app" connection borrows the Slack desktop app instead. See README.md, "How it works".

The result is identical for everyone: the same code, the same pinned Electron (44.5.1), and the same sounds and art (in `assets/`, committed).

## 1. Check the requirements

macOS:
```sh
sw_vers -productName      # macOS
node -v                   # v20 or newer
```

Windows (PowerShell):
```powershell
(Get-CimInstance Win32_OperatingSystem).Caption   # Windows 10 or 11
node -v                                           # v20 or newer
```

- If Node is missing or older than 20, ask the user before installing it (`brew install node` on macOS, `winget install OpenJS.NodeJS.LTS` on Windows).
- The user needs a Slack account. The Slack desktop app is **not** required.
- Linux isn't supported.

## 2. Install dependencies

```sh
npm ci
```

Use `npm ci`, not `npm install`, so the lockfile's exact versions are used.

## 3. Run the self-test

```sh
npm run check
```

This does three things:
1. Scans the repo for anything that looks like a Slack credential.
2. Syntax-checks the code.
3. Boots the real app against a built-in **fake workspace** ("Cobalt Coffee Co."). Nothing touches Slack. It signs on, renders the Buddy List, opens an IM, sends a message, opens Preferences, and exits.

- **Pass:** the last line is JSON with `"ok":true`, and the exit code is 0.
- **Fail:** `"ok":false` with a `why` and the checks that ran, and the exit code is 1. Don't continue past a failure.

When there's no screen (SSH, CI), GPU warnings in the output are expected and harmless.

## 4. Build and install

```sh
npm run install-app
```

- **macOS:** builds `dist/AIM.app`, ad-hoc signs it, and copies it to `/Applications/AIM.app`. Check with `ls -d /Applications/AIM.app`.
- **Windows:** builds `dist\AIM-Setup-<version>.exe` and runs it silently. That installs per user to `%LOCALAPPDATA%\Programs\AIM\AIM.exe` and adds Start-menu and desktop shortcuts. Check with `Test-Path "$env:LOCALAPPDATA\Programs\AIM\AIM.exe"`.

`npm run build` builds without installing. A running AIM is quit first.

## 5. First launch (needs the user)

Open AIM (`open /Applications/AIM.app` on macOS, or the AIM shortcut on Windows), then tell the user:
1. Click **Sign On**.
2. A **"Sign in to Slack - AIM"** window opens. The user signs in to their workspace the way they would in a browser: email code, password, or company single sign-on. **Never sign in for them or ask for their password.** When sign-in finishes, the window hides itself and the Buddy List appears.
3. Double-click a buddy to IM them.
4. Optionally, open Preferences (My AIM > Preferences, or the Setup button) and click **Test Banner** so the OS asks permission for notifications.

AIM remembers the sign-in. My AIM > Switch Slack Account signs out.

To try the app without Slack, run `npm run demo`.

### If the workplace blocks Slack in the browser

Have the user switch to Preferences > Connection > **The Slack desktop app**, then reopen AIM. This needs the Slack desktop app installed and signed in: from slack.com/downloads, and on Windows not the Microsoft Store version. On Sign On, AIM asks before restarting Slack with a local debug port. **Don't quit or relaunch the user's Slack yourself.** Let AIM's dialog do it.

## Rules

- **Don't modify the Slack desktop app** (`Slack.app`, `slack.exe`, `app.asar`, or its Electron fuses). This project never needs it, and patching it breaks Slack's code signature.
- **Don't ask the user for a Slack token or to create a Slack app.** That isn't how this works, and many workspaces block custom apps.
- **Don't change the user's Slack settings** (notifications, status) except through AIM's own UI when the user uses it.
- **Keep credentials out of the repo.** `npm run check` fails on anything that looks like a Slack token or cookie. The built-in Slack session lives in AIM's userData folder: `~/Library/Application Support/aim-for-slack/` on macOS, `%APPDATA%\aim-for-slack\` on Windows. Never copy it anywhere.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Please update your browser" in the Slack window | Electron is too old for Slack. Make sure `npm ci` installed the pinned Electron (`npx electron --version` should print v44.5.1). |
| The sign-in window says to use the Slack app, or SSO is blocked | The workspace blocks browser access. Use the desktop-app connection (see above). |
| The Sign On box says "Click Sign On to connect Slack" | Normal before the first sign-in, or after Switch Slack Account. |
| Wrong workspace | My AIM > Show Slack Window, switch workspace there, then quit AIM and sign on again. |
| macOS blocks AIM.app on first open | System Settings > Privacy & Security > "Open Anyway". It's ad-hoc signed because it was built locally. |
| Windows SmartScreen warns | "More info" > "Run anyway". The installer is unsigned because it was built locally. |
| No notification banners | Allow AIM in the OS notification settings, then use Test Banner. Banners only show while AIM isn't in front. |
| Buddy List is missing people | It mirrors Slack's sidebar (open DMs, group DMs, joined channels). To IM anyone else, click IM with nobody selected. |
| Desktop-app connection: port 9333 in use | Find the other app with `lsof -i :9333` (macOS) or `netstat -ano \| findstr 9333` (Windows). The port is `PORT` in `bridge.js`. |

## Code map

| File | What it does |
|---|---|
| `main.js` | Electron main process: windows, live events, notifications, IPC, choosing the connection, starting Slack (desktop mode), `--demo` and `--smoke` |
| `embedded.js` | Built-in Slack connection (`EmbeddedSlackBridge`), the default |
| `bridge.js` | Desktop-app connection (`SlackBridge`) over the debug port, plus the shared in-page API helper |
| `demo.js` | Fake workspace with the same interface (`DemoBridge`), used by demo mode and the self-test |
| `settings.js` | Preferences stored as JSON in userData |
| `preload.js` | The `window.aim` bridge for the UI |
| `ui/` | Windows: `signon.html`, `buddylist.html`, `im.html`, `prefs.html`, with shared `xp.css` and `common.js` |
| `assets/` | Original AIM 5.5 sounds and art (see NOTICE.md) and the app icons (`.icns`, `.ico`) |
| `scripts/build.mjs` | `npm run build` / `install-app`: the macOS app or the Windows installer |
| `scripts/build-mac.sh` | The macOS app build (called by build.mjs) |
| `scripts/check-secrets.mjs` | Credential scan (part of `npm run check`) |
| `scripts/screenshot.mjs`, `scripts/compose_screenshots.py` | How the README screenshots were made (demo mode, fake data) |
