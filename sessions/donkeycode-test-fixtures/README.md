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

With **base path** containing `donkeycode-test-fixtures`, DonkeyCode **creates** the alpha–epsilon folders (with correct GitHub subfolders) on pull if they are missing.

**Pull from GitHub** (and first-load sync) fetches **every** folder’s file in one go, then you switch **folder chips** to see each folder’s sessions only.

Each saved layout uses one window at a different screen position (and `example.com` with a query tag) so you can tell them apart after **Launch**.

## If everything still lands in one folder

- Confirm these JSON files exist on **GitHub** at the paths above (same **owner/repo/branch** as in Settings).
- **Base file path** must be exactly: `sessions/donkeycode-test-fixtures/donkeycode-sessions.json` (or your repo’s equivalent).
