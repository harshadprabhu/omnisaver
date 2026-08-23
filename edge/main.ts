// OmniSaver edge extraction service.
//
// Runs on Deno Deploy (free tier: 1M requests/month, 100 GB egress).
// Returns direct media URLs so the client browser downloads straight
// from the platform's CDN — this service never sees the video bytes,
// only ~200KB of platform HTML per resolve.
//
// Frontend calls POST /api/resolve with { url }. Response shape matches
// what public/app.js expects (see README for the contract).

import { resolveTiktok } from "./extractors/tiktok.ts";
import { resolveTwitter } from "./extractors/twitter.ts";
import { resolveInstagram } from "./extractors/instagram.ts";

// Extractors return everything except the platform id/label; those are
// stamped on by the dispatcher below based on which pattern matched.
interface ExtractedResult {
  title: string;
  thumbnail?: string;
  duration?: number;
  uploader?: string;
  formats: Array<{
    format_id: string;
    ext: string;
    resolution: string;
    filesize: number | null;
    hasVideo: boolean;
    hasAudio: boolean;
    url: string;
  }>;
}
type Extractor = (url: string) => Promise<ExtractedResult>;

const EXTRACTORS: Array<{ id: string; label: string; test: RegExp; fn: Extractor }> = [
  { id: "tiktok", label: "TikTok", test: /tiktok\.com/i, fn: resolveTiktok },
  { id: "twitter", label: "X / Twitter", test: /(?:twitter\.com|x\.com)/i, fn: resolveTwitter },
  { id: "instagram", label: "Instagram", test: /instagram\.com/i, fn: resolveInstagram },
];

// Platforms recognized by the frontend chip strip but not yet extractable
// server-side. Kept here so the /api/support endpoint can report a single
// source of truth to the UI, avoiding drift.
const NOT_YET_SUPPORTED = new Set(["youtube", "facebook"]);

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS_HEADERS },
  });
}

function isHttpUrl(value: string): boolean {
  if (!value || value.length > 2000) return false;
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  const url = new URL(req.url);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (url.pathname === "/api/health") {
    return json(200, { ok: true, extractors: EXTRACTORS.map((e) => e.id) });
  }

  if (url.pathname === "/api/support") {
    return json(200, {
      supported: EXTRACTORS.map((e) => e.id),
      comingSoon: [...NOT_YET_SUPPORTED],
    });
  }

  if (url.pathname === "/api/resolve" && req.method === "POST") {
    let body: { url?: string };
    try {
      body = await req.json();
    } catch {
      return json(400, { error: "Body must be JSON." });
    }
    const target = String(body?.url || "").trim();
    if (!isHttpUrl(target)) {
      return json(400, { error: "Paste a valid link starting with http(s)://" });
    }
    const match = EXTRACTORS.find((e) => e.test.test(target));
    if (!match) {
      const notYet =
        /(?:youtube\.com|youtu\.be)/i.test(target)
          ? "YouTube support is coming in a later release. For now, try Instagram, TikTok, or X."
          : /(?:facebook\.com|fb\.watch)/i.test(target)
          ? "Facebook support is coming in a later release. For now, try Instagram, TikTok, or X."
          : null;
      return json(422, {
        error: notYet ?? "Unrecognized link. Supported today: TikTok, X/Twitter, Instagram.",
      });
    }
    try {
      const result = await match.fn(target);
      return json(200, { ...result, platform: match.id, platformLabel: match.label });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Log for Deno Deploy's dashboard so we can see extractor failures
      // in real traffic without exposing internals to the client.
      console.error(`[${match.id}] resolve failed for ${target}:`, msg);
      return json(502, {
        error:
          "Couldn't fetch this link. It may be private, deleted, or the platform changed its page structure.",
      });
    }
  }

  return new Response("Not found", { status: 404, headers: CORS_HEADERS });
});
