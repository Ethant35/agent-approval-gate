# Agent Approval Gate

A local permission gateway for agent tools. It evaluates versioned policies, records requests in SQLite, and executes allowed or human-approved actions. The dashboard and CLI use the same authenticated API and database.

**Supported release platform: macOS arm64, Node.js 22.13 or later.** A C compiler is required when building from source. Process execution requires macOS Seatbelt (`sandbox-exec`); other platforms fail closed for shell and subagent actions and are not release-qualified. No cloud service is required for the gateway. The optional native Codex integration uses your existing Codex account.

[Acceptance evidence](ACCEPTANCE.md) · [Policy format](POLICY.md) · [Security boundaries](SECURITY.md) · [API and integrations](docs/API.md)

## Install and start

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

The data path must be canonical (no symlink components). Server startup prints its URL and state path, never credentials. Only one server may own a state directory. Stop with Ctrl+C; active process groups are killed, pending approvals persist. After an abrupt crash, verify the PID in `server.lock` is no longer running before removing that lock and restarting. Interrupted executions are marked FAILED and never automatically retried.

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

Use the versioned JSON API or the stdio MCP adapter. Provision an agent/session-scoped credential through the human-only `/v1/agents` API. The generic subagent adapter executes an exact allowlisted executable/argument array in the approved workspace under Seatbelt. It supports local subprocess runners independently of any other project. Subprocess networking is denied; cloud-provider SDK runners are not supported inside that adapter in v1.

## Verify locally

Install Google Chrome for browser tests. `npm run test:e2e` uses Playwright's Chrome channel. AG-19 additionally needs an authenticated native `codex` CLI with the tested model available. It performs a real native Codex tool call, real browser approval, real filesystem write, and result return. It does not use an executor mock.

```sh
npm ci
npm run build
npm run test:e2e
npm audit --audit-level=high
```

To diagnose offline/non-Codex behavior separately: `npm run test:e2e -- --grep-invert AG-19`. That partial run is **not** full release acceptance. See ACCEPTANCE.md for clean-install and release evidence. GitHub Actions are intentionally omitted and disabled for this repository at Ethan's request. All release checks run locally.

Author: Ethan. MIT license preserved.
