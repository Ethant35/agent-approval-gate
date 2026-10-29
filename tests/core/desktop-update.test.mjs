// Author: Ethan. Actual 2.0.0 state through desktop update backup and old-CLI rollback.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { fixture, until } from './fixture.mjs';
import { backupState, restoreState } from '../../dist/maintenance.js';

async function openDesktop(root, workspace, cli = path.resolve('dist/desktop.js')) {
  const child = spawn(process.execPath, [cli, '--root', root, '--workspace', workspace], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let out = '',
    err = '';
  child.stdout.on('data', (b) => (out += b));
  child.stderr.on('data', (b) => (err += b));
  const ready = await until(() => {
    if (child.exitCode !== null) throw Error(err);
    const s = out.split('\n').find((s) => s.includes('"type":"ready"'));
    return s && JSON.parse(s);
  });
  const stop = async () => {
    child.stdin.end();
    await until(() => child.exitCode !== null);
  };
  return { child, ready, stop };
}

test('actual 2.1.0 desktop profile upgrades with its policy, pending request and useful result', async () => {
  const f = await fixture();
  const root = path.join(f.root, 'desktop');
  const oldCli = path.resolve('.acceptance/legacy-desktop/package/dist/desktop.js');
  assert.ok(fs.existsSync(oldCli), 'Prepare the verified actual 2.1.0 archive');
  let desktop;
  try {
    desktop = await openDesktop(root, f.workspace, oldCli);
    const agent = fs.readFileSync(path.join(desktop.ready.dataDir, 'agent.token'), 'utf8').trim();
    const submit = await fetch(desktop.ready.url + '/v1/requests', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${agent}`,
        'content-type': 'application/json',
        'x-aag-intent': 'agent',
      },
      body: JSON.stringify(f.action('desktop-update')),
    });
    assert.equal(submit.status, 201);
    assert.equal((await submit.json()).state, 'PENDING_APPROVAL');
    const oldPolicy = await (
      await fetch(desktop.ready.url + '/v1/policy', {
        headers: { authorization: `Bearer ${desktop.ready.operatorToken}` },
      })
    ).json();
    await desktop.stop();
    desktop = await openDesktop(root, f.workspace);
    assert.ok(desktop.ready.backupDir);
    assert.ok(fs.existsSync(path.join(desktop.ready.backupDir, 'manifest.json')));
    const headers = {
      authorization: `Bearer ${desktop.ready.operatorToken}`,
      'content-type': 'application/json',
      'x-aag-intent': 'human',
    };
    const url = desktop.ready.url + '/v1/requests/desktop-update';
    assert.deepEqual(
      await (await fetch(desktop.ready.url + '/v1/policy', { headers })).json(),
      oldPolicy,
    );
    const pending = await (await fetch(url, { headers })).json();
    assert.equal(pending.state, 'PENDING_APPROVAL');
    assert.equal(
      (
        await fetch(url + '/approve', {
          method: 'POST',
          headers,
          body: JSON.stringify({ token: pending.approvalToken }),
        })
      ).status,
      200,
    );
    await until(async () => (await (await fetch(url, { headers })).json()).state === 'COMPLETED');
    assert.equal(fs.readFileSync(path.join(f.workspace, 'target'), 'utf8'), 'approved');
  } finally {
    if (desktop) await f.stop(desktop.child);
    await f.cleanup();
  }
});

test('actual 2.0.0 state gets a pre-update backup and remains useful after restore into old CLI', async () => {
  const f = await fixture();
  let d, rollback;
  const oldCli = path.resolve('.acceptance/legacy-v2/package/dist/cli.js');
  assert.ok(
    fs.existsSync(oldCli),
    'Prepare the verified actual 2.0.0 archive; no synthetic old schema',
  );
  try {
    const old = await f.start(true, oldCli);
    await old.api('/requests', f.action('from-v2'));
    await f.stop(old.child);
    d = await openDesktop(path.join(f.root, 'desktop'), f.workspace);
    const state = d.ready.dataDir,
      profileDir = path.dirname(state);
    await d.stop();
    fs.renameSync(state, path.join(profileDir, 'initial-empty-state'));
    const imported = path.join(f.root, 'v2-backup');
    await backupState(f.data, imported);
    await restoreState(imported, state);
    // Controlled launcher metadata: 2.0.0 had no native launcher. Database is the actual old release's.
    const profileFile = path.join(profileDir, 'profile.json');
    const profile = JSON.parse(fs.readFileSync(profileFile));
    profile.lastVersion = '2.0.0';
    fs.writeFileSync(profileFile, JSON.stringify(profile));
    d = await openDesktop(path.join(f.root, 'desktop'), f.workspace);
    assert.ok(d.ready.backupDir);
    assert.ok(fs.existsSync(path.join(d.ready.backupDir, 'manifest.json')));
    const auth = { authorization: 'Bearer ' + d.ready.operatorToken };
    const retained = await (
      await fetch(d.ready.url + '/v1/requests/from-v2', { headers: auth })
    ).json();
    assert.equal(retained.state, 'PENDING_APPROVAL');
    await d.stop();
    const currentProfile = fs.readFileSync(profileFile, 'utf8');
    fs.writeFileSync(
      profileFile,
      JSON.stringify({ ...JSON.parse(currentProfile), lastVersion: '9.0.0' }),
    );
    const originalDatabase = fs.readFileSync(path.join(state, 'gateway.sqlite'));
    const refused = spawn(
      process.execPath,
      [
        path.resolve('dist/desktop.js'),
        '--root',
        path.join(f.root, 'desktop'),
        '--workspace',
        f.workspace,
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    let refusedOutput = '',
      refusedError = '';
    refused.stdout.on('data', (b) => (refusedOutput += b));
    refused.stderr.on('data', (b) => (refusedError += b));
    await until(() => refused.exitCode !== null);
    assert.equal(refused.exitCode, 1);
    assert.equal(refusedOutput, '');
    assert.match(refusedError, /newer app/);
    assert.deepEqual(fs.readFileSync(path.join(state, 'gateway.sqlite')), originalDatabase);
    assert.equal(JSON.parse(fs.readFileSync(profileFile)).lastVersion, '9.0.0');
    fs.writeFileSync(profileFile, currentProfile);
    const restored = path.join(f.root, 'rolled-back');
    await restoreState(d.ready.backupDir, restored);
    const listener = net.createServer();
    await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
    const port = listener.address().port;
    await new Promise((resolve) => listener.close(resolve));
    rollback = spawn(
      process.execPath,
      [oldCli, 'serve', '--data', restored, '--port', String(port)],
      {
        cwd: f.workspace,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let output = '',
      error = '';
    rollback.stdout.on('data', (b) => (output += b));
    rollback.stderr.on('data', (b) => (error += b));
    await until(() => {
      if (rollback.exitCode !== null) throw Error(error);
      return output.includes('"url"');
    });
    const human = fs.readFileSync(path.join(restored, 'human.token'), 'utf8').trim();
    const headers = {
      authorization: 'Bearer ' + human,
      'content-type': 'application/json',
      'x-aag-intent': 'human',
    };
    const url = `http://127.0.0.1:${port}/v1/requests/from-v2`;
    const pending = await (await fetch(url, { headers })).json();
    assert.equal(pending.state, 'PENDING_APPROVAL');
    assert.equal(
      (
        await fetch(url + '/approve', {
          method: 'POST',
          headers,
          body: JSON.stringify({ token: pending.approvalToken }),
        })
      ).status,
      200,
    );
    await until(async () => (await (await fetch(url, { headers })).json()).state === 'COMPLETED');
    assert.equal(fs.readFileSync(path.join(f.workspace, 'target'), 'utf8'), 'approved');
  } finally {
    if (d) await f.stop(d.child);
    if (rollback) await f.stop(rollback);
    await f.cleanup();
  }
});
