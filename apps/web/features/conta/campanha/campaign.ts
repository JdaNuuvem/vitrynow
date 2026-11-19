import type { Category, MenuBannerConfig, MenuBannerTarget } from "@/core/domain/storefront";
import type { HttpResult } from "@/core/http/HttpClient";
import { resolveBannerTarget } from "@/features/loja/banners";
import { validateStoreImageUrl } from "@/shared/format/imageUrl";

export type CampaignContent = {
  title: string;
  description: string;
  imageUrl: string;
  imageLayout: "photo" | "cutout";
  imagePosition: "center" | "center top" | "center bottom" | "left center" | "right center";
  action: { label: string; target: MenuBannerTarget } | null;
};

export type CampaignState = { revision: number; draft: CampaignContent | null; published: MenuBannerConfig | null };

export interface CampaignGateway {
  load(): Promise<HttpResult<CampaignState>>;
  saveDraft(draft: CampaignContent, revision: number): Promise<HttpResult<CampaignState>>;
  publish(revision: number): Promise<HttpResult<CampaignState>>;
  unpublish(revision: number): Promise<HttpResult<CampaignState>>;
  upload(file: File): Promise<HttpResult<{ url: string }>>;
}

export const EMPTY_CAMPAIGN: CampaignContent = { title: "", description: "", imageUrl: "", imageLayout: "photo", imagePosition: "center", action: null };

export function campaignBanner(id: string, content: CampaignContent): MenuBannerConfig {
  return { id, ...content, action: content.action ?? undefined };
}

export function campaignValidation(draft: CampaignContent, categories: Category[], publish: boolean, demo: boolean) {
  const action = draft.action;
  const url = draft.imageUrl.trim();
  if (draft.title.trim().length > 80 || draft.description.trim().length > 250 || (action && action.label.trim().length > 35)) {
    return "Use até 80 caracteres no título, 250 na descrição e 35 no botão.";
  }
  if (url && !(demo && (url.startsWith("blob:") || url === "/campanhas/ramenku-tigela.webp"))) {
    const error = validateStoreImageUrl(url);
    if (error) return error;
  }
  if (!publish) return null;
  if (!draft.title.trim()) return "Informe um título antes de publicar.";
  if (action && (!action.label.trim() || !resolveBannerTarget(action.target, categories))) {
    return "Preencha o texto do botão e escolha um destino disponível no cardápio.";
  }
  return null;
}
