# Architecture

Author: Ethan

The gateway is a single local Node.js process, bound only to `127.0.0.1`. Fastify serves a fixed list of React build assets and a versioned `/v1` API. There is no arbitrary filesystem static route. CLI and stdio MCP clients call that same API.

- `contracts.ts`: strict action and policy schemas and shared UI types.
- `policy.ts`: YAML validation, hard resource boundaries, first-match rules.
- `store.ts`: SQLite policies, requests, ordered audit, credential hashes, budgets, reservations.
- `server.ts`: authentication, origin/CSRF checks, bounded admission, approval lifecycle and dispatch.
- `lease.ts`: native pipe-owned flock and helper-loss shutdown.
- `maintenance.ts`: cold backup and restore with fresh destinations and integrity checks.
- `runtime.ts`: supported Node/platform checks.
- `executor.ts`: process groups, Seatbelt, descriptor helper, DNS-pinned HTTP.
- `native/safe-fs.c`: `openat` with `O_NOFOLLOW`, descriptor identity checks, exclusive creation, bounded reads/writes.
- `cli.ts`, `mcp.ts`: human/agent interfaces; MCP has no approval capability.
- `web/`: authenticated operator dashboard.
- `tests/`: core/property/real SQLite integration, native sanitizer mutations and real-process Playwright E2E, including native Codex.

## Lifecycle

```text
SUBMITTED -> DENIED
SUBMITTED -> ALLOWED -> EXECUTING -> COMPLETED | FAILED
SUBMITTED -> PENDING_APPROVAL -> APPROVED -> EXECUTING -> COMPLETED | FAILED
PENDING_APPROVAL -> DENIED | EXPIRED | CANCELLED
SUBMITTED | ALLOWED | APPROVED | EXECUTING -> CANCELLED
```

Dispatch can deny an authorized request if its policy changed. Startup marks interrupted non-pending work FAILED and never retries it. Pending approvals survive normal restart. Every transition and its audit entry are committed together. Audit details include the exact action, policy revision, and available result. A completion record is not a claim of verified monetary cost.

The process never waits for human approval with a database transaction open. Requests and deadlines persist before the operator sees them. The single-server lock prevents multiple schedulers for one state directory; database transactions also serialize budget changes. Each accepted action is dispatched once in that server lifetime. Crash recovery is at-most-once, not a promise of exactly-once external side effects: a crash after an external effect may leave an interrupted/unknown result.

## Trust and interfaces

The human credential and bootstrap agent credential are distinct 256-bit random secrets in mode-0600 files under a mode-0700 state directory. Scoped agent credentials are issued by a human and stored as SHA-256 hashes; their allowed agent ID and sessions are persistent. The bootstrap credential is for one trusted logical agent identity and permits choosing sessions; use scoped credentials when separating agents/sessions. Request ownership is bound to the credential principal, not a claimed prompt identity.

Approval tokens are separate random secrets tied to one request. The agent cannot retrieve them, mutate requests, issue credentials, settle costs, or administer policy. Credentials are local bearer capabilities, so confidentiality depends on OS account isolation and keeping operator state outside agent access.

No provider dependency is embedded. Other frameworks can submit HTTP JSON or use MCP. The subagent category adds child identity, parent session, runner label, workspace, duration, and declared budget to a real sandboxed subprocess result. It shares the command executor and global persisted active-slot count.

## Capacity and recovery

SQL-projected summaries omit parameters/results and approval capabilities. Integer cursor pages preserve request/principal filtering and complete CLI exports. Human-only detail routes retain full records. The dashboard merges active and recent summaries and retrieves details only when needed.

The server admits100 active records,8 preparations and8 executions. SQLite errors enter a fail-closed recovery state, emit fixed local diagnostics, and abort running controls. The private health route reports status and counts. Main-file capacity is1GiB; the WAL checkpoint/retention target is not a strict transient bound.

A helper holds the state inode with flock and releases it on pipe EOF. The inode remains on disk. Backup/restore use the same source lease and fresh private destinations. Interrupted work is not replayed. Empty or malformed lock markers require the documented manual offline recovery procedure; automatic deletion would weaken legacy ownership protection.
