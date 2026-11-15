# Search service (Typesense + the song list) for Render's free tier.
# Render: New -> Web Service -> this repo; Language: Docker; Root Directory: game;
# Dockerfile Path: server/typesense/Dockerfile. See server/typesense/README.md.
FROM node:22-bookworm-slim
ARG TYPESENSE_VERSION=30.2
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
 && curl -fsSL "https://dl.typesense.org/releases/${TYPESENSE_VERSION}/typesense-server-${TYPESENSE_VERSION}-linux-amd64.tar.gz" \
    | tar -xz -C /usr/local/bin typesense-server \
 && apt-get purge -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json ./
COPY src/services/search ./src/services/search
COPY server/typesense ./server/typesense
ENV TYPESENSE_DATA_DIR=/tmp/typesense-data
CMD ["node", "server/typesense/boot.mjs"]
