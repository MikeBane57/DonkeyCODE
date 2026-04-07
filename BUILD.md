# Building DonkeyCode with a baked GitHub token (not in Git)

The extension loads **`DonkeyCode/baked-config.js`** from the service worker. That file is **generated locally** and listed in **`.gitignore`**, so your token is **not committed**.

## One-time: GitHub token

1. On GitHub: **Settings → Developer settings → Personal access tokens**.
2. Create a token with **`repo`** (classic) or **Contents: Read and write** on your repo (fine-grained).
3. Copy the token once — you will paste it only into a **local env file** or shell, not into the repo.

## Step-by-step (every machine that *builds* the extension)

These steps are for whoever produces the **unpacked folder** or **zip** that others load. End users who only receive a zip can skip the build if you give them a **pre-built** `DonkeyCode` folder that already contains `baked-config.js`.

### 1. Clone the repo

```bash
git clone https://github.com/MikeBane57/DonkeyCODE.git
cd DonkeyCODE
```

### 2. Set environment variables

Pick **one** approach.

**Option A — export in the shell (Linux / macOS / Git Bash)**

```bash
export DONKEYCODE_GITHUB_TOKEN="ghp_your_token_here"
export DONKEYCODE_GITHUB_OWNER="YourOrgOrUser"
export DONKEYCODE_GITHUB_REPO="YourRepo"
export DONKEYCODE_GITHUB_BRANCH="main"
export DONKEYCODE_GITHUB_PATH="sessions/donkeycode-sessions.json"
```

**Option B — `.env` file (do not commit)**

```bash
cp .env.example .env
# Edit .env and fill values
set -a && source .env && set +a   # bash
npm run build
```

On **Windows PowerShell**:

```powershell
$env:DONKEYCODE_GITHUB_TOKEN="ghp_..."
$env:DONKEYCODE_GITHUB_OWNER="YourOrgOrUser"
$env:DONKEYCODE_GITHUB_REPO="YourRepo"
npm run build
```

### 3. Generate `baked-config.js`

From the **repository root** (where `package.json` is):

```bash
npm run build
```

You should see: `DonkeyCode: wrote DonkeyCode/baked-config.js ...`

### 4. Confirm the file exists (optional)

```bash
# Should list baked-config.js (do not paste contents in chat)
ls DonkeyCode/baked-config.js
```

### 5. Load the extension in Chrome / Edge

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable **Developer mode**.
3. **Load unpacked** → select the **`DonkeyCode`** folder inside your clone (the folder that contains `manifest.json`).

### 6. Verify in the popup

Open the DonkeyCode popup → **Settings** (gear). You should see **“Token baked into this build”** if a non-empty token was baked.

### 7. Distribute to teammates (optional)

- Zip the **`DonkeyCode`** folder **after** `npm run build`, **or**
- Share the folder over your internal drive.

**Warning:** Anyone with that folder can extract the token from `baked-config.js`. Only share inside your team.

---

## If you skip env vars

Running `npm run build` with **no** `DONKEYCODE_*` variables copies **`baked-config.template.js`** to **`baked-config.js`** (all empty). The extension still works; users enter the token in **Settings** as before.

---

## All on GitHub: Actions + artifacts

The repo includes **`.github/workflows/build-donkeycode.yml`**. It runs `npm run build` using **repository secrets** and uploads **`donkeycode-extension`** (the `DonkeyCode/` folder) as a downloadable artifact.

### 1. Add repository secrets

On GitHub: open your repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**.

Create these (names must match exactly):

| Name | Required | Example / notes |
|------|----------|-----------------|
| `DONKEYCODE_GITHUB_TOKEN` | **Yes** | Your classic PAT (`ghp_…`) with `repo` scope |
| `DONKEYCODE_GITHUB_OWNER` | **Yes** | GitHub username or org, e.g. `MikeBane57` |
| `DONKEYCODE_GITHUB_REPO` | **Yes** | Repo name only, e.g. `DonkeyCODE` |
| `DONKEYCODE_GITHUB_BRANCH` | No | Defaults to `main` in the build script if empty |
| `DONKEYCODE_GITHUB_PATH` | No | Defaults to `sessions/donkeycode-sessions.json` if empty |

Paste each value once and save. You cannot read secret values back later (only replace them).

### 2. Run the workflow

- **Actions** tab → **Build DonkeyCode extension** → **Run workflow** (if using `workflow_dispatch`), or  
- Push to `main` when `DonkeyCode/`, `scripts/`, or `package.json` changes.

### 3. Download the built extension

Open the completed run → **Artifacts** → **donkeycode-extension** → download the zip. Unzip and use **Load unpacked** on the **`DonkeyCode`** folder inside.

**Security:** Do not add `echo`/`print` of env vars in the workflow. The default workflow only passes secrets to `npm run build`.

## CI (GitHub Actions) — summary

Store tokens as **repository secrets**. The workflow sets `env` from secrets and runs `npm run build` before uploading the artifact. **Never** echo the token in logs.
