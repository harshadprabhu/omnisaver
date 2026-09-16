#!/usr/bin/env bash
# Syncs the grabber into the extension and packages it for upload.
# public/grab.js is the single source of truth — the bookmarklet inlines
# it at page load, and this copies it into extension/ so both paths run
# identical code.
set -euo pipefail

cd "$(dirname "$0")"

cp public/grab.js extension/grab.js
echo "synced public/grab.js -> extension/grab.js"

# Packaged into public/ so the site can serve it as a direct download.
OUT="public/omnisaver-extension.zip"
rm -f "$OUT"
( cd extension && zip -qr "../$OUT" . -x '.*' )
echo "packaged $OUT"
unzip -l "$OUT" | tail -n +4 | head -n -2 | awk '{print "  " $4}'
