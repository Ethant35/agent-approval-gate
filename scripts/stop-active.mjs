// Author: Ethan. Emergency stop for this checkout's test/gateway processes only.
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const rows = execFileSync('/bin/ps', ['-ax', '-o', 'pid=,ppid=,command='], { encoding: 'utf8' })
  .split('\n')
  .flatMap((line) => {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);
    return m ? [{ pid: Number(m[1]), parent: Number(m[2]), command: m[3] }] : [];
  });
const selected = new Set(
  rows
    .filter(
      (r) =>
        r.pid !== process.pid &&
        r.command.includes(root) &&
        (r.command.includes('dist/cli.js') || r.command.includes('node_modules/playwright/')),
    )
    .map((r) => r.pid),
);
for (let changed = true; changed;) {
  changed = false;
  for (const r of rows)
    if (selected.has(r.parent) && !selected.has(r.pid)) {
      selected.add(r.pid);
      changed = true;
    }
}
for (const pid of [...selected].reverse())
  try {
    process.kill(pid, 'SIGTERM');
  } catch {}
await new Promise((r) => setTimeout(r, 1000));
for (const pid of [...selected].reverse())
  try {
    process.kill(pid, 'SIGKILL');
  } catch {}
appendFileSync(
  root + 'HANDOFF.md',
  `\n## Usage-stop shutdown ${new Date().toISOString()}\nAuthoritative account checker detected exhaustion. Project work stopped. Sent TERM then KILL to these checkout-specific process IDs and descendants: ${[...selected].join(', ') || 'none'}. Goal remains unfinished unless previously released. Verify with git status and process inspection before resuming. No new tests or releases may run until account usage is available again.\n`,
);
console.log(JSON.stringify({ stoppedPids: [...selected], handoffUpdated: true }));
