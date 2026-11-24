import type { Metadata } from "next";
import Link from "next/link";
import { signOut } from "@/auth";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";

export const metadata: Metadata = {
  title: "Sign out — OpenContext",
  description: "Clear your current OpenContext browser session.",
};

/**
 * Sign-out page (identity.md B6): clears the session and returns to the
 * landing page. A server-action form so no client JavaScript is needed.
 */
export default function SignOutPage() {
  return (
    <>
      <SiteHeader />
      <main id="main">
        <Container className="py-16">
          <Card className="mx-auto flex max-w-md flex-col items-center gap-5 text-center">
            <div className="flex flex-col items-center gap-2">
              <p className="label-mono">Session</p>
              <h1 className="text-2xl font-semibold text-ink">Sign out</h1>
              <p className="text-sm text-ink-muted">
                Your session will be cleared. No job data is lost.
              </p>
            </div>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/" });
              }}
              className="w-full"
            >
              <Button type="submit" size="lg" className="w-full">
                Sign out
              </Button>
            </form>
            <Link
              href="/"
              className="text-sm text-ink-muted underline-offset-4 hover:text-ink hover:underline"
            >
              Cancel — back to the landing page
            </Link>
          </Card>
        </Container>
      </main>
      <SiteFooter />
    </>
  );
}
