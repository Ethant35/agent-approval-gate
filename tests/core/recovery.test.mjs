// Author: Ethan. Recovery must preserve state without replaying external effects.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fixture, until } from './fixture.mjs';

const cli = path.resolve('dist/cli.js');
const helper = path.resolve('dist/safe-fs');

function stateProcesses(data) {
  return execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' })
    .split('\n')
    .filter(
      (line) =>
        line.includes(data) &&
        (line.includes(`${cli} serve`) ||
          line.includes(`${helper} lock ${path.join(data, 'server.lock')}`)),
    );
}

function unusedPid() {
  for (let pid = 2_000_000_000; pid > 1_900_000_000; pid--) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error.code === 'ESRCH') return pid;
    }
  }
  throw Error('Could not find an unused PID for stale-marker control');
}
test('SIGKILL restart preserves pending requests without stale lock obstruction', async () => {
  const f = await fixture();
  try {
    const first = await f.start();
    const submitted = await first.api('/requests', f.action('pending-crash'), 'agent');
    assert.equal(submitted.body.state, 'PENDING_APPROVAL');
    await f.stop(first.child, 'SIGKILL');
    const next = await f.start(false);
    const pending = await next.api('/requests/pending-crash');
    assert.equal(pending.body.state, 'PENDING_APPROVAL');
    assert.equal(fs.readFileSync(path.join(f.workspace, 'target'), 'utf8'), 'original');
    await next.api('/requests/pending-crash/approve', { token: pending.body.approvalToken });
    await until(async () => {
      const r = (await next.api('/requests/pending-crash')).body;
      assert.notEqual(r.state, 'FAILED', r.reason);
      return r.state === 'COMPLETED';
    });
    assert.equal(fs.readFileSync(path.join(f.workspace, 'target'), 'utf8'), 'approved');
  } finally {
    await f.cleanup();
  }
});

test('second server cannot take a live lease and loss of lease stops the first server', async () => {
  const f = await fixture();
  try {
    const first = await f.start();
    await assert.rejects(f.start(false), /lock|temporarily unavailable/i);
    const { execFileSync } = await import('node:child_process');
    const pid = Number(
      execFileSync('/usr/bin/pgrep', ['-P', String(first.child.pid)], { encoding: 'utf8' }).trim(),
    );
    assert.ok(pid > 0);
    process.kill(pid, 'SIGKILL');
    const { until } = await import('./fixture.mjs');
    await until(() => first.child.exitCode !== null);
    const restarted = await f.start(false);
    assert.equal((await restarted.api('/requests')).status, 200);
  } finally {
    await f.cleanup();
  }
});

test('credential symlink is rejected without changing its target', async () => {
  const f = await fixture();
  try {
    fs.mkdirSync(f.data);
    const target = path.join(f.root, 'outside-token');
    fs.writeFileSync(target, 'a'.repeat(64), { mode: 0o644 });
    fs.symlinkSync(target, path.join(f.data, 'human.token'));
    await assert.rejects(f.start(), /owned regular/);
    assert.equal(fs.statSync(target).mode & 0o777, 0o644);
  } finally {
    await f.cleanup();
  }
});

test('repeated empty lease marker refusal can be recovered offline without deleting it', async () => {
  const f = await fixture();
  try {
    const first = await f.start();
    const submitted = await first.api('/requests', f.action('empty-lock-recovery'), 'agent');
    assert.equal(submitted.status, 201);
    assert.equal(submitted.body.state, 'PENDING_APPROVAL');
    await f.stop(first.child, 'SIGKILL');
    assert.deepEqual(stateProcesses(f.data), []);

    const lock = path.join(f.data, 'server.lock');
    fs.writeFileSync(lock, '', { mode: 0o600 });
    const empty = fs.statSync(lock);
    assert.equal(empty.size, 0);
    for (let attempt = 0; attempt < 2; attempt++) {
      await assert.rejects(f.start(false), /no owner marker/);
      const stillPresent = fs.statSync(lock);
      assert.equal(stillPresent.size, 0);
      assert.equal(stillPresent.ino, empty.ino);
      assert.deepEqual(stateProcesses(f.data), []);
    }

    const failedLock = path.join(f.data, `server.lock.failed-${Date.now()}`);
    assert.deepEqual(stateProcesses(f.data), []);
    fs.renameSync(lock, failedLock);
    const preserved = fs.statSync(failedLock);
    assert.equal(preserved.size, 0);
    assert.equal(preserved.ino, empty.ino);
    assert.equal(fs.existsSync(lock), false);
    assert.deepEqual(stateProcesses(f.data), []);

    const restarted = await f.start(false);
    try {
      assert.notEqual(fs.statSync(lock).ino, preserved.ino);
      assert.equal(
        (await restarted.api('/requests/empty-lock-recovery')).body.state,
        'PENDING_APPROVAL',
      );
      const pending = (await restarted.api('/requests/empty-lock-recovery')).body;
      assert.equal(
        (
          await restarted.api('/requests/empty-lock-recovery/approve', {
            token: pending.approvalToken,
          })
        ).status,
        200,
      );
      await until(async () => {
        const request = (await restarted.api('/requests/empty-lock-recovery')).body;
        assert.notEqual(request.state, 'FAILED', request.reason);
        return request.state === 'COMPLETED';
      });
      assert.equal(fs.readFileSync(path.join(f.workspace, 'target'), 'utf8'), 'approved');
    } finally {
      await f.stop(restarted.child);
    }
  } finally {
    await f.cleanup();
  }
});

test('stale legacy numeric lease marker is reclaimed by the native helper', async () => {
  const f = await fixture();
  try {
    fs.mkdirSync(f.data);
    const stale = unusedPid();
    const lock = path.join(f.data, 'server.lock');
    fs.writeFileSync(lock, `${stale}\n`, { mode: 0o600 });
    const server = await f.start();
    try {
      assert.match(fs.readFileSync(lock, 'utf8'), /^v2:\d+\n$/);
      assert.equal((await server.api('/requests')).status, 200);
    } finally {
      await f.stop(server.child);
    }
  } finally {
    await f.cleanup();
  }
});

test('live numeric and malformed legacy lease markers fail closed without changing them', async () => {
  for (const marker of [`${process.pid}\n`, 'not-a-pid\n']) {
    const f = await fixture();
    try {
      fs.mkdirSync(f.data);
      const lock = path.join(f.data, 'server.lock');
      fs.writeFileSync(lock, marker, { mode: 0o600 });
      await assert.rejects(
        f.start(),
        marker.startsWith('not-')
          ? /invalid existing lock marker/
          : /state lock PID is still alive/,
      );
      assert.equal(fs.readFileSync(lock, 'utf8'), marker);
      assert.deepEqual(stateProcesses(f.data), []);
    } finally {
      await f.cleanup();
    }
  }
});
