// Author: Ethan. Rehearsal must never acquire execution authority or mutate gateway state.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fixture } from './fixture.mjs';

test('human policy rehearsal compares rules and scope without changing requests, policy, budgets or files', async () => {
  const f = await fixture();
  try {
    const s = await f.start();
    const action = f.action('pending-preview');
    await s.api('/requests', action, 'agent');
    const before = {};
    for (const endpoint of ['/policy', '/requests', '/audit', '/budgets'])
      before[endpoint] = (await s.api(endpoint)).body;
    const draft = structuredClone(f.policy);
    draft.default = 'allow';
    draft.rules = [{ id: 'agent-deny', agentId: 'agent', effect: 'deny' }];
    const input = {
      yaml: JSON.stringify(draft),
      expectedRevision: before['/policy'].revision,
      requestIds: [action.id],
    };
    assert.equal((await s.api('/policy/preview', input, 'agent')).status, 400);
    const result = await s.api('/policy/preview', input);
    assert.equal(result.status, 200);
    assert.equal(result.body.results[0].current.effect, 'approval');
    assert.deepEqual(result.body.results[0].draft, { effect: 'deny', reason: 'Rule agent-deny' });
    assert.equal(result.body.results[0].source, 'history');
    const blocked = structuredClone(f.policy);
    blocked.filesystem.deny = [action.resourceScope];
    const denied = await s.api('/policy/preview', { ...input, yaml: JSON.stringify(blocked) });
    assert.equal(denied.body.results[0].draft.effect, 'deny');
    assert.match(denied.body.results[0].draft.reason, /scope denied/);
    assert.equal((await s.api('/policy/preview', { ...input, expectedRevision: 999 })).status, 409);
    assert.equal(
      (await s.api('/policy/preview', { ...input, requestIds: ['missing'] })).status,
      400,
    );
    assert.equal(
      (await s.api('/policy/preview', { ...input, requestIds: Array(21).fill(action.id) })).status,
      400,
    );
    for (const endpoint of Object.keys(before))
      assert.deepEqual(
        (await s.api(endpoint)).body,
        before[endpoint],
        endpoint + ' changed during rehearsal',
      );
    assert.equal(fs.readFileSync(path.join(f.workspace, 'target'), 'utf8'), 'original');
    // The existing approval remains usable: rehearsal did not invalidate it or consume its budget.
    const pending = (await s.api(`/requests/${action.id}`)).body;
    const approved = await s.api(`/requests/${action.id}/approve`, {
      token: pending.approvalToken,
    });
    assert.equal(approved.status, 200);
  } finally {
    await f.cleanup();
  }
});

test('allow previews for file, process, subagent and HTTP actions cause no execution', async () => {
  const f = await fixture();
  let calls = 0;
  const listener = http.createServer((_req, res) => {
    calls++;
    res.end('unexpected');
  });
  await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
  try {
    const s = await f.start();
    const current = (await s.api('/policy')).body;
    const marker = path.join(f.workspace, 'process-must-not-run');
    const destination = `http://127.0.0.1:${listener.address().port}`;
    const draft = {
      ...f.policy,
      default: 'allow',
      commands: [{ executable: '/usr/bin/touch', args: [marker] }],
      network: { allow: [destination], deny: [], allowPrivate: true },
    };
    const actions = [
      f.action('file'),
      f.action('process', {
        category: 'shell',
        operation: 'run',
        resourceScope: f.workspace,
        parameters: { executable: '/usr/bin/touch', args: [marker] },
      }),
      f.action('child', {
        category: 'subagent',
        operation: 'launch',
        resourceScope: f.workspace,
        parameters: {
          executable: '/usr/bin/touch',
          args: [marker],
          runner: 'local',
          childAgentId: 'child',
        },
        maxCost: { currency: 'USD', amount: 0 },
      }),
      f.action('network', {
        category: 'http',
        operation: 'request',
        resourceScope: destination,
        parameters: { url: destination, method: 'GET' },
      }),
    ];
    const result = await s.api('/policy/preview', {
      yaml: JSON.stringify(draft),
      expectedRevision: current.revision,
      actions,
    });
    assert.equal(result.status, 200);
    assert.deepEqual(
      result.body.results.map((r) => r.draft.effect),
      ['allow', 'allow', 'allow', 'allow'],
    );
    assert.equal(calls, 0);
    assert.equal(fs.existsSync(marker), false);
    assert.equal(fs.readFileSync(path.join(f.workspace, 'target'), 'utf8'), 'original');
    assert.deepEqual((await s.api('/requests')).body, []);
    assert.deepEqual((await s.api('/policy')).body, current);
    assert.equal(
      result.body.results.some((r) => 'approvalToken' in r),
      false,
    );
  } finally {
    await f.cleanup();
    await new Promise((resolve) => listener.close(resolve));
  }
});
