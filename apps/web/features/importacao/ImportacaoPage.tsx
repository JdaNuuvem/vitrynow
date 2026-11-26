"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { IMPORT_MAX_BYTES, IMPORT_MAX_ROWS, IMPORT_COLUMNS, errorMessages, type ImportPreview } from "@meucardapio/shared-types";
import { useCurrentRole } from "@/core/session/useCurrentRole";
import { Button, PageHeading, Panel, StateMessage, StatusBadge } from "@/shared/design/components";
import { formatCents } from "@/shared/format/money";
import { detectFormat, importApi, ISSUE_LABEL, type ImportFormat, type ImportGuide, type ImportResult } from "./importApi";
import "./importacao.css";

// IMPORTAÇÃO DE PRODUTOS (tela nova, API IMP-1): modelo/instruções → enviar ou colar → prévia → publicar.
// Nada é gravado até "Publicar": a prévia só valida. Produto que já existe nunca é sobrescrito.
type Step = "send" | "preview" | "done";
const WARNING_TEXT = (code: string) => (errorMessages as Record<string, { message: string } | undefined>)[code]?.message ?? code;
const STATUS_TONE = { OK: "success", REVIEW: "warning", IGNORED: "neutral" } as const;
const STATUS_LABEL = { OK: "OK", REVIEW: "Revisar", IGNORED: "Ignorada" } as const;

export function ImportacaoPage() {
  const owner = useCurrentRole() === "OWNER";
  const [step, setStep] = useState<Step>("send");
  const [guide, setGuide] = useState<ImportGuide | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  const [copied, setCopied] = useState(false);
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [format, setFormat] = useState<ImportFormat | "auto">("auto");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [filter, setFilter] = useState<"ALL" | "REVIEW">("ALL");
  const [duplicates, setDuplicates] = useState<"skip" | "create">("skip");
  const [skipInvalid, setSkipInvalid] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (owner) void importApi.guide().then((r) => r.ok && setGuide(r.data));
  }, [owner]);

  const rows = useMemo(() => (preview?.rows ?? []).filter((r) => filter === "ALL" || r.status !== "OK"), [preview, filter]);
  const alreadyExisting = (preview?.rows ?? []).filter((r) => r.issues.includes("ALREADY_EXISTS")).length;

  async function readFile(file: File) {
    setError(null);
    if (file.size > IMPORT_MAX_BYTES) return setError("O arquivo passa de 2 MB. Divida a planilha em partes menores.");
    setFileName(file.name);
    setText(await file.text());
  }

  async function sendPreview() {
    if (!text.trim()) return setError("Escolha um arquivo ou cole o conteúdo.");
    setBusy(true);
    setError(null);
    const r = await importApi.preview(format === "auto" ? detectFormat(fileName, text) : format, text);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setPreview(r.data);
    setSkipInvalid(false);
    setFilter(r.data.totals.review > 0 ? "REVIEW" : "ALL");
    setStep("preview");
  }

  async function publish() {
    if (!preview) return;
    setBusy(true);
    setError(null);
    const r = await importApi.confirm(preview.batchId, { contentHash: preview.contentHash, duplicates, skipInvalid });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setResult(r.data);
    setStep("done");
  }

  async function discard() {
    if (preview) await importApi.discard(preview.batchId);
    reset();
  }

  function reset() {
    setPreview(null);
    setResult(null);
    setText("");
    setFileName(null);
    setError(null);
    setStep("send");
  }

  if (!owner) {
    return (
      <main className="importacao">
        <PageHeading title="Importar produtos" />
        <StateMessage tone="warning" title="Só o dono da loja importa produtos" />
      </main>
    );
  }

  return (
    <main className="importacao">
      <PageHeading
        title="Importar produtos"
        description={`Cadastre vários produtos de uma vez com uma planilha (até ${IMPORT_MAX_ROWS} linhas). Você confere tudo numa prévia antes de publicar; nada que já existe é alterado.`}
        actions={<Link className="ds-button ds-button--secondary" href="/dashboard/catalogo">Voltar aos produtos</Link>}
      />
      <ol className="importacao__steps" aria-label="Etapas">
        <li aria-current={step === "send" ? "step" : undefined}>1. Enviar</li>
        <li aria-current={step === "preview" ? "step" : undefined}>2. Conferir</li>
        <li aria-current={step === "done" ? "step" : undefined}>3. Pronto</li>
      </ol>
      {error ? <StateMessage tone="danger" title="Não foi possível continuar">{error}</StateMessage> : null}

      {step === "send" ? (
        <>
          <Panel title="Como montar a planilha">
            <p className="importacao__muted">Colunas (a primeira linha do CSV tem os nomes):</p>
            <ul className="importacao__cols">
              {IMPORT_COLUMNS.map((c) => (
                <li key={c.key}><code>{c.key}</code>{c.required ? " (obrigatória)" : " (opcional)"}: {c.help} <span className="importacao__muted">Ex.: {c.example}</span></li>
              ))}
            </ul>
            <div className="importacao__row">
              <Button onClick={() => void importApi.downloadTemplate("csv").then((e) => e && setError(e))}>Baixar modelo CSV (Excel)</Button>
              <Button onClick={() => void importApi.downloadTemplate("json").then((e) => e && setError(e))}>Baixar modelo JSON</Button>
              {guide ? <Button variant="quiet" onClick={() => setShowGuide((s) => !s)}>{showGuide ? "Esconder" : "Tenho só a foto do cardápio"}</Button> : null}
            </div>
            {showGuide && guide ? (
              <div className="importacao__guide">
                <p>Copie o texto abaixo e cole numa IA (ChatGPT, Gemini, Claude…) junto com a foto do seu cardápio. Ela devolve um JSON: cole aqui embaixo.</p>
                <p className="importacao__warn">{guide.notice}</p>
                <textarea readOnly value={guide.text} rows={8} aria-label="Instruções para a IA" />
                <Button onClick={() => void navigator.clipboard.writeText(guide.text).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 2000); })}>
                  {copied ? "Copiado!" : "Copiar instruções"}
                </Button>
              </div>
            ) : null}
          </Panel>

          <Panel title="Enviar">
            <label className="importacao__field">Arquivo CSV ou JSON (até 2 MB)
              <input type="file" accept=".csv,.json,text/csv,application/json,text/plain" onChange={(e) => { const f = e.target.files?.[0]; if (f) void readFile(f); }} />
            </label>
            <label className="importacao__field">…ou cole o conteúdo aqui
              <textarea rows={10} value={text} onChange={(e) => { setText(e.target.value); setFileName(null); }} placeholder={"categoria,nome,descricao,preco\nPizzas,Pizza Margherita,Molho e muçarela,42.50"} spellCheck={false} />
            </label>
            <div className="importacao__row">
              <label className="importacao__inline">Formato
                <select value={format} onChange={(e) => setFormat(e.target.value as ImportFormat | "auto")}>
                  <option value="auto">Detectar</option>
                  <option value="csv">CSV</option>
                  <option value="json">JSON</option>
                </select>
              </label>
              {fileName ? <span className="importacao__muted">Arquivo: {fileName}</span> : null}
              <Button variant="primary" busy={busy} disabled={!text.trim()} onClick={() => void sendPreview()}>Ver prévia</Button>
            </div>
          </Panel>
        </>
      ) : null}

      {step === "preview" && preview ? (
        <Panel title="Prévia">
          <div className="importacao__totals">
            <StatusBadge tone="success">{preview.totals.ok} prontas</StatusBadge>
            {preview.totals.review ? <StatusBadge tone="warning">{preview.totals.review} para revisar</StatusBadge> : null}
            {preview.totals.ignored ? <StatusBadge>{preview.totals.ignored} ignoradas</StatusBadge> : null}
            {preview.totals.newCategories ? <StatusBadge tone="info">{preview.totals.newCategories} categoria(s) nova(s)</StatusBadge> : null}
          </div>
          {preview.warnings.length ? (
            <ul className="importacao__warnings">
              {preview.warnings.map((w, i) => (
                <li key={i}>{w.line ? `Linha ${w.line}: ` : ""}{WARNING_TEXT(w.code)}{w.field ? ` (${w.field})` : ""}</li>
              ))}
            </ul>
          ) : null}

          <div className="importacao__row">
            <label className="importacao__inline">Mostrar
              <select value={filter} onChange={(e) => setFilter(e.target.value as "ALL" | "REVIEW")}>
                <option value="ALL">Todas as linhas</option>
                <option value="REVIEW">Só as com problema</option>
              </select>
            </label>
          </div>
          <div className="importacao__table-wrap">
            <table className="importacao__table">
              <thead>
                <tr><th>Linha</th><th>Situação</th><th>Categoria</th><th>Produto</th><th>Preço</th><th>Problemas</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.line} data-status={r.status}>
                    <td>{r.line}</td>
                    <td><StatusBadge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</StatusBadge></td>
                    <td>{r.category || "—"}{r.category && !r.existingCategory ? <span className="importacao__new"> nova</span> : null}</td>
                    <td><strong>{r.name || "—"}</strong>{r.description ? <div className="importacao__muted">{r.description}</div> : null}</td>
                    <td>{r.priceCents !== null ? formatCents(r.priceCents) : "—"}</td>
                    <td>{r.issues.map((i) => ISSUE_LABEL[i] ?? i).join(" · ") || "—"}</td>
                  </tr>
                ))}
                {rows.length === 0 ? <tr><td colSpan={6} className="importacao__muted">Nenhuma linha com problema.</td></tr> : null}
              </tbody>
            </table>
          </div>

          <fieldset className="importacao__options">
            <legend>Ao publicar</legend>
            {alreadyExisting ? (
              <label className="importacao__check">
                <input type="checkbox" checked={duplicates === "create"} onChange={(e) => setDuplicates(e.target.checked ? "create" : "skip")} />
                Criar também os {alreadyExisting} que já existem com o mesmo nome (fica duplicado). Sem marcar, eles são pulados.
              </label>
            ) : null}
            {preview.totals.review ? (
              <label className="importacao__check">
                <input type="checkbox" checked={skipInvalid} onChange={(e) => setSkipInvalid(e.target.checked)} />
                Publicar só as {preview.totals.ok} prontas e deixar de fora as {preview.totals.review} para revisar.
              </label>
            ) : null}
          </fieldset>
          <div className="importacao__row importacao__row--end">
            <Button variant="quiet" disabled={busy} onClick={() => void discard()}>Descartar e enviar outro</Button>
            <Button variant="primary" busy={busy} disabled={preview.totals.ok === 0 || (preview.totals.review > 0 && !skipInvalid)} onClick={() => void publish()}>
              Publicar {preview.totals.ok} produto(s)
            </Button>
          </div>
          {preview.totals.review > 0 && !skipInvalid ? <p className="importacao__muted">Corrija a planilha e envie de novo, ou marque “publicar só as prontas”.</p> : null}
        </Panel>
      ) : null}

      {step === "done" && result ? (
        <Panel title="Pronto">
          <StateMessage tone="success" title={`${result.createdProducts} produto(s) publicado(s)`}>
            {result.createdCategories ? `${result.createdCategories} categoria(s) nova(s). ` : ""}
            {result.skippedExisting ? `${result.skippedExisting} já existiam e foram pulados. ` : ""}
            {result.ignoredRows ? `${result.ignoredRows} linha(s) ficaram de fora.` : ""}
          </StateMessage>
          <div className="importacao__row">
            <Link className="ds-button ds-button--primary" href="/dashboard/catalogo">Ver produtos</Link>
            <Button onClick={reset}>Importar outra planilha</Button>
          </div>
          <p className="importacao__muted">Dica: os produtos entram sem foto. Adicione as fotos em Produtos.</p>
        </Panel>
      ) : null}
    </main>
  );
}
