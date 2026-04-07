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
  const root =
    state.githubSessionsRoot != null && String(state.githubSessionsRoot).trim() !== ""
      ? String(state.githubSessionsRoot).trim()
      : "";
  if (root) {
    $("field-gh-path").value = root;
  } else {
    const p = (state.githubPath || "").trim();
    if (/\.json$/i.test(p)) {
      const i = p.lastIndexOf("/");
      $("field-gh-path").value = i === -1 ? "" : p.slice(0, i);
    } else {
      $("field-gh-path").value = p || "sessions";
    }
  }
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

function renderFolders(tree, currentFolder, githubBasePath, defaultFilePath) {
  const tbody = $("folders-tbody");
  const active = $("active-folder-label");
  const baseLine = $("repo-browse-base");
  if (baseLine) {
    baseLine.textContent =
      "Sessions root: " +
      (githubBasePath || "(not set)") +
      " — default file: " +
      (defaultFilePath || joinSessionsRootFile(githubBasePath));
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
    inp.placeholder = "e.g. team-a (optional override)";
    inp.setAttribute("aria-label", "GitHub path override for " + key);
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

    const tdRemove = document.createElement("td");
    if (key !== "__default__") {
      const rm = document.createElement("button");
      rm.type = "button";
      rm.className = "btn small danger secondary";
      rm.textContent = "Remove…";
      rm.addEventListener("click", async function () {
        const label = key;
        if (
          !window.confirm(
            'Remove folder "' +
              label +
              '" from this browser? Sessions stored only in this folder here will be deleted.'
          )
        ) {
          return;
        }
        const alsoRemote = window.confirm(
          "Also delete this folder's donkeycode-sessions.json file on GitHub?\n\n" +
            "OK = remove the file from the repo\n" +
            "Cancel = keep the file on GitHub"
        );
        setInlineStatus($("folders-status"), "Removing…", false);
        try {
          const delRes = await send("DELETE_SESSION_FOLDER", {
            folderKey: key,
            deleteRemote: alsoRemote,
          });
          let msg = "Folder removed.";
          if (alsoRemote) {
            if (delRes.remoteDeleted) msg += " Remote file deleted.";
            else if (delRes.remoteError)
              msg += " GitHub: " + delRes.remoteError;
            else msg += " No remote file (already absent).";
          }
          setInlineStatus($("folders-status"), msg, !!(alsoRemote && delRes.remoteError));
          fillGithubForm(await send("GET_STATE", {}));
          await refreshFoldersOnly();
        } catch (e) {
          setInlineStatus($("folders-status"), String(e.message || e), true);
        }
      });
      tdRemove.appendChild(rm);
    } else {
      tdRemove.textContent = "—";
    }

    tr.appendChild(tdName);
    tr.appendChild(tdCount);
    tr.appendChild(tdPath);
    tr.appendChild(tdGo);
    tr.appendChild(tdRemove);
    tbody.appendChild(tr);
  }
}

function joinSessionsRootFile(root) {
  const r = (root || "").replace(/^\/+|\/+$/g, "");
  return r ? r + "/donkeycode-sessions.json" : "donkeycode-sessions.json";
}

async function refreshFoldersOnly() {
  const res = await send("GET_SESSION_FOLDERS_TREE", {});
  renderFolders(
    res.tree,
    res.currentFolder,
    res.githubBasePath,
    res.githubDefaultFilePath
  );
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
        sessionsRoot: $("field-gh-path").value.trim(),
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

$("btn-gh-push-all").addEventListener("click", async function () {
  setInlineStatus($("github-status"), "Pushing every folder…", false);
  try {
    const res = await send("GITHUB_SESSIONS_PUSH_ALL", {});
    if (res.ok === false) throw new Error(res.error || "Push failed");
    const names = res.sessions || [];
    const err = res.pushErrors || [];
    setInlineStatus(
      $("github-status"),
      "Push all done. Current folder sessions: " +
        (names.length ? names.join(", ") : "(none)") +
        (err.length ? " — issues: " + err.join(" ") : ""),
      !!err.length
    );
    await refreshFoldersOnly();
  } catch (e) {
    setInlineStatus($("github-status"), String(e.message || e), true);
  }
});

document.addEventListener("DOMContentLoaded", loadAll);
