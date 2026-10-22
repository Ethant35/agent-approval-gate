import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
mkdirSync(root + 'dist', { recursive: true });
const r = spawnSync(
  'cc',
  [
    '-std=c11',
    '-Wall',
    '-Wextra',
    '-Werror',
    '-O2',
    root + 'native/safe-fs.c',
    '-o',
    root + 'dist/safe-fs',
  ],
  { stdio: 'inherit' },
);
if (r.status !== 0) process.exit(r.status || 1);
