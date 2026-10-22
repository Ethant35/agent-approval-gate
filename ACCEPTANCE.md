# Local release acceptance

Author: Ethan

Status: **NOT RELEASED; final clean-install and full-suite checks pending.**
Repository: https://github.com/Ethant35/agent-approval-gate

Platform observed: macOS 27.2 (26B118), arm64, Node.js 22.13.1, native Codex CLI 0.163.0, Google Chrome, real macOS Seatbelt. V1 support is limited to this platform family. No Linux or Windows acceptance is claimed.

GitHub Actions are intentionally omitted and disabled per Ethan. The original CI gate is replaced by applicable local build, E2E, browser, installation, security, and dependency checks. No CI pass is claimed.

Implemented `tests/gateway.spec.ts` covers AG-01 through AG-22 plus adversarial scenarios. Partial runs have passed each required scenario, including actual Codex submission, real browser approval, real filesystem execution, and result return. Final combined acceptance must still pass. Initial failures and repairs are recorded in HANDOFF.md. No executor mock is used.

Reproduce:

```sh
npm ci
npm run check
npm run build
npm run format:check
npm run test:e2e
npm audit --audit-level=high
```

AG-19 uses an existing authenticated native Codex session with GPT-6 Luna High; no API key is supplied. It permits only the gateway MCP interface at the host tool-approval layer and still requires human-credential browser approval inside the gateway. This validates mediated integration, not interception of unrelated native Codex tools.

Evidence and final AG matrix will be recorded here only after the combined run and clean installation succeed.
