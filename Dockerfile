FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg tesseract-ocr tesseract-ocr-ara python3 python3-pip \
  && pip3 install --no-cache-dir --break-system-packages faster-whisper numpy \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV PORT=8787
EXPOSE 8787
CMD ["node", "server/index.js"]
