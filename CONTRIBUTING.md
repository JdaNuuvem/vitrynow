# Como contribuir (esteira de código)

## Branches
- `main`: sempre verde e implantável em DEV. **Ninguém faz push direto.**
- Trabalho em branch curta a partir da `main`, com prefixo: `feat/`, `fix/`, `docs/`, `chore/`, `test/`. Ex.: `feat/API-19-aceitar-link`, `fix/pedido-total-zero`.
- Backend e frontend em PRs separados sempre que possível (contrato primeiro, tela depois).

## Pull Request
1. Abra o PR contra `main` com descrição, como testar e riscos (use o modelo em `.github/pull_request_template.md`).
2. CI obrigatório verde (`scripts/ci.ps1`: install com lockfile, typecheck, testes da API e do web, build).
3. Pelo menos 1 aprovação: mudanças de API/banco/pagamento/segurança precisam do responsável pelo backend; telas, do responsável pelo frontend.
4. Mudança de banco: uma migração por PR, nome com o ID da tarefa, só aditiva quando possível.
5. Merge por "squash" ou "merge commit" com mensagem clara. Apague a branch depois.

## Regras de segurança
- Nunca versionar `.env`, chaves, tokens, dumps ou backups. Use `.env.example` sem valores.
- Nada vai para produção sem aprovação explícita do dono do projeto.
- Segredos de pagamento e e-mail só em mock/sandbox até autorização.

## Rodando localmente
Veja o README (seção "Rodando localmente"). Postgres de teste: `scripts/test-db.ps1`.

## Pendente de configurar no GitHub (admin)
- Proteção da `main` (PR obrigatório, CI obrigatório, sem force-push).
- Adicionar o sócio como colaborador e definir `CODEOWNERS` com os dois usuários.
- Configurar o CI no GitHub Actions (hoje o CI é um script local).

## Senhas e segredos em testes (GitGuardian)
- Senha de usuário de teste e string falsa de segredo ficam SÓ em arquivos de teste (`apps/api/tests/**`, `*.test.ts`) e são sempre fictícias.
- O banco do CI é descartável (container do job, só em `localhost`); a senha dele não protege nada. Segredo REAL nunca entra no repositório: cofre ou variável de ambiente.
- `.gitguardian.yaml` ignora só esses arquivos de teste e o `ci.yml`; o código de produção continua verificado. Se o GitGuardian alertar fora deles, trate como real: pare e avise a Nightingale.
