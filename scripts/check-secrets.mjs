// Fails if anything that looks like a Slack credential is in the repo's tracked or staged files.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const PATTERNS = [
  [/xox[abcdeposr]-[A-Za-z0-9-]{10,}/, 'Slack token'],
  [/xapp-\d-[A-Za-z0-9-]{10,}/, 'Slack app token'],
  [/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]+/, 'Slack webhook URL'],
  [/\bd=[A-Za-z0-9%]{40,}/, 'Slack session cookie'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
];
// Tracked + untracked files when this is a git checkout; otherwise (a downloaded ZIP) walk the folder.
function listFiles() {
  try {
    return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n');
  } catch {
    const out = [];
    const walk = dir => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (['node_modules', 'dist', '.git'].includes(e.name)) continue;
        const full = join(dir, e.name);
        if (e.isDirectory()) walk(full); else out.push(relative('.', full).split('\\').join('/'));
      }
    };
    walk('.');
    return out;
  }
}
const files = listFiles().filter(f => f && !f.startsWith('node_modules/') && f !== 'scripts/check-secrets.mjs');
const hits = [];
for (const f of files) {
  let text;
  try { text = readFileSync(f, 'latin1'); } catch { continue; }
  for (const [re, what] of PATTERNS) if (re.test(text)) hits.push(`${f}: ${what}`);
}
if (hits.length) { console.error('Possible credentials found:\n  ' + hits.join('\n  ')); process.exit(1); }
console.log(`secrets check: ${files.length} files clean`);
