"use client";

import { useCallback, useRef, useState, type FormEvent } from "react";
import { Button, Panel, StatusBadge } from "@/shared/design/components";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog";
import { validateImageUrl } from "@/shared/format/imageUrl";
import { Modal } from "@/shared/ui/Modal";
import { platformApi, type PlatformNotice } from "./platformApi";
import { usePlatform } from "./PlatformShell";
import { platformDate, PlatformHeading, PlatformPagination, PlatformState } from "./PlatformUi";
import { usePlatformResource } from "./usePlatformResource";

function PublishNotice({ onDone, onClose }: { onDone: () => void; onClose: () => void }) {
  const { request } = usePlatform();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const running = useRef(false);
  const close = () => { if (!running.current) onClose(); };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (running.current || uncertain) return;
    const fields = new FormData(event.currentTarget);
    const read = (key: string) => String(fields.get(key) ?? "").trim();
    const [title, body, imageUrl, expires] = [read("title"), read("body"), read("imageUrl"), read("expiresAt")];
    const errorMessage = validateImageUrl(imageUrl);
    if (errorMessage) return setError(errorMessage);
    if (!title || !body) return setError("Informe o título e a mensagem do aviso.");
    const expiry = expires ? new Date(expires) : null;
    if (expiry && (!Number.isFinite(expiry.getTime()) || expiry.getTime() <= Date.now())) return setError("Informe uma data de expiração futura.");
    running.current = true;
    setBusy(true);
    setError(null);
    const result = await request(() => platformApi.publishNotice({ title, body, imageUrl: imageUrl || undefined, expiresAt: expiry?.toISOString() }));
    setBusy(false);
    running.current = false;
    if (result.ok) onDone();
    else if (result.status >= 500) {
      setUncertain(true);
      setError("A publicação ainda não foi confirmada. Confira a lista de avisos antes de publicar de novo.");
    } else setError(result.error);
  }

  return <Modal open onClose={close} labelledBy="platform-publish-notice-title" width={560} closeOnScrim={false}>
    <form className="platform-dialog platform-form" onSubmit={submit}>
      <header><h2 id="platform-publish-notice-title">Publicar aviso</h2><p>O aviso aparece no painel dos lojistas.</p></header>
      <label className="platform-field">Título<input name="title" required maxLength={150} disabled={busy || uncertain} /></label>
      <label className="platform-field">Mensagem<textarea name="body" required maxLength={2000} rows={5} disabled={busy || uncertain} /></label>
      <label className="platform-field">Endereço da imagem opcional<input type="url" name="imageUrl" maxLength={500} placeholder="https://" disabled={busy || uncertain} /></label>
      <label className="platform-field">Quando expira, opcional<input type="datetime-local" name="expiresAt" disabled={busy || uncertain} /></label>
      {error && <p className="platform-message platform-message--error" role="alert">{error}</p>}
      <div className="platform-actions">
        <Button type="button" onClick={close} disabled={busy}>{uncertain ? "Voltar para os avisos" : "Cancelar"}</Button>
        {!uncertain && <Button variant="primary" type="submit" busy={busy}>Publicar aviso</Button>}
      </div>
    </form>
  </Modal>;
}

export function PlatformNotices() {
  const { request } = usePlatform();
  const [page, setPage] = useState(1);
  const [publish, setPublish] = useState(false);
  const [deletion, setDeletion] = useState<PlatformNotice | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState("");
  const deletingRef = useRef(false);
  const load = useCallback(() => platformApi.notices(page), [page]);
  const { data, error, loading, reload } = usePlatformResource(load);

  async function remove() {
    if (!deletion || deletingRef.current) return;
    deletingRef.current = true;
    setDeleting(true);
    setDeleteError(null);
    const result = await request(() => platformApi.deleteNotice(deletion.id));
    deletingRef.current = false;
    setDeleting(false);
    if (result.ok || result.status === 404) {
      setMessage(result.ok ? "Aviso retirado." : "O aviso já foi retirado.");
      setDeletion(null);
      if (page > 1 && data?.notices.length === 1) setPage(page - 1);
      else reload();
    } else setDeleteError(result.error);
  }

  return <>
    <PlatformHeading title="Avisos" description="Gerencie as mensagens exibidas na ajuda do painel dos lojistas."
      action={<Button variant="primary" onClick={() => { setMessage(""); setPublish(true); }}>Novo aviso</Button>} />
    {message && <p className="platform-message platform-message--ok" role="status">{message}</p>}
    <Panel title="Avisos da plataforma">
      {loading || error ? <PlatformState loading={loading} error={error} retry={reload} /> : data && <>
        {!data.notices.length ? <PlatformState>Nenhum aviso nesta página.</PlatformState> : <ul className="platform-notices">
          {data.notices.map((notice) => {
            const expired = Boolean(notice.expiresAt && Date.parse(notice.expiresAt) <= Date.now());
            return <li key={notice.id}>
              <div className="platform-notice-heading"><h3>{notice.title}</h3><StatusBadge tone={expired ? "neutral" : "success"}>{expired ? "Expirado" : "Publicado"}</StatusBadge></div>
              <p className="platform-notice-body">{notice.body}</p>
              <p className="platform-muted">Publicado em {platformDate(notice.publishedAt)}{notice.expiresAt && ` · Expiração em ${platformDate(notice.expiresAt)}`}</p>
              {notice.imageUrl && <p className="platform-muted">Inclui imagem</p>}
              <Button variant="quiet" onClick={() => { setDeleteError(null); setMessage(""); setDeletion(notice); }}>Retirar aviso<span className="sr-only"> {notice.title}</span></Button>
            </li>;
          })}
        </ul>}
        <PlatformPagination {...data} onChange={setPage} />
      </>}
    </Panel>
    {publish && <PublishNotice onClose={() => { setPublish(false); reload(); }} onDone={() => {
      setPublish(false); setMessage("Aviso publicado.");
      if (page !== 1) setPage(1);
      else reload();
    }} />}
    {deletion && <ConfirmDialog open title="Retirar aviso" message={`O aviso “${deletion.title}” deixará de aparecer para os lojistas.`}
      confirmLabel="Retirar aviso" tone="danger" busy={deleting} error={deleteError}
      onCancel={() => { if (!deletingRef.current) setDeletion(null); }} onConfirm={() => void remove()} />}
  </>;
}
