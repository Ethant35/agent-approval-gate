# Tutorial

Author: Ethan. Source: `src/desktop.ts`, `web/main.tsx`.

## Sub-features

Isolated seeded file, exact preview, final confirmation, real completed write, rejection without effect, replay and workspace transition instructions.

## How to get to it (user POV)

Choose Try Tutorial. Review the baseline and exact proposed write. Choose Review approval, inspect the final dialog, then Confirm approval. Use a new tutorial for rejection.

## Driving it with Playwright and core tests

Run the desktop suites in SKILL.md. The review control must be inside the tested viewport. Approval must write `You approved this change.\n`; denial must preserve `This file has not been approved yet.\n`. Assert exact path/content in the dialog, real file bytes, result display and the actual Try Tutorial control name. Axe checks include the dialog.

## Gotchas

The tutorial is seeded by the app and is not proof of an external agent connection. A completion message alone is not proof of written bytes.
