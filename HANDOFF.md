# Agent Approval Gate handoff

Author: Ethan

## Current status

Completed the bounded be-ambitious path-authorization audit and published **v1.0.1**. All 45 real E2E scenarios passed in a clean independent checkout, including 13 new path/upgrade scenarios and actual native Codex MCP/browser approval. No failures, skips or retries; 36.65 seconds. npm ci, strict checks, production/native build, formatting and dependency audit passed; zero vulnerabilities. Installed-package CLI startup, allowed/denied reads, human approval and a real native process side effect passed.

Repository: https://github.com/Ethant35/agent-approval-gate
Local path: /Users/ethantarnarider/Documents/ChatGPT/Open source/agent-approval-gate
Release: https://github.com/Ethant35/agent-approval-gate/releases/tag/v1.0.1
Merged implementation PR: https://github.com/Ethant35/agent-approval-gate/pull/3
Tested implementation: 023ff465d2548376c7e7cd27fa38f06d6d005233
Release commit: 8c202c8b3fabac6ccf75b1b739193f397300d400
This final handoff and remote-release evidence are metadata-only follow-up work; they do not move the release tag or alter the tested runtime.

## Findings and repair

The released 1.0.0 implementation failed six of seven new E2E checks: three equivalent deny spellings allowed protected reads, an equivalent allow spelling blocked a valid read, case-aliased state overlap started a gateway, and an approved shell wrote into a replacement directory. Symlink replacement already failed safely. Historical 1.0.0 acceptance remains evidence of its own tests, not a completeness claim.

Repairs normalize and persist policy paths, normalize older saved policies with revision invalidation, require native canonical private-state paths, validate overlap before token creation, bind process approval to directory-chain identity, and recheck/fchdir in a native launcher before executing Seatbelt. Positive controls require real permitted reads and processes to succeed. No new product features or API schema changes.

Upgrading may require resubmission after saved policy normalization. All 1.0.0 process approvals lack workspace identity and must be resubmitted. Unchanged filesystem approvals retain normal restart behavior. Primary-source research, the four-question method, executed rewrite, reproducible failures, and exact limits are in docs/path-authorization-audit.md. Full acceptance is in ACCEPTANCE.md and evidence/path-authorization/.

## Release verification and cleanup

Release is public, not draft or prerelease. Its annotated tag resolves locally/remotely to the release commit above. Downloaded archive and checksum were verified. SHA-256: 9324f13f9973a8f1d82259a834c34ac404e6682376bc849b314d43a98b04a4ab. All 11 packaged runtime files match both clean-tested and installed-tested builds; CLI bin is executable. No known failing checks or remaining release gates. The previous v1.0.0 tag and evidence remain unchanged.

Disposable .acceptance/ clones/installations/downloads and test-results/ were removed after saving sanitized evidence. All test gateway/native-agent processes are stopped. No production server remains running. The local ignored 1.0.1 archive remains available as well as the remote release assets.

Supported usage checker cell 73 was stopped during final cleanup. Last supported account reading: 34% used, 66% remaining. No credits, resets, or API-key bypass were used. No workers were spawned for this audit; both earlier completed workers were interrupted. The goal is marked complete after the final handoff is committed and checked.

## Constraints and limits

GitHub Actions remains disabled, with zero workflows/runs. Do not add or dispatch Actions. Do not edit ~/.codex/config.toml. All personal author fields checked in manifests, Git, documents and evidence use Ethan. Native transcripts retain truthful source records; Finder/Explorer display of author metadata was not independently verified. Original MIT license preserved.

Supported execution platform remains macOS arm64, locally macOS 27.2 / Node 22.13.1. Same-user credential theft outside mediation, unmediated Codex tools, privileged concurrent filesystem changes, path-based Seatbelt and absolute command arguments, hostile daemonizing commands, partial file writes on crash, operator-editable audit and declared-only spending remain limits. SECURITY.md documents them.

No implementation work remains. Before any future follow-up, inspect current main, this handoff, authoritative account usage and Actions permissions. Do not repeat native model tests just to read existing evidence.
