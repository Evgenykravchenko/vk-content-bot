ARG NODE_VERSION=22.18.0

FROM --platform=$BUILDPLATFORM node:${NODE_VERSION}-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM dependencies AS build
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM dependencies AS checks
COPY tsconfig.json tsconfig.build.json vitest.config.ts eslint.config.js .prettierrc.json ./
COPY src ./src
COPY tests ./tests
CMD ["npm", "test"]

FROM dependencies AS production-dependencies
RUN npm prune --omit=dev && npm cache clean --force

FROM node:${NODE_VERSION}-alpine AS runtime
ARG VERSION=dev
ARG VCS_REF=unknown
ENV NODE_ENV=production
ENV APP_VERSION=${VERSION}
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY package.json package-lock.json* ./
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY scripts/container-healthcheck.mjs ./container-healthcheck.mjs
LABEL org.opencontainers.image.title="VK Content Bot" \
      org.opencontainers.image.description="VK content delivery bot managed through BotCRM" \
      org.opencontainers.image.source="https://github.com/Evgenykravchenko/vk-content-bot" \
      org.opencontainers.image.version=${VERSION} \
      org.opencontainers.image.revision=${VCS_REF} \
      org.opencontainers.image.licenses="MIT"
USER app
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "/app/container-healthcheck.mjs"]
CMD ["node", "dist/index.js"]
