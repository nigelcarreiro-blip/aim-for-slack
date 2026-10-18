// EmbeddedSlackBridge ("built-in Slack", the default connection).
// AIM runs Slack's own web client in a hidden window with its own saved sign-in, and listens to it
// through Electron's built-in debugger. No Slack desktop app, no token, no open port.
const { EventEmitter } = require('events');
const { BrowserWindow, session, shell } = require('electron');
const { FIND_TEAM, apiExpression } = require('./bridge');

// AIM_SLACK_PARTITION lets tests use a throwaway sign-in without touching the real one.
const PARTITION = process.env.AIM_SLACK_PARTITION || 'persist:slack';
const HOME = 'https://app.slack.com/client';
const SIGNED_IN = /^https:\/\/app\.slack\.com\/client\/[TE][A-Z0-9]+/;
const SIGN_IN_PAGE = /slack\.com\/(workspace-signin|signin|get-started|check-email|ssb\/signin)/;

class EmbeddedSlackBridge extends EventEmitter {
  constructor() {
    super();
    this.win = null;
    this.connected = false;
    this.team = null;
    this.self = null;
    this.quitting = false;
  }

  ensureWindow() {
    if (this.win && !this.win.isDestroyed()) return this.win;
    const ses = session.fromPartition(PARTITION);
    // A plain Chrome user agent: Slack's web client doesn't need to know it's inside Electron.
    ses.setUserAgent(ses.getUserAgent().replace(/ (Electron|aim-for-slack|AIM)\/\S+/g, ''));
    // The hidden Slack must never show its own notifications or ask for the camera/mic in the background.
    ses.setPermissionRequestHandler((_wc, permission, cb) => cb(!['notifications', 'media', 'geolocation'].includes(permission)));

    this.win = new BrowserWindow({
      width: 1100, height: 760, show: false, title: 'Slack (inside AIM)',
      webPreferences: { partition: PARTITION, backgroundThrottling: false },
    });
    const wc = this.win.webContents;
    wc.setAudioMuted(true);
    // Keep the slack:// "open the desktop app" hand-off from leaving AIM; let sign-in popups (SSO) open.
    wc.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('slack:')) return { action: 'deny' };
      if (/^https:\/\/([a-z0-9-]+\.)*slack\.com\//.test(url) || /accounts\.google|login\.microsoftonline|okta|onelogin|auth0|duosecurity/.test(url)) {
        return { action: 'allow', overrideBrowserWindowOptions: { webPreferences: { partition: PARTITION } } };
      }
      shell.openExternal(url);
      return { action: 'deny' };
    });
    wc.on('will-navigate', (e, url) => { if (url.startsWith('slack:')) e.preventDefault(); });
    // Closing the Slack window only hides it; AIM still needs it.
    this.win.on('close', e => { if (!this.quitting) { e.preventDefault(); this.win.hide(); } });
    this.win.on('closed', () => {
      this.win = null;
      if (this.connected) { this.connected = false; this.emit('disconnected'); }
    });

    wc.debugger.attach('1.3');
    wc.debugger.on('message', (_e, method, params) => {
      if (method !== 'Network.webSocketFrameReceived') return;
      let ev;
      try { ev = JSON.parse(params.response.payloadData); } catch { return; }
      if (ev && ev.type) this.emit('event', ev);
    });
    wc.debugger.sendCommand('Network.enable');
    this.win.loadURL(HOME);
    return this.win;
  }

  // Resolves with the workspace id once Slack's web client is signed in, or null.
  // Slack's web client can take a while to boot cold, so this waits for a real answer:
  // signed in (a workspace session exists), or, with stopOnSignInPage, Slack's sign-in page holding steady.
  async waitForSignIn(timeoutMs, { stopOnSignInPage = false } = {}) {
    const end = Date.now() + timeoutMs;
    let onSignInSince = null;
    while (Date.now() < end) {
      if (!this.win || this.win.isDestroyed()) throw new Error('The Slack window was closed.');
      const url = this.win.webContents.getURL();
      if (SIGNED_IN.test(url)) {
        onSignInSince = null;
        const team = await this.eval(`(${FIND_TEAM} || {}).id || null`).catch(() => null);
        if (team) return team;
      } else if (stopOnSignInPage && SIGN_IN_PAGE.test(url)) {
        onSignInSince = onSignInSince || Date.now();
        if (Date.now() - onSignInSince > 2500) return null;
      }
      await new Promise(r => setTimeout(r, 500));
    }
    return null;
  }

  // interactive: show Slack's sign-in page if needed. Otherwise fail quietly when signed out.
  // afterImport: Slack passes through its sign-in page while it picks up copied cookies, so don't treat that as signed out.
  async connect({ interactive = true, waitMs = 45000, afterImport = false } = {}) {
    this.ensureWindow();
    let team = await this.waitForSignIn(waitMs, { stopOnSignInPage: !afterImport });
    this.knownSignedOut = !team;
    if (!team) {
      if (!interactive) throw new Error('Not signed in to Slack yet.');
      this.emit('needs-sign-in');
      this.win.setTitle('Sign in to Slack - AIM');
      this.win.show();
      this.win.focus();
      team = await this.waitForSignIn(10 * 60 * 1000);
      if (!team) throw new Error('Slack sign-in timed out.');
      this.win.hide();
    }
    this.team = team;
    const auth = await this.api('auth.test');
    if (!auth.ok) throw new Error('Slack auth failed: ' + auth.error);
    this.self = { id: auth.user_id, name: auth.user, team: auth.team };
    this.connected = true;
    this.emit('connected', this.self);
  }

  eval(expression) { return this.win.webContents.executeJavaScript(expression, true); }

  api(method, params = {}) { return this.eval(apiExpression(method, params)); }

  // Talk / Get Info / thread links: show the built-in Slack at that conversation.
  openConversation(id) {
    this.ensureWindow();
    this.win.setTitle('Slack (inside AIM)');
    this.win.loadURL(`https://app.slack.com/client/${this.team}/${id}`);
    this.win.show();
    this.win.focus();
  }

  showWindow() { this.ensureWindow(); this.win.show(); this.win.focus(); }

  // "Copy sign-in from Slack app": cookies read from the desktop app (via CDP Network.getCookies)
  // are copied into AIM's own Slack session, then the built-in Slack reloads signed in.
  // startUrl: the workspace's own address (e.g. https://acme.slack.com/). With copied cookies it signs in
  // within seconds, while app.slack.com/client stalls on the sign-in page.
  async importCookies(cookies, startUrl) {
    const slackCookies = cookies.filter(c => /(^|\.)slack\.com$/.test(c.domain.replace(/^\./, '')));
    this.ensureWindow();
    const wc = this.win.webContents;
    // Same CDP call the cookies came from, so every attribute (httpOnly, sameSite, expiry) carries over exactly.
    await wc.debugger.sendCommand('Network.setCookies', {
      cookies: slackCookies.map(c => ({
        name: c.name, value: c.value, domain: c.domain, path: c.path, secure: c.secure, httpOnly: c.httpOnly,
        ...(c.sameSite && { sameSite: c.sameSite }), ...(c.expires > 0 && { expires: c.expires }),
      })),
    });
    await session.fromPartition(PARTITION).cookies.flushStore();
    this.knownSignedOut = false;
    await this.win.loadURL(startUrl || HOME).catch(() => {});
    return slackCookies.length;
  }

  // "Switch Slack account": forget the built-in sign-in.
  async signOut() {
    await session.fromPartition(PARTITION).clearStorageData();
    this.connected = false;
    if (this.win && !this.win.isDestroyed()) { this.quitting = true; this.win.destroy(); this.quitting = false; }
  }

  close() { this.quitting = true; if (this.win && !this.win.isDestroyed()) this.win.destroy(); }
}

module.exports = { EmbeddedSlackBridge };
