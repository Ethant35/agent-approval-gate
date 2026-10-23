// Author: Ethan. Real installed-package acceptance; no executor mocks.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { setTimeout as pause } from 'node:timers/promises';
const repo = fs.realpathSync.native(process.cwd());
const prefix = path.join(repo, '.acceptance/package-install');
const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'aag-package-')));
const workspace = path.join(root, 'workspace'),
  data = path.join(root, 'data');
fs.mkdirSync(workspace);
fs.mkdirSync(path.join(workspace, 'denied'));
fs.writeFileSync(path.join(workspace, 'allowed.txt'), 'package control');
fs.writeFileSync(path.join(workspace, 'denied/secret'), 'secret');
const args = ['-c', 'printf package-process > marker; cat marker'];
const policy = {
  version: 1,
  default: 'approval',
  workspace,
  filesystem: { allow: [workspace + '/./'], deny: [path.join(workspace, 'denied') + '/.'] },
  commands: [{ executable: '/bin/sh', args }],
  network: { allow: [], deny: [], allowPrivate: false },
  limits: { maxDurationMs: 10000, approvalTtlMs: 60000, subagentConcurrency: 1 },
  budgets: [],
  rules: [{ id: 'read', category: 'filesystem', operation: 'read', effect: 'allow' }],
};
fs.writeFileSync(path.join(root, 'policy.yaml'), JSON.stringify(policy));
const listener = net.createServer();
await new Promise((r) => listener.listen(0, '127.0.0.1', r));
const port = listener.address().port;
await new Promise((r) => listener.close(r));
const child = spawn(
  path.join(prefix, 'node_modules/.bin/aag'),
  ['serve', '--data', data, '--port', String(port), '--policy', path.join(root, 'policy.yaml')],
  { cwd: workspace, stdio: ['ignore', 'pipe', 'pipe'] },
);
let output = '',
  errors = '';
child.stdout.on('data', (b) => (output += b));
child.stderr.on('data', (b) => (errors += b));
async function until(fn) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const v = await fn();
    if (v) return v;
    await pause(50);
  }
  throw Error('Timed out');
}
try {
  await until(() => {
    if (child.exitCode !== null) throw Error(errors);
    return output.includes('"url"');
  });
  const url = JSON.parse(
    output
      .trim()
      .split('\n')
      .find((x) => x.includes('"url"')),
  ).url;
  const human = fs.readFileSync(path.join(data, 'human.token'), 'utf8').trim(),
    agent = fs.readFileSync(path.join(data, 'agent.token'), 'utf8').trim();
  async function api(endpoint, body, token = human) {
    const r = await fetch(url + '/v1' + endpoint, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        authorization: 'Bearer ' + token,
        'content-type': 'application/json',
        'x-aag-intent': token === human ? 'human' : 'agent',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    assert.ok(r.ok);
    return r.json();
  }
  function action(id, file) {
    return {
      id,
      agentId: 'agent',
      sessionId: 'package',
      category: 'filesystem',
      operation: 'read',
      parameters: { path: path.join(workspace, file) },
      resourceScope: path.join(workspace, file),
      timestamp: new Date().toISOString(),
      requestedPermissions: ['filesystem:read'],
      expectedResultFormat: 'json',
    };
  }
  const denied = await api('/requests', action('denied', 'denied/secret'), agent);
  assert.equal(denied.state, 'DENIED');
  await api('/requests', action('allowed', 'allowed.txt'), agent);
  const read = await until(async () => {
    const r = await api('/requests/allowed');
    return r.state === 'COMPLETED' && r;
  });
  assert.equal(read.result.content, 'package control');
  const command = {
    ...action('process', 'allowed.txt'),
    category: 'shell',
    operation: 'run',
    resourceScope: workspace,
    parameters: { executable: '/bin/sh', args },
    requestedPermissions: ['shell:run'],
  };
  assert.equal((await api('/requests', command, agent)).state, 'PENDING_APPROVAL');
  assert.equal(fs.existsSync(path.join(workspace, 'marker')), false);
  const pending = await api('/requests/process');
  await api('/requests/process/approve', { token: pending.approvalToken });
  const executed = await until(async () => {
    const r = await api('/requests/process');
    if (r.state === 'FAILED') throw Error(r.reason);
    return r.state === 'COMPLETED' && r;
  });
  assert.equal(executed.result.stdout, 'package-process');
  assert.equal(fs.readFileSync(path.join(workspace, 'marker'), 'utf8'), 'package-process');
  assert.equal(fs.readFileSync(path.join(workspace, 'denied/secret'), 'utf8'), 'secret');
  assert.equal((await fetch(url)).status, 200);
  const manifest = JSON.parse(
    fs.readFileSync(path.join(prefix, 'node_modules/agent-approval-gate/package.json')),
  );
  assert.equal(manifest.version, '2.0.0');
  assert.equal(manifest.author, 'Ethan');
  const result = {
    author: 'Ethan',
    verifiedAt: new Date().toISOString(),
    version: manifest.version,
    packageAuthor: manifest.author,
    cli: 'installed node_modules/.bin/aag',
    startup: 'PASS',
    dashboard: 'PASS',
    normalizedDeny: 'PASS',
    allowedRead: 'PASS',
    pendingBeforeApproval: 'PASS',
    approvedNativeProcess: 'PASS',
    protectedFileUnchanged: 'PASS',
  };
  fs.writeFileSync(
    'evidence/readiness/package-install.json',
    JSON.stringify(result, null, 2) + '\n',
  );
  console.log(JSON.stringify(result));
} finally {
  if (child.exitCode === null) {
    child.kill('SIGTERM');
    await until(() => child.exitCode !== null);
  }
  fs.rmSync(root, { recursive: true, force: true });
}
