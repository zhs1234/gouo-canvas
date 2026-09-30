# 独立 V2 构建；不复制旧根项目，不接受构建期凭据。
ARG NODE_IMAGE=public.ecr.aws/docker/library/node:22-bookworm-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c
ARG NGINX_IMAGE=public.ecr.aws/docker/library/nginx:stable-alpine@sha256:0985e772fb9f729e6fa0980da05fca5d9c468e870eed43071545afa9d2e27d94
FROM ${NODE_IMAGE} AS workspace
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/studio/package.json apps/studio/package.json
COPY packages ./packages
RUN --mount=type=secret,id=build_ca \
    if [ -s /run/secrets/build_ca ]; then export npm_config_cafile=/run/secrets/build_ca; fi; \
    npm ci --fetch-retries=1 --fetch-timeout=30000
COPY apps ./apps
COPY config ./config
COPY scripts ./scripts
FROM workspace AS build
RUN npm run build
FROM workspace AS api
ENV NODE_ENV=production
RUN chmod -R a+rX apps config packages scripts package*.json && mkdir -p /data && chown node:node /data
USER node
CMD ["node", "apps/api/src/main.mjs"]
FROM workspace AS fixture
COPY tests/stack ./tests/stack
CMD ["node", "tests/stack/fixture-new-api.mjs"]
FROM ${NGINX_IMAGE} AS web
COPY --from=build /app/apps/studio/dist /usr/share/nginx/html/studio
COPY deploy/nginx.conf.template /etc/nginx/templates/default.conf.template
