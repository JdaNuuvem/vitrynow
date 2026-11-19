"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { Button, DataTable } from "@/shared/design/components";
import { platformApi, type Availability } from "./platformApi";
import { platformDate, PlatformHeading, PlatformPagination, PlatformState, StoreStatus } from "./PlatformUi";
import { usePlatformResource } from "./usePlatformResource";

export function PlatformStores() {
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [availability, setAvailability] = useState<Availability>("");
  const [page, setPage] = useState(1);
  const load = useCallback(() => platformApi.stores(query, availability, page), [query, availability, page]);
  const { data, error, loading, reload } = usePlatformResource(load);

  return <>
    <PlatformHeading title="Lojas" description="Consulte lojas, assinaturas e serviços conectados." />
    <section className="platform-panel platform-records" aria-label="Lojas cadastradas">
      <form className="platform-filter" onSubmit={(event) => {
        event.preventDefault();
        const next = draft.trim();
        if (next === query && page === 1) reload();
        setQuery(next);
        setPage(1);
      }}>
        <label className="platform-field">Buscar lojas<input type="search" value={draft} maxLength={100} placeholder="Nome, slug ou e-mail do dono"
          onChange={(event) => setDraft(event.target.value)} /></label>
        <label className="platform-field">Situação na plataforma<select value={availability} onChange={(event) => {
          setAvailability(event.target.value as Availability);
          setPage(1);
        }}>
          <option value="">Todas</option><option value="available">Sem suspensão manual</option><option value="suspended">Suspensas pela plataforma</option>
        </select></label>
        <Button variant="primary" type="submit">Buscar</Button>
        {(query || availability) && <Button type="button" onClick={() => {
          setQuery(""); setDraft(""); setAvailability(""); setPage(1);
        }}>Limpar</Button>}
      </form>
      {loading || error ? <PlatformState loading={loading} error={error} retry={reload} /> : data && <>
        <p className="platform-results" role="status">{data.total} {data.total === 1 ? "loja encontrada" : "lojas encontradas"}</p>
        {data.stores.length === 0 ? <PlatformState>{query || availability ? "Nenhuma loja corresponde aos filtros." : "Nenhuma loja nesta página."}</PlatformState>
          : <DataTable label="Tabela de lojas" headers={["Loja", "Situação e plano", "Integrações", "Último pedido"]}>
              {data.stores.map((store) => <tr key={store.id}>
                <th scope="row"><Link href={`/plataforma/lojas/${encodeURIComponent(store.id)}`}>{store.name}</Link><small>{store.slug}</small>
                  {store.ownerEmail && <small>{store.ownerEmail}</small>}</th>
                <td><StoreStatus suspended={store.suspended} subscription={store.subscription} />{store.subscription?.planName && <small>{store.subscription.planName}</small>}</td>
                <td><small>{store.paymentConnected ? "Pagamento conectado" : "Pagamento desconectado"}</small>
                  <small>{store.printerOnline ? "Impressora online" : "Impressora offline"}</small></td>
                <td>{platformDate(store.lastOrderAt)}</td>
              </tr>)}
          </DataTable>}
        <PlatformPagination {...data} onChange={setPage} />
      </>}
    </section>
  </>;
}
