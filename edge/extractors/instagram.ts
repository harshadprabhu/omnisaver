import { fetchAsBrowser } from "./_fetch.ts";

// Instagram no longer serves logged-out users the video JSON blob it once
// did — but public reels and posts still expose the direct video URL
// through Open Graph meta tags on the shareable /reel/, /p/, or /tv/
// pages. We fetch the page, pull og:video (and og:image for the
// thumbnail), and hand those to the client.
//
// This intentionally covers only public content — carousels, login-gated
// posts, and Stories will fail here. The message the /api/resolve
// endpoint returns already tells users that's the current limit.

interface InstagramResult {
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

export async function resolveInstagram(url: string): Promise<InstagramResult> {
  // Normalize to strip query strings / trackers so we hit a stable canonical page.
  const clean = normalizeInstagramUrl(url);
  const res = await fetchAsBrowser(clean);
  const html = await res.text();

  const videoUrl = getMetaContent(html, "og:video") ??
    getMetaContent(html, "og:video:secure_url");
  if (!videoUrl) {
    throw new Error("no og:video (post may be private, login-gated, or a carousel)");
  }
  const thumbnail = getMetaContent(html, "og:image");
  const title = (getMetaContent(html, "og:title") ?? "Instagram post").trim();
  const description = getMetaContent(html, "og:description");
  const uploader = extractUploader(title, description);

  return {
    title: description?.split(":")[1]?.trim().slice(0, 120) || title,
    thumbnail,
    uploader,
    formats: [
      {
        format_id: "mp4",
        ext: "mp4",
        resolution: "video",
        filesize: null,
        hasVideo: true,
        hasAudio: true,
        url: videoUrl,
      },
    ],
  };
}

function normalizeInstagramUrl(url: string): string {
  try {
    const u = new URL(url);
    // Keep only /p/xxxxx/, /reel/xxxxx/, or /tv/xxxxx/ paths.
    const m = u.pathname.match(/^\/(?:p|reel|tv|reels)\/([^/]+)/);
    if (!m) return url;
    return `https://www.instagram.com/${
      u.pathname.split("/")[1] === "reels" ? "reel" : u.pathname.split("/")[1]
    }/${m[1]}/`;
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
  // Instagram's og:title looks like: "Name on Instagram: ..." or "@handle • Instagram video".
  const handleMatch = (description ?? title).match(/@([A-Za-z0-9._]{2,30})/);
  if (handleMatch) return `@${handleMatch[1]}`;
  const nameMatch = title.match(/^(.+?)\s+on\s+Instagram/);
  return nameMatch ? nameMatch[1].trim() : undefined;
}
