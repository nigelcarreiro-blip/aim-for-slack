# AIM for Slack

AOL Instant Messenger 5.5, the 2004 Windows XP version, as a front end for Slack.

![AIM for Slack](screenshots/aim-hero.png)

You get a Buddy List window and one Instant Message window per conversation, and new IMs pop open the way they used to. It uses the original door-open and door-slam sounds and the IM chime. Your regular Slack app keeps working as usual alongside it.

## Build it with your coding agent

Point Claude Code, Codex, Cursor, or any coding agent at this repo and say:

> Build and install AIM for Slack from this repo. Follow AGENTS.md.

[AGENTS.md](AGENTS.md) walks the agent through the requirements, a self-test (`npm run check`), the build, and the first launch. Every step has a pass/fail check.

## How it works

AIM for Slack doesn't need a Slack API token or a custom Slack app, so there's nothing for a workspace admin to approve.

**Built-in Slack (the default).** AIM runs Slack's regular web version in a hidden window with its own saved sign-in. The first time you sign on, AIM offers to **copy the sign-in from your Slack app**. That takes about 10 seconds: Slack restarts for a moment while AIM reads its session, then goes back to normal. You can also sign in yourself, the same way you would in a browser, including company single sign-on. After that, AIM:
- calls Slack's Web API **from inside that page**, using its own session, so the token never leaves it
- picks up live messages, typing, and presence by watching the websocket traffic the page already receives, through Electron's built-in debugger

There's no open port, the Slack desktop app doesn't need to be installed, and your regular Slack stays completely separate. Talk, Get Info, and thread links open that built-in Slack window at the right conversation.

**Desktop app connection (optional, in Preferences > Connection).** AIM borrows the Slack desktop app you're already signed in to instead. AIM asks once before restarting Slack with a local-only debug port (`127.0.0.1:9333`), and Slack has to stay open. Use this if your workplace blocks Slack in the browser.

## Try it without Slack

`npm run demo` runs AIM on a fake workspace, so nothing touches your real Slack.

## Requirements

- macOS or Windows 10/11
- Node.js 20 or newer
- A Slack account on any workspace. Regular workspaces and Enterprise Grid should both work.

The Slack desktop app is only needed for the optional desktop-app connection. On Windows, the desktop-app connection doesn't work with the Microsoft Store version of Slack.

## Install

```sh
git clone https://github.com/nigelcarreiro-blip/aim-for-slack.git
cd aim-for-slack
npm ci
npm run check             # self-test on a fake workspace; must end with "ok":true
npm run install-app       # build and install AIM
```

- **macOS:** installs `/Applications/AIM.app`. It's ad-hoc signed because you built it yourself, so the first time you open it macOS may ask you to confirm in System Settings > Privacy & Security.
- **Windows:** builds `dist\AIM-Setup-<version>.exe` and runs it silently. AIM is installed per user, with Start-menu and desktop shortcuts. Windows SmartScreen may warn about an unsigned app: choose "More info" > "Run anyway".

`npm run build` builds without installing. `npm start` runs it from source.

## What's in it

- **Sign On window**: your Slack handle is your screen name. Tick Auto-login to skip it next time.
- **Buddy List**: groups that fold open and closed.
  - Buddies: people you have DMs open with, the ones online right now.
  - Group Chats: your group DMs.
  - Chat Rooms: your channels.
  - Bots
  - Offline
  
  Double-click a buddy to IM them. Click **IM** with nobody selected to message anyone in the workspace.
- **Instant Message windows**:
  - screen names in red (you) and blue (them), with timestamps
  - the File / Edit / Insert / People menus
  - B / I / U formatting, which becomes Slack bold, italic, and strikethrough
  - smileys, and a running-man Send button
  - Warn: a joke that only raises a local "Warning Level" and never touches Slack
- **Pop-ups**: a new DM or group DM opens its window without stealing focus and plays the incoming-message chime. Channels stay quiet unless someone @mentions you.
- **Away messages**: setting one sets your Slack status and presence.
- **Preferences** (My AIM > Preferences, or Setup):
  - pop-up behavior for IMs, group chats, and @mentions
  - whether @here and @channel count as mentions
  - notification banners
  - sounds
  - which Slack connection to use

AIM never changes your Slack notification settings.

Threads, huddles, canvases, and file uploads stay in Slack. AIM shows "(2 replies in Slack)" links, and Talk / Get Info jump to that conversation in Slack.

## Caveats

- **Unofficial.** This isn't made by or affiliated with Slack or AOL. It uses your own Slack sign-in the way a browser does. Check your workplace's IT policy before using it on a work account.
- **The built-in Slack stays signed in** inside AIM's own app data. My AIM > Switch Slack Account signs it out.
- **The desktop-app connection opens a local debug port.** While Slack runs with it, any program on your computer can use that port to read your Slack session. Built-in Slack doesn't do this.
- **It can break.** It depends on Slack's internal web client, which Slack can change at any time.

## Credits

The sounds and artwork in `assets/sounds` and `assets/img` come from AOL Instant Messenger 5.5.3595 (2004). See [NOTICE.md](NOTICE.md). Everything else is MIT licensed; see [LICENSE](LICENSE).
