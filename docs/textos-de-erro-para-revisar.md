# Textos de erro para revisar (SSOT D6)

Gerado por `node scripts/textos-de-erro.mjs` a partir de `packages/shared-types/src/errorMessages.ts`. **254 de 254 textos ainda em rascunho.**

**Como revisar:** para cada linha, aprove o texto ou escreva o novo na coluna *Texto final*. Depois o dev troca no catálogo `e("...")` por
`ok("texto final")`. A partir daí, painel e cardápio passam a mostrar o texto aprovado (em vez do texto técnico que a API manda hoje).

Regras de escrita sugeridas: falar com a pessoa ("Informe...", "Escolha..."), dizer o que fazer em seguida, sem jargão (nada de "inválido" sozinho
quando dá para dizer o que está errado), no máximo uma frase curta. **loja** = cliente final no cardápio; **painel** = dono e equipe.

| Código | Onde aparece | Texto atual (rascunho) | Texto final |
|---|---|---|---|
| `ADDRESS_REQUIRED` | loja | Informe o endereço de entrega. | |
| `ALREADY_SUSPENDED` | painel | A loja já está suspensa. | |
| `BASE_PRICE_ZERO` | painel | O preço base não pode ser zero. | |
| `BUSY_DURATION_INVALID` | painel | Duração do modo ocupado inválida. | |
| `CAPTCHA_REQUIRED` | loja, painel | Confirme que você não é um robô. | |
| `DISCOUNT_TOO_HIGH` | painel | O desconto não pode zerar a conta. | |
| `PAYMENTS_MISMATCH` | painel | A soma das formas de pagamento não bate com o total. | |
| `SERVICE_FEE_DISABLED` | painel | Esta loja não cobra taxa de serviço. | |
| `SCHEDULE_NOT_ALLOWED` | loja | Este tipo de pedido não pode ser agendado. | |
| `SCHEDULE_OUTSIDE_HOURS` | loja | A loja não atende nesse horário. | |
| `SCHEDULE_TOO_FAR` | loja | Escolha um horário mais próximo. | |
| `SCHEDULE_TOO_SOON` | loja | Escolha um horário com mais antecedência. | |
| `SCHEDULING_UNAVAILABLE` | loja | Esta loja não aceita pedidos agendados. | |
| `INGREDIENT_LIMIT_REACHED` | painel | A loja atingiu o máximo de insumos. | |
| `INGREDIENT_NAME_TAKEN` | painel | Já existe um insumo com esse nome. | |
| `INGREDIENT_NOT_FOUND` | painel | Insumo não encontrado. | |
| `CASH_ALREADY_OPEN` | painel | Já existe um caixa aberto. | |
| `CASH_COUNTED_REQUIRED` | painel | Informe o valor contado no caixa. | |
| `CASH_REQUIRED` | painel | Abra o caixa para continuar. | |
| `CHANGE_ONLY_CASH` | loja, painel | Troco só vale para pagamento em dinheiro. | |
| `CHANGE_TOO_LOW` | loja, painel | O valor para troco é menor que o total. | |
| `CLIENTE_DESISTIU` | loja, painel | Cancelamento solicitado pelo cliente. | |
| `COUPON_CODE_INVALID` | painel | Código de cupom inválido. | |
| `COUPON_EXHAUSTED` | loja | Este cupom atingiu o limite de usos. | |
| `COUPON_EXPIRED` | loja | Este cupom expirou. | |
| `COUPON_EXPIRY_INVALID` | painel | Data de validade do cupom inválida. | |
| `COUPON_INVALID` | loja | Cupom inválido. | |
| `COUPON_MIN_ORDER` | loja | O pedido não atinge o mínimo para este cupom. | |
| `COUPON_VALUE_INVALID` | painel | Valor do cupom inválido. | |
| `CREDIT_LIMIT_EXCEEDED` | painel | Limite de crédito excedido. | |
| `CREDIT_NEGATIVE_BALANCE` | painel | O saldo de crédito ficaria negativo. | |
| `CUSTOM_DOMAIN_TAKEN` | painel | Este domínio já está em uso. | |
| `DELIVERY_DISABLED` | loja | A entrega está desativada. | |
| `DELIVERY_FEE_CHANGED` | loja | A taxa de entrega mudou. Confira o novo total. | |
| `DISCOUNT_ABOVE_LIMIT` | painel | O desconto passa do limite permitido. | |
| `EMAIL_IN_USE` | painel | Este e-mail já está em uso. | |
| `EMAIL_NOT_SENT` | painel, email | Não foi possível enviar o e-mail. | |
| `EMAIL_NOT_VERIFIED` | painel | Confirme seu e-mail para continuar. | |
| `ESTORNO_MANUAL` | loja, painel | Pedido cancelado pela loja. | |
| `ESTORNO_NAO_CONCLUIDO` | loja, painel | Seu pedido foi cancelado. A loja entrará em contato sobre a devolução. | |
| `FEATURE_ALREADY_AVAILABLE` | painel | Este recurso já está disponível no seu plano. | |
| `FEATURE_DISABLED` | painel | Este recurso está desativado. | |
| `FEATURE_LOCKED` | painel | Recurso não incluído no seu plano. | |
| `FILE_REQUIRED` | painel | Envie um arquivo. | |
| `FILE_TOO_LARGE` | painel | O arquivo é grande demais. | |
| `FILTER_INVALID` | painel | Filtro inválido. | |
| `FORBIDDEN_ROLE` | painel | Você não tem permissão para esta ação. | |
| `IDEMPOTENCY_KEY_INVALID` | loja, painel | Chave de idempotência inválida. | |
| `IDEMPOTENCY_KEY_REUSED` | loja, painel | Esta requisição já foi usada com outros dados. | |
| `INVALID_KIND` | painel | Tipo de imagem inválido. Use produto, logo ou capa. | |
| `INVALID_TABLE` | loja | Mesa inválida. | |
| `INVALID_TRANSITION` | painel | Não é possível mudar o pedido para este status. | |
| `ITEM_UNAVAILABLE` | loja | Um item do pedido não está disponível. | |
| `LIMIT_REACHED` | painel | Limite do plano atingido. | |
| `LOGIN_LOCKED` | painel | Login bloqueado temporariamente. Tente mais tarde. | |
| `MFA_EXPIRED` | painel | O código de verificação expirou. | |
| `MFA_INVALID` | painel | Código de verificação inválido. | |
| `MFA_LOCKED` | painel | Verificação bloqueada. Tente mais tarde. | |
| `MFA_REQUIRED` | painel | Informe o código de verificação. | |
| `MIN_ABOVE_ACTIVE_OPTIONS` | painel | O mínimo é maior que as opções ativas. | |
| `MIN_ORDER` | loja | Pedido abaixo do valor mínimo. | |
| `MODE_QUEUE` | impressao | Esta loja imprime pela fila. | |
| `NEIGHBORHOOD_NOT_FOUND` | loja | Bairro não encontrado. | |
| `NEIGHBORHOOD_REQUIRED` | loja | Informe o bairro. | |
| `NEIGHBORHOOD_UNAVAILABLE` | loja | Não entregamos neste bairro. | |
| `NOT_AWAITING_PAYMENT` | painel | O pedido não está aguardando pagamento. | |
| `NOT_FOUND` | loja, painel | Não encontrado. | |
| `NOT_IN_TRIAL` | painel | A loja não está em período de teste. | |
| `NOT_SUSPENDED` | painel | A loja não está suspensa. | |
| `NOTE_TOO_LONG` | loja, painel | A observação é longa demais. | |
| `OPENING_HOURS_DERIVED` | painel | O texto de horário foi ignorado: vale a grade. Edite em Horário de funcionamento. | |
| `OPTION_DUPLICATE` | loja, painel | Opção repetida. | |
| `OPTION_MAX_EXCEEDED` | loja | Você escolheu opções demais. | |
| `OPTION_NOT_FOUND` | loja | Opção não encontrada. | |
| `OPTION_PER_OPTION_MAX` | loja | Quantidade máxima desta opção excedida. | |
| `OPTION_QUANTITY_INVALID` | loja | Quantidade da opção inválida. | |
| `OPTION_REQUIRED` | loja | Escolha uma opção obrigatória. | |
| `ORDER_NOT_FOUND` | loja, painel | Pedido não encontrado. | |
| `ORIGIN_MISMATCH` | painel | Origem não permitida. | |
| `OUTRO` | loja, painel | Pedido cancelado pela loja. | |
| `PAGAMENTO_APOS_CANCELAMENTO` | loja, painel | O pagamento chegou depois do cancelamento do pedido. | |
| `PAGAMENTO_NAO_APROVADO` | loja, painel, whatsapp | Pagamento não aprovado. | |
| `PASSWORD_INVALID` | painel | Senha inválida. | |
| `PAYMENT_METHOD_REQUIRED` | loja | Escolha a forma de pagamento. | |
| `PHONE_REQUIRED` | loja | Informe o telefone. | |
| `PICKUP_DISABLED` | loja | A retirada está desativada. | |
| `PIX_UNAVAILABLE` | loja | Pix indisponível no momento. | |
| `PLATFORM_ROLE_REQUIRED` | painel | Ação restrita à plataforma. | |
| `PRODUCT_NOT_FOUND` | loja, painel | Produto não encontrado. | |
| `PRODUCT_UNAVAILABLE_BY_RULE` | loja | Produto indisponível neste momento. | |
| `QR_ORDERING_DISABLED` | loja | Pedidos por QR code desativados. | |
| `QUEUE_WITHOUT_PRINTER` | painel | Fila ativa sem impressora configurada. | |
| `RATE_LIMITED` | loja, painel | Muitas tentativas. Aguarde um pouco. | |
| `READ_ONLY` | painel | Conta em modo somente leitura. | |
| `REAUTH_FAILED` | painel | Falha ao confirmar sua identidade. | |
| `REAUTH_REQUIRED` | painel | Confirme sua senha para continuar. | |
| `REPORT_RANGE_INVALID` | painel | Período do relatório inválido. | |
| `REPORT_TOO_LARGE` | painel | Relatório grande demais. Reduza o filtro. | |
| `REPORT_WINDOW_TOO_LARGE` | painel | Período do relatório muito longo. | |
| `SERVER_BUSY` | loja, painel | Servidor ocupado. Tente novamente. | |
| `SLUG_INVALID` | painel | Endereço da loja inválido. | |
| `SLUG_RESERVED` | painel | Este endereço é reservado. | |
| `STEP_AUTOMATIC` | painel | Este passo é concluído sozinho quando a loja tem os dados. | |
| `STORE_CLOSED` | loja | A loja está fechada. | |
| `STORE_IN_USE` | painel | O endereço ou o código da loja já está em uso. | |
| `STORE_SUSPENDED` | loja, painel | Loja suspensa. | |
| `STORE_UNAVAILABLE` | loja | Loja indisponível. | |
| `SUBSCRIPTION_INACTIVE` | painel | Assinatura inativa. | |
| `SUSPENDED` | painel | Conta suspensa. | |
| `TABLE_BUSY` | loja, painel | A mesa está ocupada. | |
| `TABLE_NOT_FOUND` | loja, painel | Mesa não encontrada. | |
| `TABLE_REQUIRED` | loja | Informe a mesa. | |
| `TESTE` | painel | Mensagem de teste. | |
| `TOO_MANY_GROUPS` | painel | Grupos de opções demais. | |
| `TWO_BASE_GROUPS` | painel | Só é permitido um grupo base. | |
| `UNSUPPORTED_TYPE` | painel | Tipo de arquivo não suportado. | |
| `VALIDATION_ERROR` | loja, painel | Dados inválidos. Confira os campos. | |
| `VERIFY_RESEND_LIMITED` | painel, email | Aguarde para reenviar a verificação. | |
| `VERIFY_TOKEN_INVALID` | painel, email | Link de verificação inválido ou expirado. | |
| `WEIGHT_OUT_OF_RANGE` | loja | Peso fora do intervalo permitido. | |
| `WEIGHT_STEP_INVALID` | loja | Peso fora do passo permitido. | |
| `ZONE_DUPLICATE` | painel | Zona de entrega duplicada. | |
| `ZONE_LIMIT` | painel | Limite de zonas de entrega atingido. | |
| `ACERTADO_COM_CLIENTE` | painel | Devolução acertada direto com o cliente. | |
| `ADDITIONAL_NOT_FOUND` | loja, painel | Um adicional não pertence a este produto. | |
| `ADDON_HAS_GROUPS` | painel | Um adicional não tem grupos de opções. | |
| `ADDON_IN_USE` | painel | Este adicional está em uso. Remova-o dos grupos primeiro. | |
| `AGENDAMENTO_NAO_ATENDIDO` | loja, painel | A loja não conseguiu atender no horário agendado. | |
| `ANIMATED_NOT_ALLOWED` | painel | Imagem animada não é aceita. | |
| `AUDIT_UNAVAILABLE` | painel | Busca por telefone indisponível agora. Busque pelo código ou nome, ou tente mais tarde. | |
| `BASE_MUST_BE_ONE` | painel | Grupo de preço-base é de escolha única e obrigatória (mínimo 1, máximo 1). | |
| `BUSY_LIMIT_REACHED` | painel | Limite de 4 horas seguidas atingido. Desligue o modo ocupado ou o recebimento de pedidos. | |
| `CAMPAIGN_CHANGED` | painel | A campanha mudou. Recarregue antes de salvar. | |
| `CAMPAIGN_INVALID` | painel | Campanha inválida. | |
| `CASH_ALREADY_CLOSED` | painel | Este caixa já foi fechado. | |
| `CASH_CLOSED_ACK_REQUIRED` | painel | Confirme que entende que isso afeta o caixa já fechado. | |
| `CASH_CLOSED_OWNER_ONLY` | painel | O pedido é de um caixa fechado. Só o dono pode cancelar. | |
| `CASH_PREVIEW_CHANGED` | painel | O saldo mudou. Confira os valores antes de fechar. | |
| `CASH_REASON_INVALID` | painel | Motivo inválido para esta operação. | |
| `CASH_REASON_REQUIRED` | painel | Informe o motivo. | |
| `CASH_SESSION_CHANGED` | painel | O caixa em atividade mudou. Confira antes de fechar. | |
| `CASH_WITHDRAWAL_EXCEEDS_BALANCE` | painel | A sangria passa do dinheiro em caixa. | |
| `CASH_WITHDRAWAL_NEEDS_OWNER` | painel | Peça ao dono para autorizar essa sangria. | |
| `CATEGORY_LIMIT_REACHED` | painel | A loja atingiu o máximo de categorias. | |
| `CATEGORY_NAME_TAKEN` | painel | Já existe uma categoria com esse nome. | |
| `CATEGORY_NOT_EMPTY` | painel | A categoria não está vazia. | |
| `CONFIRMATION_REQUIRED` | painel | Sem o aceite, quem tiver o QR lança pedidos que vão direto à cozinha. Confirme para desligar. | |
| `CONTACT_AUDIT_UNAVAILABLE` | painel | Não foi possível registrar o acesso ao contato. Tente de novo. | |
| `CONTA_ANTIGA` | painel | Pagamento recebido em uma conta antiga. | |
| `CONTA_DESCONECTADA` | painel | A conta de pagamento está desconectada. | |
| `CORRUPT_IMAGE` | painel | Imagem corrompida ou ilegível. | |
| `COUNT_CHANGED` | painel | O número de pedidos mudou desde a prévia. Confira e confirme de novo. | |
| `COUPON_CODE_TAKEN` | painel | Já existe um cupom com esse código. | |
| `COUPON_NEEDS_LIMIT` | painel | Cupom de 100% precisa de limite de usos. | |
| `CURSOR_INVALID` | painel | Não foi possível carregar a próxima página. | |
| `DEVOLVIDO_NO_APP_MP` | painel | Valor devolvido pelo app do Mercado Pago. | |
| `DRIVER_ERROR` | painel, impressao | Erro no driver da impressora. | |
| `DUPLICADO_OU_ERRO` | painel | Pedido duplicado ou lançado por engano. | |
| `DUPLICATE_GROUP` | painel | O mesmo grupo foi enviado mais de uma vez. | |
| `EMPTY_ZERO_TICKET` | painel, impressao | Alerta de impressão: tíquete vazio ou zerado. | |
| `FORA_DA_AREA` | loja, painel | Esta loja não entrega no endereço informado. | |
| `IMAGE_IN_USE` | painel | A imagem está em uso. Troque-a antes de apagar. | |
| `IMAGE_NOT_FOUND` | painel | Imagem não encontrada. | |
| `IMAGE_QUOTA_EXCEEDED` | painel | Limite de imagens atingido. Remova as que não usa. | |
| `ITEM_EM_FALTA` | loja, painel | Item indisponível no momento. | |
| `ITEM_PRICE_CHANGED` | loja, painel | O preço de um item mudou. Confira o carrinho. | |
| `LEGACY_ADDITIONALS_READ_ONLY` | painel | Edite os adicionais antigos no próprio produto. | |
| `LOJA_INDISPONIVEL` | loja, painel | A loja ficou indisponível e o pedido foi cancelado. | |
| `LOJA_SEM_CAPACIDADE` | loja, painel | A loja não conseguiu atender este pedido agora. | |
| `MAX_BELOW_MIN` | painel | O máximo não pode ser menor que o mínimo. | |
| `MAX_BELOW_ONE` | painel | O máximo precisa ser pelo menos 1 (ou sem limite). | |
| `MODE_RECOVERED` | painel, impressao | Alerta de impressão: modo de impressão recuperado. | |
| `MODE_UNCONFIRMED` | painel, impressao | Alerta de impressão: modo de impressão não confirmado. | |
| `MP_ACCOUNT_CHANGED` | painel | Este pedido foi pago em outra conta do Mercado Pago. | |
| `MP_ACCOUNT_IN_USE` | painel | Esta conta do Mercado Pago já está em uso. | |
| `MP_HAS_PENDING_PAYMENTS` | painel | Há pagamentos em andamento nesta conta. | |
| `MP_NEEDS_RECONNECT` | painel | Refaça a conexão com o Mercado Pago. | |
| `MP_RECUSA` | painel | O Mercado Pago recusou o estorno. | |
| `NAO_ATENDEU_ENDERECO` | loja, painel | Não foi possível confirmar o pedido ou localizar o endereço. | |
| `NOTHING_TO_CHARGE_CONFLICT` | painel, impressao | Alerta de impressão: divergência em pedido sem valor a cobrar. | |
| `NOTHING_TO_CHARGE_INVALID` | painel, impressao | Alerta de impressão: indicação inválida de pedido sem cobrança. | |
| `NOTHING_TO_RECEIVE` | painel | Esta mesa não tem conta a receber. | |
| `NOTHING_TO_UNDO` | painel | Não há ação para desfazer. | |
| `NOT_REFUND_PENDING` | painel | Este estorno não tem um cancelamento associado. | |
| `NO_PAPER` | painel, impressao | Impressora sem papel. | |
| `OAUTH_CODE_INVALID` | painel | Não foi possível conectar o Mercado Pago. Tente de novo. | |
| `OAUTH_STATE_INVALID` | painel | Não foi possível concluir a conexão. Tente de novo. | |
| `OPEN_ORDERS` | painel | O cliente tem pedido em andamento. Conclua ou cancele antes. | |
| `OPTIONS_AMBIGUOUS` | loja, painel | As opções do item foram enviadas em formato duplicado. | |
| `OPTIONS_TOO_MANY` | loja, painel | Há opções demais neste item. | |
| `OPTION_ADDON_IN_BASE_GROUP` | painel | Adicional não pode ser variação de preço-base. | |
| `OPTION_GROUP_INVALID` | painel | Grupo de opções inválido. | |
| `OPTION_INVALID` | loja, painel | As opções escolhidas não são válidas. | |
| `OPTION_PRODUCT_BY_WEIGHT` | painel | Adicional vendido por peso não pode ser opção. | |
| `OPTION_PRODUCT_NOT_ADDON` | painel | Só um produto do tipo Adicional pode ser ligado a um grupo. | |
| `ORDER_ALREADY_ACCEPTED` | loja | A loja já aceitou o pedido. Fale com ela. | |
| `ORDER_ALREADY_RECEIVED` | painel | Pedido já recebido na mesa não pode ser cancelado. | |
| `ORDER_AWAITING_PAYMENT` | painel | Pedido aguardando pagamento: ainda não foi para a cozinha. | |
| `ORDER_CANCELED` | painel | Pedido cancelado: não há o que reimprimir. | |
| `ORDER_STATE_CHANGED` | painel | O pedido mudou. Atualize a tela. | |
| `ORDER_VALUE_TOO_HIGH` | loja, painel | O pedido excede o limite de valor. Divida em pedidos menores. | |
| `OTHER` | painel, impressao | Outra falha de impressão. | |
| `PAGAMENTO_ANTIGO` | painel | Pagamento antigo demais para estorno automático. | |
| `PAGAMENTO_ESTORNADO_NO_PROVEDOR` | loja, painel | O pagamento foi estornado e o pedido foi cancelado. | |
| `PAYMENTS_DISABLED` | painel | O recebimento por Pix ainda não está disponível neste ambiente. | |
| `PAYMENT_ACCOUNT_NOT_FOUND` | painel | Não há conta do Mercado Pago conectada. | |
| `PAYMENT_PROVIDER_UNAVAILABLE` | painel | Não foi possível conectar o Mercado Pago agora. Tente de novo. | |
| `PENDING_ORDERS` | painel | Aceite ou recuse os pedidos pendentes da mesa antes de receber. | |
| `PERIOD_INVALID` | painel | Informe a data inicial e a final. | |
| `PERIOD_TOO_LONG` | painel | O período escolhido é longo demais. | |
| `PHONE_INVALID` | painel | Telefone inválido. | |
| `PRINTER_NOT_FOUND` | painel, impressao | Impressora não encontrada. | |
| `PRINTER_OFFLINE` | painel, impressao | Impressora desligada ou sem conexão. | |
| `PRINT_IN_PROGRESS` | painel | Há impressão em andamento. Tente em instantes. | |
| `PRINT_JOB_NOT_FOUND` | painel, impressao | Trabalho de impressão não encontrado. | |
| `PRINT_JOB_NOT_STALE` | painel | Este trabalho não está esperando para imprimir. | |
| `PRINT_JOB_WITHOUT_ORDER` | impressao | Trabalho de impressão sem pedido. | |
| `PRINT_LEASE_LOST` | impressao | Este trabalho não está mais com esta impressora. | |
| `PRINT_MODE_LEGACY` | painel, impressao | A impressão por fila não está ativa. Peça ao dono para ativar. | |
| `PRIVACY_NOT_CONFIGURED` | painel | Privacidade indisponível: configuração incompleta. | |
| `PRODUCT_ADDON_NOT_SOLD_ALONE` | loja, painel | Este adicional não é vendido sozinho. | |
| `PRODUCT_IN_OPEN_ORDERS` | painel | O produto está em pedidos abertos. Oculte em vez de excluir. | |
| `PRODUCT_LIMIT_REACHED` | painel | A loja atingiu o máximo de produtos. | |
| `PRODUCT_WEIGHT_NO_OPTIONS` | loja, painel | Produto vendido por peso não aceita opções. | |
| `PROMO_EXPIRY_INVALID` | painel | Data final da promoção inválida. | |
| `PROMO_INVALID` | painel | Promoção inválida. Confira o preço e as datas. | |
| `PROMO_NOT_ALLOWED` | painel | Este produto não aceita promoção. | |
| `REASON_INVALID` | painel | Motivo de cancelamento inválido. | |
| `REASON_REQUIRED` | painel | Informe o motivo do cancelamento. | |
| `REFUND_PENDING` | painel | Há um estorno em andamento neste pedido. | |
| `REFUND_REQUIRED` | painel | Pedido pago: cancele informando o motivo, o que estorna o Pix. | |
| `REFUND_STILL_POSSIBLE` | painel | O estorno ainda pode ser concluído. Tente de novo. | |
| `REPRINT_LIMIT` | painel | Limite de reimpressões deste pedido atingido. | |
| `SAME_CATEGORY` | painel | Escolha outra categoria de destino. | |
| `SCHEDULE_INVALID` | painel | Horário inválido. | |
| `SEARCH_TOO_SHORT` | painel | Digite ao menos 2 caracteres. | |
| `SESSION_EXPIRED` | painel | Sua sessão expirou. Entre de novo. | |
| `SESSION_INVALID` | painel | Sessão inválida. Entre de novo. | |
| `SESSION_REVOKED` | painel | Sua sessão foi encerrada. Entre de novo. | |
| `SKU_TAKEN` | painel | Este código já está em uso. | |
| `STORAGE_UNAVAILABLE` | painel | Não foi possível guardar a imagem agora. Tente de novo. | |
| `STORE_BUSY` | loja | A loja está lotada no momento. Tente mais tarde. | |
| `STORE_NOT_FOUND` | painel | Loja não encontrada. | |
| `TABLE_HAS_ORDERS` | painel | A mesa tem pedidos. Desative em vez de apagar. | |
| `TABLE_LABEL_TAKEN` | painel | Já existe uma mesa com esse nome. | |
| `TARGET_REQUIRED` | painel | Informe o telefone ou o código do pedido. | |
| `TEXT_TOO_LONG` | loja, painel | O texto passou do limite de caracteres. | |
| `TOO_MANY_OPTIONS` | painel | O grupo passou do limite de opções. | |
| `TOO_MANY_PIXELS` | painel | A resolução da imagem é grande demais. | |
| `TOTAL_CHANGED` | painel | A conta da mesa mudou. Confira o novo total. | |
| `UNDO_WINDOW_EXPIRED` | painel | O prazo para desfazer acabou. | |
| `WEIGHT_NOT_ALLOWED` | loja, painel | Este produto não é vendido por peso. | |
| `WEIGHT_QUANTITY_INVALID` | loja, painel | Produto por peso é pedido em uma só pesagem. | |
| `WEIGHT_REQUIRED` | loja, painel | Informe o peso. | |
