"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DISH3D_FAILURE_LABELS, DISH3D_MAX_PHOTO_BYTES, DISH3D_MAX_PHOTOS, DISH3D_SIZE_MAX_CM, DISH3D_SIZE_MIN_CM } from "@meucardapio/shared-types";
import type { Dish3dList, Dish3dProductRow } from "@/core/domain/dish3d";
import { dish3dApi } from "@/core/gateways/http/dish3d";
import type { HttpResult } from "@/core/http/HttpClient";
import { useCurrentRole } from "@/core/session/useCurrentRole";
import { Button, PageHeading, Panel, StateMessage, StatusBadge } from "@/shared/design/components";
import { Dish3dViewer, formatRealSize } from "@/shared/dish3d/Dish3dViewer";
import "./pratos3d.css";

// PRATO 3D (tela nova): o dono envia 1 a 4 fotos do prato, a geração roda em segundo plano (~2 a 5 min),
// o modelo chega como RASCUNHO e só vai ao cardápio quando o dono publica.
const POLL_MS = 10_000;
const ACCEPT = "image/jpeg,image/png,image/webp";

function statusOf(p: Dish3dProductRow): { tone: "neutral" | "success" | "warning" | "danger" | "info"; label: string } {
  if (p.generating) return { tone: "info", label: "Gerando…" };
  if (p.model3dUrl && p.published) return { tone: "success", label: "No cardápio" };
  if (p.model3dUrl) return { tone: "warning", label: "Rascunho" };
  if (p.lastError) return { tone: "danger", label: "Falhou" };
  return { tone: "neutral", label: "Sem 3D" };
}

export function Pratos3dPage() {
  const router = useRouter();
  const owner = useCurrentRole() === "OWNER";
  const [data, setData] = useState<Dish3dList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [generating, setGenerating] = useState<Dish3dProductRow | null>(null);
  const [viewing, setViewing] = useState<Dish3dProductRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const version = useRef(0);

  const reload = useCallback(async () => {
    const current = ++version.current;
    const result = await dish3dApi.list();
    if (current !== version.current) return;
    if (!result.ok) {
      if (result.status === 401) router.push("/login");
      setError(result.error);
      return;
    }
    setError(null);
    setData(result.data);
  }, [router]);

  useEffect(() => {
    if (owner) void reload();
  }, [owner, reload]);

  // enquanto algum prato estiver gerando, consulta de novo a cada 10 s
  const anyRunning = data?.products.some((p) => p.generating) ?? false;
  useEffect(() => {
    if (!anyRunning) return;
    const timer = window.setInterval(() => void reload(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [anyRunning, reload]);

  async function act(productId: string, action: () => Promise<HttpResult<unknown>>) {
    setBusy(productId);
    const result = await action();
    setBusy(null);
    if (!result.ok) {
      if (result.status === 401) router.push("/login");
      setError(result.error);
      return;
    }
    await reload();
  }

  const products = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("pt-BR");
    const all = data?.products ?? [];
    return term ? all.filter((p) => p.name.toLocaleLowerCase("pt-BR").includes(term) || (p.category ?? "").toLocaleLowerCase("pt-BR").includes(term)) : all;
  }, [data, search]);

  if (!owner) {
    return (
      <main className="pratos3d">
        <PageHeading title="Pratos 3D" />
        <StateMessage tone="warning" title="Só o dono da loja gera pratos 3D">Gerar um prato 3D gasta créditos da loja.</StateMessage>
      </main>
    );
  }

  const credits = data?.credits;
  const enough = credits ? credits.balance >= credits.cost : false;

  return (
    <main className="pratos3d">
      <PageHeading
        title="Pratos 3D"
        description="Mande de 1 a 4 fotos do prato e receba um modelo 3D que o cliente gira no cardápio e vê na mesa pela câmera do celular."
        actions={credits ? <span className="pratos3d__credits">Saldo: <strong>{credits.balance}</strong> créditos · cada prato: {credits.cost}</span> : null}
      />

      {error ? <StateMessage tone="danger" title="Algo deu errado">{error}</StateMessage> : null}
      {data && !data.available ? (
        <StateMessage tone="warning" title="O prato 3D ainda não está ligado">A plataforma ainda não configurou o serviço de 3D neste ambiente.</StateMessage>
      ) : null}
      {data && data.available && !enough ? (
        <StateMessage tone="warning" title="Créditos insuficientes">Você precisa de {credits!.cost} créditos para gerar um prato. Fale com o suporte para comprar créditos.</StateMessage>
      ) : null}

      <Panel title="Seus pratos">
        <label className="pratos3d__search">
          Buscar prato
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nome ou categoria" />
        </label>
        {!data ? (
          <StateMessage busy title="Carregando pratos…" />
        ) : products.length === 0 ? (
          <StateMessage title="Nenhum prato encontrado">
            Cadastre produtos em <Link href="/dashboard/catalogo">Produtos</Link>.
          </StateMessage>
        ) : (
          <ul className="pratos3d__list">
            {products.map((p) => {
              const status = statusOf(p);
              const rowBusy = busy === p.id;
              return (
                <li key={p.id} className="pratos3d__item">
                  <div className="pratos3d__thumb">{p.imageUrl ? <img src={p.imageUrl} alt="" loading="lazy" /> : <span aria-hidden="true">🍽</span>}</div>
                  <div className="pratos3d__info">
                    <strong>{p.name}</strong>
                    <span className="pratos3d__muted">{p.category ?? "Sem categoria"}{p.model3dUrl && p.widthMm ? ` · tamanho real ${formatRealSize(p.widthMm)}` : ""}</span>
                    {p.lastError && !p.generating && !p.model3dUrl ? <span className="pratos3d__error">{DISH3D_FAILURE_LABELS[p.lastError] ?? "A geração falhou."} Os créditos foram devolvidos.</span> : null}
                  </div>
                  <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                  <div className="pratos3d__actions">
                    {p.model3dUrl ? <Button onClick={() => setViewing(p)}>Ver 3D</Button> : null}
                    {p.model3dUrl && !p.published && !p.widthMm ? (
                      <Button variant="primary" onClick={() => setViewing(p)}>Informar tamanho</Button>
                    ) : null}
                    {p.model3dUrl && !p.published && p.widthMm ? (
                      <Button variant="primary" busy={rowBusy} onClick={() => void act(p.id, () => dish3dApi.publish(p.id))}>Publicar no cardápio</Button>
                    ) : null}
                    {p.model3dUrl && p.published ? <Button busy={rowBusy} onClick={() => void act(p.id, () => dish3dApi.unpublish(p.id))}>Tirar do cardápio</Button> : null}
                    <Button
                      variant={p.model3dUrl ? "secondary" : "primary"}
                      disabled={!data.available || !enough || p.generating}
                      onClick={() => setGenerating(p)}
                    >
                      {p.model3dUrl ? "Gerar de novo" : "Gerar 3D"}
                    </Button>
                    {p.model3dUrl ? (
                      <Button
                        variant="quiet"
                        busy={rowBusy}
                        onClick={() => {
                          if (window.confirm(`Remover o 3D de "${p.name}"? Ele sai do cardápio.`)) void act(p.id, () => dish3dApi.remove(p.id));
                        }}
                      >
                        Remover
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      {generating && credits ? (
        <GenerateDialog
          product={generating}
          cost={credits.cost}
          onClose={() => setGenerating(null)}
          onDone={async () => {
            setGenerating(null);
            await reload();
          }}
        />
      ) : null}

      {viewing && viewing.model3dUrl ? (
        <div className="pratos3d__overlay" role="dialog" aria-modal="true" aria-label={`3D de ${viewing.name}`} onClick={() => setViewing(null)}>
          <div className="pratos3d__dialog" onClick={(e) => e.stopPropagation()}>
            <div className="pratos3d__dialog-head">
              <h2>{viewing.name}</h2>
              <Button variant="quiet" onClick={() => setViewing(null)}>Fechar</Button>
            </div>
            <Dish3dViewer key={viewing.model3dUrl} src={viewing.model3dUrl} alt={`Prato ${viewing.name} em 3D`} poster={viewing.imageUrl} ar={false} realWidthMm={viewing.widthMm} />
            <RealSizeForm
              product={viewing}
              onSaved={async (row) => {
                setViewing(row);
                await reload();
              }}
            />
            <p className="pratos3d__muted">{viewing.published ? "Este 3D está no cardápio." : "Rascunho: confira antes de publicar. Se não ficou bom, gere de novo com fotos melhores."}</p>
          </div>
        </div>
      ) : null}
    </main>
  );
}

// TAMANHO REAL: o cliente vê o prato pela câmera, em cima da mesa, do tamanho de verdade. A medida é a LARGURA (maior medida
// vista de cima); a altura acompanha a proporção do modelo. Sem a medida, o 3D não vai ao cardápio.
function RealSizeForm({ product, onSaved }: { product: Dish3dProductRow; onSaved: (row: Dish3dProductRow) => Promise<void> }) {
  const [value, setValue] = useState(product.widthMm ? String(product.widthMm / 10).replace(".", ",") : "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const cm = Number(value.replace(",", "."));
  const changed = value.trim() !== "" && Math.round(cm * 10) !== product.widthMm;

  async function save() {
    if (!Number.isFinite(cm) || cm < DISH3D_SIZE_MIN_CM || cm > DISH3D_SIZE_MAX_CM) return setError(`Informe de ${DISH3D_SIZE_MIN_CM} a ${DISH3D_SIZE_MAX_CM} cm.`);
    setSaving(true);
    setError(null);
    const result = await dish3dApi.setSize(product.id, cm);
    setSaving(false);
    if (!result.ok) return setError(result.error);
    const model = result.data.model;
    await onSaved({ ...product, model3dUrl: model?.url ?? product.model3dUrl, widthMm: model?.widthMm ?? null, heightMm: model?.heightMm ?? null });
  }

  return (
    <form className="pratos3d__size" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <label>
        Tamanho real do prato (cm)
        <input inputMode="decimal" value={value} onChange={(e) => { setValue(e.target.value); setError(null); }} placeholder="Ex.: 18" aria-describedby="pratos3d-size-help" disabled={saving} />
      </label>
      <Button type="submit" variant="primary" busy={saving} disabled={!changed}>Salvar tamanho</Button>
      <p id="pratos3d-size-help" className="pratos3d__muted">
        Meça a <strong>largura</strong> do prato servido (a maior medida, vista de cima). Na câmera, o cliente vê o prato exatamente desse tamanho em cima da mesa.
        {product.widthMm && product.heightMm ? ` Agora: ${formatRealSize(product.widthMm)} de largura e ${formatRealSize(product.heightMm)} de altura.` : ""}
      </p>
      {error ? <p className="pratos3d__error" role="alert">{error}</p> : null}
    </form>
  );
}

function GenerateDialog({ product, cost, onClose, onDone }: { product: Dish3dProductRow; cost: number; onClose: () => void; onDone: () => Promise<void> }) {
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

  function pick(list: FileList | null) {
    setError(null);
    const chosen = Array.from(list ?? []);
    if (chosen.length > DISH3D_MAX_PHOTOS) return setError(`Escolha no máximo ${DISH3D_MAX_PHOTOS} fotos.`);
    if (chosen.some((f) => f.size > DISH3D_MAX_PHOTO_BYTES)) return setError("Cada foto pode ter até 8 MB.");
    setFiles(chosen);
  }

  async function send() {
    if (files.length === 0) return setError("Escolha pelo menos 1 foto.");
    setSending(true);
    const result = await dish3dApi.generate(product.id, files);
    setSending(false);
    if (!result.ok) return setError(result.error);
    await onDone();
  }

  return (
    <div className="pratos3d__overlay" role="dialog" aria-modal="true" aria-label={`Gerar 3D de ${product.name}`}>
      <div className="pratos3d__dialog">
        <div className="pratos3d__dialog-head">
          <h2>Gerar 3D: {product.name}</h2>
          <Button variant="quiet" onClick={onClose} disabled={sending}>Fechar</Button>
        </div>
        <ul className="pratos3d__tips">
          <li>Use de 1 a 4 fotos do <strong>mesmo prato</strong>, de ângulos diferentes (frente, lado, de cima).</li>
          <li>Prato inteiro na foto, fundo liso, boa luz, sem mãos nem outros pratos.</li>
          <li>Leva de 2 a 5 minutos. Você pode sair desta tela.</li>
        </ul>
        <label className="pratos3d__file">
          Fotos do prato
          <input type="file" accept={ACCEPT} multiple onChange={(e) => pick(e.target.files)} disabled={sending} />
        </label>
        {previews.length ? (
          <div className="pratos3d__previews">
            {previews.map((url, i) => (
              <img key={url} src={url} alt={`Foto ${i + 1}`} />
            ))}
          </div>
        ) : null}
        {error ? <StateMessage tone="danger" title="Não foi possível enviar">{error}</StateMessage> : null}
        <div className="pratos3d__dialog-actions">
          <span className="pratos3d__muted">Custa {cost} créditos. Se falhar, os créditos voltam.</span>
          <Button variant="primary" busy={sending} disabled={files.length === 0} onClick={() => void send()}>Gerar 3D</Button>
        </div>
      </div>
    </div>
  );
}
