// AIM 5.5 for Slack: Sign On window -> Buddy List window -> one Instant Message window per conversation.
const { app, BrowserWindow, ipcMain, shell, screen, Notification, dialog } = require('electron');
const path = require('path');
const { execFile } = require('child_process');
const { SlackBridge, PORT } = require('./bridge');
const settings = require('./settings');

// `npm run demo` (or --demo) swaps in a fake workspace instead of the real Slack app.
const DEMO = !!process.env.AIM_DEMO || process.argv.includes('--demo');
const slack = DEMO ? new (require('./demo').DemoBridge)() : new SlackBridge();
const users = new Map();      // user id -> { id, name, real, handle, image, deleted, bot }
const handles = new Map();    // slack handle -> user id (for group DM names)
const convs = new Map();      // conversation id -> { id, kind: 'im'|'mpim'|'channel', name, user, private }
const presence = new Map();   // user id -> 'active' | 'away'
const unread = new Map();     // conversation id -> { unread: bool, mentions: n }
const imWindows = new Map();  // conversation id -> BrowserWindow
let signonWin = null, buddyWin = null, prefsWin = null;
let cascade = 0;

const PRESENCE_POLL_MS = 60_000;
const COUNTS_POLL_MS = 20_000;

function chromeWindow(file, opts) {
  const win = new BrowserWindow({
    frame: false, resizable: true, show: false, backgroundColor: '#ece9d8',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
    ...opts,
  });
  win.loadFile(path.join(__dirname, 'ui', file), { query: opts.query || {} });
  win.once('ready-to-show', () => (opts.inactive ? win.showInactive() : win.show()));
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) { e.preventDefault(); shell.openExternal(url); } });
  return win;
}

function broadcast(channel, payload) {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, payload);
}

// ---------- Slack data ----------

async function loadUsers() {
  let cursor = '';
  do {
    const r = await slack.api('users.list', { limit: 500, ...(cursor && { cursor }) });
    if (!r.ok) throw new Error('users.list: ' + r.error);
    for (const u of r.members) addUser(u);
    cursor = r.response_metadata?.next_cursor || '';
  } while (cursor);
}

function userName(id) { return users.get(id)?.name || id; }

function addUser(u) {
  users.set(u.id, {
    id: u.id, deleted: u.deleted, bot: u.is_bot || u.id === 'USLACKBOT',
    name: u.profile?.display_name || u.real_name || u.name,
    real: u.real_name || u.name, handle: u.name, image: u.profile?.image_48,
  });
  handles.set(u.name, u.id);
}

// External (Slack Connect) people aren't in users.list; look them up one by one.
async function loadMissingUsers(ids) {
  const missing = [...new Set(ids)].filter(id => id && !users.has(id));
  for (let i = 0; i < missing.length; i += 8) {
    await Promise.all(missing.slice(i, i + 8).map(async id => {
      const r = await slack.api('users.info', { user: id }).catch(() => null);
      if (r && r.ok) addUser(r.user);
    }));
  }
}

function addConversation(c) {
  if (c.is_im) {
    const u = users.get(c.user);
    if (!u || u.deleted) return;
    convs.set(c.id, { id: c.id, kind: 'im', user: c.user, name: u.name, bot: u.bot });
  } else if (c.is_mpim) {
    convs.set(c.id, { id: c.id, kind: 'mpim', name: mpimName(c.name), private: true });
  } else {
    convs.set(c.id, { id: c.id, kind: 'channel', name: c.name, private: !!c.is_private });
  }
}

// A DM or channel that isn't in the list yet (someone just messaged you): fetch it and add it.
async function ensureConversation(id) {
  if (convs.has(id)) return convs.get(id);
  const r = await slack.api('conversations.info', { channel: id }).catch(() => null);
  if (!r || !r.ok) return null;
  if (r.channel.is_im) await loadMissingUsers([r.channel.user]);
  addConversation(r.channel);
  broadcast('buddy-list', buddyListPayload());
  return convs.get(id);
}

async function loadConversations() {
  // Only what Slack's own sidebar shows (open DMs, group DMs and joined channels).
  const counts = await slack.api('client.counts', { thread_counts_by_channel: false });
  const visible = new Set([...(counts.channels || []), ...(counts.mpims || []), ...(counts.ims || [])].map(c => c.id));
  let cursor = '';
  do {
    const r = await slack.api('users.conversations', {
      types: 'public_channel,private_channel,mpim,im', exclude_archived: true, limit: 500, ...(cursor && { cursor }),
    });
    if (!r.ok) throw new Error('users.conversations: ' + r.error);
    const mine = r.channels.filter(c => visible.has(c.id));
    await loadMissingUsers(mine.filter(c => c.is_im).map(c => c.user));
    for (const c of mine) addConversation(c);
    cursor = r.response_metadata?.next_cursor || '';
  } while (cursor);
}

// "mpdm-alice--bob--me-1" -> "Alice Smith, Bob Jones"
function mpimName(raw) {
  const parts = raw.replace(/^mpdm-/, '').replace(/-\d+$/, '').split('--').filter(h => h !== slack.self.name);
  return parts.map(h => userName(handles.get(h)) || h).join(', ');
}

async function pollPresence(initial = false) {
  const ims = [...convs.values()].filter(c => c.kind === 'im' && !c.bot && c.user !== slack.self.id);
  for (let i = 0; i < ims.length; i += 8) {
    await Promise.all(ims.slice(i, i + 8).map(async c => {
      const r = await slack.api('users.getPresence', { user: c.user }).catch(() => null);
      if (!r || !r.ok) return;
      const prev = presence.get(c.user);
      presence.set(c.user, r.presence);
      if (!initial && prev && prev !== r.presence) broadcast('presence', { user: c.user, presence: r.presence, sound: true });
    }));
    if (initial) broadcast('presence-all', Object.fromEntries(presence));
  }
}

async function pollCounts() {
  const r = await slack.api('client.counts', { thread_counts_by_channel: false, org_wide_aware: true }).catch(() => null);
  if (!r || !r.ok) return;
  for (const list of [r.channels, r.mpims, r.ims]) {
    for (const c of list || []) unread.set(c.id, { unread: !!c.has_unreads, mentions: c.mention_count || 0 });
  }
  broadcast('unread', Object.fromEntries(unread));
}

function buddyListPayload() {
  return {
    self: { ...slack.self, display: userName(slack.self.id) },
    convs: [...convs.values()],
    presence: Object.fromEntries(presence),
    unread: Object.fromEntries(unread),
  };
}

// Slack mrkdwn needs names resolved before the renderer can show it.
function resolveMessage(m) {
  return {
    ts: m.ts, user: m.user || m.bot_id, thread: m.thread_ts && m.thread_ts !== m.ts,
    replies: m.reply_count || 0, subtype: m.subtype || null,
    name: m.user ? userName(m.user) : (m.username || m.bot_profile?.name || 'Bot'),
    self: m.user === slack.self.id,
    text: m.text || '',
    files: (m.files || []).map(f => ({ name: f.name || f.title, url: f.permalink })),
    attachments: (m.attachments || []).map(a => a.fallback || a.title || a.text).filter(Boolean),
    mentionNames: Object.fromEntries([...(m.text || '').matchAll(/<@([UW][A-Z0-9]+)/g)].map(x => [x[1], userName(x[1])])),
  };
}

// ---------- windows ----------

function openSignon() {
  signonWin = chromeWindow('signon.html', { width: 250, height: 470, resizable: false });
  signonWin.on('closed', () => { signonWin = null; if (!buddyWin) app.quit(); });
}

function openBuddyList() {
  const { workArea } = screen.getPrimaryDisplay();
  buddyWin = chromeWindow('buddylist.html', {
    width: 240, height: Math.min(640, workArea.height - 40),
    x: workArea.x + workArea.width - 260, y: workArea.y + 20, minWidth: 200, minHeight: 320,
  });
  buddyWin.on('closed', () => { buddyWin = null; app.quit(); });
}

function openPrefs() {
  if (prefsWin && !prefsWin.isDestroyed()) { prefsWin.show(); prefsWin.focus(); return; }
  prefsWin = chromeWindow('prefs.html', { width: 420, height: 470, resizable: false });
  prefsWin.on('closed', () => { prefsWin = null; });
}

function openIm(convId, { inactive = false } = {}) {
  const existing = imWindows.get(convId);
  if (existing && !existing.isDestroyed()) {
    if (!inactive) { existing.show(); existing.focus(); }
    return existing;
  }
  const { workArea } = screen.getPrimaryDisplay();
  const n = cascade++ % 8;
  const win = chromeWindow('im.html', {
    width: 470, height: 430, minWidth: 360, minHeight: 300,
    x: workArea.x + 60 + n * 26, y: workArea.y + 60 + n * 26,
    inactive, query: { conv: convId, popup: inactive ? '1' : '' },
  });
  imWindows.set(convId, win);
  win.on('closed', () => imWindows.delete(convId));
  return win;
}

// ---------- live events ----------

slack.on('event', ev => {
  if (ev.type === 'message' && ev.channel) {
    if (ev.subtype === 'message_changed' || ev.subtype === 'message_deleted') {
      imWindows.get(ev.channel)?.webContents.send('refresh');
      return;
    }
    if (ev.hidden || ev.thread_ts && ev.thread_ts !== ev.ts) return; // thread replies stay in Slack
    if (!convs.has(ev.channel)) { ensureConversation(ev.channel).then(c => c && slack.emit('event', ev)); return; }
    const conv = convs.get(ev.channel);
    const msg = resolveMessage(ev);
    const prefs = settings.load();
    const text = ev.text || '';
    const isIm = conv.kind !== 'channel';
    const mentioned = !isIm && !msg.self &&
      (text.includes(`<@${slack.self.id}>`) || (prefs.mentionHereChannel && /<!(here|channel)>/.test(text)));
    const alert = !msg.self && (isIm || mentioned);
    const wantsPop = conv.kind === 'im' ? prefs.popIms : conv.kind === 'mpim' ? prefs.popGroupIms : prefs.popMentions;

    let win = imWindows.get(ev.channel);
    // AIM behavior: a new IM pops its window open (without stealing focus).
    if (!win && alert && wantsPop) win = openIm(ev.channel, { inactive: true });
    if (win && !win.isDestroyed()) {
      win.webContents.send('message', msg);
      if (alert && !win.isFocused()) win.flashFrame?.(true);
    } else if (alert) {
      buddyWin?.webContents.send('play', 'imrcv');
    }
    if (alert && prefs.banners && !BrowserWindow.getFocusedWindow()) notify(conv, msg);
    if (!msg.self) {
      const u = unread.get(ev.channel) || { unread: false, mentions: 0 };
      if (!win || !win.isFocused()) unread.set(ev.channel, { unread: true, mentions: u.mentions + (mentioned ? 1 : 0) });
      broadcast('unread', Object.fromEntries(unread));
    }
  } else if (ev.type === 'presence_change') {
    const ids = ev.users || [ev.user];
    for (const id of ids) {
      const prev = presence.get(id);
      presence.set(id, ev.presence);
      if (prev && prev !== ev.presence) broadcast('presence', { user: id, presence: ev.presence, sound: true });
    }
  } else if (ev.type === 'user_typing' && ev.channel) {
    imWindows.get(ev.channel)?.webContents.send('typing', userName(ev.user));
  }
});

function plainText(m) {
  return m.text
    .replace(/<@([UW][A-Z0-9]+)(\|[^>]+)?>/g, (_, id) => '@' + userName(id))
    .replace(/<#[A-Z0-9]+\|([^>]+)>/g, '#$1')
    .replace(/<!(here|channel|everyone)[^>]*>/g, '@$1')
    .replace(/<([^|>]+)\|([^>]+)>/g, '$2')
    .replace(/<([^>]+)>/g, '$1')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    || (m.files.length ? '[file]' : '');
}

function notify(conv, msg) {
  if (!Notification.isSupported()) return;
  const title = conv.kind === 'channel' ? `${msg.name} in #${conv.name}` : conv.kind === 'mpim' ? `${msg.name} (${conv.name})` : msg.name;
  const n = new Notification({ title, body: plainText(msg).slice(0, 200), silent: true });
  n.on('click', () => openIm(conv.id));
  n.show();
}

slack.on('disconnected', () => {
  broadcast('status', 'Connection to Slack lost. Reconnecting...');
  const retry = () => slack.connect().then(() => broadcast('status', '')).catch(() => setTimeout(retry, 3000));
  setTimeout(retry, 3000);
});

// ---------- IPC ----------

ipcMain.handle('signon', async () => {
  if (!slack.connected) await connectOrLaunchSlack();
  await loadUsers();
  await loadConversations();
  openBuddyList();
  signonWin?.close();
  pollCounts();
  pollPresence(true);
  setInterval(pollPresence, PRESENCE_POLL_MS);
  setInterval(pollCounts, COUNTS_POLL_MS);
  return true;
});

ipcMain.handle('screen-name', async () => {
  try { if (!slack.connected) await slack.connect(); return slack.self?.name || ''; } catch { return ''; }
});

ipcMain.handle('buddy-list', () => buddyListPayload());

ipcMain.handle('conv', (_e, id) => {
  const c = convs.get(id);
  return c ? { ...c, presence: c.user ? presence.get(c.user) : null, self: slack.self, selfName: userName(slack.self.id) } : null;
});

ipcMain.handle('history', async (_e, id, markRead = true) => {
  const r = await slack.api('conversations.history', { channel: id, limit: 40 });
  if (!r.ok) return { error: r.error, messages: [] };
  const messages = r.messages.filter(m => !m.subtype || ['bot_message', 'file_share', 'thread_broadcast', 'me_message'].includes(m.subtype)).reverse().map(resolveMessage);
  const latest = r.messages[0]?.ts;
  if (markRead) {
    if (latest) slack.api('conversations.mark', { channel: id, ts: latest }).catch(() => {});
    unread.set(id, { unread: false, mentions: 0 });
    broadcast('unread', Object.fromEntries(unread));
  }
  return { messages };
});

ipcMain.handle('send', async (_e, id, text) => {
  const r = await slack.api('chat.postMessage', { channel: id, text });
  return r.ok ? { ok: true } : { ok: false, error: r.error };
});

ipcMain.handle('mark-read', async (_e, id, ts) => {
  if (ts) await slack.api('conversations.mark', { channel: id, ts }).catch(() => {});
  unread.set(id, { unread: false, mentions: 0 });
  broadcast('unread', Object.fromEntries(unread));
});

ipcMain.handle('open-im', (_e, id) => { openIm(id); });

ipcMain.handle('get-settings', () => settings.load());
ipcMain.handle('set-settings', (_e, patch) => { const s = settings.save(patch); broadcast('settings', s); return s; });
ipcMain.handle('open-prefs', () => openPrefs());
ipcMain.handle('test-banner', () => {
  if (!Notification.isSupported()) return false;
  new Notification({ title: 'AIM', body: 'Notifications are working. This is what a new IM looks like.', silent: true }).show();
  return true;
});

// Everyone you could IM, including people you've never DMed.
ipcMain.handle('all-people', () => [...users.values()]
  .filter(u => !u.deleted && !u.bot && u.id !== slack.self.id)
  .map(u => ({ id: u.id, name: u.name, real: u.real, handle: u.handle })));

// Start a brand-new DM (this also opens it in Slack's sidebar, like Slack's own "New message").
ipcMain.handle('open-dm-user', async (_e, userId) => {
  const r = await slack.api('conversations.open', { users: userId, return_im: true });
  if (!r.ok) return { ok: false, error: r.error };
  addConversation({ ...r.channel, is_im: true, user: r.channel.user || userId });
  broadcast('buddy-list', buddyListPayload());
  openIm(r.channel.id);
  return { ok: true };
});

ipcMain.handle('open-in-slack', (_e, id) => {
  if (DEMO) return;
  shell.openExternal(`slack://channel?team=${slack.team}&id=${id}`);
});

ipcMain.handle('set-away', async (_e, away, message) => {
  await slack.api('users.setPresence', { presence: away ? 'away' : 'auto' });
  await slack.api('users.profile.set', { profile: { status_text: away ? (message || '') : '', status_emoji: away ? ':zzz:' : '' } });
  return true;
});

ipcMain.on('win', (e, action) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (!w) return;
  if (action === 'close') w.close();
  else if (action === 'min') w.minimize();
  else if (action === 'max') w.isMaximized() ? w.unmaximize() : w.maximize();
});

// ---------- startup ----------

const run = (cmd, args) => new Promise(res => execFile(cmd, args, (err, stdout) => res(err ? '' : stdout)));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const slackRunning = async () => (await run('pgrep', ['-f', 'Slack.app/Contents/MacOS/Slack$'])).trim() !== '';

// AIM rides on the Slack desktop app. Slack has to be started with a local-only debug port
// so AIM can use its session; if it's running without one, ask before restarting it.
async function connectOrLaunchSlack() {
  try { await slack.connect(); return; } catch {}
  if (await slackRunning()) {
    const { response } = await dialog.showMessageBox(signonWin || undefined, {
      type: 'question', buttons: ['Restart Slack', 'Cancel'], defaultId: 0, cancelId: 1,
      message: 'AIM needs to restart Slack once',
      detail: `AIM connects through your Slack app, which has to be running with AIM's local bridge (port ${PORT}, only reachable from this Mac). Slack will quit and reopen right away, still signed in.`,
    });
    if (response !== 0) throw new Error('Sign on cancelled: Slack was not restarted.');
    await run('osascript', ['-e', 'quit app "Slack"']);
    for (let i = 0; i < 40 && await slackRunning(); i++) await sleep(250);
  }
  await run('open', ['-a', 'Slack', '--args', `--remote-debugging-port=${PORT}`, '--remote-allow-origins=http://127.0.0.1']);
  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    try { await slack.connect(); return; } catch {}
  }
  throw new Error('Could not reach Slack. Is the Slack desktop app installed?');
}

app.whenReady().then(openSignon);
app.on('window-all-closed', () => app.quit());
