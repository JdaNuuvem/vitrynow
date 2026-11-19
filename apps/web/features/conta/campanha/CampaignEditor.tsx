"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Category } from "@/core/domain/storefront";
import { IMAGE_FILE_ACCEPT, MAX_IMAGE_BYTES } from "@/core/gateways/http/uploadImage";
import { MenuBanner } from "@/features/loja/components/MenuBanner";
import { lojaThemeStyle } from "@/features/loja/theme";
import { Button, PageHeading, Panel, StateMessage, StatusBadge } from "@/shared/design/components";
import { campaignBanner, campaignValidation, EMPTY_CAMPAIGN, type CampaignContent, type CampaignGateway, type CampaignState } from "./campaign";
import "@/features/loja/loja.css";
import "@/features/loja/cardapio.css";
import "./campaign.css";

const positions: ReadonlyArray<[CampaignContent["imagePosition"], string]> = [
  ["center", "Centro"], ["center top", "Topo"], ["center bottom", "Base"], ["left center", "Esquerda"], ["right center", "Direita"],
];

export function CampaignEditor({ gateway, categories, accent, demo = false }: {
  gateway: CampaignGateway;
  categories: Category[];
  accent: string | null;
  demo?: boolean;
}) {
  const [state, setState] = useState<CampaignState | null>(null);
  const [draft, setDraft] = useState(EMPTY_CAMPAIGN);
  const [file, setFile] = useState<File | null>(null);
  const [fileUrl, setFileUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [device, setDevice] = useState<"mobile" | "desktop">("mobile");
  const [preview, setPreview] = useState<"draft" | "published">("draft");
  const [testTarget, setTestTarget] = useState<string | null>(null);
  const loadVersion = useRef(0);
  const running = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const updateState = useCallback((next: CampaignState, resetDraft: boolean) => {
    setState(next);
    if (resetDraft) {
      setDraft(next.draft ?? EMPTY_CAMPAIGN);
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
    }
  }, []);

  const load = useCallback(async () => {
    const current = ++loadVersion.current;
    setError(null);
    try {
      const result = await gateway.load();
      if (current !== loadVersion.current) return;
      if (!result.ok) setError(result.error);
      else { updateState(result.data, true); setConflict(false); }
    } catch {
      if (current === loadVersion.current) setError("Não foi possível acessar a campanha. Tente novamente.");
    }
  }, [gateway, updateState]);

  useEffect(() => {
    void load();
    return () => { loadVersion.current += 1; };
  }, [load]);

  useEffect(() => {
    if (!file) { setFileUrl(""); return; }
    const url = URL.createObjectURL(file);
    setFileUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const choices = categories.flatMap((category) => [
    { target: { kind: "category" as const, id: category.id }, label: `Categoria · ${category.name}` },
    ...category.products.map((product) => ({ target: { kind: "product" as const, id: product.id }, label: `Produto · ${product.name}` })),
  ]);
  const selection = choices.findIndex(({ target }) => target.kind === draft.action?.target.kind && target.id === draft.action?.target.id);
  const saved = state?.draft ?? EMPTY_CAMPAIGN;
  const dirty = !!file || JSON.stringify(saved) !== JSON.stringify(draft);

  function change(input: Partial<CampaignContent>) {
    setDraft((current) => ({ ...current, ...input }));
    setError(null);
    setNotice(null);
    setTestTarget(null);
  }

  async function mutate(action: "save" | "publish" | "unpublish") {
    if (!state || running.current) return;
    const input = { ...draft, title: draft.title.trim(), description: draft.description.trim(), imageUrl: draft.imageUrl.trim() };
    if (input.action) input.action = { ...input.action, label: input.action.label.trim() };
    if (action !== "unpublish") {
      const problem = campaignValidation(file ? { ...input, imageUrl: "" } : input, categories, action === "publish", demo);
      if (problem) return setError(problem);
    }
    running.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    function showFailure(failure: { error: string; status: number }) {
      setError(failure.error);
      setConflict(failure.status === 409);
    }
    try {
      let revision = state.revision;
      if (action === "save" || (action === "publish" && (dirty || !state.draft))) {
        if (file) {
          const upload = await gateway.upload(file);
          if (!upload.ok) return showFailure(upload);
          input.imageUrl = upload.data.url;
          const problem = campaignValidation(input, categories, action === "publish", demo);
          if (problem) return setError(problem);
          setDraft(input);
          setFile(null);
          if (fileInput.current) fileInput.current.value = "";
        }
        const result = await gateway.saveDraft(input, revision);
        if (!result.ok) return showFailure(result);
        revision = result.data.revision;
        updateState(result.data, true);
      }
      if (action !== "save") {
        const result = await (action === "publish" ? gateway.publish(revision) : gateway.unpublish(revision));
        if (!result.ok) return showFailure(result);
        updateState(result.data, action === "publish");
        setPreview(action === "publish" ? "published" : "draft");
      }
      setConflict(false);
      setNotice(action === "save" ? "Rascunho salvo." : action === "publish" ? "Campanha publicada." : "Campanha retirada do cardápio.");
    } catch {
      setError("Não foi possível concluir a alteração. Confira a conexão e tente novamente.");
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  const previewBanner = preview === "published" ? state?.published ?? undefined
    : draft.title.trim() ? campaignBanner("previa-campanha", { ...draft, imageUrl: fileUrl || draft.imageUrl.trim() }) : undefined;

  return (
    <main className="campaign-page">
      <PageHeading title="Campanha do cardápio" description="Adicione um destaque com imagem, texto e link para um produto ou categoria.">
        {!demo && <Link className="ds-button ds-button--quiet" href="/dashboard/conta">Voltar a Minha loja</Link>}
      </PageHeading>
      {demo && <StateMessage title="Prévia de desenvolvimento" tone="info">As alterações deste exemplo ficam disponíveis até recarregar a página.</StateMessage>}
      {!state && !error && <StateMessage title="Carregando campanha" busy />}
      {error && <StateMessage tone="danger" title="Ação indisponível"
        action={(!state || conflict) && <Button disabled={busy} onClick={() => void load()}>Recarregar versão salva</Button>}>{error}</StateMessage>}
      {notice && <StateMessage tone="success" title={notice} />}
      {state && <div className="campaign-layout">
        <Panel title="Conteúdo da campanha" actions={<StatusBadge tone={state.published ? "success" : "neutral"}>{state.published ? "Publicada" : "Rascunho"}</StatusBadge>}>
          <form className="campaign-form" onSubmit={(event) => { event.preventDefault(); void mutate("save"); }}>
            <fieldset disabled={busy}>
              <label>Título<input value={draft.title} maxLength={80} onChange={(event) => change({ title: event.target.value })} /></label>
              <label>Descrição <span>(opcional)</span><textarea rows={3} value={draft.description} maxLength={250} onChange={(event) => change({ description: event.target.value })} /></label>
              <label>Endereço da imagem <span>(opcional)</span><input type="text" inputMode="url" placeholder="https://" value={draft.imageUrl}
                maxLength={500} disabled={!!file} onChange={(event) => change({ imageUrl: event.target.value })} /></label>
              <label>Ou carregue uma imagem <span>JPEG, PNG ou WebP até 8 MB</span>
                <input ref={fileInput} type="file" accept={IMAGE_FILE_ACCEPT} onChange={(event) => {
                  const selected = event.target.files?.[0] ?? null;
                  if (selected && (selected.size > MAX_IMAGE_BYTES || !IMAGE_FILE_ACCEPT.split(",").includes(selected.type))) {
                    setFile(null);
                    event.target.value = "";
                    return setError("Escolha uma imagem JPEG, PNG ou WebP com até 8 MB.");
                  }
                  setFile(selected);
                  setError(null);
                  setNotice(null);
                }} />
              </label>
              {(file || draft.imageUrl) && <Button variant="quiet" onClick={() => {
                setFile(null);
                if (fileInput.current) fileInput.current.value = "";
                change({ imageUrl: "" });
              }}>Remover imagem</Button>}
              <div className="campaign-fields-row">
                <label>Estilo da imagem<select value={draft.imageLayout} onChange={(event) => change({ imageLayout: event.target.value as CampaignContent["imageLayout"] })}>
                  <option value="photo">Foto preenchendo a área</option><option value="cutout">Recorte sobre o fundo</option>
                </select></label>
                <label>Ponto de enquadramento<select value={draft.imagePosition} onChange={(event) => change({ imagePosition: event.target.value as CampaignContent["imagePosition"] })}>
                  {positions.map(([value, name]) => <option key={value} value={value}>{name}</option>)}
                </select></label>
              </div>
              <label className="campaign-check"><input type="checkbox" checked={!!draft.action} disabled={!choices.length && !draft.action} onChange={(event) => change({ action: event.target.checked
                ? { label: "", target: choices[0].target } : null })} /> Mostrar botão na campanha</label>
              {draft.action && <div className="campaign-fields-row">
                <label>Texto do botão<input value={draft.action.label} maxLength={35} onChange={(event) => {
                  if (draft.action) change({ action: { ...draft.action, label: event.target.value } });
                }} /></label>
                <label>Destino<select value={selection < 0 ? "" : String(selection)} onChange={(event) => {
                  if (draft.action && event.target.value !== "") change({ action: { ...draft.action, target: choices[Number(event.target.value)].target } });
                }}>
                  {selection < 0 && <option value="">Selecione um destino disponível</option>}
                  {choices.map(({ target, label }, index) => <option key={`${target.kind}-${target.id}`} value={index}>{label}</option>)}
                </select></label>
              </div>}
            </fieldset>
            <div className="campaign-actions">
              {state.published && <Button variant="quiet" disabled={busy || conflict} onClick={() => void mutate("unpublish")}>Retirar publicação</Button>}
              <Button type="submit" disabled={busy || conflict || !dirty}>Salvar rascunho</Button>
              <Button variant="primary" busy={busy} disabled={conflict || (state.published !== null && !dirty && !state.draft)} onClick={() => void mutate("publish")}>
                {state.published ? "Atualizar publicação" : demo ? "Publicar na prévia" : "Publicar campanha"}
              </Button>
            </div>
          </form>
        </Panel>
        <Panel title="Prévia da campanha" className="campaign-preview">
          <div className="campaign-preview__controls">
            <div role="group" aria-label="Conteúdo exibido">
              <Button aria-pressed={preview === "draft"} onClick={() => { setPreview("draft"); setTestTarget(null); }}>Rascunho</Button>
              <Button disabled={!state.published} aria-pressed={preview === "published"} onClick={() => { setPreview("published"); setTestTarget(null); }}>Publicada</Button>
            </div>
            <div role="group" aria-label="Largura da prévia">
              <Button aria-pressed={device === "mobile"} onClick={() => setDevice("mobile")}>Celular</Button>
              <Button aria-pressed={device === "desktop"} onClick={() => setDevice("desktop")}>Desktop</Button>
            </div>
          </div>
          <div className={`loja campaign-preview__frame campaign-preview__frame--${device}`} style={lojaThemeStyle(accent)}>
            {previewBanner ? <MenuBanner banner={previewBanner} categories={categories}
              onSelectCategory={(id) => setTestTarget(categories.find((category) => category.id === id)?.name ?? null)}
              onOpenProduct={(product) => setTestTarget(product.name)} /> : <StateMessage title="Adicione um título para visualizar a campanha" />}
          </div>
          {testTarget && <p role="status" className="campaign-preview__target">O botão abre {testTarget}.</p>}
        </Panel>
      </div>}
    </main>
  );
}
