import React, { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Policy, RequestRecord, State } from '../src/contracts.js';
import './style.css';

type Budget = {
  sessionId: string;
  currency: string;
  maximum: number;
  reserved: number;
  settled: number;
  remaining: number;
};
type AuditEntry = { sequence: number; requestId: string; state: State; reason: string; at: string };
type DashboardRequest = RequestRecord & { payloadOmitted?: boolean };
type AuditDetail = AuditEntry & Record<string, unknown>;
type PageResult<T> = { data: T; nextCursor: string | null };
type Snapshot = {
  requests: DashboardRequest[];
  policy: { revision: number; policy: Policy };
  budgets: Budget[];
  audit: AuditEntry[];
};
const terminalStates: State[] = ['COMPLETED', 'FAILED', 'DENIED', 'EXPIRED', 'CANCELLED'];
const allStates: State[] = [
  'SUBMITTED',
  'ALLOWED',
  'DENIED',
  'PENDING_APPROVAL',
  'APPROVED',
  'EXECUTING',
  'COMPLETED',
  'FAILED',
  'EXPIRED',
  'CANCELLED',
];

function readPreference<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : (JSON.parse(value) as T);
  } catch {
    return fallback;
  }
}
function savePreference(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Private browsing may disable storage. */
  }
}
function date(value?: string) {
  if (!value) return 'Not set';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}
function money(value: number, currency: string) {
  try {
    const formatter = new Intl.NumberFormat(undefined, { style: 'currency', currency });
    const fractionDigits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
    return formatter.format(value / 10 ** fractionDigits);
  } catch {
    return `${currency} ${(value / 100).toFixed(2)}`;
  }
}
function mergeBy<T>(current: T[], incoming: T[], key: (item: T) => string) {
  const seen = new Set(incoming.map(key));
  return [...incoming, ...current.filter((item) => !seen.has(key(item)))];
}
function statusClass(state: string) {
  return `status status-${state.toLowerCase().replaceAll('_', '-')}`;
}
function actionLabel(request: RequestRecord) {
  const { action } = request;
  if (action.category === 'filesystem')
    return `${action.operation === 'write' ? 'Write' : 'Read'} file`;
  if (action.category === 'shell') return 'Run command';
  if (action.category === 'http') return 'HTTP request';
  return 'Launch subagent';
}
function exactOperation(request: RequestRecord) {
  const { action } = request;
  if ('payloadOmitted' in request && request.payloadOmitted) {
    if (action.category === 'filesystem')
      return `${action.operation.toUpperCase()} ${action.resourceScope}`;
    if (action.category === 'http')
      return `${action.operation.toUpperCase()} ${action.resourceScope}`;
    return `${action.category} action in ${action.resourceScope}`;
  }
  const p = action.parameters;
  if (action.category === 'filesystem')
    return `${action.operation.toUpperCase()} ${p.path ?? '(path missing)'}`;
  if (action.category === 'shell')
    return [p.executable ?? '(executable missing)', ...(p.args ?? [])].join(' ');
  if (action.category === 'http') return `${p.method ?? 'GET'} ${p.url ?? '(URL missing)'}`;
  return `Launch ${p.childAgentId ?? '(agent missing)'} with ${p.runner ?? '(runner missing)'}`;
}

function App() {
  const [token, setToken] = useState(() => sessionStorage.getItem('aag-human-token') ?? '');
  const [tokenInput, setTokenInput] = useState('');
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingRequests, setLoadingRequests] = useState(false);
  const [loadingAudit, setLoadingAudit] = useState(false);
  const [requestCursor, setRequestCursor] = useState<string | null>(null);
  const [auditCursor, setAuditCursor] = useState<string | null>(null);
  const requestHistoryInitialized = useRef(false);
  const auditHistoryInitialized = useRef(false);
  const [requestDetails, setRequestDetails] = useState<Record<string, RequestRecord>>({});
  const [requestDetailErrors, setRequestDetailErrors] = useState<Record<string, string>>({});
  const [auditDetails, setAuditDetails] = useState<Record<number, AuditDetail>>({});
  const [auditDetailErrors, setAuditDetailErrors] = useState<Record<number, string>>({});
  const [snapshot, setSnapshot] = useState<Snapshot>({
    requests: [],
    policy: { revision: 0, policy: {} as Policy },
    budgets: [],
    audit: [],
  });
  const [filter, setFilter] = useState(() => readPreference('aag-request-filter', 'all'));
  const [search, setSearch] = useState(() => readPreference('aag-search', ''));
  const [auditSearch, setAuditSearch] = useState(() => readPreference('aag-audit-search', ''));
  const [theme, setTheme] = useState(() => readPreference<'light' | 'dark'>('aag-theme', 'light'));
  const [setupGuideOpen, setSetupGuideOpen] = useState(
    () =>
      readPreference<'unseen' | 'skipped' | 'completed'>('aag-setup-state', 'unseen') === 'unseen',
  );
  const [confirm, setConfirm] = useState<{
    request: RequestRecord;
    kind: 'approve' | 'deny';
  } | null>(null);
  const [busyId, setBusyId] = useState('');
  const confirmDialogRef = useRef<HTMLDialogElement>(null);
  const confirmBackRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    savePreference('aag-theme', theme);
  }, [theme]);
  useEffect(() => savePreference('aag-request-filter', filter), [filter]);
  useEffect(() => savePreference('aag-search', search), [search]);
  useEffect(() => savePreference('aag-audit-search', auditSearch), [auditSearch]);

  useEffect(() => {
    const dialog = confirmDialogRef.current;
    if (!confirm) {
      restoreFocusRef.current?.focus();
      restoreFocusRef.current = null;
      return;
    }
    if (dialog && !dialog.open) dialog.showModal();
    confirmBackRef.current?.focus();
    const trapTab = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !dialog) return;
      const controls = [
        ...dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((control) => control.getAttribute('aria-hidden') !== 'true');
      if (controls.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = controls[0]!;
      const last = controls[controls.length - 1]!;
      if (
        event.shiftKey &&
        (document.activeElement === first || !dialog.contains(document.activeElement))
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || !dialog.contains(document.activeElement))
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    dialog?.addEventListener('keydown', trapTab);
    return () => {
      dialog?.removeEventListener('keydown', trapTab);
      if (dialog?.open) dialog.close();
    };
  }, [confirm]);

  const apiRequest = useCallback(
    async <T,>(path: string, options: RequestInit = {}, authToken = token): Promise<T> => {
      const headers = new Headers(options.headers);
      headers.set('Authorization', `Bearer ${authToken}`);
      if (options.method && options.method !== 'GET') {
        headers.set('X-AAG-Intent', 'human');
        headers.set('Content-Type', 'application/json');
      }
      const response = await fetch(path, { ...options, headers, credentials: 'same-origin' });
      if (!response.ok) {
        let detail = `${response.status} ${response.statusText}`;
        try {
          const body = (await response.json()) as { error?: string; message?: string };
          detail = body.error ?? body.message ?? detail;
        } catch {
          /* Keep status text. */
        }
        throw new Error(detail);
      }
      return (await response.json()) as T;
    },
    [token],
  );
  const api = apiRequest;

  const apiPage = useCallback(
    async <T,>(path: string, authToken = token): Promise<PageResult<T>> => {
      const headers = new Headers({ Authorization: `Bearer ${authToken}` });
      const response = await fetch(path, { headers, credentials: 'same-origin' });
      if (!response.ok) {
        let detail = `${response.status} ${response.statusText}`;
        try {
          const body = (await response.json()) as { error?: string; message?: string };
          detail = body.error ?? body.message ?? detail;
        } catch {
          /* Keep status text. */
        }
        throw new Error(detail);
      }
      return {
        data: (await response.json()) as T,
        nextCursor: response.headers.get('X-AAG-Next-Cursor'),
      };
    },
    [token],
  );

  const refresh = useCallback(
    async (authToken = token) => {
      const [active, requests, policy, budgets, audit] = await Promise.all([
        apiPage<DashboardRequest[]>('/v1/requests?scope=active&view=summary&limit=100', authToken),
        apiPage<DashboardRequest[]>('/v1/requests?view=summary&limit=100', authToken),
        api<{ revision: number; policy: Policy }>('/v1/policy', {}, authToken),
        api<Budget[]>('/v1/budgets', {}, authToken),
        apiPage<AuditEntry[]>('/v1/audit?view=summary&limit=100', authToken),
      ]);
      setSnapshot((current) => ({
        requests: mergeBy(
          current.requests,
          mergeBy(active.data, requests.data, (item) => item.action.id),
          (item) => item.action.id,
        ),
        policy,
        budgets,
        audit: mergeBy(current.audit, audit.data, (entry) => String(entry.sequence)),
      }));
      if (!requestHistoryInitialized.current) {
        requestHistoryInitialized.current = true;
        setRequestCursor(requests.nextCursor);
      }
      if (!auditHistoryInitialized.current) {
        auditHistoryInitialized.current = true;
        setAuditCursor(audit.nextCursor);
      }
      setConnected(true);
      setError('');
    },
    [api, apiPage, token],
  );

  const loadOlderRequests = async () => {
    if (!requestCursor || loadingRequests) return;
    setLoadingRequests(true);
    try {
      const page = await apiPage<DashboardRequest[]>(
        `/v1/requests?view=summary&limit=100&before=${encodeURIComponent(requestCursor)}`,
      );
      setSnapshot((current) => ({
        ...current,
        requests: mergeBy(current.requests, page.data, (item) => item.action.id),
      }));
      setRequestCursor(page.nextCursor);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load older actions.');
    } finally {
      setLoadingRequests(false);
    }
  };

  const loadOlderAudit = async () => {
    if (!auditCursor || loadingAudit) return;
    setLoadingAudit(true);
    try {
      const page = await apiPage<AuditEntry[]>(
        `/v1/audit?view=summary&limit=100&before=${encodeURIComponent(auditCursor)}`,
      );
      setSnapshot((current) => ({
        ...current,
        audit: mergeBy(current.audit, page.data, (entry) => String(entry.sequence)),
      }));
      setAuditCursor(page.nextCursor);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load older audit entries.');
    } finally {
      setLoadingAudit(false);
    }
  };

  const loadRequestDetails = async (id: string, fresh = false) => {
    if (!fresh && requestDetails[id]) return requestDetails[id];
    try {
      const detail = await apiRequest<RequestRecord>(`/v1/requests/${encodeURIComponent(id)}`);
      setRequestDetails((current) => ({ ...current, [id]: detail }));
      setRequestDetailErrors((current) => {
        const { [id]: _removed, ...remaining } = current;
        return remaining;
      });
      return detail;
    } catch (cause) {
      setRequestDetailErrors((current) => ({
        ...current,
        [id]: cause instanceof Error ? cause.message : 'Could not load request details.',
      }));
      throw cause;
    }
  };

  const loadAuditDetails = async (sequence: number) => {
    if (auditDetails[sequence]) return;
    try {
      const detail = await apiRequest<AuditDetail>(`/v1/audit/${sequence}`);
      setAuditDetails((current) => ({ ...current, [sequence]: detail }));
      setAuditDetailErrors((current) => {
        const { [sequence]: _removed, ...remaining } = current;
        return remaining;
      });
    } catch (cause) {
      setAuditDetailErrors((current) => ({
        ...current,
        [sequence]: cause instanceof Error ? cause.message : 'Could not load audit details.',
      }));
      throw cause;
    }
  };

  useEffect(() => {
    if (!token) return;
    let active = true;
    const run = async () => {
      try {
        await refresh();
      } catch (cause) {
        if (!active) return;
        setConnected(false);
        const message =
          cause instanceof Error ? cause.message : 'Could not connect to the gateway.';
        setError(message);
        if (/401|403|unauthor/i.test(message)) {
          sessionStorage.removeItem('aag-human-token');
          setToken('');
        }
      }
    };
    void run();
    const timer = window.setInterval(() => void run(), 1000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [token, refresh]);

  const connect = async (event: FormEvent) => {
    event.preventDefault();
    const candidate = tokenInput.trim();
    if (!candidate) {
      setError('Enter the human token to connect.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await refresh(candidate);
      sessionStorage.setItem('aag-human-token', candidate);
      setToken(candidate);
      setTokenInput('');
      savePreference('aag-setup-state', 'completed');
      setSetupGuideOpen(false);
    } catch (cause) {
      setConnected(false);
      const message = cause instanceof Error ? cause.message : 'Connection failed.';
      setError(
        /401|403|unauthor|authorization required/i.test(message)
          ? 'That token was not accepted. Check the human.token file in the gateway’s private data directory and try again.'
          : `Could not connect to the gateway. Check that it is running at this address, then try again. (${message})`,
      );
    } finally {
      setLoading(false);
    }
  };

  const disconnect = () => {
    sessionStorage.removeItem('aag-human-token');
    setToken('');
    setTokenInput('');
    setConnected(false);
    requestHistoryInitialized.current = false;
    auditHistoryInitialized.current = false;
    setRequestCursor(null);
    setAuditCursor(null);
    setRequestDetails({});
    setRequestDetailErrors({});
    setAuditDetails({});
    setAuditDetailErrors({});
    setSnapshot({
      requests: [],
      policy: { revision: 0, policy: {} as Policy },
      budgets: [],
      audit: [],
    });
  };

  const act = async (request: RequestRecord, kind: 'approve' | 'deny' | 'cancel') => {
    setBusyId(request.action.id);
    setError('');
    try {
      const path = `/v1/requests/${encodeURIComponent(request.action.id)}/${kind}`;
      await api(path, {
        method: 'POST',
        body: JSON.stringify(kind === 'approve' ? { token: request.approvalToken } : {}),
      });
      setConfirm(null);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Could not ${kind} request.`);
    } finally {
      setBusyId('');
    }
  };

  const openConfirmation = async (
    request: RequestRecord,
    kind: 'approve' | 'deny',
    trigger: HTMLElement,
  ) => {
    setBusyId(request.action.id);
    setError('');
    try {
      const freshRequest = await loadRequestDetails(request.action.id, true);
      if (freshRequest.state !== 'PENDING_APPROVAL') {
        throw new Error(
          'This request is no longer waiting for approval. The dashboard will refresh shortly.',
        );
      }
      restoreFocusRef.current = trigger;
      setConfirm({ request: freshRequest, kind });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not load the latest request details.',
      );
    } finally {
      setBusyId('');
    }
  };

  const visibleRequests = useMemo(
    () =>
      snapshot.requests.filter((record) => {
        const matchesState = filter === 'all' || record.state === filter;
        const haystack = [
          record.action.id,
          record.action.agentId,
          record.action.sessionId,
          record.action.category,
          record.action.operation,
          record.reason,
          record.action.resourceScope,
          JSON.stringify(
            requestDetails[record.action.id]?.action.parameters ?? record.action.parameters,
          ),
        ]
          .join(' ')
          .toLowerCase();
        return matchesState && haystack.includes(search.toLowerCase());
      }),
    [snapshot.requests, requestDetails, filter, search],
  );
  const pending = snapshot.requests.filter((item) => item.state === 'PENDING_APPROVAL');
  const activeSessions = new Map<string, RequestRecord[]>();
  snapshot.requests
    .filter((item) => !terminalStates.includes(item.state))
    .forEach((item) => {
      const items = activeSessions.get(item.action.sessionId) ?? [];
      items.push(item);
      activeSessions.set(item.action.sessionId, items);
    });
  const auditRows = snapshot.audit.filter((entry) =>
    `${entry.sequence} ${entry.requestId} ${entry.state} ${entry.reason} ${entry.at}`
      .toLowerCase()
      .includes(auditSearch.toLowerCase()),
  );

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top">
          <span className="brand-mark" aria-hidden="true">
            A
          </span>
          <span>
            <strong>Agent Approval Gate</strong>
          </span>
        </a>
        <div className="top-actions">
          <span
            className={`connection ${connected ? 'is-connected' : ''}`}
            role="status"
            aria-live="polite"
          >
            <i aria-hidden="true" />
            {connected ? 'Gateway connected' : 'Gateway disconnected'}
          </span>
          <button
            className="button button-quiet setup-toggle"
            type="button"
            aria-expanded={setupGuideOpen}
            onClick={() => setSetupGuideOpen((open) => !open)}
          >
            {setupGuideOpen ? 'Close setup guide' : 'Setup guide'}
          </button>
          <button
            className="icon-button"
            type="button"
            onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
            aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
            title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
          >
            {theme === 'light' ? '◐' : '☼'}
          </button>
          {connected && (
            <button className="button button-quiet" type="button" onClick={disconnect}>
              Disconnect
            </button>
          )}
        </div>
      </header>

      <a className="skip-link" href="#top">
        Skip to main content
      </a>

      {!connected && (
        <main className="connect-wrap" id="top" tabIndex={-1}>
          <div className="connect-card">
            {setupGuideOpen && (
              <section
                className="setup-guide"
                aria-label="First-time setup"
                aria-describedby="setup-description"
              >
                <div className="setup-guide-heading">
                  <h2>Before you connect</h2>
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => {
                      savePreference('aag-setup-state', 'skipped');
                      setSetupGuideOpen(false);
                    }}
                  >
                    Skip setup
                  </button>
                </div>
                <p id="setup-description">
                  The gateway runs on this Mac. These steps use its real data; no sample actions are
                  sent.
                </p>
                <ol>
                  <li>
                    Run <code>aag serve</code> in a trusted terminal (or{' '}
                    <code>node dist/cli.js serve</code> from the source checkout).
                  </li>
                  <li>
                    Read <code>human.token</code> from the private data directory (by default{' '}
                    <code>~/.local/share/agent-approval-gate</code>).
                  </li>
                  <li>Paste the token below. It stays in this browser tab’s session.</li>
                </ol>
              </section>
            )}
            <form onSubmit={connect} aria-busy={loading}>
              <h1>Connect to gateway</h1>
              <p>
                Enter the human token created by <code>aag serve</code>. It stays in this browser
                session.
              </p>
              <label htmlFor="human-token">Human token</label>
              <input
                id="human-token"
                name="human-token"
                type="password"
                autoComplete="current-password"
                spellCheck={false}
                value={tokenInput}
                onChange={(event) => setTokenInput(event.target.value)}
              />
              {error && (
                <div role="alert" className="alert alert-error">
                  {error}
                </div>
              )}
              <button className="button button-primary full-width" type="submit" disabled={loading}>
                {loading ? 'Connecting…' : 'Connect'}
              </button>
            </form>
          </div>
        </main>
      )}

      {connected && (
        <main id="top" className="content" tabIndex={-1}>
          {setupGuideOpen && (
            <section
              className="setup-guide connected-setup"
              aria-label="First-time setup"
              aria-describedby="setup-description"
            >
              <div className="setup-guide-heading">
                <h2>You’re connected</h2>
                <button
                  className="text-button"
                  type="button"
                  onClick={() => setSetupGuideOpen(false)}
                >
                  Close setup guide
                </button>
              </div>
              <p id="setup-description">
                This overview is reading the live gateway. Requests appear here as agents submit
                actions for policy checks and human review.
              </p>
            </section>
          )}
          <div className="page-heading">
            <div>
              <h1>Action overview</h1>
            </div>
            <span className="updated" role="status" aria-live="polite">
              Refreshes every second
            </span>
          </div>
          {error && (
            <div role="alert" className="alert alert-error inline-alert">
              {error}
              <button
                type="button"
                className="alert-dismiss"
                aria-label="Dismiss error"
                onClick={() => setError('')}
              >
                ×
              </button>
            </div>
          )}
          <section className="metrics" aria-label="Gateway summary">
            <article className="metric">
              <span>Awaiting approval</span>
              <strong>{pending.length}</strong>
              <small>Actions blocked until reviewed</small>
            </article>
            <article className="metric">
              <span>Active sessions</span>
              <strong>{activeSessions.size}</strong>
            </article>
            <article className="metric">
              <span>Policy revision</span>
              <strong>{snapshot.policy.revision || '—'}</strong>
              <small>
                {snapshot.policy.policy?.default
                  ? `Default ${snapshot.policy.policy.default}`
                  : 'No policy loaded'}
              </small>
            </article>
            <article className="metric">
              <span>Recent records</span>
              <strong>{snapshot.requests.length}</strong>
              <small>Persisted gateway actions</small>
            </article>
          </section>

          <section
            className="panel request-panel"
            aria-labelledby="queue-title"
            aria-busy={loading || Boolean(busyId)}
          >
            <div className="panel-heading">
              <div>
                <h2 id="queue-title">Action queue</h2>
              </div>
              <span className="count-pill">{pending.length} pending</span>
            </div>
            <div className="toolbar">
              <label className="search-field">
                <span className="sr-only">Search actions</span>
                <span aria-hidden="true">⌕</span>
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search actions, agents, sessions…"
                />
              </label>
              <label className="filter-field">
                <span className="sr-only">Filter by status</span>
                <select value={filter} onChange={(event) => setFilter(event.target.value)}>
                  <option value="all">All statuses</option>
                  {allStates.map((state) => (
                    <option key={state} value={state}>
                      {state.replaceAll('_', ' ')}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="request-list">
              {visibleRequests.length === 0 && (
                <div className="empty-state">
                  <span aria-hidden="true">✓</span>
                  <strong>
                    {snapshot.requests.length ? 'No matching actions' : 'No actions yet'}
                  </strong>
                  <p>
                    {snapshot.requests.length
                      ? 'Try another search or status.'
                      : 'Submitted actions will appear here.'}
                  </p>
                </div>
              )}
              {visibleRequests.map((request) => {
                const details = requestDetails[request.action.id];
                const shown = details ?? request;
                const payloadOmitted = !details && request.payloadOmitted;
                return (
                  <article
                    className={`request-card ${request.state === 'PENDING_APPROVAL' ? 'is-pending' : ''}`}
                    key={request.action.id}
                  >
                    <div className="request-main">
                      <div className="request-title-line">
                        <h3>{actionLabel(request)}</h3>
                        <span className={statusClass(request.state)}>
                          {request.state.replaceAll('_', ' ')}
                        </span>
                      </div>
                      <div className="request-command">{exactOperation(shown)}</div>
                      <p className="reason">
                        {request.reason || 'No reason supplied by policy engine.'}
                      </p>
                      <div className="request-meta">
                        <span>
                          <b>Agent</b>
                          {request.action.agentId}
                        </span>
                        <span>
                          <b>Session</b>
                          {request.action.sessionId}
                        </span>
                        <span>
                          <b>Request</b>
                          <code>{request.action.id}</code>
                        </span>
                        <span>
                          <b>Submitted</b>
                          {date(request.createdAt)}
                        </span>
                      </div>
                      <details
                        className="details"
                        onToggle={(event) => {
                          const open = event.currentTarget.open;
                          if (open) {
                            void loadRequestDetails(request.action.id).catch((cause) =>
                              setError(
                                cause instanceof Error
                                  ? cause.message
                                  : 'Could not load request details.',
                              ),
                            );
                          } else {
                            setRequestDetails((current) => {
                              const { [request.action.id]: _removed, ...remaining } = current;
                              return remaining;
                            });
                          }
                        }}
                      >
                        <summary>Full parameters and scope</summary>
                        <div className="details-grid">
                          <div>
                            <h4>Parameters</h4>
                            {payloadOmitted ? (
                              requestDetailErrors[request.action.id] ? (
                                <p role="alert">
                                  Could not load details: {requestDetailErrors[request.action.id]}
                                </p>
                              ) : (
                                <p role="status">Loading private action details…</p>
                              )
                            ) : (
                              <pre>{JSON.stringify(shown.action.parameters, null, 2)}</pre>
                            )}
                          </div>
                          <div>
                            <h4>Resource scope</h4>
                            <p className="scope-text">{shown.action.resourceScope}</p>
                            <h4>Requested permissions</h4>
                            <p>{shown.action.requestedPermissions.join(', ') || 'None declared'}</p>
                            <h4>Expected result</h4>
                            <p>{shown.action.expectedResultFormat}</p>
                            {shown.action.maxCost && (
                              <>
                                <h4>Declared maximum cost</h4>
                                <p>
                                  {money(
                                    shown.action.maxCost.amount,
                                    shown.action.maxCost.currency,
                                  )}
                                </p>
                              </>
                            )}
                          </div>
                        </div>
                      </details>
                      {request.state === 'PENDING_APPROVAL' && (
                        <div className="expiry">
                          <span aria-hidden="true">◷</span> Approval expires{' '}
                          {date(request.expiresAt)}
                        </div>
                      )}
                      {(request.state === 'COMPLETED' || request.state === 'FAILED') &&
                        (shown.result !== undefined || payloadOmitted) && (
                          <details
                            className="details result-details"
                            onToggle={(event) => {
                              if (event.currentTarget.open) {
                                void loadRequestDetails(request.action.id).catch((cause) =>
                                  setError(
                                    cause instanceof Error
                                      ? cause.message
                                      : 'Could not load execution result.',
                                  ),
                                );
                              }
                            }}
                          >
                            <summary>Execution result</summary>
                            {shown.result === undefined ? (
                              <p role="status">Loading execution result…</p>
                            ) : (
                              <pre>
                                {typeof shown.result === 'string'
                                  ? shown.result
                                  : JSON.stringify(shown.result, null, 2)}
                              </pre>
                            )}
                          </details>
                        )}
                    </div>
                    <div className="request-actions">
                      {request.state === 'PENDING_APPROVAL' && (
                        <>
                          <button
                            className="button button-primary"
                            type="button"
                            disabled={busyId === request.action.id}
                            onClick={(event) =>
                              void openConfirmation(request, 'approve', event.currentTarget)
                            }
                          >
                            {busyId === request.action.id ? 'Loading…' : 'Approve'}
                          </button>
                          <button
                            className="button button-danger-outline"
                            type="button"
                            disabled={busyId === request.action.id}
                            onClick={(event) =>
                              void openConfirmation(request, 'deny', event.currentTarget)
                            }
                          >
                            Reject
                          </button>
                        </>
                      )}
                      {['SUBMITTED', 'ALLOWED', 'APPROVED', 'EXECUTING'].includes(
                        request.state,
                      ) && (
                        <button
                          className="button button-quiet"
                          type="button"
                          disabled={busyId === request.action.id}
                          onClick={() => void act(request, 'cancel')}
                        >
                          {busyId === request.action.id ? 'Cancelling…' : 'Cancel'}
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
            <p className="muted history-note">
              Active and pending actions stay visible above the latest saved history. Load older
              actions to review earlier records.
            </p>
            {requestCursor && (
              <button
                className="button button-quiet load-more"
                type="button"
                disabled={loadingRequests}
                onClick={() => void loadOlderRequests()}
              >
                {loadingRequests ? 'Loading older actions…' : 'Load older actions'}
              </button>
            )}
          </section>

          <div className="lower-grid">
            <section className="panel" aria-labelledby="sessions-title">
              <div className="panel-heading">
                <div>
                  <h2 id="sessions-title">Active agent sessions</h2>
                </div>
                <span className="count-pill">{activeSessions.size}</span>
              </div>
              {activeSessions.size === 0 ? (
                <p className="muted empty-inline">No active sessions.</p>
              ) : (
                <div className="session-list">
                  {[...activeSessions.entries()].map(([sessionId, requests]) => (
                    <div className="session-row" key={sessionId}>
                      <span className="session-icon" aria-hidden="true">
                        ◉
                      </span>
                      <div>
                        <strong>{sessionId}</strong>
                        <small>
                          {[...new Set(requests.map((r) => r.action.agentId))].join(', ')} ·{' '}
                          {requests.length} active {requests.length === 1 ? 'action' : 'actions'}
                        </small>
                      </div>
                      <span
                        className={statusClass(
                          requests.some((r) => r.state === 'EXECUTING')
                            ? 'EXECUTING'
                            : (requests[0]?.state ?? 'SUBMITTED'),
                        )}
                      >
                        {requests.some((r) => r.state === 'EXECUTING')
                          ? 'EXECUTING'
                          : requests[0]?.state}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="panel" aria-labelledby="budgets-title">
              <div className="panel-heading">
                <div>
                  <h2 id="budgets-title">Session budgets</h2>
                </div>
                <span className="count-pill">{snapshot.budgets.length}</span>
              </div>
              {snapshot.budgets.length === 0 ? (
                <p className="muted empty-inline">No session budgets configured.</p>
              ) : (
                <div className="budget-list">
                  {snapshot.budgets.map((budget) => {
                    const spent = budget.reserved + budget.settled;
                    return (
                      <div className="budget-row" key={`${budget.sessionId}-${budget.currency}`}>
                        <div className="budget-top">
                          <strong>{budget.sessionId}</strong>
                          <span>{money(budget.remaining, budget.currency)} remaining</span>
                        </div>
                        <progress
                          className="progress"
                          aria-label={`Budget used for ${budget.sessionId}`}
                          value={Math.max(0, Math.min(budget.maximum, spent))}
                          max={Math.max(1, budget.maximum)}
                        />
                        <div className="budget-breakdown">
                          <span>
                            Maximum <b>{money(budget.maximum, budget.currency)}</b>
                          </span>
                          <span>
                            Reserved <b>{money(budget.reserved, budget.currency)}</b>
                          </span>
                          <span>
                            Settled <b>{money(budget.settled, budget.currency)}</b>
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>

          <section className="panel" aria-labelledby="policy-title">
            <div className="panel-heading">
              <div>
                <h2 id="policy-title">Policy</h2>
              </div>
              <span className="count-pill">Revision {snapshot.policy.revision}</span>
            </div>
            <div className="policy-summary">
              <span className="policy-default">
                Default decision <strong>{snapshot.policy.policy.default ?? 'Unknown'}</strong>
              </span>
              <span>
                Workspace <code>{snapshot.policy.policy.workspace ?? 'Not configured'}</code>
              </span>
              <span>{snapshot.policy.policy.rules?.length ?? 0} explicit rules</span>
            </div>
            <details className="details policy-json">
              <summary>View complete policy</summary>
              <pre>{JSON.stringify(snapshot.policy.policy, null, 2)}</pre>
            </details>
          </section>

          <section className="panel" aria-labelledby="history-title">
            <div className="panel-heading">
              <div>
                <h2 id="history-title">Audit history</h2>
              </div>
              <span className="count-pill">{snapshot.audit.length} entries</span>
            </div>
            <label className="search-field audit-search">
              <span className="sr-only">Search audit history</span>
              <span aria-hidden="true">⌕</span>
              <input
                value={auditSearch}
                onChange={(event) => setAuditSearch(event.target.value)}
                placeholder="Search request, state, or reason…"
              />
            </label>
            <div className="audit-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Seq.</th>
                    <th scope="col">Request</th>
                    <th scope="col">State</th>
                    <th scope="col">Reason</th>
                    <th scope="col">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {auditRows.length === 0 ? (
                    <tr>
                      <td className="table-empty" colSpan={5}>
                        No matching audit entries.
                      </td>
                    </tr>
                  ) : (
                    auditRows
                      .slice()
                      .reverse()
                      .map((entry) => (
                        <React.Fragment
                          key={`${entry.sequence}-${entry.requestId}-${entry.state}-${entry.at}`}
                        >
                          <tr>
                            <td>{entry.sequence}</td>
                            <td>
                              <code>{entry.requestId}</code>
                            </td>
                            <td>
                              <span className={statusClass(entry.state)}>
                                {entry.state.replaceAll('_', ' ')}
                              </span>
                            </td>
                            <td className="audit-reason">{entry.reason}</td>
                            <td>{date(entry.at)}</td>
                          </tr>
                          <tr className="audit-detail-row">
                            <td colSpan={5}>
                              <details
                                className="details audit-details"
                                onToggle={(event) => {
                                  if (event.currentTarget.open) {
                                    void loadAuditDetails(entry.sequence).catch((cause) =>
                                      setError(
                                        cause instanceof Error
                                          ? cause.message
                                          : 'Could not load audit details.',
                                      ),
                                    );
                                  }
                                }}
                              >
                                <summary>View full audit record</summary>
                                {auditDetails[entry.sequence] ? (
                                  <pre>{JSON.stringify(auditDetails[entry.sequence], null, 2)}</pre>
                                ) : auditDetailErrors[entry.sequence] ? (
                                  <p role="alert">
                                    Could not load audit details:{' '}
                                    {auditDetailErrors[entry.sequence]}
                                  </p>
                                ) : (
                                  <p role="status">Loading audit details…</p>
                                )}
                              </details>
                            </td>
                          </tr>
                        </React.Fragment>
                      ))
                  )}
                </tbody>
              </table>
            </div>
            {auditCursor && (
              <button
                className="button button-quiet load-more"
                type="button"
                disabled={loadingAudit}
                onClick={() => void loadOlderAudit()}
              >
                {loadingAudit ? 'Loading older audit entries…' : 'Load older audit entries'}
              </button>
            )}
          </section>

          <section className="panel" aria-labelledby="activity-title">
            <div className="panel-heading">
              <div>
                <h2 id="activity-title">Recent actions</h2>
              </div>
              <span className="count-pill">
                {snapshot.requests.filter((r) => terminalStates.includes(r.state)).length}
              </span>
            </div>
            <div className="activity-list">
              {snapshot.requests
                .filter((r) => terminalStates.includes(r.state))
                .slice(0, 12)
                .map((r) => (
                  <div className="activity-row" key={`activity-${r.action.id}`}>
                    <span className={`activity-dot dot-${r.state.toLowerCase()}`} />
                    <div>
                      <strong>
                        {actionLabel(r)} <span className="muted">· {r.action.agentId}</span>
                      </strong>
                      <small>
                        {exactOperation(r)} · {date(r.createdAt)}
                      </small>
                    </div>
                    <span className={statusClass(r.state)}>{r.state}</span>
                  </div>
                ))}
              {snapshot.requests.filter((r) => terminalStates.includes(r.state)).length === 0 && (
                <p className="muted empty-inline">
                  No completed, denied, expired, or failed actions yet.
                </p>
              )}
            </div>
          </section>
        </main>
      )}

      <footer className="footer">
        <span>Agent Approval Gate</span>
      </footer>
      {confirm && (
        <dialog
          ref={confirmDialogRef}
          className="confirm-modal"
          aria-labelledby="confirm-title"
          aria-describedby="confirm-description"
          onCancel={(event) => {
            event.preventDefault();
            setConfirm(null);
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) setConfirm(null);
          }}
        >
          <button
            className="modal-close"
            type="button"
            aria-label="Close confirmation"
            onClick={() => setConfirm(null)}
          >
            ×
          </button>
          <div className={`modal-symbol ${confirm.kind}`} aria-hidden="true">
            {confirm.kind === 'approve' ? '!' : '×'}
          </div>
          <div className="eyebrow">HUMAN DECISION</div>
          <h2 id="confirm-title">
            {confirm.kind === 'approve' ? 'Confirm approval' : 'Confirm rejection'}
          </h2>
          <p id="confirm-description">
            {confirm.kind === 'approve'
              ? 'This action will be allowed to execute with the exact parameters shown below.'
              : 'This action will be rejected and will not execute.'}
          </p>
          <div className="confirm-summary">
            <strong>{actionLabel(confirm.request)}</strong>
            <code>{exactOperation(confirm.request)}</code>
            <span>
              Request ID: <code>{confirm.request.action.id}</code>
            </span>
            <span>
              Agent {confirm.request.action.agentId} · Session {confirm.request.action.sessionId}
            </span>
            <span>Scope: {confirm.request.action.resourceScope}</span>
            <span>Expires {date(confirm.request.expiresAt)}</span>
            {confirm.request.action.maxCost && (
              <span>
                Declared maximum cost:{' '}
                {money(
                  confirm.request.action.maxCost.amount,
                  confirm.request.action.maxCost.currency,
                )}
              </span>
            )}
            <details className="confirm-parameters">
              <summary>Exact parameters</summary>
              <pre>{JSON.stringify(confirm.request.action.parameters, null, 2)}</pre>
            </details>
          </div>
          <div className="modal-actions">
            <button
              ref={confirmBackRef}
              className="button button-quiet"
              type="button"
              onClick={() => setConfirm(null)}
            >
              Go back
            </button>
            <button
              className={`button ${confirm.kind === 'approve' ? 'button-primary' : 'button-danger'}`}
              type="button"
              disabled={busyId === confirm.request.action.id}
              onClick={() => void act(confirm.request, confirm.kind)}
            >
              {busyId === confirm.request.action.id
                ? 'Submitting…'
                : confirm.kind === 'approve'
                  ? 'Confirm approval'
                  : 'Confirm rejection'}
            </button>
          </div>
        </dialog>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
