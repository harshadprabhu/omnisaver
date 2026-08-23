# OmniSaver

A multiplatform video/reel/audio downloader. Paste a link, it auto-detects the
platform (YouTube, Instagram, Facebook, TikTok, X/Twitter), and offers MP4
(by quality) or MP3 (audio-only) downloads. Includes ad slot placeholders for
monetization.

## How it works

- **Frontend** (`public/`) — plain HTML/CSS/JS. Detects the platform
  client-side (for instant UI feedback) and calls the backend to do the
  actual work.
- **Backend** (`server/index.js`) — a small Express server that shells out to
  [`yt-dlp`](https://github.com/yt-dlp/yt-dlp), the open-source,
  actively-maintained extractor that most link-based downloader sites are
  built on under the hood. It:
  - `POST /api/resolve` — runs `yt-dlp -j <url>` to get title/thumbnail/duration
    and the list of available formats.
  - `GET /api/download` — streams `yt-dlp`'s output straight to the browser
    (`-f <format_id>` for video, `-x --audio-format mp3` for audio), so no
    file is ever written to disk on the server.

This **cannot run as a static site** — it needs a real process to run
`yt-dlp`/`ffmpeg`. This is unavoidable, not a hosting preference: a browser
tab can't fetch `youtube.com`/`instagram.com` pages directly (CORS blocks
cross-origin reads of their HTML), and YouTube's stream URLs are hidden
behind a signature cipher that has to be executed against their player code
— which is exactly what `yt-dlp` does server-side. The MP4/MP3 conversion
itself is a solved, no-storage streaming pipe (nothing is ever written to
disk), but *resolving the link* needs a backend.

For a **public site serving other people's traffic**, that backend needs to
run somewhere reachable 24/7 — Render, Railway, Fly.io, a VPS, or any host
that runs the included `Dockerfile`. Static hosts (GitHub Pages, Netlify
static, etc.) won't work.

## Local setup

```bash
# System dependencies
# macOS: brew install yt-dlp ffmpeg
# Ubuntu/Debian: sudo apt install ffmpeg && sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && sudo chmod +x /usr/local/bin/yt-dlp

npm install
npm start
# open http://localhost:3000
```

## Docker

```bash
docker build -t omnisaver .
docker run -p 3000:3000 omnisaver
```

## Monetization / ad slots

Ad containers are already placed in `public/index.html` (look for
`class="ad-slot"`): a top leaderboard, an in-content rectangle after results,
a sticky sidebar (desktop), a footer banner, and an interstitial slot shown
for a few seconds before each download starts (`runInterstitial` in
`app.js`) — this "wait, then download" pattern is the standard revenue model
for this category of site, since the interstitial gets its own ad impression.

**Google AdSense will very likely reject or suspend a site in this niche** —
its program policies explicitly prohibit sites that facilitate unauthorized
downloading of copyrighted third-party content. Don't apply this domain to
an AdSense account you use elsewhere — a policy action here can carry over
to everything else on that account. Networks that commonly do accept
downloader/converter sites:

- PropellerAds
- Adsterra
- ExoClick
- Media.net (contextual, more selective)

To wire one in, drop that network's script tag in `<head>` of
`public/index.html` and replace the placeholder `<div class="ad-slot">`
contents with that network's ad unit code/iframe.

## Legal note

This tool only fetches what the target platform's page already serves
publicly (the same thing a browser does when it plays the video) — it does
not bypass logins, paywalls, or DRM. That said, downloading and
redistributing content you don't own or have rights to can still violate
each platform's Terms of Service and copyright law in your jurisdiction.
The footer disclaimer in the UI reflects this; keep it, and don't represent
this as a bulk/commercial scraping tool.

## Production hardening (already in place)

Since this is meant to serve public traffic, `server/index.js` includes:

- **Per-IP rate limiting** on both `/api/resolve` and `/api/download`
  (`RESOLVE_RATE_LIMIT` / `DOWNLOAD_RATE_LIMIT` env vars, default 30 / 20
  requests per 15 minutes). `trust proxy` is enabled so this reads the real
  client IP through a reverse proxy/load balancer instead of the proxy's IP.
- **A concurrency cap** (`MAX_CONCURRENT_JOBS`, default 4) on how many
  `yt-dlp` subprocesses can run at once — each request is a real OS process,
  so this is what stops a burst of traffic from exhausting CPU/RAM/bandwidth.
  Requests beyond the cap get a `503` instead of queuing indefinitely.
- **Timeouts** on the subprocess itself (`RESOLVE_TIMEOUT_MS` default 30s,
  `DOWNLOAD_TIMEOUT_MS` default 10 min) so a stuck `yt-dlp` call can't hold
  a job slot forever.
- Input validation on the pasted URL and `format_id` before either is ever
  handed to `yt-dlp`.

Still worth adding before a real public launch: HTTPS (usually handled by
the hosting platform automatically), structured logging/monitoring so you
notice when a platform breaks extraction, and a basic abuse/legal contact
(takedown requests will happen — see Legal note above).

## Known limitations

- **WhatsApp is not supported and can't be** — there's no public URL for
  media shared over WhatsApp the way there is for a YouTube/Instagram post,
  so a paste-a-link tool has nothing to fetch.
- Instagram/Facebook/TikTok regularly change their page structure; keep
  `yt-dlp` updated (`yt-dlp -U`, or rebuild the Docker image) when
  extraction starts failing for a platform.
