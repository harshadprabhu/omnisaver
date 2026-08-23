// Repo-root entrypoint for Deno Deploy's auto-detection.
// The real server lives in edge/main.ts — this shim just re-exports it
// so Deno Deploy projects that scan the repo root for `main.ts` pick it
// up without needing a manual entrypoint setting.
import "./edge/main.ts";
