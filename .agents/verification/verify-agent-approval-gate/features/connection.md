# Managed Codex connection

Author: Ethan. Source: `src/codex-session.ts`, `src/codex-session-launcher.ts`, `src/mcp.ts`, `src/server.ts`.

## Sub-features

Start Codex, invocation-only MCP settings, one scoped credential/session, initialized handshake, heartbeat status, request/result, disconnect/revoke, clean return.

## How to get to it (user POV)

In a selected workspace choose Start Codex. Complete any CLI sign-in/trust prompt in Terminal. Connected means the managed MCP client initialized; ask it to submit a file action, then review the request in the app. Disconnect revokes that session. Start again creates a fresh one.

## Driving it with the MCP/core and UI harnesses

Run `tests/core/connection.test.mjs` and the desktop UI suite. Prove no connected status merely from launch, then use the real stdio MCP transport to initialize and submit an action. Human approval must produce exact bytes and returned result. Agent attempts to approve/manage policy must fail. Disconnect must invalidate the token, cancel active work, clean launch files and stop only owned processes. A repeated start/disconnect race must not attach or leak an older session.

## Gotchas

No provider calls are authorized by this skill. The synthetic CLI and real MCP tests leave actual Codex sign-in, terminal interaction and model behavior unverified. Same-user arbitrary execution can access local state and is outside the mediated boundary. Do not claim that Codex's other tools are intercepted. Credentials never belong in argv, UI, logs or global configuration.
