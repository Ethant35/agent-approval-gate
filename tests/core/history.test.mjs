// Author: Ethan. Pagination must bound data without hiding active work or leaking payloads.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { Store } from '../../dist/store.js';
import { actionSchema } from '../../dist/contracts.js';
import { fixture } from './fixture.mjs';
test('summary pages bound payloads and preserve every row plus older pending work', async () => {
  const f = await fixture();
  try {
    const old = await f.start();
    await old.api('/requests', f.action('old-pending'), 'agent');
    await f.stop(old.child);
    const db = new Store(path.join(f.data, 'gateway.sqlite'));
    db.transaction(() => {
      for (let i = 0; i < 135; i++) {
        const r = db.insert(
          f.action('terminal-' + i, {
            parameters: {
              path: path.join(f.workspace, 'target'),
              content: 'SENSITIVE_BODY_' + 'x'.repeat(30000),
            },
          }),
          1,
          60000,
          'agent',
        );
        db.transition(r, 'CANCELLED', 'retained history');
      }
    });
    db.close();
    const server = await f.start(false);
    const seen = new Set();
    let cursor = '';
    do {
      const page = await server.api(
        '/requests?view=summary&limit=31' + (cursor ? '&before=' + cursor : ''),
      );
      assert.equal(page.status, 200);
      assert.ok(page.body.length <= 31);
      assert.equal(JSON.stringify(page.body).includes('SENSITIVE_BODY_'), false);
      for (const r of page.body) {
        assert.equal(seen.has(r.action.id), false);
        seen.add(r.action.id);
        assert.deepEqual(r.action.parameters, {});
        assert.equal(r.approvalToken, undefined);
      }
      cursor = page.headers.get('x-aag-next-cursor') || '';
    } while (cursor);
    assert.equal(seen.size, 136);
    const active = await server.api('/requests?view=summary&scope=active&limit=100');
    assert.deepEqual(
      active.body.map((r) => r.action.id),
      ['old-pending'],
    );
    const detail = await server.api('/requests/terminal-0');
    assert.ok(detail.body.action.parameters.content.startsWith('SENSITIVE_BODY_'));
    const audit = await server.api('/audit?view=summary&limit=10');
    assert.equal(audit.body.length, 10);
    assert.equal(JSON.stringify(audit.body).includes('SENSITIVE_BODY_'), false);
    assert.ok(audit.headers.get('x-aag-next-cursor'));
    const row = await server.api('/audit/' + audit.body[0].sequence);
    assert.equal(row.status, 200);
    assert.ok(row.body.details);
    assert.equal((await server.api('/requests?limit=1000000')).status, 400);
  } finally {
    await f.cleanup();
  }
});

test('summary pages include the whole active admission limit despite large private metadata', async () => {
  const f = await fixture();
  const db = new Store(path.join(f.root, 'summary.sqlite'));
  try {
    db.transaction(() => {
      for (let i = 0; i < 100; i++) {
        const action = f.action('large-metadata-' + i, {
          resourceScope: '/' + 'x'.repeat(4095),
          timestamp: '2026-10-22T00:00:00.' + '1'.repeat(20000) + 'Z',
          requestedPermissions: Array.from({ length: 16 }, () => '\u0001'.repeat(80)),
        });
        actionSchema.parse(action);
        const r = db.insert(action, 1, 60000, 'agent');
        // Controlled stored metadata at accepted schema bounds, not a native filesystem fixture.
        r.fingerprint = 'private-identity;'.repeat(2000);
        db.transition(r, 'PENDING_APPROVAL', '\u0001'.repeat(500));
      }
    });
    const page = db.requestPage({ limit: 100, summary: true, active: true, principal: 'agent' });
    assert.equal(page.items.length, 100);
    assert.equal(page.next, undefined);
    assert.equal(
      page.items.some((r) => 'fingerprint' in r || 'approvalToken' in r),
      false,
    );
    assert.ok(Buffer.byteLength(JSON.stringify(page.items)) > 1_250_000);
    assert.ok(Buffer.byteLength(JSON.stringify(page.items)) < 4_000_000);
    assert.ok(page.items.every((r) => r.action.timestamp.length <= 64));
    page.items.forEach((r) => actionSchema.parse(r.action));
    assert.ok(db.get('large-metadata-0').action.timestamp.length > 20000);
    const full = db.requestPage({ limit: 100, summary: false, active: true });
    assert.ok(full.items.length < 100);
    assert.ok(full.next);
    assert.ok(db.get('large-metadata-0').fingerprint.startsWith('private-identity;'));
  } finally {
    db.close();
    await f.cleanup();
  }
});
