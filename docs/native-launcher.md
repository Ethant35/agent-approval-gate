# macOS native launcher

The macOS arm64 app is a small AppKit host for the existing dashboard. Native controls choose the workspace, start the isolated tutorial, reopen the last workspace, restart the gateway, or stop it. Workspace selection and gateway startup are native actions. The webpage has no native command bridge and cannot select a path or start a session.

## Bundle and process contract

The app bundle includes these resources:

```text
Contents/Resources/runtime/bin/node
Contents/Resources/gateway/dist/desktop.js
Contents/Resources/gateway/package.json
Contents/Resources/gateway/node_modules/
```

The launcher runs the bundled Node executable directly. It passes the absolute app data root with `--root PATH` and then one of `--workspace CANONICAL_DIRECTORY` or `--tutorial`. The normal app data root is `~/Library/Application Support/Agent Approval Gate`. The self-test accepts an isolated root only through its paired `--self-test --test-root ABSOLUTE_PATH` options; the root must not already exist.

The gateway receives a private stdin pipe and a private stdout pipe. It writes one JSON line to stdout after it has acquired the workspace lease and started the loopback server. The readiness object contains `type`, `url`, `operatorToken`, `workspace`, `dataDir`, `mode`, `version`, and, for tutorial mode, `tutorialRequestId`. `backupDir` may also be present. The launcher validates the object, token shape, loopback URL, workspace identity, and that the state directory is under the app data root. The backend generates a fresh operator bearer in memory for each child session and sends it only in this readiness line. The launcher does not write the token or readiness object to logs, preferences, or files. Child stderr is captured in a bounded buffer for operator errors; bearer values and long hexadecimal secrets are redacted before display. The launcher never logs the raw stream. The backend's non-TTY check confirms the expected pipe transport shape; it does not authenticate the parent process.

The launcher keeps stdin open for the session. On stop, workspace switch, app quit, or unexpected child exit, it clears the WebKit session and closes stdin. The gateway treats EOF as a shutdown request, closes the server, and releases its lease. The launcher allows two seconds for that orderly stop, then sends TERM and, if needed, KILL to the exact child process it started. Child stderr is captured and redacted before an operator error is shown. The child environment is set explicitly and does not inherit Node option variables from the launching app. If the gateway exits unexpectedly after readiness, the native app clears the page session and token, shows a stopped message, and enables Restart Gateway.

## WebKit boundary

Each session uses a nonpersistent `WKWebsiteDataStore`. The launcher accepts a ready URL only when it uses plain HTTP, the literal host `127.0.0.1`, and a valid ephemeral port. It rejects credentials, query strings, fragments, and non-root URL paths.

A document-start user script runs only in the main frame. It checks the exact expected origin before placing the operator token in `sessionStorage` and publishing `window.__AAG_DESKTOP__` with the mode, workspace, version, and optional tutorial request ID. The token is never placed in a URL. The WebKit inspector is disabled. Native navigation policy blocks off-origin navigation, popup windows, and downloads. The gateway Content Security Policy also restricts scripts, styles, connections, frames, objects, and form targets to the local app origin.

The session data store is cleared when a session ends. The native process pipe remains the only route for gateway lifecycle control. There is no URL scheme handler and no `WKScriptMessageHandler`. The selected workspace is a boundary for operations sent through this gateway, not an operating-system sandbox. Only actions sent through this gateway are checked. Other processes running as the same macOS user have the normal access of that user and may be able to read private app credentials; this launcher does not claim to contain arbitrary same-user agents.

## Saved selection and tutorial

The launcher saves only the last selected workspace path in its app preferences. The gateway stores policy and history by workspace under the app data root. Reopening the last workspace starts a new local gateway session and presents the saved policy for that same canonical workspace.

Tutorial mode creates an isolated workspace below the app data root, creates a pending write approval, and shows it in the same dashboard. It does not use the selected project directory. The native self-test requires a new temporary container and keeps its window hidden. It creates sibling `appdata` and `workspace` directories inside that container and uses an isolated preferences suite, so it does not read or modify the user's saved workspace. It checks the normal native start screen and activates Try Tutorial. A controlled fault kills the first gateway just after readiness while startup is still in progress; the test confirms the dead child does not get a WebKit page and that the native stopped state can restart the tutorial. It then confirms the tutorial dashboard and injected context, confirms an unauthenticated policy request is denied, and approves the backend-seeded tutorial write using the dashboard’s Approve and Confirm approval buttons. It saves the temporary workspace path in the test-only preferences suite and activates Reopen Last Workspace. In that regular workspace session, it submits an operator-authored test write using the same authenticated request API available to a human operator, approves it through those dashboard buttons, and verifies the exact file content. It stops and restarts the workspace, confirms completed history remains, then kills the gateway child unexpectedly while the dashboard is active. The test verifies the old page no longer has its session token, the app shows an actionable stopped state with restart enabled, and Restart Gateway reconnects to the same workspace and history. It also checks that HTTPS and data URL navigation and popups stay blocked, then writes a PNG snapshot of the connected dashboard into the test container. It never reads `agent.token` or writes either token to the test output. On success it prints only `AAG_SELF_TEST_OK`.

## Build and test

Compile the launcher for macOS 14 or later on Apple silicon with:

```sh
xcrun --sdk macosx swiftc -parse-as-library \
  -target arm64-apple-macos14.0 \
  -warnings-as-errors \
  -framework AppKit -framework WebKit \
  native/main.swift -o .acceptance/native-launcher
```

The packaged self-test is run with a fresh, nonexistent test container:

```sh
".acceptance/native-launcher" --self-test --test-root "/tmp/aag-native-self-test-unique"
```

The test requires the bundled runtime and gateway files at the app’s resource paths. It exits nonzero if startup, dashboard rendering, origin-bound context, unauthenticated denial, either approved write, workspace-history recovery, or navigation restrictions fail. It creates all app data, workspaces, and the dashboard screenshot only inside the supplied isolated container. The screenshot is a local acceptance artifact and may include the temporary workspace path.

Signing, notarization, installer packaging, and release validation are handled by the packaging workflow. The source launcher build alone does not verify those release steps.
