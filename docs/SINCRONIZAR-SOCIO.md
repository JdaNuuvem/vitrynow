# Como atualizar o seu repositório local (guia para o sócio)

Este guia leva o seu clone local do estado em que você nos entregou (base **`5a6d912`**, de 18/11) até a `main` atual do GitHub, sem perder trabalho seu e sem quebrar o que já está integrado. Se algo aqui contradisser o `CONTRIBUTING.md`, vale o `CONTRIBUTING.md`.

## 1. O que mudou desde a sua base

- **O seu front entrou inteiro** (PR #130, squash): `apps/web`, `docs/frontend`, `scripts/qa`, launcher, seed local, `/dev/*`. O `apps/web` é **seu**: a sua versão prevaleceu nas telas.
- **Contrato novo (API):** `optionSelections` como alias de `options`; `expectedUnitPriceCents` só gera 409 `ITEM_PRICE_CHANGED`; tetos de seleção (30 por item, 200 por pedido); `unavailableByOptions` e `fromPriceCents` no cardápio público; caixa com `sessionId`/`expectedBalanceCents`; avisos da plataforma; status de privacidade.
- **Campanha do cardápio** (`/api/store/menu-campaign`, `store.campaign` no DTO público): pronta na API; a flag `NEXT_PUBLIC_MENU_CAMPAIGN_ENABLED` continua **desligada** e só liga em DEV.
- **Produto detalhado** (promoção de/por, venda por peso, adicional que não vende sozinho, prato único): **inerte por padrão**; a tela que liga promoção ou peso **só entra depois de um teste de paridade do preço** entre o seu `unitPriceWithChoices` e a API (vamos combinar o PR).
- **Banco:** FKs compostas por loja (o banco recusa referência entre lojas); **60 migrações**.
- **Fotos em disco local** (`STORAGE_DRIVER=local`), servidas pelo Caddy em `/media`.
- **Infra/CI:** o CI do GitHub roda API e web; guarda de fonte única (`ssot-guard`) que falha se surgir cópia nova de fuso, status ou moeda.
- **Em andamento (fila da fonte única):** horário com uma só fonte (`Store.schedule`), fuso por `Store.timezone`, frete/total só no servidor. Os PRs de **tela** dessa fila saem como **proposta para você aprovar**.

## 2. Antes de começar

1. Faça commit ou guarde o que você tem localmente: `git status`. Se houver mudança sem commit: `git switch -c meu-trabalho-antes-de-sincronizar` e `git add -A && git commit -m "wip"`.
2. Confirme o remoto: `git remote -v` deve mostrar `https://github.com/JdaNuuvem/vitrynow.git` como `origin`.

## 3. Atualizando o clone

**Caso A: você não tem alterações próprias além da entrega que já integramos:**
```powershell
git fetch origin
git switch main
git reset --hard origin/main        # descarta qualquer diferença local; só use se não houver trabalho a salvar
```
**Caso B: você tem trabalho novo (recomendado):**
```powershell
git fetch origin
git switch -c feat/minha-tarefa origin/main      # branch nova a partir da main atual
# traga o seu trabalho (cherry-pick dos commits ou copie os arquivos de apps/web) e abra um PR
```
**Caso C: você quer manter a sua branch e trazer a `main`:**
```powershell
git switch minha-branch
git merge origin/main                # sem rebase e sem force-push
```
Regra para resolver conflitos: **`apps/web` e `docs/frontend`: a sua versão** (confira com o time se mexeu em `apps/web/Dockerfile`: prevalece a da `main`). **API, `packages/*`, `infra`, `scripts`, migrações e testes: a versão da `main`.** Nunca edite uma migração que já está na `main`: crie uma nova.

## 4. Subindo o ambiente

```powershell
pnpm install --frozen-lockfile        # preserve o pnpm-lock.yaml; nunca apague
pnpm db:generate
pnpm db:migrate:deploy                # aplica as 60 migrações
pnpm db:seed                          # loja-teste (ou use o launcher: seed local com a loja Ramenku)
pnpm dev:api                          # http://localhost:3001
pnpm dev:web                          # http://localhost:3000
```
Ou execute `Abrir-VitryNow.cmd` (Windows, Docker Desktop com containers Linux): sobe tudo e carrega a loja **Ramenku**. Em http local ponha `COOKIE_SECURE="false"` no `apps/api/.env`. Gere os segredos locais com `pnpm --filter @meucardapio/api gen:secrets` (nunca commite o `.env`).

Verificação: `pnpm --filter @meucardapio/web typecheck`, `lint`, `test` e `build`. Os testes da API exigem um banco `*_test` em 127.0.0.1, portas 55440–55459, e `TEST_DATABASE_URL`.

## 5. O contrato entre o seu front e a API (resumo)

1. **Preço só no servidor.** O seu front pode calcular para mostrar, e envia `expectedUnitPriceCents`; se diferir do servidor, a API responde 409 `ITEM_PRICE_CHANGED` sem gravar. **`unitPriceCents` do item = base (ou promocional) + opções que somam**; adicional legado soma por cima; por peso, `quantity = 1` e `unitPriceCents` = valor da linha. Não some opções de novo na tela (era o dobro do `detailItemTotal`, já corrigido).
2. **Códigos de erro estáveis:** trate pelo `code` (ex.: `OPTION_NOT_FOUND`, `ITEM_PRICE_CHANGED`, `STORE_CLOSED`, `CASH_SESSION_CHANGED`); o texto da API pode mudar.
3. **Horário (em andamento, PR #148):** a API passa a devolver `openNow`, `nextOpensAt` e `hoursText` (gerados de `Store.schedule`). **O selo "Aberto" = `openNow && accepting`**, nunca só o texto livre; com grade, o campo de texto livre vira somente leitura e a API ignora a escrita dele (resposta 200 com aviso `OPENING_HOURS_DERIVED`).
4. **Fuso:** use o fuso da **loja** (`store.timezone`), não o do navegador nem `America/Sao_Paulo` fixo.
5. **Papéis e status:** hoje são redeclarados no web; vão para `packages/shared-types` (proposta de PR).
6. **Tempo real:** WebSocket por audiência (painel x impressora).
7. **Fotos:** a URL pública vem como `/media/stores/<loja>/<uuid>-<largura>.webp`; não monte URL de foto no front.

## 6. Como trabalhar (fluxo de PR)

1. Branch curta a partir da `main` com prefixo `feat/`, `fix/`, `docs/`, `chore/` ou `test/`.
2. **Contrato primeiro, tela depois**, em PRs separados sempre que possível. **Uma migração por PR**, aditiva.
3. Abra o PR contra `main` com o modelo do repositório (descrição, como testar, riscos). O **CI precisa estar verde**; mudanças de API, banco, pagamento ou segurança precisam de revisão do backend; telas, de você.
4. Mescle por **squash** ou **merge commit** com mensagem clara e apague a branch.
5. O `ssot-guard` falha se você escrever à mão `America/Sao_Paulo`, listas de status ou formatadores de moeda fora dos lugares permitidos: use a fonte.

## 7. O que NÃO fazer

- Push direto na `main`, `--force`, `reset --hard` em branch compartilhada, ou rebase de branch que outra pessoa usa.
- Commitar `.env`, chaves, tokens, dumps, backups ou caminhos locais. **O repositório é público.**
- Editar uma migração já mesclada; apagar o `pnpm-lock.yaml`.
- Calcular preço, frete, desconto ou "aberto agora" no navegador como se fosse a regra: a regra é do servidor.
- Duplicar regra ou constante que já existe em `packages/shared-types` (veja `docs/SSOT.md`).
- Mexer em `apps/print-client` ou em `infra` sem avisar o backend.
- Ligar `NEXT_PUBLIC_MENU_CAMPAIGN_ENABLED` em build de produção. Nada vai para produção sem aprovação do Claudio.

## 8. O que depende de você (propostas para aprovar)

- Menu do painel em 6 grupos por tarefa e as propostas de design **P-01 a P-12** (`docs/SSOT.md` e documentos do programa de desenho): são **propostas**; nada muda no seu front até você aprovar.
- PRs de tela da fila da fonte única: horário (`openNow`/`hoursText`, remover `isStoreOpenNow` sem uso), fuso da loja, frete/total.
- Editor da grade de horário (PR-02b), com desenho da Da Vinci.

## 9. Em caso de dúvida

Abra uma issue ou um PR em rascunho descrevendo a dúvida; para regra de negócio, pergunte antes de implementar. Documentos: `docs/ARQUITETURA.md`, `docs/SSOT.md`, `docs/adr/`, `docs/frontend/DESIGN-SYSTEM.md`.
