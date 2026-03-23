FROM node:20-slim

# Install rclone
RUN apt-get update && apt-get install -y curl unzip && \
    curl -L https://rclone.org/install.sh | bash && \
    apt-get remove -y curl unzip && apt-get autoremove -y && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --production

COPY . .

RUN mkdir -p uploads database

EXPOSE 3000

COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

ENTRYPOINT ["/docker-entrypoint.sh"]
