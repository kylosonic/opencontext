import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveDirectNeonUrl,
  isPostgresUrl,
  resolvePostgresMigrationUrl,
  shouldRunBuildMigrations,
} from "./prisma-migrate-build.mjs";

test("isPostgresUrl accepts postgres/postgresql schemes and rejects others", () => {
  assert.equal(isPostgresUrl("postgresql://user:pass@localhost:5432/db"), true);
  assert.equal(isPostgresUrl("  POSTGRES://user:pass@host/db "), true);
  assert.equal(isPostgresUrl("file:./prisma/dev.db"), false);
  assert.equal(isPostgresUrl(""), false);
  assert.equal(isPostgresUrl(undefined), false);
});

test("deriveDirectNeonUrl strips -pooler for neon.tech hosts and preserves credentials/query", () => {
  const pooled =
    "postgresql://neondb_owner:secret_pw@ep-foo-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require";
  const derived = deriveDirectNeonUrl(pooled);

  assert.equal(derived.derived, true);
  assert.equal(
    derived.url,
    "postgresql://neondb_owner:secret_pw@ep-foo.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require",
  );

  const nonNeon = "postgresql://user:pass@db-pooler.example.com:5432/opencontext";
  assert.deepEqual(deriveDirectNeonUrl(nonNeon), { url: nonNeon, derived: false });

  const alreadyDirect =
    "postgresql://user:pass@ep-foo.us-east-2.aws.neon.tech/neondb?sslmode=require";
  assert.deepEqual(deriveDirectNeonUrl(alreadyDirect), {
    url: alreadyDirect,
    derived: false,
  });
});

test("resolvePostgresMigrationUrl enforces direct/unpooled priority and skips whitespace", () => {
  const base = "postgresql://u:p@ep-bar-pooler.us-east-2.aws.neon.tech/db?sslmode=require";

  const fromDirect = resolvePostgresMigrationUrl({
    DIRECT_URL: "postgresql://u:p@direct.example.com/db",
    DATABASE_URL_UNPOOLED: "postgresql://u:p@unpooled.example.com/db",
    POSTGRES_URL_NON_POOLING: "postgresql://u:p@pgnonpool.example.com/db",
    DATABASE_URL: base,
  });
  assert.deepEqual(fromDirect, {
    url: "postgresql://u:p@direct.example.com/db",
    source: "DIRECT_URL",
  });

  const fromUnpooled = resolvePostgresMigrationUrl({
    DIRECT_URL: "   ",
    DATABASE_URL_UNPOOLED: "postgresql://u:p@unpooled.example.com/db",
    POSTGRES_URL_NON_POOLING: "postgresql://u:p@pgnonpool.example.com/db",
    DATABASE_URL: base,
  });
  assert.deepEqual(fromUnpooled, {
    url: "postgresql://u:p@unpooled.example.com/db",
    source: "DATABASE_URL_UNPOOLED",
  });

  const fromPgNonPooling = resolvePostgresMigrationUrl({
    POSTGRES_URL_NON_POOLING: "postgres://u:p@pgnonpool.example.com/db",
    DATABASE_URL: base,
  });
  assert.deepEqual(fromPgNonPooling, {
    url: "postgres://u:p@pgnonpool.example.com/db",
    source: "POSTGRES_URL_NON_POOLING",
  });

  const fromNeonPoolerFallback = resolvePostgresMigrationUrl({
    DIRECT_URL: "",
    DATABASE_URL: base,
  });
  assert.equal(fromNeonPoolerFallback.source, "DATABASE_URL (neon direct)");
  assert.equal(
    fromNeonPoolerFallback.url,
    "postgresql://u:p@ep-bar.us-east-2.aws.neon.tech/db?sslmode=require",
  );

  assert.deepEqual(
    resolvePostgresMigrationUrl({ DATABASE_URL: "file:./prisma/dev.db" }),
    { url: null, source: null },
  );
});

test("shouldRunBuildMigrations skips non-Vercel builds (SQLite, local Postgres, Docker)", () => {
  assert.equal(
    shouldRunBuildMigrations({ DATABASE_URL: "file:./prisma/dev.db" }).run,
    false,
  );
  assert.equal(
    shouldRunBuildMigrations({
      DATABASE_URL: "postgresql://opencontext:opencontext@db:5432/opencontext?schema=public",
    }).run,
    false,
  );
});

test("shouldRunBuildMigrations skips Vercel preview by default and allows opt-in", () => {
  const previewDefault = shouldRunBuildMigrations({
    VERCEL: "1",
    VERCEL_ENV: "preview",
    DATABASE_URL: "postgresql://u:p@db.example.com/opencontext",
  });
  assert.equal(previewDefault.run, false);
  assert.match(previewDefault.reason, /preview/);

  const previewOptIn = shouldRunBuildMigrations({
    VERCEL: "1",
    VERCEL_ENV: "preview",
    PRISMA_MIGRATE_ON_BUILD: "true",
    DATABASE_URL: "postgresql://u:p@db.example.com/opencontext",
  });
  assert.equal(previewOptIn.run, true);
  assert.equal(previewOptIn.urlSource, "DATABASE_URL");
});

test("shouldRunBuildMigrations runs on Vercel production with Postgres and honors opt-out", () => {
  const prodPostgresql = shouldRunBuildMigrations({
    VERCEL: "1",
    VERCEL_ENV: "production",
    DATABASE_URL: "postgresql://u:p@ep-baz-pooler.us-east-2.aws.neon.tech/db?sslmode=require",
  });
  assert.equal(prodPostgresql.run, true);
  assert.equal(prodPostgresql.urlSource, "DATABASE_URL (neon direct)");

  const prodPostgres = shouldRunBuildMigrations({
    VERCEL: "true",
    VERCEL_ENV: "production",
    DATABASE_URL: "postgres://u:p@db.example.com/db",
  });
  assert.equal(prodPostgres.run, true);
  assert.equal(prodPostgres.urlSource, "DATABASE_URL");

  for (const disabledValue of ["false", "0"]) {
    const disabled = shouldRunBuildMigrations({
      VERCEL: "1",
      VERCEL_ENV: "production",
      PRISMA_MIGRATE_ON_BUILD: disabledValue,
      DATABASE_URL: "postgresql://u:p@db.example.com/db",
    });
    assert.equal(disabled.run, false);
  }

  const prodWithoutPostgres = shouldRunBuildMigrations({
    VERCEL: "1",
    VERCEL_ENV: "production",
    DATABASE_URL: "file:./prisma/dev.db",
  });
  assert.equal(prodWithoutPostgres.run, false);
});

test("shouldRunBuildMigrations throws on missing Postgres URL when forced or invalid flag", () => {
  assert.throws(
    () =>
      shouldRunBuildMigrations({
        PRISMA_MIGRATE_ON_BUILD: "true",
        DATABASE_URL: "file:./prisma/dev.db",
      }),
    /no PostgreSQL connection URL/,
  );

  assert.throws(
    () =>
      shouldRunBuildMigrations({
        PRISMA_MIGRATE_ON_BUILD: "maybe",
      }),
    /Invalid PRISMA_MIGRATE_ON_BUILD/,
  );
});
