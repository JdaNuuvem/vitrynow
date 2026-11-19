import type { Metadata } from "next";
import "@/features/plataforma/platform.css";

export const metadata: Metadata = {
  title: "Plataforma · VitryNow",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  return children;
}
