FROM node:20-slim

# Install rclone
RUN apt-get update && apt-get install -y curl unzip && \
    curl -L https://rclone.org/install.sh | bash && \
    apt-get remove -y curl unzip && apt-get autoremove -y && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --production

# Bring uploads metadata into the image FIRST as its own layer. This makes
# the /app/uploads/<set>/<image>/metadata.json files explicit and forces
# Docker to invalidate any previously cached COPY layer that was built
# back when .dockerignore excluded the whole `uploads/` tree.
# Binary images (jpg/jpeg/png/mp4) stay out via .dockerignore — those
# come from Google Drive at container start via rclone.
COPY uploads ./uploads

COPY . .

RUN mkdir -p uploads database
RUN echo "Image baked at $(date -u +%Y-%m-%dT%H:%M:%SZ) — metadata count: $(find /app/uploads -name metadata.json 2>/dev/null | wc -l)" \
    > /app/.image-info && cat /app/.image-info

EXPOSE 3000

COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

ENTRYPOINT ["/docker-entrypoint.sh"]
