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
      setAccessStatus(false, "Permission was not granted. You can try again from the DonkeyCode popup → Settings.");
      btn.disabled = false;
    }
  } catch (e) {
    setAccessStatus(false, String(e.message || e));
    btn.disabled = false;
  }
});

document.getElementById("btn-get-started").addEventListener("click", async function () {
  const hint = document.getElementById("get-started-hint");
  const btn = this;
  btn.disabled = true;
  let opened = false;
  try {
    if (chrome.action && typeof chrome.action.openPopup === "function") {
      try {
        await chrome.action.openPopup();
        opened = true;
      } catch (e) {
        console.warn("[DonkeyCode:welcome] openPopup", e);
      }
    }
    await send("QUEUE_FIRST_POPUP_REFRESH", {});
    if (hint) {
      if (opened) {
        hint.textContent =
          "The DonkeyCode popup should be open — scripts will load automatically. You can leave or close this tab.";
      } else {
        hint.textContent =
          "Click the DonkeyCode icon in the toolbar (use the puzzle piece in step 2 if you don’t see it). Scripts refresh on first open.";
      }
    }
    try {
      const w = await chrome.windows.getCurrent();
      if (w && w.id != null) {
        await chrome.windows.update(w.id, { focused: true });
      }
    } catch (e) {
      /* ignore */
    }
  } catch (e) {
    if (hint) hint.textContent = String(e.message || e);
    btn.disabled = false;
  }
});

document.addEventListener("DOMContentLoaded", refreshAccessState);
