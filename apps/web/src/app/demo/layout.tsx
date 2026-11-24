import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Demo analysis — OpenContext",
  description:
    "Explore a synthetic end-to-end OpenContext analysis with interactive timeline, transcript, OCR, and evidence review without signing in.",
};

export default function DemoLayout({ children }: { children: ReactNode }) {
  return children;
}
