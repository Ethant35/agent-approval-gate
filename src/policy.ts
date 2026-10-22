import { parse } from 'yaml';
import path from 'node:path';
import { realpathSync } from 'node:fs';
import { policySchema, type Policy, type Action } from './contracts.js';
export function within(root: string, target: string) {
  return target === root || target.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
}
function deniedPath(root: string, target: string) {
  const key = (v: string) => (process.platform === 'darwin' ? v.normalize('NFD').toLowerCase() : v);
  return within(key(root), key(target));
}
export function absolute(value: string) {
  if (!path.isAbsolute(value) || value.split(/[\\/]/).includes('..') || value.includes('\0'))
    throw Error('Absolute path without traversal required');
  return path.resolve(value);
}
export function parsePolicy(yaml: string): Policy {
  const p = policySchema.parse(parse(yaml, { maxAliasCount: 20 }));
  p.workspace = realpathSync.native(absolute(p.workspace));
  for (const key of ['allow', 'deny'] as const)
    p.filesystem[key] = p.filesystem[key].map((value) => {
      const canonical = absolute(value);
      if (!within(p.workspace, canonical)) throw Error('Filesystem paths must be inside workspace');
      return canonical;
    });
  for (const c of p.commands) c.executable = absolute(c.executable);
  for (const h of [...p.network.allow, ...p.network.deny]) {
    const u = new URL(h);
    if (u.origin !== h || !['http:', 'https:'].includes(u.protocol))
      throw Error('Network entries must be exact canonical origins');
  }
  if (new Set(p.rules.map((r) => r.id)).size !== p.rules.length) throw Error('Duplicate rule ID');
  if (new Set(p.budgets.map((b) => b.sessionId + ':' + b.currency)).size !== p.budgets.length)
    throw Error('Duplicate budget');
  return p;
}
export function evaluate(p: Policy, a: Action) {
  const pair = {
    filesystem: ['read', 'write'],
    shell: ['run'],
    http: ['request'],
    subagent: ['launch'],
  }[a.category];
  if (!pair.includes(a.operation)) throw Error('Category/operation mismatch');
  if (a.category === 'filesystem') {
    const target = absolute(a.parameters.path || '');
    if (
      a.resourceScope !== target ||
      !within(p.workspace, target) ||
      !p.filesystem.allow.some((x) => within(x, target)) ||
      p.filesystem.deny.some((x) => deniedPath(x, target))
    )
      throw Error('Filesystem scope denied');
    if (a.operation === 'write' && a.parameters.content === undefined)
      throw Error('Write requires content');
  } else if (a.category === 'shell' || a.category === 'subagent') {
    if (absolute(a.resourceScope) !== p.workspace)
      throw Error('Process workspace must equal policy workspace');
    if (
      !p.commands.some(
        (c) =>
          c.executable === a.parameters.executable &&
          JSON.stringify(c.args) === JSON.stringify(a.parameters.args),
      )
    )
      throw Error('Executable or exact arguments denied');
    if (a.category === 'subagent' && (!a.parameters.runner || !a.parameters.childAgentId))
      throw Error('Subagent runner and childAgentId required');
    if (a.category === 'subagent' && !a.maxCost)
      throw Error('Subagent declared maximum cost required (zero for a free local runner)');
  } else {
    const u = new URL(a.parameters.url || '');
    if (
      u.username ||
      u.password ||
      u.hash ||
      !['http:', 'https:'].includes(u.protocol) ||
      u.origin !== a.resourceScope
    )
      throw Error('Invalid HTTP destination scope');
    if (p.network.deny.includes(u.origin) || !p.network.allow.includes(u.origin))
      throw Error('HTTP destination denied');
    if (!a.parameters.method) throw Error('HTTP method required');
  }
  const rule = p.rules.find(
    (r) =>
      (!r.agentId || r.agentId === a.agentId) &&
      (!r.sessionId || r.sessionId === a.sessionId) &&
      (!r.category || r.category === a.category) &&
      (!r.operation || r.operation === a.operation),
  );
  return { effect: rule?.effect || p.default, reason: rule ? `Rule ${rule.id}` : 'Default policy' };
}
export function defaultPolicy(workspace: string): Policy {
  return {
    version: 1,
    default: 'approval',
    workspace,
    filesystem: { allow: [workspace], deny: [] },
    commands: [],
    network: { allow: [], deny: [], allowPrivate: false },
    limits: { maxDurationMs: 10000, approvalTtlMs: 300000, subagentConcurrency: 1 },
    budgets: [],
    rules: [],
  };
}
