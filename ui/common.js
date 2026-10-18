// Shared bits for every AIM window: title bar, menus, sounds, Slack mrkdwn -> HTML.

function titlebar(title, { max = true } = {}) {
  const bar = document.createElement('div');
  bar.className = 'titlebar';
  bar.innerHTML = `
    <div class="icon"></div><div class="title"></div>
    <div class="btns">
      <button class="min" title="Minimize"><svg viewBox="0 0 11 11"><path d="M2 9h6"/></svg></button>
      ${max ? '<button class="max" title="Maximize"><svg viewBox="0 0 11 11"><rect x="1.5" y="1.5" width="8" height="8"/><path d="M1.5 2.5h8"/></svg></button>' : ''}
      <button class="close" title="Close"><svg viewBox="0 0 11 11"><path d="M2 2l7 7M9 2l-7 7"/></svg></button>
    </div>`;
  bar.querySelector('.title').textContent = title;
  bar.querySelector('.min').onclick = () => aim.win('min');
  bar.querySelector('.max')?.addEventListener('click', () => aim.win('max'));
  bar.querySelector('.close').onclick = () => aim.win('close');
  bar.addEventListener('dblclick', e => { if (max && !e.target.closest('.btns')) aim.win('max'); });
  document.body.prepend(bar);
  window.addEventListener('focus', () => document.body.classList.remove('inactive'));
  window.addEventListener('blur', () => document.body.classList.add('inactive'));
  return bar;
}

function setTitle(text) {
  document.querySelector('.titlebar .title').textContent = text;
  document.title = text;
}

// menus: { 'File': [['Close', fn], '-', ...], ... }
function menubar(menus, right) {
  const bar = document.createElement('div');
  bar.className = 'menubar';
  for (const [label, items] of Object.entries(menus)) {
    const item = document.createElement('div');
    item.className = 'item';
    item.innerHTML = `<u>${label[0]}</u>${label.slice(1)}<div class="menu"></div>`;
    const menu = item.querySelector('.menu');
    for (const it of items) {
      if (it === '-') { menu.appendChild(document.createElement('hr')); continue; }
      const row = document.createElement('div');
      row.textContent = it[0];
      row.onclick = e => { e.stopPropagation(); closeMenus(); it[1](); };
      menu.appendChild(row);
    }
    item.onclick = e => { e.stopPropagation(); const open = item.classList.contains('open'); closeMenus(); if (!open) item.classList.add('open'); };
    item.onmouseenter = () => { if (bar.querySelector('.open') && !item.classList.contains('open')) { closeMenus(); item.classList.add('open'); } };
    bar.appendChild(item);
  }
  const spacer = document.createElement('div');
  spacer.className = 'spacer';
  bar.appendChild(spacer);
  if (right) bar.appendChild(right);
  document.addEventListener('click', closeMenus);
  return bar;
}
function closeMenus() { document.querySelectorAll('.menubar .open').forEach(m => m.classList.remove('open')); }

const sounds = {};
let prefs = { imSounds: true, buddySounds: true };
aim.invoke('get-settings').then(s => (prefs = s)).catch(() => {});
aim.on('settings', s => (prefs = s));
const SOUND_PREF = { imrcv: 'imSounds', imsend: 'imSounds', dooropen: 'buddySounds', doorslam: 'buddySounds' };
function play(name) {
  if (SOUND_PREF[name] && !prefs[SOUND_PREF[name]]) return;
  try {
    sounds[name] = sounds[name] || new Audio(`../assets/sounds/${name}.wav`);
    sounds[name].currentTime = 0;
    sounds[name].play().catch(() => {});
  } catch {}
}

const EMOJI = {
  smile: '🙂', slightly_smiling_face: '🙂', grinning: '😀', joy: '😂', laughing: '😆', wink: '😉', heart: '❤️',
  thumbsup: '👍', '+1': '👍', thumbsdown: '👎', fire: '🔥', pray: '🙏', clap: '👏', tada: '🎉', eyes: '👀',
  white_check_mark: '✅', heavy_check_mark: '✔️', x: '❌', rocket: '🚀', thinking_face: '🤔', sob: '😭',
  sweat_smile: '😅', rolling_on_the_floor_laughing: '🤣', ok_hand: '👌', raised_hands: '🙌', muscle: '💪',
  zzz: '💤', wave: '👋', burrito: '🌯', coffee: '☕', star: '⭐', sunglasses: '😎', 100: '💯', skull: '💀', warning: '⚠️',
};

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// Slack mrkdwn -> safe HTML, in the plain style AIM used.
function mrkdwn(text, mentionNames = {}) {
  const tokens = [];
  const keep = html => `\u0000${tokens.push(html) - 1}\u0000`;
  let s = text.replace(/<([^>]+)>/g, (_, inner) => {
    const [target, label] = inner.split('|');
    if (target.startsWith('@')) return keep(`<span class="mention">@${escapeHtml(mentionNames[target.slice(1)] || label || target.slice(1))}</span>`);
    if (target.startsWith('#')) return keep(`<span class="mention">#${escapeHtml(label || target.slice(1))}</span>`);
    if (target.startsWith('!')) return keep(`<b>@${escapeHtml(label || target.slice(1).split('^')[0])}</b>`);
    if (/^(https?|mailto):/.test(target)) return keep(`<a href="${escapeHtml(target)}" target="_blank">${escapeHtml(label || target)}</a>`);
    return `<${inner}>`;
  });
  s = s.replace(/```([\s\S]*?)```/g, (_, code) => keep(`<pre>${escapeHtml(code.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'))}</pre>`));
  s = s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  s = escapeHtml(s);
  s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>')
       .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, '$1<b>$2</b>')
       .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?:;]|$)/g, '$1<i>$2</i>')
       .replace(/(^|[\s(])~([^~\n]+)~(?=[\s).,!?:;]|$)/g, '$1<s>$2</s>')
       .replace(/:([a-z0-9_+\-]+):/g, (m, name) => EMOJI[name] || m)
       .replace(/\n/g, '<br>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => tokens[+i]);
}

function timeLabel(ts) {
  return new Date(parseFloat(ts) * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
}
