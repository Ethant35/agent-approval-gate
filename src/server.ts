import Fastify from 'fastify';
import { requireRuntime } from './runtime.js';
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  realpathSync,
  chmodSync,
  readdirSync,
  lstatSync,
} from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID, timingSafeEqual, createHash } from 'node:crypto';
import { stringify } from 'yaml';
import { z } from 'zod';
import { actionSchema, type Action, type Policy } from './contracts.js';
import { parsePolicy, defaultPolicy, evaluate, within } from './policy.js';
import { Store, type Stored } from './store.js';
import { execute, snapshot, processSupported } from './executor.js';
import { acquireLease } from './lease.js';
import {
  CodexSessionStartError,
  cleanupOrphanedCodexSessions,
  startCodexSession,
  type CodexSession,
  type CodexSessionOptions,
} from './codex-session.js';
type DesktopConnectionOptions = CodexSessionOptions & { workspace?: string };
const secretEqual = (a: string, b: string) => {
  const left = Buffer.from(a),
    right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};
const done = new Set(['COMPLETED', 'DENIED', 'FAILED', 'EXPIRED', 'CANCELLED']);
export async function startServer(
  options: {
    dataDir?: string;
    port?: number;
    policyFile?: string;
    startupLog?: boolean;
    operatorToken?: string;
    desktopConnection?: boolean | DesktopConnectionOptions;
  } = {},
) {
  requireRuntime();
  if (options.operatorToken !== undefined && !/^[a-f0-9]{64}$/.test(options.operatorToken))
    throw Error('Invalid in-memory operator credential');
  const data = path.resolve(
    options.dataDir || path.join(homedir(), '.local/share/agent-approval-gate'),
  );
  mkdirSync(data, { recursive: true, mode: 0o700 });
  if (realpathSync.native(data) !== data) throw Error('Data directory must use a canonical path');
  chmodSync(data, 0o700);
  if (existsSync(path.join(data, 'INCOMPLETE')))
    throw Error('State is an incomplete backup or restore; recover into a fresh directory');
  const lock = path.join(data, 'server.lock');
  const lease = await acquireLease(lock);
  let store: Store | undefined;
  try {
    const privateFile = (file: string) => {
      const s = lstatSync(file);
      if (!s.isFile() || s.nlink !== 1 || s.uid !== process.getuid!())
        throw Error('State files must be owned regular files with one link');
      chmodSync(file, 0o600);
    };
    const credential = (name: string) => {
      const f = path.join(data, name + '.token');
      if (!existsSync(f))
        writeFileSync(f, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 });
      privateFile(f);
      const t = readFileSync(f, 'utf8').trim();
      if (!/^[a-f0-9]{64}$/.test(t)) throw Error('Invalid credential file');
      return t;
    };
    const databaseFile = path.join(data, 'gateway.sqlite');
    for (const suffix of ['', '-wal', '-shm'])
      if (lstatSync(databaseFile + suffix, { throwIfNoEntry: false }))
        privateFile(databaseFile + suffix);
    store = new Store(databaseFile);
    privateFile(databaseFile);
    const db = store;
    if (options.desktopConnection) await cleanupOrphanedCodexSessions(data);
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
    if (options.operatorToken === agent || options.operatorToken === human)
      throw Error('In-memory operator credential must differ from persistent credentials');
    for (const principal of db.principals())
      if (principal.id.startsWith('desktop-codex-')) {
        for (const request of db.requestsForPrincipal(principal.id)) {
          if (done.has(request.state)) continue;
          db.transaction(() => {
            if (request.state !== 'EXECUTING') db.release(request);
            db.transition(
              request,
              'CANCELLED',
              'Managed Codex connection ended with gateway restart',
            );
          });
        }
        db.revokePrincipal(principal.id);
      }
    for (const r of db.states(['EXECUTING', 'ALLOWED', 'APPROVED', 'SUBMITTED']))
      db.transition(
        r,
        'FAILED',
        'Service interrupted; execution not retried; cost remains unverified',
      );
    const app = Fastify({ logger: false, bodyLimit: 1500000, requestTimeout: 15000 });
    const controllers = new Map<string, AbortController>(),
      jobs = new Set<Promise<void>>();
    type DesktopConnection = {
      status: 'starting' | 'connected' | 'disconnecting' | 'disconnected' | 'error';
      id: string;
      principalId: string;
      agentId: string;
      sessionId: string;
      startedAt: number;
      connectedAt?: string;
      lastSeenAt?: string;
      error?: string;
      launcher?: CodexSession;
    };
    let desktopConnection: DesktopConnection | undefined;
    let desktopQueue = Promise.resolve();
    const serializeDesktop = <T>(operation: () => Promise<T>): Promise<T> => {
      const result = desktopQueue.then(operation, operation);
      desktopQueue = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    };
    let closing = false;
    let degraded = false;
    let preparing = 0;
    const storageFault = (error: unknown) => {
      const code =
        error && typeof error === 'object' && 'errcode' in error ? Number(error.errcode) & 255 : 0;
      if (![5, 6, 7, 8, 10, 11, 13, 14, 26].includes(code)) return false;
      if (!degraded)
        console.error(
          JSON.stringify({ event: 'storage_unavailable', sqliteCode: code, restartRequired: true }),
        );
      degraded = true;
      for (const controller of controllers.values()) controller.abort();
      return true;
    };
    const configuredPort = options.port ?? 3741;
    let origin = `http://127.0.0.1:${configuredPort}`;
    const principal = (auth: string | undefined) => {
      const t = auth?.startsWith('Bearer ') ? auth.slice(7) : '';
      if (
        secretEqual(t, human) ||
        (options.operatorToken !== undefined && secretEqual(t, options.operatorToken))
      )
        return 'human';
      if (secretEqual(t, agent)) return 'agent';
      const hash = createHash('sha256').update(t).digest('hex');
      return db.principalByHash(hash) || '';
    };
    const present = (r: Stored, who: string) => {
      const { fingerprint: _f, principal: _p, ...record } = r;
      if (who !== 'human') delete record.approvalToken;
      return record;
    };
    const connectionView = () => {
      if (!desktopConnection) return { status: 'idle' as const };
      const c = desktopConnection;
      const status =
        c.status === 'starting' && Date.now() - c.startedAt > 60_000
          ? 'error'
          : c.status === 'connected' &&
              c.lastSeenAt &&
              Date.now() - Date.parse(c.lastSeenAt) > 30_000
            ? 'disconnected'
            : c.status;
      return {
        status,
        ...(status === 'starting' || status === 'connected'
          ? { agentId: c.agentId, sessionId: c.sessionId }
          : {}),
        ...(c.connectedAt ? { connectedAt: c.connectedAt } : {}),
        ...(c.lastSeenAt ? { lastSeenAt: c.lastSeenAt } : {}),
        ...(c.error ? { error: c.error } : {}),
      };
    };
    const cancelPrincipalWork = (principalId: string, reason: string) => {
      for (const request of db.requestsForPrincipal(principalId)) {
        const current = db.get(request.action.id);
        if (!current || done.has(current.state)) continue;
        db.transaction(() => {
          if (current.state !== 'EXECUTING') db.release(current);
          db.transition(current, 'CANCELLED', reason);
        });
        controllers.get(current.action.id)?.abort();
      }
    };
    const revokePrincipal = (id: string, reason: string) => {
      cancelPrincipalWork(id, reason);
      return db.revokePrincipal(id);
    };
    const stopDesktopConnection = async (revoke: boolean) => {
      const c = desktopConnection;
      if (!c) return true;
      if (revoke) revokePrincipal(c.principalId, 'Managed Codex connection revoked by operator');
      c.status = 'disconnecting';
      try {
        await c.launcher?.stop();
        c.launcher = undefined;
        c.status = 'disconnected';
        return true;
      } catch {
        c.error =
          'The Codex Terminal process could not be stopped. Check Terminal before reconnecting.';
        c.status = 'error';
        return false;
      }
    };
    const expireDesktopConnection = () =>
      serializeDesktop(async () => {
        const c = desktopConnection;
        if (!c) return;
        if (c.status === 'starting' && Date.now() - c.startedAt > 60_000) {
          c.status = 'error';
          c.error = 'Codex did not complete MCP setup. Close its Terminal session and try again.';
          await stopDesktopConnection(true);
          c.status = 'error';
          return;
        }
        if (
          c.status === 'connected' &&
          c.lastSeenAt &&
          Date.now() - Date.parse(c.lastSeenAt) > 30_000
        ) {
          await stopDesktopConnection(true);
        }
      });
    const visible = (r: Stored, who: string) => who === 'human' || r.principal === who;
    const find = (id: string, who: string) => {
      const r = db.get(id);
      if (!r || !visible(r, who)) throw Error('Request not found');
      return r;
    };
    function expire() {
      for (const r of db.states(['PENDING_APPROVAL']))
        if (r.state === 'PENDING_APPROVAL' && Date.parse(r.expiresAt) <= Date.now())
          db.transition(r, 'EXPIRED', 'Approval expired');
    }
    function reserve(r: Stored, p: Policy) {
      if (
        r.action.category === 'subagent' &&
        db
          .states(['EXECUTING', 'APPROVED', 'ALLOWED'])
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
          lease.assertHeld();
          if (degraded || closing) throw Error('Gateway unavailable');
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
              r.action.maxCost && r.action.maxCost.amount > 0
                ? 'Execution completed; declared cost remains reserved until authoritative settlement'
                : 'Execution completed successfully',
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
      void job
        .catch((error: unknown) => {
          if (!storageFault(error)) {
            degraded = true;
            console.error(
              JSON.stringify({ event: 'execution_persistence_failed', restartRequired: true }),
            );
            for (const controller of controllers.values()) controller.abort();
          }
        })
        .finally(() => jobs.delete(job));
    }
    app.addHook('onRequest', async (req, reply) => {
      lease.assertHeld();
      reply
        .header('X-Content-Type-Options', 'nosniff')
        .header('Referrer-Policy', 'no-referrer')
        .header('Cache-Control', 'no-store')
        .header(
          'Content-Security-Policy',
          "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; frame-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
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
        const who = principal(req.headers.authorization);
        if (!who) return reply.code(401).send({ error: 'Authorization required' });
        if (who.startsWith('desktop-codex-')) {
          const c = desktopConnection;
          const route = req.url.split('?')[0];
          const startupRoute =
            route === '/v1/desktop/connection/initialized' ||
            route === '/v1/desktop/connection/launch-check' ||
            route === '/v1/desktop/connection/ended';
          if (
            !c ||
            c.principalId !== who ||
            (c.status !== 'connected' && !(c.status === 'starting' && startupRoute)) ||
            (c.status === 'connected' &&
              c.lastSeenAt &&
              Date.now() - Date.parse(c.lastSeenAt) > 30_000)
          )
            return reply.code(401).send({ error: 'Managed Codex connection is unavailable' });
        }
        if (
          req.method !== 'GET' &&
          req.headers['x-aag-intent'] !== 'human' &&
          req.headers['x-aag-intent'] !== 'agent'
        )
          return reply.code(403).send({ error: 'Explicit intent header required' });
        if ((closing || degraded) && req.url !== '/v1/health')
          return reply.code(503).send({
            error:
              'Gateway unavailable; stop, check storage, then restart. Inspect accepted request IDs before retrying.',
          });
      }
    });
    const requireHuman = (auth: string | undefined) => {
      if (principal(auth) !== 'human') throw Error('Human authorization required');
    };
    if (options.desktopConnection) {
      const launcherOptions: DesktopConnectionOptions =
        options.desktopConnection === true ? {} : options.desktopConnection;
      const managedConnection = (auth: string | undefined) => {
        const who = principal(auth);
        const c = desktopConnection;
        if (!c || !who.startsWith('desktop-codex-') || who !== c.principalId)
          throw Error('Managed Codex credential is unavailable or revoked');
        return c;
      };
      app.get('/v1/desktop/connection', async (req) => {
        requireHuman(req.headers.authorization);
        return connectionView();
      });
      app.post('/v1/desktop/connection/start', async (req, reply) => {
        requireHuman(req.headers.authorization);
        z.object({}).strict().parse(req.body);
        return serializeDesktop(async () => {
          if (desktopConnection && ['starting', 'connected'].includes(desktopConnection.status)) {
            reply.code(409);
            return connectionView();
          }
          if (desktopConnection && !(await stopDesktopConnection(true))) return connectionView();
          const policy = db.policy();
          if (!policy) throw Error('A workspace policy is required before connecting Codex.');
          const workspace = launcherOptions.workspace ?? policy.policy.workspace;
          if (policy.policy.workspace !== workspace)
            throw Error(
              'Policy workspace changed. Restore the selected workspace before connecting.',
            );
          const connectionId = randomUUID();
          const sessionId = `codex-${randomUUID()}`;
          const agentId = 'codex-cli';
          const principalId = `desktop-codex-${connectionId}`;
          const token = randomBytes(32).toString('hex');
          db.addPrincipal(
            principalId,
            agentId,
            [sessionId],
            createHash('sha256').update(token).digest('hex'),
          );
          const c: DesktopConnection = {
            id: connectionId,
            principalId,
            agentId,
            sessionId,
            status: 'starting',
            startedAt: Date.now(),
          };
          desktopConnection = c;
          try {
            const launcher = await startCodexSession(
              {
                dataDir: data,
                workspace,
                url: origin,
                token,
                agentId,
                sessionId,
                connectionId,
              },
              launcherOptions,
            );
            if (desktopConnection !== c || (c.status !== 'starting' && c.status !== 'connected'))
              await launcher.stop();
            else c.launcher = launcher;
          } catch (error) {
            if (error instanceof CodexSessionStartError) c.launcher = error.session;
            revokePrincipal(principalId, 'Managed Codex connection launch failed');
            if (desktopConnection === c) {
              c.status = 'error';
              c.error = 'Codex could not start. Check the CLI installation and try again.';
            }
          }
          return connectionView();
        });
      });
      app.post('/v1/desktop/connection/disconnect', async (req) => {
        requireHuman(req.headers.authorization);
        z.object({}).strict().parse(req.body);
        return serializeDesktop(async () => {
          await stopDesktopConnection(true);
          return connectionView();
        });
      });
      app.post('/v1/desktop/connection/initialized', async (req) => {
        z.object({}).strict().parse(req.body);
        const c = managedConnection(req.headers.authorization);
        if (c.status !== 'starting' && c.status !== 'connected')
          throw Error('Managed Codex connection is not starting.');
        const now = new Date().toISOString();
        c.status = 'connected';
        c.connectedAt ??= now;
        c.lastSeenAt = now;
        return { ok: true };
      });
      app.post('/v1/desktop/connection/launch-check', async (req) => {
        z.object({}).strict().parse(req.body);
        const c = managedConnection(req.headers.authorization);
        if (c.status !== 'starting' && c.status !== 'connected')
          throw Error('Managed Codex launch is no longer active.');
        return { ok: true };
      });
      app.post('/v1/desktop/connection/heartbeat', async (req) => {
        z.object({}).strict().parse(req.body);
        const c = managedConnection(req.headers.authorization);
        if (c.status !== 'connected') throw Error('Managed Codex connection is not active.');
        c.lastSeenAt = new Date().toISOString();
        return { ok: true };
      });
      app.post('/v1/desktop/connection/ended', async (req) => {
        z.object({}).strict().parse(req.body);
        return serializeDesktop(async () => {
          const c = managedConnection(req.headers.authorization);
          await stopDesktopConnection(true);
          if (c.status === 'disconnected' && !c.connectedAt) {
            c.status = 'error';
            c.error = 'Codex ended before its MCP connection was confirmed.';
          }
          return { ok: true, status: connectionView().status };
        });
      });
    }
    app.get('/v1/health', async (req, reply) => {
      requireHuman(req.headers.authorization);
      return reply.code(closing || degraded ? 503 : 200).send({
        status: closing ? 'closing' : degraded ? 'storage-recovery-required' : 'ready',
        preparing,
        executing: jobs.size,
        uptimeSeconds: Math.floor(process.uptime()),
      });
    });
    app.setErrorHandler((error, _req, reply) => {
      if (storageFault(error))
        return reply.code(503).send({
          error:
            'Storage unavailable; restart after recovery. Inspect the request ID before retrying.',
        });
      return reply
        .code(400)
        .send({ error: error instanceof Error ? error.message : 'Request rejected' });
    });
    const pageQuery = z
      .object({
        view: z.enum(['summary', 'full']).default('full'),
        limit: z.coerce.number().int().min(1).max(100).default(100),
        before: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
        after: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
        scope: z.enum(['active', 'all']).optional(),
      })
      .strict();
    app.get('/v1/requests', async (req, reply) => {
      expire();
      const q = pageQuery.parse(req.query);
      if (q.after !== undefined) throw Error('Requests use the before cursor');
      const who = principal(req.headers.authorization);
      const page = db.requestPage({
        limit: q.limit,
        cursor: q.before,
        summary: q.view === 'summary',
        active: q.scope === 'active',
        principal: who === 'human' ? undefined : who,
      });
      if (page.next !== undefined) reply.header('X-AAG-Next-Cursor', page.next);
      return page.items.map((r) => present(r, who));
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
      expire();
      if (preparing >= 8 || jobs.size >= 8)
        return reply.code(429).send({
          error: 'Gateway busy; no request accepted. Try later with the same request ID.',
        });
      if (db.activeCount() >= 100)
        return reply
          .code(429)
          .send({ error: 'Active request limit reached; finish or cancel an existing request' });
      const policy = db.policy()!;
      const r = db.insert(a, policy.revision, policy.policy.limits.approvalTtlMs, who);
      preparing++;
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
      } finally {
        preparing--;
      }
      return reply.code(201).send(present(db.get(a.id)!, who));
    });
    app.post<{ Params: { id: string } }>('/v1/requests/:id/approve', async (req, reply) => {
      requireHuman(req.headers.authorization);
      if (jobs.size >= 8)
        return reply
          .code(429)
          .send({ error: 'Gateway busy; approval remains pending. Try later.' });
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
    app.post('/v1/policy/preview', async (req, reply) => {
      requireHuman(req.headers.authorization);
      const input = z
        .object({
          yaml: z.string().max(100000),
          expectedRevision: z.number().int().positive(),
          requestIds: z.array(actionSchema.shape.id).max(20).default([]),
          actions: z.array(actionSchema).max(20).default([]),
        })
        .strict()
        .parse(req.body);
      if (
        input.requestIds.length + input.actions.length < 1 ||
        input.requestIds.length + input.actions.length > 20
      )
        throw Error('Rehearse between 1 and 20 requests.');
      const current = db.policy()!;
      if (input.expectedRevision !== current.revision)
        return reply.code(409).send({ error: 'Policy changed. Reload it before rehearsal.' });
      const draft = safePolicy(parsePolicy(input.yaml));
      const samples = [
        ...input.requestIds.map((id) => {
          const record = db.get(id);
          if (!record) throw Error('Rehearsal request not found.');
          return { action: record.action, source: 'history' as const };
        }),
        ...input.actions.map((action) => ({ action, source: 'sample' as const })),
      ];
      const decision = (policy: Policy, action: Action) => {
        try {
          return evaluate(policy, action);
        } catch (error) {
          return {
            effect: 'deny',
            reason: error instanceof Error ? error.message : 'Invalid action',
          };
        }
      };
      // Policy evaluation only. Do not insert, snapshot, reserve, approve or execute here.
      return {
        revision: current.revision,
        results: samples.map(({ action, source }) => ({
          id: action.id,
          source,
          category: action.category,
          operation: action.operation,
          resourceScope: action.resourceScope,
          current: decision(current.policy, action),
          draft: decision(draft, action),
        })),
        limits: { current: current.policy.limits, draft: draft.limits },
        budgetsChanged: JSON.stringify(current.policy.budgets) !== JSON.stringify(draft.budgets),
        notice:
          'Policy decisions only. No actions executed, approvals granted, or changes saved. File state, DNS, credentials, available budgets and runtime limits are checked when a real request runs.',
      };
    });
    app.post('/v1/policy', async (req, reply) => {
      requireHuman(req.headers.authorization);
      const { yaml, expectedRevision } = z
        .object({
          yaml: z.string().max(100000),
          expectedRevision: z.number().int().positive().optional(),
        })
        .strict()
        .parse(req.body);
      if (expectedRevision !== undefined && expectedRevision !== db.policy()?.revision)
        return reply.code(409).send({ error: 'Policy changed. Reload it before saving.' });
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
    app.post<{ Params: { id: string } }>('/v1/agents/:id/revoke', async (req) => {
      requireHuman(req.headers.authorization);
      z.object({}).strict().parse(req.body);
      const id = z.string().min(1).max(128).parse(req.params.id);
      return serializeDesktop(async () => {
        if (desktopConnection?.principalId === id) await stopDesktopConnection(true);
        else revokePrincipal(id, 'Agent credential revoked by operator');
        return { ok: true };
      });
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
    app.get('/v1/audit', async (req, reply) => {
      requireHuman(req.headers.authorization);
      const q = pageQuery.parse(req.query);
      const summary = q.view === 'summary';
      if (q.scope || (summary ? q.after !== undefined : q.before !== undefined))
        throw Error('Audit summary uses before; full audit uses after');
      const page = db.auditPage({ limit: q.limit, cursor: summary ? q.before : q.after, summary });
      if (page.next !== undefined) reply.header('X-AAG-Next-Cursor', page.next);
      return page.items;
    });
    app.get<{ Params: { sequence: string } }>('/v1/audit/:sequence', async (req) => {
      requireHuman(req.headers.authorization);
      const sequence = z.coerce
        .number()
        .int()
        .positive()
        .max(Number.MAX_SAFE_INTEGER)
        .parse(req.params.sequence);
      const row = db.auditRecord(sequence);
      if (!row) throw Error('Audit record not found');
      return row;
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
    const timer = setInterval(() => {
      if (degraded || closing) return;
      try {
        expire();
        if (desktopConnection) void expireDesktopConnection().catch(() => undefined);
      } catch (error) {
        if (!storageFault(error)) {
          degraded = true;
          console.error(JSON.stringify({ event: 'expiry_failed', restartRequired: true }));
        }
      }
    }, 1000);
    timer.unref();
    if (options.startupLog !== false)
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
        let shutdownError: Error | undefined;
        try {
          if (!(await serializeDesktop(() => stopDesktopConnection(true))))
            shutdownError = new Error(
              'The managed Codex Terminal process could not be stopped. Check Terminal before closing Agent Approval Gate.',
            );
        } catch {
          shutdownError = new Error(
            'Agent Approval Gate could not stop its managed Codex session.',
          );
        }
        for (const c of controllers.values()) c.abort();
        await Promise.allSettled([...jobs]);
        try {
          await app.close();
        } catch {
          shutdownError ??= new Error('Agent Approval Gate could not close its local server.');
        } finally {
          try {
            db.close();
          } finally {
            await lease.release();
          }
        }
        if (shutdownError) throw shutdownError;
      })());
    lease.onLost(() => {
      void close().catch(() => process.exit(1));
    });
    const shutdown = () => {
      void close().then(
        () => process.exit(0),
        (error: unknown) => {
          const reason =
            error instanceof Error
              ? error.message
              : 'Agent Approval Gate could not complete shutdown.';
          console.error(`Agent Approval Gate shutdown incomplete: ${reason}`);
          process.exit(1);
        },
      );
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
    return { close, url: origin };
  } catch (e) {
    try {
      store?.close();
    } finally {
      await lease.release();
    }
    throw e;
  }
}
