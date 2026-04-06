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

async function loadState() {
  setStatus("Loading…");
  try {
    const state = await send("GET_STATE", {});
    $("script-source-url").value = state.scriptSourceUrl || "";
    $("extra-urls").value = state.extraScriptUrls || "";
    $("last-fetch").textContent = state.lastScriptFetch
      ? "Last script fetch: " + formatTime(state.lastScriptFetch)
      : "No fetch recorded yet.";

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
    const span = document.createElement("span");
    span.textContent = name;
    span.style.flex = "1";
    span.style.wordBreak = "break-word";

    const actions = document.createElement("div");
    actions.className = "session-actions";

    const btnRestore = document.createElement("button");
    btnRestore.type = "button";
    btnRestore.textContent = "Restore";
    btnRestore.addEventListener("click", () => restoreSession(name));

    const btnDelete = document.createElement("button");
    btnDelete.type = "button";
    btnDelete.className = "danger";
    btnDelete.textContent = "Delete";
    btnDelete.addEventListener("click", () => deleteSession(name));

    actions.appendChild(btnRestore);
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
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = s.enabled !== false;
    cb.dataset.scriptId = s.id;
    cb.addEventListener("change", () => toggleScript(s.id, cb.checked));

    const label = document.createElement("label");
    label.appendChild(cb);
    const text = document.createTextNode(" " + (s.name || s.url));
    label.appendChild(text);

    li.appendChild(label);
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

document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

$("btn-save-session").addEventListener("click", saveSession);
$("btn-refresh-sessions").addEventListener("click", loadState);
$("btn-refresh-scripts").addEventListener("click", refreshScripts);
$("btn-apply-source").addEventListener("click", applySourceUrl);
$("btn-apply-extra").addEventListener("click", applyExtraUrls);

document.addEventListener("DOMContentLoaded", loadState);
