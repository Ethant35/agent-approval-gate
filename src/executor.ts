import { spawn } from 'node:child_process';
import { realpathSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import ipaddr from 'ipaddr.js';
import type { Action, Policy } from './contracts.js';
export const helper = fileURLToPath(new URL('./safe-fs', import.meta.url));
const MAX = 1024 * 1024;
export function run(
  exe: string,
  args: string[],
  input: string,
  signal: AbortSignal,
  cwd?: string,
  environmentDir = cwd,
): Promise<{ stdout: string; stderr: string; exitCode: number; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(Error('Cancelled'));
      return;
    }
    const child = spawn(exe, args, {
      cwd,
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        PATH: '/usr/bin:/bin',
        LANG: 'en_US.UTF-8',
        HOME: environmentDir || '/nonexistent',
        TMPDIR: environmentDir || '/nonexistent',
      },
    });
    let stdout = Buffer.alloc(0),
      stderr = Buffer.alloc(0),
      problem: Error | undefined;
    const kill = () => {
      try {
        if (child.pid) process.kill(-child.pid, 'SIGKILL');
      } catch {}
    };
    const abort = () => {
      problem = Error('Execution cancelled or timed out');
      kill();
    };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    for (const [stream, isOut] of [
      [child.stdout, true],
      [child.stderr, false],
    ] as const)
      stream.on('data', (b: Buffer) => {
        if (stdout.length + stderr.length + b.length > MAX) {
          problem = Error('Output limit exceeded');
          kill();
        } else if (isOut) stdout = Buffer.concat([stdout, b]);
        else stderr = Buffer.concat([stderr, b]);
      });
    child.on('error', (e) => {
      problem = e;
    });
    child.on('close', (code, terminationSignal) => {
      kill();
      signal.removeEventListener('abort', abort);
      if (problem) reject(problem);
      else
        resolve({
          stdout: stdout.toString('utf8'),
          stderr: stderr.toString('utf8'),
          exitCode: code ?? -1,
          signal: terminationSignal,
        });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}
export async function snapshot(a: Action): Promise<string> {
  if (a.category === 'filesystem') {
    const r = await run(
      helper,
      ['inspect', a.parameters.path || '', '', '1048576'],
      '',
      AbortSignal.timeout(5000),
    );
    if (r.exitCode) throw Error(r.stderr.trim());
    return r.stdout.trim();
  }
  if (a.category === 'shell' || a.category === 'subagent') {
    const real = realpathSync(a.parameters.executable!);
    const s = statSync(real);
    if (!s.isFile()) throw Error('Executable must be a file');
    const directory = await run(
      helper,
      ['inspect-directory', a.resourceScope, '', '1048576'],
      '',
      AbortSignal.timeout(5000),
    );
    if (directory.exitCode) throw Error(directory.stderr.trim());
    return JSON.stringify({
      executable: [real, s.dev, s.ino, s.size, s.mtimeMs, s.ctimeMs],
      workspace: directory.stdout.trim(),
    });
  }
  return '';
}
function sandbox(p: Policy, exe: string, args: string[]): { exe: string; args: string[] } {
  if (process.platform === 'darwin') {
    const lit = (s: string) => JSON.stringify(s);
    const reads = [
      '/System',
      '/usr/lib',
      '/usr/share',
      '/usr/bin',
      '/bin',
      '/sbin',
      '/usr/sbin',
      '/Library/Apple',
      '/opt/homebrew/Cellar',
      '/opt/homebrew/lib',
      '/opt/homebrew/opt',
      p.workspace,
    ];
    const profile = `(version 1)(deny default)(allow process*)(allow sysctl-read)(allow mach-lookup)(allow signal (target children))(allow file-read-metadata)(allow file-read* (literal "/") (literal "/private/var/select/sh") (literal ${lit(realpathSync(exe))}) ${reads.map((x) => `(subpath ${lit(x)})`).join(' ')} (literal "/dev/null") (literal "/dev/urandom") (literal "/dev/random"))(allow file-write* (subpath ${lit(p.workspace)}) (literal "/dev/null"))${p.filesystem.deny.map((x) => `(deny file-read* file-write* (subpath ${lit(x)}))`).join('')}`;
    return { exe: '/usr/bin/sandbox-exec', args: ['-p', profile, exe, ...args] };
  }
  // Linux process execution is deliberately unavailable until its isolation suite is verified.
  throw Error('Process executor unsupported on this platform; requires verified macOS Seatbelt');
}
async function request(a: Action, p: Policy, signal: AbortSignal): Promise<unknown> {
  const url = new URL(a.parameters.url!);
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  signal.throwIfAborted();
  let abortLookup: () => void = () => {};
  const stopped = new Promise<never>((_resolve, reject) => {
    abortLookup = () => reject(Error('DNS resolution cancelled or timed out'));
    signal.addEventListener('abort', abortLookup, { once: true });
  });
  const addresses = await Promise.race([
    dns.lookup(hostname, { all: true, verbatim: true }),
    stopped,
  ]).finally(() => signal.removeEventListener('abort', abortLookup));
  signal.throwIfAborted();
  if (!addresses.length) throw Error('No resolved destination');
  for (const item of addresses) {
    let ip = ipaddr.parse(item.address);
    if (ip.kind() === 'ipv6' && (ip as ipaddr.IPv6).isIPv4MappedAddress())
      ip = (ip as ipaddr.IPv6).toIPv4Address();
    if (ip.range() !== 'unicast' && !p.network.allowPrivate)
      throw Error('Private, local or special network address denied');
  }
  const selected = addresses[0]!;
  return new Promise((resolve, reject) => {
    const req = (url.protocol === 'https:' ? https : http).request(
      url,
      {
        method: a.parameters.method,
        signal,
        agent: false,
        headers: {
          'content-type': 'text/plain',
          'content-length': Buffer.byteLength(a.parameters.body || ''),
        },
        lookup: (_host, _opts, cb) => cb(null, selected.address, selected.family),
      },
      (res) => {
        let bytes = 0;
        const chunks: Buffer[] = [];
        res.on('data', (b: Buffer) => {
          bytes += b.length;
          if (bytes > MAX) {
            res.destroy(Error('HTTP response limit exceeded'));
            return;
          }
          chunks.push(b);
        });
        res.on('error', reject);
        res.on('end', () => {
          if ((res.statusCode || 0) >= 300 && (res.statusCode || 0) < 400) {
            reject(Error('Redirect refused; submit destination as a new request'));
            return;
          }
          resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') });
        });
      },
    );
    req.on('error', reject);
    req.end(a.parameters.body || '');
  });
}
export async function execute(
  a: Action,
  p: Policy,
  fingerprint: string,
  signal: AbortSignal,
): Promise<unknown> {
  if (a.category === 'filesystem') {
    const r = await run(
      helper,
      [a.operation, a.parameters.path!, fingerprint, '1048576'],
      a.parameters.content || '',
      signal,
    );
    if (r.exitCode !== 0) throw Error(r.stderr.trim());
    return a.operation === 'read' ? { content: r.stdout } : { bytesWritten: Number(r.stdout) };
  }
  if (a.category === 'http') return request(a, p, signal);
  if ((await snapshot(a)) !== fingerprint)
    throw Error('Executable or workspace changed since authorization');
  const command = sandbox(p, a.parameters.executable!, a.parameters.args!);
  const r = await run(
    helper,
    [
      'run-workspace',
      a.resourceScope,
      JSON.parse(fingerprint).workspace,
      command.exe,
      ...command.args,
    ],
    '',
    signal,
    undefined,
    p.workspace,
  );
  if (r.exitCode !== 0) throw Error(JSON.stringify(r));
  return {
    ...r,
    ...(a.category === 'subagent'
      ? {
          agentId: a.parameters.childAgentId,
          parentSession: a.sessionId,
          runner: a.parameters.runner,
          workspace: p.workspace,
          maxDurationMs: p.limits.maxDurationMs,
          declaredBudget: a.maxCost || null,
        }
      : {}),
  };
}
export function processSupported() {
  return process.platform === 'darwin' && existsSync('/usr/bin/sandbox-exec');
}
