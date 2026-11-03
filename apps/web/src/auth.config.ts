import type { NextAuthConfig } from "next-auth";
import GitHub from "next-auth/providers/github";
import { authGithub, authSecret } from "@opencontext/config";

/**
 * Edge-safe Auth.js configuration (no Prisma imports) — shared by the
 * full `src/auth.ts` (adapter included) and `src/middleware.ts`
 * (session decode only). GitHub sign-in is offered only when
 * AUTH_GITHUB_ID/AUTH_GITHUB_SECRET are both present; otherwise the
 * providers array is empty and the app boots with the honest
 * "Sign-in is not configured" notice (identity.md failure outcomes).
 */
const github = authGithub();

export const authConfig = {
  secret: authSecret(),
  session: { strategy: "jwt" },
  pages: {
    signIn: "/auth/signin",
    signOut: "/auth/signout",
  },
  providers: github
    ? [
        GitHub({
          clientId: github.clientId,
          clientSecret: github.clientSecret,
          allowDangerousEmailAccountLinking: true,
        }),
      ]
    : [],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        const id = (user as { id?: string }).id ?? token.sub;
        (token as { id?: string; githubLogin?: string | null }).id = id;
        (token as { id?: string; githubLogin?: string | null }).githubLogin =
          (user as { githubLogin?: string | null }).githubLogin ?? null;
      } else if (token.sub && !(token as { id?: string }).id) {
        (token as { id?: string }).id = token.sub;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        const t = token as { id?: string; githubLogin?: string | null; sub?: string };
        (session.user as { id?: string; githubLogin?: string | null }).id =
          t.id ?? t.sub ?? "";
        (session.user as { id?: string; githubLogin?: string | null }).githubLogin =
          t.githubLogin ?? null;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
