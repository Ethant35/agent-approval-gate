import React, { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Policy, RequestRecord, State } from '../src/contracts.js';
import './style.css';

type Budget = { sessionId: string; currency: string; maximum: number; reserved: number; settled: number; remaining: number };
type AuditEntry = { sequence: number; requestId: string; state: State; reason: string; at: string };
type Snapshot = { requests: RequestRecord[]; policy: { revision: number; policy: Policy }; budgets: Budget[]; audit: AuditEntry[] };
const terminalStates: State[] = ['COMPLETED', 'FAILED', 'DENIED', 'EXPIRED', 'CANCELLED'];
const allStates: State[] = ['SUBMITTED', 'ALLOWED', 'DENIED', 'PENDING_APPROVAL', 'APPROVED', 'EXECUTING', 'COMPLETED', 'FAILED', 'EXPIRED', 'CANCELLED'];

function readPreference<T>(key: string, fallback: T): T {
  try { const value = localStorage.getItem(key); return value === null ? fallback : JSON.parse(value) as T; }
  catch { return fallback; }
}
function savePreference(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Private browsing may disable storage. */ }
}
function date(value?: string) {
  if (!value) return 'Not set';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}
function money(value: number, currency: string) {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value / 100); }
  catch { return `${currency} ${(value / 100).toFixed(2)}`; }
}
function statusClass(state: string) { return `status status-${state.toLowerCase().replaceAll('_', '-')}`; }
function actionLabel(request: RequestRecord) {
  const { action } = request;
  if (action.category === 'filesystem') return `${action.operation === 'write' ? 'Write' : 'Read'} file`;
  if (action.category === 'shell') return 'Run command';
  if (action.category === 'http') return 'HTTP request';
  return 'Launch subagent';
}
function exactOperation(request: RequestRecord) {
  const { action } = request;
  const p = action.parameters;
  if (action.category === 'filesystem') return `${action.operation.toUpperCase()} ${p.path ?? '(path missing)'}`;
  if (action.category === 'shell') return [p.executable ?? '(executable missing)', ...(p.args ?? [])].join(' ');
  if (action.category === 'http') return `${p.method ?? 'GET'} ${p.url ?? '(URL missing)'}`;
  return `Launch ${p.childAgentId ?? '(agent missing)'} with ${p.runner ?? '(runner missing)'}`;
}

function App() {
  const [token, setToken] = useState(() => sessionStorage.getItem('aag-human-token') ?? '');
  const [tokenInput, setTokenInput] = useState('');
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot>({ requests: [], policy: { revision: 0, policy: {} as Policy }, budgets: [], audit: [] });
  const [filter, setFilter] = useState(() => readPreference('aag-request-filter', 'all'));
  const [search, setSearch] = useState(() => readPreference('aag-search', ''));
  const [auditSearch, setAuditSearch] = useState(() => readPreference('aag-audit-search', ''));
  const [theme, setTheme] = useState(() => readPreference<'light' | 'dark'>('aag-theme', 'light'));
  const [confirm, setConfirm] = useState<{ request: RequestRecord; kind: 'approve' | 'deny' } | null>(null);
  const [busyId, setBusyId] = useState('');

  useEffect(() => { document.documentElement.dataset.theme = theme; savePreference('aag-theme', theme); }, [theme]);
  useEffect(() => savePreference('aag-request-filter', filter), [filter]);
  useEffect(() => savePreference('aag-search', search), [search]);
  useEffect(() => savePreference('aag-audit-search', auditSearch), [auditSearch]);

  const api = useCallback(async <T,>(path: string, options: RequestInit = {}, authToken = token): Promise<T> => {
    const headers = new Headers(options.headers);
    headers.set('Authorization', `Bearer ${authToken}`);
    if (options.method && options.method !== 'GET') {
      headers.set('X-AAG-Intent', 'human');
      headers.set('Content-Type', 'application/json');
    }
    const response = await fetch(path, { ...options, headers, credentials: 'same-origin' });
    if (!response.ok) {
      let detail = `${response.status} ${response.statusText}`;
      try { const body = await response.json() as { error?: string; message?: string }; detail = body.error ?? body.message ?? detail; } catch { /* Keep status text. */ }
      throw new Error(detail);
    }
    return await response.json() as T;
  }, [token]);

  const refresh = useCallback(async (authToken = token) => {
    const [requests, policy, budgets, audit] = await Promise.all([
      api<RequestRecord[]>('/v1/requests', {}, authToken),
      api<{ revision: number; policy: Policy }>('/v1/policy', {}, authToken),
      api<Budget[]>('/v1/budgets', {}, authToken),
      api<AuditEntry[]>('/v1/audit', {}, authToken),
    ]);
    setSnapshot({ requests, policy, budgets, audit });
    setConnected(true);
    setError('');
  }, [api, token]);

  useEffect(() => {
    if (!token) return;
    let active = true;
    const run = async () => {
      try { await refresh(); }
      catch (cause) {
        if (!active) return;
        setConnected(false);
        const message = cause instanceof Error ? cause.message : 'Could not connect to the gateway.';
        setError(message);
        if (/401|403|unauthor/i.test(message)) {
          sessionStorage.removeItem('aag-human-token'); setToken('');
        }
      }
    };
    void run();
    const timer = window.setInterval(() => void run(), 1000);
    return () => { active = false; window.clearInterval(timer); };
  }, [token, refresh]);

  const connect = async (event: FormEvent) => {
    event.preventDefault();
    const candidate = tokenInput.trim();
    if (!candidate) { setError('Enter the human token to connect.'); return; }
    setLoading(true); setError('');
    try {
      await refresh(candidate);
      sessionStorage.setItem('aag-human-token', candidate);
      setToken(candidate); setTokenInput('');
    } catch (cause) {
      setConnected(false);
      setError(cause instanceof Error ? cause.message : 'Connection failed.');
    } finally { setLoading(false); }
  };

  const disconnect = () => {
    sessionStorage.removeItem('aag-human-token'); setToken(''); setTokenInput(''); setConnected(false);
    setSnapshot({ requests: [], policy: { revision: 0, policy: {} as Policy }, budgets: [], audit: [] });
  };

  const act = async (request: RequestRecord, kind: 'approve' | 'deny' | 'cancel') => {
    setBusyId(request.action.id); setError('');
    try {
      const path = `/v1/requests/${encodeURIComponent(request.action.id)}/${kind}`;
      await api(path, { method: 'POST', body: JSON.stringify(kind === 'approve' ? { token: request.approvalToken } : {}) });
      setConfirm(null); await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : `Could not ${kind} request.`); }
    finally { setBusyId(''); }
  };

  const visibleRequests = useMemo(() => snapshot.requests.filter((record) => {
    const matchesState = filter === 'all' || record.state === filter;
    const haystack = [record.action.id, record.action.agentId, record.action.sessionId, record.action.category, record.action.operation,
      record.reason, record.action.resourceScope, JSON.stringify(record.action.parameters)].join(' ').toLowerCase();
    return matchesState && haystack.includes(search.toLowerCase());
  }), [snapshot.requests, filter, search]);
  const pending = snapshot.requests.filter((item) => item.state === 'PENDING_APPROVAL');
  const activeSessions = new Map<string, RequestRecord[]>();
  snapshot.requests.filter((item) => !terminalStates.includes(item.state)).forEach((item) => {
    const items = activeSessions.get(item.action.sessionId) ?? []; items.push(item); activeSessions.set(item.action.sessionId, items);
  });
  const auditRows = snapshot.audit.filter((entry) => `${entry.sequence} ${entry.requestId} ${entry.state} ${entry.reason} ${entry.at}`.toLowerCase().includes(auditSearch.toLowerCase()));

  return <div className="app-shell">
    <header className="topbar">
      <a className="brand" href="#top" aria-label="Agent Approval Gate home"><span className="brand-mark" aria-hidden="true">A</span><span><strong>Agent Approval Gate</strong><small>Human control plane</small></span></a>
      <div className="top-actions">
        <span className={`connection ${connected ? 'is-connected' : ''}`}><i aria-hidden="true" />{connected ? 'Gateway connected' : 'Gateway disconnected'}</span>
        <button className="icon-button" type="button" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`} title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}>{theme === 'light' ? '◐' : '☼'}</button>
        {connected && <button className="button button-quiet" type="button" onClick={disconnect}>Disconnect</button>}
      </div>
    </header>

    {!connected && <main className="connect-wrap" id="top"><form className="connect-card" onSubmit={connect}>
      <div className="eyebrow">LOCAL GATEWAY</div><h1>Connect to your gateway</h1><p>Enter the human token created by <code>aag serve</code>. It stays in this browser session.</p>
      <label htmlFor="human-token">Human token</label><input id="human-token" type="password" autoComplete="current-password" value={tokenInput} onChange={(event) => setTokenInput(event.target.value)} autoFocus />
      {error && <div role="alert" className="alert alert-error">{error}</div>}
      <button className="button button-primary full-width" type="submit" disabled={loading}>{loading ? 'Connecting…' : 'Connect'}</button>
    </form></main>}

    {connected && <main id="top" className="content">
      <div className="page-heading"><div><div className="eyebrow">LOCAL APPROVAL GATE</div><h1>Action overview</h1><p>Review agent requests, control execution, and inspect the audit trail.</p></div><span className="updated">Refreshes every second</span></div>
      {error && <div role="alert" className="alert alert-error inline-alert">{error}<button type="button" className="alert-dismiss" aria-label="Dismiss error" onClick={() => setError('')}>×</button></div>}
      <section className="metrics" aria-label="Gateway summary">
        <article className="metric"><span>Awaiting approval</span><strong>{pending.length}</strong><small>Actions blocked until reviewed</small></article>
        <article className="metric"><span>Active sessions</span><strong>{activeSessions.size}</strong><small>Currently in progress</small></article>
        <article className="metric"><span>Policy revision</span><strong>{snapshot.policy.revision || '—'}</strong><small>{snapshot.policy.policy?.default ? `Default ${snapshot.policy.policy.default}` : 'No policy loaded'}</small></article>
        <article className="metric"><span>Recent records</span><strong>{snapshot.requests.length}</strong><small>Persisted gateway actions</small></article>
      </section>

      <section className="panel request-panel" aria-labelledby="queue-title">
        <div className="panel-heading"><div><div className="eyebrow">DECISIONS</div><h2 id="queue-title">Action queue</h2></div><span className="count-pill">{pending.length} pending</span></div>
        <div className="toolbar"><label className="search-field"><span className="sr-only">Search actions</span><span aria-hidden="true">⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search actions, agents, sessions…" /></label><label className="filter-field"><span className="sr-only">Filter by status</span><select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">All statuses</option>{allStates.map((state) => <option key={state} value={state}>{state.replaceAll('_', ' ')}</option>)}</select></label></div>
        <div className="request-list">
          {visibleRequests.length === 0 && <div className="empty-state"><span aria-hidden="true">✓</span><strong>{snapshot.requests.length ? 'No matching actions' : 'No actions yet'}</strong><p>{snapshot.requests.length ? 'Try another search or status.' : 'Submitted actions will appear here.'}</p></div>}
          {visibleRequests.map((request) => <article className={`request-card ${request.state === 'PENDING_APPROVAL' ? 'is-pending' : ''}`} key={request.action.id}>
            <div className="request-main"><div className="request-title-line"><h3>{actionLabel(request)}</h3><span className={statusClass(request.state)}>{request.state.replaceAll('_', ' ')}</span></div><div className="request-command">{exactOperation(request)}</div><p className="reason">{request.reason || 'No reason supplied by policy engine.'}</p>
              <div className="request-meta"><span><b>Agent</b>{request.action.agentId}</span><span><b>Session</b>{request.action.sessionId}</span><span><b>Request</b><code>{request.action.id}</code></span><span><b>Submitted</b>{date(request.createdAt)}</span></div>
              <details className="details"><summary>Full parameters and scope</summary><div className="details-grid"><div><h4>Parameters</h4><pre>{JSON.stringify(request.action.parameters, null, 2)}</pre></div><div><h4>Resource scope</h4><p className="scope-text">{request.action.resourceScope}</p><h4>Requested permissions</h4><p>{request.action.requestedPermissions.join(', ') || 'None declared'}</p><h4>Expected result</h4><p>{request.action.expectedResultFormat}</p>{request.action.maxCost && <><h4>Declared maximum cost</h4><p>{money(request.action.maxCost.amount, request.action.maxCost.currency)}</p></>}</div></div></details>
              {request.state === 'PENDING_APPROVAL' && <div className="expiry"><span aria-hidden="true">◷</span> Approval expires {date(request.expiresAt)}</div>}
              {(request.state === 'COMPLETED' || request.state === 'FAILED') && request.result !== undefined && <details className="details result-details"><summary>Execution result</summary><pre>{typeof request.result === 'string' ? request.result : JSON.stringify(request.result, null, 2)}</pre></details>}
            </div>
            <div className="request-actions">{request.state === 'PENDING_APPROVAL' && <><button className="button button-primary" type="button" onClick={() => setConfirm({ request, kind: 'approve' })}>Approve</button><button className="button button-danger-outline" type="button" disabled={busyId === request.action.id} onClick={() => setConfirm({ request, kind: 'deny' })}>Reject</button></>}{['SUBMITTED', 'ALLOWED', 'APPROVED', 'EXECUTING'].includes(request.state) && <button className="button button-quiet" type="button" disabled={busyId === request.action.id} onClick={() => void act(request, 'cancel')}>{busyId === request.action.id ? 'Cancelling…' : 'Cancel'}</button>}</div>
          </article>)}
        </div>
      </section>

      <div className="lower-grid">
        <section className="panel" aria-labelledby="sessions-title"><div className="panel-heading"><div><div className="eyebrow">IN FLIGHT</div><h2 id="sessions-title">Active agent sessions</h2></div><span className="count-pill">{activeSessions.size}</span></div>{activeSessions.size === 0 ? <p className="muted empty-inline">No active sessions.</p> : <div className="session-list">{[...activeSessions.entries()].map(([sessionId, requests]) => <div className="session-row" key={sessionId}><span className="session-icon" aria-hidden="true">◉</span><div><strong>{sessionId}</strong><small>{[...new Set(requests.map((r) => r.action.agentId))].join(', ')} · {requests.length} active {requests.length === 1 ? 'action' : 'actions'}</small></div><span className={statusClass(requests.some((r) => r.state === 'EXECUTING') ? 'EXECUTING' : requests[0]?.state ?? 'SUBMITTED')}>{requests.some((r) => r.state === 'EXECUTING') ? 'EXECUTING' : requests[0]?.state}</span></div>)}</div>}</section>

        <section className="panel" aria-labelledby="budgets-title"><div className="panel-heading"><div><div className="eyebrow">SPENDING CONTROL</div><h2 id="budgets-title">Session budgets</h2></div><span className="count-pill">{snapshot.budgets.length}</span></div>{snapshot.budgets.length === 0 ? <p className="muted empty-inline">No session budgets configured.</p> : <div className="budget-list">{snapshot.budgets.map((budget) => { const spent = budget.reserved + budget.settled; const percent = budget.maximum > 0 ? Math.min(100, (spent / budget.maximum) * 100) : 0; return <div className="budget-row" key={`${budget.sessionId}-${budget.currency}`}><div className="budget-top"><strong>{budget.sessionId}</strong><span>{money(budget.remaining, budget.currency)} remaining</span></div><div className="progress" role="progressbar" aria-label={`Budget used for ${budget.sessionId}`} aria-valuemin={0} aria-valuemax={budget.maximum} aria-valuenow={spent}><span style={{ width: `${percent}%` }} /></div><div className="budget-breakdown"><span>Maximum <b>{money(budget.maximum, budget.currency)}</b></span><span>Reserved <b>{money(budget.reserved, budget.currency)}</b></span><span>Settled <b>{money(budget.settled, budget.currency)}</b></span></div></div>; })}</div>}</section>
      </div>

      <section className="panel" aria-labelledby="policy-title"><div className="panel-heading"><div><div className="eyebrow">ACTIVE RULESET</div><h2 id="policy-title">Policy</h2></div><span className="count-pill">Revision {snapshot.policy.revision}</span></div><div className="policy-summary"><span className="policy-default">Default decision <strong>{snapshot.policy.policy.default ?? 'Unknown'}</strong></span><span>Workspace <code>{snapshot.policy.policy.workspace ?? 'Not configured'}</code></span><span>{snapshot.policy.policy.rules?.length ?? 0} explicit rules</span></div><details className="details policy-json"><summary>View complete policy</summary><pre>{JSON.stringify(snapshot.policy.policy, null, 2)}</pre></details></section>

      <section className="panel" aria-labelledby="history-title"><div className="panel-heading"><div><div className="eyebrow">IMMUTABLE RECORD</div><h2 id="history-title">Audit history</h2></div><span className="count-pill">{snapshot.audit.length} entries</span></div><label className="search-field audit-search"><span className="sr-only">Search audit history</span><span aria-hidden="true">⌕</span><input value={auditSearch} onChange={(event) => setAuditSearch(event.target.value)} placeholder="Search request, state, or reason…" /></label><div className="audit-table-wrap"><table><thead><tr><th scope="col">Seq.</th><th scope="col">Request</th><th scope="col">State</th><th scope="col">Reason</th><th scope="col">Time</th></tr></thead><tbody>{auditRows.length === 0 ? <tr><td className="table-empty" colSpan={5}>No matching audit entries.</td></tr> : auditRows.slice().reverse().map((entry) => <tr key={`${entry.sequence}-${entry.requestId}-${entry.state}-${entry.at}`}><td>{entry.sequence}</td><td><code>{entry.requestId}</code></td><td><span className={statusClass(entry.state)}>{entry.state.replaceAll('_', ' ')}</span></td><td className="audit-reason">{entry.reason}</td><td>{date(entry.at)}</td></tr>)}</tbody></table></div></section>

      <section className="panel" aria-labelledby="activity-title"><div className="panel-heading"><div><div className="eyebrow">EXECUTION LOG</div><h2 id="activity-title">Recent actions</h2></div><span className="count-pill">{snapshot.requests.filter((r) => terminalStates.includes(r.state)).length}</span></div><div className="activity-list">{snapshot.requests.filter((r) => terminalStates.includes(r.state)).slice().reverse().slice(0, 12).map((r) => <div className="activity-row" key={`activity-${r.action.id}`}><span className={`activity-dot dot-${r.state.toLowerCase()}`} /><div><strong>{actionLabel(r)} <span className="muted">· {r.action.agentId}</span></strong><small>{exactOperation(r)} · {date(r.createdAt)}</small></div><span className={statusClass(r.state)}>{r.state}</span></div>)}{snapshot.requests.filter((r) => terminalStates.includes(r.state)).length === 0 && <p className="muted empty-inline">No completed, denied, expired, or failed actions yet.</p>}</div></section>
    </main>}

    <footer className="footer"><span>Agent Approval Gate</span><span>Local decisions · Human authority</span></footer>
    {confirm && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setConfirm(null); }}><section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-description"><button className="modal-close" type="button" aria-label="Close confirmation" onClick={() => setConfirm(null)}>×</button><div className={`modal-symbol ${confirm.kind}`} aria-hidden="true">{confirm.kind === 'approve' ? '!' : '×'}</div><div className="eyebrow">HUMAN DECISION</div><h2 id="confirm-title">{confirm.kind === 'approve' ? 'Confirm approval' : 'Confirm rejection'}</h2><p id="confirm-description">{confirm.kind === 'approve' ? 'This action will be allowed to execute with the exact parameters shown below.' : 'This action will be rejected and will not execute.'}</p><div className="confirm-summary"><strong>{actionLabel(confirm.request)}</strong><code>{exactOperation(confirm.request)}</code><span>Agent {confirm.request.action.agentId} · Session {confirm.request.action.sessionId}</span><span>Scope: {confirm.request.action.resourceScope}</span><span>Expires {date(confirm.request.expiresAt)}</span></div><div className="modal-actions"><button className="button button-quiet" type="button" onClick={() => setConfirm(null)}>Go back</button><button className={`button ${confirm.kind === 'approve' ? 'button-primary' : 'button-danger'}`} type="button" disabled={busyId === confirm.request.action.id} onClick={() => void act(confirm.request, confirm.kind)}>{busyId === confirm.request.action.id ? 'Submitting…' : confirm.kind === 'approve' ? 'Confirm approval' : 'Confirm rejection'}</button></div></section></div>}
  </div>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
