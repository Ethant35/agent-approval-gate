# Property-test readiness

Author: Ethan

The generated tests exercise the built `Store` and policy modules directly. They do not mock those product paths. Fast-check produces repeatable inputs from fixed seeds and shrinks a failing generated case for diagnosis.

## Properties and skill application

| Area                 | Property                                                                                                                                                                                  | Generated inputs and oracle                                                                                                                                                     |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Budget lifecycle     | After each reserve, release, or settlement operation, stored maximum, reserved, settled, remaining, and every reservation row match an independent in-memory ledger.                      | 120 deterministic scripts, up to 35 operations each. Reservation amounts are 1–100; settlement amounts are 0–150 so the ledger also checks authoritative overages.              |
| Transaction rollback | If one in-budget reservation is followed by a reservation that exceeds the remaining budget in the same transaction, the earlier reservation and all budget changes roll back.            | 80 generated amount pairs where each amount fits alone but their sum exceeds 100. The test also confirms both request records, inserted before the transaction, remain present. |
| Policy normalization | Parsing filesystem allow/deny paths with redundant separators or `.` components yields canonical paths; parsing the result again is idempotent.                                           | 100 generated one-to-three-component paths using safe path-segment alphabets.                                                                                                   |
| Deny equivalence     | A target spelled with equivalent path separators or dot components is denied. On macOS, case and NFC/NFD spellings are generated too, matching the product's Darwin path comparison rule. | 120 generated paths across the supported variants, checked through the actual `evaluate` function.                                                                              |

The `property-based-testing` skill informed the bounded generators, explicit preconditions, pinned seeds, and checks against an independent model rather than a copy of `Store`'s arithmetic. I read its strategy-generation, failure-interpretation, review, and library references. No production refactor was needed to expose these properties.

## Run and result

```sh
node --test tests/core/properties.test.mjs
```

Verified on the current built output: all **4 tests pass**. Seeds are `0x5eedc0de`, `0x70ba11`, `0x4a7a11`, and `0xd3e1e`; run counts are fixed in the test file.
