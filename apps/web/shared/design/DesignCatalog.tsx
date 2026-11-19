"use client";

import Link from "next/link";
import { useState } from "react";
import { Button, DataTable, Field, PageHeading, Pagination, Panel, StateMessage, StatusBadge } from "./components";
import { Tabs } from "./Tabs";
import { ThemeControls } from "./ThemeControls";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog";
import { MoneyInput } from "@/shared/ui/MoneyInput";
import { Switch } from "@/shared/ui/Switch";
import { VitryBrand } from "@/shared/ui/VitryBrand";
import "./catalog.css";

const sections = [
  { id: "fundacao", label: "Fundação" }, { id: "controles", label: "Controles" },
  { id: "operacao", label: "Operação" }, { id: "estados", label: "Estados" },
] as const;
const colors = [
  ["--panel-canvas", "Fundo"], ["--surface", "Superfície"], ["--line", "Borda"],
  ["--ink", "Texto"], ["--color-primary", "Ação"], ["--ok", "Sucesso"],
  ["--warn", "Atenção"], ["--danger", "Erro"], ["--info-ink", "Informação"],
];

export function DesignCatalog() {
  const [selected, setSelected] = useState<(typeof sections)[number]["id"]>("fundacao");
  const [dialog, setDialog] = useState(false);
  const [confirmation, setConfirmation] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [amount, setAmount] = useState("");
  const [page, setPage] = useState(1);
  return (
    <main className="ds-catalog">
      <header className="ds-catalog__nav">
        <Link href="/"><VitryBrand /></Link>
        <ThemeControls />
      </header>
      <PageHeading title="Design system VitryNow" description="Componentes, temas e estados usados no produto."
        actions={<Link href="/dev/campanha" className="ds-button ds-button--secondary">Prévia de campanhas</Link>} />
      <Tabs label="Design system" items={sections} selected={selected} onSelect={setSelected}>
        {selected === "fundacao" && (
          <div className="ds-catalog__columns">
            <Panel title="Cores semânticas">
              <ul className="ds-catalog__swatches">
                {colors.map(([token, name]) => <li key={token}>
                  <span aria-hidden="true" style={{ background: "var(" + token + ")" }} />
                  <strong>{name}</strong><code>{token}</code>
                </li>)}
              </ul>
            </Panel>
            <Panel title="Tipografia">
              <div className="ds-catalog__stack">
                <span className="ds-catalog__display">Visão geral</span>
                <strong>Pedidos em andamento</strong>
                <span>Acompanhe a fila e confirme a entrega.</span>
                <small>Atualizado às 12h45</small>
              </div>
            </Panel>
          </div>
        )}
        {selected === "controles" && (
          <div className="ds-catalog__columns">
            <Panel title="Formulários">
              <div className="ds-catalog__stack">
                <Field id="catalog-example-name" label="Nome da loja" hint="Nome exibido no cardápio.">
                  <input id="catalog-example-name" aria-describedby="catalog-example-name-hint" defaultValue="Cozinha da Praça" />
                </Field>
                <Field id="catalog-example-email" label="E-mail" error="Informe um e-mail válido.">
                  <input id="catalog-example-email" type="email" defaultValue="email" aria-invalid="true" aria-describedby="catalog-example-email-error" />
                </Field>
                <fieldset><legend>Valor</legend><MoneyInput name="valor" value={amount} onChange={setAmount} /></fieldset>
                <div className="ds-catalog__actions"><Switch checked={enabled} label="Receber pedidos" onChange={setEnabled} /><span>Receber pedidos</span></div>
              </div>
            </Panel>
            <Panel title="Ações e confirmação">
              <div className="ds-catalog__actions">
                <Button variant="primary" icon="check" onClick={() => setConfirmation(true)}>Salvar</Button>
                <Button variant="secondary" onClick={() => setConfirmation(false)}>Voltar</Button>
                <Button variant="danger" onClick={() => setDialog(true)}>Remover</Button>
                <Button busy>Enviando…</Button>
              </div>
              {confirmation && <StateMessage tone="success" title="Exemplo confirmado." />}
            </Panel>
          </div>
        )}
        {selected === "operacao" && (
          <Panel title="Lista de pedidos">
            <DataTable label="Pedidos de exemplo" headers={["Pedido", "Cliente", "Estado", "Total"]}>
              <tr><th scope="row">#{page === 1 ? "104" : "103"}</th><td>{page === 1 ? "Lia" : "Rui"}</td>
                <td><StatusBadge tone={page === 1 ? "warning" : "success"}>{page === 1 ? "Em preparo" : "Entregue"}</StatusBadge></td><td>R$ 52,80</td></tr>
            </DataTable>
            <Pagination page={page} totalPages={2} onPageChange={setPage} />
          </Panel>
        )}
        {selected === "estados" && (
          <div className="ds-catalog__stack">
            <StateMessage title="Carregando pedidos…" busy />
            <StateMessage title="Nenhum pedido em andamento" />
            <StateMessage tone="warning" title="Dados desatualizados">Confira a conexão e tente novamente.</StateMessage>
            <StateMessage tone="danger" title="Não foi possível carregar" action={<Button onClick={() => setSelected("operacao")}>Tentar novamente</Button>} />
            <StateMessage tone="success" title="Alterações salvas" />
          </div>
        )}
      </Tabs>
      <ConfirmDialog open={dialog} title="Remover item de exemplo?" message="Confirme a ação de teste." confirmLabel="Remover"
        tone="danger" onCancel={() => setDialog(false)} onConfirm={() => { setDialog(false); setConfirmation(true); }} />
    </main>
  );
}
