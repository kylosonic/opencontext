import { redirect } from "next/navigation";

/** Stable destination for legacy `/app` links and direct sign-in redirects. */
export default function AppIndexPage(): never {
  redirect("/app/jobs");
}
