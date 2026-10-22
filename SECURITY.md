# Security boundaries

Author: Ethan

Report vulnerabilities privately through the repository's GitHub security reporting facility if available. Otherwise contact the maintainer without posting secrets or an operational exploit against another user's system. Include platform, version, a minimal local reproduction, and expected versus observed behavior.

## Protected assets and trusted components

Protected assets include approved workspace files, blocked filesystem paths, network destinations, human approval credentials, policy revisions, declared budget balances, and the audit record. The operator, OS kernel, Node runtime, C compiler/helper, installed application files, policy, and allowlisted executable installation are trusted. The operator must control the state directory and executables. Do not place application code or credential storage inside an untrusted writable workspace.

Agent-controlled inputs include IDs, timestamps, category/operation, parameters, URL and body, path and content, executable/arguments, scope, requested permissions, declared cost, and result format. Strict schemas reject extra approval assertions. Agent timestamps are audit metadata; approval expiry uses server time. Requested permission strings are descriptive and cannot expand resource policy.

## Enforced mediated boundaries

- Filesystem traversal, symbolic-link components, non-regular files, and hardlinked targets are rejected. Policy paths are normalized before storage and comparison, including policies loaded from older databases. Parent directories are opened relative to retained descriptors. Identity snapshots bind approval to the original path chain and file metadata. Writes open without truncating, compare the snapshot, then write through the checked descriptor; creation uses `O_EXCL`. Filesystem read/write operations never invoke a shell.
- Process execution uses exact allowlisted executable/argument arrays, no gateway string interpolation, a sanitized environment, an OS sandbox, bounded output, duration limits, and process-group termination. Approval includes the executable metadata and workspace directory chain identity. A native launcher checks the directory chain again, sets cwd through the checked descriptor, then executes Seatbelt without shell interpolation. Seatbelt denies network and filesystem access outside the approved workspace and necessary runtime reads. Explicit normalized denied workspace paths are enforced by Seatbelt too.
- HTTP validates canonical origin, checks every DNS answer for local/private/special addresses, pins the chosen address, retains TLS hostname verification, rejects redirects, and limits bytes/time. Unknown network origins never reach the receiver. `allowPrivate` is an explicit operator exception, not a default.
- Human-only endpoints require the operator token. The private-state directory must use its native canonical path and remain disjoint from the canonical workspace; startup validates this before creating credentials. State-changing API requests require JSON and a custom intent header. Origin, Host, and cross-site Fetch Metadata checks prevent hostile web pages and DNS rebinding from treating localhost as trusted. Credentials are never accepted in query parameters. The fixed-asset dashboard uses a restrictive CSP and React text escaping.
- Approval consumption, budget reservations, state changes, and audit entries are transactional. Parameters are immutable; policy revision changes invalidate approval. No agent-facing adapter exposes approval or settlement.

## Limits that remain

This is not a sandbox for arbitrary agent behavior. Guarantees apply only to the supported mediated interfaces. Codex's built-in shell, filesystem, browser, and other tools do not automatically pass through this MCP server. Configure those separately. A prompt telling an agent to use the gateway is not a security boundary.

An agent or other program with unrestricted access under the same OS user can read operator tokens, change the database/application, or bypass the gateway entirely. Run untrusted agents under a separate OS account/container or equivalent host controls. Local bearer tokens do not defeat a compromised browser, malicious extension, compromised kernel, or operator account.

The filesystem helper resists replacement between approval and execution and uses checked descriptors during the operation. It cannot stop an independently privileged process from modifying the same inode concurrently, moving already-open directories, or modifying kernel mount state. Writes to an existing file are not crash-atomic; process termination or disk failure can leave a partial write. Keep backups for consequential edits. The audit database is not cryptographically tamper-proof against its owner.

The process launcher pins cwd, but Seatbelt path rules and absolute arguments remain path-based. Independently privileged renames during a running command, writable executable installations, mount changes, and inode reuse are outside the guarantee. The 1.0.1 tests verify replacements completed between submission and approval; they do not establish universal filesystem race immunity. See [the path-authorization audit](docs/path-authorization-audit.md) for reproduced 1.0.0 defects and upgrade behavior.

Subprocess rules authorize **workspace-level effects**, not one-file effects. Runtime library/binary directories and filesystem metadata are readable so programs can start. Never store secrets there. Arbitrary programs may daemonize, escape process groups, or exploit OS services. v1 supports trusted, exact local command templates and cooperative local subprocess runners; it does not claim reliable lifecycle containment of hostile daemonizing programs. Network access through inherited sockets is prevented by passing only three new stdio pipes; OS-service abuse and kernel vulnerabilities remain outside these guarantees. No shell/subagent support is claimed on unverified platforms.

Seatbelt is an Apple platform facility whose behavior may change across OS releases. All four action categories are release-qualified only on the macOS arm64 environment recorded in ACCEPTANCE.md. The server rejects process actions if that supported facility is absent. Linux and Windows are not v1-supported execution platforms.

Spending enforcement uses **declared** maxima and operator-supplied authoritative settlements. It cannot enforce a provider invoice before the provider supplies usage, estimate missing prices, or prevent dishonest cost declarations. Unknown executed costs stay reserved; actual overages remain visible. Use provider-side quotas as a separate control.

Content and results are stored locally in plaintext SQLite and may contain secrets from approved files or commands. Protect backups and audit exports. No automatic telemetry or external error reporting is installed. Local development Playwright traces can contain test-only bearer tokens; never upload raw traces from production data. Committed acceptance evidence is sanitized, and synthetic native-agent output is scrubbed before attachment.
