# DonkeyCode — Privacy Policy

**Last updated:** April 2026

This policy describes how the **DonkeyCode** browser extension (“the extension”) handles information. DonkeyCode is a personal tool to load user scripts from URLs you configure and to save/restore browser window layouts.

## What the extension does

- Loads user script source code from **URLs you choose** (for example, a GitHub API listing and raw script files).
- Runs those scripts on **web pages you allow** (after you grant site access), according to each script’s `@match` / `@exclude` rules.
- Optionally forwards **network requests** that scripts make via `GM_xmlhttpRequest` through the extension background, subject to each script’s `@connect` rules.
- Saves **session layouts** (window positions and tab URLs) and **settings** using Chrome’s storage APIs.

## Data stored on your device

- **Settings and sessions:** Stored with `chrome.storage.sync` and/or `chrome.storage.local` (browser-managed). Session data includes URLs and window geometry you have saved.
- **Cached script bodies:** Stored locally so scripts can be reloaded and toggled offline when possible.

We do **not** operate our own servers for your data. Synced data is subject to **Google Chrome sync** or **Microsoft Edge sync** when you are signed in and sync is enabled—see your browser’s privacy settings.

## Data sent over the network

The extension only fetches from the network when **you** configure sources or when **your scripts** request URLs:

- **Script sources:** e.g. GitHub (API or raw files), or any URL you enter.
- **User scripts:** May load third-party sites according to their `@match` rules.
- **`GM_xmlhttpRequest`:** The background worker performs `fetch()` only to URLs allowed by the script’s metadata (`@connect`) and the extension’s granted permissions.

We do **not** sell your data. We do **not** embed third-party analytics or ads in this project.

## Permissions (why they are needed)

| Permission   | Purpose |
|-------------|---------|
| `scripting` | Inject user scripts and the messaging bridge into pages you authorize. |
| `tabs`      | Read tab URLs to match `@match`, restore sessions, inject on navigation. |
| `storage`   | Save scripts list, settings, sessions, pending restore state. |
| `alarms`    | Daily refresh of remote script sources. |
| `windows`   | Save and restore window positions for sessions. |
| **Optional** `http://*/*` and `https://*/*` | Access sites only **after you approve**—needed to inject scripts and run `GM_xmlhttpRequest` fetches. |

You can **revoke** site access in the browser’s extension settings; the extension will stop running on pages until you grant access again.

## Changes

We may update this policy when the extension changes. The **“Last updated”** date at the top will change when it does.

## Contact

For questions about this policy, contact the **publisher** of the Chrome Web Store / Edge Add-ons listing or the **repository maintainer** for the open-source project.

---

*This file can be hosted at a public URL and linked from the store listing as the privacy policy.*
