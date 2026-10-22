import Fastify from 'fastify';
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  realpathSync,
  chmodSync,
  unlinkSync,
  readdirSync,
} from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { stringify } from 'yaml';
import { z } from 'zod';
import { actionSchema, type Action, type Policy } from './contracts.js';
import { parsePolicy, defaultPolicy, evaluate, within } from './policy.js';
import { Store, type Stored } from './store.js';
import { execute, snapshot, processSupported } from './executor.js';
const secretEqual = (a: string, b: string) => {
  const left = Buffer.from(a),
    right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};
const done = new Set(['COMPLETED', 'DENIED', 'FAILED', 'EXPIRED', 'CANCELLED']);
export async function startServer(
  options: { dataDir?: string; port?: number; policyFile?: string } = {},
) {
  const data = path.resolve(
    options.dataDir || path.join(homedir(), '.local/share/agent-approval-gate'),
  );
  mkdirSync(data, { recursive: true, mode: 0o700 });
  chmodSync(data, 0o700);
  if (realpathSync.native(data) !== data) throw Error('Data directory must use a canonical path');
  const lock = path.join(data, 'server.lock');
  writeFileSync(lock, String(process.pid), { flag: 'wx', mode: 0o600 });
  let store: Store | undefined;
  try {
    const credential = (name: string) => {
      const f = path.join(data, name + '.token');
      if (!existsSync(f))
        writeFileSync(f, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 });
      chmodSync(f, 0o600);
      const t = readFileSync(f, 'utf8').trim();
      if (!/^[a-f0-9]{64}$/.test(t)) throw Error('Invalid credential file');
      return t;
    };
    store = new Store(path.join(data, 'gateway.sqlite'));
    const db = store;
    const safePolicy = (p: Policy) => {
      if (within(p.workspace, data) || within(data, p.workspace))
        throw Error('Workspace and credential/database directory must be disjoint');
      return p;
    };
    if (options.policyFile)
      db.apply(safePolicy(parsePolicy(readFileSync(options.policyFile, 'utf8'))));
    if (!db.policy())
      db.apply(safePolicy(parsePolicy(stringify(defaultPolicy(realpathSync(process.cwd()))))));
    const previous = db.policy()!.policy;
    const normalized = safePolicy(parsePolicy(stringify(previous)));
    // Upgrade persisted policies too; a changed representation invalidates prior approvals.
    if (JSON.stringify(normalized) !== JSON.stringify(previous)) db.apply(normalized);
    const human = credential('human'),
      agent = credential('agent');
    if (human === agent) throw Error('Credentials must differ');
    for (const r of db.list())
      if (['EXECUTING', 'ALLOWED', 'APPROVED', 'SUBMITTED'].includes(r.state))
        db.transition(
          r,
          'FAILED',
          'Service interrupted; execution not retried; cost remains unverified',
        );
    const app = Fastify({ logger: false, bodyLimit: 1500000, requestTimeout: 15000 });
    const controllers = new Map<string, AbortController>(),
      jobs = new Set<Promise<void>>();
    let closing = false;
    const configuredPort = options.port ?? 3741;
    let origin = `http://127.0.0.1:${configuredPort}`;
    const principal = (auth: string | undefined) => {
      const t = auth?.startsWith('Bearer ') ? auth.slice(7) : '';
      if (secretEqual(t, human)) return 'human';
      if (secretEqual(t, agent)) return 'agent';
      const hash = createHash('sha256').update(t).digest('hex');
      return db.principals().find((p) => p.hash === hash)?.id || '';
    };
    const present = (r: Stored, who: string) => {
      const { fingerprint: _f, principal: _p, ...record } = r;
      if (who !== 'human') delete record.approvalToken;
      return record;
    };
    const visible = (r: Stored, who: string) => who === 'human' || r.principal === who;
    const find = (id: string, who: string) => {
      const r = db.get(id);
      if (!r || !visible(r, who)) throw Error('Request not found');
      return r;
    };
    function expire() {
      for (const r of db.list())
        if (r.state === 'PENDING_APPROVAL' && Date.parse(r.expiresAt) <= Date.now())
          db.transition(r, 'EXPIRED', 'Approval expired');
    }
    function reserve(r: Stored, p: Policy) {
      if (
        r.action.category === 'subagent' &&
        db
          .list()
          .filter(
            (x) =>
              x.action.category === 'subagent' &&
              ['EXECUTING', 'APPROVED', 'ALLOWED'].includes(x.state),
          ).length >= p.limits.subagentConcurrency
      )
        throw Error('Subagent concurrency exhausted');
      db.reserve(r, p);
    }
    function schedule(id: string) {
      const job = (async () => {
        const r = db.get(id)!;
        if (!['ALLOWED', 'APPROVED'].includes(r.state)) return;
        const current = db.policy()!;
        try {
          if (current.revision !== r.policyVersion) throw Error('Policy changed; resubmit');
          if (evaluate(current.policy, r.action).effect === 'deny')
            throw Error('Policy denied at execution');
          db.transition(r, 'EXECUTING', 'Execution started');
        } catch (e) {
          db.transaction(() => {
            db.release(r);
            db.transition(r, 'DENIED', String(e));
          });
          return;
        }
        const control = new AbortController();
        controllers.set(id, control);
        const timeout = setTimeout(() => control.abort(), current.policy.limits.maxDurationMs);
        try {
          const result = await execute(r.action, current.policy, r.fingerprint, control.signal);
          const latest = db.get(id)!;
          if (latest.state === 'EXECUTING') {
            latest.result =
              r.action.expectedResultFormat === 'text' && result && typeof result === 'object'
                ? String(
                    (result as Record<string, unknown>).content ??
                      (result as Record<string, unknown>).stdout ??
                      (result as Record<string, unknown>).body ??
                      JSON.stringify(result),
                  )
                : result;
            db.transition(
              latest,
              'COMPLETED',
              'Execution completed; declared cost remains reserved until authoritative settlement',
            );
          }
        } catch (e) {
          const latest = db.get(id)!;
          if (latest.state === 'EXECUTING')
            db.transition(latest, 'FAILED', e instanceof Error ? e.message : String(e));
        } finally {
          clearTimeout(timeout);
          controllers.delete(id);
        }
      })();
      jobs.add(job);
      void job.finally(() => jobs.delete(job));
    }
    app.addHook('onRequest', async (req, reply) => {
      reply
        .header('X-Content-Type-Options', 'nosniff')
        .header('Referrer-Policy', 'no-referrer')
        .header('Cache-Control', 'no-store')
        .header(
          'Content-Security-Policy',
          "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
        );
      if (
        req.url.split('?')[0]!.includes('%') ||
        req.url.includes('..') ||
        req.url.startsWith('//')
      )
        return reply.code(400).send({ error: 'Noncanonical URL rejected' });
      if (req.headers.host !== new URL(origin).host)
        return reply.code(403).send({ error: 'Host rejected' });
      if (req.headers.origin && req.headers.origin !== origin)
        return reply.code(403).send({ error: 'Origin rejected' });
      if (req.headers['sec-fetch-site'] === 'cross-site')
        return reply.code(403).send({ error: 'Cross-site request rejected' });
      if (req.url.startsWith('/v1/')) {
        if (!principal(req.headers.authorization))
          return reply.code(401).send({ error: 'Authorization required' });
        if (
          req.method !== 'GET' &&
          req.headers['x-aag-intent'] !== 'human' &&
          req.headers['x-aag-intent'] !== 'agent'
        )
          return reply.code(403).send({ error: 'Explicit intent header required' });
        if (closing) return reply.code(503).send({ error: 'Gateway shutting down' });
      }
    });
    const requireHuman = (auth: string | undefined) => {
      if (principal(auth) !== 'human') throw Error('Human authorization required');
    };
    app.setErrorHandler((error, _req, reply) =>
      reply.code(400).send({ error: error instanceof Error ? error.message : 'Request rejected' }),
    );
    app.get('/v1/requests', async (req) => {
      expire();
      const who = principal(req.headers.authorization);
      return db
        .list()
        .filter((r) => visible(r, who))
        .map((r) => present(r, who));
    });
    app.get<{ Params: { id: string } }>('/v1/requests/:id', async (req) => {
      expire();
      const who = principal(req.headers.authorization);
      return present(find(req.params.id, who), who);
    });
    app.post('/v1/requests', async (req, reply) => {
      const a = actionSchema.parse(req.body);
      const who = principal(req.headers.authorization);
      if (who === 'agent' && a.agentId !== 'agent')
        throw Error('Agent identity must be agent for this credential');
      if (who !== 'human' && who !== 'agent') {
        const identity = db.principals().find((p) => p.id === who)!;
        if (
          a.agentId !== identity.agentId ||
          !(JSON.parse(identity.sessions) as string[]).includes(a.sessionId)
        )
          throw Error('Agent or session identity denied');
      }
      const policy = db.policy()!;
      const r = db.insert(a, policy.revision, policy.policy.limits.approvalTtlMs, who);
      try {
        const decision = evaluate(policy.policy, a);
        if (decision.effect === 'deny') throw Error(decision.reason);
        if ((a.category === 'shell' || a.category === 'subagent') && !processSupported())
          throw Error('OS sandbox unavailable');
        r.fingerprint = await snapshot(a);
        const latest = db.get(a.id)!;
        if (latest.state !== 'SUBMITTED') return present(latest, who);
        if (closing) throw Error('Gateway shutting down');
        if (db.policy()!.revision !== r.policyVersion)
          throw Error('Policy changed during preparation');
        if (decision.effect === 'approval') db.transition(r, 'PENDING_APPROVAL', decision.reason);
        else {
          db.transaction(() => {
            reserve(r, policy.policy);
            db.transition(r, 'ALLOWED', decision.reason);
          });
          schedule(a.id);
        }
      } catch (e) {
        const latest = db.get(a.id)!;
        if (latest.state === 'SUBMITTED')
          db.transition(latest, 'DENIED', e instanceof Error ? e.message : String(e));
      }
      return reply.code(201).send(present(db.get(a.id)!, who));
    });
    app.post<{ Params: { id: string } }>('/v1/requests/:id/approve', async (req) => {
      requireHuman(req.headers.authorization);
      const { token } = z
        .object({ token: z.string().length(64) })
        .strict()
        .parse(req.body);
      expire();
      const r = find(req.params.id, 'human');
      if (
        r.state !== 'PENDING_APPROVAL' ||
        !r.approvalToken ||
        !secretEqual(token, r.approvalToken)
      )
        throw Error('Approval token unavailable, expired or consumed');
      const policy = db.policy()!;
      try {
        if (policy.revision !== r.policyVersion) throw Error('Policy changed; resubmit');
        if (evaluate(policy.policy, r.action).effect === 'deny')
          throw Error('Policy now denies action');
        db.transaction(() => {
          reserve(r, policy.policy);
          db.transition(r, 'APPROVED', 'Human approved exact immutable request');
        });
        schedule(r.action.id);
      } catch (e) {
        if (db.get(r.action.id)!.state === 'PENDING_APPROVAL')
          db.transition(r, 'DENIED', e instanceof Error ? e.message : String(e));
        throw e;
      }
      return present(db.get(r.action.id)!, 'human');
    });
    app.post<{ Params: { id: string } }>('/v1/requests/:id/deny', async (req) => {
      requireHuman(req.headers.authorization);
      z.object({}).strict().parse(req.body);
      const r = find(req.params.id, 'human');
      if (r.state !== 'PENDING_APPROVAL') throw Error('Action is not pending');
      db.transition(r, 'DENIED', 'Human rejected');
      return present(r, 'human');
    });
    app.post<{ Params: { id: string } }>('/v1/requests/:id/cancel', async (req) => {
      z.object({}).strict().parse(req.body);
      const who = principal(req.headers.authorization),
        r = find(req.params.id, who);
      if (done.has(r.state)) throw Error('Action already terminal');
      db.transaction(() => {
        if (r.state !== 'EXECUTING') db.release(r);
        db.transition(r, 'CANCELLED', 'Cancelled by authorized principal');
      });
      controllers.get(r.action.id)?.abort();
      return present(r, who);
    });
    app.get('/v1/policy', async (req) => {
      requireHuman(req.headers.authorization);
      return db.policy();
    });
    app.post('/v1/policy', async (req) => {
      requireHuman(req.headers.authorization);
      const { yaml } = z
        .object({ yaml: z.string().max(100000) })
        .strict()
        .parse(req.body);
      return db.apply(safePolicy(parsePolicy(yaml)));
    });
    app.post('/v1/agents', async (req) => {
      requireHuman(req.headers.authorization);
      const input = z
        .object({
          agentId: actionSchema.shape.agentId,
          sessionIds: z.array(actionSchema.shape.sessionId).min(1).max(100),
        })
        .strict()
        .parse(req.body);
      const token = randomBytes(32).toString('hex'),
        id = 'credential-' + randomBytes(16).toString('hex');
      db.addPrincipal(
        id,
        input.agentId,
        input.sessionIds,
        createHash('sha256').update(token).digest('hex'),
      );
      return { id, agentId: input.agentId, sessionIds: input.sessionIds, token };
    });
    app.get('/v1/budgets', async (req) => {
      requireHuman(req.headers.authorization);
      return db.budgets();
    });
    app.post<{ Params: { id: string } }>('/v1/requests/:id/settle', async (req) => {
      requireHuman(req.headers.authorization);
      const body = z
        .object({
          amount: z.number().int().nonnegative().max(1e12),
          evidence: z.string().min(1).max(2000),
        })
        .strict()
        .parse(req.body);
      db.settle(req.params.id, body.amount, body.evidence);
      return { ok: true };
    });
    app.get('/v1/audit', async (req) => {
      requireHuman(req.headers.authorization);
      return db.audits();
    });
    const web = fileURLToPath(new URL('./web', import.meta.url));
    for (const entry of readdirSync(web, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const disk = path.join(entry.parentPath, entry.name);
      const relative = path.relative(web, disk).split(path.sep).join('/');
      const route = relative === 'index.html' ? '/' : '/' + relative;
      const type = relative.endsWith('.html')
        ? 'text/html'
        : relative.endsWith('.js')
          ? 'application/javascript'
          : relative.endsWith('.css')
            ? 'text/css'
            : 'application/octet-stream';
      const bytes = readFileSync(disk);
      app.get(route, async (_req, reply) => reply.type(type).send(bytes));
    }
    await app.listen({ host: '127.0.0.1', port: configuredPort });
    const address = app.server.address();
    if (address && typeof address === 'object') origin = `http://127.0.0.1:${address.port}`;
    const timer = setInterval(expire, 100);
    timer.unref();
    console.log(
      JSON.stringify({
        url: origin,
        dataDir: data,
        credentials:
          'human.token for operator; agent.token for MCP. Keep human token outside agent context.',
      }),
    );
    let closePromise: Promise<void> | undefined;
    const close = () =>
      (closePromise ??= (async () => {
        closing = true;
        clearInterval(timer);
        for (const c of controllers.values()) c.abort();
        await Promise.allSettled([...jobs]);
        await app.close();
        db.close();
        unlinkSync(lock);
      })());
    const shutdown = () => {
      void close().then(() => process.exit(0));
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
    return { close };
  } catch (e) {
    store?.close();
    unlinkSync(lock);
    throw e;
  }
}
