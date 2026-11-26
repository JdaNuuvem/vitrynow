"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReelView } from "@meucardapio/shared-types";
import type { Category } from "@/core/domain/catalog";
import { FetchHttpClient } from "@/core/http/FetchHttpClient";
import { usePanelServices } from "@/core/services/PanelServices";
import { useCurrentRole } from "@/core/session/useCurrentRole";
import { Button, PageHeading, Panel, StateMessage, StatusBadge } from "@/shared/design/components";
import { formatCents } from "@/shared/format/money";
import "./reels-panel.css";

// REELS (tela nova do painel): um vídeo vertical de até 30 s por produto. Envia → prepara (1–2 min) → o dono confere → publica.
// No cardápio, os vídeos publicados aparecem como "Veja em vídeo" (estilo Reels).
const http = new FetchHttpClient();
const enc = encodeURIComponent;
const ACCEPT = "video/mp4,video/quicktime,.mp4,.mov";
const MAX_BYTES = 50 * 1024 * 1024;
const POLL_MS = 8000;

const STATUS: Record<ReelView["status"], { tone: "neutral" | "success" | "warning" | "danger" | "info"; label: string }> = {
  PROCESSING: { tone: "info", label: "Preparando…" },
  READY: { tone: "warning", label: "Pronto (não publicado)" },
  PUBLISHED: { tone: "success", label: "No cardápio" },
  FAILED: { tone: "danger", label: "Não deu certo" },
};

type Row = { id: string; name: string; category: string; priceCents: number; imageUrl: string | null; reel: ReelView | null };

export function ReelsPage() {
  const router = useRouter();
  const role = useCurrentRole();
  const owner = role === "OWNER";
  const { catalog } = usePanelServices();
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [reels, setReels] = useState<ReelView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [preview, setPreview] = useState<Row | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploadFor, setUploadFor] = useState<string | null>(null);

  const loadReels = useCallback(async () => {
    const r = await http.get<{ reels: ReelView[] }>("/api/reels");
    if (!r.ok) {
      if (r.status === 401) router.push("/login");
      if (r.status === 402 || r.status === 404) setLocked(r.status === 402 ? "plan" : "off");
      else setError(r.error);
      return;
    }
    setReels(r.data.reels);
  }, [router]);

  useEffect(() => {
    void loadReels();
    void catalog.listCategories().then((r) => (r.ok ? setCategories(r.data.categories) : setError(r.error)));
  }, [catalog, loadReels]);

  const processing = reels?.some((r) => r.status === "PROCESSING") ?? false;
  useEffect(() => {
    if (!processing) return;
    const t = window.setInterval(() => void loadReels(), POLL_MS);
    return () => window.clearInterval(t);
  }, [processing, loadReels]);

  const rows: Row[] = useMemo(() => {
    const byProduct = new Map((reels ?? []).filter((r) => r.productId).map((r) => [r.productId!, r]));
    const term = search.trim().toLocaleLowerCase("pt-BR");
    return (categories ?? []).flatMap((c) =>
      c.products
        .filter((p) => !term || p.name.toLocaleLowerCase("pt-BR").includes(term))
        .map((p) => ({ id: p.id, name: p.name, category: c.name, priceCents: p.priceCents, imageUrl: p.imageUrl, reel: byProduct.get(p.id) ?? null })),
    );
  }, [categories, reels, search]);

  async function act(key: string, action: () => Promise<{ ok: boolean; error?: string; status?: number }>) {
    setBusy(key);
    setError(null);
    const r = await action();
    setBusy(null);
    if (!r.ok) setError((r as { error: string }).error);
    await loadReels();
  }

  async function upload(productId: string, file: File) {
    if (file.size > MAX_BYTES) return setError("O vídeo passa de 50 MB. Grave mais curto ou em qualidade menor.");
    const form = new FormData();
    form.append("file", file);
    await act(productId, () => http.post(`/api/reels?productId=${enc(productId)}`, form));
  }

  if (locked) {
    return (
      <main className="reels-panel">
        <PageHeading title="Reels" />
        {locked === "plan" ? (
          <StateMessage tone="info" title="Os Reels fazem parte do plano PRO" action={<Link className="ds-button ds-button--primary" href="/dashboard/planos">Ver planos</Link>}>
            Mostre seus pratos em vídeos curtos, como nas redes sociais, direto no cardápio.
          </StateMessage>
        ) : (
          <StateMessage tone="warning" title="Os Reels ainda não estão ligados">A plataforma ainda não ligou os vídeos neste servidor.</StateMessage>
        )}
      </main>
    );
  }

  const used = (reels ?? []).filter((r) => r.status !== "FAILED");
  const usedMb = used.reduce((s, r) => s + r.bytes, 0) / (1024 * 1024);

  return (
    <main className="reels-panel">
      <PageHeading
        title="Reels"
        description="Vídeos verticais de até 30 segundos, um por prato. Eles aparecem no cardápio em “Veja em vídeo”, como nas redes sociais, com o botão de pedir."
        actions={<span className="reels-panel__muted">{used.length} de 10 vídeos · {usedMb.toFixed(0)} de 300 MB</span>}
      />
      {error ? <StateMessage tone="danger" title="Algo deu errado">{error}</StateMessage> : null}
      <ul className="reels-panel__tips">
        <li>Grave em pé (vertical), com boa luz, mostrando o prato de perto. Até 30 segundos, MP4 ou MOV, até 50 MB.</li>
        <li>Evite rostos de clientes e música de terceiros.</li>
      </ul>

      <input
        ref={fileInput}
        type="file"
        accept={ACCEPT}
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file && uploadFor) void upload(uploadFor, file);
        }}
      />

      <Panel title="Seus pratos">
        <label className="reels-panel__search">Buscar prato
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nome do prato" />
        </label>
        {!categories || !reels ? (
          <StateMessage busy title="Carregando…" />
        ) : rows.length === 0 ? (
          <StateMessage title="Nenhum prato encontrado">Cadastre produtos em <Link href="/dashboard/catalogo">Produtos</Link>.</StateMessage>
        ) : (
          <ul className="reels-panel__list">
            {rows.map((row) => {
              const st = row.reel ? STATUS[row.reel.status] : null;
              const rowBusy = busy === row.id || busy === row.reel?.id;
              return (
                <li key={row.id} className="reels-panel__item">
                  <div className="reels-panel__thumb">
                    {row.reel?.posterUrl ? <img src={row.reel.posterUrl} alt="" /> : row.imageUrl ? <img src={row.imageUrl} alt="" /> : <span aria-hidden="true">🎬</span>}
                  </div>
                  <div className="reels-panel__info">
                    <strong>{row.name}</strong>
                    <span className="reels-panel__muted">{row.category} · {formatCents(row.priceCents)}</span>
                    {row.reel?.status === "FAILED" && row.reel.errorMessage ? <span className="reels-panel__error">{row.reel.errorMessage}</span> : null}
                  </div>
                  {st ? <StatusBadge tone={st.tone}>{st.label}</StatusBadge> : <StatusBadge>Sem vídeo</StatusBadge>}
                  <div className="reels-panel__actions">
                    {row.reel?.videoUrl ? <Button onClick={() => setPreview(row)}>Ver vídeo</Button> : null}
                    {owner && row.reel?.status === "READY" ? (
                      <Button variant="primary" busy={rowBusy} onClick={() => void act(row.reel!.id, () => http.post(`/api/reels/${enc(row.reel!.id)}/publish`, {}))}>Publicar no cardápio</Button>
                    ) : null}
                    {owner && row.reel?.status === "PUBLISHED" ? (
                      <Button busy={rowBusy} onClick={() => void act(row.reel!.id, () => http.post(`/api/reels/${enc(row.reel!.id)}/unpublish`, {}))}>Tirar do cardápio</Button>
                    ) : null}
                    {!row.reel ? (
                      <Button variant="primary" busy={rowBusy} onClick={() => { setUploadFor(row.id); fileInput.current?.click(); }}>Enviar vídeo</Button>
                    ) : null}
                    {owner && row.reel && row.reel.status !== "PROCESSING" ? (
                      <Button
                        variant="quiet"
                        busy={rowBusy}
                        onClick={() => {
                          if (window.confirm(`Remover o vídeo de "${row.name}"? Ele sai do cardápio e o arquivo é apagado.`)) void act(row.reel!.id, () => http.post(`/api/reels/${enc(row.reel!.id)}/remove`, {}));
                        }}
                      >
                        {row.reel.status === "FAILED" ? "Remover e enviar outro" : "Remover"}
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      {preview?.reel?.videoUrl ? (
        <div className="reels-panel__overlay" role="dialog" aria-modal="true" aria-label={`Vídeo de ${preview.name}`} onClick={() => setPreview(null)}>
          <div className="reels-panel__dialog" onClick={(e) => e.stopPropagation()}>
            <div className="reels-panel__dialog-head">
              <h2>{preview.name}</h2>
              <Button variant="quiet" onClick={() => setPreview(null)}>Fechar</Button>
            </div>
            <video className="reels-panel__video" src={preview.reel.videoUrl} poster={preview.reel.posterUrl ?? undefined} controls autoPlay playsInline loop />
            <p className="reels-panel__muted">{preview.reel.status === "PUBLISHED" ? "Este vídeo está no cardápio." : "Confira antes de publicar."}</p>
          </div>
        </div>
      ) : null}
    </main>
  );
}
