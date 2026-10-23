// Author: Ethan. Real SQLite capacity and lock faults; no mocked store methods.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { Store } from '../../dist/store.js';
import { fixture } from './fixture.mjs';
test('full database rolls back request plus audit, preserving committed budget and readable state', async () => {
  const f = await fixture();
  let db;
  try {
    db = new Store(path.join(f.root, 'limited.sqlite'), 256 * 1024);
    db.apply(f.policy);
    const initial = db.insert(
      f.action('committed', { maxCost: { amount: 20, currency: 'USD' } }),
      1,
      60000,
      'agent',
    );
    db.transaction(() => {
      db.reserve(initial, f.policy);
      db.transition(initial, 'ALLOWED', 'committed');
    });
    let failed,
      rows = 0;
    for (let i = 0; i < 100; i++) {
      try {
        db.insert(
          f.action('filler-' + i, {
            parameters: { path: path.join(f.workspace, 'target'), content: 'x'.repeat(20000) },
          }),
          1,
          60000,
          'agent',
        );
        rows++;
      } catch (e) {
        failed = e;
        break;
      }
    }
    assert.ok(failed);
    assert.equal(failed.errcode & 255, 13, String(failed));
    assert.ok(rows < 100);
    assert.equal(db.list().length, rows + 1);
    assert.equal(db.audits().filter((r) => r.state === 'SUBMITTED').length, rows + 1);
    assert.equal(db.budgets()[0].reserved, 20);
    assert.equal(db.get('committed').state, 'ALLOWED');
    assert.equal(db.db.prepare('PRAGMA quick_check').get().quick_check, 'ok');
  } finally {
    db?.close();
    await f.cleanup();
  }
});
test('corrupt database fails startup without replacing the file', async () => {
  const f = await fixture();
  try {
    fs.mkdirSync(f.data);
    const file = path.join(f.data, 'gateway.sqlite');
    const invalid = Buffer.from('corrupt-data-must-be-preserved');
    fs.writeFileSync(file, invalid);
    await assert.rejects(f.start(), /database|malformed|not a database/i);
    assert.deepEqual(fs.readFileSync(file), invalid);
  } finally {
    await f.cleanup();
  }
});

test('write lock fault puts the service in fail-closed recovery mode', async () => {
  const f = await fixture();
  let blocker;
  try {
    const s = await f.start();
    const { DatabaseSync } = await import('node:sqlite');
    blocker = new DatabaseSync(path.join(f.data, 'gateway.sqlite'));
    blocker.exec('BEGIN IMMEDIATE');
    const response = await s.api('/requests', f.action('busy'), 'agent');
    assert.equal(response.status, 503);
    assert.match(response.body.error, /Storage unavailable/);
    blocker.exec('ROLLBACK');
    blocker.close();
    blocker = undefined;
    assert.equal((await s.api('/requests', f.action('after-busy'), 'agent')).status, 503);
    assert.equal(fs.readFileSync(path.join(f.workspace, 'target'), 'utf8'), 'original');
    await f.stop(s.child);
    const restarted = await f.start(false);
    assert.equal((await restarted.api('/requests/busy')).status, 400);
    assert.equal((await restarted.api('/requests')).status, 200);
  } finally {
    blocker?.close();
    await f.cleanup();
  }
});
