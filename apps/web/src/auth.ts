import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/server/db/prisma";
import { authConfig } from "@/auth.config";
import { devAuthProviders } from "@/auth-dev";

/**
 * Full Auth.js v5 instance. The Prisma adapter persists OAuth accounts;
 * the session itself is a JWT (no Session table churn). The `signIn`
 * event backfills the blueprint §1 identity fields (githubId,
 * githubLogin, avatarUrl) from the GitHub profile — the adapter only
 * knows name/email/image, so a GitHub account without a visible email
 * still signs in cleanly (identity.md B2 edge case).
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  ...authConfig,
  providers: [...authConfig.providers, ...devAuthProviders()],
  events: {
    async signIn({ user, account, profile }) {
      if (account?.provider !== "github") {
        return;
      }
      const githubLogin =
        (profile as { login?: string } | undefined)?.login ?? user.name ?? null;
      const avatarUrl = user.image ?? null;
      await prisma.user
        .update({
          where: { id: user.id as string },
          data: {
            githubId: account.providerAccountId,
            githubLogin,
            avatarUrl,
          },
        })
        .catch(() => undefined); // never break sign-in over a sync failure
    },
  },
});
