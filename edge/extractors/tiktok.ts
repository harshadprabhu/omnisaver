import { fetchAsBrowser } from "./_fetch.ts";

// TikTok's video page embeds a large JSON blob under the id
// __UNIVERSAL_DATA_FOR_REHYDRATION__. Inside is (roughly):
//   default-scope["webapp.video-detail"].itemInfo.itemStruct
// which carries video URLs, music URLs, thumbnail, author, etc.
//
// TikTok also occasionally serves a shorter/redirect URL form
// (vm.tiktok.com/xxx or /t/xxx) — fetchAsBrowser follows redirects,
// so a short URL resolves to the canonical /video/id form before we
// parse.

interface TiktokResult {
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

export async function resolveTiktok(url: string): Promise<TiktokResult> {
  const res = await fetchAsBrowser(url);
  const html = await res.text();
  const data = extractRehydrationData(html);
  const item = findItemStruct(data);
  if (!item) throw new Error("no itemStruct in tiktok page");

  const video = item.video || {};
  const music = item.music || {};
  const author = item.author || {};

  const height = typeof video.height === "number" ? video.height : 0;
  const resolution = height ? `${height}p` : "video";

  const formats: TiktokResult["formats"] = [];
  const playAddr: string | undefined = video.playAddr;
  const downloadAddr: string | undefined = video.downloadAddr;

  // downloadAddr is the version TikTok itself serves for the "Save video"
  // menu — usually watermarked. playAddr is the version the site plays
  // inline. We list both when they differ so users can pick.
  if (downloadAddr) {
    formats.push({
      format_id: "download",
      ext: "mp4",
      resolution,
      filesize: video.bitrate ? Math.round(video.bitrate * (video.duration || 15) / 8) : null,
      hasVideo: true,
      hasAudio: true,
      url: downloadAddr,
    });
  }
  if (playAddr && playAddr !== downloadAddr) {
    formats.push({
      format_id: "play",
      ext: "mp4",
      resolution,
      filesize: null,
      hasVideo: true,
      hasAudio: true,
      url: playAddr,
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
      url: music.playUrl,
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

function extractRehydrationData(html: string): unknown {
  const marker = '__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">';
  const start = html.indexOf(marker);
  if (start === -1) throw new Error("no rehydration marker in page");
  const jsonStart = start + marker.length;
  const jsonEnd = html.indexOf("</script>", jsonStart);
  if (jsonEnd === -1) throw new Error("truncated rehydration script");
  return JSON.parse(html.slice(jsonStart, jsonEnd));
}

// deno-lint-ignore no-explicit-any
function findItemStruct(data: any): any | null {
  const scope = data?.["__DEFAULT_SCOPE__"] ?? data?.default_scope ?? {};
  const detail = scope?.["webapp.video-detail"];
  return detail?.itemInfo?.itemStruct ?? null;
}
