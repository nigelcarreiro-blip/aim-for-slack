// Builds AIM for the platform this runs on. `--install` also installs it.
//   macOS:   dist/AIM.app            (--install copies it to /Applications)
//   Windows: dist/AIM-Setup-<v>.exe  (--install runs the installer silently: %LOCALAPPDATA%\Programs\AIM)
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const install = process.argv.includes('--install');
const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32', ...opts });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

if (process.platform === 'darwin') {
  run('zsh', ['scripts/build-mac.sh', ...(install ? ['--install'] : [])]);
} else if (process.platform === 'win32') {
  run('npx', ['electron-builder', '--win', 'nsis', '--x64']);
  const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const setup = join(root, 'dist', `AIM-Setup-${version}.exe`);
  if (!existsSync(setup)) { console.error(`Expected ${setup}`); process.exit(1); }
  console.log(`Built ${setup}`);
  if (install) {
    try { execFileSync('taskkill', ['/IM', 'AIM.exe', '/F'], { stdio: 'ignore' }); } catch {}
    run(setup, ['/S'], { shell: false });
    console.log(`Installed ${join(process.env.LOCALAPPDATA, 'Programs', 'AIM', 'AIM.exe')}`);
  }
} else {
  console.error('AIM for Slack builds on macOS and Windows only.');
  process.exit(1);
}
