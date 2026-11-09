FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/schemas/package.json packages/schemas/package.json
COPY apps/web/prisma apps/web/prisma
COPY apps/web/prisma.config.ts apps/web/prisma.config.ts
COPY scripts/prisma-generate.mjs scripts/prisma-schema.mjs scripts/
ENV CHECKPOINT_DISABLE=1 \
    PRISMA_HIDE_UPDATE_MESSAGE=1 \
    DATABASE_URL=file:./prisma/dev.db
RUN npm ci

FROM dependencies AS builder
ENV DATABASE_URL=postgresql://opencontext:opencontext@db:5432/opencontext?schema=public
COPY . .
RUN npm run prisma:generate:postgres --workspace web
RUN npm run build --workspace web

FROM node:24-bookworm-slim AS runner
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
COPY --from=builder /app ./
EXPOSE 3000
CMD ["sh", "-c", "npm run prisma:migrate:deploy:postgres --workspace web && npm run start --workspace web"]
