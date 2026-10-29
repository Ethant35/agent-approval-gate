# Agent Approval Gate

A local permission gateway for agent tools. It evaluates versioned policies, records requests in SQLite, and executes allowed or human-approved actions. The dashboard and CLI use the same authenticated API and database.

**Supported release platform: macOS arm64, Node.js 24.22.1 or newer in the Node 24 LTS line.** A C compiler is required when building from source. Process execution requires macOS Seatbelt (`sandbox-exec`); the server refuses to start on other platforms. No cloud service is required for the gateway. The optional native Codex integration uses your existing Codex account.

[Version 2 qualification](READINESS.md) · [Policy format](POLICY.md) · [Security boundaries](SECURITY.md) · [API and integrations](docs/API.md)

## macOS app

The macOS arm64 app bundles Node and the native helper. It does not need a global Node installation. See the qualification status in READINESS.md before distributing a development build.

Download the arm64 DMG from [Releases](https://github.com/Ethant35/agent-approval-gate/releases), open it, and drag **Agent Approval Gate** to **Applications**. Open the app and choose **Try Tutorial** to approve a real write in a fresh isolated folder. Choose **Choose Workspace** for your project. New workspaces require file approval; commands and network access start disabled. Saved rules may allow or deny actions. The app supplies its operator session without token-file copying.

Each workspace has its own policy and history. **Reopen Last Workspace** returns to the last selection. **Stop Gateway** stops that session; **Restart Gateway** starts it again after a stop or failure. Interrupted work is never retried automatically. Only actions sent through the gateway are checked; other tools and local processes require their own host controls.

In version 2.2, **Start Codex** opens a managed Codex CLI session in Terminal. The CLI must be installed and signed in separately. **Codex connected** confirms the MCP handshake; inspect the request and result to confirm an action. **Edit basic policy** changes default decisions, time limits and blocked paths while preserving advanced rules. **Rehearse policy** compares current and draft decisions without saving, approving or executing actions. See READINESS.md for verification evidence and release limits.

See [app operation and recovery](docs/desktop-operation.md) and [native security design](docs/native-launcher.md). The app's runtime and signing checks are separate from the earlier CLI release qualification.

## Source / CLI install and start

```sh
git clone https://github.com/Ethant35/agent-approval-gate.git
cd agent-approval-gate
npm ci
node dist/cli.js doctor
node dist/cli.js serve
```

`npm ci` builds the TypeScript, React dashboard, and descriptor-based filesystem helper. `npm link` optionally installs the `aag` command. Source builds need Xcode Command Line Tools (`cc`). No global configuration is changed by the application.

Open **http://127.0.0.1:3741**. In a trusted operator terminal, read `~/.local/share/agent-approval-gate/human.token` and paste it into the dashboard's **Human token** field. Keep that token out of agent prompts, workspaces, and environments. It is stored only in the browser tab's session storage; Disconnect clears it.

The default policy requires human approval for filesystem operations in the directory where you start the server. Commands and network requests are disabled until explicitly allowlisted. The database/credential directory must be outside the workspace. Use a dedicated project directory, not your home directory or filesystem root.

```sh
aag serve --data /absolute/private/state --port 3741 --policy /absolute/policy.yaml
```

The data path must be canonical (no symlink components). Server startup prints its URL and state path, never credentials. Only one server may own a state directory. Stop with Ctrl+C; active process groups are killed, pending approvals persist. After an abrupt crash, restart normally. The OS releases the held lock; never delete a live `server.lock` inode. An empty or malformed legacy marker requires the recovery checks in [backup and recovery](docs/backup-recovery.md). Interrupted executions are marked FAILED and never automatically retried.

## CLI

For agent calls, provide the **agent** credential through `AAG_TOKEN`. The bootstrap `agent.token` is bound to agent ID `agent`. Human CLI commands use `human.token` instead. `AAG_URL` defaults to `http://127.0.0.1:3741`. Credentials are never loaded implicitly by client commands.

```sh
aag policy validate policy.yaml
aag policy list
aag policy apply policy.yaml
aag submit --file action.json
aag requests
aag inspect request-001
aag approve request-001
aag deny request-001
aag cancel request-001
aag audit export > audit.json
aag doctor
```

Policy administration, approval, rejection, budget settlement, agent provisioning, and audit export require the human credential. Agents can submit, inspect their own requests, and cancel their own work. CLI approval uses the same one-time capability and authorization checks as the browser.

See [examples/action.json](examples/action.json) and [examples/policy.yaml](examples/policy.yaml). Replace paths and timestamp before submitting. The server rejects duplicate IDs and extra fields such as `approved: true`.

## Codex MCP integration

Start the gateway in a trusted operator process. In the separate agent environment, set `AAG_TOKEN` to the agent credential and `AAG_URL` to the gateway URL. Use invocation-level configuration to avoid changing your global Codex config:

```sh
codex exec --ignore-user-config --ignore-rules --ephemeral \
  --sandbox read-only \
  -c 'mcp_servers.aag.command="node"' \
  -c 'mcp_servers.aag.args=["/absolute/agent-approval-gate/dist/cli.js","mcp"]' \
  -c 'mcp_servers.aag.env_vars=["AAG_URL","AAG_TOKEN"]' \
  -c 'mcp_servers.aag.required=true' \
  -c 'mcp_servers.aag.default_tools_approval_mode="approve"' \
  'Use aag_submit for the requested action, then aag_wait for its result. A human reviews consequential actions in the gateway dashboard.'
```

The Codex setting permits calls to the gateway interface. It does **not** approve execution inside the gateway. The MCP server has only `aag_submit`, `aag_inspect`, `aag_wait`, and `aag_cancel`. It has no human approval or administration tool. `aag_wait` returns a terminal state, an optional requested target state, or the current record after a bounded timeout.

Codex's built-in tools are outside this gateway's scope. Prompts alone cannot force all native tools through MCP. Configure the host's own tool/sandbox policy and keep human credentials inaccessible to the agent. This product does not claim to sandbox an arbitrary native Codex session. See the [official MCP configuration documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

## Other agent frameworks

Use the versioned JSON API or the stdio MCP adapter. Provision an agent/session-scoped credential through the human-only `/v1/agents` API. The generic subagent adapter executes an exact allowlisted executable/argument array in the approved workspace under Seatbelt. It supports local subprocess runners independently of any other project. Subprocess networking is denied; cloud-provider SDK runners are not supported inside that adapter.

## Verify locally

Install Google Chrome for browser tests. `npm run test:e2e` uses Playwright's Chrome channel. AG-19 additionally needs an authenticated native `codex` CLI with the tested model available. It performs a real native Codex tool call, real browser approval, real filesystem write, and result return. It does not use an executor mock.

```sh
npm ci
npm run build
npm run check
npm run test:core
npm run test:native
npm run test:e2e
npm audit --audit-level=high
```

To diagnose offline/non-Codex behavior separately: `npm run test:e2e -- --grep-invert AG-19`. That partial run is **not** full release acceptance. See READINESS.md for current clean-install evidence and the historical-archive setup required by the core upgrade test. ACCEPTANCE.md retains earlier release evidence. GitHub Actions are intentionally omitted and disabled for this repository at Ethan's request. All release checks run locally.

## Upgrade, capacity and recovery

Version 2 requires the qualified Node 24 runtime. Stop the old gateway, make a cold backup with the new CLI, then start version 2 on the original data directory. Existing records and balances remain; old pending filesystem/process fingerprints may require explicit resubmission. Inspect any interrupted action and reconcile its external effects before retrying. See [the migration and support decision](docs/decisions/0001-production-target.md).

```sh
aag backup --data /absolute/private/state --out /absolute/private/new-backup
aag restore --from /absolute/private/new-backup --data /absolute/private/new-state
```

Backups include credentials. Restore only to a new directory and keep backups private. The gateway retains history until the operator archives/removes it; the main database has a 1 GiB cap. Full or unavailable storage stops new work and prints a fixed diagnostic event. Keep the original state, recover storage space, then restart. Never delete only a live SQLite WAL file. [Recovery instructions](docs/backup-recovery.md) describe partial outputs and rollback.

The gateway admits 100 active requests and at most 8 concurrent preparations and 8 executions. A `429` admission response has not accepted the new request; wait and retry its same ID. After any timeout or lost response, inspect that ID first. Lists use cursor pages; the dashboard loads history on demand, and CLI `requests` / `audit export` stream all pages. The human-only `/v1/health` endpoint reports availability and in-flight counts without payloads.

Author: Ethan. MIT license preserved.
