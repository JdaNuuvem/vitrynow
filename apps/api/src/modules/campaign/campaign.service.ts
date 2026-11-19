// Campanha principal do cardápio (CONTRATO-CAMPANHA). Uma linha por loja, revisão OTIMISTA: toda escrita é `UPDATE ... WHERE revision = esperada` (ou INSERT da
// revisão 1 quando a loja não tem linha) e incrementa na MESMA instrução; quem perde a corrida recebe 409 CAMPAIGN_CHANGED e nada é gravado.
// O público só enxerga a CÓPIA publicada (`published`), montada por lista de permissão; salvar rascunho nunca a altera.
import { Prisma, prisma } from "@meucardapio/db";
import type { CampaignContent } from "@meucardapio/shared-types";
import { CodedError } from "../../shared/errors";

export type PublishedCampaign = Omit<CampaignContent, "action"> & { id: string; action?: NonNullable<CampaignContent["action"]> };
export type CampaignState = { revision: number; draft: CampaignContent | null; published: PublishedCampaign | null };

const changed = () => new CodedError(409, "CAMPAIGN_CHANGED", "A campanha mudou. Recarregue os dados antes de salvar.");
const invalid = (message: string) => new CodedError(400, "CAMPAIGN_INVALID", message);

// Endereço gerenciado: .../stores/<storeId>/<uuid>-<largura>.webp (absoluto ou /media/...). O id da loja do endereço TEM de ser o desta loja e a imagem tem de
// existir na tabela `Image` dela (nunca por prefixo de texto). Qualquer outro caso cai na regra do https.
const MANAGED = /(?:^|\/)stores\/([^/]+)\/([0-9a-f-]{36})-\d+\.webp$/i;

export async function validateCampaignImage(storeId: string, url: string): Promise<void> {
  if (url === "") return;
  const managed = MANAGED.exec(url.split(/[?#]/)[0]);
  if (managed) {
    const [, owner, uuid] = managed;
    const found = owner === storeId ? await prisma.image.count({ where: { storeId, status: "READY", keyBase: { endsWith: uuid } } }) : 0;
    if (found === 0) throw invalid("A imagem não é desta loja."); // mesma resposta para imagem alheia e inexistente
    return;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw invalid("Use um endereço de imagem que comece com https://.");
  }
  if (!/^https:\/\//i.test(url) || parsed.protocol !== "https:" || parsed.hostname === "" || parsed.username !== "" || parsed.password !== "") {
    throw invalid("Use um endereço de imagem que comece com https://.");
  }
}

/** Destino visível e DESTA loja: categoria da loja, ou produto ativo da loja. */
export async function targetExists(storeId: string, target: { kind: "category" | "product"; id: string }): Promise<boolean> {
  if (target.kind === "category") return (await prisma.category.count({ where: { id: target.id, storeId } })) > 0;
  return (await prisma.product.count({ where: { id: target.id, storeId, active: true, sellAlone: true } })) > 0;
}

const toState = (row: { revision: number; draft: Prisma.JsonValue | null; published: Prisma.JsonValue | null }): CampaignState => ({
  revision: row.revision,
  draft: (row.draft as CampaignContent | null) ?? null,
  published: (row.published as PublishedCampaign | null) ?? null,
});

export async function getCampaign(storeId: string): Promise<CampaignState> {
  const row = await prisma.menuCampaign.findUnique({ where: { storeId } });
  return row ? toState(row) : { revision: 0, draft: null, published: null };
}

const json = (value: unknown) => (value === null || value === undefined ? Prisma.DbNull : (value as Prisma.InputJsonValue));

/** Escrita com revisão esperada: só vale se a revisão atual for `expected`; incrementa na mesma instrução. */
async function write(storeId: string, expected: number, data: { draft?: CampaignContent | null; published?: PublishedCampaign | null }): Promise<CampaignState> {
  if (expected === 0) {
    try {
      return toState(await prisma.menuCampaign.create({ data: { storeId, revision: 1, draft: json(data.draft), published: json(data.published) } }));
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") throw changed(); // outra escrita criou a linha antes
      throw error;
    }
  }
  const patch: Prisma.MenuCampaignUncheckedUpdateManyInput = { revision: { increment: 1 } };
  if (data.draft !== undefined) patch.draft = json(data.draft);
  if (data.published !== undefined) patch.published = json(data.published);
  const result = await prisma.menuCampaign.updateMany({ where: { storeId, revision: expected }, data: patch });
  if (result.count !== 1) throw changed();
  return getCampaign(storeId);
}

export async function saveDraft(storeId: string, revision: number, draft: CampaignContent): Promise<CampaignState> {
  await validateCampaignImage(storeId, draft.imageUrl);
  return write(storeId, revision, { draft });
}

export async function publish(storeId: string, revision: number): Promise<CampaignState> {
  const row = await prisma.menuCampaign.findUnique({ where: { storeId } });
  const draft = (row?.draft as CampaignContent | null) ?? null;
  if (!row || !draft) {
    if (row === null && revision !== 0) throw changed();
    throw invalid("Salve um rascunho antes de publicar.");
  }
  if (row.revision !== revision) throw changed();
  if (draft.title.trim() === "") throw invalid("Informe o título da campanha.");
  if (draft.action) {
    if (draft.action.label.trim() === "") throw invalid("Informe o texto do botão.");
    if (!(await targetExists(storeId, draft.action.target))) throw invalid("O destino do botão não existe nesta loja.");
  }
  await validateCampaignImage(storeId, draft.imageUrl); // reconfere: a imagem pode ter sido removida depois do rascunho
  const { action, ...rest } = draft;
  const published: PublishedCampaign = { id: row.publicId, ...rest, ...(action ? { action } : {}) }; // cópia: salvar rascunho depois não a muda
  return write(storeId, revision, { published });
}

export async function unpublish(storeId: string, revision: number): Promise<CampaignState> {
  return write(storeId, revision, { published: null });
}

/** DTO do cardápio público: só a cópia publicada, por lista de permissão; o botão some se o destino deixou de existir (CONTRATO). */
export async function publicCampaign(storeId: string) {
  const row = await prisma.menuCampaign.findUnique({ where: { storeId }, select: { published: true } });
  const p = (row?.published as PublishedCampaign | null | undefined) ?? null;
  if (!p) return null;
  const action = p.action && (await targetExists(storeId, p.action.target)) ? { label: p.action.label, target: { kind: p.action.target.kind, id: p.action.target.id } } : undefined;
  return { id: p.id, title: p.title, description: p.description, imageUrl: p.imageUrl, imageLayout: p.imageLayout, imagePosition: p.imagePosition, ...(action ? { action } : {}) };
}

/** A campanha (rascunho ou publicada) usa esta imagem? Usado pela remoção de mídia (IMAGE_IN_USE). O uuid da chave identifica a imagem. */
export async function campaignUsesImage(storeId: string, keyBase: string): Promise<boolean> {
  const row = await prisma.menuCampaign.findUnique({ where: { storeId }, select: { draft: true, published: true } });
  if (!row) return false;
  return JSON.stringify([row.draft, row.published]).includes(keyBase.slice(keyBase.lastIndexOf("/") + 1));
}
