// Author: Ethan. Uses the actual verified v1.0.1 release archive, not a hand-built legacy schema.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixture, until } from './fixture.mjs';
import { backupState, restoreState } from '../../dist/maintenance.js';
const legacy = path.resolve('.acceptance/legacy/package/dist/cli.js');
test('actual v1.0.1 crash state upgrades with pending work and unsettled cost intact', async () => {
  assert.ok(
    fs.existsSync(legacy),
    'Prepare the verified v1.0.1 archive as documented before qualification',
  );
  const f = await fixture();
  try {
    const old = await f.start(true, legacy);
    const a = f.action('old-done', { maxCost: { amount: 30, currency: 'USD' } });
    await old.api('/requests', a, 'agent');
    const p = (await old.api('/requests/old-done')).body;
    await old.api('/requests/old-done/approve', { token: p.approvalToken });
    await until(async () => {
      const r = (await old.api('/requests/old-done')).body;
      assert.notEqual(r.state, 'FAILED', r.reason);
      return r.state === 'COMPLETED';
    });
    await old.api('/requests', f.action('old-pending'), 'agent');
    const prior = (await old.api('/audit')).body.length;
    await f.stop(old.child, 'SIGKILL');
    const backup = path.join(f.root, 'pre-upgrade-backup');
    await backupState(f.data, backup);
    const current = await f.start(false);
    assert.equal((await current.api('/requests/old-done')).body.state, 'COMPLETED');
    assert.equal((await current.api('/budgets')).body[0].reserved, 30);
    assert.ok((await current.api('/audit')).body.length >= prior);
    assert.equal((await current.api('/requests/old-pending')).body.state, 'PENDING_APPROVAL');
    assert.equal((await current.api('/requests', a, 'agent')).status, 400);
    await current.api('/requests/old-done/settle', {
      amount: 17,
      evidence: 'authoritative controlled fixture',
    });
    assert.equal((await current.api('/budgets')).body[0].settled, 17);
    const pending = (await current.api('/requests/old-pending')).body;
    await current.api('/requests/old-pending/approve', {
      token: pending.approvalToken,
    });
    // This actual old helper encoded directory link counts; v2 encodes zero.
    await until(async () => (await current.api('/requests/old-pending')).body.state === 'FAILED');
    const stale = (await current.api('/requests/old-pending')).body;
    assert.match(stale.reason, /resource changed/);
    const retry = await current.api('/requests', f.action('resubmitted'), 'agent');
    assert.equal(retry.body.state, 'PENDING_APPROVAL');
    const fresh = (await current.api('/requests/resubmitted')).body;
    await current.api('/requests/resubmitted/approve', { token: fresh.approvalToken });
    await until(
      async () => (await current.api('/requests/resubmitted')).body.state === 'COMPLETED',
    );
    assert.equal(fs.readFileSync(path.join(f.workspace, 'target'), 'utf8'), 'approved');
    // Rollback restores the pre-upgrade snapshot to a fresh path, never rewrites live state.
    await f.stop(current.child);
    fs.renameSync(f.data, path.join(f.root, 'preserved-forward-state'));
    await restoreState(backup, f.data);
    const rolledBack = await f.start(false, legacy);
    assert.equal((await rolledBack.api('/requests/old-done')).body.state, 'COMPLETED');
    assert.equal((await rolledBack.api('/requests/old-pending')).body.state, 'PENDING_APPROVAL');
    assert.equal((await rolledBack.api('/budgets')).body[0].reserved, 30);
    assert.equal((await rolledBack.api('/budgets')).body[0].settled, 0);
    assert.equal((await rolledBack.api('/requests/resubmitted')).status, 400);
    assert.equal(fs.readFileSync(path.join(f.workspace, 'target'), 'utf8'), 'approved');
  } finally {
    await f.cleanup();
  }
});
