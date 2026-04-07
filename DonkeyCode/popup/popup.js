/**
 * DonkeyCode popup — all actions use chrome.runtime.sendMessage only.
 */

/** Must match STORAGE.PENDING_FIRST_POPUP_REFRESH in background.js */
const PENDING_FIRST_POPUP_REFRESH = "donkeycode_pending_first_popup_refresh";

let firstPopupRefreshInflight = null;

function $(id) {
  return document.getElementById(id);
}

function setStatus(text, isError) {
  const el = $("status");
  el.textContent = text || "";
  el.classList.toggle("error", !!isError);
}

function send(type, payload) {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage({ type, ...payload }, (response) => {
        const err = chrome.runtime.lastError;
        if (err) {
          reject(new Error(err.message));
          return;
        }
        if (!response) {
          reject(new Error("No response from background"));
          return;
        }
        if (!response.ok) {
          reject(new Error(response.error || "Request failed"));
          return;
        }
        resolve(response);
      });
    } catch (e) {
      reject(e);
    }
  });
}

function formatTime(ms) {
  if (!ms) return "";
  try {
    return new Date(ms).toLocaleString();
  } catch (e) {
    return String(ms);
  }
}

function switchTab(name) {
  document.querySelectorAll(".tab").forEach((btn) => {
    const on = btn.dataset.tab === name;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-selected", on ? "true" : "false");
  });
  $("panel-sessions").hidden = name !== "sessions";
  $("panel-scripts").hidden = name !== "scripts";
  $("panel-sessions").classList.toggle("active", name === "sessions");
  $("panel-scripts").classList.toggle("active", name === "scripts");
}

let editingSessionName = null;

function updatePendingBanner(state) {
  const pending = state && state.pendingRestoreSession;
  const banner = $("pending-restore-banner");
  const actions = $("pending-restore-actions");
  if (pending) {
    banner.textContent =
      'Ready to launch: "' +
      pending +
      '". After signing in, click Continue below.';
    banner.classList.remove("hidden");
    actions.classList.remove("hidden");
  } else {
    banner.classList.add("hidden");
    actions.classList.add("hidden");
  }
}

function updateSetupBanner(state) {
  const bar = $("setup-banner");
  const text = $("setup-banner-text");
  const btnAllow = $("btn-setup-allow");
  if (!bar || !text) return;
  const dismissed = state && state.setupDismissed;
  const hasHost = state && state.hasHostAccess;
  const scripts = (state && state.scripts) || [];
  const needsSetup =
    !dismissed && (!hasHost || scripts.length === 0);
  if (!needsSetup) {
    bar.classList.add("hidden");
    return;
  }
  bar.classList.remove("hidden");
  if (!hasHost) {
    text.textContent =
      "Finish setup: allow website access so user scripts can run on http(s) pages.";
    if (btnAllow) btnAllow.style.display = "";
  } else {
    text.textContent =
      "Finish setup: open Settings (gear) and tap Refresh scripts to load your script list.";
    if (btnAllow) btnAllow.style.display = "none";
  }
}

function updateHostAccessUI(hasHostAccess) {
  const st = $("host-access-status");
  const btn = $("btn-request-host-access");
  if (!st || !btn) return;
  if (hasHostAccess) {
    st.textContent = "Allowed — user scripts can run on http(s) pages.";
    btn.textContent = "Manage in browser…";
    btn.dataset.mode = "manage";
  } else {
    st.textContent = "Not granted — scripts will not inject until you allow.";
    btn.textContent = "Allow access to websites (http/https)";
    btn.dataset.mode = "request";
  }
}

function setTabVersions(version) {
  const v = (version && String(version).trim()) || "";
  const s1 = $("tab-ver-sessions");
  const s2 = $("tab-ver-scripts");
  if (s1) s1.textContent = v ? v : "";
  if (s2) s2.textContent = v ? v : "";
}

function syncLoginFirstSelect(names) {
  const sel = $("login-first-session");
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = "";
  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = "— Select —";
  sel.appendChild(opt0);
  for (const n of names) {
    const opt = document.createElement("option");
    opt.value = n;
    opt.textContent = n;
    sel.appendChild(opt);
  }
  if (prev && names.includes(prev)) sel.value = prev;
}

function fillSessionFolderUI(state) {
  const sel = $("session-folder-select");
  const hint = $("session-folder-github-hint");
  if (!sel) return;
  const folders = state.sessionFolders || ["__default__"];
  const cur = state.currentSessionFolder || "__default__";
  sel.innerHTML = "";
  for (const fk of folders) {
    const opt = document.createElement("option");
    opt.value = fk;
    opt.textContent =
      fk === "__default__" ? "Default" : fk;
    if (fk === cur) opt.selected = true;
    sel.appendChild(opt);
  }
  if (hint) {
    const rel = (state.folderGithubRelativePaths && state.folderGithubRelativePaths[cur]) || "";
    const eff = state.githubEffectiveSessionFilePath || "";
    hint.textContent = rel
      ? "GitHub file for this folder: " + eff
      : "GitHub file (base path): " + (state.githubPath || "") + " — add subfolder in full settings if needed.";
  }
}

async function loadState() {
  setStatus("Loading…");
  try {
    const state = await send("GET_STATE", {});
    $("last-fetch").textContent = state.lastScriptFetch
      ? "Last fetch: " + formatTime(state.lastScriptFetch)
      : "No fetch yet — open settings (gear) and refresh.";

    setTabVersions(state.extensionVersion || "");
    updateHostAccessUI(!!state.hasHostAccess);
    updateSetupBanner(state);
    updatePendingBanner(state);
    fillSessionFolderUI(state);
    renderSessions(state.sessions || []);
    syncLoginFirstSelect(state.sessions || []);
    renderScripts(state.scripts || []);
    setStatus("");

    await runFirstPopupRefreshIfNeeded();
  } catch (e) {
    console.error("[DonkeyCode:popup]", e);
    setStatus(String(e.message || e), true);
  }
}

/**
 * Welcome page sets PENDING_FIRST_POPUP_REFRESH then opens the popup; the popup
 * can load before storage finishes, so we also listen for storage.onChanged.
 */
function runFirstPopupRefreshIfNeeded() {
  if (firstPopupRefreshInflight) return firstPopupRefreshInflight;
  firstPopupRefreshInflight = (async function () {
    try {
      const state = await send("GET_STATE", {});
      if (!state.pendingFirstPopupRefresh) return;

      switchTab("scripts");
      setStatus("Loading scripts…");
      try {
        const res = await send("REFRESH_SCRIPTS", {});
        renderScripts(res.scripts || []);
        const st2 = await send("GET_STATE", {});
        $("last-fetch").textContent = st2.lastScriptFetch
          ? "Last fetch: " + formatTime(st2.lastScriptFetch)
          : "";
        updateSetupBanner(st2);
        setStatus("Scripts loaded.");
      } catch (e) {
        console.error("[DonkeyCode:popup] first-load refresh", e);
        setStatus(String(e.message || e), true);
      } finally {
        try {
          await send("POPUP_CONSUMED_FIRST_REFRESH", {});
        } catch (e2) {
          /* ignore */
        }
      }
    } finally {
      firstPopupRefreshInflight = null;
    }
  })();
  return firstPopupRefreshInflight;
}

if (chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener(function (changes, areaName) {
    if (areaName !== "local") return;
    const ch = changes[PENDING_FIRST_POPUP_REFRESH];
    if (!ch || !ch.newValue) return;
    runFirstPopupRefreshIfNeeded().catch(function (e) {
      console.error("[DonkeyCode:popup] storage first refresh", e);
    });
  });
}

function renderSessions(names) {
  const ul = $("session-list");
  const empty = $("sessions-empty");
  ul.innerHTML = "";
  if (!names.length) {
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");
  for (const name of names) {
    const li = document.createElement("li");
    li.className = "session-item";

    const span = document.createElement("span");
    span.textContent = name;
    span.style.flex = "1";
    span.style.wordBreak = "break-word";

    const actions = document.createElement("div");
    actions.className = "session-actions";

    const btnEdit = document.createElement("button");
    btnEdit.type = "button";
    btnEdit.className = "btn-icon";
    btnEdit.textContent = "\u270F";
    btnEdit.setAttribute("aria-label", "Edit session");
    btnEdit.title = "Edit session";
    btnEdit.addEventListener("click", () => openSessionEditor(name));

    const btnLaunch = document.createElement("button");
    btnLaunch.type = "button";
    btnLaunch.className = "btn-icon btn-icon-launch secondary";
    btnLaunch.textContent = "Launch";
    btnLaunch.setAttribute("aria-label", "Launch session");
    btnLaunch.title = "Launch saved windows and tabs";
    btnLaunch.addEventListener("click", () => launchSession(name));

    const btnDelete = document.createElement("button");
    btnDelete.type = "button";
    btnDelete.className = "btn-icon danger";
    btnDelete.textContent = "\uD83D\uDDD1";
    btnDelete.setAttribute("aria-label", "Delete session");
    btnDelete.title = "Delete session";
    btnDelete.addEventListener("click", () => deleteSession(name));

    actions.appendChild(btnEdit);
    actions.appendChild(btnLaunch);
    actions.appendChild(btnDelete);
    li.appendChild(span);
    li.appendChild(actions);
    ul.appendChild(li);
  }
}

function renderScripts(scripts) {
  const ul = $("script-list");
  const empty = $("scripts-empty");
  ul.innerHTML = "";
  if (!scripts.length) {
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");
  for (const s of scripts) {
    const li = document.createElement("li");

    const displayName =
      (s.userScriptName && String(s.userScriptName).trim()) ||
      s.name ||
      s.url ||
      "Script";

    const labelSpan = document.createElement("span");
    labelSpan.className = "script-row-label";
    labelSpan.textContent = displayName;
    labelSpan.title = s.url || displayName;

    const toggleLabel = document.createElement("label");
    toggleLabel.className = "toggle toggle--sm";
    toggleLabel.setAttribute("title", s.enabled !== false ? "On" : "Off");

    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = s.enabled !== false;
    input.dataset.scriptId = s.id;
    input.addEventListener("change", () => toggleScript(s.id, input.checked));

    const slider = document.createElement("span");
    slider.className = "toggle-slider";
    slider.setAttribute("aria-hidden", "true");

    toggleLabel.appendChild(input);
    toggleLabel.appendChild(slider);

    li.appendChild(toggleLabel);
    li.appendChild(labelSpan);
    ul.appendChild(li);
  }
}

async function toggleScript(scriptId, enabled) {
  setStatus(enabled ? "Enabling…" : "Disabling…");
  try {
    const res = await send("SET_SCRIPT_ENABLED", { scriptId, enabled });
    renderScripts(res.scripts || []);
    const st = await send("GET_STATE", {});
    updateSetupBanner(st);
    setStatus(enabled ? "Script enabled." : "Script disabled and cleaned up.");
  } catch (e) {
    console.error("[DonkeyCode:popup]", e);
    setStatus(String(e.message || e), true);
    await loadState();
  }
}

async function refreshScripts() {
  setStatus("Refreshing scripts from GitHub…");
  try {
    const res = await send("REFRESH_SCRIPTS", {});
    renderScripts(res.scripts || []);
    const st = await send("GET_STATE", {});
    $("last-fetch").textContent = st.lastScriptFetch
      ? "Last fetch: " + formatTime(st.lastScriptFetch)
      : "";
    updateSetupBanner(st);
    setStatus("Scripts refreshed.");
  } catch (e) {
    console.error("[DonkeyCode:popup]", e);
    setStatus(String(e.message || e), true);
  }
}

async function saveSession() {
  const name = $("session-name").value.trim();
  if (!name) {
    setStatus("Enter a session name first.", true);
    return;
  }
  setStatus("Saving session…");
  try {
    const res = await send("SAVE_SESSION", { name });
    $("session-name").value = "";
    renderSessions(res.sessions || []);
    setStatus('Session "' + name + '" saved.');
  } catch (e) {
    console.error("[DonkeyCode:popup]", e);
    setStatus(String(e.message || e), true);
  }
}

async function launchSession(name) {
  setStatus("Launching session…");
  try {
    await send("RESTORE_SESSION", { name });
    setStatus('Session "' + name + '" launched (new windows opened).');
  } catch (e) {
    console.error("[DonkeyCode:popup]", e);
    setStatus(String(e.message || e), true);
  }
}

async function loginFirst() {
  const name = ($("login-first-session") && $("login-first-session").value) || "";
  if (!name.trim()) {
    setStatus("Choose a session in the dropdown first.", true);
    return;
  }
  setStatus("Opening login windows…");
  try {
    const res = await send("RESTORE_SESSION_AFTER_LOGIN", { name: name.trim() });
    updatePendingBanner(res);
    setStatus(
      "Sign in to both sites, then click Continue to launch your saved session."
    );
  } catch (e) {
    console.error("[DonkeyCode:popup]", e);
    setStatus(String(e.message || e), true);
  }
}

async function completePendingRestore() {
  setStatus("Launching saved session…");
  try {
    const res = await send("COMPLETE_PENDING_RESTORE", {});
    updatePendingBanner(res);
    setStatus("Session launched.");
  } catch (e) {
    console.error("[DonkeyCode:popup]", e);
    setStatus(String(e.message || e), true);
  }
}

async function cancelPendingRestore() {
  try {
    const res = await send("CANCEL_PENDING_RESTORE", {});
    updatePendingBanner(res);
    setStatus("Pending restore cancelled.");
  } catch (e) {
    console.error("[DonkeyCode:popup]", e);
    setStatus(String(e.message || e), true);
  }
}

async function deleteSession(name) {
  const ok = window.confirm(
    'Delete saved session "' + name + '"? This cannot be undone.'
  );
  if (!ok) return;
  setStatus("Deleting session…");
  try {
    const res = await send("DELETE_SESSION", { name });
    renderSessions(res.sessions || []);
    setStatus('Session "' + name + '" deleted.');
  } catch (e) {
    console.error("[DonkeyCode:popup]", e);
    setStatus(String(e.message || e), true);
  }
}

async function openSessionEditor(name) {
  editingSessionName = name;
  setStatus("Loading session…");
  try {
    const res = await send("GET_SESSION_DETAIL", { name });
    const payload = { windows: res.snapshot.windows };
    $("session-editor-json").value = JSON.stringify(payload, null, 2);
    $("session-editor-title").textContent = 'Edit session: "' + name + '"';
    $("session-editor-overlay").classList.remove("hidden");
    $("session-editor-overlay").setAttribute("aria-hidden", "false");
    setStatus("");
  } catch (e) {
    console.error("[DonkeyCode:popup]", e);
    setStatus(String(e.message || e), true);
    editingSessionName = null;
  }
}

function closeSessionEditor() {
  editingSessionName = null;
  $("session-editor-overlay").classList.add("hidden");
  $("session-editor-overlay").setAttribute("aria-hidden", "true");
}

async function openSettingsTab() {
  try {
    await send("OPEN_SETTINGS_TAB", {});
  } catch (e) {
    console.error("[DonkeyCode:popup]", e);
    setStatus(String(e.message || e), true);
  }
}

async function saveSessionEditor() {
  if (!editingSessionName) return;
  let parsed;
  try {
    parsed = JSON.parse($("session-editor-json").value);
  } catch (e) {
    setStatus("Invalid JSON: " + (e.message || e), true);
    return;
  }
  if (!parsed || !Array.isArray(parsed.windows)) {
    setStatus('JSON must be an object with a "windows" array.', true);
    return;
  }
  setStatus("Saving session…");
  try {
    const res = await send("SAVE_SESSION_DATA", {
      name: editingSessionName,
      snapshot: parsed,
    });
    closeSessionEditor();
    renderSessions(res.sessions || []);
    setStatus('Session "' + editingSessionName + '" updated.');
  } catch (e) {
    console.error("[DonkeyCode:popup]", e);
    setStatus(String(e.message || e), true);
  }
}

document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

$("btn-save-session").addEventListener("click", saveSession);
$("btn-refresh-sessions").addEventListener("click", loadState);
$("btn-refresh-scripts").addEventListener("click", refreshScripts);
$("btn-open-settings").addEventListener("click", openSettingsTab);

$("session-folder-select").addEventListener("change", async function () {
  const v = this.value;
  setStatus("Switching folder…");
  try {
    const res = await send("SET_CURRENT_SESSION_FOLDER", { folderKey: v });
    fillSessionFolderUI(res);
    renderSessions(res.sessions || []);
    syncLoginFirstSelect(res.sessions || []);
    setStatus("");
  } catch (e) {
    console.error("[DonkeyCode:popup]", e);
    setStatus(String(e.message || e), true);
    await loadState();
  }
});

$("btn-add-session-folder").addEventListener("click", async function () {
  const name = window.prompt(
    "New folder name (relative path, e.g. team-a or ops/daily):"
  );
  if (!name || !name.trim()) return;
  const ghRel = window.prompt(
    "GitHub subfolder under the base path (optional, e.g. team-a):",
    ""
  );
  setStatus("Adding folder…");
  try {
    const res = await send("ADD_SESSION_FOLDER", {
      folderKey: name.trim(),
      githubRelativePath: (ghRel || "").trim(),
    });
    fillSessionFolderUI(res);
    renderSessions(res.sessions || []);
    syncLoginFirstSelect(res.sessions || []);
    $("session-folder-select").value = res.currentSessionFolder || name.trim();
    setStatus("Folder added.");
  } catch (e) {
    console.error("[DonkeyCode:popup]", e);
    setStatus(String(e.message || e), true);
  }
});

$("btn-setup-allow").addEventListener("click", async function () {
  setStatus("Requesting permission…");
  try {
    const res = await send("REQUEST_HOST_ACCESS", {});
    updateHostAccessUI(!!res.hasHostAccess);
    const st = await send("GET_STATE", {});
    updateSetupBanner(st);
    if (res.granted) setStatus("Website access granted.");
    else setStatus("Permission not granted.", true);
  } catch (e) {
    console.error("[DonkeyCode:popup]", e);
    setStatus(String(e.message || e), true);
  }
});

$("btn-setup-welcome").addEventListener("click", async function () {
  try {
    await send("OPEN_WELCOME_TAB", {});
  } catch (e) {
    console.error("[DonkeyCode:popup]", e);
    setStatus(String(e.message || e), true);
  }
});

$("btn-setup-dismiss").addEventListener("click", async function () {
  try {
    await send("DISMISS_SETUP_BANNER", {});
    const st = await send("GET_STATE", {});
    updateSetupBanner(st);
  } catch (e) {
    console.error("[DonkeyCode:popup]", e);
  }
});

$("btn-request-host-access").addEventListener("click", async function () {
  const btn = $("btn-request-host-access");
  if (btn && btn.dataset.mode === "manage") {
    const id = chrome.runtime && chrome.runtime.id;
    const scheme =
      typeof navigator !== "undefined" && /Edg\//.test(navigator.userAgent)
        ? "edge://"
        : "chrome://";
    const url = id
      ? scheme + "extensions/?id=" + encodeURIComponent(id)
      : scheme + "extensions/";
    try {
      chrome.tabs.create({ url });
    } catch (e) {
      setStatus("Open Extensions → DonkeyCode → Details → Site access.", true);
    }
    return;
  }
  setStatus("Requesting permission…");
  try {
    const res = await send("REQUEST_HOST_ACCESS", {});
    updateHostAccessUI(!!res.hasHostAccess);
    const st2 = await send("GET_STATE", {});
    updateSetupBanner(st2);
    if (res.granted) setStatus("Website access granted. Reload open tabs if needed.");
    else setStatus("Permission not granted.", true);
  } catch (e) {
    console.error("[DonkeyCode:popup]", e);
    setStatus(String(e.message || e), true);
  }
});
$("btn-complete-pending").addEventListener("click", completePendingRestore);
$("btn-cancel-pending").addEventListener("click", cancelPendingRestore);
$("btn-login-first").addEventListener("click", loginFirst);

$("session-editor-save").addEventListener("click", saveSessionEditor);
$("session-editor-cancel").addEventListener("click", closeSessionEditor);
$("session-editor-overlay").addEventListener("click", function (ev) {
  if (ev.target === $("session-editor-overlay")) closeSessionEditor();
});

document.addEventListener("DOMContentLoaded", loadState);
