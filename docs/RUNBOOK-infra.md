# Runbook de infraestrutura (INF-11, versão inicial) · DEV e staging local

Só DEV/staging local. **Nada aqui foi aplicado em produção** e produção exige aprovação explícita do Claudio.
Cada procedimento diz se foi **provado por execução** (com o arquivo que prova) ou está **pendente**. Onde não provei, não afirmo.

## 1. A stack em uma frase
Só o **Caddy** publica portas (80/443). `web` e `api` ficam na rede de borda; o `postgres` (e `migrate`, `postgres-backup`) ficam na rede `data`, **interna** (sem saída à internet, e o Caddy e o web não a enxergam). O Caddy tem IP fixo (`CADDY_IP`), e a API só confia no `X-Forwarded-For` desse IP (`TRUST_PROXY_CIDR` é derivado, não se define). Prova: `scripts/smoke-stack.sh`.

## 2. Antes de subir (sempre)
1. `cp infra/.env.example infra/.env` e preencha. Gere segredos com `openssl rand -hex 32` (Postgres: `openssl rand -hex 24`, **só** `[A-Za-z0-9_-]`; base64 quebra a `DATABASE_URL`). Cada segredo é **diferente**.
2. `infra/check-env.sh infra/.env`: recusa segredo curto/igual/de exemplo, URL sem https, `COOKIE_SECURE=false`, `TRUST_PROXY_CIDR` definido, PIX incompleto. Nunca imprime valores. **Provado:** `scripts/test-check-env.sh` (27 casos, sem Docker).
3. Só então `docker compose --env-file infra/.env -f infra/docker-compose.yml up -d --build`. O compose também recusa `.env` sem `JWT_SECRET`, `MFA_HMAC_KEY`, `API_INTERNAL_SECRET`, `POSTGRES_PASSWORD`, `WEB_ORIGIN` (**provado** no smoke, seção 8).

## 3. Atualizar e voltar (rollback)
- A imagem leva `APP_VERSION` (use o hash curto do commit). O serviço `migrate` aplica as migrações **antes** da API subir (`service_completed_successfully`): se falhar, a API antiga continua no ar. **Provado:** smoke (migrate exit 0, N/N migrações).
- Voltar: suba de novo com a `APP_VERSION` anterior (as imagens ficam no disco). **O banco NÃO volta junto**: migração aplicada fica aplicada. Por isso migração destrutiva é separada em expand → migrar dados → contract em release posterior (regra do Atlas) e há backup verificado antes.
- Carimbo de migração: único e crescente; `scripts/check-migrations.sh` reprova repetido/decrescente. **Provado** (`scripts/test-stamps.sh`; caso real da API-12).

## 4. Uma migração falhou (Prisma P3009)
Sintoma: o `migrate` sai com erro e novos deploys dizem *"found failed migrations"*. A migração roda numa transação: **nada fica pela metade**.
1. Leia a mensagem. Ex. real (SEC-20): `E-mails duplicados ao normalizar (resolva manualmente antes; nada foi alterado): fulano@x (2 contas)`.
2. Corrija o **dado** (decisão do produto; a migração nunca apaga nada).
3. Marque a migração como não aplicada: `prisma migrate resolve --rolled-back <nome-da-migração>`.
4. Rode o deploy de novo. **Provado** com o Prisma direto num banco descartável (`scripts/check-migrations.sh`, cenário S7, `INF-07-sec20-email-lower.log`). **Não executei** o mesmo comando por `docker compose run --rm migrate …`.

## 5. Backup e restauração
- O serviço `postgres-backup` roda `scripts/backup/backup.sh` a cada 24 h: **recusa banco sem tabelas** (o B05), confere o dump, grava `.sha256`, só então aplica retenção; modo 700/600. Backup manual: `docker compose exec postgres-backup /bin/sh /scripts/backup.sh`.
- Provar a restauração: `scripts/backup/restore-verify.sh <dump>` restaura num banco **novo** e confere sha256, migrações e contagem linha a linha. **Provado:** `scripts/test-backup-restore.sh` (10 verificações; a suíte inteira da API roda verde sobre o banco restaurado: 251 testes).
- **Ressalvas:** (a) o backup está no **mesmo servidor**: cópia off-site depende de destino que só o Claudio define (CL-12); (b) criptografar o backup antes do off-site (recomendação da Nightingale, não feito); (c) o volume `caddy_data` (conta ACME) **não** entra no backup: é segredo, trate à parte.

## 6. PIX por loja (API-07)
- Padrão: `MP_OAUTH_MODE=off` (nada do PIX é exigido). Para `real`: `PAYMENT_ENC_KEY` (32+, própria), `PAYMENT_ENC_KEY_ID`, `MP_CLIENT_ID`, `MP_CLIENT_SECRET`, `PUBLIC_API_URL` (https). `fake` só em dev. `infra/check-env.sh` valida; a API recusa subir fora disso.
- **Rotação da chave de cifra** (sem queda): (1) ponha a nova em `PAYMENT_ENC_KEY` com `PAYMENT_ENC_KEY_ID=v2` e a antiga em `PAYMENT_ENC_KEY_PREV` + `PAYMENT_ENC_KEY_PREV_ID=v1`; (2) `check-env.sh` e deploy; (3) **re-cifrar tudo** com a chave nova; (4) só depois esvazie os dois `PREV` e faça o deploy.
- **PENDENTE:** o passo (3). `StorePaymentsService.reencryptAll(keyId)` existe e é idempotente (testado pelo Babbage), mas **falta o comando/CLI**: sem ele este passo não é executável. Dono: Babbage/Turing. Não ligue `MP_OAUTH_MODE=real` antes de P-1..P-5 (condição G3).
- **Trocar de vendedor do Mercado Pago (decisão do Atlas, parecer da Nightingale):** sem pendências a troca é permitida; com PIX/estorno pendente a API **bloqueia** (409 `MP_HAS_PENDING_PAYMENTS`; reconectar a MESMA conta passa). **Limite conhecido:** os pagamentos antigos já encerrados ficam presos à conta `DISCONNECTED`, sem tokens. Um estorno **tardio** desses pedidos **só sai pelo aplicativo do próprio Mercado Pago**, não pelo sistema. Oriente o lojista antes da troca (o painel mostra o aviso, texto do Leonardo). Suporte: se pedirem estorno de pedido antigo depois da troca, a resposta é o app do Mercado Pago.
- **PENDENTE (P-5, depende de Babbage/Turing):** perda do `refresh_token` rotativo (o Mercado Pago troca o token a cada renovação; se a gravação falhar depois da troca, a conta vira `NEEDS_RECONNECT` e o lojista precisa reconectar), renovação do token e o que fazer se ela falhar. Escrever o procedimento só quando o comportamento existir e puder ser executado.
- **Ambiente:** `NODE_ENV` ausente na API conta como **produção** (fake e `http` recusados). O compose fixa `NODE_ENV=production`; em dev o `pnpm dev` define `development`.

## 7. Segredo de serviço web→API (SEC-24)
`API_INTERNAL_SECRET` igual nos dois serviços, só em tempo de execução (nunca `NEXT_PUBLIC_*`). **Provado:** mesmo hash nos dois containers, ausente da config da imagem e dos arquivos que o navegador baixa, e o web não recebe nenhum outro segredo (smoke 6d/6f). O Caddy **remove** `x-internal-service-secret` e `x-visitor-ip` vindos da internet (smoke 6e, com controle). Rotação: novo em `API_INTERNAL_SECRET`, antigo em `API_INTERNAL_SECRET_PREVIOUS` por um deploy, depois esvazie.

## 8. Caddy (INF-18)
- Compilado com `xcaddy` a partir de `infra/caddy/Dockerfile`: imagens por **versão + digest**, módulo `caddy-ratelimit` por **commit**. Para atualizar, mude a versão/digest/commit conscientemente, rode o smoke e registre no BOARD `caddy version`, `caddy build-info` e o id da imagem final.
- Limite por IP real em `/loja/*` (120/min; IPv6 agrupado em /64). Atrás de **CDN/balanceador** todos os visitantes chegam com o IP dele e **dividem** os 120/min (ST-46): antes de qualquer CDN é preciso a lista de IPs dele em `trusted_proxies`, **o que exige nova revisão da Nightingale** (SEC-24 e `TRUST_PROXY_CIDR`). **Sem registro AAAA no piloto.**
- Não cobre ataque **distribuído** (muitos IPs): a validação do slug e o teto de obsolescência do web são a barreira principal.
- **Memória do limitador (ST-50, risco ACEITO pelo Atlas em 17/11):** medido ~6,5 KB por IP distinto na janela de 1 min. Com `mem_limit: 512m` (e `GOMEMLIMIT=400MiB`, para o Go devolver memória antes do teto) cabem ~64 mil IPs a 80%. Um ataque com dezenas de milhares de IPs é distribuído: trata-se na borda/CDN, não aqui. **Sintoma:** o Caddy é morto por falta de memória e volta em segundos (`restart: unless-stopped`); durante esses segundos o site não responde. Se acontecer: `docker compose ps caddy` (veja o número de reinícios), `docker inspect -f '{{.State.OOMKilled}}' <container>`, e olhe o tráfego por IP no log do Caddy.
- **Alerta (pendente, NG-12/INF-08):** avisar quando o container do Caddy **reiniciar** ou passar de **70% do `mem_limit`**. Ainda não existe monitoramento: hoje só se vê ao olhar `docker stats`.
- **Imagem do Caddy:** a versão por digest congela também os pacotes do Alpine. **Reconstrua periodicamente** (troque o digest conscientemente) e rode um scanner de vulnerabilidades (trivy ou grype) **antes de cada release**; isso **não está automatizado e não foi feito**. O `go.sum` das dependências Go não fica no repositório: a trilha é `caddy build-info` + digest, registrados no BOARD a cada mudança.
- **Se o Caddy ganhar `trusted_proxies`** (CDN/ST-46): a SEC-24 e o `TRUST_PROXY_CIDR` precisam de nova revisão da Nightingale.
- **Estado:** o smoke da stack real foi executado em 17/11 sobre o INF-18 `af75092`: **53 ok / 1 falha** (a falha era o critério antigo do ST-50, depois decidido como risco aceito). O smoke com `mem_limit` 512 MB, `GOMEMLIMIT` e a 2ª leva de chaves (prova de que as chaves vencidas são descartadas) **ainda não foi executado**: não confie nesses dois itens até existir o log novo.

## 9. Docker Desktop caiu (ambiente DEV)
Sintoma: suítes falham em massa com `Can't reach database server`/503; `docker info` falha. **Não é código.**
1. Confira se o app Docker Desktop está rodando; se não, abra `%LOCALAPPDATA%\Programs\DockerDesktop\Docker Desktop.exe`.
2. Espere o motor (≈1–2 min) e suba o seu Postgres de teste: `docker start mc-test-<agente>-<porta>` e espere `pg_isready` (≈1 min de recuperação).
3. Só rode suítes depois (no máximo 2 completas ao mesmo tempo, regra do BOARD §0).
Histórico e contexto medido: BOARD §3 (5 saídas em 17/11; causa **não provada**).

## 10. Modo de impressão por loja, LEGACY ou QUEUE (API-12b, ADR-0004 §8.12)
**O que eu verifiquei:** só a migração `20261117160000_store_print_mode` (21 ok / 0 falhas; junto com a API-07, 37 ok / 0 falhas; `hopper\evidencias\INF-07-api12b-160000.log`): aditiva, as lojas existentes viram LEGACY. **O que é relato do Turing/Atlas e eu NÃO executei:** o comportamento da virada abaixo.
- **Trocar o modo:** `PUT /api/store/print-mode`, só o OWNER. Faça **fora do horário de pico**. A resposta traz as **3 consultas de conferência**: depois da virada devem dar **0**. Repetir a troca é seguro (idempotente: não muda nada nem grava nova auditoria). Se as consultas não zerarem, **pare e avise o Turing/Atlas**: não force.
- **QUEUE para LEGACY (recuo de emergência):** é recusado com 409 `PRINT_IN_PROGRESS` enquanto houver job em impressão com lease vigente (lease de 120 s). O painel diz "há impressão em andamento, tente em instantes": espere **até 2 min** e repita.
- **Auditoria:** cada troca grava `print.mode_change` na mesma transação (se não grava, o modo não muda); STAFF recebe 403 e a tentativa fica registrada.
- **Voltar o app para uma versão sem esta migração:** o app antigo ignora a coluna. Desfazer o banco só **depois** de voltar o app: `ALTER TABLE "Store" DROP COLUMN "printMode"; DROP TYPE "PrintMode";`. Isso **perde o modo escolhido por loja** (volta tudo para o comportamento LEGACY). Não executado por mim.

## 11. Logs da API: o que mudou com a NG-16 (para alertas e busca, NG-12/INF-08)
**Relato do Atlas sobre `feat/NG-16-token-do-pedido` @6b5a391; eu não executei nem li o código.**
- A query da URL com `token`, `code` ou `state` aparece **redigida** (`[redigido]`) nos logs "incoming request" e "request completed". Nunca procure um token real no log: ele não está lá.
- A linha padrão do Fastify **"Route … not found" deixa de existir**. Quem buscava ou alertava por essa frase deve passar a olhar o **status 404 na linha "request completed"**. Alerta ou painel que ainda dependam da frase antiga ficam **mudos**, sem erro: revise-os antes de confiar neles.
- O corpo do 404 de rota inexistente é idêntico em todas as rotas (não revela quais caminhos existem).

## 12. Ainda NÃO documentado (sem prova)
Suspensão/reativação de loja (depende de API-09), restauração em servidor de produção, observabilidade/alertas (INF-08), `deploy.sh` com backup obrigatório antes de migrar (rascunho em `hopper/inf11/deploy.sh.rascunho`, nunca executado).
