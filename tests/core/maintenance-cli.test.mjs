// Author: Ethan. Exercise backup and restore through the installed CLI entry point.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fixture, until } from './fixture.mjs';

const cli = path.resolve('dist/cli.js');

function runCli(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (buffer) => (stdout += buffer.toString()));
    child.stderr.on('data', (buffer) => (stderr += buffer.toString()));
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

async function startGateway(data, cwd) {
  const listener = net.createServer();
  await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  const child = spawn(process.execPath, [cli, 'serve', '--data', data, '--port', String(port)], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  let error = '';
  child.stdout.on('data', (buffer) => (output += buffer.toString()));
  child.stderr.on('data', (buffer) => (error += buffer.toString()));
  await until(() => {
    if (child.exitCode !== null) throw Error('Gateway failed: ' + error);
    return output.includes('"url"');
  });
  const url = `http://127.0.0.1:${port}`;
  const human = fs.readFileSync(path.join(data, 'human.token'), 'utf8').trim();
  const agent = fs.readFileSync(path.join(data, 'agent.token'), 'utf8').trim();
  async function api(endpoint, body, who = 'human') {
    const response = await fetch(url + '/v1' + endpoint, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Authorization: 'Bearer ' + (who === 'human' ? human : agent),
        'Content-Type': 'application/json',
        'X-AAG-Intent': who,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  }
  return { child, api };
}

test('CLI cold backup and restore preserve pending approval through a useful write', async () => {
  const f = await fixture();
  try {
    const first = await f.start();
    const submitted = await first.api('/requests', f.action('cli-maintenance-restore'), 'agent');
    assert.equal(submitted.status, 201);
    assert.equal(submitted.body.state, 'PENDING_APPROVAL');
    await f.stop(first.child);

    const backup = path.join(f.root, 'cli-backup');
    const backupRun = await runCli(['backup', '--data', f.data, '--out', backup], f.workspace);
    assert.equal(backupRun.code, 0, backupRun.stderr);
    assert.deepEqual(JSON.parse(backupRun.stdout), { destinationDir: backup });

    const restored = path.join(f.root, 'cli-restored');
    const restoreRun = await runCli(['restore', '--from', backup, '--data', restored], f.workspace);
    assert.equal(restoreRun.code, 0, restoreRun.stderr);
    assert.deepEqual(JSON.parse(restoreRun.stdout), { destinationDir: restored });

    const second = await startGateway(restored, f.workspace);
    try {
      const pending = await second.api('/requests/cli-maintenance-restore');
      assert.equal(pending.status, 200);
      assert.equal(pending.body.state, 'PENDING_APPROVAL');
      const approved = await second.api('/requests/cli-maintenance-restore/approve', {
        token: pending.body.approvalToken,
      });
      assert.equal(approved.status, 200);
      await until(async () => {
        const request = await second.api('/requests/cli-maintenance-restore');
        assert.notEqual(request.body.state, 'FAILED', request.body.reason);
        return request.body.state === 'COMPLETED';
      });
      assert.equal(fs.readFileSync(path.join(f.workspace, 'target'), 'utf8'), 'approved');
    } finally {
      await f.stop(second.child);
    }
  } finally {
    await f.cleanup();
  }
});

test('CLI refuses to start from an INCOMPLETE state directory', async () => {
  const f = await fixture();
  try {
    fs.mkdirSync(f.data, { mode: 0o700 });
    fs.writeFileSync(path.join(f.data, 'INCOMPLETE'), 'incomplete\n', { mode: 0o600 });
    const result = spawnSync(
      process.execPath,
      [cli, 'serve', '--data', f.data, '--port', '40000'],
      { cwd: f.workspace, encoding: 'utf8', timeout: 5000 },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /incomplete backup or restore/);
    assert.equal(fs.existsSync(path.join(f.data, 'gateway.sqlite')), false);
  } finally {
    await f.cleanup();
  }
});
