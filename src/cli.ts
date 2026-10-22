#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { platform, release } from 'node:os';
import { existsSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { policySchema, type RequestRecord } from './contracts.js';
import { parsePolicy } from './policy.js';

const DEFAULT_URL = 'http://127.0.0.1:3741';
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

type Options = { data?: string; port?: number; policy?: string };

function usage(): string {
  return `Agent Approval Gate\n\nUsage:\n  aag serve [--data DIR] [--port N] [--policy PATH]\n  aag policy validate PATH\n  aag policy list\n  aag policy apply PATH\n  aag submit --file ACTION.json\n  aag requests\n  aag inspect REQUEST_ID\n  aag approve REQUEST_ID\n  aag deny REQUEST_ID\n  aag cancel REQUEST_ID\n  aag audit export\n  aag doctor\n  aag mcp\n`;
}

function fail(message: string): never {
  throw new Error(message);
}

function json(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function getBaseUrl(): URL {
  const raw = process.env.AAG_URL ?? DEFAULT_URL;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return fail('AAG_URL must be a valid URL.');
  }
  const loopbacks = new Set(['127.0.0.1', 'localhost', '[::1]']);
  if (!['http:', 'https:'].includes(url.protocol) || !loopbacks.has(url.hostname) || url.username || url.password) {
    return fail('AAG_URL must use HTTP(S) on the loopback host 127.0.0.1, localhost, or ::1, with no embedded credentials.');
  }
  return url;
}

async function api(path: string, options: { method?: string; body?: unknown; human?: boolean } = {}): Promise<unknown> {
  const token = process.env.AAG_TOKEN;
  if (!token) return fail('AAG_TOKEN is required for gateway API calls.');
  const base = getBaseUrl();
  const url = new URL(path.replace(/^\//, ''), `${base.toString().replace(/\/$/, '')}/`);
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.body !== undefined) headers['X-AAG-Intent'] = options.human ? 'human' : 'agent';
  const response = await fetch(url, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    redirect: 'error',
  });
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        return fail('Gateway response exceeded the 2 MiB limit.');
      }
      chunks.push(value);
    }
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const text = new TextDecoder().decode(bytes);
  let payload: unknown = text;
  if (text) {
    try { payload = JSON.parse(text); } catch { /* Preserve a useful plain-text error. */ }
  }
  if (!response.ok) {
    const detail = typeof payload === 'object' && payload !== null && 'error' in payload
      ? String((payload as { error: unknown }).error)
      : typeof payload === 'string' ? payload : JSON.stringify(payload);
    return fail(`Gateway returned HTTP ${response.status}: ${detail}`);
  }
  return payload;
}

function parseOptions(args: string[]): Options {
  const options: Options = {};
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    const value = args[i + 1];
    if (!value || value.startsWith('--')) return fail(`Expected a value after ${flag}.`);
    if (flag === '--data') options.data = value;
    else if (flag === '--policy') options.policy = value;
    else if (flag === '--port') {
      const port = Number(value);
      if (!Number.isInteger(port) || port < 1 || port > 65535) return fail('--port must be an integer from 1 to 65535.');
      options.port = port;
    } else return fail(`Unknown option: ${flag}`);
    i++;
  }
  return options;
}

async function policyValidate(path: string): Promise<void> {
  const source = await readFile(path, 'utf8');
  const policy = parsePolicy(source);
  json({ valid: true, version: policy.version });
}

async function run(argv: string[]): Promise<void> {
  const [command, ...args] = argv;
  if (!command || command === '--help' || command === '-h' || command === 'help') {
    process.stdout.write(usage());
    return;
  }
  if (command === 'serve') {
    const options = parseOptions(args);
    const { startServer } = await import('./server.js');
    const server = await startServer({ dataDir: options.data, port: options.port, policyFile: options.policy });
    const stop = (): void => { void server.close().then(() => process.exit(0), (error: unknown) => { process.stderr.write(`${String(error)}\n`); process.exit(1); }); };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    return;
  }
  if (command === 'policy') {
    const [subcommand, ...rest] = args;
    if (subcommand === 'validate' && rest.length === 1) return policyValidate(rest[0]!);
    if (subcommand === 'list' && rest.length === 0) return json(await api('/v1/policy'));
    if (subcommand === 'apply' && rest.length === 1) {
      const source = await readFile(rest[0]!, 'utf8');
      policySchema.parse(parseYaml(source));
      return json(await api('/v1/policy', { method: 'POST', body: { yaml: source }, human: true }));
    }
    return fail('Use: aag policy validate PATH | list | apply PATH');
  }
  if (command === 'submit') {
    if (args.length !== 2 || args[0] !== '--file') return fail('Use: aag submit --file ACTION.json');
    const action: unknown = JSON.parse(await readFile(args[1]!, 'utf8'));
    return json(await api('/v1/requests', { method: 'POST', body: action }));
  }
  if (command === 'requests' && args.length === 0) return json(await api('/v1/requests'));
  if (command === 'inspect' && args.length === 1) return json(await api(`/v1/requests/${encodeURIComponent(args[0]!)}`));
  if (command === 'approve' && args.length === 1) {
    const id = args[0]!;
    const record = await api(`/v1/requests/${encodeURIComponent(id)}`) as RequestRecord;
    if (!record || typeof record.approvalToken !== 'string' || !record.approvalToken) return fail('This request has no active approval token.');
    return json(await api(`/v1/requests/${encodeURIComponent(id)}/approve`, { method: 'POST', body: { token: record.approvalToken }, human: true }));
  }
  if ((command === 'deny' || command === 'cancel') && args.length === 1) {
    const endpoint = command === 'deny' ? 'deny' : 'cancel';
    return json(await api(`/v1/requests/${encodeURIComponent(args[0]!)}/${endpoint}`, { method: 'POST', body: {}, human: true }));
  }
  if (command === 'audit' && args.length === 1 && args[0] === 'export') return json(await api('/v1/audit'));
  if (command === 'doctor' && args.length === 0) {
    const nativeCandidates = ['dist/safe-fs'];
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const native = nativeCandidates.find((path) => existsSync(resolve(packageRoot, path)));
    json({ node: process.version, supportedNode: Number(process.versions.node.split('.')[0]) >= 22, platform: platform(), release: release(), nativeExecutor: native ?? 'not found', sandbox: process.platform === 'darwin' ? 'macOS sandbox support is platform-dependent; inspect local policy and runtime configuration' : 'OS sandbox is not detected by this diagnostic', apiUrl: process.env.AAG_URL ?? DEFAULT_URL });
    return;
  }
  if (command === 'mcp' && args.length === 0) {
    const { runMcpServer } = await import('./mcp.js');
    await runMcpServer();
    return;
  }
  return fail(`Unknown or incomplete command: ${command}\n\n${usage()}`);
}

run(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
