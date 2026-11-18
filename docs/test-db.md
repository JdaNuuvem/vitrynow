# Postgres de teste por agente (`scripts/test-db.ps1`)

Cada agente testa no **seu** Postgres descartável, na **sua** porta. Nada de usar o banco de dev
(`55432`) nem o de outra pessoa: duas suítes no mesmo banco se atropelam (`resetDb`).

## Uso (PowerShell, na raiz do seu worktree)

```powershell
.\scripts\test-db.ps1 -Agent <nome> -Port <sua-porta>            # sobe/reaproveita e aplica migrations
$env:TEST_DATABASE_URL = "postgresql://meucardapio:meucardapio@127.0.0.1:<sua-porta>/meucardapio_test?schema=public"
pnpm --filter @meucardapio/api test
```

- Sem o `TEST_DATABASE_URL` a suíte **falha com erro claro** (INF-14): ela não escolhe banco sozinha. Só aceita banco terminado em `_test` e nunca a porta de dev `55432`.
- **Regra do BOARD §0:** UMA suíte completa por agente por vez e no máximo 3 suítes completas simultâneas na máquina (`ci.ps1 -MaxSuites`, padrão 3; as demais esperam vaga por `-WaitMinutes`, padrão 30). Cada agente mantém UM Postgres de teste (`mc-test-<agente>-<porta>`). Avisa se há menos de 3 GB de RAM livre. Se uma suíte falhar em massa com "Can't reach database server"/503, rode `docker ps -a --filter name=mc-test` e recrie com `test-db.ps1` ANTES de culpar o código: o Docker já caiu 3 vezes por excesso de carga.
- Criou migration nova no seu branch? Rode o script de novo (aplica só as pendentes).
- Quer começar limpo? `-Fresh` (recria o container). Terminou? `-Down`.
- Container: `mc-test-<agente>-<porta>`, só em `127.0.0.1`, senha fixa de teste. Bancos: `meucardapio` (para `DATABASE_URL`/seed/dev da API) e `meucardapio_test` (suíte).

## Portas (BOARD.md §0)

Atlas 55440–41 · Hopper 55442–43 · Turing 55444–45 · Tesla 55446–47 · Da Vinci 55448–49 · Deming 55450–51 ·
Nightingale 55452–53 · Sun Tzu 55454–55 · Leonardo 55456 · Ogilvy 55457 · reserva 55458–59.
O script só aceita 55440–55459 e recusa porta já usada por outro container.

## Problemas comuns

| Sintoma | Causa / solução |
|---|---|
| `porta N já usada por: ...` | outro container na porta; use a sua faixa ou `-Down` no antigo |
| `migrate deploy falhou` | migration do seu branch com erro; rode `-Fresh` para reproduzir do zero |
| "TEST_DATABASE_URL não definida" | exporte a variável (comando em cima) |
| Docker parado | abra o Docker Desktop e rode de novo |
