// Where the edge extraction service lives.
//
// - Empty string: use same-origin API (local dev with `npm start`, or
//   any future backend served from the same domain).
// - Full URL: cross-origin (e.g. the Deno Deploy URL for the GitHub
//   Pages preview).
//
// The GitHub Pages deploy workflow (see .github/workflows/deploy-pages.yml)
// rewrites this file at build time from the OMNISAVER_EDGE_BASE repo
// variable so the deployed preview points at the deployed edge service.
window.OMNISAVER_EDGE_BASE = '';
