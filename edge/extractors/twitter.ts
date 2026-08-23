import { fetchAsBrowser } from "./_fetch.ts";

// X/Twitter's public tweet pages heavily hide media from unauthenticated
// requests, but the syndication endpoint (used by embedded tweets) still
// returns clean JSON with media URLs. This is the same mechanism
// Twitter's own oEmbed uses, so it's stable and doesn't need auth.
//
// URL shape: https://cdn.syndication.twimg.com/tweet-result?id=<id>&token=<token>
// The token is derived from the tweet id (see makeSyndicationToken).

interface TwitterResult {
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

export async function resolveTwitter(url: string): Promise<TwitterResult> {
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

  const author = data?.user?.name || data?.user?.screen_name;
  const uploader = data?.user?.screen_name ? `@${data.user.screen_name}` : author;

  // Tweets can carry media in .video (single video), or .mediaDetails[]
  // (up to 4 items, mixed photos + one video).
  const videoObj = data?.video ??
    data?.mediaDetails?.find((m: { type?: string }) => m?.type === "video" || m?.type === "animated_gif");

  if (!videoObj) throw new Error("tweet has no video");

  const variants: Array<{ content_type?: string; bitrate?: number; url: string }> =
    videoObj?.variants ?? videoObj?.video_info?.variants ?? [];

  const mp4s = variants
    .filter((v) => v.content_type === "video/mp4" && !!v.url)
    .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0));

  if (mp4s.length === 0) throw new Error("no mp4 variants in tweet");

  const durationMs = videoObj?.durationMs ?? videoObj?.duration_millis;

  const formats = mp4s.slice(0, 4).map((v, i) => {
    const res = pickResolution(v.url);
    return {
      format_id: `mp4-${i}`,
      ext: "mp4",
      resolution: res,
      filesize: null,
      hasVideo: true,
      hasAudio: true,
      url: v.url,
    };
  });

  return {
    title: (data?.text as string)?.trim().slice(0, 120) || "Tweet video",
    thumbnail: videoObj?.poster || data?.mediaDetails?.[0]?.media_url_https,
    duration: durationMs ? Math.round(durationMs / 1000) : undefined,
    uploader,
    formats,
  };
}

function extractTweetId(url: string): string | null {
  const m = url.match(/status\/(\d{5,25})/);
  return m ? m[1] : null;
}

// Twitter's syndication endpoint requires a token computed from the tweet
// id. The algorithm is public (published after the endpoint locked down
// in 2023): (id / 1e15) * PI, then base36, then strip 0s and dots. Any
// wrong token gets a 404.
function makeSyndicationToken(id: string): string {
  const n = (Number(id) / 1e15) * Math.PI;
  return n.toString(36).replace(/(0+|\.)/g, "");
}

function pickResolution(url: string): string {
  // Twitter/X video URLs embed the resolution as /NxN/ in the path.
  const m = url.match(/\/(\d{2,4})x(\d{2,4})\//);
  return m ? `${m[2]}p` : "video";
}
