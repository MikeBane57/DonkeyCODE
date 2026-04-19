# DonkeyCODE development workflow

## Git branches

Use only these long-lived branches:

- **`test`** — day-to-day integration; push here for CI and shared unstable builds.
- **`main`** — stable releases; merge from `test` when ready.

Do **not** use ad-hoc or automation-named branches (for example `cursor/...`) for ongoing work. Feature work should commit directly on `test` (or short-lived branches that merge back into `test` only).

## Extension logging

DonkeyCode extension diagnostics belong in the **extension** DevTools (service worker / popup), not in the **page** console on customer sites. Injected MAIN-world code should use the `DONKEYCODE_PAGE_LOG` bridge (see `bridge.js` + `PAGE_LOG` in `background.js`), not `console.*` in page context.
