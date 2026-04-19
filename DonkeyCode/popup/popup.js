/**
 * DonkeyCode popup — all actions use chrome.runtime.sendMessage only.
 */

/** Must match STORAGE.PENDING_FIRST_POPUP_REFRESH in background.js */
const PENDING_FIRST_POPUP_REFRESH = "donkeycode_pending_first_popup_refresh";

let firstPopupRefreshInflight = null;

function $(id) {
  return document.getElementById(id);
}

/** Avoid crashing the whole popup if HTML is missing nodes (stale unpack, edited HTML). */
function bindClick(id, handler) {
  const el = $(id);
  if (el) el.addEventListener("click", handler);
}

function bindChange(id, handler) {
  const el = $(id);
  if (el) el.addEventListener("change", handler);
}

function setStatus(text, isError) {
  const el = $("status");
  if (!el) return;
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

/** Appended to status after save/delete when background returns githubAutoSync. */
function githubAutoSyncSuffix(sync) {
  if (!sync || sync.skipped) return "";
  if (sync.ok) return " Synced to GitHub.";
  return " GitHub sync failed: " + (sync.error || "unknown") + " (saved locally.)";
}

function switchTab(name) {
  document.querySelectorAll(".tab").forEach((btn) => {
    const on = btn.dataset.tab === name;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-selected", on ? "true" : "false");
  });
  const pr = $("panel-report");
  $("panel-sessions").hidden = name !== "sessions";
  $("panel-scripts").hidden = name !== "scripts";
  if (pr) pr.hidden = name !== "report";
  $("panel-sessions").classList.toggle("active", name === "sessions");
  $("panel-scripts").classList.toggle("active", name === "scripts");
  if (pr) pr.classList.toggle("active", name === "report");
}

/** Display INC as a 7-digit zero-padded code (GitHub issue #42 → 0000042). */
function formatIncCode(issueNumber) {
  const n = Number(issueNumber);
  if (!Number.isFinite(n) || n < 0) return String(issueNumber);
  const s = String(Math.floor(n));
  return s.length >= 7 ? s : s.padStart(7, "0");
}

function updateReportPanel(state) {
  const btn = $("btn-submit-report");
  const lead = document.querySelector(".report-lead");
  if (!btn) return;
  const hasGh =
    state &&
    (state.githubTokenConfigured || state.githubBakedIn) &&
    state.githubOwner &&
    String(state.githubOwner).trim() &&
    state.githubRepo &&
    String(state.githubRepo).trim();
  btn.disabled = !hasGh;
  btn.title = hasGh
    ? "Create a GitHub Issue and get an issue # as your INC reference"
    : "Configure GitHub owner, repo, and token in Settings (PAT needs Issues permission)";
  if (lead && !hasGh) {
    lead.classList.add("report-lead--warn");
  } else if (lead) {
    lead.classList.remove("report-lead--warn");
  }
}

async function submitIssueReport() {
  const titleEl = $("report-title");
  const bodyEl = $("report-body");
  const out = $("report-result");
  const title = titleEl ? titleEl.value.trim() : "";
  if (!title) {
    setStatus("Enter a title for the report.", true);
    return;
  }
  const body = bodyEl ? bodyEl.value.trim() : "";
  setStatus("Submitting report…");
  try {
    const res = await send("REPORT_GITHUB_ISSUE", {
      title,
      body,
      labels: [],
    });
    const num = res.issueNumber;
    const incDisp = formatIncCode(num);
    const url = res.issueUrl || "";
    if (out) {
      out.classList.remove("hidden");
      out.innerHTML = "";
      const strong = document.createElement("strong");
      strong.textContent = "INC #" + incDisp;
      out.appendChild(strong);
      out.appendChild(
        document.createTextNode(
          " (GitHub #" +
            num +
            ") — reference this when following up."
        )
      );
      if (url) {
        out.appendChild(document.createElement("br"));
        const a = document.createElement("a");
        a.href = url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = "Open issue on GitHub";
        out.appendChild(a);
      }
    }
    setStatus("Report filed: INC #" + incDisp + ".");
    if (titleEl) titleEl.value = "";
    if (bodyEl) bodyEl.value = "";
  } catch (e) {
    console.error("[DonkeyCode:popup] report issue", e);
    const msg = String(e.message || e);
    if (out) {
      out.classList.remove("hidden");
      const hint = githubApiErrorHint(msg);
      out.textContent = hint || msg;
    }
    setStatus(msg, true);
  }
}

/** Friendly line when GitHub returns permission errors. */
function githubApiErrorHint(msg) {
  const m = String(msg || "").toLowerCase();
  if (m.indexOf("resource not accessible") !== -1 || m.indexOf("403") !== -1) {
    return (
      msg +
      " Check that your token can create issues (classic PAT: include the `issues` scope or use `repo` scope)."
    );
  }
  return "";
}

let editingSessionName = null;

/** Script user-prefs modal */
let scriptPrefsEditingId = null;
/** @type {object|null} */
let scriptPrefsEditingScript = null;

/** Pending save after worksheet order modal */
let saveSessionPendingName = null;
let saveSessionPendingSnapshot = null;
/** Permutation of worksheet window indices (user order) */
let worksheetOrderIndices = null;

const WS_HOST = "opssuitemain.swacorp.com";
const WS_PATH = "/widgets/worksheet";

function isOpsSuiteWorksheetUrl(url) {
  if (!url || typeof url !== "string") return false;
  try {
    const u = new URL(url);
    return (
      u.hostname === WS_HOST &&
      u.pathname.toLowerCase().indexOf(WS_PATH) !== -1
    );
  } catch (e) {
    return false;
  }
}

function windowHasWorksheet(w) {
  for (const t of w.tabs || []) {
    if (isOpsSuiteWorksheetUrl(t.url)) return true;
  }
  return false;
}

function worksheetPrimaryLabel(w) {
  for (const t of w.tabs || []) {
    if (isOpsSuiteWorksheetUrl(t.url)) {
      const tit = t.title != null ? String(t.title).trim() : "";
      if (tit) return tit;
      const u = String(t.url || "");
      return u.length > 92 ? u.slice(0, 89) + "…" : u;
    }
  }
  return "";
}

/**
 * userOrderedIndices: worksheet window indices in desired open order (permutation of worksheet indices).
 */
function applyWorksheetOrderToSnapshot(snapshot, userOrderedIndices) {
  const wins = snapshot.windows || [];
  const n = wins.length;
  const wsSet = new Set();
  for (let i = 0; i < n; i++) {
    if (windowHasWorksheet(wins[i])) wsSet.add(i);
  }
  const wsQueue = userOrderedIndices.map(function (idx) {
    return wins[idx];
  });
  const nonWsQueue = [];
  for (let i = 0; i < n; i++) {
    if (!wsSet.has(i)) nonWsQueue.push(wins[i]);
  }
  const newWindows = [];
  let wq = 0;
  let nq = 0;
  for (let i = 0; i < n; i++) {
    if (wsSet.has(i)) {
      newWindows.push(wsQueue[wq++]);
    } else {
      newWindows.push(nonWsQueue[nq++]);
    }
  }
  const staggerEl = $("worksheet-stagger-ms");
  const staggerRaw = staggerEl ? parseInt(String(staggerEl.value || "800"), 10) : 800;
  const stagger = Number.isFinite(staggerRaw) ? Math.max(0, staggerRaw) : 800;
  const meta = Object.assign({}, snapshot._meta || {}, {
    worksheetStaggerMs: stagger,
  });
  return {
    windows: newWindows.map(function (w, wi) {
      const o = Object.assign({}, w);
      o.restoreOrder = wi;
      return o;
    }),
    _meta: meta,
  };
}

function openWorksheetOrderModal(name, snapshot, worksheetWindowIndices) {
  const list = $("worksheet-order-list");
  const ov = $("worksheet-order-overlay");
  if (!list || !ov) {
    return false;
  }
  saveSessionPendingName = name;
  saveSessionPendingSnapshot = snapshot;
  worksheetOrderIndices = worksheetWindowIndices.slice();
  const prevStagger =
    list.children.length > 0 && $("worksheet-stagger-ms")
      ? $("worksheet-stagger-ms").value
      : null;
  list.innerHTML = "";
  worksheetOrderIndices.forEach(function (winIdx, pos) {
    const w = snapshot.windows[winIdx];
    const li = document.createElement("li");
    const label = document.createElement("span");
    label.className = "ws-url";
    label.textContent = (pos + 1) + ". " + (worksheetPrimaryLabel(w) || "Worksheet window");
    const actions = document.createElement("div");
    actions.className = "ws-actions";
    const up = document.createElement("button");
    up.type = "button";
    up.textContent = "↑";
    up.title = "Move up";
    up.addEventListener("click", function () {
      if (pos <= 0) return;
      const t = worksheetOrderIndices[pos - 1];
      worksheetOrderIndices[pos - 1] = worksheetOrderIndices[pos];
      worksheetOrderIndices[pos] = t;
      openWorksheetOrderModal(name, snapshot, worksheetOrderIndices);
    });
    const down = document.createElement("button");
    down.type = "button";
    down.textContent = "↓";
    down.title = "Move down";
    down.addEventListener("click", function () {
      if (pos >= worksheetOrderIndices.length - 1) return;
      const t = worksheetOrderIndices[pos + 1];
      worksheetOrderIndices[pos + 1] = worksheetOrderIndices[pos];
      worksheetOrderIndices[pos] = t;
      openWorksheetOrderModal(name, snapshot, worksheetOrderIndices);
    });
    actions.appendChild(up);
    actions.appendChild(down);
    li.appendChild(label);
    li.appendChild(actions);
    list.appendChild(li);
  });
  const stagger = $("worksheet-stagger-ms");
  if (stagger) {
    if (prevStagger != null && prevStagger !== "") {
      stagger.value = prevStagger;
    } else {
      const m = snapshot._meta && snapshot._meta.worksheetStaggerMs;
      stagger.value =
        typeof m === "number" && Number.isFinite(m) ? String(m) : "800";
    }
  }
  ov.classList.remove("hidden");
  ov.setAttribute("aria-hidden", "false");
  return true;
}

function closeWorksheetOrderModal() {
  const ov = $("worksheet-order-overlay");
  if (ov) {
    ov.classList.add("hidden");
    ov.setAttribute("aria-hidden", "true");
  }
  saveSessionPendingName = null;
  saveSessionPendingSnapshot = null;
  worksheetOrderIndices = null;
}

async function confirmWorksheetOrderSave() {
  const name = saveSessionPendingName;
  const snap = saveSessionPendingSnapshot;
  const order = worksheetOrderIndices;
  if (!name || !snap || !order) return;
  const finalSnap = applyWorksheetOrderToSnapshot(snap, order);
  closeWorksheetOrderModal();
  setStatus("Saving session…");
  try {
    const res = await send("SAVE_SESSION", { name, snapshot: finalSnap });
    $("session-name").value = "";
    renderSessions(res.sessions || []);
    setStatus('Session "' + name + '" saved.' + githubAutoSyncSuffix(res.githubAutoSync));
  } catch (e) {
    console.error("[DonkeyCode:popup]", e);
    setStatus(String(e.message || e), true);
  }
}

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

function setTabVersions(version) {
  const v = (version && String(version).trim()) || "";
  const sub = $("header-sub-version");
  if (sub) sub.textContent = v ? v : "";
}

/** Script prefs (GitHub) only apply to named session folders, not Default. */
function updateScriptPrefsButtons(state) {
  const cur = state && state.currentSessionFolder;
  const isDefault = !cur || cur === "__default__";
  const pull = $("btn-pull-script-prefs-github");
  const push = $("btn-push-script-prefs-github");
  if (pull) {
    pull.disabled = isDefault;
    pull.title = isDefault
      ? "Pick a named session folder (not Default) to load script prefs from GitHub."
      : "Load script on/off from GitHub for this session folder (does not refresh script list)";
  }
  if (push) {
    push.disabled = isDefault;
    push.title = isDefault
      ? "Pick a named session folder (not Default) to save script prefs to GitHub."
      : "Save script on/off to GitHub for this session folder";
  }
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

async function renameSessionFromPopup(oldName) {
  const next = window.prompt("Rename saved session:", oldName);
  if (next == null) return;
  const t = next.trim();
  if (!t || t === oldName) return;
  setStatus("Renaming session…");
  try {
    const res = await send("RENAME_SESSION", { oldName: oldName, newName: t });
    renderSessions(res.sessions || []);
    syncLoginFirstSelect(res.sessions || []);
    updatePendingBanner({ pendingRestoreSession: res.pendingRestoreSession });
    setStatus(
      'Session renamed to "' + t + '".' + githubAutoSyncSuffix(res.githubAutoSync)
    );
  } catch (e) {
    console.error("[DonkeyCode:popup] rename session", e);
    setStatus(String(e.message || e), true);
  }
}

async function renameSessionFolderFromPopup(oldKey) {
  const next = window.prompt(
    "Rename folder (use / for nested paths, e.g. team/ops):",
    oldKey
  );
  if (next == null) return;
  const t = next.trim();
  if (!t || t === oldKey) return;
  setStatus("Renaming folder…");
  try {
    const res = await send("RENAME_SESSION_FOLDER", {
      oldFolderKey: oldKey,
      newFolderKey: t,
    });
    fillSessionFolderUI(res);
    renderSessions(res.sessions || []);
    syncLoginFirstSelect(res.sessions || []);
    updatePendingBanner(res);
    updateScriptPrefsButtons(res);
    const inp = $("folder-picker-filter");
    renderFolderPickerList(inp ? inp.value : "");
    const fk = res.currentSessionFolder || "__default__";
    setStatus(
      'Folder renamed to "' +
        (fk === "__default__" ? "Default" : fk) +
        '".' +
        githubAutoSyncSuffix(res.githubAutoSync)
    );
  } catch (e) {
    console.error("[DonkeyCode:popup] rename folder", e);
    setStatus(String(e.message || e), true);
  }
}

async function switchSessionFolder(folderKey) {
  const v = (folderKey || "").trim();
  if (!v) return;
  setStatus("Switching folder…");
  try {
    const res = await send("SET_CURRENT_SESSION_FOLDER", { folderKey: v });
    fillSessionFolderUI(res);
    renderSessions(res.sessions || []);
    syncLoginFirstSelect(res.sessions || []);
    const pe = res.folderPullError;
    if (pe) {
      setStatus(
        'Folder "' +
          (v === "__default__" ? "Default" : v) +
          '". Cloud sync note: ' +
          pe,
        true
      );
    } else {
      setStatus('Folder: "' + (v === "__default__" ? "Default" : v) + '".');
    }
  } catch (e) {
    console.error("[DonkeyCode:popup]", e);
    setStatus(String(e.message || e), true);
    await loadState();
  }
}

/** Updated on each loadState for folder browser modal */
let lastFolderPickerState = null;
/** Paths like "a/b" expanded in folder tree (disclosure open) */
const folderPickerExpandedPaths = new Set();

function fillSessionFolderUI(state) {
  lastFolderPickerState = state;
  const labelEl = $("session-folder-current-label");
  const cur = state.currentSessionFolder || "__default__";
  if (labelEl) {
    labelEl.textContent = cur === "__default__" ? "Default" : cur;
    labelEl.title = cur === "__default__" ? "Default (__default__)" : cur;
  }
  updateScriptPrefsButtons(state);
}

function closeFolderPickerModal() {
  const ov = $("folder-picker-overlay");
  const inp = $("folder-picker-filter");
  if (inp) inp.value = "";
  if (ov) {
    ov.classList.add("hidden");
    ov.setAttribute("aria-hidden", "true");
  }
}

function folderPathSort(a, b) {
  if (a === "__default__") return -1;
  if (b === "__default__") return 1;
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

function folderKeyMatchesFilter(fk, relMap, q) {
  if (!q) return true;
  const hay = (fk + " " + (relMap[fk] || "")).toLowerCase();
  return hay.indexOf(q) !== -1;
}

function buildSessionFolderTree(folderKeys) {
  const root = { children: {} };
  for (const fk of folderKeys) {
    if (fk === "__default__") continue;
    const parts = fk.split("/").filter(Boolean);
    let parent = root;
    for (let i = 0; i < parts.length; i++) {
      const seg = parts[i];
      if (!parent.children[seg]) {
        parent.children[seg] = { segment: seg, folderKey: null, children: {} };
      }
      const cur = parent.children[seg];
      if (i === parts.length - 1) {
        cur.folderKey = fk;
      }
      parent = cur;
    }
  }
  return root;
}

function subtreeMatchesFilter(node, pathPrefix, relMap, q) {
  if (!q) return true;
  if (node.folderKey && folderKeyMatchesFilter(node.folderKey, relMap, q)) {
    return true;
  }
  const keys = Object.keys(node.children);
  for (const seg of keys) {
    const child = node.children[seg];
    const fp = pathPrefix ? pathPrefix + "/" + seg : seg;
    if (folderKeyMatchesFilter(fp, relMap, q)) return true;
    if (subtreeMatchesFilter(child, fp, relMap, q)) return true;
  }
  return false;
}

function expandAncestorsForFilter(node, pathPrefix, relMap, q) {
  if (!q) return;
  const keys = Object.keys(node.children);
  for (const seg of keys) {
    const child = node.children[seg];
    const fp = pathPrefix ? pathPrefix + "/" + seg : seg;
    if (subtreeMatchesFilter(child, fp, relMap, q)) {
      folderPickerExpandedPaths.add(fp);
    }
    expandAncestorsForFilter(child, fp, relMap, q);
  }
}

function expandAncestorsOfCurrentFolder(cur) {
  if (!cur || cur === "__default__") return;
  const parts = cur.split("/").filter(Boolean);
  let acc = "";
  for (let i = 0; i < parts.length - 1; i++) {
    acc = acc ? acc + "/" + parts[i] : parts[i];
    folderPickerExpandedPaths.add(acc);
  }
}

function renderFolderPickerList(filterText) {
  const ul = $("folder-picker-list");
  const state = lastFolderPickerState;
  if (!ul || !state) return;
  const folders = (state.sessionFolders || ["__default__"]).slice().sort(folderPathSort);
  const cur = state.currentSessionFolder || "__default__";
  const relMap = state.folderGithubRelativePaths || {};
  const q = (filterText || "").trim().toLowerCase();
  ul.innerHTML = "";

  const defaultMatches = folderKeyMatchesFilter("__default__", relMap, q);
  const tree = buildSessionFolderTree(folders);
  if (q) {
    expandAncestorsForFilter(tree, "", relMap, q);
  } else {
    expandAncestorsOfCurrentFolder(cur);
  }

  let anyShown = false;

  if (defaultMatches) {
    anyShown = true;
    const li = document.createElement("li");
    li.className = "folder-picker-tree-li";
    li.appendChild(
      makeFolderPickerRow({
        folderKey: "__default__",
        label: "Default",
        depth: 0,
        hasChildren: false,
        expanded: false,
        cur,
        relMap,
        onToggle: function () {},
      })
    );
    ul.appendChild(li);
  }

  const childKeys = Object.keys(tree.children).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" })
  );
  for (const seg of childKeys) {
    const child = tree.children[seg];
    if (!subtreeMatchesFilter(child, seg, relMap, q)) continue;
    anyShown = true;
    renderFolderTreeBranch(ul, child, seg, cur, relMap, q, 0);
  }

  if (!anyShown) {
    const li = document.createElement("li");
    const empty = document.createElement("p");
    empty.className = "hint";
    empty.style.margin = "12px";
    empty.textContent = q ? "No folders match your filter." : "No folders.";
    li.appendChild(empty);
    ul.appendChild(li);
  }
}

function makeFolderPickerRow(opts) {
  const {
    folderKey,
    label,
    depth,
    hasChildren,
    expanded,
    cur,
    relMap,
    onToggle,
  } = opts;
  const row = document.createElement("div");
  row.className = "folder-tree-row";
  row.style.paddingLeft = 4 + depth * 14 + "px";

  if (hasChildren) {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "folder-tree-toggle";
    toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
    toggle.setAttribute("aria-label", expanded ? "Collapse" : "Expand");
    toggle.textContent = expanded ? "\u25BC" : "\u25B6";
    toggle.addEventListener("click", function (ev) {
      ev.stopPropagation();
      onToggle();
    });
    row.appendChild(toggle);
  } else {
    const sp = document.createElement("span");
    sp.className = "folder-tree-toggle-spacer";
    sp.setAttribute("aria-hidden", "true");
    row.appendChild(sp);
  }

  const selectWrap = document.createElement("div");
  selectWrap.className = "folder-tree-select-wrap";

  if (folderKey) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "folder-picker-item folder-tree-select" + (folderKey === cur ? " active" : "");
    btn.dataset.folderKey = folderKey;
    const pathSpan = document.createElement("span");
    pathSpan.className = "folder-picker-path";
    pathSpan.textContent = label;
    btn.appendChild(pathSpan);
    const override = (relMap[folderKey] || "").trim();
    if (override && folderKey !== "__default__") {
      const meta = document.createElement("span");
      meta.className = "folder-picker-meta";
      meta.textContent = "Git: " + override;
      btn.appendChild(meta);
    }
    btn.addEventListener("click", async function () {
      closeFolderPickerModal();
      if (folderKey !== cur) await switchSessionFolder(folderKey);
    });
    selectWrap.appendChild(btn);
    if (folderKey && folderKey !== "__default__") {
      const renameBtn = document.createElement("button");
      renameBtn.type = "button";
      renameBtn.className = "folder-tree-rename";
      renameBtn.setAttribute("aria-label", "Rename folder");
      renameBtn.title = "Rename folder";
      renameBtn.textContent = "\u270E";
      renameBtn.addEventListener("click", function (ev) {
        ev.stopPropagation();
        renameSessionFolderFromPopup(folderKey);
      });
      selectWrap.appendChild(renameBtn);
    }
  } else {
    const span = document.createElement("span");
    span.className = "folder-tree-label-only";
    span.textContent = label;
    selectWrap.appendChild(span);
  }

  row.appendChild(selectWrap);
  return row;
}

function renderFolderTreeBranch(ul, node, pathPrefix, cur, relMap, q, depth) {
  const childSegKeys = Object.keys(node.children);
  const hasChildren = childSegKeys.length > 0;
  const expanded = folderPickerExpandedPaths.has(pathPrefix);
  const canSelect = !!node.folderKey;

  const li = document.createElement("li");
  li.className = "folder-picker-tree-li";

  li.appendChild(
    makeFolderPickerRow({
      folderKey: canSelect ? node.folderKey : null,
      label: node.segment,
      depth,
      hasChildren,
      expanded,
      cur,
      relMap,
      onToggle: function () {
        if (folderPickerExpandedPaths.has(pathPrefix)) {
          folderPickerExpandedPaths.delete(pathPrefix);
        } else {
          folderPickerExpandedPaths.add(pathPrefix);
        }
        const inp = $("folder-picker-filter");
        renderFolderPickerList(inp ? inp.value : "");
      },
    })
  );

  if (hasChildren && expanded) {
    const subUl = document.createElement("ul");
    subUl.className = "folder-picker-subtree";
    const sorted = childSegKeys.sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" })
    );
    for (const seg of sorted) {
      const child = node.children[seg];
      const fp = pathPrefix + "/" + seg;
      if (!subtreeMatchesFilter(child, fp, relMap, q)) continue;
      renderFolderTreeBranch(subUl, child, fp, cur, relMap, q, depth + 1);
    }
    if (subUl.children.length) {
      li.appendChild(subUl);
    }
  }

  ul.appendChild(li);
}

function openFolderPickerModal() {
  const ov = $("folder-picker-overlay");
  const inp = $("folder-picker-filter");
  if (!ov) return;
  ov.classList.remove("hidden");
  ov.setAttribute("aria-hidden", "false");
  renderFolderPickerList(inp ? inp.value : "");
  if (inp) {
    inp.focus();
    inp.select();
  }
}

async function maybeInitialGithubFolderDiscover(state) {
  if (!state || !state.pendingInitialFolderDiscover) return;
  const hasGh =
    (state.githubOwner && String(state.githubOwner).trim()) &&
    (state.githubRepo && String(state.githubRepo).trim()) &&
    (state.githubTokenConfigured || state.githubBakedIn);
  if (!hasGh) {
    try {
      await send("CONSUMED_INITIAL_FOLDER_DISCOVER", {});
    } catch (e) {
      /* ignore */
    }
    return;
  }
  const prevStatus = $("status") ? $("status").textContent : "";
  setStatus("Discovering session folders from GitHub…");
  try {
    const discRes = await send("GITHUB_DISCOVER_SESSION_FOLDERS", {});
    try {
      await send("CONSUMED_INITIAL_FOLDER_DISCOVER", {});
    } catch (e2) {
      /* ignore */
    }
    const st2 = await send("GET_STATE", {});
    fillSessionFolderUI(st2);
    renderSessions(st2.sessions || []);
    syncLoginFirstSelect(st2.sessions || []);
    updatePendingBanner(st2);
    const nf = (discRes && discRes.newLocalFolders) || [];
    if (nf.length) {
      setStatus("Added folders from GitHub: " + nf.join(", ") + ".");
    } else if (prevStatus && !state.stateLoadError) {
      setStatus(prevStatus);
    } else if (!state.stateLoadError) {
      setStatus("");
    }
  } catch (e) {
    console.error("[DonkeyCode:popup] initial folder discover", e);
    try {
      await send("CONSUMED_INITIAL_FOLDER_DISCOVER", {});
    } catch (e3) {
      /* ignore */
    }
    if (!state.stateLoadError) setStatus(prevStatus || "");
  }
}

async function maybeInitialGithubSessionPull(state) {
  if (!state || !state.pendingInitialSessionPull) return;
  const hasGh =
    (state.githubOwner && String(state.githubOwner).trim()) &&
    (state.githubRepo && String(state.githubRepo).trim()) &&
    (state.githubTokenConfigured || state.githubBakedIn);
  if (!hasGh) {
    try {
      await send("CONSUMED_INITIAL_SESSION_PULL", {});
    } catch (e) {
      /* ignore */
    }
    return;
  }
  setStatus("Syncing sessions from GitHub…");
  try {
    const pullRes = await send("GITHUB_SESSIONS_PULL", {});
    try {
      await send("CONSUMED_INITIAL_SESSION_PULL", {});
    } catch (e2) {
      /* ignore */
    }
    const st2 = await send("GET_STATE", {});
    fillSessionFolderUI(st2);
    renderSessions(st2.sessions || []);
    syncLoginFirstSelect(st2.sessions || []);
    updatePendingBanner(st2);
    const { text, isErr } = formatGithubSyncStatus("Sessions synced from GitHub.", pullRes);
    setStatus(text, isErr);
  } catch (e) {
    console.error("[DonkeyCode:popup] initial session pull", e);
    try {
      await send("CONSUMED_INITIAL_SESSION_PULL", {});
    } catch (e3) {
      /* ignore */
    }
    setStatus(String(e.message || e), true);
  }
}

function updateSessionZoomToggle(state) {
  const el = $("chk-session-save-zoom");
  if (!el || !state) return;
  el.checked = state.sessionSaveZoomPerTab !== false;
}

async function loadState() {
  setStatus("Loading…");
  try {
    const state = await send("GET_STATE", {});
    if (state.stateLoadError) {
      setStatus(
        "Could not read all saved data — lists may be empty. " + state.stateLoadError,
        true
      );
    }
    const lf = $("last-fetch");
    if (lf) {
      lf.textContent = state.lastScriptFetch
        ? "Last fetch: " + formatTime(state.lastScriptFetch)
        : "No fetch yet — open settings (gear) and refresh.";
    }

    setTabVersions(state.extensionVersion || "");
    updateSetupBanner(state);
    updatePendingBanner(state);
    fillSessionFolderUI(state);
    renderSessions(state.sessions || []);
    syncLoginFirstSelect(state.sessions || []);
    renderScripts(Array.isArray(state.scripts) ? state.scripts : []);
    updateSessionZoomToggle(state);
    updateReportPanel(state);
    if (!state.stateLoadError) setStatus("");

    await runFirstPopupRefreshIfNeeded();
    await maybeInitialGithubFolderDiscover(state);
    await maybeInitialGithubSessionPull(state);
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
        fillSessionFolderUI(st2);
        renderSessions(st2.sessions || []);
        syncLoginFirstSelect(st2.sessions || []);
        updatePendingBanner(st2);
        updateReportPanel(st2);
        switchTab("sessions");
        setStatus("Scripts and sessions loaded.");
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
  if (!ul) return;
  ul.innerHTML = "";
  if (!names.length) {
    if (empty) empty.classList.remove("hidden");
    return;
  }
  if (empty) empty.classList.add("hidden");
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

    const btnRename = document.createElement("button");
    btnRename.type = "button";
    btnRename.className = "btn-icon secondary";
    btnRename.textContent = "\u270E";
    btnRename.setAttribute("aria-label", "Rename session");
    btnRename.title = "Rename session";
    btnRename.addEventListener("click", () => renameSessionFromPopup(name));

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
    actions.appendChild(btnRename);
    actions.appendChild(btnLaunch);
    actions.appendChild(btnDelete);
    li.appendChild(span);
    li.appendChild(actions);
    ul.appendChild(li);
  }
}

function scriptDisplayName(s) {
  return (
    (s.userScriptName && String(s.userScriptName).trim()) ||
    s.name ||
    s.url ||
    "Script"
  );
}

function scriptRowTooltip(s) {
  const desc = s && s.userScriptDescription && String(s.userScriptDescription).trim();
  if (desc) return desc;
  const u = s && s.url ? String(s.url) : "";
  return u ? "Source: " + u : "";
}

function scriptHasPrefSchema(s) {
  const sch = s && s.donkeycodePrefSchema;
  return sch && typeof sch === "object" && !Array.isArray(sch) && Object.keys(sch).length > 0;
}

function getPrefSchemaKeys(schema) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return [];
  return Object.keys(schema).sort(function (a, b) {
    return a.localeCompare(b, undefined, { sensitivity: "base" });
  });
}

function getPrefGroupLabel(spec) {
  const raw = spec && spec.group != null ? String(spec.group).trim() : "";
  return raw || "General";
}

function appendOnePrefField(wrap, key, spec, vals) {
  const typ = normalizePrefType(spec);
  const labelText = spec.label ? String(spec.label) : key;
  const hint = spec.description || spec.hint ? String(spec.description || spec.hint) : "";
  const def = Object.prototype.hasOwnProperty.call(spec, "default") ? spec.default : undefined;
  const current = Object.prototype.hasOwnProperty.call(vals, key) ? vals[key] : def;

  if (typ === "boolean") {
    const row = document.createElement("div");
    row.className = "script-prefs-field-row";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "script-prefs-input";
    cb.id = "script-pref-" + key;
    cb.dataset.prefKey = key;
    cb.dataset.prefType = "boolean";
    cb.checked = current === true || current === "true";
    const lab = document.createElement("label");
    lab.className = "script-prefs-field-label";
    lab.htmlFor = cb.id;
    lab.textContent = labelText;
    row.appendChild(cb);
    row.appendChild(lab);
    wrap.appendChild(row);
    if (hint) {
      const hi = document.createElement("span");
      hi.className = "script-prefs-field-hint";
      hi.textContent = hint;
      wrap.appendChild(hi);
    }
  } else if (typ === "select") {
    const lab = document.createElement("label");
    lab.className = "script-prefs-field-label";
    lab.htmlFor = "script-pref-" + key;
    lab.textContent = labelText;
    wrap.appendChild(lab);
    const sel = document.createElement("select");
    sel.className = "script-prefs-input";
    sel.id = "script-pref-" + key;
    sel.dataset.prefKey = key;
    sel.dataset.prefType = "select";
    const opts = Array.isArray(spec.options) ? spec.options : [];
    if (opts.length === 0) {
      const o = document.createElement("option");
      o.value = "";
      o.textContent = "(no options in schema)";
      sel.appendChild(o);
      sel.disabled = true;
    } else {
      opts.forEach(function (opt) {
        const o = document.createElement("option");
        if (opt && typeof opt === "object") {
          o.value = opt.value != null ? String(opt.value) : "";
          o.textContent = opt.label != null ? String(opt.label) : o.value;
        } else {
          o.value = String(opt);
          o.textContent = String(opt);
        }
        sel.appendChild(o);
      });
      const strCur = current != null ? String(current) : "";
      let matched = false;
      for (let i = 0; i < sel.options.length; i++) {
        if (sel.options[i].value === strCur) {
          matched = true;
          break;
        }
      }
      sel.value = matched ? strCur : sel.options[0] ? sel.options[0].value : "";
    }
    wrap.appendChild(sel);
    if (hint) {
      const hi = document.createElement("span");
      hi.className = "script-prefs-field-hint";
      hi.textContent = hint;
      wrap.appendChild(hi);
    }
  } else if (typ === "number") {
    const lab = document.createElement("label");
    lab.className = "script-prefs-field-label";
    lab.htmlFor = "script-pref-" + key;
    lab.textContent = labelText;
    wrap.appendChild(lab);
    const inp = document.createElement("input");
    inp.type = "number";
    inp.className = "script-prefs-input";
    inp.id = "script-pref-" + key;
    inp.dataset.prefKey = key;
    inp.dataset.prefType = "number";
    if (spec.min != null && !Number.isNaN(Number(spec.min))) inp.min = String(spec.min);
    if (spec.max != null && !Number.isNaN(Number(spec.max))) inp.max = String(spec.max);
    if (spec.step != null && !Number.isNaN(Number(spec.step))) inp.step = String(spec.step);
    else inp.step = "any";
    const num =
      typeof current === "number"
        ? current
        : current != null && String(current).trim() !== ""
          ? parseFloat(String(current))
          : def != null && typeof def === "number"
            ? def
            : def != null && String(def).trim() !== ""
              ? parseFloat(String(def))
              : "";
    inp.value = Number.isFinite(num) ? String(num) : "";
    if (spec.placeholder) inp.placeholder = String(spec.placeholder);
    wrap.appendChild(inp);
    if (hint) {
      const hi = document.createElement("span");
      hi.className = "script-prefs-field-hint";
      hi.textContent = hint;
      wrap.appendChild(hi);
    }
  } else {
    const lab = document.createElement("label");
    lab.className = "script-prefs-field-label";
    lab.htmlFor = "script-pref-" + key;
    lab.textContent = labelText;
    wrap.appendChild(lab);
    const inp = document.createElement("input");
    inp.type = typ === "url" ? "url" : "text";
    inp.className = "script-prefs-input";
    inp.id = "script-pref-" + key;
    inp.dataset.prefKey = key;
    inp.dataset.prefType = typ === "url" ? "url" : "string";
    inp.value = current != null ? String(current) : def != null ? String(def) : "";
    if (spec.placeholder) inp.placeholder = String(spec.placeholder);
    if (spec.maxlength != null) inp.maxLength = Math.min(2048, Math.max(1, parseInt(String(spec.maxlength), 10) || 512));
    wrap.appendChild(inp);
    if (hint) {
      const hi = document.createElement("span");
      hi.className = "script-prefs-field-hint";
      hi.textContent = hint;
      wrap.appendChild(hi);
    }
  }
}

function groupPrefKeysByGroup(schema) {
  const map = {};
  const keys = getPrefSchemaKeys(schema);
  keys.forEach(function (key) {
    const spec = schema[key] && typeof schema[key] === "object" && !Array.isArray(schema[key]) ? schema[key] : {};
    const g = getPrefGroupLabel(spec);
    if (!map[g]) map[g] = [];
    map[g].push(key);
  });
  return map;
}

function sortGroupNames(names) {
  const copy = names.slice();
  copy.sort(function (a, b) {
    if (a === "General") return -1;
    if (b === "General") return 1;
    return a.localeCompare(b, undefined, { sensitivity: "base" });
  });
  return copy;
}

function normalizePrefType(spec) {
  const t = spec && spec.type != null ? String(spec.type).toLowerCase().trim() : "string";
  if (t === "bool") return "boolean";
  if (t === "int" || t === "integer" || t === "float" || t === "double") return "number";
  if (t === "dropdown" || t === "enum") return "select";
  return t;
}

function buildScriptPrefsFormFields(container, s) {
  if (!container) return;
  container.innerHTML = "";
  const schema = (s.donkeycodePrefSchema && typeof s.donkeycodePrefSchema === "object" && !Array.isArray(s.donkeycodePrefSchema))
    ? s.donkeycodePrefSchema
    : {};
  const vals =
    s.userPrefs && typeof s.userPrefs === "object" && !Array.isArray(s.userPrefs) ? s.userPrefs : {};
  const keys = getPrefSchemaKeys(schema);
  if (keys.length === 0) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = "No preference keys in this script’s schema.";
    container.appendChild(p);
    return;
  }
  const byGroup = groupPrefKeysByGroup(schema);
  const groupNames = sortGroupNames(Object.keys(byGroup));
  groupNames.forEach(function (groupName) {
    const groupKeys = byGroup[groupName] || [];
    if (!groupKeys.length) return;
    const heading = document.createElement("div");
    heading.className = "script-prefs-group-heading";
    heading.textContent = groupName;
    container.appendChild(heading);
    groupKeys.forEach(function (key) {
      const spec = schema[key] && typeof schema[key] === "object" && !Array.isArray(schema[key]) ? schema[key] : {};
      const wrap = document.createElement("div");
      wrap.className = "script-prefs-field";
      appendOnePrefField(wrap, key, spec, vals);
      container.appendChild(wrap);
    });
  });
}

function readScriptPrefsFormValues(container, schema) {
  const out = {};
  if (!container || !schema || typeof schema !== "object") return out;
  const inputs = container.querySelectorAll("[data-pref-key]");
  inputs.forEach(function (el) {
    const key = el.dataset.prefKey;
    if (!key) return;
    const spec = schema[key] && typeof schema[key] === "object" ? schema[key] : {};
    const typ = normalizePrefType(spec);
    const def = Object.prototype.hasOwnProperty.call(spec, "default") ? spec.default : undefined;
    if (typ === "boolean") {
      out[key] = !!el.checked;
      return;
    }
    if (typ === "select") {
      out[key] = el.value;
      return;
    }
    if (typ === "number") {
      const raw = String(el.value || "").trim();
      if (raw === "") {
        if (def != null && typeof def === "number") out[key] = def;
        else if (def != null && String(def).trim() !== "") {
          const p = parseFloat(String(def));
          out[key] = Number.isFinite(p) ? p : 0;
        } else out[key] = 0;
        return;
      }
      const n = parseFloat(raw);
      out[key] = Number.isFinite(n) ? n : def != null ? def : 0;
      return;
    }
    out[key] = String(el.value != null ? el.value : "");
  });
  return out;
}

function openScriptPrefsModal(s) {
  const ov = $("script-prefs-overlay");
  const fields = $("script-prefs-fields");
  const lead = $("script-prefs-lead");
  if (!ov || !fields) return;
  scriptPrefsEditingId = s.id;
  scriptPrefsEditingScript = s;
  if (lead) {
    lead.textContent =
      "Edit stored values for " +
      scriptDisplayName(s) +
      ". In the script, read values with donkeycodeGetPref(\"key\").";
  }
  buildScriptPrefsFormFields(fields, s);
  ov.classList.remove("hidden");
  ov.setAttribute("aria-hidden", "false");
  const first = fields.querySelector("input, select");
  if (first && typeof first.focus === "function") first.focus();
}

function closeScriptPrefsModal() {
  const ov = $("script-prefs-overlay");
  if (ov) {
    ov.classList.add("hidden");
    ov.setAttribute("aria-hidden", "true");
  }
  scriptPrefsEditingId = null;
  scriptPrefsEditingScript = null;
  const fields = $("script-prefs-fields");
  if (fields) fields.innerHTML = "";
}

async function saveScriptPrefsFromModal() {
  const id = scriptPrefsEditingId;
  const fields = $("script-prefs-fields");
  const s = scriptPrefsEditingScript;
  if (!id || !fields || !s) return;
  const schema =
    s.donkeycodePrefSchema && typeof s.donkeycodePrefSchema === "object" && !Array.isArray(s.donkeycodePrefSchema)
      ? s.donkeycodePrefSchema
      : {};
  const obj = readScriptPrefsFormValues(fields, schema);
  setStatus("Saving preferences…");
  try {
    const res = await send("SET_SCRIPT_USER_PREFS", { scriptId: id, userPrefs: obj });
    renderScripts(res.scripts || []);
    closeScriptPrefsModal();
    setStatus("Preferences saved.");
  } catch (e) {
    console.error("[DonkeyCode:popup] save script prefs", e);
    setStatus(String(e.message || e), true);
  }
}

function renderScripts(scripts) {
  const list = Array.isArray(scripts) ? scripts : [];
  const ul = $("script-list");
  const empty = $("scripts-empty");
  if (!ul) return;
  ul.innerHTML = "";
  if (!list.length) {
    if (empty) empty.classList.remove("hidden");
    return;
  }
  if (empty) empty.classList.add("hidden");

  const cmp = function (a, b) {
    return scriptDisplayName(a).localeCompare(scriptDisplayName(b), undefined, {
      sensitivity: "base",
    });
  };
  const sorted = list.slice().sort(cmp);

  function appendScriptRow(s) {
    const li = document.createElement("li");
    li.className = "script-row";

    const displayName = scriptDisplayName(s);
    const tip = scriptRowTooltip(s);
    const ver =
      s.userScriptVersion && String(s.userScriptVersion).trim()
        ? String(s.userScriptVersion).trim()
        : "—";

    const labelSpan = document.createElement("span");
    labelSpan.className = "script-row-label";
    labelSpan.textContent = displayName;
    labelSpan.title = tip || displayName;

    const verSpan = document.createElement("span");
    verSpan.className = "script-row-version";
    verSpan.textContent = ver;
    verSpan.title = tip || ver;

    const toggleLabel = document.createElement("label");
    toggleLabel.className = "toggle toggle--sm";
    toggleLabel.setAttribute("title", s.enabled !== false ? "On" : "Off");

    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = s.enabled !== false;
    input.dataset.scriptId = s.id;
    input.addEventListener("change", function () {
      toggleScript(s.id, input.checked);
    });

    const slider = document.createElement("span");
    slider.className = "toggle-slider";
    slider.setAttribute("aria-hidden", "true");

    toggleLabel.appendChild(input);
    toggleLabel.appendChild(slider);

    const prefsBtn = document.createElement("button");
    prefsBtn.type = "button";
    prefsBtn.className = "btn-script-prefs";
    prefsBtn.setAttribute("aria-label", "Edit preferences");
    prefsBtn.title = scriptHasPrefSchema(s)
      ? "Edit preferences for this script"
      : "This script has no @donkeycode-pref schema in its header";
    prefsBtn.textContent = "⚙";
    prefsBtn.disabled = !scriptHasPrefSchema(s);
    prefsBtn.addEventListener("click", function () {
      if (!scriptHasPrefSchema(s)) return;
      openScriptPrefsModal(s);
    });

    li.appendChild(toggleLabel);
    li.appendChild(labelSpan);
    li.appendChild(prefsBtn);
    li.appendChild(verSpan);
    ul.appendChild(li);
  }

  function appendColumnHeader() {
    const head = document.createElement("li");
    head.className = "script-section-heading script-section-heading--scripts";
    head.innerHTML =
      '<span class="script-col-toggle" aria-hidden="true"></span>' +
      '<span class="script-col-name">Script</span>' +
      '<span class="script-col-prefs" title="Scripts with @donkeycode-pref in the header">Pref</span>' +
      '<span class="script-col-ver">Ver</span>';
    ul.appendChild(head);
  }

  appendColumnHeader();
  sorted.forEach(appendScriptRow);
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

function formatGithubSyncStatus(prefix, res) {
  const parts = [prefix];
  const nf = (res && res.newLocalFolders) || [];
  if (nf.length) {
    parts.push("New folders from repo: " + nf.join(", ") + ".");
  }
  const pe = (res && res.pullErrors) || [];
  const psh = (res && res.pushErrors) || [];
  if (psh.length) parts.push("Push issues: " + psh.join(" "));
  if (pe.length) parts.push("Pull issues: " + pe.join(" "));
  const isErr = pe.length || psh.length;
  return { text: parts.join(" "), isErr };
}

async function pullSessionsFromGithub() {
  setStatus("Getting cloud layouts…");
  try {
    const res = await send("GITHUB_SESSIONS_PULL", {});
    await loadState();
    const { text, isErr } = formatGithubSyncStatus("Cloud sessions merged.", res);
    setStatus(text, isErr);
  } catch (e) {
    console.error("[DonkeyCode:popup] GitHub pull", e);
    setStatus(String(e.message || e), true);
    try {
      await loadState();
    } catch (e2) {
      /* ignore */
    }
  }
}

async function pushCurrentFolderToGithub() {
  setStatus("Saving to cloud…");
  try {
    await send("GITHUB_SESSIONS_PUSH", {});
    await loadState();
    setStatus("Saved to cloud.");
  } catch (e) {
    console.error("[DonkeyCode:popup] GitHub push", e);
    setStatus(String(e.message || e), true);
    try {
      await loadState();
    } catch (e2) {
      /* ignore */
    }
  }
}

async function discoverSessionFoldersFromGithub() {
  setStatus("Discovering folders on GitHub…");
  try {
    const res = await send("GITHUB_DISCOVER_SESSION_FOLDERS", {});
    await loadState();
    const nf = (res && res.newLocalFolders) || [];
    if (nf.length) {
      setStatus("Added folders from repo: " + nf.join(", ") + ".");
    } else {
      setStatus("No new folders found on GitHub.");
    }
  } catch (e) {
    console.error("[DonkeyCode:popup] GitHub discover folders", e);
    setStatus(String(e.message || e), true);
    try {
      await loadState();
    } catch (e2) {
      /* ignore */
    }
  }
}

async function refreshScripts() {
  setStatus("Refreshing scripts from GitHub…");
  try {
    const res = await send("REFRESH_SCRIPTS", {});
    renderScripts(res.scripts || []);
    const st = await send("GET_STATE", {});
    const lf = $("last-fetch");
    if (lf) {
      lf.textContent = st.lastScriptFetch
        ? "Last fetch: " + formatTime(st.lastScriptFetch)
        : "";
    }
    updateSetupBanner(st);
    setStatus("Scripts refreshed.");
  } catch (e) {
    console.error("[DonkeyCode:popup]", e);
    setStatus(String(e.message || e), true);
  }
}

async function pullScriptPrefsFromGithub() {
  setStatus("Loading script prefs from GitHub…");
  try {
    const res = await send("GITHUB_SCRIPT_PREFS_PULL", {});
    renderScripts(res.scripts || []);
    setStatus("Script prefs loaded from cloud.");
  } catch (e) {
    console.error("[DonkeyCode:popup] GitHub script prefs pull", e);
    setStatus(String(e.message || e), true);
  }
}

async function pushScriptPrefsToGithub() {
  setStatus("Saving script prefs to GitHub…");
  try {
    const res = await send("GITHUB_SCRIPT_PREFS_PUSH", {});
    renderScripts(res.scripts || []);
    setStatus("Script prefs saved to cloud.");
  } catch (e) {
    console.error("[DonkeyCode:popup] GitHub script prefs push", e);
    setStatus(String(e.message || e), true);
  }
}

async function saveSession() {
  const name = $("session-name").value.trim();
  if (!name) {
    setStatus("Enter a session name first.", true);
    return;
  }
  setStatus("Capturing layout…");
  try {
    const preview = await send("PREVIEW_SESSION_CAPTURE", {});
    const wsIdx = preview.worksheetWindowIndices || [];
    if (wsIdx.length > 0) {
      const opened = openWorksheetOrderModal(name, preview.snapshot, wsIdx);
      if (opened) {
        setStatus("Set worksheet order, then Save session.");
        return;
      }
    }
    const res = await send("SAVE_SESSION", { name });
    $("session-name").value = "";
    renderSessions(res.sessions || []);
    setStatus('Session "' + name + '" saved.' + githubAutoSyncSuffix(res.githubAutoSync));
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
    let openerTabId;
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs && tabs[0] && tabs[0].id != null) openerTabId = tabs[0].id;
    } catch (e) {
      /* ignore */
    }
    const res = await send("RESTORE_SESSION_AFTER_LOGIN", {
      name: name.trim(),
      openerTabId,
    });
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
    setStatus('Session "' + name + '" deleted.' + githubAutoSyncSuffix(res.githubAutoSync));
  } catch (e) {
    console.error("[DonkeyCode:popup]", e);
    setStatus(String(e.message || e), true);
  }
}

/** Mutable snapshot while session editor modal is open */
let sessionEditorDraft = null;

function sessionEditorSyncJsonTextarea() {
  const ta = $("session-editor-json");
  if (!ta || !sessionEditorDraft) return;
  try {
    ta.value = JSON.stringify(sessionEditorDraft, null, 2);
  } catch (e) {
    ta.value = "";
  }
}

function sessionEditorReadFormIntoDraft() {
  const staggerEl = $("session-editor-stagger");
  const staggerRaw = staggerEl ? parseInt(String(staggerEl.value || "").trim(), 10) : NaN;
  const stagger = Number.isFinite(staggerRaw) ? Math.max(0, staggerRaw) : 800;
  const cards = document.querySelectorAll("#session-editor-windows .session-editor-window-card");
  const windows = [];
  cards.forEach(function (card, wi) {
    const g = function (sel) {
      const el = card.querySelector(sel);
      return el ? el.value : "";
    };
    const gn = function (sel) {
      const v = g(sel);
      if (v === "" || v === undefined) return undefined;
      const n = parseInt(v, 10);
      return Number.isFinite(n) ? n : undefined;
    };
    const left = gn('[data-field="left"]');
    const top = gn('[data-field="top"]');
    const width = gn('[data-field="width"]');
    const height = gn('[data-field="height"]');
    const roRaw = g('[data-field="restoreOrder"]');
    const restoreOrder =
      roRaw === "" || roRaw === undefined
        ? undefined
        : (function () {
            const n = parseInt(roRaw, 10);
            return Number.isFinite(n) ? n : undefined;
          })();
    const stateSel = card.querySelector('[data-field="state"]');
    const stateVal = stateSel ? String(stateSel.value || "normal") : "normal";
    const state =
      stateVal === "minimized" || stateVal === "maximized" ? stateVal : undefined;
    const focusedEl = card.querySelector('[data-field="focused"]');
    const focused = focusedEl ? !!focusedEl.checked : false;

    const tabRows = card.querySelectorAll(".session-editor-tab-row");
    const tabs = [];
    const activeRadio = card.querySelector('input[name="session-active-tab-' + wi + '"]:checked');
    let activeIdx = 0;
    if (activeRadio && activeRadio.dataset.tabIndex != null) {
      const ai = parseInt(activeRadio.dataset.tabIndex, 10);
      if (Number.isFinite(ai)) activeIdx = ai;
    }
    tabRows.forEach(function (row, ti) {
      const urlEl = row.querySelector('[data-field="tabUrl"]');
      const url = urlEl ? String(urlEl.value || "").trim() : "";
      const pinEl = row.querySelector('[data-field="tabPinned"]');
      const pinned = pinEl ? !!pinEl.checked : false;
      tabs.push({
        url: url,
        active: ti === activeIdx,
        index: ti,
        pinned: pinned,
      });
    });

    const win = {
      left: left,
      top: top,
      width: width,
      height: height,
      state: state,
      focused: focused,
      tabs: tabs,
    };
    if (restoreOrder !== undefined) win.restoreOrder = restoreOrder;
    windows.push(win);
  });

  sessionEditorDraft = {
    windows: windows,
    _meta: {
      updatedAt: sessionEditorDraft && sessionEditorDraft._meta ? sessionEditorDraft._meta.updatedAt || 0 : 0,
      worksheetStaggerMs: stagger,
    },
  };
}

function sessionEditorRender() {
  const container = $("session-editor-windows");
  if (!container || !sessionEditorDraft || !Array.isArray(sessionEditorDraft.windows)) return;
  container.innerHTML = "";

  const staggerEl = $("session-editor-stagger");
  if (staggerEl) {
    const m = sessionEditorDraft._meta;
    const s =
      m && typeof m.worksheetStaggerMs === "number" && Number.isFinite(m.worksheetStaggerMs)
        ? m.worksheetStaggerMs
        : 800;
    staggerEl.value = String(s);
  }

  sessionEditorDraft.windows.forEach(function (w, wi) {
    const card = document.createElement("div");
    card.className = "session-editor-window-card";
    card.dataset.windowIndex = String(wi);

    const head = document.createElement("div");
    head.className = "session-editor-window-head";
    const h3 = document.createElement("h3");
    h3.textContent = "Window " + (wi + 1);
    head.appendChild(h3);
    const removeWin = document.createElement("button");
    removeWin.type = "button";
    removeWin.className = "small danger session-editor-remove-win";
    removeWin.textContent = "Remove window";
    removeWin.dataset.windowIndex = String(wi);
    head.appendChild(removeWin);
    card.appendChild(head);

    const grid = document.createElement("div");
    grid.className = "session-editor-grid";
    [
      { key: "left", label: "Left", val: w.left },
      { key: "top", label: "Top", val: w.top },
      { key: "width", label: "Width", val: w.width },
      { key: "height", label: "Height", val: w.height },
      { key: "restoreOrder", label: "Open order", val: w.restoreOrder },
    ].forEach(function (fd) {
      const wrap = document.createElement("div");
      wrap.className = "session-editor-field";
      const lab = document.createElement("label");
      lab.textContent = fd.label;
      const inp = document.createElement("input");
      inp.type = "number";
      inp.className = "session-editor-input";
      inp.dataset.field = fd.key;
      inp.value =
        fd.val != null && fd.val !== "" && Number.isFinite(Number(fd.val)) ? String(fd.val) : "";
      wrap.appendChild(lab);
      wrap.appendChild(inp);
      grid.appendChild(wrap);
    });
    card.appendChild(grid);

    const stateRow = document.createElement("div");
    stateRow.className = "session-editor-field";
    const stLab = document.createElement("label");
    stLab.textContent = "State";
    const stSel = document.createElement("select");
    stSel.className = "session-editor-input";
    stSel.dataset.field = "state";
    ["normal", "minimized", "maximized"].forEach(function (sv) {
      const o = document.createElement("option");
      o.value = sv;
      o.textContent = sv;
      stSel.appendChild(o);
    });
    const curSt = w.state === "minimized" || w.state === "maximized" ? w.state : "normal";
    stSel.value = curSt;
    stateRow.appendChild(stLab);
    stateRow.appendChild(stSel);
    card.appendChild(stateRow);

    const focRow = document.createElement("div");
    focRow.className = "session-editor-field";
    const focLab = document.createElement("label");
    const focCb = document.createElement("input");
    focCb.type = "checkbox";
    focCb.dataset.field = "focused";
    focCb.checked = !!w.focused;
    focLab.appendChild(focCb);
    focLab.appendChild(document.createTextNode(" Focused when restored"));
    focRow.appendChild(focLab);
    card.appendChild(focRow);

    const tabsLabel = document.createElement("div");
    tabsLabel.className = "session-editor-tabs-label";
    tabsLabel.textContent = "Tabs";
    card.appendChild(tabsLabel);

    let tabs = Array.isArray(w.tabs) ? w.tabs.slice() : [];
    if (tabs.length === 0) {
      tabs.push({ url: "", active: true, index: 0, pinned: false });
    }
    let activeIndex = tabs.findIndex(function (t) {
      return t && t.active;
    });
    if (activeIndex < 0) activeIndex = 0;

    tabs.forEach(function (t, ti) {
      const row = document.createElement("div");
      row.className = "session-editor-tab-row";
      const urlIn = document.createElement("input");
      urlIn.type = "url";
      urlIn.className = "session-editor-input session-editor-tab-url";
      urlIn.dataset.field = "tabUrl";
      urlIn.placeholder = "https://…";
      urlIn.value = t && t.url ? String(t.url) : "";
      const meta = document.createElement("div");
      meta.className = "session-editor-tab-meta";
      const pinLab = document.createElement("label");
      const pinCb = document.createElement("input");
      pinCb.type = "checkbox";
      pinCb.dataset.field = "tabPinned";
      pinCb.checked = !!(t && t.pinned);
      pinLab.appendChild(pinCb);
      pinLab.appendChild(document.createTextNode(" Pin"));
      const ar = document.createElement("input");
      ar.type = "radio";
      ar.name = "session-active-tab-" + wi;
      ar.dataset.tabIndex = String(ti);
      ar.checked = ti === activeIndex;
      const arLab = document.createElement("label");
      arLab.appendChild(ar);
      arLab.appendChild(document.createTextNode(" Active"));
      meta.appendChild(pinLab);
      meta.appendChild(arLab);
      const rmTab = document.createElement("button");
      rmTab.type = "button";
      rmTab.className = "secondary small session-editor-remove-tab";
      rmTab.textContent = "×";
      rmTab.title = "Remove tab";
      rmTab.dataset.windowIndex = String(wi);
      rmTab.dataset.tabIndex = String(ti);
      row.appendChild(urlIn);
      row.appendChild(meta);
      row.appendChild(rmTab);
      card.appendChild(row);
    });

    const addTab = document.createElement("button");
    addTab.type = "button";
    addTab.className = "small secondary";
    addTab.textContent = "+ Tab";
    addTab.dataset.windowIndex = String(wi);
    addTab.classList.add("session-editor-add-tab");
    card.appendChild(addTab);

    container.appendChild(card);
  });

  container.querySelectorAll(".session-editor-remove-win").forEach(function (btn) {
    btn.addEventListener("click", function () {
      sessionEditorReadFormIntoDraft();
      const idx = parseInt(btn.dataset.windowIndex, 10);
      if (!Number.isFinite(idx) || !sessionEditorDraft.windows.length) return;
      sessionEditorDraft.windows.splice(idx, 1);
      sessionEditorRender();
      sessionEditorSyncJsonTextarea();
    });
  });
  container.querySelectorAll(".session-editor-add-tab").forEach(function (btn) {
    btn.addEventListener("click", function () {
      sessionEditorReadFormIntoDraft();
      const idx = parseInt(btn.dataset.windowIndex, 10);
      if (!Number.isFinite(idx) || !sessionEditorDraft.windows[idx]) return;
      if (!sessionEditorDraft.windows[idx].tabs) sessionEditorDraft.windows[idx].tabs = [];
      sessionEditorDraft.windows[idx].tabs.push({
        url: "https://",
        active: false,
        index: sessionEditorDraft.windows[idx].tabs.length,
        pinned: false,
      });
      sessionEditorRender();
      sessionEditorSyncJsonTextarea();
    });
  });
  container.querySelectorAll(".session-editor-remove-tab").forEach(function (btn) {
    btn.addEventListener("click", function () {
      sessionEditorReadFormIntoDraft();
      const wi = parseInt(btn.dataset.windowIndex, 10);
      const ti = parseInt(btn.dataset.tabIndex, 10);
      if (!Number.isFinite(wi) || !sessionEditorDraft.windows[wi]) return;
      const ts = sessionEditorDraft.windows[wi].tabs || [];
      if (!Number.isFinite(ti)) return;
      ts.splice(ti, 1);
      sessionEditorDraft.windows[wi].tabs = ts;
      sessionEditorRender();
      sessionEditorSyncJsonTextarea();
    });
  });
}

async function openSessionEditor(name) {
  editingSessionName = name;
  setStatus("Loading session…");
  try {
    const res = await send("GET_SESSION_DETAIL", { name });
    const snap = res.snapshot || {};
    const wins = Array.isArray(snap.windows) ? snap.windows : [];
    sessionEditorDraft = {
      windows: JSON.parse(JSON.stringify(wins)),
      _meta: snap._meta && typeof snap._meta === "object" ? Object.assign({}, snap._meta) : { updatedAt: 0 },
    };
    $("session-editor-title").textContent = 'Edit session: "' + name + '"';
    sessionEditorRender();
    sessionEditorSyncJsonTextarea();
    $("session-editor-overlay").classList.remove("hidden");
    $("session-editor-overlay").setAttribute("aria-hidden", "false");
    setStatus("");
  } catch (e) {
    console.error("[DonkeyCode:popup]", e);
    setStatus(String(e.message || e), true);
    editingSessionName = null;
    sessionEditorDraft = null;
  }
}

function closeSessionEditor() {
  editingSessionName = null;
  sessionEditorDraft = null;
  const wrap = $("session-editor-windows");
  if (wrap) wrap.innerHTML = "";
  $("session-editor-overlay").classList.add("hidden");
  $("session-editor-overlay").setAttribute("aria-hidden", "true");
}

function openSettingsGuardModal() {
  const ov = $("settings-guard-overlay");
  if (!ov) {
    openSettingsTabInternal();
    return;
  }
  ov.classList.remove("hidden");
  ov.setAttribute("aria-hidden", "false");
}

function closeSettingsGuardModal() {
  const ov = $("settings-guard-overlay");
  if (!ov) return;
  ov.classList.add("hidden");
  ov.setAttribute("aria-hidden", "true");
}

async function openSettingsTabInternal() {
  try {
    await send("OPEN_SETTINGS_TAB", {});
  } catch (e) {
    console.error("[DonkeyCode:popup]", e);
    setStatus(String(e.message || e), true);
  }
}

async function saveSessionEditor() {
  if (!editingSessionName || !sessionEditorDraft) return;
  sessionEditorReadFormIntoDraft();
  if (!sessionEditorDraft.windows || sessionEditorDraft.windows.length === 0) {
    setStatus("Add at least one window with tabs.", true);
    return;
  }
  for (let i = 0; i < sessionEditorDraft.windows.length; i++) {
    const w = sessionEditorDraft.windows[i];
    const tabs = w.tabs || [];
    const ok = tabs.some(function (t) {
      return t && String(t.url || "").trim() && /^https?:\/\//i.test(String(t.url).trim());
    });
    if (!ok) {
      setStatus("Window " + (i + 1) + ": add at least one tab with a valid http(s) URL.", true);
      return;
    }
  }
  setStatus("Saving session…");
  try {
    const res = await send("SAVE_SESSION_DATA", {
      name: editingSessionName,
      snapshot: sessionEditorDraft,
    });
    closeSessionEditor();
    renderSessions(res.sessions || []);
    setStatus(
      'Session "' + editingSessionName + '" updated.' +
        githubAutoSyncSuffix(res.githubAutoSync)
    );
  } catch (e) {
    console.error("[DonkeyCode:popup]", e);
    setStatus(String(e.message || e), true);
  }
}

function sessionEditorApplyJson() {
  const ta = $("session-editor-json");
  if (!ta) return;
  let parsed;
  try {
    parsed = JSON.parse(String(ta.value || "").trim() || "{}");
  } catch (e) {
    setStatus("Invalid JSON: " + (e.message || e), true);
    return;
  }
  if (!parsed || !Array.isArray(parsed.windows)) {
    setStatus('JSON must include a "windows" array.', true);
    return;
  }
  sessionEditorDraft = {
    windows: JSON.parse(JSON.stringify(parsed.windows)),
    _meta:
      parsed._meta && typeof parsed._meta === "object"
        ? Object.assign({}, parsed._meta)
        : { updatedAt: 0 },
  };
  sessionEditorRender();
  sessionEditorSyncJsonTextarea();
  setStatus("Form updated from JSON.");
}

document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

bindClick("btn-save-session", saveSession);

bindClick("worksheet-order-save", function () {
  confirmWorksheetOrderSave();
});
bindClick("worksheet-order-cancel", function () {
  closeWorksheetOrderModal();
  setStatus("Save cancelled.");
});
(function () {
  const ov = $("worksheet-order-overlay");
  if (!ov) return;
  ov.addEventListener("click", function (ev) {
    if (ev.target === ov) {
      closeWorksheetOrderModal();
      setStatus("Save cancelled.");
    }
  });
})();

bindClick("script-prefs-save", saveScriptPrefsFromModal);
bindClick("script-prefs-cancel", function () {
  closeScriptPrefsModal();
  setStatus("");
});
(function () {
  const ov = $("script-prefs-overlay");
  if (!ov) return;
  ov.addEventListener("click", function (ev) {
    if (ev.target === ov) {
      closeScriptPrefsModal();
      setStatus("");
    }
  });
})();

bindClick("btn-discover-session-folders", discoverSessionFoldersFromGithub);
bindClick("btn-pull-sessions-github", pullSessionsFromGithub);
bindClick("btn-push-sessions-github", pushCurrentFolderToGithub);
bindClick("btn-refresh-scripts", refreshScripts);
bindClick("btn-pull-script-prefs-github", pullScriptPrefsFromGithub);
bindClick("btn-push-script-prefs-github", pushScriptPrefsToGithub);
bindChange("chk-session-save-zoom", async function (ev) {
  const enabled = !!(ev.target && ev.target.checked);
  try {
    await send("SET_SESSION_SAVE_ZOOM_PER_TAB", { enabled });
    const st = await send("GET_STATE", {});
    updateSessionZoomToggle(st);
    setStatus(
      enabled
        ? "Per-tab zoom will be saved with layouts and restored on launch."
        : "Zoom is no longer saved or applied from layouts (re-save sessions to drop stored zoom)."
    );
  } catch (e) {
    console.error("[DonkeyCode:popup] session zoom toggle", e);
    setStatus(String(e.message || e), true);
    try {
      const st = await send("GET_STATE", {});
      updateSessionZoomToggle(st);
    } catch (e2) {
      /* ignore */
    }
  }
});
bindClick("btn-submit-report", submitIssueReport);
bindClick("btn-open-settings", openSettingsGuardModal);
bindClick("settings-guard-proceed", function () {
  closeSettingsGuardModal();
  openSettingsTabInternal();
});
bindClick("settings-guard-cancel", closeSettingsGuardModal);
(function () {
  const ov = $("settings-guard-overlay");
  if (!ov) return;
  ov.addEventListener("click", function (ev) {
    if (ev.target === ov) closeSettingsGuardModal();
  });
})();

bindClick("btn-browse-session-folders", function () {
  openFolderPickerModal();
});
bindClick("folder-picker-close", closeFolderPickerModal);
(function () {
  const ov = $("folder-picker-overlay");
  if (ov) {
    ov.addEventListener("click", function (ev) {
      if (ev.target === ov) closeFolderPickerModal();
    });
  }
  const inp = $("folder-picker-filter");
  if (inp) {
    inp.addEventListener("input", function () {
      renderFolderPickerList(inp.value);
    });
  }
})();

bindClick("btn-add-session-folder", async function () {
  const name = window.prompt(
    "New folder name (e.g. team-a or ops/daily). Optional GitHub subfolder: add a comma then the subfolder (e.g. team-a, team-a)."
  );
  if (!name || !name.trim()) return;
  let folderKey = name.trim();
  let githubRelativePath = "";
  const comma = folderKey.indexOf(",");
  if (comma !== -1) {
    githubRelativePath = folderKey.slice(comma + 1).trim();
    folderKey = folderKey.slice(0, comma).trim();
  }
  if (!folderKey) return;
  setStatus("Adding folder…");
  try {
    const res = await send("ADD_SESSION_FOLDER", {
      folderKey,
      githubRelativePath,
    });
    fillSessionFolderUI(res);
    renderSessions(res.sessions || []);
    syncLoginFirstSelect(res.sessions || []);
    const ph = res.githubPlaceholder;
    const pe = res.folderPullError;
    let msg = "Folder added.";
    if (ph && ph.created) msg += " Created file on GitHub.";
    else if (ph && ph.error) msg += " GitHub: " + ph.error;
    if (pe) msg += " Cloud: " + pe;
    setStatus(msg, !!(pe || (ph && ph.error)));
  } catch (e) {
    console.error("[DonkeyCode:popup]", e);
    setStatus(String(e.message || e), true);
  }
});

bindClick("btn-setup-allow", async function () {
  setStatus("Requesting permission…");
  try {
    const res = await send("REQUEST_HOST_ACCESS", {});
    const st = await send("GET_STATE", {});
    updateSetupBanner(st);
    if (res.granted) setStatus("Website access granted.");
    else setStatus("Permission not granted.", true);
  } catch (e) {
    console.error("[DonkeyCode:popup]", e);
    setStatus(String(e.message || e), true);
  }
});

bindClick("btn-setup-welcome", async function () {
  try {
    await send("OPEN_WELCOME_TAB", {});
  } catch (e) {
    console.error("[DonkeyCode:popup]", e);
    setStatus(String(e.message || e), true);
  }
});

bindClick("btn-setup-dismiss", async function () {
  try {
    await send("DISMISS_SETUP_BANNER", {});
    const st = await send("GET_STATE", {});
    updateSetupBanner(st);
  } catch (e) {
    console.error("[DonkeyCode:popup]", e);
  }
});

bindClick("btn-complete-pending", completePendingRestore);
bindClick("btn-cancel-pending", cancelPendingRestore);
bindClick("btn-login-first", loginFirst);

bindClick("session-editor-save", saveSessionEditor);
bindClick("session-editor-cancel", closeSessionEditor);
bindClick("session-editor-apply-json", sessionEditorApplyJson);
bindClick("session-editor-add-window", function () {
  sessionEditorReadFormIntoDraft();
  if (!sessionEditorDraft) return;
  if (!sessionEditorDraft.windows) sessionEditorDraft.windows = [];
  sessionEditorDraft.windows.push({
    left: 40,
    top: 40,
    width: 1200,
    height: 800,
    focused: false,
    tabs: [{ url: "https://", active: true, index: 0, pinned: false }],
  });
  sessionEditorRender();
  sessionEditorSyncJsonTextarea();
});
(function () {
  const ov = $("session-editor-overlay");
  if (!ov) return;
  ov.addEventListener("click", function (ev) {
    if (ev.target === ov) closeSessionEditor();
  });
})();

let visibilityReloadTimer = null;
function scheduleReloadOnVisible() {
  if (visibilityReloadTimer) clearTimeout(visibilityReloadTimer);
  visibilityReloadTimer = setTimeout(function () {
    visibilityReloadTimer = null;
    loadState().catch(function (e) {
      console.error("[DonkeyCode:popup] visibility reload", e);
    });
  }, 80);
}

document.addEventListener("DOMContentLoaded", loadState);

document.addEventListener("visibilitychange", function () {
  if (document.visibilityState !== "visible") return;
  scheduleReloadOnVisible();
});
