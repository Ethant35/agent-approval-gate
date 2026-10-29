# 2.2.1 release contract

Author: Ethan. October 29, 2026. Status: candidate qualification; not published.

Scope is frozen: package the repairs merged in PR #10, with version and documentation updates. No new product features. The supported platform is macOS arm64. The deployment target is not a claim of testing every macOS version.

| Essential contract | Evidence already available | Remaining candidate check |
| --- | --- | --- |
| Install a package tied to accepted source | 2.2.0 signed and notarized distribution evidence | Record source commit, runtime hashes, package hashes, signature and notary results; qualify the unauthenticated public download |
| Understand the gateway-only boundary | Revised launcher and connection labels; independent Terra recheck | Inspect the same labels in the packaged native candidate |
| Inspect complete parameters and approve or deny | Native offline review and real file checks; browser geometry and focus regression | Exact candidate native long path, short-window bounds, safe initial focus, Escape/focus return, approval result and denial without writes |
| Choose a workspace and retain state | Actual native chooser regression retained revision 2 and pending history without creating normal app data | Repeat selection and persistence on the exact candidate; preserve normal user state |
| Edit and rehearse policy | Core preview invariants and native independent review | Candidate current/draft decisions, saved revision, blocked action and side-effect-free preview |
| Connect and disconnect an agent | 2.2.0 bounded real CLI/Terminal session with browser dashboard bootstrap; offline real MCP transport/revocation checks | One freshly authorized native integration check, maximum three minutes, existing ChatGPT login and GPT-6 Luna High; no global changes |
| Quit and recover cleanly | Native Stop/Restart, Command-Q and window-close tests; persisted history and recovery checks | Candidate native shutdown and closed listener; installed package compatibility checks |

## Change impact and evidence boundaries

Compared with v2.2.0, PR #10 changes approval layout/focus, connection labels, native policy wording, isolated native root selection, and audit grammar. No source under src/ or native/safe-fs.c changed. The agent credential, MCP handshake, session launcher, request execution, policy engine, persistence and disconnect implementation are unchanged. Prior core security, recovery, sanitizer, static-analysis and live execution evidence remains applicable to those unchanged paths, subject to the package checks below.

The remaining live check closes the native integration gap. It is not a repeat of a backend test and does not imply that unmediated Codex actions are controlled. Offline API requests, browser-assisted real agent evidence, programmatic native tests and native manual checks must be recorded separately.

Ethan authorized one new live session capped at three minutes in this chat. It remains unused until the native path can run within the background-operation constraint. Focus-dependent checks are blocked while they would interrupt the user. Do not replace them with browser screenshots or claim they passed.

## Acceptance and publication order

1. Build from a recorded clean source commit with the qualified Node 24.22.1 archive and locked dependencies. Record source and runtime hashes.
2. Run applicable local checks and installed-package checks. Reuse unchanged evidence; repair demonstrated blockers only.
3. Complete exact-candidate native acceptance and the authorized live check. Keep failed, blocked and partial checks visible.
4. Sign and notarize the accepted app; package and notarize its DMG. Verify the signed package and downloaded draft assets without removing quarantine or bypassing Gatekeeper.
5. Publish only after essential acceptance passes. Download without authentication and verify the public bytes and installed behavior. Save final evidence and limitations; clean only owned scratch state.

GitHub Actions stays disabled. There is no usage guard. Normal app data, global Codex configuration, unrelated duplicate files and existing release tags are preserved. The existing production goal is complete only when the essential checks above pass.
