/**
 * DonkeyCode popup — all actions use chrome.runtime.sendMessage only.
 */

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
      'Pending restore: "' +
      pending +
      '". Sign in to both sites if needed, then click Continue.';
    banner.classList.remove("hidden");
    actions.classList.remove("hidden");
  } else {
    banner.classList.add("hidden");
    actions.classList.add("hidden");
  }
}

async function loadState() {
  setStatus("Loading…");
  try {
    const state = await send("GET_STATE", {});
    $("script-source-url").value = state.scriptSourceUrl || "";
    $("extra-urls").value = state.extraScriptUrls || "";
    $("last-fetch").textContent = state.lastScriptFetch
      ? "Last script fetch: " + formatTime(state.lastScriptFetch)
      : "No fetch recorded yet.";

    updatePendingBanner(state);
    renderSessions(state.sessions || []);
    renderScripts(state.scripts || []);
    setStatus("");
  } catch (e) {
    console.error("[DonkeyCode:popup]", e);
    setStatus(String(e.message || e), true);
  }
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
    btnEdit.textContent = "Edit";
    btnEdit.addEventListener("click", () => openSessionEditor(name));

    const btnRestore = document.createElement("button");
    btnRestore.type = "button";
    btnRestore.textContent = "Restore";
    btnRestore.addEventListener("click", () => restoreSession(name));

    const btnLogin = document.createElement("button");
    btnLogin.type = "button";
    btnLogin.className = "secondary";
    btnLogin.textContent = "After login";
    btnLogin.title = "Open opssuite + swalife for sign-in, then continue restore";
    btnLogin.addEventListener("click", () => restoreAfterLogin(name));

    const btnDelete = document.createElement("button");
    btnDelete.type = "button";
    btnDelete.className = "danger";
    btnDelete.textContent = "Delete";
    btnDelete.addEventListener("click", () => deleteSession(name));

    actions.appendChild(btnEdit);
    actions.appendChild(btnRestore);
    actions.appendChild(btnLogin);
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

    const labelSpan = document.createElement("span");
    labelSpan.className = "script-row-label";
    labelSpan.textContent = s.name || s.url;

    const toggleLabel = document.createElement("label");
    toggleLabel.className = "toggle";
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

    li.appendChild(labelSpan);
    li.appendChild(toggleLabel);
    ul.appendChild(li);
  }
}

async function toggleScript(scriptId, enabled) {
  setStatus(enabled ? "Enabling…" : "Disabling…");
  try {
    const res = await send("SET_SCRIPT_ENABLED", { scriptId, enabled });
    renderScripts(res.scripts || []);
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
      ? "Last script fetch: " + formatTime(st.lastScriptFetch)
      : "";
    setStatus("Scripts refreshed.");
  } catch (e) {
    console.error("[DonkeyCode:popup]", e);
    setStatus(String(e.message || e), true);
  }
}

async function applySourceUrl() {
  const url = $("script-source-url").value.trim();
  setStatus("Applying source and reloading…");
  try {
    const res = await send("SET_SCRIPT_SOURCE_URL", { url });
    renderScripts(res.scripts || []);
    setStatus("Source updated and scripts reloaded.");
  } catch (e) {
    console.error("[DonkeyCode:popup]", e);
    setStatus(String(e.message || e), true);
  }
}

async function applyExtraUrls() {
  const text = $("extra-urls").value;
  setStatus("Applying extra URLs and reloading…");
  try {
    const res = await send("SET_EXTRA_SCRIPT_URLS", { text });
    renderScripts(res.scripts || []);
    setStatus("Extra URLs saved and scripts reloaded.");
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

async function restoreSession(name) {
  setStatus("Restoring session…");
  try {
    await send("RESTORE_SESSION", { name });
    setStatus('Session "' + name + '" restored (new windows opened).');
  } catch (e) {
    console.error("[DonkeyCode:popup]", e);
    setStatus(String(e.message || e), true);
  }
}

async function restoreAfterLogin(name) {
  setStatus("Opening login windows…");
  try {
    const res = await send("RESTORE_SESSION_AFTER_LOGIN", { name });
    updatePendingBanner(res);
    setStatus(
      "Sign in to opssuite and swalife, then click Continue to open your saved session."
    );
  } catch (e) {
    console.error("[DonkeyCode:popup]", e);
    setStatus(String(e.message || e), true);
  }
}

async function completePendingRestore() {
  setStatus("Opening saved session…");
  try {
    const res = await send("COMPLETE_PENDING_RESTORE", {});
    updatePendingBanner(res);
    setStatus("Saved session windows opened.");
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
$("btn-apply-source").addEventListener("click", applySourceUrl);
$("btn-apply-extra").addEventListener("click", applyExtraUrls);
$("btn-complete-pending").addEventListener("click", completePendingRestore);
$("btn-cancel-pending").addEventListener("click", cancelPendingRestore);

$("session-editor-save").addEventListener("click", saveSessionEditor);
$("session-editor-cancel").addEventListener("click", closeSessionEditor);
$("session-editor-overlay").addEventListener("click", function (ev) {
  if (ev.target === $("session-editor-overlay")) closeSessionEditor();
});

document.addEventListener("DOMContentLoaded", loadState);
