// Author: Ethan. Private, invocation-scoped Codex CLI launch support.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import type { ChildProcess } from 'node:child_process';

export type CodexLaunch = {
  dataDir: string;
  workspace: string;
  url: string;
  token: string;
  agentId: string;
  sessionId: string;
  connectionId: string;
};
type LaunchConfig = CodexLaunch & {
  codexPath: string;
  nodePath: string;
  cliPath: string;
  launcherPath: string;
  commandPath: string;
  pidPath: string;
};
export type CodexSession = {
  stop(): Promise<void>;
};
export type CodexSessionOptions = {
  codexPath?: string;
  openTerminal?: (commandPath: string) => Promise<void>;
};
export class CodexSessionStartError extends Error {
  constructor(readonly session: CodexSession) {
    super('Codex could not start and its partial process cleanup needs another attempt.');
    this.name = 'CodexSessionStartError';
  }
}

const launcherPath = fileURLToPath(new URL('./codex-session-launcher.js', import.meta.url));
const cliPath = fileURLToPath(new URL('./cli.js', import.meta.url));
const safeName = (id: string) => id.replace(/[^a-f0-9-]/gi, '');
function assertPrivateDirectory(directory: string) {
  const s = fs.lstatSync(directory);
  if (
    !s.isDirectory() ||
    s.isSymbolicLink() ||
    s.uid !== process.getuid!() ||
    fs.realpathSync.native(directory) !== directory
  )
    throw new Error('The connection folder is not a private owned directory.');
}
function executable(file: string): string | undefined {
  try {
    const real = fs.realpathSync.native(file);
    const s = fs.statSync(real);
    if (
      !s.isFile() ||
      (s.uid !== process.getuid!() && s.uid !== 0) ||
      (s.mode & 0o022) !== 0 ||
      (s.mode & 0o111) === 0
    )
      return undefined;
    fs.accessSync(real, fs.constants.X_OK);
    return real;
  } catch {
    return undefined;
  }
}
export function findCodexExecutable(): string | undefined {
  const candidates = [
    '/opt/homebrew/bin/codex',
    '/usr/local/bin/codex',
    path.join(homedir(), '.local/bin/codex'),
    path.join(homedir(), '.npm-global/bin/codex'),
    ...(process.env.PATH ?? '')
      .split(path.delimiter)
      .filter(Boolean)
      .map((dir) => path.join(dir, 'codex')),
  ];
  for (const candidate of new Set(candidates)) {
    const found = executable(candidate);
    if (found) return found;
  }
  return undefined;
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
function writePrivate(file: string, contents: string) {
  const fd = fs.openSync(file, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, contents);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}
function openTerminal(commandPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    let settled = false;
    try {
      child = spawn('/usr/bin/open', ['-a', 'Terminal', commandPath], {
        stdio: 'ignore',
        env: {
          HOME: homedir(),
          PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
          LANG: process.env.LANG ?? 'en_US.UTF-8',
        },
      });
    } catch {
      reject(new Error('macOS could not open Terminal.'));
      return;
    }
    const timer = setTimeout(() => {
      settled = true;
      child.kill('SIGTERM');
      const forceTimer = setTimeout(() => child.kill('SIGKILL'), 250);
      forceTimer.unref();
      reject(new Error('macOS did not finish opening Terminal.'));
    }, 5_000);
    timer.unref();
    child.once('error', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error('macOS could not open Terminal.'));
    });
    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      code === 0 ? resolve() : reject(new Error('macOS could not open Terminal.'));
    });
  });
}

type ProcessRow = {
  pid: number;
  parent: number;
  group: number;
  state: string;
  startedAt: string;
  command: string;
};
function processRows(): ProcessRow[] {
  try {
    return execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,pgid=,stat=,lstart=,command='], {
      encoding: 'utf8',
      timeout: 1500,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split('\n')
      .flatMap((line) => {
        const match = line
          .trim()
          .match(
            /^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+([A-Za-z]{3}\s+[A-Za-z]{3}\s+\d{1,2}\s+\d\d:\d\d:\d\d\s+\d{4})\s+(.*)$/,
          );
        return match
          ? [
              {
                pid: Number(match[1]),
                parent: Number(match[2]),
                group: Number(match[3]),
                state: match[4]!,
                startedAt: match[5]!,
                command: match[6]!,
              },
            ]
          : [];
      });
  } catch {
    throw new Error('Could not verify the managed Codex process tree.');
  }
}
function processTree(root: number, rows: ProcessRow[]) {
  const children = new Map<number, ProcessRow[]>();
  for (const row of rows) {
    const entries = children.get(row.parent) ?? [];
    entries.push(row);
    children.set(row.parent, entries);
  }
  const result: ProcessRow[] = [];
  const visited = new Set<number>([root]);
  const walk = (pid: number) => {
    for (const child of children.get(pid) ?? []) {
      if (visited.has(child.pid)) continue;
      visited.add(child.pid);
      walk(child.pid);
      result.push(child);
    }
  };
  walk(root);
  return result;
}
export function captureManagedProcessTree(rootPid: number) {
  const rows = processRows();
  const root = rows.find((row) => row.pid === rootPid);
  return root ? [root, ...processTree(rootPid, rows)] : [];
}
const sameProcess = (expected: ProcessRow, actual: ProcessRow) =>
  expected.pid === actual.pid &&
  expected.group === actual.group &&
  expected.startedAt === actual.startedAt &&
  expected.command === actual.command;
export async function terminateProcessIdentities(identities: ProcessRow[]) {
  const targets = new Map(identities.map((row) => [row.pid, row]));
  const send = (signal: NodeJS.Signals, rows: ProcessRow[]) => {
    for (const expected of rows) {
      const actual = processRows().find((candidate) => candidate.pid === expected.pid);
      // Verify the recorded process instance before signalling its PID.
      if (!actual || !sameProcess(expected, actual) || actual.state.startsWith('Z')) continue;
      try {
        process.kill(expected.pid, signal);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH')
          throw new Error('Could not stop the managed Codex CLI session.');
      }
    }
  };
  send('SIGTERM', [...targets.values()]);
  const terminateBy = Date.now() + 1200;
  while (Date.now() < terminateBy) {
    const rows = processRows();
    const survivors = [...targets.values()].filter((expected) => {
      const actual = rows.find((row) => row.pid === expected.pid);
      return actual && sameProcess(expected, actual) && !actual.state.startsWith('Z');
    });
    if (!survivors.length) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const rows = processRows();
  const survivors = [...targets.values()].filter((expected) => {
    const actual = rows.find((row) => row.pid === expected.pid);
    return actual && sameProcess(expected, actual) && !actual.state.startsWith('Z');
  });
  send('SIGKILL', survivors);
  const killBy = Date.now() + 500;
  while (Date.now() < killBy) {
    const current = processRows();
    if (
      !survivors.some((expected) => {
        const actual = current.find((row) => row.pid === expected.pid);
        return actual && sameProcess(expected, actual) && !actual.state.startsWith('Z');
      })
    )
      return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('The managed Codex process tree did not stop after forced termination.');
}
async function terminateManagedProcess(
  pid: number,
  connectionId: string,
  known: ProcessRow[] = [],
) {
  const rows = processRows();
  const root = rows.find((row) => row.pid === pid);
  if (root && (!root.command.includes(launcherPath) || !root.command.includes(connectionId)))
    throw new Error('The Codex connection process marker does not match a live launcher.');
  const identities = new Map(known.map((row) => [row.pid, row]));
  if (root) {
    identities.set(pid, root);
    for (const row of processTree(pid, rows)) identities.set(row.pid, row);
  }
  await terminateProcessIdentities([...identities.values()]);
}
function parseProcessIdentities(value: unknown): ProcessRow[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 128)
    throw new Error('A previous Codex process snapshot is invalid.');
  return value.map((entry) => {
    if (
      !entry ||
      typeof entry !== 'object' ||
      !Number.isSafeInteger(entry.pid) ||
      entry.pid <= 1 ||
      !Number.isSafeInteger(entry.parent) ||
      entry.parent < 0 ||
      !Number.isSafeInteger(entry.group) ||
      entry.group <= 1 ||
      typeof entry.state !== 'string' ||
      entry.state.length > 16 ||
      typeof entry.startedAt !== 'string' ||
      entry.startedAt.length > 64 ||
      typeof entry.command !== 'string' ||
      entry.command.length > 4096
    )
      throw new Error('A previous Codex process snapshot is invalid.');
    return entry as ProcessRow;
  });
}
function managedSession(
  launch: CodexLaunch,
  configPath: string,
  commandPath: string,
  pidPath: string,
): CodexSession {
  let stopped = false;
  return {
    async stop() {
      if (stopped) return;
      fs.rmSync(commandPath, { force: true });
      const deadline = Date.now() + 2500;
      while (Date.now() < deadline) {
        const stat = fs.lstatSync(pidPath, { throwIfNoEntry: false });
        if (!stat) {
          fs.rmSync(configPath, { force: true });
          await new Promise((resolve) => setTimeout(resolve, 50));
          continue;
        }
        if (
          !stat.isFile() ||
          stat.isSymbolicLink() ||
          stat.nlink !== 1 ||
          stat.uid !== process.getuid!()
        )
          throw new Error('The Codex connection process marker is unsafe.');
        const pidRecord = JSON.parse(fs.readFileSync(pidPath, 'utf8')) as {
          pid?: number;
          connectionId?: string;
          processes?: unknown;
        };
        if (pidRecord.connectionId !== launch.connectionId || !Number.isSafeInteger(pidRecord.pid))
          throw new Error('The Codex connection process marker does not match this session.');
        await terminateManagedProcess(
          pidRecord.pid!,
          launch.connectionId,
          parseProcessIdentities(pidRecord.processes),
        );
        fs.rmSync(pidPath, { force: true });
        fs.rmSync(configPath, { force: true });
        stopped = true;
        return;
      }
      fs.rmSync(configPath, { force: true });
      stopped = true;
    },
  };
}
function verifyPrivateSessionFile(file: string) {
  const s = fs.lstatSync(file);
  if (
    !s.isFile() ||
    s.isSymbolicLink() ||
    s.nlink !== 1 ||
    s.uid !== process.getuid!() ||
    (s.mode & 0o077) !== 0 ||
    s.size > 16384
  )
    throw new Error('A previous Codex connection artifact is unsafe.');
  return s;
}

export async function cleanupOrphanedCodexSessions(dataDir: string) {
  assertPrivateDirectory(dataDir);
  const entries = fs.readdirSync(dataDir);
  const sessionIds = new Set<string>();
  for (const entry of entries) {
    const match = entry.match(/^codex-([a-f0-9-]{36})\.(json|command|pid)$/i);
    if (match) sessionIds.add(match[1]!);
  }
  for (const id of sessionIds) {
    const pidPath = path.join(dataDir, `codex-${id}.pid`);
    const pidStat = fs.lstatSync(pidPath, { throwIfNoEntry: false });
    if (pidStat) {
      verifyPrivateSessionFile(pidPath);
      const marker = JSON.parse(fs.readFileSync(pidPath, 'utf8')) as {
        pid?: number;
        connectionId?: string;
        processes?: unknown;
      };
      if (marker.connectionId !== id || !Number.isSafeInteger(marker.pid))
        throw new Error('A previous Codex connection process marker is invalid.');
      await terminateManagedProcess(marker.pid!, id, parseProcessIdentities(marker.processes));
      fs.rmSync(pidPath, { force: true });
    }
    for (const suffix of ['json', 'command']) {
      const file = path.join(dataDir, `codex-${id}.${suffix}`);
      if (fs.lstatSync(file, { throwIfNoEntry: false })) {
        verifyPrivateSessionFile(file);
        fs.rmSync(file);
      }
    }
  }
}

export async function startCodexSession(
  launch: CodexLaunch,
  options: CodexSessionOptions = {},
): Promise<CodexSession> {
  assertPrivateDirectory(launch.dataDir);
  if (!/^[a-f0-9-]{36}$/i.test(launch.connectionId) || !/^[a-f0-9]{64}$/.test(launch.token))
    throw new Error('Invalid managed connection state.');
  const codexPath = options.codexPath ? executable(options.codexPath) : findCodexExecutable();
  if (!codexPath) throw new Error('Codex CLI was not found in a trusted application location.');
  const id = safeName(launch.connectionId);
  const configPath = path.join(launch.dataDir, `codex-${id}.json`);
  const commandPath = path.join(launch.dataDir, `codex-${id}.command`);
  const pidPath = path.join(launch.dataDir, `codex-${id}.pid`);
  const config: LaunchConfig = {
    ...launch,
    codexPath,
    nodePath: process.execPath,
    cliPath,
    launcherPath,
    commandPath,
    pidPath,
  };
  const session = managedSession(launch, configPath, commandPath, pidPath);
  try {
    writePrivate(configPath, JSON.stringify(config));
    const command = `#!/bin/zsh\ncd -- ${shellQuote(launch.workspace)}\nexec ${shellQuote(process.execPath)} ${shellQuote(launcherPath)} ${shellQuote(configPath)} ${shellQuote(launch.connectionId)}\n`;
    writePrivate(commandPath, command);
    fs.chmodSync(commandPath, 0o700);
    await (options.openTerminal ?? openTerminal)(commandPath);
  } catch (error) {
    let cleanupFailed = false;
    try {
      const markerStat = fs.lstatSync(pidPath, { throwIfNoEntry: false });
      if (markerStat) {
        verifyPrivateSessionFile(pidPath);
        const marker = JSON.parse(fs.readFileSync(pidPath, 'utf8')) as {
          pid?: number;
          connectionId?: string;
          processes?: unknown;
        };
        if (marker.connectionId !== launch.connectionId || !Number.isSafeInteger(marker.pid))
          throw new Error('The partial Codex session marker is invalid.');
        await terminateManagedProcess(
          marker.pid!,
          launch.connectionId,
          parseProcessIdentities(marker.processes),
        );
        fs.rmSync(pidPath, { force: true });
      }
    } catch {
      cleanupFailed = true;
    } finally {
      for (const file of [configPath, commandPath]) {
        try {
          fs.rmSync(file, { force: true });
        } catch {
          // Preserve the cleanup handle even when removing private artifacts fails.
          cleanupFailed = true;
        }
      }
    }
    if (cleanupFailed) throw new CodexSessionStartError(session);
    throw error instanceof Error ? error : new Error('Could not launch Codex CLI.');
  }
  return session;
}

// Kept as a named export so the child launcher can be built as a tiny, auditable entrypoint.
export type { LaunchConfig };
