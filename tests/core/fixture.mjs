// Author: Ethan. Real gateway fixture for deterministic local integration tests.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
export async function until(fn, timeout = 5000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const r = await fn();
    if (r) return r;
    await delay(25);
  }
  throw Error('Condition deadline exceeded');
}
export async function fixture() {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'aag-core-')));
  const workspace = path.join(root, 'workspace'),
    data = path.join(root, 'state');
  fs.mkdirSync(workspace);
  fs.writeFileSync(path.join(workspace, 'target'), 'original');
  const policy = {
    version: 1,
    default: 'approval',
    workspace,
    filesystem: { allow: [workspace], deny: [] },
    commands: [],
    network: { allow: [], deny: [], allowPrivate: false },
    limits: { maxDurationMs: 1000, approvalTtlMs: 60000, subagentConcurrency: 2 },
    budgets: [{ sessionId: 'session', currency: 'USD', maximum: 100 }],
    rules: [],
  };
  const policyFile = path.join(root, 'policy.json');
  fs.writeFileSync(policyFile, JSON.stringify(policy));
  const children = [];
  async function start(first = true, cliPath = path.resolve('dist/cli.js')) {
    const listener = net.createServer();
    await new Promise((r) => listener.listen(0, '127.0.0.1', r));
    const port = listener.address().port;
    await new Promise((r) => listener.close(r));
    const child = spawn(
      process.execPath,
      [
        cliPath,
        'serve',
        '--data',
        data,
        '--port',
        String(port),
        ...(first ? ['--policy', policyFile] : []),
      ],
      { cwd: workspace, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    children.push(child);
    let output = '',
      error = '';
    child.stdout.on('data', (b) => (output += b));
    child.stderr.on('data', (b) => (error += b));
    await until(() => {
      if (child.exitCode !== null) throw Error('Gateway failed: ' + error);
      return output.includes('"url"');
    });
    const url = `http://127.0.0.1:${port}`,
      human = fs.readFileSync(path.join(data, 'human.token'), 'utf8').trim(),
      agent = fs.readFileSync(path.join(data, 'agent.token'), 'utf8').trim();
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
      return { status: response.status, headers: response.headers, body: await response.json() };
    }
    return { child, url, human, agent, api };
  }
  function action(id, extra = {}) {
    return {
      id,
      agentId: 'agent',
      sessionId: 'session',
      category: 'filesystem',
      operation: 'write',
      parameters: { path: path.join(workspace, 'target'), content: 'approved' },
      resourceScope: path.join(workspace, 'target'),
      timestamp: new Date().toISOString(),
      requestedPermissions: ['filesystem:write'],
      expectedResultFormat: 'json',
      ...extra,
    };
  }
  async function stop(child, signal = 'SIGTERM') {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill(signal);
    await new Promise((r) => child.once('exit', r));
  }
  async function cleanup() {
    for (const c of children) await stop(c);
    fs.rmSync(root, { recursive: true, force: true });
  }
  return { root, workspace, data, policy, policyFile, start, action, stop, cleanup };
}
