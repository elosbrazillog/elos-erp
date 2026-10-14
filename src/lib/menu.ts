export type Modulo = "cadastros" | "vendas" | "estoque" | "expedicao" | "fiscal" | "financeiro" | "relatorios" | "configuracoes";

export type ItemMenu = { titulo: string; rota: string; pronto: boolean };
export type GrupoMenu = { titulo: string; modulo: Modulo; icone: string; itens: ItemMenu[] };

export const MENU: GrupoMenu[] = [
  {
    titulo: "Cadastros",
    modulo: "cadastros",
    icone: "users",
    itens: [
      { titulo: "Clientes e fornecedores", rota: "/cadastros/pessoas", pronto: true },
      { titulo: "Produtos", rota: "/cadastros/produtos", pronto: true },
      { titulo: "Rotas", rota: "/cadastros/rotas", pronto: true },
      { titulo: "Tabelas de preço", rota: "/cadastros/tabelas-preco", pronto: true },
      { titulo: "Categorias", rota: "/cadastros/categorias", pronto: true },
      { titulo: "Marcas", rota: "/cadastros/marcas", pronto: true },
      { titulo: "Unidades", rota: "/cadastros/unidades", pronto: true },
      { titulo: "Formas de pagamento", rota: "/cadastros/formas-pagamento", pronto: true },
      { titulo: "Condições de pagamento", rota: "/cadastros/condicoes-pagamento", pronto: true },
      { titulo: "Depósitos", rota: "/cadastros/depositos", pronto: true },
      { titulo: "Veículos", rota: "/cadastros/veiculos", pronto: true },
      { titulo: "Importar planilha", rota: "/cadastros/importar", pronto: true },
    ],
  },
  {
    titulo: "Vendas",
    modulo: "vendas",
    icone: "cart",
    itens: [
      { titulo: "Pedidos e orçamentos", rota: "/vendas/pedidos", pronto: true },
      { titulo: "Aprovação de crédito", rota: "/vendas/credito", pronto: true },
    ],
  },
  {
    titulo: "Estoque",
    modulo: "estoque",
    icone: "box",
    itens: [
      { titulo: "Saldos por lote", rota: "/estoque/saldos", pronto: true },
      { titulo: "Movimentações", rota: "/estoque/movimentos", pronto: true },
      { titulo: "Inventário", rota: "/estoque/inventario", pronto: true },
    ],
  },
  {
    titulo: "Expedição",
    modulo: "expedicao",
    icone: "truck",
    itens: [
      { titulo: "Cargas", rota: "/expedicao/cargas", pronto: true },
      { titulo: "Entregas", rota: "/expedicao/entregas", pronto: true },
    ],
  },
  {
    titulo: "Fiscal",
    modulo: "fiscal",
    icone: "file",
    itens: [
      { titulo: "Notas emitidas", rota: "/fiscal/notas", pronto: false },
      { titulo: "Grupos tributários", rota: "/cadastros/grupos-tributarios", pronto: true },
    ],
  },
  {
    titulo: "Financeiro",
    modulo: "financeiro",
    icone: "money",
    itens: [
      { titulo: "Lançamentos", rota: "/financeiro/lancamentos", pronto: false },
      { titulo: "Boletos", rota: "/financeiro/boletos", pronto: false },
      { titulo: "Contas bancárias", rota: "/cadastros/contas-bancarias", pronto: true },
      { titulo: "Plano de contas", rota: "/cadastros/plano-contas", pronto: true },
      { titulo: "Centros de custo", rota: "/cadastros/centros-custo", pronto: true },
    ],
  },
  {
    titulo: "Relatórios",
    modulo: "relatorios",
    icone: "chart",
    itens: [{ titulo: "Central de relatórios", rota: "/relatorios", pronto: false }],
  },
  {
    titulo: "Configurações",
    modulo: "configuracoes",
    icone: "gear",
    itens: [
      { titulo: "Dados da empresa", rota: "/configuracoes/empresa", pronto: true },
      { titulo: "Usuários", rota: "/configuracoes/usuarios", pronto: true },
      { titulo: "Perfis de acesso", rota: "/configuracoes/perfis", pronto: true },
    ],
  },
];

export const ACOES = ["ver", "criar", "editar", "excluir"] as const;
export type Acao = (typeof ACOES)[number];
export type Permissoes = Partial<Record<Modulo, Partial<Record<Acao, boolean>>>>;
