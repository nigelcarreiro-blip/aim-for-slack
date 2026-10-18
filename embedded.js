// EmbeddedSlackBridge ("built-in Slack", the default connection).
// AIM runs Slack's own web client in a hidden window with its own saved sign-in, and listens to it
// through Electron's built-in debugger. No Slack desktop app, no token, no open port.
const { EventEmitter } = require('events');
const { BrowserWindow, session, shell } = require('electron');
const { FIND_TEAM, apiExpression } = require('./bridge');

const PARTITION = 'persist:slack';
const HOME = 'https://app.slack.com/client';
const SIGNED_IN = /^https:\/\/app\.slack\.com\/client\/[TE][A-Z0-9]+/;

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

  // Resolves once Slack's web client is signed in and has a session for a workspace.
  async waitForSignIn(timeoutMs) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      if (!this.win || this.win.isDestroyed()) throw new Error('The Slack window was closed.');
      const url = this.win.webContents.getURL();
      if (SIGNED_IN.test(url) && !this.win.webContents.isLoading()) {
        const team = await this.eval(`(${FIND_TEAM} || {}).id || null`).catch(() => null);
        if (team) return team;
      }
      await new Promise(r => setTimeout(r, 500));
    }
    return null;
  }

  // interactive: show Slack's sign-in page if needed. Otherwise fail quietly when signed out.
  async connect({ interactive = true } = {}) {
    this.ensureWindow();
    let team = await this.waitForSignIn(interactive ? 12000 : 8000);
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

  // "Switch Slack account": forget the built-in sign-in.
  async signOut() {
    await session.fromPartition(PARTITION).clearStorageData();
    this.connected = false;
    if (this.win && !this.win.isDestroyed()) { this.quitting = true; this.win.destroy(); this.quitting = false; }
  }

  close() { this.quitting = true; if (this.win && !this.win.isDestroyed()) this.win.destroy(); }
}

module.exports = { EmbeddedSlackBridge };
