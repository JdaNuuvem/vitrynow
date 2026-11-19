# VitryNow | entrega de desenvolvimento

Esta entrega reúne o código do CRM, do cardápio público e do back-office, a API, as migrações e o cliente Windows de impressão. Use a pasta `VitryNow` como raiz do monorepo e preserve o `pnpm-lock.yaml` ao integrar as mudanças.

## Abrir e testar no Windows

1. Inicie o Docker Desktop com containers Linux e extraia o ZIP completo.
2. Execute `Abrir-VitryNow.cmd` na pasta extraída. Ele prepara um ambiente local com PostgreSQL, armazenamento de imagens, API e web. A inicialização aplica as migrações e carrega a loja de demonstração Ramenku.
3. Abra `/cadastro` para criar uma loja de teste ou acesse `http://127.0.0.1:3000/loja/ramenku` para conferir o cardápio de demonstração. A rota `/login` é a entrada do CRM. Use `/plataforma/login` com uma conta provisionada para o back-office.
4. Em **Minha loja → Aparência do cardápio**, altere a cor de destaque, o logotipo ou a foto de capa. Confira a prévia e clique em **Salvar aparência**. As alterações usam a API e o armazenamento da loja e aparecem no cardápio público.

O launcher usa as portas 3000 e 3001 e o projeto Docker `vitry-local` por padrão. Para testar lado a lado com a instalação existente, execute no PowerShell da pasta extraída:

```powershell
$env:VITRY_LOCAL_PROJECT = 'vitry-handoff-qa'
$env:VITRY_LOCAL_WEB_PORT = '3400'
$env:VITRY_LOCAL_API_PORT = '3401'
$env:VITRY_LOCAL_NO_BROWSER = '1'
.\Abrir-VitryNow.cmd
```

## Entradas para desenvolvimento

| Área | Entrada | Comportamento |
| --- | --- | --- |
| CRM da loja | `/dashboard` | Operação de pedidos, conferência de caixa, catálogo, grupos de opções, mesas e QR, equipe, entregadores, cupons, horários, entrega, relatórios, impressão e configuração da loja. |
| Cardápio público | `/loja/[slug]` | Compra para retirada ou entrega, grupos obrigatórios e complementos, carrinho, checkout e acompanhamento. O QR da mesa abre seu fluxo próprio. |
| Back-office | `/plataforma/login` | Entrada, sessão e permissões administrativas separadas. ADMIN e SUPPORT usam as ações permitidas ao perfil. |
| Privacidade da loja | `/dashboard/privacidade` | Fluxos do proprietário com reautenticação, exportação e ações de privacidade suportadas pela API. |
| Componentes e temas | `/dev/design-system` | Mostruário interativo das primitivas, estados, tipografia e temas. Disponível no Next.js em modo desenvolvimento. |
| Editor de campanha | `/dev/campanha` | Edição, enquadramento, ação para produto ou categoria, prévia em dois tamanhos, rascunho, publicação e retirada na demonstração. |

## Integração pendente

Implemente a persistência da campanha e inclua `store.campaign` no DTO público antes de habilitar `NEXT_PUBLIC_MENU_CAMPAIGN_ENABLED=1` no build web. O contrato descreve endpoints, versão para concorrência, permissões, mídia e invalidação do cache. A foto de capa e a cor já são persistidas pelo fluxo `/api/store/settings`. [Contrato de campanha](docs/frontend/rebrand/CONTRATO-CAMPANHA.md)

O Compose local opera com Pix e e-mail de teste. As credenciais e o provisionamento de ADMIN/SUPPORT são tarefas do ambiente de implantação. O launcher gera os segredos locais na primeira execução. O pacote inclui modelos `.env.example`.

## Verificação e manutenção

- Use Node 24 e a versão de pnpm definida em `package.json`. Execute `pnpm install --frozen-lockfile`, `pnpm db:generate` e `pnpm build`. Os scripts `typecheck`, `lint` e `test` da web estão em `apps/web/package.json`.
- A suíte de API exige `TEST_DATABASE_URL` apontando para uma base descartável `*_test` em `127.0.0.1`, nas portas `55440` a `55459`. Aplique as migrações antes dos testes.
- Com a instalação isolada acima em execução e Chrome ou Edge instalado, rode `pnpm test:e2e`. O teste verifica o projeto e as portas Docker antes de criar dados. Use `VITRY_QA_BROWSER` para fornecer um executável e `VITRY_QA_OUTPUT` para escolher a pasta de evidências.
- Consulte o catálogo e a referência de design para usar os componentes existentes e os tokens semânticos. [Design system](docs/frontend/DESIGN-SYSTEM.md)
- Consulte os resultados e as limitações da validação de entrega. [Evidências](docs/frontend/evidence/entrega/VALIDACAO.md)
