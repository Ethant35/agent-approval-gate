// Author: Ethan. Operator-only workspace controls.
import React, { useEffect, useRef, useState } from 'react';
import type { Policy, RequestRecord } from '../src/contracts.js';

type Preview = {
  revision: number;
  results: {
    id: string;
    resourceScope: string;
    current: { effect: string; reason: string };
    draft: { effect: string; reason: string };
  }[];
  limits: { current: Policy['limits']; draft: Policy['limits'] };
  budgetsChanged: boolean;
  notice: string;
};

type Api = <T>(path: string, options?: RequestInit) => Promise<T>;
type Connection = {
  status: 'idle' | 'starting' | 'connected' | 'disconnecting' | 'disconnected' | 'error';
  agentId?: string;
  sessionId?: string;
  connectedAt?: string;
  lastSeenAt?: string;
  error?: string;
};
const connectionLabels = {
  idle: 'Not connected',
  starting: 'Waiting for Codex',
  connected: 'Connected',
  disconnecting: 'Disconnecting',
  disconnected: 'Disconnected',
  error: 'Connection failed',
};

export function AgentConnection({ api, requests }: { api: Api; requests: RequestRecord[] }) {
  const [connection, setConnection] = useState<Connection>({ status: 'idle' });
  const [error, setError] = useState('');
  const [statusError, setStatusError] = useState('');
  const [busy, setBusy] = useState(false);
  const [known, setKnown] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const current = generation.current;
      try {
        const next = await api<Connection>('/v1/desktop/connection');
        if (active && current === generation.current) {
          setConnection(next);
          setKnown(true);
          setStatusError('');
        }
      } catch {
        if (active && current === generation.current) {
          setKnown(false);
          setStatusError('Connection status unavailable. Check the gateway, then try again.');
        }
      } finally {
        if (active) timer = setTimeout(poll, 1500);
      }
    };
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [api]);
  const change = async (action: 'start' | 'disconnect') => {
    generation.current++;
    setBusy(true);
    setError('');
    try {
      setConnection(
        await api<Connection>(`/v1/desktop/connection/${action}`, {
          method: 'POST',
          body: '{}',
        }),
      );
      setKnown(true);
      setStatusError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The connection could not be changed.');
    } finally {
      generation.current++;
      setBusy(false);
    }
  };
  const active = ['starting', 'connected'].includes(connection.status);
  const completed = requests.find(
    (r) =>
      r.action.agentId === connection.agentId &&
      r.action.sessionId === connection.sessionId &&
      r.state === 'COMPLETED',
  );
  return (
    <section className="panel agent-connection" aria-labelledby="agent-connection-title">
      <div className="panel-heading">
        <h2 id="agent-connection-title">Codex</h2>
        <span role="status">
          {known ? connectionLabels[connection.status] : 'Checking connection'}
        </span>
        <button
          type="button"
          className="button button-primary"
          disabled={busy || !known || connection.status === 'disconnecting'}
          onClick={() => void change(active ? 'disconnect' : 'start')}
        >
          {busy || connection.status === 'disconnecting'
            ? 'Please wait…'
            : active
              ? 'Disconnect Codex'
              : 'Start Codex'}
        </button>
      </div>
      <p>
        Only actions sent through Approval Gate are mediated. Other Codex tools are outside this
        boundary.
      </p>
      {connection.status === 'starting' && (
        <p>
          Finish any sign-in or trust prompt in Terminal. This page waits for the agent handshake.
        </p>
      )}
      {connection.status === 'connected' && (
        <p>
          {completed ? (
            <>
              Action completed. <a href={`#request-${completed.action.id}`}>View result</a>
            </>
          ) : (
            'Ask Codex to submit a file action through Approval Gate. Review the request here.'
          )}
        </p>
      )}
      {(error || statusError || connection.error) && (
        <p role="alert" className="field-error">
          {error || statusError || connection.error}
        </p>
      )}
    </section>
  );
}

export function PolicyControls({
  api,
  value,
  onSaved,
  requestIds,
}: {
  api: Api;
  value: { revision: number; policy: Policy };
  onSaved: () => Promise<void>;
  requestIds: string[];
}) {
  const [draft, setDraft] = useState<{ revision: number; policy: Policy } | null>(null);
  const [denyPaths, setDenyPaths] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [preview, setPreview] = useState<{ key: string; result: Preview } | null>(null);
  const [previewMode, setPreviewMode] = useState('sample');
  const [samplePath, setSamplePath] = useState('');
  const [sampleOperation, setSampleOperation] = useState('write');
  const editButton = useRef<HTMLButtonElement>(null);
  const firstField = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    if (draft) firstField.current?.focus();
  }, [Boolean(draft)]);
  const edit = () => {
    setDraft(structuredClone(value));
    setDenyPaths(value.policy.filesystem.deny.join('\n'));
    setError('');
    setSaved(false);
    setPreview(null);
    setSamplePath(value.policy.workspace + '/example.txt');
  };
  const close = () => {
    setDraft(null);
    editButton.current?.focus();
  };
  const changed = draft !== null && draft.revision !== value.revision;
  const draftPolicy = draft
    ? {
        ...draft.policy,
        filesystem: {
          ...draft.policy.filesystem,
          deny: denyPaths
            .split('\n')
            .map((p) => p.trim())
            .filter(Boolean),
        },
      }
    : null;
  const previewKey = JSON.stringify([
    draftPolicy,
    draft?.revision,
    previewMode,
    samplePath,
    sampleOperation,
  ]);
  const visiblePreview = !changed && preview?.key === previewKey ? preview.result : null;
  const rehearse = async () => {
    if (!draft || changed || busy) return;
    setBusy(true);
    setError('');
    setPreview(null);
    try {
      const result = await api<Preview>('/v1/policy/preview', {
        method: 'POST',
        body: JSON.stringify({
          yaml: JSON.stringify(draftPolicy),
          expectedRevision: draft.revision,
          ...(previewMode === 'recent'
            ? { requestIds: requestIds.slice(0, 20) }
            : {
                actions: [
                  {
                    id: 'sample-file',
                    agentId: 'sample-agent',
                    sessionId: 'sample-session',
                    category: 'filesystem',
                    operation: sampleOperation,
                    resourceScope: samplePath,
                    parameters: {
                      path: samplePath,
                      ...(sampleOperation === 'write' ? { content: 'Policy rehearsal only.' } : {}),
                    },
                    timestamp: new Date().toISOString(),
                    requestedPermissions: [`filesystem:${sampleOperation}`],
                    expectedResultFormat: 'text',
                  },
                ],
              }),
        }),
      });
      setPreview({ key: previewKey, result });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Policy rehearsal failed.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="policy-controls">
      <button
        ref={editButton}
        type="button"
        className="button button-quiet"
        onClick={edit}
        disabled={busy}
        aria-expanded={Boolean(draft)}
      >
        {draft ? 'Reload current policy' : 'Edit basic policy'}
      </button>
      {saved && <p role="status">Policy saved. Previous approvals require resubmission.</p>}
      {draft && (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (changed || busy) return;
            setBusy(true);
            setError('');
            try {
              await api('/v1/policy', {
                method: 'POST',
                body: JSON.stringify({
                  yaml: JSON.stringify(draftPolicy),
                  expectedRevision: draft.revision,
                }),
              });
              await onSaved();
              close();
              setSaved(true);
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : 'Policy could not be saved.');
            } finally {
              setBusy(false);
            }
          }}
        >
          <fieldset disabled={busy} className="policy-draft">
            <legend className="sr-only">Draft policy</legend>
            <div className="policy-fields">
              <label>
                Default decision
                <select
                  ref={firstField}
                  aria-label="Default decision"
                  value={draft.policy.default}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      policy: { ...draft.policy, default: event.target.value as Policy['default'] },
                    })
                  }
                >
                  <option value="approval">Require approval</option>
                  <option value="deny">Deny</option>
                  {draft.policy.default === 'allow' && (
                    <option value="allow">Allow (existing policy)</option>
                  )}
                </select>
              </label>
              <label>
                Approval expires after (seconds)
                <input
                  type="number"
                  required
                  min="0.1"
                  max="86400"
                  step="0.1"
                  value={draft.policy.limits.approvalTtlMs / 1000}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      policy: {
                        ...draft.policy,
                        limits: {
                          ...draft.policy.limits,
                          approvalTtlMs: Math.round(Number(event.target.value) * 1000),
                        },
                      },
                    })
                  }
                />
              </label>
              <label>
                Execution timeout (seconds)
                <input
                  type="number"
                  required
                  min="0.1"
                  max="300"
                  step="0.1"
                  value={draft.policy.limits.maxDurationMs / 1000}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      policy: {
                        ...draft.policy,
                        limits: {
                          ...draft.policy.limits,
                          maxDurationMs: Math.round(Number(event.target.value) * 1000),
                        },
                      },
                    })
                  }
                />
              </label>
              <label className="policy-paths">
                Blocked paths (one absolute path per line)
                <textarea
                  rows={3}
                  value={denyPaths}
                  onChange={(event) => setDenyPaths(event.target.value)}
                />
              </label>
            </div>
          </fieldset>
          <p>Explicit rules override the default. Use the API or CLI to edit advanced rules.</p>
          <p>Saving changes invalidates previous approvals.</p>
          <fieldset disabled={busy} className="policy-rehearsal">
            <legend>Rehearse policy</legend>
            <p>Preview decisions before saving. Nothing runs or receives approval.</p>
            <label>
              Requests to preview
              <select value={previewMode} onChange={(event) => setPreviewMode(event.target.value)}>
                <option value="sample">Sample file action</option>
                <option value="recent" disabled={requestIds.length === 0}>
                  Recent requests (up to 20)
                </option>
              </select>
            </label>
            {previewMode === 'sample' && (
              <div className="policy-fields">
                <label>
                  Sample operation
                  <select
                    value={sampleOperation}
                    onChange={(event) => setSampleOperation(event.target.value)}
                  >
                    <option value="write">Write file</option>
                    <option value="read">Read file</option>
                  </select>
                </label>
                <label>
                  Sample absolute path
                  <input
                    value={samplePath}
                    onChange={(event) => setSamplePath(event.target.value)}
                  />
                </label>
                <p>
                  Identity: sample-agent / sample-session. Use recent requests to check real agent
                  and session rules.
                </p>
              </div>
            )}
            <button
              type="button"
              className="button button-quiet"
              disabled={changed || (previewMode === 'recent' && requestIds.length === 0)}
              onClick={() => void rehearse()}
            >
              Preview decisions
            </button>
          </fieldset>
          {visiblePreview && (
            <section
              className="policy-preview"
              aria-label="Policy rehearsal results"
              aria-live="polite"
            >
              <p>{visiblePreview.notice}</p>
              <ul>
                {visiblePreview.results.map((result, index) => (
                  <li key={result.id + index}>
                    <strong>{result.id}</strong> <code>{result.resourceScope}</code>
                    <p>
                      Current: {result.current.effect} ({result.current.reason}). Draft:{' '}
                      {result.draft.effect} ({result.draft.reason}).
                    </p>
                  </li>
                ))}
              </ul>
              <p>
                Approval expiry: {visiblePreview.limits.current.approvalTtlMs / 1000}s →{' '}
                {visiblePreview.limits.draft.approvalTtlMs / 1000}s. Execution timeout:{' '}
                {visiblePreview.limits.current.maxDurationMs / 1000}s →{' '}
                {visiblePreview.limits.draft.maxDurationMs / 1000}s. Subagent concurrency:{' '}
                {visiblePreview.limits.current.subagentConcurrency} →{' '}
                {visiblePreview.limits.draft.subagentConcurrency}.
              </p>
              {visiblePreview.budgetsChanged && (
                <p>Budget configuration changes. Available balances are not simulated.</p>
              )}
            </section>
          )}
          {changed && (
            <p role="alert">Policy changed elsewhere. Reload the current policy before saving.</p>
          )}
          {error && (
            <p role="alert" className="field-error">
              {error}
            </p>
          )}
          <div className="policy-actions">
            <button className="button button-primary" type="submit" disabled={busy || changed}>
              Save policy
            </button>
            <button className="button button-quiet" type="button" disabled={busy} onClick={close}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
