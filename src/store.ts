import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import type { Action, Policy, RequestRecord, State } from './contracts.js';
export type Stored = RequestRecord & { fingerprint: string; principal: string };
export class Store {
  db: DatabaseSync;
  private inTransaction = false;
  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
 CREATE TABLE IF NOT EXISTS policies(revision INTEGER PRIMARY KEY AUTOINCREMENT,json TEXT NOT NULL,at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY,json TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS audit(sequence INTEGER PRIMARY KEY AUTOINCREMENT,requestId TEXT,state TEXT NOT NULL,reason TEXT NOT NULL,at TEXT NOT NULL,details TEXT);
 CREATE TABLE IF NOT EXISTS budgets(sessionId TEXT,currency TEXT,maximum INTEGER NOT NULL,reserved INTEGER NOT NULL DEFAULT 0,settled INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(sessionId,currency));
 CREATE TABLE IF NOT EXISTS principals(id TEXT PRIMARY KEY,agentId TEXT NOT NULL,sessions TEXT NOT NULL,hash TEXT NOT NULL UNIQUE);
 CREATE TABLE IF NOT EXISTS reservations(requestId TEXT PRIMARY KEY,sessionId TEXT,currency TEXT,amount INTEGER,status TEXT NOT NULL,actual INTEGER,evidence TEXT);
 `);
    if (
      !(this.db.prepare('PRAGMA table_info(audit)').all() as { name: string }[]).some(
        (c) => c.name === 'details',
      )
    )
      this.db.exec('ALTER TABLE audit ADD COLUMN details TEXT');
  }
  transaction<T>(fn: () => T): T {
    if (this.inTransaction) return fn();
    this.db.exec('BEGIN IMMEDIATE');
    this.inTransaction = true;
    try {
      const v = fn();
      this.db.exec('COMMIT');
      return v;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    } finally {
      this.inTransaction = false;
    }
  }
  policy(): { revision: number; policy: Policy } | undefined {
    const r = this.db.prepare('SELECT * FROM policies ORDER BY revision DESC LIMIT 1').get() as
      { revision: number; json: string } | undefined;
    return r ? { revision: r.revision, policy: JSON.parse(r.json) } : undefined;
  }
  apply(policy: Policy) {
    return this.transaction(() => {
      for (const b of policy.budgets) {
        const old = this.db
          .prepare('SELECT * FROM budgets WHERE sessionId=? AND currency=?')
          .get(b.sessionId, b.currency) as { reserved: number; settled: number } | undefined;
        if (old && old.reserved + old.settled > b.maximum)
          throw Error('Budget below committed usage');
        this.db
          .prepare(
            'INSERT INTO budgets(sessionId,currency,maximum) VALUES(?,?,?) ON CONFLICT(sessionId,currency) DO UPDATE SET maximum=excluded.maximum',
          )
          .run(b.sessionId, b.currency, b.maximum);
      }
      const ids = new Set(policy.budgets.map((b) => b.sessionId + ':' + b.currency));
      for (const b of this.budgets())
        if (!ids.has(b.sessionId + ':' + b.currency))
          this.db
            .prepare('UPDATE budgets SET maximum=reserved+settled WHERE sessionId=? AND currency=?')
            .run(b.sessionId, b.currency);
      this.db
        .prepare('INSERT INTO policies(json,at) VALUES(?,?)')
        .run(JSON.stringify(policy), new Date().toISOString());
      this.audit('', 'POLICY_APPLIED', 'Human installed policy');
      return this.policy()!;
    });
  }
  audit(id: string, state: string, reason: string) {
    const r = id ? this.get(id) : undefined;
    this.db
      .prepare('INSERT INTO audit(requestId,state,reason,at,details) VALUES(?,?,?,?,?)')
      .run(
        id,
        state,
        reason,
        new Date().toISOString(),
        r
          ? JSON.stringify({ action: r.action, policyVersion: r.policyVersion, result: r.result })
          : null,
      );
  }
  audits() {
    return this.db
      .prepare('SELECT * FROM audit ORDER BY sequence')
      .all()
      .map((r) => ({ ...r, details: r.details ? JSON.parse(r.details as string) : null }));
  }
  get(id: string): Stored | undefined {
    const r = this.db.prepare('SELECT json FROM requests WHERE id=?').get(id) as
      { json: string } | undefined;
    return r ? JSON.parse(r.json) : undefined;
  }
  list(): Stored[] {
    return this.db
      .prepare('SELECT json FROM requests ORDER BY rowid DESC')
      .all()
      .map((r) => JSON.parse(r.json as string));
  }
  save(r: Stored) {
    this.db.prepare('UPDATE requests SET json=? WHERE id=?').run(JSON.stringify(r), r.action.id);
  }
  insert(a: Action, revision: number, ttl: number, principal: string): Stored {
    const r: Stored = {
      action: a,
      state: 'SUBMITTED',
      reason: 'Submitted',
      policyVersion: revision,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + ttl).toISOString(),
      fingerprint: '',
      principal,
    };
    return this.transaction(() => {
      this.db.prepare('INSERT INTO requests(id,json) VALUES(?,?)').run(a.id, JSON.stringify(r));
      this.audit(a.id, r.state, r.reason);
      return r;
    });
  }
  transition(r: Stored, state: State, reason: string) {
    this.transaction(() => {
      r.state = state;
      r.reason = reason;
      if (state === 'PENDING_APPROVAL') r.approvalToken = randomBytes(32).toString('hex');
      else delete r.approvalToken;
      this.save(r);
      this.audit(r.action.id, state, reason);
    });
  }
  reserve(r: Stored, p: Policy) {
    const cost = r.action.maxCost;
    if (!cost || cost.amount === 0) return;
    if (!p.budgets.some((b) => b.sessionId === r.action.sessionId && b.currency === cost.currency))
      throw Error('No budget for session/currency');
    const result = this.db
      .prepare(
        'UPDATE budgets SET reserved=reserved+? WHERE sessionId=? AND currency=? AND maximum-reserved-settled>=?',
      )
      .run(cost.amount, r.action.sessionId, cost.currency, cost.amount);
    if (result.changes !== 1) throw Error('Budget exhausted');
    this.db
      .prepare(
        'INSERT INTO reservations(requestId,sessionId,currency,amount,status) VALUES(?,?,?,?,?)',
      )
      .run(r.action.id, r.action.sessionId, cost.currency, cost.amount, 'reserved');
  }
  release(r: Stored) {
    const v = this.db
      .prepare("SELECT * FROM reservations WHERE requestId=? AND status='reserved'")
      .get(r.action.id) as { amount: number; sessionId: string; currency: string } | undefined;
    if (v) {
      this.db
        .prepare('UPDATE budgets SET reserved=reserved-? WHERE sessionId=? AND currency=?')
        .run(v.amount, v.sessionId, v.currency);
      this.db
        .prepare("UPDATE reservations SET status='released' WHERE requestId=?")
        .run(r.action.id);
    }
  }
  settle(id: string, amount: number, evidence: string) {
    return this.transaction(() => {
      const r = this.get(id);
      if (!r || !['COMPLETED', 'FAILED', 'CANCELLED'].includes(r.state))
        throw Error('Only finished executions may be settled');
      const v = this.db
        .prepare("SELECT * FROM reservations WHERE requestId=? AND status='reserved'")
        .get(id) as { amount: number; sessionId: string; currency: string } | undefined;
      if (!v) throw Error('No unsettled reservation');
      this.db
        .prepare(
          'UPDATE budgets SET reserved=reserved-?,settled=settled+? WHERE sessionId=? AND currency=?',
        )
        .run(v.amount, amount, v.sessionId, v.currency);
      this.db
        .prepare("UPDATE reservations SET status='settled',actual=?,evidence=? WHERE requestId=?")
        .run(amount, evidence, id);
      this.audit(id, 'COST_SETTLED', JSON.stringify({ amount, evidence }));
    });
  }
  budgets() {
    return this.db
      .prepare('SELECT *,maximum-reserved-settled AS remaining FROM budgets')
      .all() as unknown as {
      sessionId: string;
      currency: string;
      maximum: number;
      reserved: number;
      settled: number;
      remaining: number;
    }[];
  }
  principals() {
    return this.db.prepare('SELECT * FROM principals').all() as unknown as {
      id: string;
      agentId: string;
      sessions: string;
      hash: string;
    }[];
  }
  addPrincipal(id: string, agentId: string, sessions: string[], hash: string) {
    this.db
      .prepare('INSERT INTO principals VALUES(?,?,?,?)')
      .run(id, agentId, JSON.stringify(sessions), hash);
    this.audit('', 'AGENT_CREDENTIAL_ISSUED', JSON.stringify({ id, agentId, sessions }));
  }
  close() {
    this.db.close();
  }
}
