import Credentials from "next-auth/providers/credentials";
import { deploymentEnvironment, devAuthEmail, devAuthEnabled } from "@opencontext/config";
import { prisma } from "@/server/db/prisma";

/**
 * Local-only credentials provider. It has no password and must never be
 * treated as an authentication boundary; it exists so a fresh checkout can
 * exercise the authenticated upload flow without creating an OAuth app.
 */
export function devAuthProviders() {
  if (!devAuthEnabled()) {
    return [];
  }
  // devAuthEnabled() already enforces this; keep the provider itself
  // fail-closed if its implementation changes later.
  if (deploymentEnvironment() !== "development") {
    return [];
  }
  return [
    Credentials({
      id: "local-dev",
      name: "Local development",
      credentials: {},
      async authorize() {
        const email = devAuthEmail();
        const user = await prisma.user.upsert({
          where: { email },
          create: { email, name: "Local OpenContext User", githubLogin: null },
          update: {},
        });
        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  ];
}
