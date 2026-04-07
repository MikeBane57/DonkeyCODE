/**
 * Template for baked GitHub sync defaults (no secrets).
 * Run: npm run build (from repo root) or node scripts/build-baked-config.mjs
 * That generates baked-config.js from env vars (gitignored).
 */
self.BAKED_GITHUB_DEFAULTS = {
  token: "",
  owner: "",
  repo: "",
  branch: "main",
  path: "sessions/donkeycode-sessions.json",
};
