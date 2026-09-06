ARG NODE_IMAGE=node:24-bookworm-slim
FROM ${NODE_IMAGE} AS web-build
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM ${NODE_IMAGE}
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg tini && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server/ ./server/
COPY --from=web-build /app/web/dist ./web/dist
RUN mkdir -p /data /import && chown node:node /data /import
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3080 DATA_DIR=/data IMPORT_DIR=/import TZ=Asia/Shanghai
USER node
EXPOSE 3080
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server/index.mjs"]
