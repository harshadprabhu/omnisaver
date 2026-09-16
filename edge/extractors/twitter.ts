import { fetchAsBrowser } from "./_fetch.ts";

// X/Twitter's syndication endpoint (the same one embedded tweets use)
// returns clean JSON with direct MP4 variant URLs from
// video.twimg.com. Those CDN URLs are more permissive than TikTok's —
// no session-cookie requirement — so streaming works with plain
// browser-like headers.

interface TwitterFormat {
  format_id: string;
  ext: string;
  resolution: string;
  filesize: number | null;
  hasVideo: boolean;
  hasAudio: boolean;
}

export interface TwitterResolveResult {
  title: string;
  thumbnail?: string;
  duration?: number;
  uploader?: string;
  formats: TwitterFormat[];
}

export async function resolveTwitter(url: string): Promise<TwitterResolveResult> {
  const { formats, meta } = await extract(url);
  return {
    title: meta.title,
    thumbnail: meta.thumbnail,
    duration: meta.duration,
    uploader: meta.uploader,
    formats: formats.map(({ url: _u, ...f }) => f),
  };
}

export async function streamTwitterFormat(
  pageUrl: string,
  formatId: string,
): Promise<Response> {
  const { formats } = await extract(pageUrl);
  const match = formats.find((f) => f.format_id === formatId);
  if (!match) throw new Error(`format ${formatId} not present`);
  return await fetch(match.url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
      "referer": pageUrl,
      "range": "bytes=0-",
    },
  });
}

async function extract(url: string): Promise<{
  formats: Array<TwitterFormat & { url: string }>;
  meta: { title: string; thumbnail?: string; duration?: number; uploader?: string };
}> {
  const id = extractTweetId(url);
  if (!id) throw new Error("no tweet id in url");
  const token = makeSyndicationToken(id);
  const apiUrl =
    `https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${token}&lang=en`;
  const res = await fetchAsBrowser(apiUrl, {
    headers: { accept: "application/json" },
  });
  // deno-lint-ignore no-explicit-any
  const data: any = await res.json();

  const uploader = data?.user?.screen_name
    ? `@${data.user.screen_name}`
    : data?.user?.name;

  const videoObj = data?.video ??
    data?.mediaDetails?.find((m: { type?: string }) =>
      m?.type === "video" || m?.type === "animated_gif"
    );
  if (!videoObj) throw new Error("tweet has no video");

  const variants: Array<{ content_type?: string; bitrate?: number; url: string }> =
    videoObj?.variants ?? videoObj?.video_info?.variants ?? [];
  const mp4s = variants
    .filter((v) => v.content_type === "video/mp4" && !!v.url)
    .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0));
  if (mp4s.length === 0) throw new Error("no mp4 variants in tweet");

  const durationMs = videoObj?.durationMs ?? videoObj?.duration_millis;

  const formats = mp4s.slice(0, 4).map((v, i) => ({
    format_id: `mp4-${i}`,
    ext: "mp4",
    resolution: pickResolution(v.url),
    filesize: null,
    hasVideo: true,
    hasAudio: true,
    url: v.url,
  }));

  return {
    formats,
    meta: {
      title: ((data?.text as string) ?? "").trim().slice(0, 120) || "Tweet video",
      thumbnail: videoObj?.poster || data?.mediaDetails?.[0]?.media_url_https,
      duration: durationMs ? Math.round(durationMs / 1000) : undefined,
      uploader,
    },
  };
}

function extractTweetId(url: string): string | null {
  const m = url.match(/status\/(\d{5,25})/);
  return m ? m[1] : null;
}

function makeSyndicationToken(id: string): string {
  const n = (Number(id) / 1e15) * Math.PI;
  return n.toString(36).replace(/(0+|\.)/g, "");
}

function pickResolution(url: string): string {
  const m = url.match(/\/(\d{2,4})x(\d{2,4})\//);
  return m ? `${m[2]}p` : "video";
}
