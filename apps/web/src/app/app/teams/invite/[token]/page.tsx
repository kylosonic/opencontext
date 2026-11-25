import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AcceptInviteCard } from "@/components/app/accept-invite-card";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Container } from "@/components/ui/container";
import { inspectWorkspaceInvite } from "@/server/workspaces";

export const metadata: Metadata = {
  title: "Accept team invitation — OpenContext",
  description: "Accept a pending invitation to join an OpenContext team workspace.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AcceptInvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    redirect(
      `/auth/signin?callbackUrl=${encodeURIComponent(`/app/teams/invite/${token}`)}`,
    );
  }
  const inspection = await inspectWorkspaceInvite(token);

  return (
    <>
      <SiteHeader />
      <main id="main">
        <Container className="pb-16 pt-12">
          <div className="mx-auto max-w-xl">
            <AcceptInviteCard
              token={token}
              inspection={inspection}
              signedInEmail={session.user.email ?? null}
            />
          </div>
        </Container>
      </main>
      <SiteFooter />
    </>
  );
}
