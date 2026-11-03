import Link from "next/link";
import { auth, signIn } from "@/auth";
import { authGithubConfigured } from "@opencontext/config";

/**
 * Custom sign-in page (Auth.js v5). Offers "Sign in with GitHub" when the
 * provider is configured; otherwise shows an honest "not configured"
 * notice (identity.md B2 failure outcome — never a broken button).
 * The `error` search param covers canceled/failed authorizations (B3).
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const session = await auth();
  const { callbackUrl, error } = await searchParams;
  const configured = authGithubConfigured();

  // Open-redirect guard: only allow same-origin relative destinations.
  const safeCallbackUrl =
    callbackUrl && callbackUrl.startsWith("/") && !callbackUrl.startsWith("//")
      ? callbackUrl
      : "/app";

  if (session?.user) {
    // Already signed in — send them where they were going.
    return (
      <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-6 p-6">
        <p className="text-sm text-zinc-500">You are already signed in.</p>
        <a
          href={safeCallbackUrl}
          className="rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white"
        >
          Continue
        </a>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-6 p-6">
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-2xl font-semibold text-zinc-900">Sign in</h1>
        <p className="text-sm text-zinc-500">
          Creating and viewing jobs requires a GitHub account.
        </p>
      </div>

      {error ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Sign-in was canceled or did not complete — you can continue
          browsing, or try again.
        </p>
      ) : null}

      {configured ? (
        <form
          action={async () => {
            "use server";
            await signIn("github", { redirectTo: safeCallbackUrl });
          }}
          className="w-full"
        >
          <button
            type="submit"
            className="flex w-full items-center justify-center gap-3 rounded-lg bg-zinc-900 px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-zinc-700"
          >
            <svg viewBox="0 0 16 16" className="h-5 w-5 fill-current" aria-hidden="true">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
            </svg>
            Sign in with GitHub
          </button>
        </form>
      ) : (
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-600">
          Sign-in is not configured on this deployment. You can continue
          browsing the public pages and the demo.
        </div>
      )}

      <Link
        href="/"
        className="text-sm text-zinc-500 underline underline-offset-4 hover:text-zinc-700"
      >
        Back to the landing page
      </Link>
    </main>
  );
}
