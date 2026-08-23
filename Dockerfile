FROM node:20-slim

# yt-dlp needs Python + ffmpeg (for audio extraction / muxing) and curl to
# fetch the latest yt-dlp binary directly from its GitHub releases.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 ffmpeg curl ca-certificates \
  && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
  && chmod a+rx /usr/local/bin/yt-dlp \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server ./server
COPY public ./public

ENV PORT=3000
EXPOSE 3000
CMD ["node", "server/index.js"]
