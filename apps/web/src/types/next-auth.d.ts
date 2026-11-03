import type { DefaultSession } from "next-auth";

/**
 * Session/user shape carried by the JWT session strategy. `id` is the
 * Prisma User.id (stable across providers); `githubLogin` is the GitHub
 * handle when the session came from the GitHub provider.
 */
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      githubLogin?: string | null;
    } & DefaultSession["user"];
  }

  interface User {
    githubLogin?: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    githubLogin?: string | null;
  }
}
