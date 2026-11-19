# Plataforma e privacidade em ambiente de teste

O back-office fica em `/plataforma`, com entrada em `/plataforma/login`. A sessão da plataforma usa o cookie HTTP-only `mc_platform_session` e MFA por e-mail. `SUPPORT` consulta e administra lojas e avisos. `ADMIN` também pode registrar créditos, com senha atual e MFA de uso único.

O CRM da loja usa sessão própria. Em `/dashboard/privacidade`, somente o dono pode consultar pedidos, baixar o JSON e confirmar a anonimização, com senha ou MFA conforme a API. Em desenvolvimento, ative `PRIVACY_ACTIONS_ENABLED=true` na API de teste e configure `PRIVACY_HASH_SALT` com um valor aleatório próprio, de pelo menos 16 caracteres. Na produção, o check de configuração exige `PRIVACY_ACTIONS_LEGAL_OK=true` para liberar a funcionalidade.

## Preparar contas de QA

Crie um banco descartável em uma porta livre da faixa de teste. O script de provisionamento verifica o nome do banco, o host e a porta. Cada execução gera uma conta diferente e imprime a senha somente no terminal local.

```powershell
.\scripts\test-db.ps1 -Agent plataforma -Port 55449
$env:TEST_DATABASE_URL = 'postgresql://meucardapio:meucardapio@127.0.0.1:55449/meucardapio_test?schema=public'
pnpm --filter '@meucardapio/api' exec tsx tests/seed-platform-qa.ts SUPPORT
pnpm --filter '@meucardapio/api' exec tsx tests/seed-platform-qa.ts ADMIN
```

Aponte `DATABASE_URL` da API de QA para esse mesmo banco e inicie a API em `NODE_ENV=development`, com `WEB_ORIGIN` igual ao endereço da web de QA. A web usa `NEXT_PUBLIC_API_URL` para localizar a API. Em HTTP local, use `COOKIE_SECURE=false`; gere `JWT_SECRET` e `MFA_HMAC_KEY` distintos seguindo o `.env.example` da API. No modo de e-mail local sem Resend, o código de MFA de teste aparece na saída da API. Mantenha as credenciais geradas e a saída do servidor no ambiente descartável.

Para testar privacidade manualmente, cadastre na web de QA uma loja e use apenas pedidos de exemplo. Um pedido encerrado permite validar anonimização. Um pedido em andamento permite verificar o bloqueio e o acesso independente à exportação. O atalho aparece para o dono quando a API disponibiliza a funcionalidade.

## Executar a aceitação no navegador

Instale as dependências com pnpm no ambiente de QA. O roteiro usa o Playwright do workspace e encontra o Chrome instalado no caminho padrão do Windows. Para outra instalação de Chromium, informe o executável em `VITRY_QA_BROWSER`. Use `VITRY_QA_PLAYWRIGHT` se o módulo estiver fora do repositório. Configure a API de QA com `MFA_ENFORCED=true`, `PRIVACY_ACTIONS_ENABLED=true`, `NODE_ENV=development` e e-mail local, sem Resend. Redirecione a saída dessa API para um arquivo fora do repositório. Gere uma nova loja fictícia a cada execução porque o cenário anonimiza o pedido de exemplo.

```powershell
$env:VITRY_QA_FIXTURE = Join-Path $env:TEMP 'vitry-platform-fixture.json'
$env:VITRY_QA_API_LOG = Join-Path $env:TEMP 'vitry-platform-api.log'
$env:VITRY_QA_API = 'http://127.0.0.1:3201'
$env:VITRY_QA_WEB = 'http://127.0.0.1:3200'
pnpm --filter '@meucardapio/api' exec tsx tests/seed-platform-qa.ts BROWSER > $env:VITRY_QA_FIXTURE
node scripts/qa/platform-acceptance.cjs
```

O cenário usa Chromium em 390 × 844 e 1280 × 880. Cobre sessão, MFA, busca e gestão de lojas, publicação e retirada de avisos, lançamento de créditos, download JSON, bloqueio e anonimização de pedidos fictícios, alertas de impressão, troca de modo, envio de tíquete de teste e restrições por perfil. O teste de impressão confirma o envio à fila. Um dispositivo térmico é necessário para a conferência do papel.

### Usar o pacote local extraído

Suba o Compose de QA com o nome de projeto `vitry-handoff-qa`, web em `127.0.0.1:3400` e API em `127.0.0.1:3401`. Use credenciais geradas para essa instância. A sobreposição da plataforma usa o modo de e-mail de desenvolvimento. Ela habilita MFA e privacidade para validar somente contas e pedidos fictícios.

Na pasta extraída, use o arquivo de ambiente criado pelo lançador para o projeto de QA. Gere o sal aleatório uma vez para essa instância.

```powershell
$qaEnvFile = Join-Path (Get-Location) 'infra/.env.vitry.local'
$env:VITRY_LOCAL_PROJECT = 'vitry-handoff-qa'
$env:VITRY_LOCAL_WEB_PORT = '3400'
$env:VITRY_LOCAL_API_PORT = '3401'
$env:VITRY_QA_PRIVACY_HASH_SALT = node -p "require('node:crypto').randomBytes(32).toString('hex')"
docker compose --project-name vitry-handoff-qa --env-file $qaEnvFile `
  -f infra/docker-compose.local.yml -f infra/docker-compose.platform-qa.yml `
  up -d --no-build --no-deps api
```

Com `GET /health` da API respondendo, prepare a fixture e rode a aceitação.

```powershell
$env:VITRY_QA_API = 'http://127.0.0.1:3401'
$env:VITRY_QA_WEB = 'http://127.0.0.1:3400'
$env:VITRY_QA_FIXTURE = Join-Path $env:TEMP 'vitry-platform-fixture.json'
$env:VITRY_QA_API_CONTAINER = .\scripts\qa\compose-platform-fixture.ps1 -FixturePath $env:VITRY_QA_FIXTURE
node scripts/qa/platform-acceptance.cjs
```

O script confere o projeto, as portas, o volume e a conexão ao banco antes de criar os dados fictícios. O navegador usa os códigos de teste emitidos apenas pelo contêiner desse projeto. Mantenha o JSON com as senhas fora do repositório e descarte-o quando concluir a verificação.

## Verificar os fluxos

- A senha da plataforma inicia o desafio. O código confirma a sessão. Uma conta de loja permanece restrita ao CRM.
- Na plataforma, use a busca e o filtro de situação, consulte uma loja, estenda o período de teste e confirme suspensão e reativação com motivo.
- Publique um aviso de exemplo e retire-o da lista. O `GET /api/platform/notices` retorna páginas de avisos para a equipe da plataforma.
- Consulte créditos com `SUPPORT`. Com `ADMIN`, verifique o lançamento, a senha, a emissão do código e o saldo. Uma repetição após falha de conexão reutiliza a chave da mesma operação.
- No CRM, entre como dono para consultar pedidos e exportar JSON, confira a prévia e confirme a remoção de dados em um pedido descartável. Entre como funcionário e verifique a restrição. Teste com o sinalizador da API desligado e confirme a indisponibilidade.
