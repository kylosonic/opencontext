# Self-contained PostgreSQL web image for a container host.
FROM node:25-bookworm-slim@sha256:81db02c4b671288a03915da9534dbd54f96d0e7c24d80ccc54f5b36b2e684370 AS base
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
COPY docker/hosted-sqlite-types.d.ts apps/web/hosted-sqlite-types.d.ts
COPY scripts/prisma-generate.mjs scripts/prisma-schema.mjs scripts/
RUN mkdir -p apps/web/prisma
COPY apps/web/prisma/postgres apps/web/prisma/postgres
COPY apps/web/prisma.postgres.config.ts apps/web/prisma.postgres.config.ts
ENV DATABASE_URL=postgresql://opencontext:opencontext@db:5432/opencontext?schema=public
RUN npm ci

FROM dependencies AS builder
COPY . .
RUN npm run prisma:generate:postgres --workspace web
RUN node --input-type=module -e "import fs from 'node:fs'; fs.copyFileSync('apps/web/next.config.ts', 'apps/web/next.standard.config.ts'); fs.copyFileSync('apps/web/next.hosted.config.ts', 'apps/web/next.config.ts')"
RUN AUTH_SECRET=opencontext-build-only-auth-secret-not-for-runtime npm run build --workspace web

FROM base AS production-dependencies
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/schemas/package.json packages/schemas/package.json
RUN npm ci --omit=dev --ignore-scripts \
  && rm -rf node_modules/@prisma/adapter-better-sqlite3 node_modules/better-sqlite3

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
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "-c", "node node_modules/prisma/build/index.js migrate deploy --config apps/web/prisma.postgres.config.ts && exec node apps/web/server.js"]
