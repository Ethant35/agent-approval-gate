# Product

<!-- impeccable:product-schema 1 -->

Author: Ethan.

## Platform

web

The existing React operator dashboard also runs inside a native macOS launcher. The launcher uses standard AppKit controls; it does not replace the dashboard visual system.

## Users and purpose

An operator on macOS arm64 downloads the app, chooses a workspace, reviews exact agent actions, and approves or denies them. Success means a real first useful action and a clear return path without installing Node or hunting for a token file. These facts come from Ethan's explicit phase request.

## Operating context

The gateway mediates API/CLI/MCP actions only. Native tools outside it remain outside its boundary. Loopback transport, bearer authentication, human-only approval and Seatbelt execution restrictions remain required. Commands and network destinations begin disabled until allowlisted. A safe tutorial uses isolated real files and the same approval path.

## Capabilities and constraints

Preserve existing policies, audit and budget records, exact parameters, state distinctions, and source fidelity. Sign and notarize this artifact before claiming notarized distribution. Verify install, returning use, update, rollback and recovery. No GitHub Actions, global configuration changes, telemetry or recruited testing. Keyboard access and clear error/recovery states are required. No hero, welcome banner, marketing filler or decorative frontend redesign.

## Returning use

Ethan delegated the persistence choice with 'use best judgment'. Each selected workspace retains a separate policy and history, with the last workspace offered on return. This prevents accidental policy reuse across workspaces. No unrelated standing workflow preference is saved.

## Evidence

Version2.0.0 qualification is in READINESS.md and evidence/readiness. New launcher tests and notarization evidence are pending. No unfamiliar-user testing has occurred.
