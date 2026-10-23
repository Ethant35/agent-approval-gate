// Author: Ethan. Actual CLI output must remain complete under pagination and JSON expansion.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { Store } from '../../dist/store.js';
import { fixture, until } from './fixture.mjs';
const exec = promisify(execFile);
test('CLI lists and exports every page, and reads a valid escaped result', async () => {
  const f = await fixture();
  try {
    const first = await f.start();
    await f.stop(first.child);
    const db = new Store(path.join(f.data, 'gateway.sqlite'));
    db.transaction(() => {
      for (let i = 0; i < 135; i++) {
        const r = db.insert(f.action('row-' + i), 1, 60000, 'agent');
        db.transition(r, 'CANCELLED', 'history');
      }
    });
    const auditCount = db.audits().length;
    db.close();
    const s = await f.start(false);
    const cli = async (...args) =>
      JSON.parse(
        (
          await exec(process.execPath, [path.resolve('dist/cli.js'), ...args], {
            env: { ...process.env, AAG_URL: s.url, AAG_TOKEN: s.human },
            maxBuffer: 16 * 1024 * 1024,
          })
        ).stdout,
      );
    assert.equal((await cli('requests')).length, 135);
    assert.equal((await cli('audit', 'export')).length, auditCount);
    fs.writeFileSync(path.join(f.workspace, 'target'), Buffer.alloc(400000));
    await s.api(
      '/requests',
      f.action('escaped', {
        operation: 'read',
        parameters: { path: path.join(f.workspace, 'target') },
        requestedPermissions: ['filesystem:read'],
      }),
      'agent',
    );
    const pending = (await s.api('/requests/escaped')).body;
    await s.api('/requests/escaped/approve', { token: pending.approvalToken });
    await until(async () => {
      const r = (await s.api('/requests/escaped')).body;
      assert.notEqual(r.state, 'FAILED', r.reason);
      return r.state === 'COMPLETED';
    });
    assert.equal((await cli('inspect', 'escaped')).result.content.length, 400000);
  } finally {
    await f.cleanup();
  }
});
