FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
WORKDIR /app
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/lib ./lib
COPY src/skills ./src/skills
COPY drizzle ./drizzle
COPY drizzle.config.ts ./drizzle.config.ts
COPY .env.sample ./.env.sample
CMD ["node", "lib/runDiscord.js"]
