// Definição declarativa dos relatórios: filtros, colunas, totais e gráfico.
// A tela genérica /relatorios/[slug] lê daqui; os números vêm das funções rel_* do banco.

export type Filtro = "periodo" | "agrupar" | "vendedor" | "rota" | "entregues" | "dias";
export type TipoCol = "texto" | "moeda" | "numero" | "inteiro" | "pct" | "data" | "classe";
export type Coluna = { chave: string; rotulo: string; tipo?: TipoCol; total?: "soma"; oculta_celular?: boolean };
export type Grafico = { tipo: "barras" | "colunas" | "linha"; rotulo: string; valor: string; formato: "moeda" | "numero"; top?: number; titulo: string };
export type Relatorio = {
  slug: string;
  titulo: string;
  descricao: string;
  grupo: "Vendas" | "Estoque" | "Financeiro";
  rpc: string;
  filtros: Filtro[];
  periodoPadrao?: "mes" | "proximos30";
  colunas: Coluna[];
  grafico?: Grafico;
  financeiro?: boolean;
  vazio: string;
};

const vendasFiltros: Filtro[] = ["periodo", "vendedor", "rota", "entregues"];

export const RELATORIOS: Relatorio[] = [
  {
    slug: "vendas-por-periodo", grupo: "Vendas", rpc: "rel_vendas_periodo", titulo: "Vendas por período",
    descricao: "Pedidos, clientes atendidos, faturamento e ticket médio por dia, semana ou mês.",
    filtros: ["periodo", "agrupar", "vendedor", "rota", "entregues"], periodoPadrao: "mes",
    colunas: [
      { chave: "periodo", rotulo: "Período", tipo: "data" },
      { chave: "pedidos", rotulo: "Pedidos", tipo: "inteiro", total: "soma" },
      { chave: "clientes", rotulo: "Clientes", tipo: "inteiro", oculta_celular: true },
      { chave: "peso", rotulo: "Peso (kg)", tipo: "numero", total: "soma", oculta_celular: true },
      { chave: "ticket_medio", rotulo: "Ticket médio", tipo: "moeda", oculta_celular: true },
      { chave: "valor", rotulo: "Valor", tipo: "moeda", total: "soma" },
    ],
    grafico: { tipo: "colunas", rotulo: "periodo", valor: "valor", formato: "moeda", titulo: "Faturamento" },
    vazio: "Nenhuma venda confirmada no período.",
  },
  {
    slug: "curva-abc-produtos", grupo: "Vendas", rpc: "rel_abc_produtos", titulo: "Curva ABC de produtos",
    descricao: "Produtos que fazem 80% (A), 95% (B) e o resto (C) do faturamento.",
    filtros: vendasFiltros, periodoPadrao: "mes",
    colunas: [
      { chave: "classe", rotulo: "Classe", tipo: "classe" },
      { chave: "produto_codigo", rotulo: "Código" },
      { chave: "produto_nome", rotulo: "Produto" },
      { chave: "quantidade", rotulo: "Quantidade", tipo: "numero", total: "soma" },
      { chave: "clientes", rotulo: "Clientes", tipo: "inteiro", oculta_celular: true },
      { chave: "valor", rotulo: "Valor", tipo: "moeda", total: "soma" },
      { chave: "participacao", rotulo: "Part.", tipo: "pct", oculta_celular: true },
      { chave: "acumulado", rotulo: "Acum.", tipo: "pct", oculta_celular: true },
    ],
    grafico: { tipo: "barras", rotulo: "produto_nome", valor: "valor", formato: "moeda", top: 15, titulo: "15 produtos que mais faturam" },
    vazio: "Nenhuma venda confirmada no período.",
  },
  {
    slug: "curva-abc-clientes", grupo: "Vendas", rpc: "rel_abc_clientes", titulo: "Curva ABC de clientes",
    descricao: "Clientes que mais compram, com último pedido, vendedor e rota.",
    filtros: vendasFiltros, periodoPadrao: "mes",
    colunas: [
      { chave: "classe", rotulo: "Classe", tipo: "classe" },
      { chave: "cliente_codigo", rotulo: "Código", tipo: "inteiro" },
      { chave: "cliente_nome", rotulo: "Cliente" },
      { chave: "razao_social", rotulo: "Razão social", oculta_celular: true },
      { chave: "vendedor_nome", rotulo: "Vendedor", oculta_celular: true },
      { chave: "rota_nome", rotulo: "Rota", oculta_celular: true },
      { chave: "pedidos", rotulo: "Pedidos", tipo: "inteiro", total: "soma" },
      { chave: "ultimo_pedido", rotulo: "Último pedido", tipo: "data", oculta_celular: true },
      { chave: "valor", rotulo: "Valor", tipo: "moeda", total: "soma" },
      { chave: "participacao", rotulo: "Part.", tipo: "pct", oculta_celular: true },
    ],
    grafico: { tipo: "barras", rotulo: "cliente_nome", valor: "valor", formato: "moeda", top: 15, titulo: "15 clientes que mais compram" },
    vazio: "Nenhuma venda confirmada no período.",
  },
  {
    slug: "ranking-vendedores", grupo: "Vendas", rpc: "rel_ranking_vendedores", titulo: "Ranking de vendedores",
    descricao: "Faturamento, clientes atendidos, meta do período e comissão prevista por vendedor.",
    filtros: ["periodo", "rota", "entregues"], periodoPadrao: "mes",
    colunas: [
      { chave: "vendedor_nome", rotulo: "Vendedor" },
      { chave: "pedidos", rotulo: "Pedidos", tipo: "inteiro", total: "soma" },
      { chave: "clientes", rotulo: "Clientes", tipo: "inteiro", oculta_celular: true },
      { chave: "ticket_medio", rotulo: "Ticket médio", tipo: "moeda", oculta_celular: true },
      { chave: "valor", rotulo: "Valor", tipo: "moeda", total: "soma" },
      { chave: "meta", rotulo: "Meta", tipo: "moeda", total: "soma", oculta_celular: true },
      { chave: "atingido", rotulo: "Atingido", tipo: "pct" },
      { chave: "comissao_prevista", rotulo: "Comissão", tipo: "moeda", total: "soma", oculta_celular: true },
    ],
    grafico: { tipo: "barras", rotulo: "vendedor_nome", valor: "valor", formato: "moeda", titulo: "Faturamento por vendedor" },
    vazio: "Nenhuma venda confirmada no período.",
  },
  {
    slug: "vendas-por-rota", grupo: "Vendas", rpc: "rel_vendas_rota", titulo: "Vendas por rota",
    descricao: "Faturamento por rota e cobertura: quantos clientes da rota compraram no período.",
    filtros: ["periodo", "vendedor", "entregues"], periodoPadrao: "mes",
    colunas: [
      { chave: "rota_nome", rotulo: "Rota" },
      { chave: "clientes_rota", rotulo: "Clientes na rota", tipo: "inteiro", total: "soma", oculta_celular: true },
      { chave: "clientes_compraram", rotulo: "Compraram", tipo: "inteiro", total: "soma" },
      { chave: "cobertura", rotulo: "Cobertura", tipo: "pct" },
      { chave: "pedidos", rotulo: "Pedidos", tipo: "inteiro", total: "soma", oculta_celular: true },
      { chave: "peso", rotulo: "Peso (kg)", tipo: "numero", total: "soma", oculta_celular: true },
      { chave: "valor", rotulo: "Valor", tipo: "moeda", total: "soma" },
    ],
    grafico: { tipo: "barras", rotulo: "rota_nome", valor: "valor", formato: "moeda", titulo: "Faturamento por rota" },
    vazio: "Nenhuma rota com clientes ou vendas.",
  },
  {
    slug: "pedidos-pendentes", grupo: "Vendas", rpc: "rel_pedidos_pendentes", titulo: "Pedidos pendentes de entrega",
    descricao: "Pedidos confirmados que ainda não foram entregues, com a carga em que estão.",
    filtros: ["vendedor", "rota"],
    colunas: [
      { chave: "numero", rotulo: "Pedido", tipo: "inteiro" },
      { chave: "situacao", rotulo: "Situação" },
      { chave: "emissao", rotulo: "Emissão", tipo: "data", oculta_celular: true },
      { chave: "entrega", rotulo: "Entrega", tipo: "data" },
      { chave: "dias_aberto", rotulo: "Dias", tipo: "inteiro", oculta_celular: true },
      { chave: "cliente_nome", rotulo: "Cliente" },
      { chave: "rota_nome", rotulo: "Rota", oculta_celular: true },
      { chave: "carga", rotulo: "Carga", tipo: "inteiro", oculta_celular: true },
      { chave: "peso", rotulo: "Peso (kg)", tipo: "numero", total: "soma", oculta_celular: true },
      { chave: "valor", rotulo: "Valor", tipo: "moeda", total: "soma" },
    ],
    vazio: "Nenhum pedido pendente de entrega.",
  },
  {
    slug: "estoque-atual", grupo: "Estoque", rpc: "rel_estoque_atual", titulo: "Estoque atual",
    descricao: "Saldo por produto, disponível, vencido e valor em estoque pelo custo e pelo preço de venda.",
    filtros: [],
    colunas: [
      { chave: "produto_codigo", rotulo: "Código" },
      { chave: "produto_nome", rotulo: "Produto" },
      { chave: "categoria", rotulo: "Categoria", oculta_celular: true },
      { chave: "quantidade", rotulo: "Quantidade", tipo: "numero", total: "soma" },
      { chave: "reservado", rotulo: "Reservado", tipo: "numero", total: "soma", oculta_celular: true },
      { chave: "disponivel", rotulo: "Disponível", tipo: "numero", total: "soma" },
      { chave: "vencido", rotulo: "Vencido", tipo: "numero", total: "soma", oculta_celular: true },
      { chave: "estoque_minimo", rotulo: "Mínimo", tipo: "numero", oculta_celular: true },
      { chave: "valor_custo", rotulo: "Valor (custo)", tipo: "moeda", total: "soma" },
      { chave: "valor_venda", rotulo: "Valor (venda)", tipo: "moeda", total: "soma", oculta_celular: true },
    ],
    vazio: "Nenhum produto ativo.",
  },
  {
    slug: "vencimentos", grupo: "Estoque", rpc: "rel_vencimentos", titulo: "Produtos perto do vencimento",
    descricao: "Lotes vencidos e que vencem nos próximos dias, com quantidade e valor de custo.",
    filtros: ["dias"],
    colunas: [
      { chave: "situacao", rotulo: "Situação" },
      { chave: "produto_codigo", rotulo: "Código", oculta_celular: true },
      { chave: "produto_nome", rotulo: "Produto" },
      { chave: "lote", rotulo: "Lote" },
      { chave: "validade", rotulo: "Validade", tipo: "data" },
      { chave: "dias_para_vencer", rotulo: "Dias", tipo: "inteiro" },
      { chave: "deposito", rotulo: "Depósito", oculta_celular: true },
      { chave: "quantidade", rotulo: "Quantidade", tipo: "numero", total: "soma" },
      { chave: "valor_custo", rotulo: "Valor (custo)", tipo: "moeda", total: "soma", oculta_celular: true },
    ],
    vazio: "Nenhum lote vencido ou vencendo no prazo escolhido.",
  },
  {
    slug: "receber-em-atraso", grupo: "Financeiro", rpc: "rel_receber_atraso", titulo: "Contas a receber em atraso",
    descricao: "Clientes com títulos vencidos, por faixa de atraso, com telefone para cobrança.",
    filtros: ["vendedor", "rota"], financeiro: true,
    colunas: [
      { chave: "cliente_codigo", rotulo: "Código", tipo: "inteiro", oculta_celular: true },
      { chave: "cliente_nome", rotulo: "Cliente" },
      { chave: "telefone", rotulo: "Telefone", oculta_celular: true },
      { chave: "vendedor_nome", rotulo: "Vendedor", oculta_celular: true },
      { chave: "titulos", rotulo: "Títulos", tipo: "inteiro", total: "soma", oculta_celular: true },
      { chave: "ate_15", rotulo: "Até 15 dias", tipo: "moeda", total: "soma", oculta_celular: true },
      { chave: "de_16_30", rotulo: "16 a 30", tipo: "moeda", total: "soma", oculta_celular: true },
      { chave: "de_31_60", rotulo: "31 a 60", tipo: "moeda", total: "soma", oculta_celular: true },
      { chave: "acima_60", rotulo: "Mais de 60", tipo: "moeda", total: "soma", oculta_celular: true },
      { chave: "maior_atraso", rotulo: "Maior atraso (dias)", tipo: "inteiro" },
      { chave: "total", rotulo: "Total", tipo: "moeda", total: "soma" },
    ],
    grafico: { tipo: "barras", rotulo: "cliente_nome", valor: "total", formato: "moeda", top: 15, titulo: "Maiores devedores" },
    vazio: "Nenhum título a receber em atraso.",
  },
  {
    slug: "fluxo-de-caixa", grupo: "Financeiro", rpc: "rel_fluxo_caixa", titulo: "Fluxo de caixa",
    descricao: "Realizado até hoje e previsto pelos vencimentos, com saldo projetado dia a dia.",
    filtros: ["periodo"], periodoPadrao: "proximos30", financeiro: true,
    colunas: [
      { chave: "data", rotulo: "Data", tipo: "data" },
      { chave: "recebido", rotulo: "Recebido", tipo: "moeda", total: "soma" },
      { chave: "pago", rotulo: "Pago", tipo: "moeda", total: "soma" },
      { chave: "a_receber", rotulo: "A receber", tipo: "moeda", total: "soma" },
      { chave: "a_pagar", rotulo: "A pagar", tipo: "moeda", total: "soma" },
      { chave: "saldo", rotulo: "Saldo projetado", tipo: "moeda" },
    ],
    grafico: { tipo: "linha", rotulo: "data", valor: "saldo", formato: "moeda", titulo: "Saldo projetado em caixa e bancos" },
    vazio: "Sem dados no período.",
  },
];

export const obterRelatorio = (slug: string) => RELATORIOS.find((r) => r.slug === slug);
