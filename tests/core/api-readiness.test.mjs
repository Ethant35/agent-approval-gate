// Author: Ethan. New list/health endpoints retain credential boundaries and bounded admission.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixture } from './fixture.mjs';
test('summary, detail and health routes preserve principal boundaries', async () => {
  const f = await fixture();
  try {
    const s = await f.start();
    await s.api('/requests', f.action('human-owned'));
    await s.api('/requests', f.action('agent-owned'), 'agent');
    const list = await s.api('/requests?view=summary&limit=1', undefined, 'agent');
    assert.equal(list.status, 200);
    assert.deepEqual(
      list.body.map((r) => r.action.id),
      ['agent-owned'],
    );
    assert.equal(list.headers.get('x-aag-next-cursor'), null);
    assert.equal(list.body[0].approvalToken, undefined);
    assert.equal(list.body[0].principal, undefined);
    assert.equal((await s.api('/requests/human-owned', undefined, 'agent')).status, 400);
    assert.equal((await s.api('/audit/1', undefined, 'agent')).status, 400);
    assert.equal((await s.api('/health', undefined, 'agent')).status, 400);
    const health = await s.api('/health');
    assert.equal(health.status, 200);
    assert.deepEqual(Object.keys(health.body).sort(), [
      'executing',
      'preparing',
      'status',
      'uptimeSeconds',
    ]);
    assert.equal(JSON.stringify(health.body).includes(s.human), false);
    assert.equal((await s.api('/requests?before=0')).status, 400);
    assert.equal((await s.api('/requests?after=1')).status, 400);
  } finally {
    await f.cleanup();
  }
});
test('active request cap rejects before persistence and cancellation restores capacity', async () => {
  const f = await fixture();
  try {
    const s = await f.start();
    for (let i = 0; i < 100; i++)
      assert.equal((await s.api('/requests', f.action('cap-' + i), 'agent')).status, 201);
    assert.equal((await s.api('/requests', f.action('overflow'), 'agent')).status, 429);
    assert.equal((await s.api('/requests/overflow')).status, 400);
    await s.api('/requests/cap-0/cancel', {}, 'agent');
    assert.equal((await s.api('/requests', f.action('after-cancel'), 'agent')).status, 201);
    assert.equal(fs.readFileSync(path.join(f.workspace, 'target'), 'utf8'), 'original');
  } finally {
    await f.cleanup();
  }
});
