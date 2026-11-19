// DADOS i1: o DICIONÁRIO de métricas (Leonardo, ESPECIFICACAO-DADOS-CLIENTE.md §2, M01..M27). Cada indicador é definido UMA vez, aqui;
// a rota GET /api/reports/dictionary o devolve e o web só renderiza (nenhum rótulo, fórmula ou aviso inventado na tela).
// Faixas (decisão do Claudio, 19/11): pico por hora e por dia da semana = BASICO; novos×recorrentes, tempos, por mesa = PRO; lucro = DEPOIS.
import type { MetricDefinition, MetricDictionary } from "@meucardapio/shared-types";

type Row = [id: string, name: string, definition: string, notMeaning: string, incompleteWhen: string[], plan: MetricDefinition["plan"], state: MetricDefinition["state"]];

const ROWS: Row[] = [
  ["M01", "Pedidos", "Quantidade de pedidos que contam como venda no período.", "Não inclui \"Aguardando aceite\" nem cancelados.", ["PERIODO_EM_ANDAMENTO", "TETO_ATINGIDO"], "BASICO", "EXISTE"],
  ["M02", "Vendas", "Soma de (total do pedido − gorjeta) das vendas.", "Não é dinheiro recebido nem lucro; inclui taxa de entrega e já desconta cupom.", ["PERIODO_EM_ANDAMENTO", "TETO_ATINGIDO"], "BASICO", "EXISTE"],
  ["M03", "Valor total dos pedidos", "Soma do total do pedido, com gorjeta.", "A gorjeta não é da loja como venda; é a visão bruta.", ["PERIODO_EM_ANDAMENTO", "TETO_ATINGIDO"], "BASICO", "EXISTE"],
  ["M04", "Recebido", "Dinheiro e demais formas efetivamente recebidos, por data de recebimento.", "Pode ser diferente das Vendas do mesmo dia (PIX, entrega paga depois).", ["PERIODO_EM_ANDAMENTO"], "BASICO", "EXISTE"],
  ["M05", "Ticket médio", "Vendas (R$) ÷ Pedidos, arredondado ao centavo.", "Inclui vendas de R$ 0,00 (mostra o custo real do cupom).", [], "BASICO", "EXISTE"],
  ["M06", "Descontos", "Soma do desconto de cupom + desconto manual.", "Promoção (preço de/por) não conta como desconto.", [], "BASICO", "EXISTE"],
  ["M07", "Taxas de entrega", "Soma das taxas de entrega das vendas.", "Já estão dentro das Vendas; não somar de novo.", [], "BASICO", "EXISTE"],
  ["M08", "Gorjetas", "Soma das gorjetas das vendas.", "Já estão dentro do total do pedido; não somar de novo.", [], "BASICO", "EXISTE"],
  ["M09", "Clientes (estimativa)", "Clientes distintos por telefone normalizado nas vendas do período.", "Não é cadastro; o mesmo cliente com 2 telefones conta 2; clientes anonimizados saem.", ["ANONIMIZADOS"], "BASICO", "EXISTE"],
  ["M10", "Novos × recorrentes", "Novo = sem venda antes do início do período; recorrente = com venda antes.", "Depende do telefone; sem telefone é \"não identificado\".", ["ANONIMIZADOS"], "PRO", "NOVO"],
  ["M11", "Pico por hora", "Pedidos e vendas por hora local da loja (0 a 23).", "Não é capacidade da cozinha.", ["PERIODO_EM_ANDAMENTO"], "BASICO", "NOVO"],
  ["M12", "Pico por dia da semana", "Pedidos e vendas por dia da semana local da loja (segunda a domingo).", "A semana começa na segunda.", ["PERIODO_EM_ANDAMENTO"], "BASICO", "NOVO"],
  ["M13", "Comparativo com o período anterior", "Período anterior = mesmo número de dias imediatamente antes; variação = (atual − anterior) ÷ anterior; anterior zero = \"novo\", sem %. Hoje compara com o mesmo dia da semana passado, até a mesma hora.", "Períodos de vários dias comparam com o período imediatamente anterior de mesmo tamanho.", ["REGRA_MUDOU", "PERIODO_EM_ANDAMENTO"], "BASICO", "EXISTE"],
  ["M14", "Canal de origem", "Vendas por origem do pedido: cardápio, QR da mesa, painel, WhatsApp (futuro).", "Diferente de tipo de atendimento.", [], "PRO", "NOVO"],
  ["M15", "Tipo de atendimento", "Vendas por entrega, retirada e mesa.", "Não é canal de origem.", [], "BASICO", "EXISTE"],
  ["M16", "Formas de pagamento", "Vendas e valor por forma declarada no pedido, com \"Sem cobrança\" e \"Não identificado\".", "Não é recebimento confirmado (isso é Recebido).", [], "BASICO", "EXISTE"],
  ["M17", "Cupons", "Usos, desconto total e vendas com cupom.", "Cupom e desconto manual são separados.", [], "BASICO", "PARCIAL"],
  ["M18", "Cancelamentos", "Quantidade e valor de cancelados; taxa = cancelados ÷ (vendas + cancelados); por motivo.", "Cancelado não é venda; pagamento PIX expirado entra à parte.", ["TETO_ATINGIDO"], "BASICO", "PARCIAL"],
  ["M19", "Estornos", "Pendentes, concluídos e presos (contagem e valor), por data.", "Não é cancelamento.", [], "BASICO", "NOVO"],
  ["M20", "Tempos médios", "Preparo, entrega e total (média e mediana), só de pedidos concluídos.", "Não mede promessa de prazo; pedido sem histórico de etapa fica de fora.", ["SEM_HISTORICO"], "PRO", "NOVO"],
  ["M21", "Produtos mais vendidos", "Por produto: quantidade, receita com opções e categoria; por peso mostra pedidos e kg.", "A receita por produto não fecha com as Vendas (taxa, gorjeta e desconto ficam de fora).", ["TETO_ATINGIDO"], "BASICO", "PARCIAL"],
  ["M22", "Produtos que vendem pouco ou nada", "Produtos ativos com menos de N vendas (padrão 3) ou nenhuma no período.", "Produto oculto ou esgotado não entra.", [], "BASICO", "NOVO"],
  ["M23", "Entregadores", "Pedidos e valor por entregador.", "Não mede custo nem pontualidade.", ["SEM_HISTORICO"], "BASICO", "EXISTE"],
  ["M24", "Caixa", "Esperado, contado e diferença por sessão de caixa.", "Não é faturamento; a diferença é só do dono.", [], "BASICO", "EXISTE"],
  ["M25", "Por mesa", "Pedidos, vendas e tempo entre o 1º pedido e o recebimento por mesa.", "Não é tempo de ocupação medido.", ["SEM_HISTORICO"], "PRO", "NOVO"],
  ["M26", "Operação agora", "Aguardando aceite, em preparo, abertos de dias anteriores, PIX aguardando e esgotados hoje (contagem real no banco).", "É o retrato do momento, não uma série histórica.", [], "BASICO", "EXISTE"],
  ["M27", "Lucro e margem", "Não existe: exige ficha técnica e custo.", "Faturamento não é lucro.", [], "DEPOIS", "NOVO"],
];

export const METRICS: MetricDefinition[] = ROWS.map(([id, name, definition, notMeaning, incompleteWhen, plan, state]) => ({
  id, name, definition, notMeaning, incompleteWhen, timezone: "STORE" as const, plan, state,
}));
export const METRIC_IDS: ReadonlySet<string> = new Set(METRICS.map((m) => m.id));

/** Campo da resposta de /api/reports/summary → métrica que o define. Todo campo numérico novo do resumo entra aqui (teste-guarda). */
export const SUMMARY_FIELD_METRIC: Record<string, string> = {
  orderCount: "M01",
  revenueCents: "M02",
  averageTicketCents: "M05",
  discountCents: "M06",
  deliveryFeeCents: "M07",
  tipCents: "M08",
  customerCount: "M09",
  byType: "M15",
  byPaymentMethod: "M16",
  canceledCount: "M18",
  canceledCents: "M18",
  topProducts: "M21",
  byDeliverer: "M23",
  cashSummary: "M24",
  openCount: "M26",
  openCents: "M26",
  comparison: "M13",
  byDay: "M01",
};

export const metricDictionary = (): MetricDictionary => ({ metrics: METRICS, summaryFields: SUMMARY_FIELD_METRIC });
