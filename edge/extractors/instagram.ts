import { fetchAsBrowser } from "./_fetch.ts";

// Instagram exposes the direct video URL through Open Graph meta tags
// on public /reel/, /p/, or /tv/ pages. Facebook/Instagram CDN URLs
// (scontent-*.cdninstagram.com) accept plain browser-header requests
// from any origin, so streaming works without cookie plumbing.
//
// This intentionally covers only public content — carousels, login-
// gated posts, and Stories will fail here.

interface InstagramFormat {
  format_id: string;
  ext: string;
  resolution: string;
  filesize: number | null;
  hasVideo: boolean;
  hasAudio: boolean;
}

export interface InstagramResolveResult {
  title: string;
  thumbnail?: string;
  duration?: number;
  uploader?: string;
  formats: InstagramFormat[];
}

export async function resolveInstagram(url: string): Promise<InstagramResolveResult> {
  const { meta } = await extract(url);
  return {
    title: meta.title,
    thumbnail: meta.thumbnail,
    uploader: meta.uploader,
    formats: [
      { format_id: "mp4", ext: "mp4", resolution: "video", filesize: null, hasVideo: true, hasAudio: true },
    ],
  };
}

export async function streamInstagramFormat(pageUrl: string, formatId: string): Promise<Response> {
  if (formatId !== "mp4") throw new Error(`format ${formatId} not present`);
  const { videoUrl } = await extract(pageUrl);
  return await fetch(videoUrl, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
      "referer": "https://www.instagram.com/",
      "range": "bytes=0-",
    },
  });
}

async function extract(url: string): Promise<{
  videoUrl: string;
  meta: { title: string; thumbnail?: string; uploader?: string };
}> {
  const clean = normalizeInstagramUrl(url);
  const res = await fetchAsBrowser(clean);
  const html = await res.text();

  const videoUrl = getMetaContent(html, "og:video") ??
    getMetaContent(html, "og:video:secure_url");
  if (!videoUrl) {
    throw new Error("no og:video (post may be private, login-gated, or a carousel)");
  }
  const thumbnail = getMetaContent(html, "og:image");
  const rawTitle = (getMetaContent(html, "og:title") ?? "Instagram post").trim();
  const description = getMetaContent(html, "og:description");

  return {
    videoUrl,
    meta: {
      title: description?.split(":")[1]?.trim().slice(0, 120) || rawTitle,
      thumbnail,
      uploader: extractUploader(rawTitle, description),
    },
  };
}

function normalizeInstagramUrl(url: string): string {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/^\/(?:p|reel|tv|reels)\/([^/]+)/);
    if (!m) return url;
    const kind = u.pathname.split("/")[1] === "reels" ? "reel" : u.pathname.split("/")[1];
    return `https://www.instagram.com/${kind}/${m[1]}/`;
  } catch {
    return url;
  }
}

function getMetaContent(html: string, property: string): string | undefined {
  const re = new RegExp(
    `<meta[^>]+property=["']${property}["'][^>]*content=["']([^"']+)["']`,
    "i",
  );
  const m = html.match(re);
  if (m) return decodeEntities(m[1]);
  const reAlt = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]*property=["']${property}["']`,
    "i",
  );
  const m2 = html.match(reAlt);
  return m2 ? decodeEntities(m2[1]) : undefined;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, "/");
}

function extractUploader(title: string, description?: string): string | undefined {
  const handleMatch = (description ?? title).match(/@([A-Za-z0-9._]{2,30})/);
  if (handleMatch) return `@${handleMatch[1]}`;
  const nameMatch = title.match(/^(.+?)\s+on\s+Instagram/);
  return nameMatch ? nameMatch[1].trim() : undefined;
}
