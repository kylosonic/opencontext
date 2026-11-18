// The portable image uses PostgreSQL and excludes the SQLite runtime adapter.
// This declaration keeps the shared source tree type-checkable.
declare module "@prisma/adapter-better-sqlite3";
