// Edge-service base URL. Empty = same-origin (which is the case for local
// dev with the Node server, and the eventual Stage-2 backend). To point
// at Deno Deploy from GitHub Pages, set this to the deployed URL, e.g.
// "https://omnisaver.deno.dev".
const EDGE_BASE = window.OMNISAVER_EDGE_BASE || '';

// Coming-soon platforms are detected in the UI (so the strip stays
// visually complete) but the resolve request is short-circuited with a
// friendly message rather than round-tripping to a service that would
// just reject them.
const COMING_SOON = new Set(['youtube', 'facebook']);

const PLATFORM_PATTERNS = [
  { id: 'youtube', label: 'YouTube', icon: 'icons/youtube.svg', re: /(?:youtube\.com|youtu\.be)/i },
  { id: 'instagram', label: 'Instagram', icon: 'icons/instagram.svg', re: /instagram\.com/i },
  { id: 'facebook', label: 'Facebook', icon: 'icons/facebook.svg', re: /(?:facebook\.com|fb\.watch)/i },
  { id: 'tiktok', label: 'TikTok', icon: 'icons/tiktok.svg', re: /tiktok\.com/i },
  { id: 'twitter', label: 'X / Twitter', icon: 'icons/x.svg', re: /(?:twitter\.com|x\.com)/i },
];
const PLATFORM_BY_ID = Object.fromEntries(PLATFORM_PATTERNS.map((p) => [p.id, p]));

const form = document.getElementById('resolve-form');
const urlInput = document.getElementById('url-input');
const fetchBtn = document.getElementById('fetch-btn');
const btnLabel = fetchBtn.querySelector('.btn-label');
const btnSpinner = fetchBtn.querySelector('.btn-spinner');
const errorMsg = document.getElementById('error-msg');
const detectStatus = document.getElementById('detect-status');
const detectIcon = document.getElementById('detect-icon');
const detectLabel = document.getElementById('detect-label');
const heroModeToggle = document.getElementById('mode-toggle');
const resultModeToggle = document.getElementById('result-mode-toggle');

const resultsSection = document.getElementById('results');
const resultMedia = document.querySelector('.results__media');
const resultThumb = document.getElementById('result-thumb');
const resultPlatformWrap = document.getElementById('result-platform-wrap');
const resultIcon = document.getElementById('result-icon');
const resultPlatform = document.getElementById('result-platform');
const resultTitle = document.getElementById('result-title');
const resultMeta = document.getElementById('result-meta');
const videoFormatGroup = document.getElementById('video-format-group');
const audioFormatGroup = document.getElementById('audio-format-group');
const videoFormatsEl = document.getElementById('video-formats');
const audioFormatsEl = document.getElementById('audio-formats');

const interstitial = document.getElementById('interstitial');
const countdownNum = document.getElementById('countdown-num');

const previewBanner = document.getElementById('preview-banner');

let currentUrl = '';
let selectedFormatMode = 'video';

(async () => {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);
    const res = await fetch(`${EDGE_BASE}/api/health`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) throw new Error('unhealthy');
  } catch {
    previewBanner.hidden = false;
  }
})();

function detectPlatform(value) {
  return PLATFORM_PATTERNS.find((p) => p.re.test(value)) || null;
}

function updateDetectStatus(value) {
  const trimmed = value.trim();
  const match = detectPlatform(trimmed);

  if (match) {
    detectStatus.classList.add('is-active');
    detectStatus.dataset.platform = match.id;
    detectIcon.src = match.icon;
    detectIcon.alt = match.label;
    detectIcon.hidden = false;
    if (COMING_SOON.has(match.id)) {
      detectLabel.textContent = `${match.label} — coming soon`;
      heroModeToggle.hidden = true;
    } else {
      detectLabel.textContent = `${match.label} detected`;
      heroModeToggle.hidden = false;
    }
  } else {
    detectStatus.classList.remove('is-active');
    detectStatus.removeAttribute('data-platform');
    detectIcon.hidden = true;
    detectLabel.textContent = trimmed ? "Doesn't look like a supported link yet" : 'Waiting for a link…';
    heroModeToggle.hidden = true;
  }
}

urlInput.addEventListener('input', () => updateDetectStatus(urlInput.value));

function setFormatMode(mode) {
  selectedFormatMode = mode;
  [heroModeToggle, resultModeToggle].forEach((toggle) => {
    toggle.querySelectorAll('.mode-btn').forEach((btn) => {
      const isSelected = btn.dataset.formatMode === mode;
      btn.classList.toggle('is-selected', isSelected);
      btn.setAttribute('aria-pressed', String(isSelected));
    });
  });
  videoFormatGroup.hidden = mode !== 'video';
  audioFormatGroup.hidden = mode !== 'audio';
}

[heroModeToggle, resultModeToggle].forEach((toggle) => {
  toggle.addEventListener('click', (e) => {
    const btn = e.target.closest('.mode-btn');
    if (btn) setFormatMode(btn.dataset.formatMode);
  });
});

function setLoading(isLoading) {
  fetchBtn.disabled = isLoading;
  btnLabel.hidden = isLoading;
  btnSpinner.hidden = !isLoading;
}

function showError(message) {
  errorMsg.textContent = message;
  errorMsg.hidden = !message;
}

function formatDuration(seconds) {
  if (!seconds) return null;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function formatSize(bytes) {
  if (!bytes) return '';
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? ` · ${mb.toFixed(1)} MB` : '';
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = urlInput.value.trim();
  showError('');
  resultsSection.hidden = true;

  const match = detectPlatform(url);
  if (match && COMING_SOON.has(match.id)) {
    showError(`${match.label} support is coming in a later release. TikTok, X/Twitter and public Instagram Reels work today.`);
    return;
  }

  setLoading(true);
  try {
    const res = await fetch(`${EDGE_BASE}/api/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Something went wrong.');

    currentUrl = url;
    renderResults(data);
  } catch (err) {
    showError(err.message);
  } finally {
    setLoading(false);
  }
});

function renderResults(data) {
  const platform = PLATFORM_BY_ID[data.platform];
  resultPlatform.textContent = data.platformLabel;
  resultPlatformWrap.dataset.platform = data.platform;
  if (platform) {
    resultIcon.src = platform.icon;
    resultIcon.alt = platform.label;
  }
  resultTitle.textContent = data.title;
  if (data.thumbnail) {
    resultThumb.onerror = () => { resultMedia.hidden = true; };
    resultThumb.src = data.thumbnail;
    resultThumb.alt = data.title;
    resultMedia.hidden = false;
  } else {
    resultMedia.hidden = true;
  }

  const parts = [];
  if (data.uploader) parts.push(data.uploader);
  const dur = formatDuration(data.duration);
  if (dur) parts.push(dur);
  resultMeta.textContent = parts.join(' · ');

  videoFormatsEl.innerHTML = '';
  const heightOf = (f) => parseInt(f.resolution, 10) || 0;
  const videoFormats = data.formats
    .filter((f) => f.hasVideo)
    .sort((a, b) => heightOf(b) - heightOf(a));
  const audioFormat = data.formats.find((f) => !f.hasVideo && f.hasAudio);

  if (videoFormats.length === 0) {
    videoFormatsEl.textContent = 'No video formats available for this post.';
  } else {
    videoFormats.slice(0, 6).forEach((f) => {
      videoFormatsEl.appendChild(makeDownloadLink(f, f.resolution || f.ext));
    });
  }

  audioFormatsEl.innerHTML = '';
  if (audioFormat) {
    audioFormatsEl.appendChild(makeDownloadLink(audioFormat, 'MP3'));
  } else {
    audioFormatsEl.textContent = 'No standalone audio track for this post.';
  }

  setFormatMode(selectedFormatMode);
  resultsSection.hidden = false;
  resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Direct <a> to the platform's CDN URL. Rendered as a real link with an
// href (not a button) so users can right-click → "Save link as…" if the
// browser insists on playing the video inline instead of downloading,
// which some CDNs cause when they don't send Content-Disposition:
// attachment. `download` gives us the desired behavior in Chromium /
// Firefox for same-registered-suffix downloads and is harmless otherwise.
function makeDownloadLink(format, label) {
  const a = document.createElement('a');
  a.className = 'format-btn';
  a.href = format.url;
  a.rel = 'noopener noreferrer';
  a.target = '_blank';
  a.download = `omnisaver.${format.ext || 'mp4'}`;
  a.textContent = `${label}${formatSize(format.filesize)}`;
  a.addEventListener('click', () => runInterstitial());
  return a;
}

function runInterstitial(onDone) {
  interstitial.hidden = false;
  let n = 5;
  countdownNum.textContent = n;
  const timer = setInterval(() => {
    n -= 1;
    countdownNum.textContent = Math.max(n, 0);
    if (n <= 0) {
      clearInterval(timer);
      interstitial.hidden = true;
      if (onDone) onDone();
    }
  }, 1000);
}
