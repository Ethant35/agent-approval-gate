// Author: Ethan. Reproducible local history workload; no external providers.
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { execFileSync } from 'node:child_process';
import { Store } from '../dist/store.js';
import { fixture } from '../tests/core/fixture.mjs';
const f = await fixture();
try {
  const initial = await f.start();
  await f.stop(initial.child);
  const db = new Store(path.join(f.data, 'gateway.sqlite'));
  db.transaction(() => {
    for (let i = 0; i < 2500; i++) {
      const r = db.insert(
        f.action('history-' + i, {
          parameters: { path: path.join(f.workspace, 'target'), content: 'x'.repeat(4096) },
        }),
        1,
        60000,
        'agent',
      );
      db.transition(r, 'CANCELLED', 'Synthetic retained history');
    }
  });
  db.close();
  const server = await f.start(false);
  const times = [],
    bytes = [];
  for (let i = 0; i < 15; i++) {
    const start = performance.now();
    const r = await fetch(server.url + '/v1/requests?view=summary&limit=100', {
      headers: { Authorization: 'Bearer ' + server.human },
    });
    const text = await r.text();
    times.push(performance.now() - start);
    bytes.push(Buffer.byteLength(text));
  }
  const rssKiB = Number(
    execFileSync('/bin/ps', ['-o', 'rss=', '-p', String(server.child.pid)], {
      encoding: 'utf8',
    }).trim(),
  );
  times.sort((a, b) => a - b);
  const result = {
    author: 'Ethan',
    at: new Date().toISOString(),
    node: process.version,
    workload: { history: 2500, contentBytes: 4096, requests: 15 },
    latencyMs: { p50: times[7], p95: times[14] },
    responseBytes: { min: Math.min(...bytes), max: Math.max(...bytes) },
    rssKiB,
  };
  const output = process.argv[2];
  if (output) fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} finally {
  await f.cleanup();
}
