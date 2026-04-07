# DonkeyCode — session sync test fixtures

Use these JSON files to verify **per-folder GitHub paths**: each folder should pull **only** its own file.

## One-time setup in DonkeyCode

1. Open **Settings** (gear) and set **Base file path in repo** to:
   `sessions/donkeycode-test-fixtures/donkeycode-sessions.json`
2. **Commit and push** this `sessions/donkeycode-test-fixtures/` directory to the same GitHub repo you configured (so the API can fetch the files).
3. In the popup, use **+ Folder** and create folders with **GitHub subfolder** (comma syntax), e.g.:
   - `alpha, alpha`
   - `beta, beta`
   - `gamma, gamma`
   - `delta, delta`
   - `epsilon, epsilon`
4. Leave **Default** for the base file (no subfolder).

## What to expect

| Folder   | GitHub file |
|----------|-------------|
| Default  | `sessions/donkeycode-test-fixtures/donkeycode-sessions.json` (**DC-Test-Default**) |
| alpha    | `sessions/donkeycode-test-fixtures/alpha/donkeycode-sessions.json` (**DC-Test-Alpha**) |
| beta     | `.../beta/donkeycode-sessions.json` (**DC-Test-Beta**) |
| gamma    | `.../gamma/...` (**DC-Test-Gamma**) |
| delta    | `.../delta/...` (**DC-Test-Delta**) |
| epsilon  | `.../epsilon/...` (**DC-Test-Epsilon**) |

Select a folder → **Pull from GitHub** → you should see **only** the sessions for that file. Each saved layout uses one window at a different screen position (and `example.com` with a query tag) so you can tell them apart after **Launch**.

## If everything lands in Default

Then every folder’s **GitHub subfolder** is empty or wrong, so they all resolve to the **same** path as Default. Re-check subfolders in full Settings (folder table) or recreate folders with the `name, subfolder` prompt.
