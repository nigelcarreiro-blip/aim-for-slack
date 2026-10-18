// SlackBridge ("desktop app" connection): talks to the logged-in Slack desktop app over its Chromium debug port.
// The default connection is EmbeddedSlackBridge in embedded.js; both share FIND_TEAM and apiExpression.
// API calls run inside Slack's own page (its session token never leaves Slack),
// and live events come from watching Slack's own websocket frames.
const { EventEmitter } = require('events');
const WebSocket = globalThis.WebSocket || require('ws');

const PORT = 9333;

// Runs inside Slack's page: finds the session for the workspace currently open in Slack.
// Handles regular workspaces (/client/T...), Enterprise Grid (/client/E...), and several signed-in workspaces.
const FIND_TEAM = `(() => {
  const id = (location.pathname.match(/\\/client\\/([TE][A-Z0-9]+)/) || [])[1];
  const teams = JSON.parse(localStorage.getItem('localConfig_v2') || '{}').teams || {};
  const all = Object.values(teams).filter(t => t && t.token);
  return teams[id] || all.find(t => t.id === id || t.enterprise_id === id) || (all.length === 1 ? all[0] : null);
})()`;

class SlackBridge extends EventEmitter {
  constructor() {
    super();
    this.ws = null;
    this.nextId = 0;
    this.pending = new Map();
    this.connected = false;
    this.team = null;
    this.self = null;
  }

  async targets() {
    const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
    return res.json();
  }

  async connect() {
    const list = await this.targets();
    const page = list.find(p => p.type === 'page' && /app\.slack\.com\/client\/[TE]/.test(p.url));
    if (!page) throw new Error('Slack is not open on the debug port');
    this.ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { this.ws.onopen = resolve; this.ws.onerror = reject; });
    this.ws.onmessage = e => this.onCdp(JSON.parse(e.data));
    this.ws.onclose = () => {
      this.connected = false;
      for (const { reject } of this.pending.values()) reject(new Error('Slack connection closed'));
      this.pending.clear();
      this.emit('disconnected');
    };
    await this.send('Network.enable');
    this.team = await this.eval(`(${FIND_TEAM} || {}).id`);
    if (!this.team) throw new Error('Could not find a signed-in Slack workspace. Open one in the Slack app first.');
    const auth = await this.api('auth.test');
    if (!auth.ok) throw new Error('Slack auth failed: ' + auth.error);
    this.self = { id: auth.user_id, name: auth.user, team: auth.team };
    this.connected = true;
    this.emit('connected', this.self);
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  onCdp(m) {
    if (m.id && this.pending.has(m.id)) {
      const { resolve, reject } = this.pending.get(m.id);
      this.pending.delete(m.id);
      if (m.error) reject(new Error(m.error.message)); else resolve(m.result);
      return;
    }
    if (m.method === 'Network.webSocketFrameReceived') {
      let ev;
      try { ev = JSON.parse(m.params.response.payloadData); } catch { return; }
      if (ev && ev.type) this.emit('event', ev);
    }
  }

  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed');
    return r.result.value;
  }

  api(method, params = {}) { return this.eval(apiExpression(method, params)); }

  // Talk / Get Info / thread links: hand off to the Slack desktop app.
  openConversation(id) { require('electron').shell.openExternal(`slack://channel?team=${this.team}&id=${id}`); }
}

// JS that calls a Slack Web API method from inside Slack's page, using its own session.
function apiExpression(method, params = {}) {
  return `(async () => {
    const t = ${FIND_TEAM};
    if (!t) return { ok: false, error: 'no_workspace' };
    const fd = new FormData();
    fd.append('token', t.token);
    const p = ${JSON.stringify(params)};
    for (const k in p) fd.append(k, typeof p[k] === 'object' ? JSON.stringify(p[k]) : String(p[k]));
    const res = await fetch('/api/${method}', { method: 'POST', body: fd, credentials: 'include' });
    return res.json();
  })()`;
}

module.exports = { SlackBridge, PORT, FIND_TEAM, apiExpression };
