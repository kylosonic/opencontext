import Link from "next/link";
import { signOut } from "@/auth";

/**
 * Sign-out page (identity.md B6): clears the session and returns to the
 * landing page. A server-action form so no client JavaScript is needed.
 */
export default function SignOutPage() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-6 p-6">
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-2xl font-semibold text-zinc-900">Sign out</h1>
        <p className="text-sm text-zinc-500">
          Your session will be cleared. No job data is lost.
        </p>
      </div>
      <form
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/" });
        }}
      >
        <button
          type="submit"
          className="rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700"
        >
          Sign out
        </button>
      </form>
      <Link
        href="/"
        className="text-sm text-zinc-500 underline underline-offset-4 hover:text-zinc-700"
      >
        Cancel — back to the landing page
      </Link>
    </main>
  );
}
