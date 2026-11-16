# Roteiro de teste com impressora térmica real (1 página)

Para quando existir uma impressora. Item de aceite pendente do G3; **não bloqueia o desenvolvimento** (o harness sem impressora já cobre a lógica: `run-selftest.ps1`). Dados de teste fictícios; use a API de DEV local, nunca uma loja real.

**Antes:** anote modelo da impressora, conexão (USB/rede), driver e versão, largura da bobina (58 ou 80 mm), versão do app e o SHA-256 do EXE (`build.ps1` imprime). Instale o driver, imprima a página de teste do Windows e confira que a impressora aparece em "Impressora:" na janela do app. Gere a prévia para comparar: `.\tools\preview-ticket.ps1 -OutDir $env:TEMP\previa` (PNG em 58 e 80 mm).

| # | Faça | Esperado | OK |
|---|---|---|---|
| 1 | Pedido de teste simples (loja DEV) | Sai **1** tíquete; loja, nº do pedido e tipo no topo, centralizados; itens com preço na borda direita; TOTAL em negrito; nada cortado nas bordas | ☐ |
| 2 | Pedido com nomes longos, observação e endereço grande | Quebra em linhas sem cortar palavra no meio (exceto palavra gigante); adicionais recuados; observação do item em itálico | ☐ |
| 3 | Acentos e símbolos: `ção`, `é`, `ñ`, `R$`, `–`, `«»` | Saem corretos (sem `?` nem quadrado). **Emoji não sai** (é removido de propósito); o texto em volta sai | ☐ |
| 4 | Pedido com muitos itens (12+) | Tíquete longo sai inteiro numa tira só; guilhotina corta **depois** da última linha, sem comer o rodapé | ☐ |
| 5 | Repita 1 e 4 com a bobina **de 58 e de 80 mm** (`PaperWidthMm` no `settings.json`: 57 ou 80) | Em 58 mm cabem ~32 colunas, em 80 mm ~48; compare com a prévia PNG e com `tests\golden` | ☐ |
| 6 | **Desligue** a impressora (ou tire o cabo) e crie um pedido | Nada imprime; faixa vermelha **"1 pedido SEM IMPRIMIR: #nnnn"** e balão no ícone, **uma vez só**; sem som repetido | ☐ |
| 7 | Ligue de volta | Em até ~15 s a 5 min (recuo) o tíquete sai **uma vez**; a faixa some; a API recebe o aviso | ☐ |
| 8 | Tire a **bobina** (sem papel) e crie um pedido | Se o driver informa "sem papel", o app avisa o motivo; senão o Windows guarda na fila: anote qual dos dois ocorreu | ☐ |
| 9 | Abra a **tampa** durante um pedido | Idem 8 (tampa aberta) | ☐ |
| 10 | Tire o cabo **no meio** de um tíquete longo | Sai um pedaço no papel; o pedido **não** é dado como impresso; ao reconectar sai o tíquete completo (avisar a cozinha do pedaço) | ☐ |
| 11 | Imprima um pedido, **feche o app à força** (Gerenciador de Tarefas) logo depois e reabra | Não reimprime; o pedido some da lista pendente da API | ☐ |
| 12 | Deixe 3 pedidos entrarem juntos | Saem 3 tíquetes, na ordem, cada um 1 vez | ☐ |
| 13 | Derrube a rede por 1 min e volte | O app reconecta sozinho; nenhum pedido perdido nem repetido | ☐ |
| 14 | Revogue a chave da impressora no painel de DEV | Faixa "chave recusada/revogada" e impressão pausada; com chave nova em "Configurar chave..." volta sozinho | ☐ |

**Se algo falhar:** anote o número do passo, a foto do papel, o trecho de `%LOCALAPPDATA%\MeuCardapioPrintClient\logs\print-client.log` e abra pendência no BOARD para o Ritchie. **Não** imprima pedidos de lojas reais nem conecte em produção.

**Limites conhecidos (registre o que observar):** o Windows só informa offline/sem papel se o driver reportar (WMI); alguns drivers aceitam o trabalho e perdem depois. Impressora de rede e USB podem se comportar diferente: teste as duas se houver.
