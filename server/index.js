import express from 'express';
import rateLimit from 'express-rate-limit';
import { spawn } from 'child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const app = express();
// Deployed behind a reverse proxy / load balancer (Render, Railway, Fly.io,
// nginx, ...) which terminates TLS and forwards the real client IP via
// X-Forwarded-For. Without this, rate limiting below would key off the
// proxy's IP and either throttle everyone at once or nobody at all.
app.set('trust proxy', 1);
app.use(express.json());
app.use(express.static(PUBLIC_DIR));

// Platforms this instance knows how to auto-detect. yt-dlp itself supports
// far more sites; this list only controls what the UI recognizes as "supported".
const PLATFORMS = [
  { id: 'youtube', label: 'YouTube', re: /(?:youtube\.com|youtu\.be)/i },
  { id: 'instagram', label: 'Instagram', re: /instagram\.com/i },
  { id: 'facebook', label: 'Facebook', re: /(?:facebook\.com|fb\.watch)/i },
  { id: 'tiktok', label: 'TikTok', re: /tiktok\.com/i },
  { id: 'twitter', label: 'X / Twitter', re: /(?:twitter\.com|x\.com)/i },
];

function detectPlatform(url) {
  return PLATFORMS.find((p) => p.re.test(url)) || null;
}

function isHttpUrl(value) {
  if (!value || value.length > 2000) return false;
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

const FORMAT_ID_RE = /^[\w.+-]{1,64}$/;
function isValidFormatId(value) {
  return value === null || FORMAT_ID_RE.test(value);
}

// --- yt-dlp process concurrency guard -------------------------------------
// Each request spawns a real OS subprocess. Left unbounded, a burst of
// public traffic (or a handful of deliberately slow/large requests) can
// exhaust CPU/memory/bandwidth on the box. Cap how many run at once and
// reject the rest with 503 rather than letting them pile up.
const MAX_CONCURRENT_JOBS = Number(process.env.MAX_CONCURRENT_JOBS || 4);
let activeJobs = 0;

function acquireJobSlot() {
  if (activeJobs >= MAX_CONCURRENT_JOBS) return false;
  activeJobs += 1;
  return true;
}

function releaseJobSlot() {
  activeJobs = Math.max(0, activeJobs - 1);
}

// --- Rate limiting ----------------------------------------------------------
const resolveLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.RESOLVE_RATE_LIMIT || 30),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a bit and try again.' },
});

const downloadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.DOWNLOAD_RATE_LIMIT || 20),
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many downloads from this IP. Please wait a bit and try again.',
});

const RESOLVE_TIMEOUT_MS = Number(process.env.RESOLVE_TIMEOUT_MS || 30_000);
const DOWNLOAD_TIMEOUT_MS = Number(process.env.DOWNLOAD_TIMEOUT_MS || 10 * 60_000);

function runYtDlpJson(url) {
  return new Promise((resolve, reject) => {
    const proc = spawn('yt-dlp', ['-j', '--no-playlist', '--no-warnings', url], {
      timeout: RESOLVE_TIMEOUT_MS,
      killSignal: 'SIGKILL',
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk) => (stdout += chunk));
    proc.stderr.on('data', (chunk) => (stderr += chunk));
    proc.on('error', (err) => reject(new Error(`yt-dlp not available: ${err.message}`)));
    proc.on('close', (code, signal) => {
      if (signal === 'SIGKILL') return reject(new Error('Lookup timed out.'));
      if (code !== 0) return reject(new Error(stderr.trim() || `yt-dlp exited with code ${code}`));
      try {
        // -j prints one JSON object per line; take the first for single videos.
        resolve(JSON.parse(stdout.trim().split('\n')[0]));
      } catch {
        reject(new Error('Could not parse video metadata.'));
      }
    });
  });
}

app.post('/api/resolve', resolveLimiter, async (req, res) => {
  const url = String(req.body?.url || '').trim();
  if (!isHttpUrl(url)) {
    return res.status(400).json({ error: 'Paste a valid link starting with http(s)://' });
  }
  const platform = detectPlatform(url);
  if (!platform) {
    return res.status(422).json({
      error: 'Unrecognized link. Supported: YouTube, Instagram, Facebook, TikTok, X/Twitter.',
    });
  }

  if (!acquireJobSlot()) {
    return res.status(503).json({ error: 'Server is busy right now. Please try again in a moment.' });
  }

  try {
    const info = await runYtDlpJson(url);
    const seen = new Set();
    const formats = (info.formats || [])
      .filter((f) => (f.vcodec && f.vcodec !== 'none') || (f.acodec && f.acodec !== 'none'))
      .map((f) => ({
        format_id: f.format_id,
        ext: f.ext,
        resolution: f.resolution || (f.height ? `${f.height}p` : 'audio'),
        note: f.format_note || '',
        filesize: f.filesize || f.filesize_approx || null,
        hasVideo: !!(f.vcodec && f.vcodec !== 'none'),
        hasAudio: !!(f.acodec && f.acodec !== 'none'),
      }))
      .filter((f) => {
        const key = `${f.resolution}-${f.hasVideo}-${f.hasAudio}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

    res.json({
      platform: platform.id,
      platformLabel: platform.label,
      title: info.title || 'Untitled',
      thumbnail: info.thumbnail || null,
      duration: info.duration || null,
      uploader: info.uploader || info.channel || null,
      formats,
    });
  } catch {
    res.status(502).json({
      error:
        'Could not fetch this link. It may be private, deleted, age-restricted, or the platform changed its page structure.',
    });
  } finally {
    releaseJobSlot();
  }
});

app.get('/api/download', downloadLimiter, (req, res) => {
  const url = String(req.query.url || '');
  const formatId = req.query.format_id ? String(req.query.format_id) : null;
  const mode = req.query.mode === 'audio' ? 'audio' : 'video';

  if (!isHttpUrl(url)) return res.status(400).send('Invalid link');
  if (!detectPlatform(url)) return res.status(422).send('Unsupported link');
  if (!isValidFormatId(formatId)) return res.status(400).send('Invalid format');

  if (!acquireJobSlot()) {
    return res.status(503).send('Server is busy right now. Please try again in a moment.');
  }
  let slotReleased = false;
  const releaseOnce = () => {
    if (slotReleased) return;
    slotReleased = true;
    releaseJobSlot();
  };

  const args = ['--no-playlist', '--no-warnings', '-o', '-'];
  if (mode === 'audio') {
    args.push('-x', '--audio-format', 'mp3');
  } else {
    args.push('-f', formatId || 'best[ext=mp4]/best');
  }
  args.push(url);

  res.setHeader('Content-Disposition', `attachment; filename="omnisaver-download.${mode === 'audio' ? 'mp3' : 'mp4'}"`);
  res.setHeader('Content-Type', mode === 'audio' ? 'audio/mpeg' : 'video/mp4');

  const proc = spawn('yt-dlp', args, { timeout: DOWNLOAD_TIMEOUT_MS, killSignal: 'SIGKILL' });
  proc.stdout.pipe(res);
  proc.on('error', () => {
    releaseOnce();
    if (!res.headersSent) res.status(502).send('Download failed');
  });
  proc.on('close', releaseOnce);
  proc.stderr.on('data', () => {}); // yt-dlp logs progress to stderr; ignored here
  req.on('close', () => {
    proc.kill('SIGKILL');
    releaseOnce();
  });
});

app.get('/api/health', (_req, res) => res.json({ ok: true, activeJobs, maxConcurrentJobs: MAX_CONCURRENT_JOBS }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`OmniSaver server listening on http://localhost:${PORT}`);
});
