/**
 * First-run welcome page (extension context — can message background).
 * Must match STORAGE.PENDING_FIRST_POPUP_REFRESH in background.js
 */
const PENDING_FIRST_POPUP_REFRESH = "donkeycode_pending_first_popup_refresh";

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

document.getElementById("btn-get-started").addEventListener("click", function () {
  const hint = document.getElementById("get-started-hint");
  const btn = this;
  btn.disabled = true;
  if (hint) {
    hint.textContent = "Opening DonkeyCode…";
  }

  /**
   * `chrome.action.openPopup()` must run in the same user-gesture turn as the
   * click. Calling it inside `storage.local.set`’s callback loses the gesture.
   * Order: start openPopup synchronously, then persist the refresh flag.
   */
  let popupPromise = Promise.resolve(false);
  try {
    if (chrome.action && typeof chrome.action.openPopup === "function") {
      popupPromise = Promise.resolve(chrome.action.openPopup())
        .then(function () {
          return true;
        })
        .catch(function (e) {
          console.warn("[DonkeyCode:welcome] openPopup", e);
          return false;
        });
    }
  } catch (e) {
    console.warn("[DonkeyCode:welcome] openPopup sync", e);
    popupPromise = Promise.resolve(false);
  }

  try {
    chrome.storage.local.set({ [PENDING_FIRST_POPUP_REFRESH]: true }, function () {
      const err = chrome.runtime.lastError;
      if (err) {
        console.warn("[DonkeyCode:welcome] storage.set", err);
        if (hint) hint.textContent = String(err.message || err);
        btn.disabled = false;
        return;
      }
      popupPromise.then(function () {
        try {
          chrome.tabs.getCurrent(function (tab) {
            if (tab && tab.id != null) {
              chrome.tabs.remove(tab.id);
            }
          });
        } catch (e) {
          /* ignore */
        }
      });
    });
  } catch (e) {
    if (hint) hint.textContent = String(e.message || e);
    btn.disabled = false;
  }
});

document.addEventListener("DOMContentLoaded", refreshAccessState);
