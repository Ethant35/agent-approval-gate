// Author: Ethan. Private Terminal-launched child; never place credentials in argv.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { captureManagedProcessTree, terminateProcessIdentities } from './codex-session.js';
import type { LaunchConfig } from './codex-session.js';

type ProcessIdentity = ReturnType<typeof captureManagedProcessTree>[number];

function privateFile(file: string) {
  const s = fs.lstatSync(file);
  if (
    !s.isFile() ||
    s.isSymbolicLink() ||
    s.nlink !== 1 ||
    s.uid !== process.getuid!() ||
    (s.mode & 0o077) !== 0
  )
    throw new Error('Private launch file rejected.');
}

function writePidMarker(file: string, value: unknown) {
  const temporary = `${file}.${process.pid}.tmp`;
  const bytes = JSON.stringify(value) + '\n';
  if (Buffer.byteLength(bytes) > 16_384) throw new Error('Managed process marker is too large.');
  const fd = fs.openSync(temporary, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.renameSync(temporary, file);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

function childEnvironment(config: LaunchConfig): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of [
    'HOME',
    'USER',
    'LOGNAME',
    'PATH',
    'TERM',
    'TMPDIR',
    'TMP',
    'LANG',
    'CODEX_HOME',
  ])
    if (process.env[key]) env[key] = process.env[key];
  for (const key of Object.keys(process.env))
    if (key.startsWith('LC_')) env[key] = process.env[key];
  for (const key of [
    'NODE_OPTIONS',
    'NODE_PATH',
    'DYLD_INSERT_LIBRARIES',
    'DYLD_FRAMEWORK_PATH',
    'BASH_ENV',
    'ENV',
    'ZDOTDIR',
  ])
    delete env[key];
  env.AAG_URL = config.url;
  env.AAG_TOKEN = config.token;
  env.AAG_AGENT_ID = config.agentId;
  env.AAG_SESSION_ID = config.sessionId;
  env.AAG_CONNECTION_ID = config.connectionId;
  return env;
}

async function main() {
  const configPath = process.argv[2];
  const connectionId = process.argv[3];
  if (!configPath || !connectionId) throw new Error('Invalid private session launcher arguments.');
  privateFile(configPath);
  if (fs.statSync(configPath).size > 16384)
    throw new Error('Private launch configuration rejected.');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8')) as LaunchConfig;
  if (
    config.connectionId !== connectionId ||
    !/^[a-f0-9-]{36}$/i.test(connectionId) ||
    !/^[a-f0-9]{64}$/.test(config.token) ||
    path.dirname(configPath) !== config.dataDir
  )
    throw new Error('Private launch configuration rejected.');
  privateFile(config.commandPath);
  fs.rmSync(configPath, { force: true });
  fs.rmSync(config.commandPath, { force: true });
  writePidMarker(config.pidPath, { pid: process.pid, connectionId, processes: [] });
  const args = [
    '--no-daemon',
    '--cd',
    config.workspace,
    '-c',
    `mcp_servers.agent_approval_gate.command=${JSON.stringify(config.nodePath)}`,
    '-c',
    `mcp_servers.agent_approval_gate.args=${JSON.stringify([config.cliPath, 'mcp'])}`,
    '-c',
    'mcp_servers.agent_approval_gate.env_vars=["AAG_URL","AAG_TOKEN","AAG_AGENT_ID","AAG_SESSION_ID","AAG_CONNECTION_ID"]',
    '-c',
    'mcp_servers.agent_approval_gate.required=true',
  ];
  let child: ReturnType<typeof spawn> | undefined;
  let descendantsStopped = true;
  let monitor: ReturnType<typeof setInterval> | undefined;
  const observed = new Map<number, ProcessIdentity>();
  let signal: NodeJS.Signals | undefined;
  let closing: Promise<void> | undefined;
  const forward = (value: NodeJS.Signals) => {
    signal = value;
    try {
      child?.kill(value);
    } catch {
      /* The CLI may have exited already. */
    }
  };
  const sigint = () => forward('SIGINT');
  const sigterm = () => forward('SIGTERM');
  const sighup = () => forward('SIGHUP');
  process.on('SIGINT', sigint);
  process.on('SIGTERM', sigterm);
  process.on('SIGHUP', sighup);
  try {
    const launchCheck = await fetch(config.url + '/v1/desktop/connection/launch-check', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.token}`,
        'content-type': 'application/json',
        'x-aag-intent': 'agent',
      },
      body: '{}',
      signal: AbortSignal.timeout(1000),
    });
    if (!launchCheck.ok) throw new Error('The managed Codex connection is no longer active.');
    if (signal) throw new Error('The managed Codex connection was stopped before Codex started.');
    child = spawn(config.codexPath, args, {
      cwd: config.workspace,
      env: childEnvironment(config),
      stdio: 'inherit',
    });
    if (!child.pid) throw new Error('Codex CLI could not start.');
    descendantsStopped = false;
    privateFile(config.pidPath);
    const recordProcessTree = () => {
      try {
        for (const row of captureManagedProcessTree(child!.pid!)) observed.set(row.pid, row);
        writePidMarker(config.pidPath, {
          pid: process.pid,
          connectionId,
          processes: [...observed.values()],
        });
      } catch {
        // Keep the last complete private snapshot; shutdown still checks the live tree.
      }
    };
    recordProcessTree();
    monitor = setInterval(recordProcessTree, 25);
    monitor.unref();
    const code = await new Promise<number | null>((resolve, reject) => {
      child!.once('error', () => reject(new Error('Codex CLI could not start.')));
      child!.once('close', (exitCode) => resolve(exitCode));
    });
    clearInterval(monitor);
    recordProcessTree();
    await terminateProcessIdentities([...observed.values()]);
    descendantsStopped = true;
    closing = fetch(config.url + '/v1/desktop/connection/ended', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.token}`,
        'content-type': 'application/json',
        'x-aag-intent': 'agent',
      },
      body: '{}',
      signal: AbortSignal.timeout(1000),
    })
      .then(() => undefined)
      .catch(() => undefined);
    await closing;
    process.exitCode = signal
      ? 128 + (signal === 'SIGINT' ? 2 : signal === 'SIGTERM' ? 15 : 1)
      : (code ?? 1);
  } catch (error) {
    clearInterval(monitor);
    if (!descendantsStopped) {
      try {
        if (child?.pid) {
          for (const row of captureManagedProcessTree(child.pid)) observed.set(row.pid, row);
        }
        await terminateProcessIdentities([...observed.values()]);
        descendantsStopped = true;
      } catch {
        /* Keep the private marker so the operator can recover on disconnect or restart. */
      }
    }
    await fetch(config.url + '/v1/desktop/connection/ended', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.token}`,
        'content-type': 'application/json',
        'x-aag-intent': 'agent',
      },
      body: '{}',
      signal: AbortSignal.timeout(1000),
    }).catch(() => undefined);
    throw error;
  } finally {
    process.off('SIGINT', sigint);
    process.off('SIGTERM', sigterm);
    process.off('SIGHUP', sighup);
    if (descendantsStopped) fs.rmSync(config.pidPath, { force: true });
    fs.rmSync(configPath, { force: true });
    fs.rmSync(config.commandPath, { force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  void main().catch(() => {
    process.stderr.write('The managed Codex CLI session could not start.\n');
    process.exitCode = 1;
  });
}
