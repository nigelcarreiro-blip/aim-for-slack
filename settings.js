// AIM preferences, stored as JSON in the app's userData folder.
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULTS = {
  popIms: true,           // pop an IM window when someone DMs you
  popGroupIms: true,      // ...and for group DMs
  popMentions: true,      // pop a channel's chat window when someone @mentions you
  mentionHereChannel: false, // treat @here / @channel as a mention
  banners: true,          // macOS notification banners (only while AIM isn't in front)
  imSounds: true,         // imrcv / imsend
  buddySounds: true,      // dooropen / doorslam
};

const file = () => path.join(app.getPath('userData'), 'settings.json');
let current = null;

function load() {
  if (current) return current;
  try { current = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file(), 'utf8')) }; }
  catch { current = { ...DEFAULTS }; }
  return current;
}

function save(patch) {
  current = { ...load(), ...patch };
  for (const k of Object.keys(current)) if (!(k in DEFAULTS)) delete current[k];
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(current, null, 2));
  return current;
}

module.exports = { load, save, DEFAULTS };
