# Native lifecycle

Author: Ethan. Source: `native/main.swift`.

## Sub-features

Bundled launch, Choose Workspace, Try Tutorial, Stop Gateway, Restart Gateway, application/edit menus, Command-Q and window close.

## How to get to it (user POV)

Open the app. Choose a workspace or tutorial. Stop and restart the gateway. Quit through the app menu or close the window.

## Driving it with the native harness

Run `tests/native/verify_desktop_lifecycle.sh` as documented in SKILL.md. Both fresh scenarios must print `AAG_SELF_TEST_OK`. Observe exact child PID exit, same selected workspace/data path after manual restart, cleared old page session and authenticated replacement page. Both termination routes must release the child and port.

## Gotchas

The app bundle must match the source. The window-close drive requires a visible window and relies on automatic AppKit termination. Menu key-equivalent dispatch is not a physical-key test. Never run against normal user app data. A missing menu is a product failure, not an unsupported shortcut.
