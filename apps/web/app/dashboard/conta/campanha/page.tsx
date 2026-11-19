import { notFound } from "next/navigation";
import { campaignEnabled } from "@/features/conta/campanha/campaignGateways";
import { StoreCampaignPage } from "@/features/conta/campanha/CampaignPages";

export default function Page() {
  if (!campaignEnabled) notFound();
  return <StoreCampaignPage />;
}
