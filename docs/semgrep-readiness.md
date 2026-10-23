# Semgrep assessment

Author: Ethan. 2026-10-22. Local Community 1.182.1, run-all, metrics and version checks disabled. No source upload or Pro analysis.

Ethan approved the exact eleven packs/repositories: “Approve: run all findings (recommended)”. The approved `rulesets.json` was passed unchanged to the supplied runner. Detection, plan and approval were completed before the saved pause. Execution and merge completed on resumption.

The first run omitted backend source from scoped JavaScript/TypeScript packs because the runner expanded include globs against its working directory. Its outputs remain under `static_analysis_semgrep_1/prior-incomplete-coverage`. The corrected run used an empty working directory with absolute target/output/plan paths. Every one of the ten `src/*.ts` files and `web/main.tsx` appears in the scoped TypeScript coverage list; the JavaScript, Node and React packs also opened all ten source files. Native C was opened by p/c and the unscoped packs.

| Pack/repository | Files opened | Raw findings | Rule coverage |
| --- | ---: | ---: | --- |
| p/secrets | 77 | 0 | Complete |
| p/security-audit | 77 | 0 | Complete |
| trailofbits/semgrep-rules | 77 | 0 | Complete |
| 0xdea/semgrep-rules | 77 | 439 | Complete |
| elttam/semgrep-rules | 77 | 1 | Partial |
| apiiro/malicious-code-ruleset | 19 | 4 | Partial |
| p/c | 1 | 0 | Complete |
| p/javascript | 18 | 0 | Complete |
| p/nodejs | 18 | 0 | Complete |
| p/react | 18 | 0 | Complete |
| p/typescript | 13 | 0 | Complete |

Runner exit 0; eleven scans, zero failed, zero skipped, zero covered-nothing, zero oversized entries. The output-directory exclusion is `static_analysis_semgrep_1` (matched anywhere); max target size is 20,000,000 bytes. Normal Git/Semgrep ignores also apply, including generated build/dependencies and test-path exclusions. This is production-source coverage, not every repository byte.

Merged SARIF: 332 deduplicated candidates. Severity levels: {'warning': 332}. Rule counts after merge: {'raptor-bad-words': 276, 'raptor-signed-unsigned-conversion': 3, 'raptor-interesting-api-calls': 28, 'raptor-write-into-stack-buffer': 2, 'raptor-typos': 2, 'raptor-integer-truncation': 1, 'raptor-argv-envp-access': 13, 'raptor-integer-wraparound': 2, 'generic-one-liners': 4, 'exec': 1}. Raw per-pack counts overlap and must not be added to the merged total.

## Finding dispositions

No candidate in this scan is a confirmed exploitable vulnerability after contextual review. This statement is bounded by the rule and manual-review limits below, not a clean-security certificate.

- `raptor-bad-words`: lexical hits on security vocabulary in docs, token identifiers, tests/evidence, stylesheet identifiers, dependency metadata and implementation. Reviewed the locations and production usages; occurrences do not expose literal credentials or create an execution path. No suppression was added.
- `generic-one-liners`: CLI help is a fixed string; executor code constructs a Seatbelt profile with JSON-quoted validated paths; stop-active writes a fixed diagnostic with its collected numeric process IDs. The store summary projection is a fixed SQL expression with no input interpolation. None evaluates downloaded or agent-controlled JavaScript. The executor's remaining path-based sandbox limits are documented in SECURITY.md.
- Native `exec`: intentional `execv` with checked argc, absolute executable, compared directory fingerprint and descriptor-based cwd. Policy/executable allowlisting is enforced by the caller. It does not interpolate shell input.
- Native argv/envp, interesting-API, signed/unsigned, truncation, wraparound, stack-buffer and typo candidates: argc checks precede indexed access; byte/PID parsing checks overflow; size limits cap buffers; pread/snprint results are validated before indexing/casting; descriptor opens reject symlinks and invalid file types. Full per-family reasoning and native mutation evidence are in native-readiness.md. The prior bounded strcat candidate was replaced by checked memcpy before this scan and is absent now.

## Limits

Elttam has twelve Java rule parse errors and one join-mode rule pruned by the supplied runner. Apiiro has three parse errors in Dart, Java and JavaScript/TypeScript obfuscation rules. Those rules did not run; the JavaScript error affects a language in this project. Non-rule YAML pruning counts were 27 Trail of Bits, 2 0xdea, 14 Elttam and 0 Apiiro. No custom rule substitutions were made. `p/yaml` was unavailable (404) and was excluded from the approved plan. Pro was unavailable, so cross-file taint tracking is not claimed. Manual trust-boundary review and real adversarial tests supplement this partial rule coverage.

Raw JSON, SARIF, error IDs and the approved plan remain local in the ignored output directory. Disposable cloned rule repositories were removed after merging. The same approved eleven-pack plan was rerun after the final pagination and UTC timestamp repair. The increase from 288 to 332 merged candidates consists of 43 lexical vocabulary hits in the expanded evidence/documentation and one fixed SQL projection flagged as a generic long one-liner. All ten backend source files remain covered. Subsequent changes are documentation and evidence only.


## Desktop 2.1 recheck

The same approved eleven packs were rerun after the desktop token/lifetime changes, using the empty working directory. All11 scans succeeded; none failed, skipped, covered nothing or exceeded the size limit. There are503 merged warning candidates:447 lexical bad-words hits and56 other candidates. The56 nonlexical locations and rules match the prior reviewed source (native C operations, fixed CLI/help/SQL/sandbox strings). New lexical locations cover token/error vocabulary, Swift optionals and test diagnostics, UI text and documentation. They do not embed credentials or establish an untrusted execution edge. No candidate was confirmed exploitable. The separate desktop security report assesses the private pipe, WebKit and lifecycle boundaries.

The two partial packs and their15 rule parse errors remain; the same pruned rule/YAML limits above apply. The scoped TypeScript pack opened14 files including all11 backend source files and the dashboard. The Swift file received generic lexical scanning only; no Swift-specific security/taint coverage is claimed. Community has no cross-file analysis. Final documentation/evidence additions after the scan do not change runtime behavior. Raw scans remain local; disposable cloned rules were removed after merge.
