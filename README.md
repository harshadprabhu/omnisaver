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

## Design system

Root `/` is a minimal, app-like single card: paste a link, one primary
action, live platform-detection status line (a colored dot + label that
updates as you type — the one signature interaction on the page), results,
one ad slot. No marketing sections, no FAQ, no long copy — that all lives at
`/learn/` (see below) so the tool itself stays fast and uncluttered on
mobile and reads as a proper small website on tablet/laptop (`@media
(min-width:820px)` widens the column and padding).

Tokens live at the top of `style.css`: a cool-neutral paper background with
a warm amber accent (light theme by default, full `prefers-color-scheme:
dark` variant included), Space Grotesk for the headline, Inter for UI text,
and JetBrains Mono specifically for data — the URL input, duration, file
size, resolution — since this tool's whole job is precise data in, file out.

## SEO

Long-form content — "how it works", supported platforms, why-OmniSaver,
and the full FAQ (with its `FAQPage` JSON-LD, matched to the visible
content on that exact page per Google's structured-data requirements) —
lives at `/learn/` (`public/learn/index.html`), not on the app page. `/`
keeps a lean `SoftwareApplication` + `WebSite`/`Organization` schema and
links to `/learn/`; `/learn/` links back with a "Try it now" CTA. Both pages
ship keyword-relevant title/description, Open Graph + Twitter cards, and
share the generated `og.png` (1200×630) and favicons. `robots.txt` and
`sitemap.xml` (listing both URLs) are in `public/`, served at the site root.

**Before going live, replace every occurrence of the placeholder domain
`https://omnisaver.app`** (in both pages' `<head>`, `robots.txt`, and
`sitemap.xml`) with your real domain — the canonical URLs, Open Graph tags,
and sitemap are all wrong until that's done, which actively hurts indexing.

None of this *guarantees* ranking — this niche (fastvideosave, snapinsta,
ssstik, y2mate, etc.) has entrenched competitors with years of backlinks and
domain authority. On-page SEO gets you found and indexed correctly; it
doesn't substitute for backlinks, content depth over time, and site speed
once you have real traffic. One concrete next step once you have a domain:
consider dedicated landing pages per platform (`/instagram-reel-downloader`,
`/youtube-video-downloader`, etc.) that each link back to this same tool —
long-tail keyword pages like that tend to outrank a single page competing
for every term at once.

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

## Deploy the real backend (make downloads actually work)

The GitHub Pages preview (`.github/workflows/deploy-pages.yml`) is
static-only and deliberately can't run `yt-dlp` — see **How it works**
above for why that's a hard constraint, not a config gap. To get working
downloads on a real URL, the backend needs to run somewhere as a live
process. This repo includes a Render Blueprint (`render.yaml`) for the
fastest path to that, free to start:

1. Go to **https://dashboard.render.com/blueprints** (sign up/log in with
   GitHub if you haven't already).
2. Click **New Blueprint Instance**, pick the `omnisaver` repo. Render reads
   `render.yaml` automatically — it builds the existing `Dockerfile` (which
   already installs `yt-dlp` + `ffmpeg`) and wires up the `/api/health`
   check.
3. Click **Apply** / **Deploy**. First build takes a few minutes.

That connect-and-click step needs to happen from your Render account — no
API access exists for me to do it from here (same reason the GitHub Pages
toggle earlier needed you directly). Once it's live, tell me the URL Render
gives you (`https://omnisaver-xxxx.onrender.com`) and I'll verify it end to
end — resolve a real link, download a file, confirm formats — and wire the
GitHub Pages preview and canonical URLs to point at it.

**Free tier caveat**: Render's free web services spin down after 15 minutes
idle, so the first request after a quiet period takes ~30-60s to wake back
up (the interstitial's 5s countdown will feel short during a cold start —
that's expected, not a bug). Fine for testing/early traffic; upgrade to a
paid instance before pushing real marketing traffic at it. Railway and
Fly.io are viable alternatives if you'd rather use those — same Dockerfile
works on both, just without a pre-built blueprint file for this repo.

## Monetization / ad slots

Ad inventory is deliberately minimal to match the app's design — one native-
styled unit on `/` (below the results card), one on `/learn/`, and an
interstitial shown for a few seconds before each download starts
(`runInterstitial` in `app.js`) — this "wait, then download" pattern is the
standard revenue model for this category of site, since the interstitial
gets its own ad impression. This trades some ad surface for a page that
doesn't look ad-choked; if you want more inventory back (a header banner, a
sidebar on wide desktop), the `.ad-slot` styling in `style.css` is set up to
extend easily — just add more `<div class="ad-slot">` containers.

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

## Platform icons

`public/icons/*.svg` are small, hand-built icon marks in each platform's
brand color (not pulled/copied logo files) used solely to indicate "this
link type is supported" — the same nominative-use pattern used by countless
share buttons across the web. They don't imply any partnership with or
endorsement by YouTube, Instagram, Facebook, TikTok, or X.

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
