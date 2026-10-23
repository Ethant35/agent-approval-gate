// Author: Ethan. Bounded 30-second local history polling and admission stress workload.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { Store } from '../dist/store.js';
import { fixture } from '../tests/core/fixture.mjs';
const f = await fixture();
try {
  const first = await f.start();
  await f.stop(first.child);
  const db = new Store(path.join(f.data, 'gateway.sqlite'));
  db.transaction(() => {
    for (let i = 0; i < 2500; i++) {
      const r = db.insert(
        f.action('retained-' + i, {
          parameters: { path: path.join(f.workspace, 'target'), content: 'x'.repeat(4096) },
        }),
        1,
        60000,
        'agent',
      );
      db.transition(r, 'CANCELLED', 'history');
    }
  });
  const queryPlan = db.db
    .prepare(
      "EXPLAIN QUERY PLAN SELECT json FROM requests WHERE json_extract(json,'$.state')='PENDING_APPROVAL'",
    )
    .all();
  db.close();
  const s = await f.start(false);
  const times = [],
    rss = [];
  let bytes = 0;
  const start = performance.now();
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (performance.now() - start < 30000) {
        const tick = performance.now();
        const r = await s.api('/requests?view=summary&limit=100');
        assert.equal(r.status, 200);
        assert.equal(r.body.length, 100);
        times.push(performance.now() - tick);
        bytes = Math.max(bytes, Buffer.byteLength(JSON.stringify(r.body)));
        await delay(50);
      }
    }).concat([
      (async () => {
        while (performance.now() - start < 30000) {
          rss.push(
            Number(
              execFileSync('/bin/ps', ['-o', 'rss=', '-p', String(s.child.pid)], {
                encoding: 'utf8',
              }),
            ),
          );
          await delay(1000);
        }
      })(),
    ]),
  );
  const load = await Promise.all(
    Array.from({ length: 50 }, (_, i) => s.api('/requests', f.action('burst-' + i), 'agent')),
  );
  assert.ok(load.every((r) => [201, 429].includes(r.status)));
  assert.equal(fs.readFileSync(path.join(f.workspace, 'target'), 'utf8'), 'original');
  const accepted = load.filter((r) => r.status === 201).length,
    rejected = load.length - accepted;
  times.sort((a, b) => a - b);
  const result = {
    author: 'Ethan',
    at: new Date().toISOString(),
    node: process.version,
    durationMs: performance.now() - start,
    historyRows: 2500,
    concurrentPollers: 4,
    polls: times.length,
    latencyMs: {
      p50: times[Math.floor(times.length * 0.5)],
      p95: times[Math.floor(times.length * 0.95)],
      p99: times[Math.floor(times.length * 0.99)],
    },
    responseBytesMax: bytes,
    rssKiB: { first: rss[0], last: rss.at(-1), max: Math.max(...rss) },
    admission: { burst: 50, accepted, rejected, noUnapprovedSideEffect: true },
    queryPlan,
  };
  fs.writeFileSync('evidence/readiness/soak.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} finally {
  await f.cleanup();
}
