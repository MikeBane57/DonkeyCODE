/**
 * ISOLATED world: forwards GM_xmlhttpRequest from the page (MAIN) to the
 * service worker and posts the response back. Page posts DONKEYCODE_GM_XHR.
 * Also forwards DONKEYCODE_PAGE_LOG so MAIN-world diagnostics do not appear
 * in the site DevTools console.
 */
(function () {
  "use strict";

  window.addEventListener("message", function (ev) {
    if (ev.source !== window) return;
    const d = ev.data;
    if (!d || !d.type) return;

    if (d.type === "DONKEYCODE_GM_XHR") {
      chrome.runtime.sendMessage(
        { type: "GM_XHR", id: d.id, scriptId: d.scriptId, details: d.details },
        function (response) {
          if (chrome.runtime.lastError) {
            window.postMessage(
              {
                type: "DONKEYCODE_GM_XHR_RESPONSE",
                id: d.id,
                error: chrome.runtime.lastError.message,
              },
              "*"
            );
            return;
          }
          window.postMessage(
            {
              type: "DONKEYCODE_GM_XHR_RESPONSE",
              id: d.id,
              responseText: response && response.responseText,
              status: response && response.status,
              statusText: response && response.statusText,
              finalUrl: response && response.finalUrl,
              error: response && response.error,
            },
            "*"
          );
        }
      );
      return;
    }

    if (d.type === "DONKEYCODE_PAGE_LOG") {
      chrome.runtime.sendMessage({
        type: "PAGE_LOG",
        scriptId: d.scriptId || "",
        level: d.level || "log",
        parts: Array.isArray(d.parts) ? d.parts : [],
      });
    }
  });
})();
