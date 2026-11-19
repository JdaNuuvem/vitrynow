# Campanha principal do cardápio

O editor está implementado em `apps/web/features/conta/campanha` e usa o mesmo componente de banner do cardápio. Teste em `/dev/campanha` com o servidor web em modo desenvolvimento. Salvar, publicar e retirar nessa rota alteram um exemplo local em memória. A rota autenticada `/dashboard/conta/campanha` e o atalho em Minha loja dependem da variável `NEXT_PUBLIC_MENU_CAMPAIGN_ENABLED=1` no build web. Habilite após concluir o contrato abaixo.

## Endpoints do CRM

Use a sessão atual do painel, com escopo do `storeId` da identidade autenticada e acesso de proprietário (`OWNER`). Aplique o controle de escrita do plano nas mutações e a auditoria usada pelas outras rotas do painel. Todos os sucessos abaixo devolvem HTTP 200 com o estado completo.

| Método e rota | Corpo | Resultado |
| --- | --- | --- |
| `GET /api/store/menu-campaign` | — | Estado atual da loja |
| `PUT /api/store/menu-campaign` | `{ revision, draft }` | Salva ou substitui o rascunho |
| `POST /api/store/menu-campaign/publish` | `{ revision }` | Publica uma cópia do rascunho salvo |
| `POST /api/store/menu-campaign/unpublish` | `{ revision }` | Retira a versão pública e mantém o rascunho |

```ts
type CampaignContent = {
  title: string;
  description: string;
  imageUrl: string;
  imageLayout: "photo" | "cutout";
  imagePosition: "center" | "center top" | "center bottom" | "left center" | "right center";
  action: { label: string; target: { kind: "category" | "product"; id: string } } | null;
};

type PublishedCampaign = Omit<CampaignContent, "action"> & {
  id: string;
  action?: NonNullable<CampaignContent["action"]>;
};

type CampaignState = {
  revision: number;
  draft: CampaignContent | null;
  published: PublishedCampaign | null;
};
```

- Para uma loja sem campanha, devolva `{ "revision": 0, "draft": null, "published": null }`. A revisão é um inteiro não negativo. Atualize a campanha e incremente a revisão na mesma transação, aplicando condição para a revisão esperada. Em conflito devolva HTTP 409 com `{ "code": "CAMPAIGN_CHANGED", "error": "A campanha mudou. Recarregue os dados antes de salvar." }`.
- Remova espaços das pontas do título, descrição, URL e rótulo. Aplique os limites de 80 caracteres no título, 250 na descrição, 500 no endereço e 35 no rótulo. O rascunho pode conter texto vazio. Na publicação, exija título e, se houver ação, um rótulo preenchido e um destino visível e pertencente à loja. A área pública omite o botão caso o destino seja removido posteriormente.
- A imagem é opcional. Aceite URL HTTPS sem usuário e senha e endereço gerenciado cujo ativo pertence à loja. O editor já envia JPEG, PNG e WebP de até 8 MB ao endpoint multipart `POST /api/media/images?kind=COVER`. Preserve as referências do rascunho e da publicação durante a limpeza de mídia. URLs `blob:` pertencem exclusivamente à demonstração.
- Use os envelopes HTTP existentes do painel, com `{ error, code? }` em falhas. Cubra 400 para conteúdo inválido, 401 sem sessão, 403 para papel sem acesso e o controle de assinatura existente. Publicar sem rascunho retorna 400.

## Cardápio público

Inclua `store.campaign` no retorno de menu de cada loja, com o DTO publicado ou `null`. A ausência do campo mantém compatibilidade com versões anteriores da API. Use um ID estável de campanha por loja e publique somente a cópia validada. Integre `POST /api/store/menu-campaign/publish` e `/unpublish` ao mecanismo de revalidação do cardápio da API, em `apps/api/src/plugins/menuRevalidation.ts`.

Antes de habilitar a variável, verifique com duas lojas se salvar um rascunho preserva a campanha atual, publicar atualiza o cardápio após revalidação, retirar libera o espaço do banner, um destino excluído remove o botão, e revisões concorrentes e acessos sem permissão recebem erro.
