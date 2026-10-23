# Desktop UI contract

Author: Ethan.

The desktop launcher opens the existing React operator dashboard in a same-origin WebView. Before the page loads, it sets `sessionStorage['aag-human-token']` through its private child-process pipe and defines:

```ts
window.__AAG_DESKTOP__ = {
  mode: 'workspace' | 'tutorial',
  workspace: string,
  tutorialRequestId?: string,
  version: string,
};
```

The page uses the injected token for its ordinary loopback API calls. Mutating or omitting the bootstrap object does not authenticate a request; the server still checks the bearer token, same-origin request, and explicit human intent for writes. The dashboard does not read or request the private token file in desktop mode. If its session expires or the gateway stops, it shows a reconnect message that directs the operator to the native toolbar.

Workspace mode identifies the selected workspace and uses its existing policy, requests, audit records, and budgets. Tutorial mode receives the stable request ID `tutorial-write` for one real pending filesystem write in the isolated tutorial workspace. The dashboard loads that request's full details, displays the exact target and proposed text, and routes approval or denial through the existing confirmation flow. The tutorial's initial fixture text is labeled as such. After approval, the dashboard shows the gateway's completed state, submitted content, and execution result. It does not claim to read back arbitrary workspace files. A new tutorial run starts only from the desktop toolbar's **Try Tutorial** control; the page has no native bridge or replay endpoint.

Action previews preserve the request contract. Filesystem writes show the target path and proposed content. Command actions show the executable and `args` as a JSON array, not a reconstructed shell line. HTTP actions show the method, URL, and body. Missing private parameters remain omitted from summary rows until the operator opens the full details. Lifecycle labels remain visible as text, with additional border treatment for scanning.

`tests/ui-desktop.spec.ts` exercises this UI contract in browser automation against the desktop launcher backend. It simulates the native bootstrap values and WebView storage setup; it does not run AppKit, WKWebView, the actual child pipe, signing, or notarization. Those checks require separate native acceptance on macOS. Existing browser/manual-token coverage remains in `tests/ui-readiness.spec.ts`.
