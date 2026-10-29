# Four Terra UX fixes — verified locally

Author: Ethan. October 29, 2026.

All four findings are addressed in source and the rebuilt native app. The changes are local and uncommitted; published 2.2.0 assets and public documentation have not been replaced.

| Finding | Change and verification |
| --- | --- |
| Dialog/path clipping | Fixed viewport position and bounded height; paths wrap in a block. Focus starts on Close so short dialogs start at the top. Actual WKWebView showed the full heading, close control and long path before and after scrolling. Escape restored Approve focus. Confirming produced the exact requested file. Browser regression passed at 760×616 and 760×320. |
| Policy claim | Launcher describes new-workspace defaults and says saved rules may allow or deny actions. Native editor saved a blocked path at revision 2; rehearsal showed current/draft deny while the corrected statement remained visible. No sample file was created. |
| Connection labels | Dashboard status names its gateway connection; each Codex state names Codex. Native labels and explanatory boundary text were inspected. Existing simulated state-transition tests passed. No live Codex session was started. |
| Stale guide | Desktop operation guide explicitly applies to 2.2.0 and links that release. Guide checked against the native workflows. Publishing the corrected document requires a later commit/push. |

Clean build, strict TypeScript and formatting passed. All 15 browser UI tests passed, including axe, focus, narrow layout and no-effect rehearsal. A final assertion-only geometry refinement passed its focused rerun. The final native lifecycle harness passed both Command-Q and window-close scenarios. Evidence: verification.json, native-result.json, native-lifecycle/, native-dialog.jpg and native-policy.jpg. The scrolled-dialog image was visually checked in tool output; its separate save failed.

CUA intermittently returned ScreenCaptureKit errors -3811/-3812 or incomplete accessibility trees. Reselecting the exact app restored access. No OS defect fix is claimed. The first build found missing root development dependencies; a clean tracked-file validation copy was then installed and built. An npm argument-parsing error briefly selected broader tests; it was stopped before the live test and the UI projects were run directly. No live model process was observed. The initial new regression caught focus scrolling; it passed after repair. No acceptance test was removed or skipped.

The manual app exited through Command-Q and port 54029 is closed. Both lifecycle scenarios exited. Disposable manual state remains private under /private/tmp/aag-ux-fixes-20261029-*; existing independent-review state was untouched. Final unsigned local app: .acceptance/ux-fixes-2026-10-29/native-final/Agent Approval Gate.app. Earlier app-build/native-fixed intermediates are superseded.

PNG Author and JPEG EXIF Artist metadata are Ethan; metadata bytes were read back. Finder indexing was not verified. No source publication, global settings or additional live-agent sessions occurred. Both usage stops were disabled on Ethan's instruction and the monitor was terminated. The broad production goal remains paused; this bounded repair request is complete.
