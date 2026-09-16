// OmniSaver edge service.
//
// Runs on Deno Deploy (free tier: 1M requests/month, 100 GB egress).
// PROXIES video/audio bytes from platform CDNs to the user, because
// platform CDNs (TikTok/Akamai especially) reject direct browser
// requests: they check the client IP, the Referer, and session
// cookies established by the initial page load. Only a request from
// the same instance that extracted the URL, with the same cookies,
// works. Bytes are streamed (not buffered), so a video download uses
// no per-request memory beyond a small pipe buffer.
//
// Endpoints:
//   POST /api/resolve   { url } -> metadata + list of formats
//   GET  /api/download  ?u=<b64>&t=<hmac> -> streams the file
//   GET  /api/health, /api/support -> operational

import { serveDir } from "jsr:@std/http@1/file-server";
import { resolveTiktok, streamTiktokFormat } from "./extractors/tiktok.ts";
import { resolveTwitter, streamTwitterFormat } from "./extractors/twitter.ts";
import { resolveInstagram, streamInstagramFormat } from "./extractors/instagram.ts";

const PUBLIC_DIR = new URL("../public", import.meta.url).pathname;

// Per-instance secret used to sign the download URLs the frontend
// receives, so /api/download can't be turned into an open web proxy.
// Randomly generated at boot; set OMNISAVER_SIGN_SECRET to a stable
// value in production so signed URLs survive restarts.
const SIGN_SECRET = Deno.env.get("OMNISAVER_SIGN_SECRET") ||
  crypto.randomUUID() + crypto.randomUUID();

interface ExtractorFormat {
  format_id: string;
  ext: string;
  resolution: string;
  filesize: number | null;
  hasVideo: boolean;
  hasAudio: boolean;
}
interface ExtractorResult {
  title: string;
  thumbnail?: string;
  duration?: number;
  uploader?: string;
  formats: ExtractorFormat[];
}
type Resolver = (url: string) => Promise<ExtractorResult>;
type Streamer = (pageUrl: string, formatId: string) => Promise<Response>;

const EXTRACTORS: Array<{
  id: string;
  label: string;
  test: RegExp;
  resolve: Resolver;
  stream: Streamer;
}> = [
  {
    id: "tiktok",
    label: "TikTok",
    test: /tiktok\.com/i,
    resolve: resolveTiktok,
    stream: streamTiktokFormat,
  },
  {
    id: "twitter",
    label: "X / Twitter",
    test: /(?:twitter\.com|x\.com)/i,
    resolve: resolveTwitter,
    stream: streamTwitterFormat,
  },
  {
    id: "instagram",
    label: "Instagram",
    test: /instagram\.com/i,
    resolve: resolveInstagram,
    stream: streamInstagramFormat,
  },
];

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

// --- URL signing (base64url + HMAC-SHA256 via SubtleCrypto) ---------------

function b64urlEncode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
function b64urlDecode(s: string): Uint8Array {
  s = s.replaceAll("-", "+").replaceAll("_", "/");
  while (s.length % 4) s += "=";
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}
async function hmacSign(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SIGN_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)),
  );
  return b64urlEncode(sig);
}
async function signDownload(
  pageUrl: string,
  platform: string,
  formatId: string,
  ext: string,
): Promise<string> {
  const payload = JSON.stringify({ p: platform, f: formatId, e: ext, u: pageUrl });
  const u = b64urlEncode(new TextEncoder().encode(payload));
  const t = await hmacSign(payload);
  return `/api/download?u=${u}&t=${t}`;
}
async function verifyDownload(
  u: string,
  t: string,
): Promise<{ pageUrl: string; platform: string; formatId: string; ext: string } | null> {
  try {
    const payload = new TextDecoder().decode(b64urlDecode(u));
    if (await hmacSign(payload) !== t) return null;
    const { p, f, e, u: pageUrl } = JSON.parse(payload);
    if (!p || !f || !e || !pageUrl) return null;
    return { platform: p, formatId: f, ext: e, pageUrl };
  } catch {
    return null;
  }
}

// --- Server ---------------------------------------------------------------

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
          ? "YouTube support is coming in a later release. For now, try TikTok, X or public Instagram Reels."
          : /(?:facebook\.com|fb\.watch)/i.test(target)
          ? "Facebook support is coming in a later release. For now, try TikTok, X or public Instagram Reels."
          : null;
      return json(422, {
        error: notYet ?? "Unrecognized link. Supported today: TikTok, X/Twitter, Instagram.",
      });
    }
    try {
      const result = await match.resolve(target);
      const formats = await Promise.all(result.formats.map(async (f) => ({
        ...f,
        url: await signDownload(target, match.id, f.format_id, f.ext),
      })));
      return json(200, {
        platform: match.id,
        platformLabel: match.label,
        title: result.title,
        thumbnail: result.thumbnail,
        duration: result.duration,
        uploader: result.uploader,
        formats,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[${match.id}] resolve failed for ${target}:`, msg);
      return json(502, {
        error:
          "Couldn't fetch this link. It may be private, deleted, or the platform changed its page structure.",
      });
    }
  }

  if (url.pathname === "/api/download" && req.method === "GET") {
    const u = url.searchParams.get("u") ?? "";
    const t = url.searchParams.get("t") ?? "";
    const decoded = await verifyDownload(u, t);
    if (!decoded) return new Response("Invalid or expired download link", { status: 400 });

    const match = EXTRACTORS.find((e) => e.id === decoded.platform);
    if (!match) return new Response("Unknown platform", { status: 400 });

    let upstream: Response;
    try {
      upstream = await match.stream(decoded.pageUrl, decoded.formatId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[${decoded.platform}] stream failed:`, msg);
      return new Response(`Couldn't fetch upstream: ${msg}`, { status: 502 });
    }
    if (!upstream.ok || !upstream.body) {
      return new Response(
        `Upstream ${upstream.status} — link may have expired, try Fetch again.`,
        { status: 502 },
      );
    }

    const outHeaders = new Headers({
      "content-type": upstream.headers.get("content-type") ||
        (decoded.ext === "mp3" ? "audio/mpeg" : "video/mp4"),
      "content-disposition": `attachment; filename="omnisaver-${decoded.platform}.${decoded.ext}"`,
      "access-control-allow-origin": "*",
      "cache-control": "no-store",
    });
    const len = upstream.headers.get("content-length");
    if (len) outHeaders.set("content-length", len);

    return new Response(upstream.body, { status: 200, headers: outHeaders });
  }

  // Anything else falls through to the static frontend under public/.
  return serveDir(req, { fsRoot: PUBLIC_DIR, quiet: true });
});
