FROM node:22.18.0-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM dependencies AS build
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM dependencies AS checks
COPY tsconfig.json tsconfig.build.json vitest.config.ts eslint.config.js ./
COPY src ./src
COPY tests ./tests
CMD ["npm", "test"]

FROM node:22.18.0-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
USER app
CMD ["node", "dist/index.js"]
