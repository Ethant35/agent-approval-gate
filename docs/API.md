# JSON API v1 and generic adapter

Author: Ethan

Base URL: `http://127.0.0.1:3741/v1`. All API calls require `Authorization: Bearer TOKEN`. Mutations require `Content-Type: application/json` and `X-AAG-Intent: human` or `agent`. The header is CSRF protection, not an authority claim: the bearer credential controls access. Browsers must use the exact same origin. There is no CORS wildcard.

| Method | Path | Credential / body |
| --- | --- | --- |
| POST | `/requests` | Agent or human; full immutable action below |
| GET | `/requests` | Own principal's records, or all records for human |
| GET | `/requests/:id` | Same visibility |
| POST | `/requests/:id/approve` | Human; `{ "token": "one-time token from human GET" }` |
| POST | `/requests/:id/deny` | Human; `{}` |
| POST | `/requests/:id/cancel` | Owner or human; `{}` |
| POST | `/requests/:id/settle` | Human; `{ "amount": 25, "evidence": "invoice reference" }` |
| GET | `/policy` | Human; returns `{revision, policy}` |
| POST | `/policy/preview` | Human; draft `yaml`, required `expectedRevision`, and 1–20 combined `requestIds` / full sample `actions`. Read-only rehearsal. |
| POST | `/policy` | Human; `{ "yaml": "version: 1\n...", "expectedRevision": 1 }`; revision is optional for existing callers |
| GET | `/budgets` | Human; maximum/reserved/settled/remaining per session/currency |
| GET | `/audit/:sequence` | Human; complete audit detail |
| GET | `/health` | Human; availability, preparations, executions, uptime |
| GET | `/audit` | Human; ordered transitions, policy decisions, results and settlements |
| POST | `/agents` | Human; `{ "agentId": "reviewer", "sessionIds": ["demo"] }`; returns scoped credential once |
| POST | `/agents/:id/revoke` | Human; `{}`; revokes an issued credential and cancels its active requests |

`201` means a request was recorded, not that execution was approved. Inspect `state`. Invalid operations return `400` with `{error}`, missing credentials `401`, and origin/CSRF violations `403`. The operator UI reads the same persistent records as these endpoints.

```json
{
  "id": "request-001",
  "agentId": "agent",
  "sessionId": "demo",
  "category": "filesystem",
  "operation": "read",
  "parameters": {"path": "/absolute/workspace/example.txt"},
  "resourceScope": "/absolute/workspace/example.txt",
  "timestamp": "2026-10-22T19:00:00.000Z",
  "requestedPermissions": ["filesystem:read"],
  "expectedResultFormat": "json"
}
```

Add `maxCost: {currency: "USD", amount: 25}` for a declared 25-cent maximum. Supported pairs and parameters:

| Category | Operation | Parameters | Scope |
| --- | --- | --- | --- |
| filesystem | read | `path` | Exact absolute file path |
| filesystem | write | `path`, `content` (UTF-8) | Exact absolute file path |
| shell | run | `executable`, `args` array | Policy workspace |
| http | request | `url`, `method` GET/POST, optional `body` | Canonical URL origin |
| subagent | launch | `executable`, `args`, `runner`, `childAgentId` | Policy workspace |

A JSON result is `{content}` for reads, `{bytesWritten}` for writes, `{stdout, stderr, exitCode, signal}` for successful processes, and `{status, body}` for HTTP. Subagent process results also include child agent ID, parent session, runner, workspace, maximum duration, and declared budget. Nonzero subprocess exits fail with captured diagnostics rather than reporting COMPLETED. HTTP status codes are returned as results, including non-2xx; a transport/policy failure or redirect yields FAILED. `expectedResultFormat: "text"` selects the content/stdout/body string, or a serialized write acknowledgement. API envelopes remain JSON.

Request records contain `action`, `state`, `reason`, `createdAt`, `expiresAt`, `policyVersion`, and eventual `result`. Only a human-authenticated pending record contains `approvalToken`. There is no update endpoint. To change parameters, submit a new ID and obtain a new decision. Do not reuse completed tokens or infer approval from a model response.

## Generic local subagent adapter

Allowlist the exact runner command in policy. Submit `category: subagent`, `operation: launch`, runner/child identity, workspace scope, and declared maximum cost. Wait for approval, then inspect the returned result. The gateway itself launches the process, reserves spending, enforces the policy's global concurrency cap, captures its exit status, and terminates its process group on timeout or cancellation. A framework must not launch the runner independently before the gateway authorizes it.

This adapter supports local, cooperative runners under the same restricted process sandbox. No credentials or provider environment are inherited, no subprocess network is permitted, and no dependency on another Agent project exists. Use a separately mediated HTTP request for supported network operations.

## Native MCP

Start `node /absolute/package/dist/cli.js mcp` with `AAG_URL` and an agent `AAG_TOKEN`. It implements standard newline-delimited stdio MCP using the official TypeScript SDK. Tools: `aag_submit({action})`, `aag_inspect({id})`, `aag_cancel({id})`, `aag_wait({id,state?,timeoutMs?})`. Waiting is bounded to 60 seconds; terminal results return immediately. Tool failures set `isError`, and real records are returned as both text JSON and structured content.

The bootstrap `agent.token` represents agent ID `agent` and may select any configured session. For independent agents, issue a distinct `/agents` credential with an explicit agent ID and session list. Scoped tokens cannot inspect or cancel other principals' requests, spoof another agent/session, create credentials, or approve themselves. Revoke issued credentials through `/agents/:id/revoke`; create a new credential to rotate. Bootstrap token rotation still requires stopping the gateway, backing up state and replacing the bootstrap token files. Revocation does not undo completed effects.

## Guided desktop connection (version 2.2.0)

Normal workspace desktop sessions expose human-only `GET /desktop/connection`, `POST /desktop/connection/start` and `POST /desktop/connection/disconnect`; both POST bodies are `{}`. Generic servers and tutorial sessions do not enable this interface. Status is `idle`, `starting`, `connected`, `disconnecting`, `disconnected` or `error`, with optional agent/session IDs, timestamps and a safe error. No credential is returned. The managed MCP transport sends its initialized/heartbeat/ended events with its scoped credential. Human and bootstrap credentials cannot impersonate this managed connection.

The managed MCP submit tool fills the connection's agent/session identity. The generic MCP action schema remains unchanged. Terminal launch alone does not report connected. A missed handshake or heartbeat revokes the connection; reconnect with a new session. See [desktop operation](desktop-operation.md) for the mediated-actions-only boundary.

Policy saves with `expectedRevision` return `409` if the saved revision has changed. Clients must reload and review instead of overwriting newer changes. Omitting the field retains the existing API behavior.

## Version 2 list and failure contract

Both list endpoints return arrays with `limit` from 1 to 100 (default 100). Follow the `X-AAG-Next-Cursor` response header until absent. Requests are newest first, using `before=cursor`; full audit is chronological, using `after=cursor`. Full pages also have a roughly 1.25 MB budget, except one large record may occupy a page. Individual details remain complete. CLI exports follow every page and stream a single JSON array; an interrupted export is incomplete and exits nonzero. Use a temporary output file and rename it only after exit 0.

`view=summary` omits request parameters/results/approval capabilities and audit details, with reasons capped at 500 characters. Request summaries omit private fingerprints and cap timestamps at 64 characters while preserving UTC `Z`; only excess fractional-second precision is removed. Stored values and full details remain unchanged. Summary pages use the 100-row cap and bounded fields instead of the full-page byte budget, so all 100 admitted active requests fit on one page. Summary audit is newest first and uses `before=cursor`. `scope=active` is available on request lists; UI merges active and recent summaries so old pending approvals stay visible. Agents are filtered in SQL before pagination. A summary has `payloadOmitted: true`; fetch `/requests/:id` for complete data and a fresh human approval capability. Unknown query fields and invalid cursors are rejected. Concurrent new rows do not shift older cursors; exports are ordered traversals rather than transactional snapshots.

`429` means admission or execution capacity is busy; a rejected submission has not been persisted, and a busy approval remains pending. `503` means shutdown or storage recovery is required. Do not assume a transport timeout or `503` proves an action had no effect. Inspect the original ID after recovery, reconcile the external effect, then choose whether to resubmit. No client retries side-effecting operations automatically. The client response limit is 16 MiB to cover escaped output, while native execution data remains bounded to 1 MiB.

`GET /health` returns `{status, preparing, executing, uptimeSeconds}`; degraded state returns HTTP503. It contains no request IDs, tokens, parameters or URLs. Diagnostic stderr uses fixed event names and SQLite primary error codes only. Audit exports intentionally include action data, results and settlement evidence; keep them private.

## Policy rehearsal

`POST /policy/preview` compares the saved policy with a draft for up to 20 existing request IDs or complete sample actions. It requires the human credential and intent header. A stale revision returns 409. The response gives each current/draft policy decision and reason, plus timeout, expiry, concurrency and budget-configuration differences. No policy is saved, request inserted, approval issued, budget reserved, file snapshot taken, process spawned or network request sent.

A preview is not execution permission or an execution guarantee. File state, DNS, credentials, available budgets and runtime limits still apply when a real request is processed. Existing rules keep their normal first-match priority; hard scope checks still deny before a rule can allow. The endpoint does not expose approval capabilities or action payloads in its response.
