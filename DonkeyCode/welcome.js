/**
 * First-run welcome page (extension context — can message background).
 */

function send(type, payload) {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage({ type, ...payload }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!response || !response.ok) {
          reject(new Error((response && response.error) || "Request failed"));
          return;
        }
        resolve(response);
      });
    } catch (e) {
      reject(e);
    }
  });
}

function setAccessStatus(ok, text) {
  const el = document.getElementById("access-status");
  if (!el) return;
  el.textContent = text;
  el.className = "status-line " + (ok ? "ok" : "warn");
}

async function refreshAccessState() {
  try {
    const state = await send("GET_STATE", {});
    if (state.hasHostAccess) {
      setAccessStatus(true, "Website access is on. You’re set for step 1.");
      const btn = document.getElementById("btn-allow");
      if (btn) {
        btn.textContent = "Access already granted";
        btn.disabled = true;
      }
    } else {
      setAccessStatus(false, "Not granted yet — click the button below.");
    }
  } catch (e) {
    setAccessStatus(false, String(e.message || e));
  }
}

document.getElementById("btn-allow").addEventListener("click", async function () {
  const btn = this;
  btn.disabled = true;
  try {
    const res = await send("REQUEST_HOST_ACCESS", {});
    if (res.hasHostAccess) {
      setAccessStatus(true, "Done. Website access is on.");
      btn.textContent = "Access granted";
    } else {
      setAccessStatus(false, "Permission was not granted. You can try again from the popup → Settings.");
      btn.disabled = false;
    }
  } catch (e) {
    setAccessStatus(false, String(e.message || e));
    btn.disabled = false;
  }
});

document.getElementById("btn-open-panel").addEventListener("click", function () {
  const url = chrome.runtime.getURL("popup/index.html");
  chrome.tabs.create({ url });
});

document.addEventListener("DOMContentLoaded", refreshAccessState);
