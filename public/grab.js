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

  // Instagram and Facebook both play video through Media Source
  // Extensions, so the <video> element's src is a blob: URL that points
  // at an in-memory buffer — useless to download. The real CDN URLs live
  // in JSON embedded in the page's inline <script> tags. These helpers
  // dig them out.

  function pageScripts() {
    var out = [];
    document.querySelectorAll('script').forEach(function (s) {
      var t = s.textContent;
      if (t && t.length > 40) out.push(t);
    });
    return out;
  }

  function unescapeJsonUrl(u) {
    return u.replace(/\\\//g, '/').replace(/\\u0026/g, '&').replace(/\\u0025/g, '%')
      .replace(/\\u003D/gi, '=').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }

  // Finds "<key>":"<url>" across every inline script, newest match wins.
  function findJsonUrls(keys) {
    var found = [], scripts = pageScripts();
    keys.forEach(function (pair) {
      var key = pair[0], label = pair[1];
      var re = new RegExp('"' + key + '"\\s*:\\s*"(https?:[^"]{20,})"', 'g');
      for (var i = 0; i < scripts.length; i++) {
        var m;
        while ((m = re.exec(scripts[i])) !== null) {
          var u = unescapeJsonUrl(m[1]);
          if (!found.some(function (f) { return f.url === u; })) {
            found.push({ label: label, url: u, ext: 'mp4' });
          }
        }
      }
    });
    return found;
  }

  // Last resort: any Meta CDN .mp4 anywhere in the document source.
  // Instagram serves from cdninstagram.com, Facebook from fbcdn.net —
  // match either TLD rather than assuming.
  function scavengeMetaCdnMp4() {
    var html = document.documentElement.innerHTML;
    var re = /https?:(?:\\?\/){2}[^"'\s\\]*?(?:cdninstagram|fbcdn)\.(?:com|net)[^"'\s]*?\.mp4[^"'\s\\]*/gi;
    var seen = {}, out = [], m;
    while ((m = re.exec(html)) !== null) {
      var u = unescapeJsonUrl(m[0]);
      if (!seen[u]) { seen[u] = 1; out.push({ label: 'Video', url: u, ext: 'mp4' }); }
    }
    return out.slice(0, 4);
  }

  function nonBlobVideoEls() {
    var out = [];
    document.querySelectorAll('video').forEach(function (v, i) {
      var src = v.currentSrc || v.src;
      if (src && src.indexOf('blob:') !== 0) {
        out.push({ label: 'Video' + (i ? ' ' + (i + 1) : ''), url: src, ext: 'mp4' });
      }
      v.querySelectorAll('source').forEach(function (s) {
        if (s.src && s.src.indexOf('blob:') !== 0) {
          out.push({ label: 'Video (' + (s.type || 'mp4') + ')', url: s.src, ext: 'mp4' });
        }
      });
    });
    return out;
  }

  function dedupe(list) {
    var seen = {}, out = [];
    list.forEach(function (o) {
      if (o && o.url && !seen[o.url]) { seen[o.url] = 1; out.push(o); }
    });
    return out;
  }

  // Describes what we looked at, so a failure is diagnosable instead of
  // just "no video found".
  function diagnose() {
    var vids = document.querySelectorAll('video').length;
    var blobs = 0;
    document.querySelectorAll('video').forEach(function (v) {
      if ((v.currentSrc || v.src || '').indexOf('blob:') === 0) blobs++;
    });
    var bits = [vids + ' video element' + (vids === 1 ? '' : 's')];
    if (blobs) bits.push(blobs + ' using blob: (streamed)');
    if (/log in|sign up/i.test(document.body.innerText.slice(0, 400))) bits.push('page looks logged-out');
    return bits.join(', ');
  }

  // Instagram's modern shape is "video_versions":[{width,height,url},...]
  // — a quality ladder. Pull each entry out with its resolution label.
  function instagramVideoVersions() {
    var out = [];
    pageScripts().forEach(function (src) {
      // [\s\S] rather than . — these JSON blobs contain newlines.
      var re = /"video_versions"\s*:\s*\[([\s\S]*?)\]/g, m;
      while ((m = re.exec(src)) !== null) {
        var entryRe = /\{[^{}]*?"url"\s*:\s*"(https?:[^"]+?)"[^{}]*?\}/g, e;
        while ((e = entryRe.exec(m[1])) !== null) {
          var h = e[0].match(/"height"\s*:\s*(\d+)/);
          out.push({
            label: 'Video' + (h ? ' — ' + h[1] + 'p' : ''),
            url: unescapeJsonUrl(e[1]),
            ext: 'mp4',
          });
        }
      }
    });
    return out.sort(function (a, b) {
      return (parseInt(b.label.replace(/\D/g, ''), 10) || 0) -
        (parseInt(a.label.replace(/\D/g, ''), 10) || 0);
    });
  }

  function grabInstagram() {
    var og = document.querySelector('meta[property="og:video"], meta[property="og:video:secure_url"]');
    var opts = dedupe([]
      .concat(instagramVideoVersions())
      .concat(og && og.content ? [{ label: 'Video', url: og.content, ext: 'mp4' }] : [])
      .concat(findJsonUrls([
        ['video_url', 'Video'],
        ['playable_url_quality_hd', 'Video — HD'],
        ['playable_url', 'Video'],
        ['browser_native_hd_url', 'Video — HD'],
        ['browser_native_sd_url', 'Video — SD'],
      ]))
      .concat(nonBlobVideoEls())
      .concat(scavengeMetaCdnMp4()));
    return {
      title: document.title || 'instagram',
      options: opts,
      note: opts.length ? null :
        'No downloadable video found (' + diagnose() + '). Open the reel on its own page ' +
        '(tap it so the URL shows /reel/...), let it start playing, then run OmniSaver again.',
    };
  }

  function grabTwitter() {
    var opts = dedupe([]
      .concat(nonBlobVideoEls())
      .concat(findJsonUrls([['video_url', 'Video'], ['url', 'Video']])
        .filter(function (o) { return /video\.twimg\.com/.test(o.url) && /\.mp4/.test(o.url); })));
    return {
      title: document.title || 'tweet',
      options: opts,
      note: opts.length ? null :
        'No downloadable video found (' + diagnose() + '). Open the tweet on its own page and ' +
        'let the video start playing, then run OmniSaver again.',
    };
  }

  function grabFacebook() {
    var opts = dedupe([]
      .concat(findJsonUrls([
        ['playable_url_quality_hd', 'Video — HD'],
        ['browser_native_hd_url', 'Video — HD'],
        ['hd_src', 'Video — HD'],
        ['playable_url', 'Video — SD'],
        ['browser_native_sd_url', 'Video — SD'],
        ['sd_src', 'Video — SD'],
      ]))
      .concat(nonBlobVideoEls())
      .concat(scavengeMetaCdnMp4()));
    return {
      title: document.title || 'facebook',
      options: opts,
      note: opts.length ? null :
        'No downloadable video found (' + diagnose() + '). Open the video on its own page ' +
        '(not the feed), let it start playing, then run OmniSaver again.',
    };
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
