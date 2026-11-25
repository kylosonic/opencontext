FROM node:24-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54 AS base
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV CHECKPOINT_DISABLE=1 \
    PRISMA_HIDE_UPDATE_MESSAGE=1

FROM base AS dependencies
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/schemas/package.json packages/schemas/package.json
COPY apps/web/prisma apps/web/prisma
COPY apps/web/prisma.config.ts apps/web/prisma.config.ts
COPY scripts/prisma-generate.mjs scripts/prisma-schema.mjs scripts/
ENV DATABASE_URL=file:./prisma/dev.db
RUN npm ci

FROM dependencies AS builder
ENV DATABASE_URL=postgresql://opencontext:opencontext@db:5432/opencontext?schema=public
COPY . .
RUN npm run prisma:generate:postgres --workspace web
RUN AUTH_SECRET=opencontext-build-only-auth-secret-not-for-runtime npm run build --workspace web

FROM base AS production-dependencies
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/schemas/package.json packages/schemas/package.json
RUN npm ci --omit=dev --ignore-scripts

FROM base AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=builder --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=node:node /app/apps/web/prisma ./apps/web/prisma
COPY --from=builder --chown=node:node /app/apps/web/prisma.config.ts ./apps/web/prisma.config.ts
COPY --from=builder --chown=node:node /app/apps/web/prisma.postgres.config.ts ./apps/web/prisma.postgres.config.ts
COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --from=builder --chown=node:node /app/scripts/prisma-schema.mjs ./scripts/prisma-schema.mjs
RUN mkdir -p /data/storage && chown node:node /data/storage
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "-c", "node node_modules/prisma/build/index.js migrate deploy --config apps/web/prisma.postgres.config.ts && exec node apps/web/server.js"]
