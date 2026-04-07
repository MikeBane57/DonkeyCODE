# GitHub session sync

DonkeyCode can read and write a **JSON file in a Git repository** using the **GitHub REST API**. Everyone on the team configures the same **owner**, **repository**, **branch**, and **file path**, and uses their own **personal access token** (PAT) on each machine.

## What you need on GitHub

1. A **repository** you can push to (org or user repo).
2. A **folder path** for the file, e.g. `sessions/donkeycode-sessions.json`. The folder does not need to exist before the first **Push**; GitHub creates it when the file is added.
3. A **personal access token** for each user:
   - **Classic token:** enable scope **`repo`** (full control of private repositories) if the repo is private; for public repos, **`public_repo`** may be enough for write access.
   - **Fine-grained token:** grant **Contents: Read and write** on the target repository.

Tokens are **only stored in the browser** (`chrome.storage.local` on that device), not sent to us.

## Configure in DonkeyCode

1. Open the extension popup → **Settings** (gear).
2. Fill **Owner**, **Repository**, **Branch** (e.g. `main`), **File path in repo**.
3. Paste your **token** → **Save GitHub settings**.
4. Use **Pull from GitHub** to merge remote sessions into this browser, or **Push to GitHub** to upload merged sessions after you edit/save locally.

## Merge behavior

- Each saved session has an **`_meta.updatedAt`** timestamp (ms).
- On **pull** or **push**, the extension **merges by name**: if the same session name exists locally and remotely, the **newer** `updatedAt` wins.
- **Push** always merges remote + local first, then writes the combined file so teammates’ newer edits are preserved when possible.

## Security

- Treat the token like a password; revoke it on GitHub if a machine is lost.
- Prefer a **dedicated** bot/user account or fine-grained token limited to one repo.

## File format (written by the extension)

```json
{
  "version": 1,
  "updatedAt": 1710000000000,
  "sessions": {
    "My layout": {
      "windows": [ ... ],
      "_meta": { "updatedAt": 1710000000000 }
    }
  }
}
```

You may commit this file from Git CLI as well; the next **Pull** will merge it the same way.
