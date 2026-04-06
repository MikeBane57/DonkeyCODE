/**
 * DonkeyCode — MV3 service worker: script sync, injection, sessions, alarms.
 */

const LOG_PREFIX = "[DonkeyCode:background]";

const DEFAULT_SCRIPT_SOURCE_URL =
  "https://api.github.com/repos/MikeBane57/Wolf2.0/contents/?ref=main";

const STORAGE = {
  SCRIPT_SOURCE: "donkeycode_script_source_url",
  EXTRA_URLS: "donkeycode_extra_script_urls",
  SCRIPTS: "donkeycode_scripts",
  SESSIONS: "donkeycode_sessions",
  LAST_FETCH: "donkeycode_last_script_fetch_ms",
};

const ALARM_DAILY = "donkeycode_daily_script_refresh";

/** @type {Map<number, Set<string>>} */
const tabInjectedScripts = new Map();

function log(...args) {
  console.log(LOG_PREFIX, ...args);
}

function logWarn(...args) {
  console.warn(LOG_PREFIX, ...args);
}

function logError(...args) {
  console.error(LOG_PREFIX, ...args);
}

function scriptIdFromUrl(url) {
  let h = 2166136261;
  for (let i = 0; i < url.length; i++) {
    h ^= url.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return "dc_" + (h >>> 0).toString(16);
}

/**
 * Parse ==UserScript== metadata and body.
 * @param {string} fullText
 */
function parseUserScript(fullText) {
  const blockMatch = fullText.match(
    /\/\/\s*==UserScript==([\s\S]*?)\/\/\s*==\/UserScript==/i
  );
  const metaText = blockMatch ? blockMatch[1] : "";
  const body = blockMatch
    ? fullText.slice(blockMatch.index + blockMatch[0].length).replace(/^\s*/, "")
    : fullText;

  const matches = [];
  const excludes = [];
  const grants = [];
  const connects = [];
  const lines = metaText.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^\s*\/\/\s*@(\S+)\s+(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = (m[2] || "").trim();
    if (key === "match") matches.push(val);
    else if (key === "exclude") excludes.push(val);
    else if (key === "grant") grants.push(val);
    else if (key === "connect") connects.push(val);
  }

  if (matches.length === 0) matches.push("*://*/*");

  return { matches, excludes, grants, connects, body };
}

/**
 * @param {string} hostname
 * @param {string} pattern e.g. example.com or *.example.com
 */
function hostMatchesConnect(hostname, pattern) {
  const p = (pattern || "").trim().toLowerCase();
  const h = (hostname || "").toLowerCase();
  if (!p) return false;
  if (p.startsWith("*.")) {
    const suf = p.slice(2);
    return h === suf || h.endsWith("." + suf);
  }
  return h === p;
}

function urlAllowedByConnects(pageUrl, connects) {
  if (!connects || connects.length === 0) return true;
  if (connects.some((c) => String(c).trim() === "*")) return true;
  let u;
  try {
    u = new URL(pageUrl);
  } catch (e) {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  for (const c of connects) {
    if (hostMatchesConnect(u.hostname, c.trim())) return true;
  }
  return false;
}

/**
 * Tampermonkey-style @match against a page URL (simplified).
 * @param {string} pattern e.g. *://*.example.com/foo*
 * @param {string} pageUrl
 */
function urlMatchesPattern(pattern, pageUrl) {
  try {
    const u = new URL(pageUrl);
    if (u.protocol === "chrome-extension:" || u.protocol === "chrome:") return false;

    const normalized = pattern.trim();
    const parts = normalized.match(/^(\*|https?|file|ftp):\/\/([^/]+)(\/.*)$/i);
    if (!parts) return false;

    const schemePat = parts[1].toLowerCase();
    const hostPat = parts[2];
    const pathPat = parts[3] || "/";

    const scheme = (u.protocol || "").replace(":", "").toLowerCase();
    if (schemePat !== "*" && schemePat !== scheme) return false;

    if (!hostMatches(hostPat, u.hostname)) return false;
    if (!pathMatches(pathPat, u.pathname + u.search)) return false;
    return true;
  } catch (e) {
    logWarn("match parse error", pattern, e);
    return false;
  }
}

function hostMatches(pat, host) {
  if (pat === "*") return true;
  if (pat.startsWith("*.")) {
    const rest = pat.slice(2);
    return host === rest || host.endsWith("." + rest);
  }
  if (pat.includes("*")) {
    const re = new RegExp(
      "^" +
        pat.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") +
        "$",
      "i"
    );
    return re.test(host);
  }
  return host.toLowerCase() === pat.toLowerCase();
}

function pathMatches(pat, pathAndQuery) {
  const re = new RegExp(
    "^" + pat.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$",
    "i"
  );
  return re.test(pathAndQuery);
}

function scriptMatchesUrl(script, pageUrl) {
  for (const ex of script.excludes || []) {
    if (urlMatchesPattern(ex, pageUrl)) {
      log("URL skipped (exclude)", { id: script.id, pageUrl, ex });
      return false;
    }
  }
  for (const m of script.matches || []) {
    if (urlMatchesPattern(m, pageUrl)) {
      log("URL matched", { id: script.id, pageUrl, match: m });
      return true;
    }
  }
  log("URL skipped (no @match)", { id: script.id, pageUrl });
  return false;
}

/**
 * Injected into MAIN world — runs user code and registers cleanup.
 * Passes Tampermonkey-style GM_xmlhttpRequest when @grant requests it (via
 * new Function argument so each script keeps the correct script id for @connect).
 * Must be self-contained (serialized).
 * @param {{ id: string, code: string, grants?: string[], connects?: string[] }} payload
 */
function donkeycodeInjectMain(payload) {
  const scriptId = payload.id;
  const code = payload.code;
  const grants = payload.grants || [];
  const connects = payload.connects || [];

  const g = typeof window !== "undefined" ? window : globalThis;
  const key = "__donkeycodeCleanups";
  if (!g[key]) g[key] = Object.create(null);
  const cleanups = g[key];
  if (cleanups[scriptId]) {
    try {
      console.log("[DonkeyCode:page] cleaning up before re-inject", scriptId);
      cleanups[scriptId]();
    } catch (e) {
      console.warn("[DonkeyCode:page] cleanup error before inject", scriptId, e);
    }
    delete cleanups[scriptId];
  }

  function ensureGmBridge() {
    if (g.__donkeycodeGmBridge) return;
    g.__donkeycodeGmBridge = true;
    g.__donkeycodeGmPending = Object.create(null);
    g.__donkeycodeGmNextId = 0;
    g.addEventListener("message", function (ev) {
      if (ev.source !== g) return;
      const d = ev.data;
      if (!d || d.type !== "DONKEYCODE_GM_XHR_RESPONSE") return;
      const rec = g.__donkeycodeGmPending[d.id];
      delete g.__donkeycodeGmPending[d.id];
      if (!rec) return;
      const details = rec.details;
      if (d.error) {
        console.warn("[DonkeyCode:page] GM_xmlhttpRequest error", d.error);
        if (details.onerror) details.onerror({ status: 0, statusText: d.error });
      } else if (details.onload) {
        details.onload({
          responseText: d.responseText || "",
          status: d.status || 0,
          statusText: d.statusText || "",
          finalUrl: d.finalUrl || "",
        });
      }
    });
  }

  function makeGmXmlHttpRequest(sid) {
    ensureGmBridge();
    return function (details) {
      const id = ++g.__donkeycodeGmNextId;
      g.__donkeycodeGmPending[id] = { details: details };
      g.postMessage(
        {
          type: "DONKEYCODE_GM_XHR",
          id: id,
          scriptId: sid,
          details: {
            method: (details && details.method) || "GET",
            url: details && details.url,
            headers: details && details.headers,
          },
        },
        "*"
      );
    };
  }

  const grantSet = {};
  for (let gi = 0; gi < grants.length; gi++) {
    grantSet[String(grants[gi]).toLowerCase()] = true;
  }

  let gmArg;
  if (grantSet["gm_xmlhttprequest"] || grantSet["gm.xmlhttprequest"]) {
    gmArg = makeGmXmlHttpRequest(scriptId);
    console.log(
      "[DonkeyCode:page] GM_xmlhttpRequest available for script",
      scriptId,
      "connects",
      connects
    );
  } else {
    gmArg = undefined;
  }

  try {
    console.log("[DonkeyCode:page] executing script", scriptId);
    const run = new Function("GM_xmlhttpRequest", code);
    run(gmArg);
    if (typeof g.__myScriptCleanup === "function") {
      cleanups[scriptId] = g.__myScriptCleanup;
      try {
        delete g.__myScriptCleanup;
      } catch (e) {
        g.__myScriptCleanup = undefined;
      }
      console.log("[DonkeyCode:page] registered __myScriptCleanup", scriptId);
    } else {
      console.log(
        "[DonkeyCode:page] no __myScriptCleanup (optional)",
        scriptId
      );
    }
  } catch (e) {
    console.error("[DonkeyCode:page] script error", scriptId, e);
  }
}

function donkeycodeCleanupMain(scriptId) {
  const g = typeof window !== "undefined" ? window : globalThis;
  const key = "__donkeycodeCleanups";
  const cleanups = g[key];
  if (cleanups && typeof cleanups[scriptId] === "function") {
    try {
      console.log("[DonkeyCode:page] cleanup invoked", scriptId);
      cleanups[scriptId]();
    } catch (e) {
      console.warn("[DonkeyCode:page] cleanup failed", scriptId, e);
    }
    delete cleanups[scriptId];
  } else {
    console.log("[DonkeyCode:page] no cleanup to run", scriptId);
  }
}

function rememberInjection(tabId, scriptId, injected) {
  if (!tabInjectedScripts.has(tabId)) tabInjectedScripts.set(tabId, new Set());
  const set = tabInjectedScripts.get(tabId);
  if (injected) set.add(scriptId);
  else set.delete(scriptId);
}

function forgetScriptEverywhere(scriptId) {
  for (const set of tabInjectedScripts.values()) {
    set.delete(scriptId);
  }
}

function forgetAllInjections() {
  tabInjectedScripts.clear();
}

async function getStoredScripts() {
  const data = await chrome.storage.local.get(STORAGE.SCRIPTS);
  return data[STORAGE.SCRIPTS] || [];
}

async function saveScripts(scripts) {
  await chrome.storage.local.set({ [STORAGE.SCRIPTS]: scripts });
}

async function getScriptSourceUrl() {
  const data = await chrome.storage.sync.get(STORAGE.SCRIPT_SOURCE);
  return data[STORAGE.SCRIPT_SOURCE] || DEFAULT_SCRIPT_SOURCE_URL;
}

async function getExtraUrls() {
  const data = await chrome.storage.sync.get(STORAGE.EXTRA_URLS);
  const list = data[STORAGE.EXTRA_URLS];
  return Array.isArray(list) ? list : [];
}

async function fetchGitHubFileList(apiUrl) {
  const res = await fetch(apiUrl, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (!Array.isArray(json)) throw new Error("GitHub API: expected array");
  return json;
}

async function fetchScriptText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch script ${res.status}: ${url}`);
  return await res.text();
}

/**
 * Discover .user.js from GitHub Contents API + optional raw URLs.
 */
async function loadScriptsFromRemote() {
  const sourceUrl = await getScriptSourceUrl();
  const extra = await getExtraUrls();
  log("loading script list from", sourceUrl, "extras", extra.length);

  const entries = [];

  try {
    const listing = await fetchGitHubFileList(sourceUrl);
    for (const item of listing) {
      if (item.type !== "file") continue;
      if (!/\.user\.js$/i.test(item.name || "")) continue;
      if (!item.download_url) continue;
      entries.push({
        url: item.download_url,
        name: item.name,
      });
    }
    log("GitHub listing: .user.js count", entries.length);
  } catch (e) {
    logError("GitHub listing failed", e);
    throw e;
  }

  for (const rawUrl of extra) {
    const u = (rawUrl || "").trim();
    if (!u) continue;
    entries.push({
      url: u,
      name: u.split("/").pop() || u,
    });
  }

  const prev = await getStoredScripts();
  const prevByUrl = new Map(prev.map((s) => [s.url, s]));

  const next = [];
  for (const e of entries) {
    const id = scriptIdFromUrl(e.url);
    const prevRow = prevByUrl.get(e.url);
    let text;
    try {
      text = await fetchScriptText(e.url);
      log("loaded script text", e.name, e.url, "chars", text.length);
    } catch (err) {
      logError("failed to fetch script", e.url, err);
      if (prevRow && prevRow.code) {
        text = prevRow.code;
        logWarn("using cached script body for", e.url);
      } else {
        continue;
      }
    }

    const meta = parseUserScript(text);
    next.push({
      id,
      url: e.url,
      name: e.name,
      enabled: prevRow ? prevRow.enabled !== false : true,
      matches: meta.matches,
      excludes: meta.excludes,
      grants: meta.grants,
      connects: meta.connects,
      code: meta.body,
    });
  }

  await saveScripts(next);
  await chrome.storage.local.set({
    [STORAGE.LAST_FETCH]: Date.now(),
  });

  forgetAllInjections();
  log("scripts saved", next.length);
  return next;
}

async function ensureDailyAlarm() {
  const existing = await chrome.alarms.get(ALARM_DAILY);
  if (!existing) {
    chrome.alarms.create(ALARM_DAILY, { periodInMinutes: 24 * 60 });
    log("created daily alarm");
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_DAILY) {
    log("daily alarm: refreshing scripts");
    loadScriptsFromRemote().catch((e) => logError("daily refresh failed", e));
  }
});

chrome.runtime.onStartup.addListener(() => {
  log("onStartup: refresh scripts");
  loadScriptsFromRemote().catch((e) => logError("startup refresh failed", e));
});

chrome.runtime.onInstalled.addListener(() => {
  log("onInstalled: refresh scripts + alarm");
  ensureDailyAlarm();
  loadScriptsFromRemote().catch((e) => logError("install refresh failed", e));
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabInjectedScripts.delete(tabId);
});

/**
 * @param {number} tabId
 * @param {string} url
 */
async function syncTabScripts(tabId, url) {
  if (!url || url.startsWith("chrome://") || url.startsWith("devtools://"))
    return;

  const scripts = await getStoredScripts();
  for (const script of scripts) {
    if (!script.enabled) continue;
    if (!script.code) continue;
    if (!scriptMatchesUrl(script, url)) continue;

    const set = tabInjectedScripts.get(tabId) || new Set();
    if (set.has(script.id)) continue;

    try {
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: false },
        world: "MAIN",
        func: donkeycodeInjectMain,
        args: [
          {
            id: script.id,
            code: script.code,
            grants: script.grants || [],
            connects: script.connects || [],
          },
        ],
      });
      rememberInjection(tabId, script.id, true);
      log("injected script", script.id, script.name, "tab", tabId, url);
    } catch (e) {
      logError("inject failed", script.id, tabId, e);
    }
  }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !tab.url) return;
  tabInjectedScripts.delete(tabId);
  syncTabScripts(tabId, tab.url).catch((e) => logError("syncTabScripts", e));
});

/**
 * Re-run matching for all tabs (after toggle or refresh).
 */
async function resyncAllTabs() {
  const tabs = await chrome.tabs.query({});
  for (const t of tabs) {
    if (!t.id || !t.url) continue;
    await syncTabScripts(t.id, t.url);
  }
}

async function cleanupScriptEverywhere(scriptId) {
  const tabs = await chrome.tabs.query({});
  for (const t of tabs) {
    if (!t.id) continue;
    try {
      await chrome.scripting.executeScript({
        target: { tabId: t.id, allFrames: false },
        world: "MAIN",
        func: donkeycodeCleanupMain,
        args: [scriptId],
      });
      log("cleanup dispatched", scriptId, "tab", t.id);
    } catch (e) {
      logWarn("cleanup failed for tab", t.id, e);
    }
    const set = tabInjectedScripts.get(t.id);
    if (set) set.delete(scriptId);
  }
}

async function toggleScript(scriptId, enabled) {
  const scripts = await getStoredScripts();
  const idx = scripts.findIndex((s) => s.id === scriptId);
  if (idx < 0) throw new Error("Script not found");
  scripts[idx].enabled = enabled;
  await saveScripts(scripts);
  log("toggle script", scriptId, enabled);

  if (!enabled) {
    await cleanupScriptEverywhere(scriptId);
  } else {
    forgetScriptEverywhere(scriptId);
    await resyncAllTabs();
  }
}

async function captureSessionSnapshot() {
  const wins = await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] });
  const snapshot = {
    windows: wins.map((w) => ({
      left: w.left,
      top: w.top,
      width: w.width,
      height: w.height,
      state: w.state,
      focused: w.focused,
      tabs: (w.tabs || []).map((t) => ({
        url: t.url || "",
        active: t.active,
        index: t.index,
        pinned: t.pinned,
      })),
    })),
  };
  return snapshot;
}

async function saveSession(name) {
  const trimmed = (name || "").trim();
  if (!trimmed) throw new Error("Session name required");
  const snap = await captureSessionSnapshot();
  const data = await chrome.storage.sync.get(STORAGE.SESSIONS);
  const sessions = data[STORAGE.SESSIONS] || {};
  sessions[trimmed] = snap;
  try {
    await chrome.storage.sync.set({ [STORAGE.SESSIONS]: sessions });
  } catch (e) {
    if (e && e.message && String(e.message).toLowerCase().includes("quota")) {
      logError(
        "sync quota exceeded saving session; reduce open tabs or remove old sessions",
        e
      );
    }
    throw e;
  }
  log("session saved", trimmed, "windows", snap.windows.length);
}

async function restoreSession(name) {
  const trimmed = (name || "").trim();
  if (!trimmed) throw new Error("Session name required");
  const data = await chrome.storage.sync.get(STORAGE.SESSIONS);
  const sessions = data[STORAGE.SESSIONS] || {};
  const snap = sessions[trimmed];
  if (!snap || !snap.windows) throw new Error("Session not found");

  for (const w of snap.windows) {
    const urls = (w.tabs || [])
      .sort((a, b) => (a.index || 0) - (b.index || 0))
      .map((t) => t.url)
      .filter(
        (u) =>
          u &&
          !u.startsWith("chrome-extension:") &&
          /^https?:\/\//i.test(u)
      );
    if (urls.length === 0) continue;

    const created = await chrome.windows.create({
      url: urls,
      left: w.left,
      top: w.top,
      width: w.width,
      height: w.height,
      focused: !!w.focused,
      state: w.state === "minimized" || w.state === "maximized" ? w.state : undefined,
    });

    if (created && created.tabs && w.tabs) {
      const activeIndex = w.tabs.findIndex((t) => t.active);
      if (activeIndex >= 0 && created.tabs[activeIndex]) {
        try {
          await chrome.tabs.update(created.tabs[activeIndex].id, { active: true });
        } catch (e) {
          logWarn("could not activate tab", e);
        }
      }
    }
  }
  log("session restored", trimmed);
}

async function deleteSession(name) {
  const trimmed = (name || "").trim();
  const data = await chrome.storage.sync.get(STORAGE.SESSIONS);
  const sessions = data[STORAGE.SESSIONS] || {};
  delete sessions[trimmed];
  await chrome.storage.sync.set({ [STORAGE.SESSIONS]: sessions });
  log("session deleted", trimmed);
}

async function getStateForPopup() {
  const scripts = await getStoredScripts();
  const sourceUrl = await getScriptSourceUrl();
  const extra = await getExtraUrls();
  const sessionsData = await chrome.storage.sync.get(STORAGE.SESSIONS);
  const sessions = sessionsData[STORAGE.SESSIONS] || {};
  const last = await chrome.storage.local.get(STORAGE.LAST_FETCH);
  return {
    scripts,
    scriptSourceUrl: sourceUrl,
    extraScriptUrls: extra.join("\n"),
    sessions: Object.keys(sessions).sort(),
    lastScriptFetch: last[STORAGE.LAST_FETCH] || null,
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    try {
      switch (message?.type) {
        case "GET_STATE": {
          const state = await getStateForPopup();
          sendResponse({ ok: true, ...state });
          break;
        }
        case "REFRESH_SCRIPTS": {
          log("refresh scripts requested");
          const scripts = await loadScriptsFromRemote();
          await resyncAllTabs();
          sendResponse({ ok: true, scripts });
          break;
        }
        case "SET_SCRIPT_ENABLED": {
          await toggleScript(message.scriptId, !!message.enabled);
          const scripts = await getStoredScripts();
          sendResponse({ ok: true, scripts });
          break;
        }
        case "SET_SCRIPT_SOURCE_URL": {
          const url = (message.url || "").trim();
          if (!url) throw new Error("URL required");
          await chrome.storage.sync.set({ [STORAGE.SCRIPT_SOURCE]: url });
          log("script source URL updated");
          const scripts = await loadScriptsFromRemote();
          await resyncAllTabs();
          sendResponse({ ok: true, scripts });
          break;
        }
        case "SET_EXTRA_SCRIPT_URLS": {
          const text = message.text || "";
          const lines = text
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter(Boolean);
          await chrome.storage.sync.set({ [STORAGE.EXTRA_URLS]: lines });
          log("extra URLs updated", lines.length);
          const scripts = await loadScriptsFromRemote();
          await resyncAllTabs();
          sendResponse({ ok: true, scripts });
          break;
        }
        case "SAVE_SESSION": {
          await saveSession(message.name);
          const sessionsData = await chrome.storage.sync.get(STORAGE.SESSIONS);
          const sessions = Object.keys(sessionsData[STORAGE.SESSIONS] || {}).sort();
          sendResponse({ ok: true, sessions });
          break;
        }
        case "RESTORE_SESSION": {
          await restoreSession(message.name);
          sendResponse({ ok: true });
          break;
        }
        case "DELETE_SESSION": {
          await deleteSession(message.name);
          const sessionsData = await chrome.storage.sync.get(STORAGE.SESSIONS);
          const sessions = Object.keys(sessionsData[STORAGE.SESSIONS] || {}).sort();
          sendResponse({ ok: true, sessions });
          break;
        }
        case "GM_XHR": {
          const scriptId = message.scriptId;
          const details = message.details || {};
          const reqUrl = details.url;
          const method = (details.method || "GET").toUpperCase();

          if (!scriptId || !reqUrl) {
            sendResponse({ error: "scriptId and url required" });
            break;
          }

          const scripts = await getStoredScripts();
          const script = scripts.find((s) => s.id === scriptId);
          if (!script) {
            logWarn("GM_XHR: unknown script", scriptId);
            sendResponse({ error: "Unknown script" });
            break;
          }

          const connects = script.connects || [];
          if (!urlAllowedByConnects(reqUrl, connects)) {
            logWarn("GM_XHR blocked by @connect", reqUrl, connects);
            sendResponse({ error: "URL not allowed by script @connect" });
            break;
          }

          log("GM_xmlhttpRequest", method, reqUrl, script.name);
          try {
            const init = { method, redirect: "follow" };
            if (details.headers && typeof details.headers === "object") {
              const h = new Headers();
              for (const k of Object.keys(details.headers)) {
                h.append(k, details.headers[k]);
              }
              init.headers = h;
            }
            const res = await fetch(reqUrl, init);
            const text = await res.text();
            log("GM_xmlhttpRequest done", res.status, reqUrl);
            sendResponse({
              responseText: text,
              status: res.status,
              statusText: res.statusText,
              finalUrl: res.url,
            });
          } catch (e) {
            logError("GM_xmlhttpRequest fetch failed", reqUrl, e);
            sendResponse({
              error: String(e && e.message ? e.message : e),
            });
          }
          break;
        }
        default:
          sendResponse({ ok: false, error: "Unknown message type" });
      }
    } catch (e) {
      logError("message handler error", e);
      sendResponse({ ok: false, error: String(e && e.message ? e.message : e) });
    }
  })();
  return true;
});

// Initial load
ensureDailyAlarm();
loadScriptsFromRemote().catch((e) => logError("initial load failed", e));
