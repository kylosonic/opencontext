import type { Metadata } from "next";
import Link from "next/link";
import { auth, signIn } from "@/auth";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { configuredAuthProviders, devAuthEnabled } from "@opencontext/config";
import { safeCallbackUrl as parseSafeCallbackUrl } from "./callback-url";

export const metadata: Metadata = {
  title: "Sign in — OpenContext",
  description:
    "Sign in to upload media, manage analyses, and collaborate with your OpenContext teams.",
};

/**
 * Custom sign-in page (Auth.js v5). Renders configured providers (GitHub,
 * Google, and optional generic OIDC Enterprise SSO); otherwise shows an honest
 * "not configured" notice (identity.md B2 failure outcome — never a broken button).
 * The `error` search param covers canceled/failed authorizations (B3).
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const session = await auth();
  const { callbackUrl, error } = await searchParams;
  const providers = configuredAuthProviders();
  const localDev = devAuthEnabled();

  const safeCallbackUrl = parseSafeCallbackUrl(callbackUrl);

  return (
    <>
      <SiteHeader />
      <main id="main">
        <Container className="py-16">
          {session?.user ? (
            <Card className="mx-auto max-w-md space-y-5 text-center">
              <p className="text-sm text-ink-muted">You are already signed in.</p>
              <ButtonLink href={safeCallbackUrl} className="w-full">
                Continue
              </ButtonLink>
            </Card>
          ) : (
            <Card className="mx-auto flex max-w-md flex-col items-center gap-5">
              <div className="flex flex-col items-center gap-2 text-center">
                <p className="label-mono">Authentication</p>
                <h1 className="text-2xl font-semibold text-ink">Sign in</h1>
                <p className="text-sm text-ink-muted">
                  {localDev
                    ? "Use the local development identity for this checkout, or sign in with a configured account provider."
                    : providers.length === 1 && providers[0].id === "github"
                      ? "Creating and viewing jobs requires a GitHub account."
                      : "Sign in with your configured account provider to upload media and manage team analyses."}
                </p>
              </div>

              {error ? (
                <p
                  role="alert"
                  className="w-full rounded-md border border-warn/30 bg-warn-bg/60 px-4 py-3 text-sm text-ink"
                >
                  Sign-in was canceled or did not complete — you can continue
                  browsing, or try again.
                </p>
              ) : null}

              {providers.length > 0 ? (
                <div className="flex w-full flex-col gap-3">
                  {providers.map((provider) => (
                    <form
                      key={provider.id}
                      action={async () => {
                        "use server";
                        await signIn(provider.id, { redirectTo: safeCallbackUrl });
                      }}
                      className="w-full"
                    >
                      <Button
                        type="submit"
                        className="w-full"
                        size="lg"
                        variant={provider.id === providers[0].id ? "primary" : "secondary"}
                      >
                        {provider.id === "github" ? (
                          <svg
                            viewBox="0 0 16 16"
                            className="size-4 fill-current"
                            aria-hidden="true"
                          >
                            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
                          </svg>
                        ) : null}
                        Sign in with {provider.name}
                      </Button>
                    </form>
                  ))}
                </div>
              ) : !localDev ? (
                <div className="w-full rounded-md border border-line bg-panel-muted px-4 py-3 text-sm text-ink-muted">
                  Sign-in is not configured on this deployment. You can continue
                  browsing the public pages and the demo.
                </div>
              ) : null}

              {localDev ? (
                <form
                  action={async () => {
                    "use server";
                    await signIn("local-dev", { redirectTo: safeCallbackUrl });
                  }}
                  className="w-full"
                >
                  <Button
                    type="submit"
                    variant="secondary"
                    size="lg"
                    className="w-full"
                  >
                    Continue as local user
                  </Button>
                </form>
              ) : null}

              <Link
                href="/"
                className="text-sm text-ink-muted underline-offset-4 hover:text-ink hover:underline"
              >
                Back to the landing page
              </Link>
            </Card>
          )}
        </Container>
      </main>
      <SiteFooter />
    </>
  );
}
