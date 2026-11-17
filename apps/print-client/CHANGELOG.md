# Changelog do print-client

A versão do app vem de `Properties\AssemblyInfo.cs` (fonte única); `build.ps1` falha se `installer.iss` anunciar outra.
O hash do EXE de cada release sai em `tools\build-installer.ps1` e entra no manifesto de atualização (`tools\sign-update.ps1`).

## 1.0.0 (em desenvolvimento, ainda sem release)

- Impressão sem duplicidade (polling + WebSocket no mesmo portão, ack gravado no disco antes de avisar a API, recuo em falha, watchdog).
- **Uma instância por computador** (o instalador também respeita: pede para fechar o app antes de atualizar).
- Chave de impressora protegida pelo Windows (DPAPI); chave recusada pausa a impressão e volta sozinha quando a API aceitar.
- Faixa "N pedidos sem imprimir" fixa na janela; balão de novo pedido não some mais na hora (R12).
- Tíquete próprio (58 e 80 mm), com sanitização do texto do cliente, bloco de pagamento e impressora virtual para teste sem papel.
- Pedido de total zero (cupom de 100%) imprime "SEM COBRANÇA: NADA A COBRAR" em vez de "COBRAR R$ 0,00" ou "PIX - CONFERIR NA HORA", também na 2ª via.
- Tíquete com total ausente (versão desencontrada) não imprime mais "TOTAL R$ 0,00" nem "COBRAR R$ 0,00": avisa "TOTAL NÃO INFORMADO - CONFERIR NO PAINEL" e mostra o valor CALCULADO quando os itens permitem. Limite conhecido: com total E desconto ausentes o CALCULADO usa desconto 0, então pode ficar MAIOR que o devido se houver cupom; o erro vai no sentido de cobrar a mais (nunca de deixar de cobrar), e o papel marca "CALCULADO" e "CONFERIR NO PAINEL".
- Atualização automática segura (HTTPS, manifesto assinado com duas chaves, validade, hash conferido antes de executar). Desligada até a chave de release existir.
- A atualização nunca instala sozinha: pede confirmação do lojista; chave de release protegida por senha (formato v2; chave em texto puro é recusada na assinatura).
- Modo PrintJob (claim/ack do ADR-0004) pronto no cliente, desligado por padrão (`UsePrintJobs`); conferido contra a API-12 local (pedido, falha, 2ª via, teste, cancelamento e duas impressoras na mesma fila).

- O modo de impressão (legado ou fila) vem do servidor, por loja; o app segue o servidor a cada ciclo e nunca mistura os dois na virada (nada em impressão é reclamado pelo outro modo; pedido já impresso no legado não reimprime pelo job).
- Sons de alerta gerados pelo app.
- Build reprodutível sem dependência do `reconstruction/`; instalador Inno Setup sem identidade do terceiro (`tools\scan-identity.ps1`).

Pendências de distribuição: nome/marca final (CL-05), assinatura de código do instalador (PC-13, gasto), servidor de downloads e chaves de release (Claudio).
