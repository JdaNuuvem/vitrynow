import { extractErrorMessage } from "@/core/http/FetchHttpClient";
import type { HttpResult } from "@/core/http/HttpClient";
import { uploadImage } from "@/core/gateways/http/uploadImage";
import { apiFetch } from "@/lib/api";
import { campaignBanner, type CampaignContent, type CampaignGateway, type CampaignState } from "./campaign";

const path = "/api/store/menu-campaign";
export const campaignEnabled = process.env.NEXT_PUBLIC_MENU_CAMPAIGN_ENABLED === "1";

async function request(subpath: string, init?: RequestInit): Promise<HttpResult<CampaignState>> {
  const response = await apiFetch(path + subpath, { cache: "no-store", ...init });
  const payload = await response.json().catch(() => null);
  if (!response.ok) return { ok: false, status: response.status, error: extractErrorMessage(payload), code: typeof payload?.code === "string" ? payload.code : undefined };
  if (!payload || !Number.isInteger(payload.revision) || !("draft" in payload) || !("published" in payload)) {
    return { ok: false, status: 502, error: "O serviço devolveu um estado de campanha inválido." };
  }
  return { ok: true, data: payload as CampaignState };
}

const revisionBody = (revision: number, method: "PUT" | "POST", draft?: CampaignContent): RequestInit => ({
  method, body: JSON.stringify(draft ? { revision, draft } : { revision }),
});

export const httpCampaignGateway: CampaignGateway = {
  load: () => request(""),
  saveDraft: (draft, revision) => request("", revisionBody(revision, "PUT", draft)),
  publish: (revision) => request("/publish", revisionBody(revision, "POST")),
  unpublish: (revision) => request("/unpublish", revisionBody(revision, "POST")),
  async upload(file) {
    const result = await uploadImage("COVER", file);
    return result.ok ? { ok: true, data: { url: result.data.image.url } } : result;
  },
};

export function demoCampaign(initial: CampaignContent) {
  let state: CampaignState = { revision: 0, draft: initial, published: null };
  const files = new Set<string>();
  const snapshot = (): HttpResult<CampaignState> => ({ ok: true, data: state });
  const apply = (revision: number, update: Partial<CampaignState>): HttpResult<CampaignState> => {
    if (revision !== state.revision) return { ok: false, status: 409, code: "CAMPAIGN_CHANGED", error: "A campanha mudou. Recarregue os dados antes de salvar." };
    state = { ...state, ...update, revision: revision + 1 };
    for (const url of files) {
      if (url === state.draft?.imageUrl || url === state.published?.imageUrl) continue;
      URL.revokeObjectURL(url);
      files.delete(url);
    }
    return snapshot();
  };
  const gateway: CampaignGateway = {
    load: async () => snapshot(),
    saveDraft: async (draft, revision) => apply(revision, { draft }),
    publish: async (revision) => state.draft
      ? apply(revision, { published: campaignBanner("campanha-demonstracao", state.draft) })
      : { ok: false, status: 400, error: "Salve um rascunho antes de publicar." },
    unpublish: async (revision) => apply(revision, { published: null }),
    async upload(file) {
      const url = URL.createObjectURL(file);
      files.add(url);
      return { ok: true, data: { url } };
    },
  };
  // Strict Mode monta os efeitos duas vezes. Durante a primeira desmontagem ainda não há uploads do usuário.
  return { gateway, dispose() { for (const url of files) URL.revokeObjectURL(url); files.clear(); } };
}
