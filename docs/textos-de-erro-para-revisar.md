# Textos de erro para revisar (SSOT D6)

Gerado por `node scripts/textos-de-erro.mjs` a partir de `packages/shared-types/src/errorMessages.ts`. **295 códigos: 240 aprovados, 55 com o texto da API (decidido), 0 em rascunho.**

**Como revisar:** para cada linha, aprove o texto ou escreva o novo na coluna *Texto final*. Depois o dev troca no catálogo `e("...")` por
`ok("texto final")`. A partir daí, painel e cardápio passam a mostrar o texto aprovado (em vez do texto técnico que a API manda hoje).

Regras de escrita sugeridas: falar com a pessoa ("Informe...", "Escolha..."), dizer o que fazer em seguida, sem jargão (nada de "inválido" sozinho
quando dá para dizer o que está errado), no máximo uma frase curta. **loja** = cliente final no cardápio; **painel** = dono e equipe.

| Código | Onde aparece | Texto atual (rascunho) | Texto final |
|---|---|---|---|
| — | | Nenhum rascunho pendente. | |

## Mantidos com o texto da API (decidido na revisão)

A API manda uma frase mais específica que um texto fixo (com número, nome do item ou o caso exato). O web NÃO substitui; o texto abaixo é só o resumo.

| Código | Onde aparece | Resumo no catálogo |
|---|---|---|
| `SCHEDULE_TOO_FAR` | loja | Escolha um horário mais próximo. |
| `SCHEDULE_TOO_SOON` | loja | Escolha um horário com mais antecedência. |
| `INGREDIENT_LIMIT_REACHED` | painel | A loja atingiu o máximo de insumos. |
| `LOSS_UNDO_FORBIDDEN` | painel | A equipe só desfaz a própria perda, até 30 minutos depois. Peça ao dono. |
| `CASH_COUNTED_REQUIRED` | painel | Informe o valor contado no caixa. |
| `CASH_REQUIRED` | painel | Abra o caixa para continuar. |
| `COUPON_CODE_INVALID` | painel | Código de cupom inválido. |
| `COUPON_EXPIRY_INVALID` | painel | Data de validade do cupom inválida. |
| `COUPON_VALUE_INVALID` | painel | Valor do cupom inválido. |
| `CREDIT_LIMIT_EXCEEDED` | painel | Limite de crédito excedido. |
| `FEATURE_LOCKED` | painel | Recurso não incluído no seu plano. |
| `FILTER_INVALID` | painel | Filtro inválido. |
| `FORBIDDEN_ROLE` | painel | Você não tem permissão para esta ação. |
| `IDEMPOTENCY_KEY_REUSED` | loja, painel | Esta requisição já foi usada com outros dados. |
| `INVALID_TRANSITION` | painel | Não é possível mudar o pedido para este status. |
| `ITEM_UNAVAILABLE` | loja | Um item do pedido não está disponível. |
| `MIN_ABOVE_ACTIVE_OPTIONS` | painel | O mínimo é maior que as opções ativas. |
| `NOT_AWAITING_PAYMENT` | painel | O pedido não está aguardando pagamento. |
| `NOTE_TOO_LONG` | loja, painel | A observação é longa demais. |
| `OPENING_HOURS_DERIVED` | painel | O texto de horário foi ignorado: vale a grade. Edite em Horário de funcionamento. |
| `PAYMENT_METHOD_REQUIRED` | loja | Escolha a forma de pagamento. |
| `RATE_LIMITED` | loja, painel | Muitas tentativas. Aguarde um pouco. |
| `REPORT_RANGE_INVALID` | painel | Período do relatório inválido. |
| `REPORT_WINDOW_TOO_LARGE` | painel | Período do relatório muito longo. |
| `STORE_SUSPENDED` | loja, painel | Loja suspensa. |
| `TABLE_REQUIRED` | loja | Informe a mesa. |
| `TESTE` | painel | Mensagem de teste. |
| `TOO_MANY_GROUPS` | painel | Grupos de opções demais. |
| `TWO_BASE_GROUPS` | painel | Só é permitido um grupo base. |
| `UNSUPPORTED_TYPE` | painel | Tipo de arquivo não suportado. |
| `VALIDATION_ERROR` | loja, painel | Dados inválidos. Confira os campos. |
| `WEIGHT_OUT_OF_RANGE` | loja | Peso fora do intervalo permitido. |
| `WEIGHT_STEP_INVALID` | loja | Peso fora do passo permitido. |
| `ZONE_LIMIT` | painel | Limite de zonas de entrega atingido. |
| `ADDON_IN_USE` | painel | Este adicional está em uso. Remova-o dos grupos primeiro. |
| `AUDIT_UNAVAILABLE` | painel | Busca por telefone indisponível agora. Busque pelo código ou nome, ou tente mais tarde. |
| `CAMPAIGN_INVALID` | painel | Campanha inválida. |
| `CASH_REASON_INVALID` | painel | Motivo inválido para esta operação. |
| `CASH_REASON_REQUIRED` | painel | Informe o motivo. |
| `CASH_WITHDRAWAL_EXCEEDS_BALANCE` | painel | A sangria passa do dinheiro em caixa. |
| `CATEGORY_LIMIT_REACHED` | painel | A loja atingiu o máximo de categorias. |
| `NOT_REFUND_PENDING` | painel | Este estorno não tem um cancelamento associado. |
| `OPTION_GROUP_INVALID` | painel | Grupo de opções inválido. |
| `ORDER_CANCELED` | painel | Pedido cancelado: não há o que reimprimir. |
| `ORDER_STATE_CHANGED` | painel | O pedido mudou. Atualize a tela. |
| `PERIOD_INVALID` | painel | Informe a data inicial e a final. |
| `PERIOD_TOO_LONG` | painel | O período escolhido é longo demais. |
| `PRODUCT_IN_OPEN_ORDERS` | painel | O produto está em pedidos abertos. Oculte em vez de excluir. |
| `PRODUCT_LIMIT_REACHED` | painel | A loja atingiu o máximo de produtos. |
| `PROMO_EXPIRY_INVALID` | painel | Data final da promoção inválida. |
| `PROMO_INVALID` | painel | Promoção inválida. Confira o preço e as datas. |
| `REASON_REQUIRED` | painel | Informe o motivo do cancelamento. |
| `SCHEDULE_INVALID` | painel | Horário inválido. |
| `STORAGE_UNAVAILABLE` | painel | Não foi possível guardar a imagem agora. Tente de novo. |
| `TOO_MANY_OPTIONS` | painel | O grupo passou do limite de opções. |

## Aprovados (o web mostra este texto no lugar do da API, quando o catálogo estiver ligado)

| Código | Onde aparece | Texto aprovado |
|---|---|---|
| `ADDRESS_REQUIRED` | loja | Informe o endereço de entrega. |
| `ALREADY_SUSPENDED` | painel | A loja já está suspensa. |
| `BASE_PRICE_ZERO` | painel | Informe um preço base maior que zero. |
| `BUSY_DURATION_INVALID` | painel | Escolha por quanto tempo a loja fica no modo ocupado. |
| `CAPTCHA_REQUIRED` | loja, painel | Confirme que você não é um robô. |
| `DISCOUNT_TOO_HIGH` | painel | O desconto precisa ser menor que o total da conta. |
| `PAYMENTS_MISMATCH` | painel | A soma das formas de pagamento precisa dar o total da conta. |
| `SERVICE_FEE_DISABLED` | painel | Esta loja não cobra taxa de serviço. |
| `SCHEDULE_NOT_ALLOWED` | loja | Este tipo de pedido não pode ser agendado. |
| `SCHEDULE_OUTSIDE_HOURS` | loja | A loja não atende nesse horário. Escolha outro. |
| `SCHEDULING_UNAVAILABLE` | loja | Esta loja não aceita pedidos agendados. |
| `INGREDIENT_NAME_TAKEN` | painel | Já existe um insumo com esse nome. |
| `FORMULA_AS_TEXT` | painel | Uma célula parecia fórmula e foi guardada como texto. |
| `HTML_AS_TEXT` | painel | Uma célula tinha código HTML e foi guardada como texto. |
| `IMPORT_BATCH_CHANGED` | painel | A importação mudou. Confira a prévia de novo. |
| `IMPORT_FORMAT_INVALID` | painel | Não reconhecemos este arquivo. Use uma planilha CSV ou Excel (.xlsx). |
| `IMPORT_HAS_PENDING_ROWS` | painel | Há linhas com problema. Corrija a planilha ou publique só as linhas certas. |
| `IMPORT_NOT_PENDING` | painel | Esta importação já foi finalizada. |
| `IMPORT_RATE_LIMITED` | painel | Limite de 3 importações por hora. Tente de novo mais tarde. |
| `ROW_IGNORED_NO_NAME` | painel | Linha sem nome de produto: foi ignorada. |
| `TOO_MANY_ROWS` | painel | A planilha tem mais de 500 linhas. Divida em duas. |
| `UNKNOWN_FIELD` | painel | Coluna não reconhecida: foi ignorada. |
| `INGREDIENT_NOT_FOUND` | painel | Este insumo não existe mais. Atualize a tela. |
| `STOCK_MOVEMENT_NOT_FOUND` | painel | Lançamento não encontrado. |
| `LOSS_NOT_UNDOABLE` | painel | Só uma perda lançada à mão pode ser desfeita. |
| `LOSS_ALREADY_UNDONE` | painel | Este lançamento já foi desfeito. |
| `REELS_DISABLED` | painel | Os vídeos ainda não estão disponíveis. |
| `REEL_NOT_FOUND` | painel | Vídeo não encontrado. |
| `REEL_ALREADY_EXISTS` | painel | Este produto já tem um vídeo. Remova-o para enviar outro. |
| `REEL_TAKEN_DOWN` | painel | Este vídeo foi retirado após uma denúncia e está em análise. |
| `INVALID_PRODUCT` | painel | Escolha o produto do vídeo. |
| `KEY_OUTSIDE_STORE` | painel | Este arquivo não é da sua loja. |
| `VIDEO_TOO_LONG` | painel | O vídeo passa de 30 segundos. |
| `VIDEO_TOO_LARGE` | painel | O vídeo passa do tamanho máximo permitido. |
| `VIDEO_FORMAT_INVALID` | painel | Use um vídeo MP4 ou MOV. |
| `VIDEO_LIMIT_REACHED` | painel | Você chegou ao limite de vídeos do plano. |
| `VIDEO_PROCESSING_FAILED` | painel | Não conseguimos preparar este vídeo. Envie outro. |
| `VIDEO_NOT_READY` | painel | O vídeo ainda está sendo preparado. |
| `VIDEO_STORAGE_FULL` | painel | O espaço de vídeos da sua loja acabou. Remova um vídeo. |
| `TABLE_PAYS_AT_CLOSE` | painel | O pedido da mesa é pago no fechamento da mesa. |
| `USER_NOT_FOUND` | painel | Esta pessoa não está mais na equipe. Atualize a página. |
| `RESERVATION_OVERLAP` | painel | Esta mesa já tem reserva nesse horário. |
| `RESERVATION_NOT_FOUND` | painel | Reserva não encontrada. |
| `DISH3D_UNAVAILABLE` | painel | O prato 3D ainda não está disponível. |
| `DISH3D_PHOTOS_COUNT` | painel | Envie de 1 a 4 fotos do prato. |
| `DISH3D_PHOTO_INVALID` | painel | Use fotos JPG, PNG ou WebP. |
| `DISH3D_ALREADY_RUNNING` | painel | Este prato já está sendo gerado. Aguarde terminar. |
| `DISH3D_PROVIDER_ERROR` | painel | O serviço de 3D não respondeu. Seus créditos foram devolvidos; tente de novo. |
| `DISH3D_NO_MODEL` | painel | Gere o modelo 3D antes de publicar. |
| `AI_CREDITS_INSUFFICIENT` | painel | Você não tem créditos suficientes para gerar o prato 3D. |
| `PRODUCT_NO_RECIPE` | painel | Este produto não tem ficha técnica. Monte a ficha ou lance a perda por insumo. |
| `CASH_ALREADY_OPEN` | painel | Já existe um caixa aberto. |
| `CHANGE_ONLY_CASH` | loja, painel | Troco só vale para pagamento em dinheiro. |
| `CHANGE_TOO_LOW` | loja, painel | O valor para troco precisa cobrir o que será pago em dinheiro. |
| `CLIENTE_DESISTIU` | loja, painel | Cancelamento solicitado pelo cliente. |
| `COUPON_EXHAUSTED` | loja | Este cupom atingiu o limite de usos. |
| `COUPON_EXPIRED` | loja | Este cupom expirou. |
| `COUPON_INVALID` | loja | Este cupom não existe ou não vale nesta loja. |
| `COUPON_MIN_ORDER` | loja | Este cupom vale a partir de um valor mínimo. Adicione mais itens. |
| `CREDIT_NEGATIVE_BALANCE` | painel | Não há créditos suficientes para isso. |
| `CUSTOM_DOMAIN_TAKEN` | painel | Este domínio já está ligado a outra loja. |
| `DELIVERY_DISABLED` | loja | Esta loja não está fazendo entregas agora. Escolha retirada. |
| `DELIVERY_FEE_CHANGED` | loja | A taxa de entrega mudou. Confira o novo total. |
| `DISCOUNT_ABOVE_LIMIT` | painel | O desconto passa do seu limite. Peça ao dono. |
| `EMAIL_IN_USE` | painel | Este e-mail já tem cadastro. Entre com ele ou use outro. |
| `EMAIL_NOT_SENT` | painel, email | Não conseguimos enviar o e-mail. Tente de novo em instantes. |
| `EMAIL_NOT_VERIFIED` | painel | Confirme seu e-mail para continuar. |
| `ESTORNO_MANUAL` | loja, painel | Pedido cancelado pela loja. |
| `ESTORNO_NAO_CONCLUIDO` | loja, painel | Seu pedido foi cancelado. A loja entrará em contato sobre a devolução. |
| `FEATURE_ALREADY_AVAILABLE` | painel | Este recurso já está disponível no seu plano. |
| `FEATURE_DISABLED` | painel | Este recurso não está disponível agora. |
| `FILE_REQUIRED` | painel | Escolha um arquivo para enviar. |
| `FILE_TOO_LARGE` | painel | O arquivo é grande demais. Envie um arquivo menor. |
| `IDEMPOTENCY_KEY_INVALID` | loja, painel | Não foi possível enviar. Atualize a página e tente de novo. |
| `INVALID_KIND` | painel | Tipo de imagem não aceito. Use foto de produto, logo ou capa. |
| `INVALID_TABLE` | loja | Este QR code de mesa não vale mais. Peça ajuda à equipe. |
| `LIMIT_REACHED` | painel | Você chegou ao limite do seu plano. |
| `LOGIN_LOCKED` | painel | Muitas tentativas de entrar. Aguarde alguns minutos e tente de novo. |
| `MFA_EXPIRED` | painel | O código expirou. Peça um novo. |
| `MFA_INVALID` | painel | Código incorreto. Confira e tente de novo. |
| `MFA_LOCKED` | painel | Muitas tentativas com o código. Aguarde alguns minutos. |
| `MFA_REQUIRED` | painel | Informe o código de verificação. |
| `MIN_ORDER` | loja | O pedido ainda não atingiu o valor mínimo da loja. |
| `MODE_QUEUE` | impressao | Esta loja imprime pela fila de impressão. |
| `NEIGHBORHOOD_NOT_FOUND` | loja | Não achamos este bairro. Escolha um da lista. |
| `NEIGHBORHOOD_REQUIRED` | loja | Informe o bairro. |
| `NEIGHBORHOOD_UNAVAILABLE` | loja | Não entregamos neste bairro. |
| `NOT_FOUND` | loja, painel | Não encontramos o que você procurou. Atualize a página. |
| `NOT_IN_TRIAL` | painel | A loja não está em período de teste. |
| `NOT_SUSPENDED` | painel | A loja não está suspensa. |
| `OPTION_DUPLICATE` | loja, painel | Esta opção foi escolhida duas vezes. |
| `OPTION_MAX_EXCEEDED` | loja | Você escolheu opções demais. Desmarque alguma. |
| `OPTION_NOT_FOUND` | loja | Uma opção não está mais disponível. Escolha de novo. |
| `OPTION_PER_OPTION_MAX` | loja | Você passou da quantidade máxima desta opção. |
| `OPTION_QUANTITY_INVALID` | loja | Confira a quantidade da opção. |
| `OPTION_REQUIRED` | loja | Escolha as opções obrigatórias para continuar. |
| `ORDER_NOT_FOUND` | loja, painel | Pedido não encontrado. |
| `ORIGIN_MISMATCH` | painel | Não foi possível confirmar a origem do acesso. Atualize a página. |
| `OUTRO` | loja, painel | Pedido cancelado pela loja. |
| `PAGAMENTO_APOS_CANCELAMENTO` | loja, painel | O pagamento chegou depois do cancelamento do pedido. |
| `PAGAMENTO_NAO_APROVADO` | loja, painel, whatsapp | O pagamento não foi aprovado. |
| `PASSWORD_INVALID` | painel | Senha incorreta. |
| `PHONE_REQUIRED` | loja | Informe seu telefone com DDD. |
| `PICKUP_DISABLED` | loja | Esta loja não está aceitando retirada agora. Escolha entrega. |
| `PIX_UNAVAILABLE` | loja | O Pix está indisponível agora. Escolha outra forma de pagamento. |
| `PLATFORM_ROLE_REQUIRED` | painel | Só a equipe da plataforma pode fazer isso. |
| `PRODUCT_NOT_FOUND` | loja, painel | Este produto não existe mais. Atualize a página. |
| `PRODUCT_UNAVAILABLE_BY_RULE` | loja | Este produto não está disponível neste horário. |
| `QR_ORDERING_DISABLED` | loja | Esta loja não está recebendo pedidos pelo QR code. Peça à equipe. |
| `QUEUE_WITHOUT_PRINTER` | painel | A fila de impressão está ligada, mas nenhuma impressora foi configurada. |
| `READ_ONLY` | painel | Sua conta está só para consulta. Regularize o plano para editar. |
| `REAUTH_FAILED` | painel | Senha incorreta. Não foi possível confirmar sua identidade. |
| `REAUTH_REQUIRED` | painel | Confirme sua senha para continuar. |
| `REPORT_TOO_LARGE` | painel | O relatório ficou grande demais. Escolha um período menor. |
| `SERVER_BUSY` | loja, painel | O sistema está ocupado agora. Tente de novo em instantes. |
| `SLUG_INVALID` | painel | Use só letras minúsculas, números e hífen no endereço da loja. |
| `SLUG_RESERVED` | painel | Este endereço não pode ser usado. Escolha outro. |
| `STEP_AUTOMATIC` | painel | Este passo é concluído sozinho quando a loja tem os dados. |
| `STORE_CLOSED` | loja | A loja está fechada agora. |
| `STORE_IN_USE` | painel | Este endereço de loja já está em uso. Escolha outro. |
| `STORE_UNAVAILABLE` | loja | Esta loja não está disponível no momento. |
| `SUBSCRIPTION_INACTIVE` | painel | Sua assinatura está inativa. Regularize em Planos. |
| `SUSPENDED` | painel | Sua conta está suspensa. Fale com o suporte. |
| `TABLE_BUSY` | loja, painel | Esta mesa já está ocupada. |
| `TABLE_NOT_FOUND` | loja, painel | Mesa não encontrada. |
| `VERIFY_RESEND_LIMITED` | painel, email | Aguarde alguns minutos para pedir outro e-mail de verificação. |
| `VERIFY_TOKEN_INVALID` | painel, email | Este link de verificação expirou ou já foi usado. Peça um novo. |
| `WRITE_CONFLICT` | loja, painel | Alguém mudou isso ao mesmo tempo. Atualize a página e tente de novo. |
| `ZONE_DUPLICATE` | painel | Este bairro já está na lista de entrega. |
| `ACERTADO_COM_CLIENTE` | painel | Devolução acertada direto com o cliente. |
| `ADDITIONAL_NOT_FOUND` | loja, painel | Um adicional não está mais disponível. Escolha de novo. |
| `ADDON_HAS_GROUPS` | painel | Um adicional não pode ter grupos de opções. |
| `AGENDAMENTO_NAO_ATENDIDO` | loja, painel | A loja não conseguiu atender no horário agendado. |
| `ANIMATED_NOT_ALLOWED` | painel | Imagens animadas (GIF) não são aceitas. Envie uma foto. |
| `BASE_MUST_BE_ONE` | painel | O grupo de preço-base precisa ter escolha única e obrigatória (mínimo 1, máximo 1). |
| `BUSY_LIMIT_REACHED` | painel | O modo ocupado vai até 4 horas seguidas. Desligue-o ou pause os pedidos. |
| `CAMPAIGN_CHANGED` | painel | A campanha foi alterada em outro lugar. Recarregue antes de salvar. |
| `CASH_ALREADY_CLOSED` | painel | Este caixa já foi fechado. |
| `CASH_CLOSED_ACK_REQUIRED` | painel | Este pedido é de um caixa já fechado. Confirme que quer mudar mesmo assim. |
| `CASH_CLOSED_OWNER_ONLY` | painel | O pedido é de um caixa fechado. Só o dono pode cancelar. |
| `CASH_PREVIEW_CHANGED` | painel | O saldo mudou. Confira os valores antes de fechar. |
| `CASH_SESSION_CHANGED` | painel | O caixa em atividade mudou. Confira antes de fechar. |
| `CASH_WITHDRAWAL_NEEDS_OWNER` | painel | Peça ao dono para autorizar essa sangria. |
| `CATEGORY_NAME_TAKEN` | painel | Já existe uma categoria com esse nome. |
| `CATEGORY_NOT_EMPTY` | painel | A categoria ainda tem produtos. Mova ou exclua os produtos antes. |
| `CONFIRMATION_REQUIRED` | painel | Sem o aceite, quem tiver o QR lança pedidos que vão direto à cozinha. Confirme para desligar. |
| `CONTACT_AUDIT_UNAVAILABLE` | painel | Não foi possível registrar o acesso ao contato. Tente de novo. |
| `CONTA_ANTIGA` | painel | O pagamento caiu em uma conta do Mercado Pago que não está mais ligada à loja. |
| `CONTA_DESCONECTADA` | painel | A conta do Mercado Pago foi desconectada. Conecte de novo em Pagamentos. |
| `CORRUPT_IMAGE` | painel | Não conseguimos abrir esta imagem. Envie outra. |
| `COUNT_CHANGED` | painel | O número de pedidos mudou desde a prévia. Confira e confirme de novo. |
| `COUPON_CODE_TAKEN` | painel | Já existe um cupom com esse código. |
| `COUPON_NEEDS_LIMIT` | painel | Cupom de 100% precisa de um limite de usos. |
| `CURSOR_INVALID` | painel | Não foi possível carregar mais itens. Atualize a página. |
| `DEVOLVIDO_NO_APP_MP` | painel | Valor devolvido pelo app do Mercado Pago. |
| `DRIVER_ERROR` | painel, impressao | A impressora deu erro. Confira se ela está ligada e com o driver instalado. |
| `DUPLICADO_OU_ERRO` | painel | Pedido duplicado ou lançado por engano. |
| `DUPLICATE_GROUP` | painel | O mesmo grupo de opções aparece duas vezes. |
| `EMPTY_ZERO_TICKET` | painel, impressao | Alerta de impressão: saiu um tíquete vazio ou com valor zero. |
| `FORA_DA_AREA` | loja, painel | Esta loja não entrega no endereço informado. |
| `IMAGE_IN_USE` | painel | A imagem está em uso. Troque-a antes de apagar. |
| `IMAGE_NOT_FOUND` | painel | Esta imagem não existe mais. Atualize a página. |
| `IMAGE_QUOTA_EXCEEDED` | painel | Você chegou ao limite de imagens. Apague as que não usa. |
| `ITEM_EM_FALTA` | loja, painel | Um item do pedido acabou. |
| `ITEM_PRICE_CHANGED` | loja, painel | O preço de um item mudou. Confira o carrinho antes de enviar. |
| `LEGACY_ADDITIONALS_READ_ONLY` | painel | Estes adicionais antigos são editados no próprio produto. |
| `LOJA_INDISPONIVEL` | loja, painel | A loja ficou indisponível e o pedido foi cancelado. |
| `LOJA_SEM_CAPACIDADE` | loja, painel | A loja não conseguiu atender este pedido agora. |
| `MAX_BELOW_MIN` | painel | O máximo não pode ser menor que o mínimo. |
| `MAX_BELOW_ONE` | painel | O máximo precisa ser pelo menos 1 (ou deixe sem limite). |
| `MODE_RECOVERED` | painel, impressao | Alerta de impressão: modo de impressão recuperado. |
| `MODE_UNCONFIRMED` | painel, impressao | Alerta de impressão: não foi possível confirmar o modo de impressão. |
| `MP_ACCOUNT_CHANGED` | painel | Este pedido foi pago em outra conta do Mercado Pago. |
| `MP_ACCOUNT_IN_USE` | painel | Esta conta do Mercado Pago já está em uso. |
| `MP_HAS_PENDING_PAYMENTS` | painel | Há pagamentos em andamento nesta conta. Aguarde eles terminarem. |
| `MP_NEEDS_RECONNECT` | painel | Conecte o Mercado Pago de novo em Pagamentos. |
| `MP_RECUSA` | painel | O Mercado Pago recusou o estorno. |
| `NAO_ATENDEU_ENDERECO` | loja, painel | A loja não conseguiu confirmar o pedido nem achar o endereço. |
| `NOTHING_TO_CHARGE_CONFLICT` | painel, impressao | Alerta de impressão: o valor a cobrar do pedido não confere. Confira no painel. |
| `NOTHING_TO_CHARGE_INVALID` | painel, impressao | Alerta de impressão: o pedido veio com informação de cobrança inválida. Confira no painel. |
| `NOTHING_TO_RECEIVE` | painel | Esta mesa não tem conta a receber. |
| `NOTHING_TO_UNDO` | painel | Não há nada para desfazer. |
| `NO_PAPER` | painel, impressao | A impressora está sem papel. |
| `OAUTH_CODE_INVALID` | painel | Não foi possível conectar o Mercado Pago. Tente de novo. |
| `OAUTH_STATE_INVALID` | painel | Não foi possível concluir a conexão. Tente de novo. |
| `OPEN_ORDERS` | painel | O cliente tem pedido em andamento. Conclua ou cancele antes. |
| `OPTIONS_AMBIGUOUS` | loja, painel | As opções do item vieram repetidas. Escolha de novo. |
| `OPTIONS_TOO_MANY` | loja, painel | Este item tem opções demais. Desmarque alguma. |
| `OPTION_ADDON_IN_BASE_GROUP` | painel | Um adicional não pode ser variação de preço-base. |
| `OPTION_INVALID` | loja, painel | Uma das opções escolhidas não vale para este item. Escolha de novo. |
| `OPTION_PRODUCT_BY_WEIGHT` | painel | Um adicional vendido por peso não pode virar opção. |
| `OPTION_PRODUCT_NOT_ADDON` | painel | Só produtos do tipo Adicional podem entrar em um grupo de opções. |
| `ORDER_ALREADY_ACCEPTED` | loja | A loja já aceitou o pedido. Para mudar algo, fale com ela. |
| `ORDER_ALREADY_RECEIVED` | painel | Este pedido já foi recebido na mesa e não pode ser cancelado. |
| `ORDER_AWAITING_PAYMENT` | painel | O pedido aguarda o pagamento e ainda não foi para a cozinha. |
| `ORDER_VALUE_TOO_HIGH` | loja, painel | O pedido passou do valor máximo. Divida em pedidos menores. |
| `OTHER` | painel, impressao | A impressora deu um erro desconhecido. |
| `PAGAMENTO_ANTIGO` | painel | Este pagamento é antigo demais para devolver pelo sistema. Devolva pelo Mercado Pago. |
| `PAGAMENTO_ESTORNADO_NO_PROVEDOR` | loja, painel | O pagamento foi estornado e o pedido foi cancelado. |
| `PAYMENTS_DISABLED` | painel | O recebimento por Pix ainda não está disponível. |
| `PAYMENT_ACCOUNT_NOT_FOUND` | painel | Não há conta do Mercado Pago conectada. |
| `PAYMENT_PROVIDER_UNAVAILABLE` | painel | Não foi possível conectar o Mercado Pago agora. Tente de novo. |
| `PENDING_ORDERS` | painel | Aceite ou recuse os pedidos pendentes da mesa antes de receber. |
| `PHONE_INVALID` | painel | Telefone incompleto. Informe com DDD. |
| `PRINTER_NOT_FOUND` | painel, impressao | Esta impressora não está mais cadastrada. |
| `PRINTER_OFFLINE` | painel, impressao | Impressora desligada ou sem conexão. |
| `PRINT_IN_PROGRESS` | painel | Há impressão em andamento. Tente em instantes. |
| `PRINT_JOB_NOT_FOUND` | painel, impressao | Esta impressão não existe mais. |
| `PRINT_JOB_NOT_STALE` | painel | Esta impressão não está parada na fila. |
| `PRINT_JOB_WITHOUT_ORDER` | impressao | Esta impressão não tem pedido ligado. |
| `PRINT_LEASE_LOST` | impressao | Esta impressão passou para outra impressora. |
| `PRINT_MODE_LEGACY` | painel, impressao | A impressão pela fila não está ligada. Peça ao dono para ligar. |
| `PRIVACY_NOT_CONFIGURED` | painel | A área de privacidade ainda não está configurada. |
| `PRODUCT_ADDON_NOT_SOLD_ALONE` | loja, painel | Este adicional não é vendido sozinho. |
| `PRODUCT_WEIGHT_NO_OPTIONS` | loja, painel | Produto vendido por peso não aceita opções. |
| `PROMO_NOT_ALLOWED` | painel | Este produto não pode ter promoção. |
| `REASON_INVALID` | painel | Escolha um dos motivos da lista. |
| `REFUND_PENDING` | painel | Há um estorno em andamento neste pedido. |
| `REFUND_REQUIRED` | painel | Este pedido foi pago. Cancele informando o motivo para devolver o Pix. |
| `REFUND_STILL_POSSIBLE` | painel | A devolução ainda pode dar certo. Tente de novo. |
| `REPRINT_LIMIT` | painel | Este pedido já foi reimpresso o máximo de vezes. |
| `SAME_CATEGORY` | painel | Os produtos já estão nesta categoria. Escolha outra. |
| `SEARCH_TOO_SHORT` | painel | Digite ao menos 2 caracteres. |
| `SESSION_EXPIRED` | painel | Sua sessão expirou. Entre de novo. |
| `SESSION_INVALID` | painel | Sua sessão não vale mais. Entre de novo. |
| `SESSION_REVOKED` | painel | Sua sessão foi encerrada. Entre de novo. |
| `SKU_TAKEN` | painel | Este código de produto já está em uso. |
| `STORE_BUSY` | loja | A loja está cheia de pedidos agora. Tente de novo daqui a pouco. |
| `STORE_NOT_FOUND` | painel | Não encontramos esta loja. |
| `TABLE_HAS_ORDERS` | painel | Esta mesa tem pedidos. Desative a mesa em vez de apagar. |
| `TABLE_LABEL_TAKEN` | painel | Já existe uma mesa com esse nome. |
| `TARGET_REQUIRED` | painel | Informe o telefone ou o código do pedido. |
| `TEXT_TOO_LONG` | loja, painel | O texto passou do limite de caracteres. Encurte um pouco. |
| `TIMEZONE_INVALID` | painel | Escolha um fuso horário da lista. |
| `TOO_MANY_PIXELS` | painel | A imagem tem resolução grande demais. Envie uma menor. |
| `TOTAL_CHANGED` | painel | A conta da mesa mudou. Confira o novo total. |
| `UNDO_WINDOW_EXPIRED` | painel | Já passou o prazo para desfazer. |
| `WEIGHT_NOT_ALLOWED` | loja, painel | Este produto não é vendido por peso. |
| `WEIGHT_QUANTITY_INVALID` | loja, painel | Produto por peso vai em uma única pesagem. Ajuste o peso em vez da quantidade. |
| `WEIGHT_REQUIRED` | loja, painel | Informe o peso. |
