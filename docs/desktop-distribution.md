# Version 2.2.0 distribution checkpoint

Author: Ethan. Final source PR #9. App notarization `33622455-bddf-4fc2-bfe6-abfa32e0a0dc`; DMG notarization `3af25eb7-fbbd-478c-bd24-e39d63e51791`. Both Accepted; both tickets stapled and validated. Quarantined copied-app Gatekeeper/syspolicy and native lifecycle checks pass. Exact hashes are in `evidence/rehearsal/asset-hashes.json`. Download verification and release publication remain pending.

The supported qualification host is macOS 27.2 (26B123), arm64, with bundled Node 24.22.1. Preserve the sealed final candidate. Earlier IDs in the historical procedure below belong to 2.1.0.

---

# Desktop distribution procedure

Author: Ethan. The release target is macOS arm64. This release was tested on macOS 27.2 (26B118); the launcher deployment target is14.0, not a claim that older hosts passed qualification.

## Assemble and sign

Use the qualified Node 24.22.1 distribution and preserve its LICENSE. Run the normal production build, then `node scripts/build-desktop.mjs --node-root ABSOLUTE_NODE_ROOT --output NEW_LOCAL_DIRECTORY`. The script installs production dependencies without lifecycle scripts and compiles the AppKit host with warnings as errors. Use a local temporary staging folder outside file-provider-backed Documents. The initial Documents build acquired FinderInfo metadata and failed signing; a fresh staging copy without that generated metadata resolved the failure. No downloaded quarantine flag or Gatekeeper protection was removed.

Sign from inside outward: bundled Node, safe-fs helper, native main executable, then the app bundle. Use Developer ID Application: Ethan Tarnarider (Z2SL92S4B6), hardened runtime and timestamp. Only Node receives native/node-entitlements.plist, which grants allow-jit. The helper and app receive no additional entitlements. Do not preserve the official Node distribution's development/debug entitlements. Verify the complete app with codesign --verify --deep --strict.

Run the signed executable with `--self-test --test-root ABSOLUTE_NEW_TEMP_DIRECTORY`. The test keeps its window hidden and uses only isolated app data/preferences/workspace. Run the installed-runtime process/protected-file acceptance against the bundle too. Compare all 14 JS/web runtime files with a separate clean build and compare helper Mach-O sections independently of signatures.

## Notarize and package

Zip the app with ditto --keepParent, submit it with notarytool using the authorized ethan-notary Keychain profile, and require Accepted. Fetch the notary log, staple the app, validate the staple, and assess it with Gatekeeper. The app submission ID for this release is ed7b8806-22a0-4511-852b-75d7cf21f457; accepted evidence is under evidence/usability.

Create a compressed UDZO disk image containing the stapled app, an Applications symlink and a short Read Me. Sign the DMG, submit it separately, require Accepted, staple/validate it, then assess both image and copied app. The DMG submission a0743699-f687-46aa-bf1b-e291e955994e was Accepted. Local mounted/copy/quarantine assessment and hidden app self-test passed; the downloaded assets matched and the installed downloaded app passed its own quarantine-preserving assessment and native self-test. Never replace acceptance with notarization alone.

The app manifest/package/provenance use Ethan as personal author and preserve upstream licenses. CFBundle copyright is Ethan; signing certificate retains its factual legal identity. Finder does not expose a standard app author property, and Windows Explorer author display is not verified. Apple's notary JSON and codesign metadata are factual service/producer evidence; they are not rewritten as personal authorship.

## Release

Keep Actions disabled. Create a source PR with the qualified runtime, tests and evidence, attach it to the chat, and merge only after local gates pass. Create the release as a draft, upload the sealed DMG and archive/checksums, download the exact assets, compare hashes, mount/copy/quarantine-test the app without bypass flags, and run its hidden native self-test. Publish only after those downloaded assets pass. A final evidence-only commit may record the release identity without moving the tag or rebuilding sealed files.
