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
| POST | `/policy` | Human; `{ "yaml": "version: 1\n..." }` |
| GET | `/budgets` | Human; maximum/reserved/settled/remaining per session/currency |
| GET | `/audit` | Human; ordered transitions, policy decisions, results and settlements |
| POST | `/agents` | Human; `{ "agentId": "reviewer", "sessionIds": ["demo"] }`; returns scoped credential once |

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

The bootstrap `agent.token` represents agent ID `agent` and may select any configured session. For independent agents, issue a distinct `/agents` credential with an explicit agent ID and session list. Scoped tokens cannot inspect or cancel other principals' requests, spoof another agent/session, create credentials, or approve themselves. Rotate credentials by stopping the gateway, backing up state, and replacing bootstrap token files; scoped credential revocation is not exposed in v1, so use a fresh state directory or operator-managed database migration if one is compromised.
