/**
 * Full-page settings (extension pages can message the service worker).
 */

function $(id) {
  return document.getElementById(id);
}

function send(type, payload) {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage({ type, ...payload }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
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

let repoBrowsePath = "";

function setInlineStatus(el, text, isError) {
  if (!el) return;
  el.textContent = text || "";
  el.classList.toggle("error", !!isError);
}

function renderHostAccess(state) {
  const line = $("host-access-line");
  const btn = $("btn-host-access");
  if (!line || !btn) return;
  if (state.hasHostAccess) {
    line.textContent = "Website access is granted.";
    line.className = "status-line ok";
    btn.textContent = "Open extension site access…";
    btn.dataset.mode = "manage";
  } else {
    line.textContent = "Not granted — user scripts will not run on web pages until you allow.";
    line.className = "status-line warn";
    btn.textContent = "Allow website access";
    btn.dataset.mode = "request";
  }
}

function fillGithubForm(state) {
  $("field-gh-owner").value = state.githubOwner || "";
  $("field-gh-repo").value = state.githubRepo || "";
  $("field-gh-branch").value = state.githubBranch || "main";
  $("field-gh-path").value = state.githubPath || "";
  $("field-gh-token").value = "";
  const hint = $("github-token-hint");
  if (hint) {
    const parts = [];
    if (state.githubBakedIn) parts.push("baked-in token present in build");
    if (state.githubTokenConfigured) parts.push("stored token set");
    hint.textContent = parts.length ? parts.join("; ") : "no stored token (PAT required unless baked)";
  }
}

function fillScriptsForm(state) {
  $("field-script-source").value = state.scriptSourceUrl || "";
  $("field-extra-urls").value = state.extraScriptUrls || "";
}

function renderFolders(tree, currentFolder, githubBasePath) {
  const tbody = $("folders-tbody");
  const active = $("active-folder-label");
  const baseLine = $("repo-browse-base");
  if (baseLine) {
    baseLine.textContent =
      "Base path for sync file: " + (githubBasePath || "(not set)");
  }
  if (active) {
    active.textContent =
      currentFolder === "__default__" ? "Default" : currentFolder || "—";
  }
  if (!tbody) return;
  tbody.innerHTML = "";
  const keys = Object.keys(tree || {}).sort();
  for (const key of keys) {
    const row = tree[key] || {};
    const tr = document.createElement("tr");

    const tdName = document.createElement("td");
    tdName.className = "folder-key";
    tdName.textContent = key === "__default__" ? "Default (__default__)" : key;

    const tdCount = document.createElement("td");
    tdCount.textContent = String(row.sessionCount != null ? row.sessionCount : 0);

    const tdPath = document.createElement("td");
    const inp = document.createElement("input");
    inp.type = "text";
    inp.dataset.folderKey = key;
    inp.value = row.githubRelativePath || "";
    inp.placeholder = "e.g. team-a";
    inp.setAttribute("aria-label", "GitHub subfolder for " + key);
    tdPath.appendChild(inp);

    const tdGo = document.createElement("td");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn small secondary";
    btn.textContent = "Save";
    btn.addEventListener("click", async function () {
      setInlineStatus($("folders-status"), "Saving…", false);
      try {
        await send("SET_SESSION_FOLDER_GITHUB_PATH", {
          folderKey: key,
          githubRelativePath: inp.value.trim(),
        });
        setInlineStatus($("folders-status"), "Saved path for folder.", false);
        await refreshFoldersOnly();
      } catch (e) {
        setInlineStatus($("folders-status"), String(e.message || e), true);
      }
    });
    tdGo.appendChild(btn);

    tr.appendChild(tdName);
    tr.appendChild(tdCount);
    tr.appendChild(tdPath);
    tr.appendChild(tdGo);
    tbody.appendChild(tr);
  }
}

async function refreshFoldersOnly() {
  const res = await send("GET_SESSION_FOLDERS_TREE", {});
  renderFolders(res.tree, res.currentFolder, res.githubBasePath);
}

function renderRepoList(res) {
  const ul = $("repo-list");
  const crumb = $("repo-breadcrumb");
  if (!ul || !crumb) return;
  const prefix = res.path || "";
  repoBrowsePath = prefix;

  crumb.innerHTML = "";
  const parts = prefix ? prefix.split("/").filter(Boolean) : [];
  const homeBtn = document.createElement("button");
  homeBtn.type = "button";
  homeBtn.textContent = "(root)";
  homeBtn.addEventListener("click", () => browseRepo(""));
  crumb.appendChild(homeBtn);
  let acc = "";
  for (const p of parts) {
    crumb.appendChild(document.createTextNode(" / "));
    acc = acc ? acc + "/" + p : p;
    const segment = acc;
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = p;
    b.addEventListener("click", () => browseRepo(segment));
    crumb.appendChild(b);
  }

  ul.innerHTML = "";
  const items = res.items || [];
  const dirs = items.filter((it) => it.type === "dir").sort((a, b) => a.name.localeCompare(b.name));
  const files = items.filter((it) => it.type === "file").sort((a, b) => a.name.localeCompare(b.name));
  const ordered = dirs.concat(files);
  for (const it of ordered) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    const ico = document.createElement("span");
    ico.className = "repo-ico";
    ico.textContent = it.type === "dir" ? "\uD83D\uDCC1" : "\uD83D\uDCC4";
    const name = document.createElement("span");
    name.textContent = it.name;
    btn.appendChild(ico);
    btn.appendChild(name);
    if (it.type === "dir") {
      btn.addEventListener("click", () => browseRepo(it.path));
    } else {
      btn.disabled = true;
      btn.style.opacity = "0.75";
      btn.style.cursor = "default";
    }
    li.appendChild(btn);
    ul.appendChild(li);
  }
  if (!ordered.length) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.disabled = true;
    btn.textContent = "(empty)";
    li.appendChild(btn);
    ul.appendChild(li);
  }
}

async function browseRepo(pathPrefix) {
  setInlineStatus($("repo-status"), "Loading…", false);
  try {
    const res = await send("GITHUB_LIST_REPO_CONTENTS", {
      pathPrefix: pathPrefix || "",
    });
    renderRepoList(res);
    setInlineStatus($("repo-status"), "", false);
  } catch (e) {
    setInlineStatus($("repo-status"), String(e.message || e), true);
  }
}

async function loadAll() {
  try {
    const state = await send("GET_STATE", {});
    renderHostAccess(state);
    fillGithubForm(state);
    fillScriptsForm(state);
    await refreshFoldersOnly();
    setInlineStatus($("github-status"), state.githubSyncLastError ? "Last error: " + state.githubSyncLastError : "", !!state.githubSyncLastError);
    await browseRepo("");
  } catch (e) {
    setInlineStatus($("scripts-status"), String(e.message || e), true);
  }
}

$("btn-host-access").addEventListener("click", async function () {
  const btn = $("btn-host-access");
  if (btn.dataset.mode === "manage") {
    const id = chrome.runtime && chrome.runtime.id;
    const scheme =
      typeof navigator !== "undefined" && /Edg\//.test(navigator.userAgent)
        ? "edge://"
        : "chrome://";
    const url = id
      ? scheme + "extensions/?id=" + encodeURIComponent(id)
      : scheme + "extensions/";
    chrome.tabs.create({ url });
    return;
  }
  setInlineStatus($("scripts-status"), "Requesting permission…", false);
  try {
    const res = await send("REQUEST_HOST_ACCESS", {});
    const st = await send("GET_STATE", {});
    renderHostAccess(st);
    setInlineStatus(
      $("scripts-status"),
      res.granted ? "Website access granted." : "Permission not granted.",
      !res.granted
    );
  } catch (e) {
    setInlineStatus($("scripts-status"), String(e.message || e), true);
  }
});

$("btn-save-scripts").addEventListener("click", async function () {
  setInlineStatus($("scripts-status"), "Saving…", false);
  try {
    const url = $("field-script-source").value.trim();
    const extra = $("field-extra-urls").value;
    if (url) {
      await send("SET_SCRIPT_SOURCE_URL", { url });
    }
    await send("SET_EXTRA_SCRIPT_URLS", { text: extra });
    const st = await send("GET_STATE", {});
    fillScriptsForm(st);
    setInlineStatus($("scripts-status"), "Script sources saved and scripts refreshed.", false);
  } catch (e) {
    setInlineStatus($("scripts-status"), String(e.message || e), true);
  }
});

$("btn-refresh-scripts").addEventListener("click", async function () {
  setInlineStatus($("scripts-status"), "Refreshing…", false);
  try {
    await send("REFRESH_SCRIPTS", {});
    setInlineStatus($("scripts-status"), "Scripts refreshed.", false);
  } catch (e) {
    setInlineStatus($("scripts-status"), String(e.message || e), true);
  }
});

$("btn-save-github").addEventListener("click", async function () {
  setInlineStatus($("github-status"), "Saving…", false);
  try {
    await send("SET_GITHUB_SYNC_SETTINGS", {
      payload: {
        owner: $("field-gh-owner").value.trim(),
        repo: $("field-gh-repo").value.trim(),
        branch: $("field-gh-branch").value.trim() || "main",
        path: $("field-gh-path").value.trim(),
        token: $("field-gh-token").value.trim(),
      },
    });
    const st = await send("GET_STATE", {});
    fillGithubForm(st);
    setInlineStatus($("github-status"), "GitHub settings saved.", false);
    await refreshFoldersOnly();
  } catch (e) {
    setInlineStatus($("github-status"), String(e.message || e), true);
  }
});

$("btn-remove-token").addEventListener("click", async function () {
  if (!window.confirm("Remove the stored GitHub token from this browser profile?")) return;
  setInlineStatus($("github-status"), "Removing…", false);
  try {
    await send("REMOVE_GITHUB_TOKEN", {});
    const st = await send("GET_STATE", {});
    fillGithubForm(st);
    setInlineStatus($("github-status"), "Stored token removed.", false);
  } catch (e) {
    setInlineStatus($("github-status"), String(e.message || e), true);
  }
});

$("btn-gh-pull").addEventListener("click", async function () {
  setInlineStatus($("github-status"), "Pulling…", false);
  try {
    const res = await send("GITHUB_SESSIONS_PULL", {});
    if (res.ok === false) throw new Error(res.error || "Pull failed");
    const names = res.sessions || [];
    const w = res.pullWarnings || [];
    const warnSuffix = w.length ? " — warnings: " + w.join(" ") : "";
    setInlineStatus(
      $("github-status"),
      "Pull complete. Sessions: " +
        (names.length ? names.join(", ") : "(none)") +
        warnSuffix,
      !!w.length
    );
    await refreshFoldersOnly();
  } catch (e) {
    setInlineStatus($("github-status"), String(e.message || e), true);
  }
});

$("btn-gh-push").addEventListener("click", async function () {
  setInlineStatus($("github-status"), "Pushing…", false);
  try {
    const res = await send("GITHUB_SESSIONS_PUSH", {});
    if (res.ok === false) throw new Error(res.error || "Push failed");
    const names = res.sessions || [];
    setInlineStatus(
      $("github-status"),
      "Push complete. Sessions: " +
        (names.length ? names.join(", ") : "(none)"),
      false
    );
    await refreshFoldersOnly();
  } catch (e) {
    setInlineStatus($("github-status"), String(e.message || e), true);
  }
});

document.addEventListener("DOMContentLoaded", loadAll);
