# October 28 final source and live retest

Author: Ethan. See `../evidence/rehearsal` and the current READINESS.md section. Final source passes 38 core and 58 offline browser tests. The partial-start cleanup handle is retained even when deleting private launch files fails; a real directory-permission failure reproduced the defect before repair and verifies retry after access is restored. The historical independent report predates these final repairs; this closure is parent source review and regression, not a new independent sign-off.

The separately authorized third live session passed on the revised signed app's bundled runtime in 18.253 seconds, including final disconnect/artifact cleanup. Native lifecycle checks remain separate from the browser-driven guided session. No additional live authorization remains. Policy rehearsal preserves human-only access and has no execution or approval path.

---

# Version 2.2.0 verification — October 27, 2026

Author: Ethan. Local source gates pass; release signing, notarization and public-download verification remain in progress. Historical releases below do not qualify changed bytes.

Qualified host: macOS 27.2 (26B123), arm64; Node24.22.1; Codex CLI0.164.0. Deployment target14.0 is not older-host qualification.

- Clean locked install/build, strict TypeScript and formatting passed. All35 core tests and57 offline browser tests passed. Core tests run serially because the actual1.0.1 helper includes parent-directory link counts that concurrent fixture creation changes; no assertions were removed.
- Native helper:1243 boundary checks including1200 deterministic structured mutations; no confirmed sanitizer defect. Fresh app lifecycle tests pass manual Stop/Restart, programmatic Command-Q and visible last-window close. Native CUA keyboard Quit also stopped the owned gateway and closed its port. An isolated exit1 fault verified warning, Keep Open and Quit Anyway.
- Real upgrade evidence uses actual1.0.1,2.0.0 and2.1.0 archives. The2.1 desktop profile retains policy and pending history and completes a useful approved write. Backup/restore, incompatible newer profiles, locked/corrupt/full storage and interrupted execution remain covered.
- Zod4.6.7 resolves GHSA-mrhx-c7xc-m3w5. Fresh audit reports zero vulnerabilities. All11 approved Community Semgrep scans ran,625 candidates contextually reviewed, no confirmed exploit; Elttam and Apiiro contain unsupported/parse-failing rules. Raw output stays local. No cross-file or Swift semantic-analysis claim.
- Live authorization is exhausted: two Luna High sessions through existing ChatGPT login, synthetic isolated workspaces. AG-19 passed in11.7s including returned result. The real Terminal-launched guided session completed handshake, human approval and exact22-byte write. Its early cleanup assertion failed because status became disconnected before cleanup finished; shutdown then completed and no test process remained. The final source adds Disconnecting until cleanup succeeds; four offline connection tests and UI checks verify that repair. No third live session was run. Guided evidence uses the production dashboard/backend in a browser with a desktop bootstrap and a temporary launcher adapter to fix the authorized model/auth context; WKWebView/native lifecycle are tested separately. Terminal UI inspection was unavailable through computer-use controls. Do not call this a single live test of every final packaged-app step.
- The30-second load check completed2276 polls at p95=4.3ms and rejected42 of50 burst submissions without unapproved writes. It is not a multiday soak.

Evidence is under evidence/connection. Same-user arbitrary process control, other Codex tools, and hostile-code containment remain outside the mediated gateway boundary. No Actions or global configuration changes. Ethan remains personal package/provenance author; Apple/upstream metadata is retained. Finder/Explorer author display is not independently verified.


## Review closure

Reviewed against main1871677 and the retained original acceptance behavior. Fixed fast-handshake ownership, root-exit descendant cleanup, controlling-terminal loss in the rejected detached implementation, bounded Terminal open, startup cleanup-handle retention, shutdown failure propagation, stale policy edits, lost UI errors, decimal duration rounding and narrow-button overflow. Auth review found no concrete bypass of human-only approval/policy controls or scoped agent identity. Credential plaintext stays in private temporary launch files and inherited environment, never argv or dashboard. Process matching combines PID, process group, start time and command; this is cleanup of owned sessions, not containment of hostile same-user daemons.
