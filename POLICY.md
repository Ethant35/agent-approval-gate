# Policy format v1

Author: Ethan

Policies are YAML documents with strict fields; unknown fields, invalid values, duplicate rule IDs, duplicate budgets, and invalid origins are rejected. Failed apply attempts leave the previous validated policy in force. An invalid startup policy prevents startup. Policy application is human-only and creates a persisted revision.

## Precedence

1. Validate action schema and category/operation pairing.
2. Apply non-overridable resource boundaries: workspace, filesystem allow/deny paths, exact executable and argument arrays, exact HTTP origin allow/deny lists, supported OS sandbox, and credential identity/session scope.
3. Select the **first matching rule** in YAML order. Specified agent, session, category, and operation conditions must all match. Omitted selectors match any value.
4. If no rule matches, use `default`: `allow`, `deny`, or `approval`.
5. Reserve budget and a subagent slot before authorizing execution. Evaluate the policy again immediately before execution. A policy revision change invalidates pending approvals; submit a new request.

Deny path/origin restrictions always win over allowlists and rules. Consequential actions require approval under the shipped default. An operator may explicitly choose `allow`; this is never an implicit fallback. No tool argument or prompt can set the gateway's approval state.

## Full example

```yaml
version: 1
default: approval
workspace: /absolute/workspace
filesystem:
  allow: [/absolute/workspace]
  deny: [/absolute/workspace/secrets]
commands:
  - executable: /usr/bin/printf
    args: ['hello\n']
network:
  allow: [https://example.com]
  deny: []
  allowPrivate: false
limits:
  maxDurationMs: 10000
  approvalTtlMs: 300000
  subagentConcurrency: 1
budgets:
  - sessionId: demo
    currency: USD
    maximum: 1000
rules:
  - id: reads
    category: filesystem
    operation: read
    effect: allow
  - id: specific-agent
    agentId: reviewer
    sessionId: demo
    category: shell
    operation: run
    effect: approval
```

Absolute paths cannot contain traversal. Filesystem allow/deny entries must lie within the canonical workspace. Reads and writes use the native helper: no symlink component, no non-regular file, no hardlinked target. Missing leaf files may be created exclusively, but parent directories must already exist. All directory/file identities captured at submission are checked at execution. On macOS, deny checks also account for case and Unicode normalization aliases. Writes are limited to allowlisted workspace paths.

A process action grants the exact executable/arguments **workspace-level** capability shown in `resourceScope`. It can read/write the workspace except denied paths, plus read runtime directories; it does not inherit individual filesystem-action approval. Scripts and subprocesses can have many effects inside that scope. Review exact command templates and avoid wildcard command launchers. Shell interpolation is never performed by the gateway; `/bin/sh -c ...` is possible only when an operator explicitly allowlists that entire exact argument array. The environment contains only controlled PATH, LANG, HOME, and TMPDIR values.

HTTP origins must be canonical `http://host[:port]` or `https://host[:port]`, without a trailing slash/path. No wildcard hosts. Authorization applies to the whole origin and the approved exact URL/method/body. All resolved addresses must be public unicast unless `allowPrivate: true` is explicitly configured. Private permission still requires the exact origin allowlist. DNS is pinned to the checked address for the connection; TLS hostname validation remains enabled. Redirects fail and require a new request. Request/response content is bounded to 1 MiB; no custom agent-supplied headers, proxies, cookies, or connection reuse.

## Spending

Amounts are nonnegative **integer currency minor units**, never floating point. For USD, 100 means $1.00; for JPY, 100 means ¥100. A declared positive `maxCost` requires a matching session/currency budget. SQLite `BEGIN IMMEDIATE` and a conditional UPDATE reserve funds before authorization; concurrent approvals cannot overdraw reservations. Zero or omitted cost is an agent declaration, not proof that a remote service is free. The gateway cannot infer provider prices or prevent an operator from trusting an incorrect declaration.

Executed actions retain their full reservation while actual usage is unknown, including failures and cancellations. A human can settle a finished action once using `/v1/requests/:id/settle` with an authoritative evidence reference. Unknown is never silently converted to zero. Pre-execution cancellations release reservations. An actual cost above the declared maximum is recorded honestly, may create a negative balance, and blocks further positive-cost authorizations. Never use inferred model pricing as an authoritative invoice.

The dashboard shows maximum, reserved, settled, and remaining amounts. Cost settlements and their evidence references are audited. Budget denial reasons appear on the request. Policy changes cannot reduce a maximum below already committed usage.

## Expiration and replay

Approval deadlines derive from server time at submission. Pending requests expire even if the browser disconnects. Each pending request has a random one-time approval token visible only to human-authenticated clients. Approval consumes it atomically with the state transition and reservation. Tokens are bound to immutable request IDs, exact parameters, original resource identity, and policy revision. No edit endpoint exists; changed parameters require a new ID and evaluation.
