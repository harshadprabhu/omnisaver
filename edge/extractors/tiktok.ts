import { fetchAsBrowser, fetchAsBrowserWithCookies } from "./_fetch.ts";

// TikTok's video page embeds a large JSON blob under the id
// __UNIVERSAL_DATA_FOR_REHYDRATION__. Inside is (roughly):
//   default-scope["webapp.video-detail"].itemInfo.itemStruct
// which carries video URLs, music URLs, thumbnail, author, etc.
//
// Crucially, TikTok's Akamai CDN rejects requests for the extracted
// video URL unless they carry the ttwid + tt_chain_token cookies set
// by the initial page load, AND include Referer, Range, and
// sec-fetch-* headers. The streamTiktok function re-fetches the page
// (so cookies are fresh) then uses those cookies to pull the video.

interface TiktokFormat {
  format_id: string;
  ext: string;
  resolution: string;
  filesize: number | null;
  hasVideo: boolean;
  hasAudio: boolean;
}

export interface TiktokResolveResult {
  title: string;
  thumbnail?: string;
  duration?: number;
  uploader?: string;
  formats: TiktokFormat[];
}

export async function resolveTiktok(url: string): Promise<TiktokResolveResult> {
  const res = await fetchAsBrowser(url);
  const item = findItemStruct(parseRehydration(await res.text()));
  return summarize(item);
}

// Downloads a specific format's bytes with fresh cookies. Returns a
// Response the caller can stream straight to the client.
export async function streamTiktokFormat(
  pageUrl: string,
  formatId: string,
): Promise<Response> {
  const { text, cookies } = await fetchAsBrowserWithCookies(pageUrl);
  const item = findItemStruct(parseRehydration(text));
  const mediaUrl = pickFormatUrl(item, formatId);
  if (!mediaUrl) throw new Error(`format ${formatId} not present`);

  return await fetch(mediaUrl, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
      "accept": "*/*",
      "accept-language": "en-US,en;q=0.9",
      "referer": pageUrl,
      "range": "bytes=0-",
      "sec-fetch-dest": formatId === "audio" ? "audio" : "video",
      "sec-fetch-mode": "no-cors",
      "sec-fetch-site": "same-site",
      "cookie": cookies,
    },
  });
}

function summarize(item: TiktokItem): TiktokResolveResult {
  const video = item.video || {};
  const music = item.music || {};
  const author = item.author || {};
  const height = typeof video.height === "number" ? video.height : 0;
  const resolution = height ? `${height}p` : "video";

  const formats: TiktokFormat[] = [];
  if (video.downloadAddr) {
    formats.push({
      format_id: "download",
      ext: "mp4",
      resolution,
      filesize: null,
      hasVideo: true,
      hasAudio: true,
    });
  }
  if (video.playAddr) {
    formats.push({
      format_id: "play",
      ext: "mp4",
      resolution,
      filesize: null,
      hasVideo: true,
      hasAudio: true,
    });
  }
  if (music.playUrl) {
    formats.push({
      format_id: "audio",
      ext: "mp3",
      resolution: "audio",
      filesize: null,
      hasVideo: false,
      hasAudio: true,
    });
  }
  if (formats.length === 0) throw new Error("no downloadable formats found");

  return {
    title: item.desc || "TikTok video",
    thumbnail: video.cover || video.dynamicCover || video.originCover,
    duration: typeof video.duration === "number" ? video.duration : undefined,
    uploader: author.uniqueId ? `@${author.uniqueId}` : author.nickname,
    formats,
  };
}

function pickFormatUrl(item: TiktokItem, formatId: string): string | undefined {
  const v = item.video || {};
  const m = item.music || {};
  if (formatId === "download") return v.downloadAddr;
  if (formatId === "play") return v.playAddr;
  if (formatId === "audio") return m.playUrl;
  return undefined;
}

function parseRehydration(html: string): unknown {
  const marker = '__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">';
  const start = html.indexOf(marker);
  if (start === -1) throw new Error("no rehydration marker in page");
  const jsonStart = start + marker.length;
  const jsonEnd = html.indexOf("</script>", jsonStart);
  if (jsonEnd === -1) throw new Error("truncated rehydration script");
  return JSON.parse(html.slice(jsonStart, jsonEnd));
}

interface TiktokItem {
  desc?: string;
  video?: {
    playAddr?: string;
    downloadAddr?: string;
    cover?: string;
    dynamicCover?: string;
    originCover?: string;
    height?: number;
    duration?: number;
  };
  music?: { playUrl?: string };
  author?: { uniqueId?: string; nickname?: string };
}

// deno-lint-ignore no-explicit-any
function findItemStruct(data: any): TiktokItem {
  const scope = data?.["__DEFAULT_SCOPE__"] ?? data?.default_scope ?? {};
  const detail = scope?.["webapp.video-detail"];
  const item = detail?.itemInfo?.itemStruct;
  if (!item) throw new Error("no itemStruct in tiktok page");
  return item;
}
