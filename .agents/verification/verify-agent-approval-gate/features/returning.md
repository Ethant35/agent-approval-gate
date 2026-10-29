# Requests and returning use

Author: Ethan. Source: `src/server.ts`, `src/store.ts`, `src/desktop.ts`, `src/maintenance.ts`.

## Sub-features

Exact immutable requests, single-use approval, rejected actions, scoped ownership, history, crash recovery and old-profile upgrade.

## How to get to it (user POV)

Review pending requests and results. Stop/reopen the same workspace to recover its history. Switch workspaces without copying policy. Reconnect Codex with a new credential; old pending managed work must not execute.

## Driving it with core and gateway tests

Run the returning/upgrade and gateway tests listed in SKILL.md. Retain exact file, token replay, origin, role, cancellation and budget assertions. Use the actual prior release fixture for upgrade; compare saved data and a useful approved write after reopening.

## Gotchas

Do not replay interrupted execution automatically. AG-19 is the real model-driven path and needs separate authorization. Existing completed-release evidence is historical, not proof of a new build.
