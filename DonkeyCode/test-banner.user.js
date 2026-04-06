// ==UserScript==
// @name         DonkeyCode Test Banner
// @namespace    https://github.com/MikeBane57/DonkeyCODE
// @version      1.0.0
// @description  Verifies DonkeyCode injection and cleanup wiring
// @match        *://*/*
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  console.log("[DonkeyCode:test-banner] script running on", window.location.href);

  var el = document.createElement("div");
  el.textContent = "DonkeyCode test banner (remove via popup toggle)";
  el.setAttribute("data-donkeycode-test-banner", "1");
  el.style.cssText =
    "position:fixed;z-index:2147483647;left:8px;bottom:8px;padding:8px 12px;" +
    "background:#2d6a4f;color:#fff;font:13px/1.3 system-ui,sans-serif;" +
    "border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,.25);";

  document.documentElement.appendChild(el);

  __myScriptCleanup = function () {
    console.log("[DonkeyCode:test-banner] cleanup on", window.location.href);
    if (el && el.parentNode) {
      el.parentNode.removeChild(el);
    }
  };
})();
