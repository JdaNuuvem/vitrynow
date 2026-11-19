import type { Metadata } from "next";
import { PrivacyPage } from "@/features/privacidade/PrivacyPage";
import "@/features/plataforma/platform.css";

export const metadata: Metadata = { title: "Privacidade · VitryNow", robots: { index: false, follow: false } };

export default function PrivacyRoute() {
  return <PrivacyPage />;
}
