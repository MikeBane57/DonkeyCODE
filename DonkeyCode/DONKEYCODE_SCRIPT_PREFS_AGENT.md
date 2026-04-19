# DonkeyCode script user preferences — agent instructions

Use this when editing or authoring **userscripts** that run in the **DonkeyCode** Chrome/Edge extension (MV3). The extension loads `.user.js` files from a configured source (often a GitHub repo) and injects them on matching pages.

## What this feature does

- Authors declare **optional settings** in the script metadata (`@donkeycode-pref`).
- Users edit values in the extension **popup** (Scripts tab → **Pref** / gear per script). The UI is **form fields**, not raw JSON.
- Values are stored **per session folder** (with script on/off) and can sync via GitHub (`donkeycode-script-prefs.json` next to `donkeycode-sessions.json`).
- At runtime the extension injects **`donkeycodeGetPref(key)`** into the script so the user’s choices are available in the page.

## What to put in the script header

Inside `// ==UserScript==` … `// ==/UserScript==`, add one or more lines:

```text
// @donkeycode-pref { "JSON_OBJECT" }
```

- The value is a **single JSON object** (one line is easiest). You may use **multiple** `@donkeycode-pref` lines; they are **merged** into one schema (later keys override earlier ones if duplicated).
- Each **top-level key** is a preference id (e.g. `openUrl`, `maxItems`). Each value is a **field spec** object.

### Field spec (supported shapes)

| `type` | UI | Notes |
|--------|-----|--------|
| `string` (default) | Single-line text | Use `placeholder`, `maxlength`, `label`, `description` |
| `url` | Same as string with `type="url"` | Validates URL in the browser |
| `number` | Number input | Optional `min`, `max`, `step` |
| `boolean` | Checkbox | `default` should be `true` or `false` |
| `select` | Dropdown | Required `options`: array of strings **or** `{ "value": "...", "label": "..." }` |

Aliases: `bool` → boolean, `int`/`integer`/`float` → number, `enum`/`dropdown` → select.

Common properties on each field:

- **`label`** — Short label shown above the control (fallback: key name).
- **`group`** — Optional section title in the Pref modal (e.g. `"Go Turn Details"`). Keys without `group` appear under **General**.
- **`description`** or **`hint`** — Smaller help text under the control.
- **`default`** — Used when the user has never saved a value (and for `donkeycodeGetPref` fallback).

### Minimal example

```javascript
// ==UserScript==
// @name        My tool
// @match       *://*/*
// @donkeycode-pref {"openUrl":{"type":"url","label":"Open in new tab","default":"https://example.com/","description":"Full https URL"}}
// @donkeycode-pref {"verbose":{"type":"boolean","label":"Debug logging","default":false}}
// ==/UserScript==
```

## What to put in the script body

### How DonkeyCode injects your code (important)

The extension compiles the script body with:

- `new Function("donkeycodeGetPref", userCode)` — or with **`GM_xmlhttpRequest`** as a second parameter when `@grant` / code uses it.

It then calls the resulting function with the **real** `donkeycodeGetPref` implementation (and `GM_xmlhttpRequest` when applicable). **Your top-level code must receive that parameter** — e.g. wrap in `(function (donkeycodeGetPref) { ... })(donkeycodeGetPref)` **without** passing `globalThis.donkeycodeGetPref` as the argument unless the host has set it (see below).

DonkeyCode also assigns **`window.donkeycodeGetPref`** / **`globalThis.donkeycodeGetPref`** to the same function during and after injection so:

- Parameterless IIFEs can pass **`globalThis.donkeycodeGetPref`** into a wrapper: `(function (g) { ... })(globalThis.donkeycodeGetPref)` — **only valid after** DonkeyCode has run on the page.
- Async callbacks that run later can still call `globalThis.donkeycodeGetPref("key")` (if multiple scripts inject, the **last** one wins for the global).

**Wrong (do not do this):** `(function (donkeycodeGetPref) { ... })(globalThis.donkeycodeGetPref)` when `globalThis.donkeycodeGetPref` is still `undefined` — you will pass `undefined` and break reads.

**Preferred:** use the lexical parameter from a wrapper:

```javascript
(function (donkeycodeGetPref) {
  var url = donkeycodeGetPref("openUrl");
  // main logic...
})(donkeycodeGetPref);
```

Or use **`globalThis.donkeycodeGetPref("key")`** directly in the body **after** DonkeyCode has injected (no IIFE argument needed).

### No GM_xmlhttpRequest

```javascript
(function (donkeycodeGetPref) {
  var url = donkeycodeGetPref("openUrl");
  console.log(url);
})(donkeycodeGetPref);
```

### With GM_xmlhttpRequest

```javascript
(function (donkeycodeGetPref, GM_xmlhttpRequest) {
  var url = donkeycodeGetPref("openUrl");
  GM_xmlhttpRequest({ method: "GET", url: url, onload: function (r) { console.log(r.responseText); } });
})(donkeycodeGetPref, GM_xmlhttpRequest);
```

Semantics:

- `donkeycodeGetPref("key")` returns the **saved** value for the active session folder (merged with schema), or the schema **`default`**, or `undefined` if neither exists.

**Debug:** After saving prefs and reloading the page, the **extension** service worker console (not the site page console) may log `[DonkeyCode:page] applying saved prefs` with the script id and object when non-empty prefs are injected.

## What is possible / not possible

**Possible**

- Strings, URLs, numbers, booleans, and fixed-option dropdowns.
- Multiple prefs per script via one merged JSON object or several `@donkeycode-pref` lines.
- Per-user values that follow the machine’s **session folder** and optional GitHub sync (named folders; **Default** folder does not sync script prefs).

**Not in the popup UI**

- Freeform **JSON** editing in the modal (use schema fields only).
- **Arrays** or nested objects as a single editable value (flatten into keys or use string fields).
- **Validation** beyond HTML5 (`url`, `number` min/max). Add checks in script.

**In the popup UI**

- **`group`** on field specs → section headings in the Pref modal.

## Agent checklist when adding prefs to a script

1. Add `@donkeycode-pref` with valid **one-line JSON** (or multiple lines merged).
2. Ensure every key has a **`type`** (or rely on default `string`) and **`default`** where it matters.
3. Update the script body to read values only via **`donkeycodeGetPref("key")`** (not hard-coded constants for user-facing options).
4. If the script uses **`GM_xmlhttpRequest`**, keep the **two-argument** IIFE signature as shown above.
5. Tell users: **Refresh** scripts after changing the header; then set values in **Scripts → Pref** and save.

## Related files in the DonkeyCode repo

- `background.js` — parses `@donkeycode-pref`, stores `donkeycodePrefSchema` and `userPrefs`, injects `donkeycodeGetPref`.
- `popup/popup.js` — builds the form from the schema.
