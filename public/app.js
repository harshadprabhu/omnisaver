const PLATFORM_PATTERNS = [
  { id: 'youtube', re: /(?:youtube\.com|youtu\.be)/i },
  { id: 'instagram', re: /instagram\.com/i },
  { id: 'facebook', re: /(?:facebook\.com|fb\.watch)/i },
  { id: 'tiktok', re: /tiktok\.com/i },
  { id: 'twitter', re: /(?:twitter\.com|x\.com)/i },
];

const form = document.getElementById('resolve-form');
const urlInput = document.getElementById('url-input');
const fetchBtn = document.getElementById('fetch-btn');
const btnLabel = fetchBtn.querySelector('.btn-label');
const btnSpinner = fetchBtn.querySelector('.btn-spinner');
const errorMsg = document.getElementById('error-msg');
const platformChips = document.querySelectorAll('.platform-chip');

const resultsSection = document.getElementById('results');
const resultThumb = document.getElementById('result-thumb');
const resultPlatform = document.getElementById('result-platform');
const resultTitle = document.getElementById('result-title');
const resultMeta = document.getElementById('result-meta');
const videoFormatsEl = document.getElementById('video-formats');
const audioFormatsEl = document.getElementById('audio-formats');

const interstitial = document.getElementById('interstitial');
const countdownNum = document.getElementById('countdown-num');

let currentUrl = '';

function detectPlatform(value) {
  return PLATFORM_PATTERNS.find((p) => p.re.test(value))?.id || null;
}

function highlightPlatform(id) {
  platformChips.forEach((chip) => {
    chip.classList.toggle('active', chip.dataset.platform === id);
  });
}

urlInput.addEventListener('input', () => {
  highlightPlatform(detectPlatform(urlInput.value.trim()));
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

  setLoading(true);
  try {
    const res = await fetch('/api/resolve', {
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
  resultPlatform.textContent = data.platformLabel;
  resultTitle.textContent = data.title;
  resultThumb.src = data.thumbnail || '';
  resultThumb.alt = data.title;

  const parts = [];
  if (data.uploader) parts.push(data.uploader);
  const dur = formatDuration(data.duration);
  if (dur) parts.push(dur);
  resultMeta.textContent = parts.join(' · ');

  videoFormatsEl.innerHTML = '';
  const videoFormats = data.formats
    .filter((f) => f.hasVideo)
    .sort((a, b) => (b.resolution || '').localeCompare(a.resolution || ''));

  if (videoFormats.length === 0) {
    videoFormatsEl.innerHTML = '<span class="results__meta">No separate video qualities — use Fetch Best below.</span>';
    const btn = document.createElement('button');
    btn.className = 'format-btn';
    btn.textContent = '⬇ Download video (best available)';
    btn.addEventListener('click', () => startDownload({ mode: 'video' }));
    videoFormatsEl.appendChild(btn);
  } else {
    videoFormats.slice(0, 6).forEach((f) => {
      const btn = document.createElement('button');
      btn.className = 'format-btn';
      btn.textContent = `⬇ ${f.resolution || f.ext} (${f.ext})${formatSize(f.filesize)}`;
      btn.addEventListener('click', () => startDownload({ mode: 'video', formatId: f.format_id }));
      videoFormatsEl.appendChild(btn);
    });
  }

  audioFormatsEl.querySelector('[data-mode="audio"]').onclick = () => startDownload({ mode: 'audio' });

  resultsSection.hidden = false;
  resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function startDownload({ mode, formatId }) {
  runInterstitial(() => {
    const params = new URLSearchParams({ url: currentUrl, mode });
    if (formatId) params.set('format_id', formatId);
    const a = document.createElement('a');
    a.href = `/api/download?${params.toString()}`;
    a.click();
  });
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
      onDone();
    }
  }, 1000);
}
