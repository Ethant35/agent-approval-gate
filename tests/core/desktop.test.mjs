// Author: Ethan. Exercise the real private-pipe desktop entry and authentication boundary.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fixture, until } from './fixture.mjs';

async function desktop(f, args) {
  const child = spawn(
    process.execPath,
    [path.resolve('dist/desktop.js'), '--root', path.join(f.root, 'desktop'), ...args],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  );
  let output = '',
    error = '';
  child.stdout.on('data', (b) => (output += b));
  child.stderr.on('data', (b) => (error += b));
  const ready = await until(() => {
    if (child.exitCode !== null) throw Error('Desktop failed: ' + error);
    const line = output.split('\n').find((s) => s.includes('"type":"ready"'));
    return line && JSON.parse(line);
  });
  async function api(endpoint, body, token = ready.operatorToken, extra = {}) {
    return fetch(ready.url + '/v1' + endpoint, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        authorization: 'Bearer ' + token,
        'content-type': 'application/json',
        'x-aag-intent': 'human',
        ...extra,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
  async function stop() {
    child.stdin.end();
    await until(() => child.exitCode !== null);
  }
  return { child, ready, api, stop, output: () => output, error: () => error };
}

test('desktop tutorial uses a real isolated pending action and keeps operator access off HTTP', async () => {
  const f = await fixture();
  let d;
  try {
    d = await desktop(f, ['--tutorial']);
    assert.equal(d.ready.mode, 'tutorial');
    assert.notEqual(d.ready.workspace, f.workspace);
    assert.match(d.ready.operatorToken, /^[a-f0-9]{64}$/);
    assert.notEqual(
      d.ready.operatorToken,
      fs.readFileSync(path.join(d.ready.dataDir, 'human.token'), 'utf8').trim(),
    );
    assert.equal(d.ready.agentToken, undefined);
    const target = path.join(d.ready.workspace, 'approval-example.txt');
    assert.equal(fs.readFileSync(target, 'utf8'), 'This file has not been approved yet.\n');
    for (const endpoint of ['/policy', '/requests', '/pair', '/setup']) {
      const r = await fetch(d.ready.url + '/v1' + endpoint);
      assert.equal(r.status, 401);
      assert.equal((await r.text()).includes(d.ready.operatorToken), false);
    }
    const page = await fetch(d.ready.url);
    assert.equal((await page.text()).includes(d.ready.operatorToken), false);
    assert.match(page.headers.get('content-security-policy'), /connect-src 'self'/);
    const agent = fs.readFileSync(path.join(d.ready.dataDir, 'agent.token'), 'utf8').trim();
    assert.equal((await d.api('/policy', undefined, agent)).status, 400);
    const pending = await (await d.api('/requests/tutorial-write')).json();
    assert.equal(pending.state, 'PENDING_APPROVAL');
    assert.equal(
      (await d.api('/requests/tutorial-write/approve', { token: pending.approvalToken }, agent))
        .status,
      400,
    );
    assert.equal(
      (
        await d.api(
          '/requests/tutorial-write/approve',
          { token: pending.approvalToken },
          undefined,
          { origin: 'https://example.invalid' },
        )
      ).status,
      403,
    );
    assert.equal(fs.readFileSync(target, 'utf8'), 'This file has not been approved yet.\n');
    assert.equal(
      (await d.api('/requests/tutorial-write/approve', { token: pending.approvalToken })).status,
      200,
    );
    await until(
      async () => (await (await d.api('/requests/tutorial-write')).json()).state === 'COMPLETED',
    );
    assert.equal(fs.readFileSync(target, 'utf8'), 'You approved this change.\n');
    assert.equal(fs.readFileSync(path.join(f.workspace, 'target'), 'utf8'), 'original');
    assert.equal(d.error().includes(d.ready.operatorToken), false);
    assert.equal(d.output().trim().split('\n').length, 1);
    await d.stop();
    await assert.rejects(fetch(d.ready.url));
  } finally {
    if (d) await f.stop(d.child);
    await f.cleanup();
  }
});

test('desktop remembers workspace policies and isolates histories without reapplying defaults', async () => {
  const f = await fixture();
  let a, b;
  try {
    a = await desktop(f, ['--workspace', f.workspace]);
    const data = a.ready.dataDir;
    const policy = (await (await a.api('/policy')).json()).policy;
    assert.equal(policy.workspace, f.workspace);
    assert.deepEqual(policy.commands, []);
    assert.deepEqual(policy.network.allow, []);
    assert.equal(policy.default, 'approval');
    policy.rules = [{ id: 'deny-read', category: 'filesystem', operation: 'read', effect: 'deny' }];
    await a.api('/policy', { yaml: JSON.stringify(policy) });
    await a.api('/requests', f.action('retained'));
    const previousToken = a.ready.operatorToken;
    await a.stop();
    a = await desktop(f, ['--workspace', f.workspace]);
    assert.equal(a.ready.dataDir, data);
    assert.notEqual(a.ready.operatorToken, previousToken);
    assert.equal((await a.api('/policy', undefined, previousToken)).status, 401);
    const persistentHuman = fs.readFileSync(path.join(data, 'human.token'), 'utf8').trim();
    assert.equal((await a.api('/policy', undefined, persistentHuman)).status, 200);
    assert.equal((await (await a.api('/policy')).json()).policy.rules[0].id, 'deny-read');
    assert.equal((await (await a.api('/requests/retained')).json()).state, 'PENDING_APPROVAL');
    const other = path.join(f.root, 'other');
    fs.mkdirSync(other);
    b = await desktop(f, ['--workspace', other]);
    assert.notEqual(b.ready.dataDir, data);
    assert.deepEqual(await (await b.api('/requests')).json(), []);
    assert.equal((await (await b.api('/policy')).json()).policy.workspace, other);
  } finally {
    if (a) await f.stop(a.child);
    if (b) await f.stop(b.child);
    await f.cleanup();
  }
});

test('denied tutorial leaves its file unchanged and replay uses a fresh isolated session', async () => {
  const f = await fixture();
  let a, b;
  try {
    a = await desktop(f, ['--tutorial']);
    await a.api('/requests/tutorial-write/deny', {});
    assert.equal((await (await a.api('/requests/tutorial-write')).json()).state, 'DENIED');
    assert.equal(
      fs.readFileSync(path.join(a.ready.workspace, 'approval-example.txt'), 'utf8'),
      'This file has not been approved yet.\n',
    );
    await a.stop();
    b = await desktop(f, ['--tutorial']);
    assert.notEqual(b.ready.workspace, a.ready.workspace);
    assert.equal(
      (await (await b.api('/requests/tutorial-write')).json()).state,
      'PENDING_APPROVAL',
    );
  } finally {
    if (a) await f.stop(a.child);
    if (b) await f.stop(b.child);
    await f.cleanup();
  }
});
