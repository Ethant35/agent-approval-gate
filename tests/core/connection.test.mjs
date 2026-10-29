// Author: Ethan. Synthetic MCP handshake and operator-managed session lifecycle.
import test from 'node:test';
import { startCodexSession, CodexSessionStartError } from '../../dist/codex-session.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { startServer } from '../../dist/server.js';
import { Store } from '../../dist/store.js';

test('managed Codex connection waits for MCP initialize, scopes requests, and revokes on disconnect', async () => {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'aag-connection-')));
  const workspace = path.join(root, 'workspace');
  const dataDir = path.join(root, 'state');
  fs.mkdirSync(workspace);
  fs.mkdirSync(dataDir, { mode: 0o700 });
  const target = path.join(workspace, 'target');
  fs.writeFileSync(target, 'initial\n');
  const policyPath = path.join(root, 'policy.json');
  fs.writeFileSync(
    policyPath,
    JSON.stringify({
      version: 1,
      default: 'approval',
      workspace,
      filesystem: { allow: [workspace], deny: [] },
      commands: [],
      network: { allow: [], deny: [], allowPrivate: false },
      limits: { maxDurationMs: 1000, approvalTtlMs: 60000, subagentConcurrency: 2 },
      budgets: [],
      rules: [],
    }),
  );
  const fakeCodex = path.join(root, 'codex');
  const stubbornChildPidFile = path.join(root, 'stubborn-child.pid');
  const ttyCheckFile = path.join(root, 'codex-tty-ok');
  fs.writeFileSync(
    fakeCodex,
    `#!/bin/sh\nif [ "$1" != "--no-daemon" ] || [ ! -t 0 ] || [ ! -e /dev/tty ]; then exit 78; fi\necho ok > '${ttyCheckFile}'\ntrap 'sleep 0.4; exit 0' TERM\n/bin/sh -c 'trap "" TERM; while :; do sleep 1; done' &\necho "$!" > '${stubbornChildPidFile}'\nwait\n`,
    { mode: 0o700 },
  );
  let terminalCommand;
  let terminalScript;
  let terminalMode;
  const terminalChildren = [];
  const launchConfigs = [];
  let signalFirstOpen;
  let releaseFirstOpen;
  let signalSecondOpen;
  let releaseSecondOpen;
  const firstOpenStarted = new Promise((resolve) => (signalFirstOpen = resolve));
  const firstOpenGate = new Promise((resolve) => (releaseFirstOpen = resolve));
  const secondOpenStarted = new Promise((resolve) => (signalSecondOpen = resolve));
  const secondOpenGate = new Promise((resolve) => (releaseSecondOpen = resolve));
  const operatorToken = randomBytes(32).toString('hex');
  const server = await startServer({
    dataDir,
    policyFile: policyPath,
    port: 0,
    startupLog: false,
    operatorToken,
    desktopConnection: {
      codexPath: fakeCodex,
      openTerminal: async (file) => {
        const first = launchConfigs.length === 0;
        terminalCommand = file;
        terminalMode = fs.statSync(file).mode & 0o777;
        terminalScript = fs.readFileSync(file, 'utf8');
        const args = terminalScript.match(/exec '([^']+)' '([^']+)' '([^']+)' '([^']+)'$/m);
        assert.ok(args);
        const configPath = args[3];
        assert.equal(fs.statSync(configPath).mode & 0o777, 0o600);
        launchConfigs.push(JSON.parse(fs.readFileSync(configPath, 'utf8')));
        const terminalChild = spawn('/usr/bin/script', ['-q', '/dev/null', '/bin/zsh', file], {
          stdio: 'ignore',
        });
        terminalChildren.push(terminalChild);
        await new Promise((resolve, reject) => {
          terminalChild.once('spawn', resolve);
          terminalChild.once('error', reject);
        });
        if (first) {
          signalFirstOpen();
          await firstOpenGate;
        } else {
          signalSecondOpen();
          await secondOpenGate;
        }
      },
    },
  });
  let client;
  try {
    const humanToken = fs.readFileSync(path.join(dataDir, 'human.token'), 'utf8').trim();
    const api = async (route, body, token = humanToken) =>
      fetch(server.url + '/v1' + route, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'x-aag-intent': token === humanToken ? 'human' : 'agent',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    assert.equal((await fetch(server.url + '/v1/desktop/connection')).status, 401);
    assert.deepEqual(await (await api('/desktop/connection')).json(), { status: 'idle' });
    const firstStart = api('/desktop/connection/start', {});
    await firstOpenStarted;
    const firstConfig = launchConfigs[0];
    const firstPidPath = path.join(dataDir, `codex-${firstConfig.connectionId}.pid`);
    const firstPidDeadline = Date.now() + 5000;
    while (!fs.existsSync(firstPidPath) && Date.now() < firstPidDeadline)
      await new Promise((resolve) => setTimeout(resolve, 25));
    assert.ok(fs.existsSync(firstPidPath), 'first managed launcher did not start');
    const firstLauncherPid = JSON.parse(fs.readFileSync(firstPidPath, 'utf8')).pid;
    const disconnectRequest = api('/desktop/connection/disconnect', {});
    await new Promise((resolve) => setTimeout(resolve, 25));
    const secondStart = api('/desktop/connection/start', {});
    releaseFirstOpen();
    const firstStartResponse = await firstStart;
    const firstDisconnectResponse = await disconnectRequest;
    fs.rmSync(stubbornChildPidFile, { force: true });
    await secondOpenStarted;
    const connectingConfig = launchConfigs[1];
    assert.equal(
      (await api('/desktop/connection/initialized', {}, connectingConfig.token)).status,
      200,
    );
    releaseSecondOpen();
    const started = await secondStart;
    assert.equal(firstStartResponse.status, 200);
    assert.equal(firstDisconnectResponse.status, 200);
    assert.equal(started.status, 200);
    assert.match(terminalCommand, /\.command$/);
    assert.equal(terminalMode, 0o700);
    const config = launchConfigs[1];
    const startedView = await started.json();
    assert.equal(startedView.status, 'connected');
    const terminalChild = terminalChildren[1];
    assert.notEqual(config.token, firstConfig.token);
    assert.equal(
      (await api('/requests/not-a-real-request', undefined, firstConfig.token)).status,
      401,
    );
    assert.equal(
      (await api('/v1/desktop/connection/initialized', {}, firstConfig.token)).status,
      401,
    );
    let firstLauncherCommand = '';
    try {
      firstLauncherCommand = execFileSync(
        '/bin/ps',
        ['-p', String(firstLauncherPid), '-o', 'command='],
        { encoding: 'utf8', timeout: 1000 },
      ).trim();
    } catch (error) {
      assert.equal(error.status, 1, 'process inventory failed unexpectedly');
    }
    assert.equal(firstLauncherCommand, '');
    const pidPath = path.join(dataDir, `codex-${config.connectionId}.pid`);
    const launcherDeadline = Date.now() + 5000;
    while (
      !fs.existsSync(pidPath) &&
      terminalChild.exitCode === null &&
      Date.now() < launcherDeadline
    )
      await new Promise((resolve) => setTimeout(resolve, 25));
    assert.ok(fs.existsSync(pidPath), 'managed launcher did not write its process marker');
    assert.equal(fs.statSync(pidPath).mode & 0o777, 0o600);
    assert.ok(config);
    const childPidDeadline = Date.now() + 5000;
    while (!fs.existsSync(stubbornChildPidFile) && Date.now() < childPidDeadline)
      await new Promise((resolve) => setTimeout(resolve, 25));
    assert.ok(fs.existsSync(stubbornChildPidFile), 'fake Codex did not start its stubborn child');
    assert.equal(fs.readFileSync(ttyCheckFile, 'utf8').trim(), 'ok');
    const stubbornChildPid = Number(fs.readFileSync(stubbornChildPidFile, 'utf8').trim());
    const identityDeadline = Date.now() + 2000;
    let processMarker;
    while (Date.now() < identityDeadline) {
      processMarker = JSON.parse(fs.readFileSync(pidPath, 'utf8'));
      if (processMarker.processes.some((row) => row.pid === stubbornChildPid)) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.ok(
      processMarker.processes.some((row) => row.pid === stubbornChildPid),
      `managed launcher did not retain descendant ${stubbornChildPid}: ${JSON.stringify(processMarker.processes)}`,
    );
    assert.match(config.token, /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(startedView).includes(config.token), false);
    assert.equal(terminalScript.includes(config.token), false);
    const launchView = await (await api('/desktop/connection')).json();
    assert.equal(launchView.status, 'connected');
    assert.equal(launchView.agentId, 'codex-cli');
    assert.equal(launchView.sessionId, config.sessionId);
    assert.ok(launchView.connectedAt);
    assert.ok(launchView.lastSeenAt);

    const env = {
      ...process.env,
      AAG_URL: server.url,
      AAG_TOKEN: config.token,
      AAG_AGENT_ID: config.agentId,
      AAG_SESSION_ID: config.sessionId,
      AAG_CONNECTION_ID: config.connectionId,
    };
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.resolve('dist/cli.js'), 'mcp'],
      env,
      stderr: 'pipe',
      cwd: workspace,
    });
    client = new Client(
      { name: 'synthetic-connection-test', version: '1.0.0' },
      { capabilities: {} },
    );
    await client.connect(transport);
    assert.equal(
      transport._process?.exitCode,
      null,
      'synthetic MCP server exited after initialize',
    );
    const connectionDeadline = Date.now() + 5000;
    let connected = await (await api('/desktop/connection')).json();
    while (connected.status === 'starting' && Date.now() < connectionDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      connected = await (await api('/desktop/connection')).json();
    }
    assert.equal(
      connected.status,
      'connected',
      JSON.stringify({
        connected,
        terminalExitCode: terminalChild.exitCode,
        terminalSignal: terminalChild.signalCode,
      }),
    );
    assert.equal(connected.agentId, 'codex-cli');
    assert.equal(connected.sessionId, config.sessionId);
    assert.ok(connected.connectedAt);
    assert.ok(connected.lastSeenAt);

    const action = {
      id: 'managed-pending',
      category: 'filesystem',
      operation: 'write',
      parameters: { path: target, content: 'approved through MCP\n' },
      resourceScope: target,
      timestamp: new Date().toISOString(),
      requestedPermissions: ['filesystem:write'],
      expectedResultFormat: 'json',
    };
    const submitted = await client.callTool({ name: 'aag_submit', arguments: { action } });
    assert.equal(submitted.structuredContent.state, 'PENDING_APPROVAL');
    assert.equal(submitted.structuredContent.action.agentId, 'codex-cli');
    assert.equal(submitted.structuredContent.action.sessionId, config.sessionId);
    const pending = await (await api('/requests/managed-pending')).json();
    assert.equal(pending.state, 'PENDING_APPROVAL');
    const approval = await api('/requests/managed-pending/approve', {
      token: pending.approvalToken,
    });
    assert.equal(approval.status, 200);
    await new Promise((resolve, reject) => {
      const deadline = Date.now() + 5000;
      const poll = async () => {
        const record = await (await api('/requests/managed-pending')).json();
        if (record.state === 'COMPLETED') return resolve();
        if (record.state === 'FAILED' || Date.now() > deadline)
          return reject(new Error(`Managed write ended in ${record.state}`));
        setTimeout(poll, 25);
      };
      void poll();
    });
    assert.equal(fs.readFileSync(target, 'utf8'), 'approved through MCP\n');
    const completed = await (await api('/requests/managed-pending')).json();
    assert.equal(completed.reason, 'Execution completed successfully');
    assert.equal(completed.reason.includes('cost'), false);

    const nextAction = {
      ...action,
      id: 'managed-cancelled',
      parameters: { path: target, content: 'must not write\n' },
    };
    assert.equal(
      (await client.callTool({ name: 'aag_submit', arguments: { action: nextAction } }))
        .structuredContent.state,
      'PENDING_APPROVAL',
    );
    const disconnecting = api('/desktop/connection/disconnect', {});
    const disconnectingDeadline = Date.now() + 2000;
    let disconnectingView;
    do {
      disconnectingView = await (await api('/desktop/connection')).json();
      if (disconnectingView.status === 'disconnecting') break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    } while (Date.now() < disconnectingDeadline);
    assert.equal(disconnectingView.status, 'disconnecting');
    const disconnected = await disconnecting;
    const disconnectedView = await disconnected.json();
    assert.equal(disconnectedView.status, 'disconnected');
    assert.equal(disconnectedView.connectedAt, connected.connectedAt);
    assert.ok(Date.parse(disconnectedView.lastSeenAt) >= Date.parse(connected.lastSeenAt));
    assert.equal((await api('/requests/managed-cancelled')).status, 200);
    assert.equal((await (await api('/requests/managed-cancelled')).json()).state, 'CANCELLED');
    assert.equal((await api('/requests/managed-pending', undefined, config.token)).status, 401);
    const processDeadline = Date.now() + 5000;
    while (
      terminalChild.exitCode === null &&
      terminalChild.signalCode === null &&
      Date.now() < processDeadline
    )
      await new Promise((resolve) => setTimeout(resolve, 25));
    assert.ok(
      terminalChild.exitCode !== null || terminalChild.signalCode !== null,
      'managed Terminal process tree stayed alive',
    );
    let stubbornState;
    try {
      stubbornState = execFileSync(
        '/bin/ps',
        ['-p', String(stubbornChildPid), '-o', 'stat=,ppid=,command='],
        {
          encoding: 'utf8',
          timeout: 1000,
        },
      ).trim();
    } catch {
      stubbornState = '';
    }
    assert.ok(
      !stubbornState || stubbornState.startsWith('Z'),
      `managed Codex descendant stayed alive (${stubbornState})`,
    );
    assert.equal(fs.readFileSync(target, 'utf8'), 'approved through MCP\n');

    const issued = await api('/agents', {
      agentId: 'external-agent',
      sessionIds: ['external-session'],
    });
    const credential = await issued.json();
    assert.match(credential.token, /^[a-f0-9]{64}$/);
    const external = {
      ...action,
      id: 'external-pending',
      agentId: 'external-agent',
      sessionId: 'external-session',
    };
    assert.equal((await api('/requests', external, credential.token)).status, 201);
    assert.equal((await api(`/agents/${credential.id}/revoke`, {})).status, 200);
    assert.equal((await api('/requests/managed-pending', undefined, credential.token)).status, 401);
    assert.equal((await (await api('/requests/external-pending')).json()).state, 'CANCELLED');

    const policy = await (await api('/policy')).json();
    const policyYaml = JSON.stringify(policy.policy);
    assert.equal(
      (await api('/policy', { yaml: policyYaml, expectedRevision: policy.revision })).status,
      200,
    );
    assert.equal(
      (await api('/policy', { yaml: policyYaml, expectedRevision: policy.revision })).status,
      409,
    );
    assert.equal((await api('/policy', { yaml: policyYaml })).status, 200);
  } finally {
    await client?.close().catch(() => undefined);
    await server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('gateway restart revokes persisted desktop credentials and cancels their pending work', async () => {
  const root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), 'aag-connection-restart-')),
  );
  const workspace = path.join(root, 'workspace');
  const dataDir = path.join(root, 'state');
  fs.mkdirSync(workspace);
  fs.mkdirSync(dataDir, { mode: 0o700 });
  fs.writeFileSync(path.join(workspace, 'target'), 'initial\n');
  const policy = {
    version: 1,
    default: 'approval',
    workspace,
    filesystem: { allow: [workspace], deny: [] },
    commands: [],
    network: { allow: [], deny: [], allowPrivate: false },
    limits: { maxDurationMs: 1000, approvalTtlMs: 60000, subagentConcurrency: 2 },
    budgets: [],
    rules: [],
  };
  const staleToken = randomBytes(32).toString('hex');
  const principalId = `desktop-codex-${randomUUID()}`;
  const store = new Store(path.join(dataDir, 'gateway.sqlite'));
  store.apply(policy);
  const savedPolicy = store.policy();
  assert.ok(savedPolicy);
  store.addPrincipal(
    principalId,
    'codex-cli',
    ['codex-stale-session'],
    createHash('sha256').update(staleToken).digest('hex'),
  );
  const action = {
    id: 'stale-connection-request',
    agentId: 'codex-cli',
    sessionId: 'codex-stale-session',
    category: 'filesystem',
    operation: 'write',
    parameters: { path: path.join(workspace, 'target'), content: 'must not write' },
    resourceScope: path.join(workspace, 'target'),
    timestamp: new Date().toISOString(),
    requestedPermissions: ['filesystem:write'],
    expectedResultFormat: 'json',
  };
  const request = store.insert(action, savedPolicy.revision, 60000, principalId);
  store.transition(request, 'PENDING_APPROVAL', 'Waiting for approval');
  store.close();

  const server = await startServer({
    dataDir,
    port: 0,
    startupLog: false,
    desktopConnection: true,
  });
  try {
    const humanToken = fs.readFileSync(path.join(dataDir, 'human.token'), 'utf8').trim();
    const status = await fetch(server.url + '/v1/desktop/connection', {
      headers: { authorization: `Bearer ${humanToken}` },
    });
    assert.deepEqual(await status.json(), { status: 'idle' });
    const oldCredential = await fetch(server.url + '/v1/requests/stale-connection-request', {
      headers: { authorization: `Bearer ${staleToken}` },
    });
    assert.equal(oldCredential.status, 401);
    const record = await fetch(server.url + '/v1/requests/stale-connection-request', {
      headers: { authorization: `Bearer ${humanToken}` },
    });
    assert.equal((await record.json()).state, 'CANCELLED');
    assert.equal(fs.readFileSync(path.join(workspace, 'target'), 'utf8'), 'initial\n');
  } finally {
    await server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('launch artifact removal failure retains a retryable cleanup handle', async () => {
  const root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), 'aag-artifact-failure-')),
  );
  const dataDir = path.join(root, 'state');
  fs.mkdirSync(dataDir, { mode: 0o700 });
  const fakeCodex = path.join(root, 'codex');
  fs.writeFileSync(fakeCodex, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  let failure;
  try {
    await startCodexSession(
      {
        dataDir,
        workspace: root,
        url: 'http://127.0.0.1:1',
        token: 'a'.repeat(64),
        agentId: 'test',
        sessionId: 'test',
        connectionId: '11111111-1111-4111-8111-111111111111',
      },
      {
        codexPath: fakeCodex,
        openTerminal: async () => {
          fs.chmodSync(dataDir, 0o500);
          throw Error('Terminal failed after launch artifacts were written.');
        },
      },
    ).catch((error) => {
      failure = error;
    });
    assert.ok(
      failure instanceof CodexSessionStartError,
      'cleanup obligation must survive artifact removal failure',
    );
    await assert.rejects(failure.session.stop());
    fs.chmodSync(dataDir, 0o700);
    await failure.session.stop();
    assert.deepEqual(fs.readdirSync(dataDir), []);
  } finally {
    fs.chmodSync(dataDir, 0o700);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('partial launch cleanup failure keeps a handle and makes gateway shutdown report failure', async () => {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'aag-close-failure-')));
  const workspace = path.join(root, 'workspace');
  const dataDir = path.join(root, 'state');
  fs.mkdirSync(workspace);
  fs.mkdirSync(dataDir, { mode: 0o700 });
  const policyPath = path.join(root, 'policy.json');
  fs.writeFileSync(
    policyPath,
    JSON.stringify({
      version: 1,
      default: 'approval',
      workspace,
      filesystem: { allow: [workspace], deny: [] },
      commands: [],
      network: { allow: [], deny: [], allowPrivate: false },
      limits: { maxDurationMs: 1000, approvalTtlMs: 60000, subagentConcurrency: 2 },
      budgets: [],
      rules: [],
    }),
  );
  const fakeCodex = path.join(root, 'codex');
  fs.writeFileSync(fakeCodex, '#!/bin/sh\nsleep 30\n', { mode: 0o700 });
  let terminalChild;
  let launcherPid;
  let ownedProcesses = [];
  let server;
  let recoveryServer;
  try {
    server = await startServer({
      dataDir,
      policyFile: policyPath,
      port: 0,
      startupLog: false,
      desktopConnection: {
        codexPath: fakeCodex,
        openTerminal: async (commandPath) => {
          const script = fs.readFileSync(commandPath, 'utf8');
          const args = script.match(/exec '([^']+)' '([^']+)' '([^']+)' '([^']+)'$/m);
          assert.ok(args);
          const config = JSON.parse(fs.readFileSync(args[3], 'utf8'));
          terminalChild = spawn('/usr/bin/script', ['-q', '/dev/null', '/bin/zsh', commandPath], {
            stdio: 'ignore',
          });
          await new Promise((resolve, reject) => {
            terminalChild.once('spawn', resolve);
            terminalChild.once('error', reject);
          });
          const pidPath = path.join(dataDir, `codex-${config.connectionId}.pid`);
          const deadline = Date.now() + 5000;
          let marker;
          while (Date.now() < deadline) {
            if (fs.existsSync(pidPath)) {
              marker = JSON.parse(fs.readFileSync(pidPath, 'utf8'));
              if (marker.processes?.length) break;
            }
            await new Promise((resolve) => setTimeout(resolve, 25));
          }
          assert.ok(marker?.processes?.length, 'managed process snapshot was not written');
          launcherPid = marker.pid;
          ownedProcesses = marker.processes;
          process.kill(launcherPid, 'SIGSTOP');
          fs.writeFileSync(pidPath, '{}');
          throw new Error('Terminal launch failed after starting the managed process.');
        },
      },
    });
    const humanToken = fs.readFileSync(path.join(dataDir, 'human.token'), 'utf8').trim();
    const started = await fetch(server.url + '/v1/desktop/connection/start', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${humanToken}`,
        'content-type': 'application/json',
        'x-aag-intent': 'human',
      },
      body: '{}',
    });
    assert.equal(started.status, 200);
    assert.equal((await started.json()).status, 'error');
    const closedUrl = server.url;
    await assert.rejects(server.close(), /managed Codex Terminal process could not be stopped/i);
    server = undefined;
    await assert.rejects(fetch(closedUrl + '/v1/health'));

    recoveryServer = await startServer({ dataDir, port: 0, startupLog: false });
    assert.equal(
      (
        await fetch(recoveryServer.url + '/v1/health', {
          headers: {
            authorization: `Bearer ${humanToken}`,
            'x-aag-intent': 'human',
          },
        })
      ).status,
      200,
    );
  } finally {
    await recoveryServer?.close();
    await server?.close().catch(() => undefined);
    if (launcherPid) {
      try {
        process.kill(launcherPid, 'SIGCONT');
      } catch {}
      try {
        process.kill(launcherPid, 'SIGKILL');
      } catch {}
    }
    for (const row of ownedProcesses) {
      try {
        process.kill(row.pid, 'SIGKILL');
      } catch {}
    }
    terminalChild?.kill('SIGKILL');
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('managed launcher rejects exposed config and honors stop during its launch check', async () => {
  const root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), 'aag-launcher-guard-')),
  );
  const connectionId = randomUUID();
  const token = randomBytes(32).toString('hex');
  const workspace = path.join(root, 'workspace');
  fs.mkdirSync(workspace);
  const configPath = path.join(root, `codex-${connectionId}.json`);
  const commandPath = path.join(root, `codex-${connectionId}.command`);
  const pidPath = path.join(root, `codex-${connectionId}.pid`);
  const startedPath = path.join(root, 'codex-started');
  const codexPath = path.join(root, 'codex');
  fs.writeFileSync(codexPath, `#!/bin/sh\necho started > '${startedPath}'\n`, { mode: 0o700 });
  fs.writeFileSync(commandPath, '#!/bin/sh\n', { mode: 0o700 });
  let launchChecks = 0;
  let releaseLaunchCheck;
  let signalLaunchCheck;
  const launchCheckSeen = new Promise((resolve) => (signalLaunchCheck = resolve));
  const launchCheckGate = new Promise((resolve) => (releaseLaunchCheck = resolve));
  const stub = createServer(async (req, res) => {
    if (req.url === '/v1/desktop/connection/launch-check') {
      launchChecks += 1;
      signalLaunchCheck();
      await launchCheckGate;
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
      return;
    }
    if (req.url === '/v1/desktop/connection/ended') {
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise((resolve, reject) => {
    stub.once('error', reject);
    stub.listen(0, '127.0.0.1', resolve);
  });
  const address = stub.address();
  assert.ok(address && typeof address === 'object');
  const config = {
    dataDir: root,
    workspace,
    url: `http://127.0.0.1:${address.port}`,
    token,
    agentId: 'codex-cli',
    sessionId: 'codex-session-test',
    connectionId,
    codexPath,
    nodePath: process.execPath,
    cliPath: path.resolve('dist/cli.js'),
    launcherPath: path.resolve('dist/codex-session-launcher.js'),
    commandPath,
    pidPath,
  };
  fs.writeFileSync(configPath, JSON.stringify(config), { mode: 0o644 });
  let child;
  try {
    const spawnLauncher = () =>
      spawn(process.execPath, [config.launcherPath, configPath, connectionId], {
        stdio: 'ignore',
      });
    const closeChild = (processChild) =>
      new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('managed launcher did not exit')), 3000);
        processChild.once('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
        processChild.once('close', (code, signal) => {
          clearTimeout(timeout);
          resolve({ code, signal });
        });
      });
    child = spawnLauncher();
    const exposedExit = await closeChild(child);
    child = undefined;
    assert.equal(exposedExit.code, 1);
    assert.equal(launchChecks, 0);
    assert.equal(fs.existsSync(startedPath), false);

    fs.chmodSync(configPath, 0o600);
    child = spawnLauncher();
    await launchCheckSeen;
    assert.equal(fs.existsSync(pidPath), true);
    child.kill('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 25));
    releaseLaunchCheck();
    const stoppedExit = await closeChild(child);
    child = undefined;
    assert.equal(stoppedExit.code, 1);
    assert.equal(fs.existsSync(startedPath), false);
    assert.equal(fs.existsSync(pidPath), false);
  } finally {
    releaseLaunchCheck?.();
    child?.kill('SIGKILL');
    await new Promise((resolve) => stub.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
