/* OmniSaver in-page grabber.
 *
 * Injected into the platform's own page by the OmniSaver bookmarklet.
 * Because it runs in the page's origin, it can do two things our server
 * can't:
 *   1. Read the page's embedded media JSON (no CORS wall, no login wall —
 *      the visitor is already authenticated in their own browser).
 *   2. fetch(mediaUrl, { credentials: 'include' }) — CDNs like TikTok's
 *      Akamai reject requests without the session cookies, which only a
 *      same-origin request carries. This is the whole trick.
 *
 * The bytes go platform CDN -> the visitor's browser -> their disk.
 * They never touch an OmniSaver server, so bandwidth cost per download
 * is just this file (a few KB, and browser-cached after the first run).
 */
(function () {
  'use strict';

  if (window.__omnisaverActive) {
    window.__omnisaverToast('OmniSaver is already open on this page.');
    return;
  }
  window.__omnisaverActive = true;

  var HOST = location.hostname;

  // ---------------------------------------------------------------- utils

  function el(tag, style, text) {
    var n = document.createElement(tag);
    if (style) n.setAttribute('style', style);
    if (text != null) n.textContent = text;
    return n;
  }

  function humanSize(bytes) {
    if (!bytes) return '';
    var mb = bytes / 1048576;
    return mb >= 1 ? mb.toFixed(1) + ' MB' : Math.round(bytes / 1024) + ' KB';
  }

  function safeName(s, ext) {
    var base = (s || 'omnisaver').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 60);
    return (base || 'omnisaver') + '.' + ext;
  }

  // -------------------------------------------------------------- panel UI

  var panel, listEl, statusEl;

  function buildPanel(title) {
    panel = el('div',
      'position:fixed;z-index:2147483647;right:16px;bottom:16px;width:320px;max-width:calc(100vw - 32px);' +
      'background:#fff;color:#14171F;border:1px solid #E1E4EA;border-radius:16px;' +
      'box-shadow:0 8px 40px rgba(0,0,0,.25);padding:16px;' +
      'font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;');

    var head = el('div', 'display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;');
    var brand = el('div', 'display:flex;align-items:center;gap:7px;font-weight:700;font-size:14px;');
    var mark = el('span',
      'display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;' +
      'border-radius:7px;background:#C6862A;color:#fff;font-size:12px;', '↓');
    brand.appendChild(mark);
    brand.appendChild(el('span', null, 'OmniSaver'));
    var close = el('button',
      'border:none;background:transparent;font-size:20px;line-height:1;cursor:pointer;color:#8A8FA0;padding:0 4px;', '×');
    close.onclick = destroy;
    head.appendChild(brand);
    head.appendChild(close);
    panel.appendChild(head);

    if (title) {
      panel.appendChild(el('div',
        'font-size:12.5px;color:#5B6070;margin-bottom:12px;max-height:38px;overflow:hidden;', title));
    }

    listEl = el('div', 'display:flex;flex-direction:column;gap:7px;');
    panel.appendChild(listEl);

    statusEl = el('div', 'font-size:12px;color:#8A8FA0;margin-top:11px;min-height:16px;');
    panel.appendChild(statusEl);

    document.body.appendChild(panel);
  }

  function destroy() {
    if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
    window.__omnisaverActive = false;
  }

  function status(msg) { if (statusEl) statusEl.textContent = msg || ''; }

  window.__omnisaverToast = function (msg) {
    var t = el('div',
      'position:fixed;z-index:2147483647;left:50%;top:24px;transform:translateX(-50%);' +
      'background:#14171F;color:#fff;padding:10px 16px;border-radius:10px;font:13px sans-serif;' +
      'box-shadow:0 4px 20px rgba(0,0,0,.3);', msg);
    document.body.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 3200);
  };

  function addOption(label, onClick) {
    var b = el('button',
      'display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;' +
      'text-align:left;background:#F5F6F8;border:1px solid #E1E4EA;color:#14171F;' +
      'padding:10px 12px;border-radius:10px;font-size:13px;cursor:pointer;font-family:inherit;');
    b.appendChild(el('span', null, label));
    b.appendChild(el('span', 'color:#C6862A;font-weight:700;', '↓'));
    b.onmouseover = function () { b.style.borderColor = '#C6862A'; };
    b.onmouseout = function () { b.style.borderColor = '#E1E4EA'; };
    b.onclick = function () { onClick(b); };
    listEl.appendChild(b);
    return b;
  }

  // ----------------------------------------------------------- downloading

  function download(url, filename, btn) {
    var original = btn ? btn.firstChild.textContent : '';
    if (btn) { btn.disabled = true; btn.firstChild.textContent = 'Downloading…'; }
    status('Fetching from ' + HOST + '…');

    // credentials:'include' is the critical part — the CDN checks the
    // session cookies the platform set for this origin.
    fetch(url, { credentials: 'include' })
      .then(function (res) {
        if (!res.ok) throw new Error('CDN returned ' + res.status);
        var total = Number(res.headers.get('content-length')) || 0;
        if (!res.body || !window.ReadableStream) return res.blob();
        // Stream so we can show progress on larger files.
        var reader = res.body.getReader();
        var chunks = [], received = 0;
        return (function pump() {
          return reader.read().then(function (r) {
            if (r.done) return new Blob(chunks, { type: res.headers.get('content-type') || 'video/mp4' });
            chunks.push(r.value);
            received += r.value.length;
            status(total
              ? 'Downloading… ' + Math.round((received / total) * 100) + '% (' + humanSize(total) + ')'
              : 'Downloading… ' + humanSize(received));
            return pump();
          });
        })();
      })
      .then(function (blob) {
        var objUrl = URL.createObjectURL(blob);
        var a = el('a');
        a.href = objUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(objUrl); }, 20000);
        status('Saved ' + filename + ' (' + humanSize(blob.size) + ')');
        if (btn) { btn.disabled = false; btn.firstChild.textContent = original; }
      })
      .catch(function (err) {
        status('Failed: ' + err.message + '. Try reloading the page first.');
        if (btn) { btn.disabled = false; btn.firstChild.textContent = original; }
      });
  }

  // ----------------------------------------------------------- extractors

  function json(id) {
    var n = document.getElementById(id);
    if (!n) return null;
    try { return JSON.parse(n.textContent); } catch (e) { return null; }
  }

  function grabTiktok() {
    var d = json('__UNIVERSAL_DATA_FOR_REHYDRATION__');
    var item = d && d['__DEFAULT_SCOPE__'] &&
      d['__DEFAULT_SCOPE__']['webapp.video-detail'] &&
      d['__DEFAULT_SCOPE__']['webapp.video-detail'].itemInfo &&
      d['__DEFAULT_SCOPE__']['webapp.video-detail'].itemInfo.itemStruct;
    if (!item) return null;

    var v = item.video || {}, m = item.music || {};
    var name = item.desc || 'tiktok';
    var opts = [];

    // bitrateInfo holds the per-quality variants; playAddr is the default.
    var seen = {};
    (v.bitrateInfo || []).forEach(function (b) {
      var urls = b.PlayAddr && b.PlayAddr.UrlList;
      if (!urls || !urls.length) return;
      var label = (b.GearName || '').indexOf('720') > -1 ? '720p'
        : (b.GearName || '').indexOf('540') > -1 ? '540p' : (b.GearName || 'video');
      if (seen[label]) return;
      seen[label] = 1;
      opts.push({ label: 'Video — ' + label, url: urls[0], ext: 'mp4' });
    });
    if (v.playAddr && !opts.length) opts.push({ label: 'Video', url: v.playAddr, ext: 'mp4' });
    if (v.downloadAddr) opts.push({ label: 'Video (TikTok’s own copy)', url: v.downloadAddr, ext: 'mp4' });
    if (m.playUrl) opts.push({ label: 'Audio only (MP3)', url: m.playUrl, ext: 'mp3' });
    return { title: name, options: opts };
  }

  function grabInstagram() {
    var opts = [], title = document.title || 'instagram';
    // Public posts expose og:video; logged-in views expose a <video> src.
    var og = document.querySelector('meta[property="og:video"], meta[property="og:video:secure_url"]');
    if (og && og.content) opts.push({ label: 'Video', url: og.content, ext: 'mp4' });
    document.querySelectorAll('video').forEach(function (v, i) {
      var src = v.currentSrc || v.src;
      if (src && src.indexOf('blob:') !== 0 && !opts.some(function (o) { return o.url === src; })) {
        opts.push({ label: 'Video' + (opts.length ? ' ' + (i + 1) : ''), url: src, ext: 'mp4' });
      }
    });
    return opts.length ? { title: title, options: opts } : null;
  }

  function grabTwitter() {
    var opts = [];
    document.querySelectorAll('video').forEach(function (v) {
      var src = v.currentSrc || v.src;
      if (src && src.indexOf('blob:') !== 0) opts.push({ label: 'Video', url: src, ext: 'mp4' });
      // Twitter often uses <source> children inside <video>
      v.querySelectorAll('source').forEach(function (s) {
        if (s.src && s.src.indexOf('blob:') !== 0 &&
            !opts.some(function (o) { return o.url === s.src; })) {
          opts.push({ label: 'Video (' + (s.type || 'mp4') + ')', url: s.src, ext: 'mp4' });
        }
      });
    });
    return opts.length ? { title: document.title || 'tweet', options: opts } : null;
  }

  function grabFacebook() {
    var opts = [];
    document.querySelectorAll('video').forEach(function (v, i) {
      var src = v.currentSrc || v.src;
      if (src && src.indexOf('blob:') !== 0) {
        opts.push({ label: 'Video' + (i ? ' ' + (i + 1) : ''), url: src, ext: 'mp4' });
      }
    });
    // Facebook embeds direct URLs in inline scripts as playable_url / hd_src.
    var html = document.documentElement.innerHTML;
    [['hd_src', 'HD'], ['sd_src', 'SD'], ['playable_url_quality_hd', 'HD'], ['playable_url', 'SD']]
      .forEach(function (pair) {
        var m = html.match(new RegExp('"' + pair[0] + '"\\s*:\\s*"([^"]+)"'));
        if (m) {
          var u = m[1].replace(/\\\//g, '/').replace(/\\u0025/g, '%');
          if (!opts.some(function (o) { return o.url === u; })) {
            opts.push({ label: 'Video — ' + pair[1], url: u, ext: 'mp4' });
          }
        }
      });
    return opts.length ? { title: document.title || 'facebook', options: opts } : null;
  }

  function grabYoutube() {
    // YouTube serves adaptive DASH streams whose URLs are signature-locked
    // and split into separate video/audio tracks — they can't be saved as
    // one playable file from the page without muxing. Be honest instead of
    // handing over something broken.
    return { title: document.title || 'youtube', options: [], note:
      'YouTube splits video and audio into separate signature-locked streams, ' +
      'so they can’t be saved as one file from the page. Not supported.' };
  }

  // ------------------------------------------------------------------ main

  var grabber =
    /tiktok\.com/.test(HOST) ? grabTiktok :
    /instagram\.com/.test(HOST) ? grabInstagram :
    /(twitter\.com|x\.com)/.test(HOST) ? grabTwitter :
    /(facebook\.com|fb\.watch)/.test(HOST) ? grabFacebook :
    /(youtube\.com|youtu\.be)/.test(HOST) ? grabYoutube : null;

  if (!grabber) {
    window.__omnisaverToast('OmniSaver: this site isn’t supported. Open a TikTok, Instagram, X or Facebook video first.');
    window.__omnisaverActive = false;
    return;
  }

  var found;
  try { found = grabber(); } catch (e) { found = null; }

  if (!found || !found.options || !found.options.length) {
    buildPanel(found && found.title);
    status(found && found.note
      ? found.note
      : 'No video found on this page. Make sure the video is open and has started playing, then try again.');
    return;
  }

  buildPanel(found.title);
  found.options.forEach(function (o) {
    addOption(o.label, function (btn) {
      download(o.url, safeName(found.title, o.ext), btn);
    });
  });
  status('Downloads go straight from ' + HOST + ' to your device.');
})();
