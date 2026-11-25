import type { NextAuthConfig } from "next-auth";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";
import {
  authGithub,
  authGoogle,
  authOidc,
  authSecret,
} from "@opencontext/config";

/**
 * Edge-safe Auth.js configuration (no Prisma imports) — shared by the
 * full `src/auth.ts` (adapter included) and `src/proxy.ts`
 * (session decode only). Interactive OAuth/OIDC providers are registered
 * dynamically from environment variables; when none are set, the sign-in
 * page renders an honest notice instead of broken buttons.
 */
function buildProviders(): NextAuthConfig["providers"] {
  const providers: NextAuthConfig["providers"] = [];
  const github = authGithub();
  if (github) {
    providers.push(
      GitHub({
        clientId: github.clientId,
        clientSecret: github.clientSecret,
      }),
    );
  }
  const google = authGoogle();
  if (google) {
    providers.push(
      Google({
        clientId: google.clientId,
        clientSecret: google.clientSecret,
      }),
    );
  }
  const oidc = authOidc();
  if (oidc) {
    providers.push({
      id: "oidc",
      name: oidc.name,
      type: "oidc",
      issuer: oidc.issuer,
      clientId: oidc.clientId,
      clientSecret: oidc.clientSecret,
      checks: ["pkce", "state"],
    });
  }
  return providers;
}

export function resolveAuthTrustHost(
  env: Record<string, string | undefined>,
): boolean | undefined {
  if (env.VERCEL === "1") return true;
  const override = env.AUTH_TRUST_HOST?.trim().toLowerCase();
  if (!override) return undefined;
  return override === "true";
}

export const authConfig = {
  secret: authSecret(),
  // Vercel is a trusted proxy. Standalone deployments must opt in rather
  // than allowing arbitrary Host/X-Forwarded-Host values to determine URLs.
  // Leave this undefined unless explicitly configured so @auth/core can use
  // its AUTH_URL / development fallback. Explicit false still opts out.
  trustHost: resolveAuthTrustHost(process.env),
  session: { strategy: "jwt", maxAge: 24 * 60 * 60, updateAge: 15 * 60 },
  pages: {
    signIn: "/auth/signin",
    signOut: "/auth/signout",
  },
  providers: buildProviders(),
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
