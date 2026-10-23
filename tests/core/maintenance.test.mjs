// Author: Ethan. Exercise maintenance operations through real gateway state.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { backupState, restoreState } from '../../dist/maintenance.js';
import { fixture, until } from './fixture.mjs';

const cli = path.resolve('dist/cli.js');

async function startGateway(data, policyFile, cwd) {
  const listener = net.createServer();
  await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  const child = spawn(
    process.execPath,
    [
      cli,
      'serve',
      '--data',
      data,
      '--port',
      String(port),
      ...(policyFile ? ['--policy', policyFile] : []),
    ],
    { cwd, stdio: ['ignore', 'pipe', 'pipe'] },
  );
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

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await new Promise((resolve) => child.once('exit', resolve));
}

test('cold backup restores pending state and can approve a useful result', async () => {
  const f = await fixture();
  let restored;
  try {
    const first = await f.start();
    const submitted = await first.api('/requests', f.action('maintenance-restore'), 'agent');
    assert.equal(submitted.status, 201);
    assert.equal(submitted.body.state, 'PENDING_APPROVAL');
    await f.stop(first.child);

    const backup = path.join(f.root, 'cold-backup');
    restored = path.join(f.root, 'restored-state');
    await backupState(f.data, backup);
    assert.equal(fs.statSync(backup).mode & 0o777, 0o700);
    assert.equal(fs.statSync(path.join(backup, 'agent.token')).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.join(backup, 'human.token')).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.join(backup, 'gateway.sqlite')).mode & 0o777, 0o600);
    assert.equal(
      fs.readFileSync(path.join(backup, 'manifest.json'), 'utf8').includes('"author": "Ethan"'),
      true,
    );

    await restoreState(backup, restored);
    const second = await startGateway(restored, undefined, f.workspace);
    try {
      const pending = await second.api('/requests/maintenance-restore');
      assert.equal(pending.status, 200);
      assert.equal(pending.body.state, 'PENDING_APPROVAL');
      const approved = await second.api('/requests/maintenance-restore/approve', {
        token: pending.body.approvalToken,
      });
      assert.equal(approved.status, 200);
      await until(async () => {
        const request = await second.api('/requests/maintenance-restore');
        assert.notEqual(request.body.state, 'FAILED', request.body.reason);
        return request.body.state === 'COMPLETED';
      });
      assert.equal(fs.readFileSync(path.join(f.workspace, 'target'), 'utf8'), 'approved');
    } finally {
      await stop(second.child);
    }
  } finally {
    await f.cleanup();
    if (restored) fs.rmSync(restored, { recursive: true, force: true });
  }
});

test('backup refuses a live gateway and an existing destination without changing it', async () => {
  const f = await fixture();
  try {
    const server = await f.start();
    const liveDestination = path.join(f.root, 'live-backup');
    await assert.rejects(backupState(f.data, liveDestination), /lock|locked/i);
    assert.equal(fs.existsSync(liveDestination), false);
    await f.stop(server.child);

    const existing = path.join(f.root, 'already-here');
    fs.mkdirSync(existing);
    fs.writeFileSync(path.join(existing, 'keep.txt'), 'preserve me');
    await assert.rejects(backupState(f.data, existing), /already exists/);
    assert.equal(fs.readFileSync(path.join(existing, 'keep.txt'), 'utf8'), 'preserve me');
  } finally {
    await f.cleanup();
  }
});

test('restore rejects a tampered backup before creating a destination', async () => {
  const f = await fixture();
  try {
    const server = await f.start();
    await f.stop(server.child);
    fs.writeFileSync(path.join(f.data, 'INCOMPLETE'), 'partial state\n', { mode: 0o600 });
    await assert.rejects(
      backupState(f.data, path.join(f.root, 'partial-state-backup')),
      /Source state is incomplete/,
    );
    fs.unlinkSync(path.join(f.data, 'INCOMPLETE'));
    const backup = path.join(f.root, 'tamper-source');
    await backupState(f.data, backup);
    fs.writeFileSync(path.join(backup, 'INCOMPLETE'), 'partial backup\n', { mode: 0o600 });
    await assert.rejects(
      restoreState(backup, path.join(f.root, 'partial-backup-restore')),
      /Source state is incomplete/,
    );
    fs.unlinkSync(path.join(backup, 'INCOMPLETE'));
    fs.appendFileSync(path.join(backup, 'agent.token'), 'tampered');
    const destination = path.join(f.root, 'tamper-restore');
    await assert.rejects(restoreState(backup, destination), /checksum mismatch/);
    assert.equal(fs.existsSync(destination), false);
  } finally {
    await f.cleanup();
  }
});

test('backup rejects symlink and hardlinked credentials and leaves marked partial output', async () => {
  const f = await fixture();
  try {
    const server = await f.start();
    await f.stop(server.child);
    const token = path.join(f.data, 'agent.token');
    const original = fs.readFileSync(token);
    const external = path.join(f.root, 'external-token');
    fs.writeFileSync(external, original, { mode: 0o600 });

    fs.unlinkSync(token);
    fs.symlinkSync(external, token);
    const symlinkBackup = path.join(f.root, 'symlink-backup');
    await assert.rejects(backupState(f.data, symlinkBackup), /single-link regular file/);
    assert.equal(fs.existsSync(path.join(symlinkBackup, 'INCOMPLETE')), true);
    assert.equal(fs.existsSync(path.join(symlinkBackup, 'manifest.json')), false);
    fs.rmSync(symlinkBackup, { recursive: true });

    fs.unlinkSync(token);
    fs.writeFileSync(token, original, { mode: 0o600 });
    const hardlink = path.join(f.root, 'agent-token-hardlink');
    fs.linkSync(token, hardlink);
    const hardlinkBackup = path.join(f.root, 'hardlink-backup');
    await assert.rejects(backupState(f.data, hardlinkBackup), /single-link regular file/);
    assert.equal(fs.existsSync(path.join(hardlinkBackup, 'INCOMPLETE')), true);
    assert.equal(fs.existsSync(path.join(hardlinkBackup, 'agent.token')), false);
  } finally {
    await f.cleanup();
  }
});

test('backup rejects missing and malformed credentials and keeps partial output marked', async () => {
  const f = await fixture();
  try {
    const server = await f.start();
    await f.stop(server.child);
    const human = path.join(f.data, 'human.token');
    const original = fs.readFileSync(human);
    fs.unlinkSync(human);
    const missingBackup = path.join(f.root, 'missing-token-backup');
    await assert.rejects(backupState(f.data, missingBackup), /ENOENT/);
    assert.equal(fs.existsSync(path.join(missingBackup, 'INCOMPLETE')), true);
    assert.equal(fs.existsSync(path.join(missingBackup, 'manifest.json')), false);

    fs.writeFileSync(human, 'malformed token\n', { mode: 0o600 });
    const malformedBackup = path.join(f.root, 'malformed-token-backup');
    await assert.rejects(backupState(f.data, malformedBackup), /Invalid gateway token file/);
    assert.equal(fs.existsSync(path.join(malformedBackup, 'INCOMPLETE')), true);

    fs.writeFileSync(human, original, { mode: 0o600 });
    const validBackup = path.join(f.root, 'valid-token-backup');
    await backupState(f.data, validBackup);
    for (const kind of ['missing', 'malformed', 'symlink', 'hardlink']) {
      const source = path.join(f.root, `restore-${kind}-source`);
      const destination = path.join(f.root, `restore-${kind}-destination`);
      fs.cpSync(validBackup, source, { recursive: true });
      const token = path.join(source, 'agent.token');
      if (kind === 'missing') fs.unlinkSync(token);
      if (kind === 'malformed') fs.writeFileSync(token, 'invalid\n', { mode: 0o600 });
      if (kind === 'symlink') {
        const external = path.join(f.root, `${kind}-external-token`);
        fs.renameSync(token, external);
        fs.symlinkSync(external, token);
      }
      if (kind === 'hardlink') fs.linkSync(token, path.join(f.root, `${kind}-external-token`));
      await assert.rejects(restoreState(source, destination));
      assert.equal(fs.existsSync(destination), false, `${kind} token created destination`);
    }
  } finally {
    await f.cleanup();
  }
});
