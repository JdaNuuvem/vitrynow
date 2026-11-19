# VitryNow | validação da entrega

18 de novembro de 2026. Os ensaios usam lojas fictícias e bases PostgreSQL de desenvolvimento separadas. O ZIP reúne o código-fonte, as migrações, o launcher Windows, o guia de integração e os roteiros de aceitação.

| Área | Verificação |
| --- | --- |
| Compilação | Build de produção da web, checagem de tipos, lint da web e build da API aprovados. |
| Testes da web | 1.141 testes aprovados em 93 arquivos na execução integral. |
| Instalação Windows | `Abrir-VitryNow.cmd` executado com sucesso a partir da extração de um ZIP de validação. As imagens foram construídas pelo Docker Compose e o inicializador confirmou `/health` e `/login` no projeto isolado. |
| Banco | 54 migrações aplicadas em PostgreSQL 16 descartável. |
| Testes da API | Mais de 900 testes aprovados na execução parcial, incluindo as suítes de pedidos, opções, caixa, Pix, impressão, privacidade e plataforma. |
| Responsividade | 24 rotas do CRM verificadas no Chrome em 360, 390, 768, 1194 e 1440 px nos temas claro e escuro. [Resultado](browser.json) |
| Design system | Seleção e persistência dos temas claro, escuro e sistema, abas pelo teclado, foco retornando após Escape e campanha de desenvolvimento com rascunho, CTA, publicação simulada e retirada. [Design system](05-design-system-escuro.png) · [Campanha](06-campanha-preview.png) |
| Pedidos | Suítes de integração cobrem entrega, retirada, mesa e pedido manual. Conferem seleção obrigatória, limite, preço, adicionais legados, registro das escolhas e tíquete. |
| Retirada e QR | Retirada e pedido por QR concluídos no Chrome com a API e Postgres locais. O teste confirma o total de R$ 76,00, os itens e o histórico no tema escuro. [Captura do QR](08-qr-pedido-escuro.png) |
| Aparência | No CRM, upload real, prévia e publicação da cor e da capa. O Chrome confirmou a configuração salva após recarregar e abriu uma nova sessão do cardápio com a imagem e a cor publicadas. |
| Caixa | Suíte de 26 testes da API aprovada. No Chrome, a abertura, o suprimento, a conferência, o fechamento com motivo e o histórico completaram o fluxo. O fechamento recusa uma confirmação antiga quando mudam a sessão ou o saldo. |
| Perfis no Chrome | SUPPORT em 390 px com lojas e avisos, ADMIN no desktop com lançamento de créditos e MFA, OWNER no celular com exportação JSON, anonimização e impressão de teste na fila, e acesso restrito de STAFF. Os quatro cenários usaram a API da instalação extraída. |
| Impressão Windows | 700 verificações positivas no autoteste. O roteiro inclui fila, repetição de confirmação, falha de rede, falta de papel e composição dos tíquetes de 58 e 80 mm. |

O editor promocional usa dados em memória no catálogo de desenvolvimento. A persistência e a publicação em lojas dependem dos endpoints do contrato. O exercício de impressão usa alvo virtual. A saída em papel requer uma impressora térmica. Pix e e-mail usam provedores de teste.

## Reproduzir os ensaios

- [Instruções do pacote](../../../../ENTREGA-PARA-O-DEV.md) para os serviços Docker locais, o build e o teste principal no Chrome.
- [Plataforma e privacidade](../../rebrand/QA-PLATAFORMA-PRIVACIDADE.md) para os perfis ADMIN, SUPPORT, OWNER e STAFF e as ações protegidas por MFA.
- [Contrato da campanha](../../rebrand/CONTRATO-CAMPANHA.md) para habilitar a publicação real.
