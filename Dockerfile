FROM node:20-slim AS base
RUN corepack enable && corepack prepare pnpm@8.15.7 --activate
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod=false

# Build TypeScript
FROM deps AS build
COPY tsconfig.json tsconfig.paths.json ./
COPY api/ api/
COPY lib/ lib/
COPY server.ts ./
COPY global.d.ts ./
RUN pnpm build

# Production image
FROM base AS production
ENV NODE_ENV=production
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod
COPY --from=build /app/dist ./dist
EXPOSE 3000
CMD ["node", "-r", "dotenv/config", "dist/server.js"]
