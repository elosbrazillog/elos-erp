// Definição declarativa de cada cadastro: campos do formulário, colunas da lista,
// busca e filtros. As telas genéricas de lista e formulário leem daqui.
import type { Modulo } from "@/lib/menu";

export type Opcao = { valor: string; rotulo: string };

export type TipoCampo =
  | "texto" | "textarea" | "numero" | "inteiro" | "moeda" | "data" | "booleano" | "select" | "relacao"
  | "dias_semana" | "lista_inteiros" | "documento" | "telefone" | "email" | "cep" | "uf";

export type Relacao = {
  tabela: string;
  rotulo: string; // coluna exibida
  filtro?: Record<string, string | number | boolean>;
  ordem?: string;
};

export type Campo = {
  nome: string;
  rotulo: string;
  tipo: TipoCampo;
  obrigatorio?: boolean;
  opcoes?: Opcao[];
  relacao?: Relacao;
  aba?: string;
  largura?: 1 | 2 | 3 | 4; // colunas ocupadas numa grade de 4
  ajuda?: string;
  padrao?: unknown;
  somenteLeitura?: boolean;
};

export type TipoColuna = "texto" | "moeda" | "numero" | "data" | "booleano" | "documento" | "telefone" | "dias_semana" | "opcao";

export type Coluna = {
  nome: string; // caminho: "nome" ou "categorias.nome"
  rotulo: string;
  tipo?: TipoColuna;
  opcoes?: Opcao[];
  oculta?: boolean; // escondida por padrão (usuário pode exibir)
  ordenavel?: boolean;
};

export type Filho = {
  titulo: string;
  tabela: string;
  fk: string;
  campos: Campo[];
  ordem?: string;
  preencherProdutos?: boolean; // tabela de preço: incluir todos os produtos
  reajuste?: boolean; // tabela de preço: reajuste em massa
};

export type Entidade = {
  slug: string;
  tabela: string;
  titulo: string;
  singular: string;
  feminino?: boolean;
  modulo: Modulo;
  trilha: string;
  select?: string;
  campos: Campo[];
  colunas: Coluna[];
  busca: string[];
  ordem: { coluna: string; asc: boolean };
  abas?: string[];
  filtrosRapidos?: { rotulo: string; filtro: Record<string, string | number | boolean> }[];
  filhos?: Filho[];
  buscaCnpj?: boolean;
  componentesExtras?: string[]; // abas especiais renderizadas por componentes próprios
};

// ---------------------------------------------------------------------
const UFS = "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS SC SP SE TO".split(" ");
export const OPCOES_UF: Opcao[] = UFS.map((u) => ({ valor: u, rotulo: u }));

const tipoDeposito: Opcao[] = [
  { valor: "camara_fria", rotulo: "Câmara fria" },
  { valor: "expedicao", rotulo: "Expedição" },
  { valor: "avaria", rotulo: "Avarias e vencidos" },
  { valor: "outro", rotulo: "Outro" },
];

const camposEndereco: Campo[] = [
  { nome: "tipo", rotulo: "Tipo", tipo: "select", obrigatorio: true, padrao: "principal",
    opcoes: [{ valor: "principal", rotulo: "Principal" }, { valor: "entrega", rotulo: "Entrega" }, { valor: "cobranca", rotulo: "Cobrança" }] },
  { nome: "cep", rotulo: "CEP", tipo: "cep" },
  { nome: "logradouro", rotulo: "Logradouro", tipo: "texto", obrigatorio: true },
  { nome: "numero", rotulo: "Número", tipo: "texto" },
  { nome: "complemento", rotulo: "Complemento", tipo: "texto" },
  { nome: "bairro", rotulo: "Bairro", tipo: "texto" },
  { nome: "cidade", rotulo: "Cidade", tipo: "texto", obrigatorio: true },
  { nome: "uf", rotulo: "UF", tipo: "uf", obrigatorio: true },
  { nome: "codigo_ibge", rotulo: "Cód. IBGE", tipo: "texto", ajuda: "Preenchido pelo CEP. Obrigatório na NF-e." },
  { nome: "referencia", rotulo: "Ponto de referência", tipo: "texto" },
];

const camposContato: Campo[] = [
  { nome: "nome", rotulo: "Nome", tipo: "texto", obrigatorio: true },
  { nome: "funcao", rotulo: "Função", tipo: "texto" },
  { nome: "telefone", rotulo: "Telefone", tipo: "telefone" },
  { nome: "whatsapp", rotulo: "WhatsApp", tipo: "telefone" },
  { nome: "email", rotulo: "E-mail", tipo: "email" },
];

// Cadastro simples só com nome
const simples = (slug: string, tabela: string, titulo: string, singular: string, modulo: Modulo, trilha: string, feminino = true): Entidade => ({
  slug, tabela, titulo, singular, feminino, modulo, trilha,
  campos: [{ nome: "nome", rotulo: "Nome", tipo: "texto", obrigatorio: true, largura: 4 }],
  colunas: [{ nome: "nome", rotulo: "Nome", ordenavel: true }],
  busca: ["nome"],
  ordem: { coluna: "nome", asc: true },
});

export const ENTIDADES: Record<string, Entidade> = {
  pessoas: {
    slug: "pessoas",
    tabela: "pessoas",
    titulo: "Clientes e fornecedores",
    singular: "pessoa",
    feminino: true,
    modulo: "cadastros",
    trilha: "Cadastros",
    select: "*, rota:rota_id(nome), vendedor:vendedor_id(razao_social)",
    abas: ["Dados", "Comercial", "Contato"],
    buscaCnpj: true,
    campos: [
      { nome: "tipo_pessoa", rotulo: "Tipo", tipo: "select", obrigatorio: true, padrao: "PJ", aba: "Dados",
        opcoes: [{ valor: "PJ", rotulo: "Pessoa jurídica" }, { valor: "PF", rotulo: "Pessoa física" }] },
      { nome: "documento", rotulo: "CNPJ / CPF", tipo: "documento", aba: "Dados" },
      { nome: "inscricao_estadual", rotulo: "Inscrição estadual", tipo: "texto", aba: "Dados" },
      { nome: "indicador_ie", rotulo: "Contribuinte de ICMS", tipo: "select", padrao: "9", aba: "Dados",
        opcoes: [{ valor: "1", rotulo: "Contribuinte" }, { valor: "2", rotulo: "Isento" }, { valor: "9", rotulo: "Não contribuinte" }] },
      { nome: "razao_social", rotulo: "Razão social / nome", tipo: "texto", obrigatorio: true, largura: 2, aba: "Dados" },
      { nome: "nome_fantasia", rotulo: "Nome fantasia", tipo: "texto", largura: 2, aba: "Dados" },
      { nome: "eh_cliente", rotulo: "Cliente", tipo: "booleano", padrao: true, aba: "Dados" },
      { nome: "eh_fornecedor", rotulo: "Fornecedor", tipo: "booleano", aba: "Dados" },
      { nome: "eh_vendedor", rotulo: "Vendedor", tipo: "booleano", aba: "Dados" },
      { nome: "eh_motorista", rotulo: "Motorista", tipo: "booleano", aba: "Dados" },
      { nome: "eh_transportadora", rotulo: "Transportadora", tipo: "booleano", aba: "Dados" },
      { nome: "observacao", rotulo: "Observações", tipo: "textarea", largura: 4, aba: "Dados" },

      { nome: "rota_id", rotulo: "Rota", tipo: "relacao", relacao: { tabela: "rotas", rotulo: "nome" }, aba: "Comercial" },
      { nome: "ordem_visita", rotulo: "Ordem na rota", tipo: "inteiro", aba: "Comercial" },
      { nome: "vendedor_id", rotulo: "Vendedor", tipo: "relacao", relacao: { tabela: "pessoas", rotulo: "razao_social", filtro: { eh_vendedor: true } }, aba: "Comercial" },
      { nome: "tabela_preco_id", rotulo: "Tabela de preço", tipo: "relacao", relacao: { tabela: "tabelas_preco", rotulo: "nome" }, aba: "Comercial" },
      { nome: "condicao_pagamento_id", rotulo: "Condição de pagamento", tipo: "relacao", relacao: { tabela: "condicoes_pagamento", rotulo: "nome" }, aba: "Comercial" },
      { nome: "forma_pagamento_id", rotulo: "Forma de pagamento", tipo: "relacao", relacao: { tabela: "formas_pagamento", rotulo: "nome" }, aba: "Comercial" },
      { nome: "limite_credito", rotulo: "Limite de crédito (R$)", tipo: "moeda", padrao: 0, aba: "Comercial" },
      { nome: "bloqueado", rotulo: "Bloqueado para venda", tipo: "booleano", aba: "Comercial" },
      { nome: "motivo_bloqueio", rotulo: "Motivo do bloqueio", tipo: "texto", largura: 2, aba: "Comercial" },
      { nome: "comissao_percentual", rotulo: "Comissão (%) — vendedor", tipo: "numero", aba: "Comercial" },
      { nome: "meta_mensal", rotulo: "Meta mensal (R$) — vendedor", tipo: "moeda", aba: "Comercial" },

      { nome: "telefone", rotulo: "Telefone", tipo: "telefone", aba: "Contato" },
      { nome: "whatsapp", rotulo: "WhatsApp", tipo: "telefone", aba: "Contato" },
      { nome: "email", rotulo: "E-mail", tipo: "email", aba: "Contato" },
      { nome: "email_nfe", rotulo: "E-mail para NF-e e boletos", tipo: "email", aba: "Contato" },
    ],
    colunas: [
      { nome: "codigo", rotulo: "Cód.", tipo: "numero", ordenavel: true },
      { nome: "razao_social", rotulo: "Razão social", ordenavel: true },
      { nome: "nome_fantasia", rotulo: "Fantasia", ordenavel: true },
      { nome: "documento", rotulo: "CNPJ / CPF", tipo: "documento" },
      { nome: "rota.nome", rotulo: "Rota" },
      { nome: "vendedor.razao_social", rotulo: "Vendedor" },
      { nome: "whatsapp", rotulo: "WhatsApp", tipo: "telefone" },
      { nome: "limite_credito", rotulo: "Limite", tipo: "moeda", oculta: true },
      { nome: "eh_cliente", rotulo: "Cliente", tipo: "booleano", oculta: true },
      { nome: "eh_fornecedor", rotulo: "Fornecedor", tipo: "booleano", oculta: true },
      { nome: "bloqueado", rotulo: "Bloqueado", tipo: "booleano" },
      { nome: "criado_em", rotulo: "Cadastro", tipo: "data", oculta: true, ordenavel: true },
    ],
    busca: ["razao_social", "nome_fantasia", "documento"],
    ordem: { coluna: "razao_social", asc: true },
    filtrosRapidos: [
      { rotulo: "Clientes", filtro: { eh_cliente: true } },
      { rotulo: "Fornecedores", filtro: { eh_fornecedor: true } },
      { rotulo: "Vendedores", filtro: { eh_vendedor: true } },
      { rotulo: "Motoristas", filtro: { eh_motorista: true } },
      { rotulo: "Bloqueados", filtro: { bloqueado: true } },
    ],
    filhos: [
      { titulo: "Endereços", tabela: "pessoas_enderecos", fk: "pessoa_id", campos: camposEndereco, ordem: "tipo" },
      { titulo: "Contatos", tabela: "pessoas_contatos", fk: "pessoa_id", campos: camposContato, ordem: "nome" },
    ],
    componentesExtras: ["financeiro_cliente"],
  },

  produtos: {
    slug: "produtos",
    tabela: "produtos",
    titulo: "Produtos",
    singular: "produto",
    modulo: "cadastros",
    trilha: "Cadastros",
    select: "*, categorias(nome), marcas(nome), unidades(sigla)",
    abas: ["Dados", "Fiscal", "Preço e estoque"],
    campos: [
      { nome: "codigo", rotulo: "Código", tipo: "texto", obrigatorio: true, aba: "Dados" },
      { nome: "nome", rotulo: "Nome", tipo: "texto", obrigatorio: true, largura: 3, aba: "Dados" },
      { nome: "categoria_id", rotulo: "Categoria", tipo: "relacao", relacao: { tabela: "categorias", rotulo: "nome" }, aba: "Dados" },
      { nome: "marca_id", rotulo: "Marca", tipo: "relacao", relacao: { tabela: "marcas", rotulo: "nome" }, aba: "Dados" },
      { nome: "unidade_id", rotulo: "Unidade", tipo: "relacao", relacao: { tabela: "unidades", rotulo: "sigla" }, aba: "Dados" },
      { nome: "fornecedor_id", rotulo: "Fornecedor", tipo: "relacao", relacao: { tabela: "pessoas", rotulo: "razao_social", filtro: { eh_fornecedor: true } }, aba: "Dados" },
      { nome: "codigo_barras", rotulo: "Código de barras (EAN)", tipo: "texto", aba: "Dados" },
      { nome: "codigo_barras_caixa", rotulo: "EAN da caixa", tipo: "texto", aba: "Dados" },
      { nome: "unidades_por_caixa", rotulo: "Unidades por caixa", tipo: "inteiro", aba: "Dados" },
      { nome: "peso_liquido_kg", rotulo: "Peso líquido (kg)", tipo: "numero", aba: "Dados" },
      { nome: "peso_bruto_kg", rotulo: "Peso bruto (kg)", tipo: "numero", aba: "Dados" },
      { nome: "validade_dias", rotulo: "Validade (dias)", tipo: "inteiro", aba: "Dados", ajuda: "Usada para sugerir a validade do lote na entrada." },
      { nome: "visivel_app", rotulo: "Aparece no app do vendedor", tipo: "booleano", padrao: true, aba: "Dados" },
      { nome: "controla_lote", rotulo: "Controla lote e validade", tipo: "booleano", padrao: true, aba: "Dados" },
      { nome: "descricao", rotulo: "Descrição", tipo: "textarea", largura: 4, aba: "Dados" },

      { nome: "ncm", rotulo: "NCM", tipo: "texto", aba: "Fiscal", ajuda: "8 dígitos, confirmar com o contador." },
      { nome: "cest", rotulo: "CEST", tipo: "texto", aba: "Fiscal" },
      { nome: "origem", rotulo: "Origem da mercadoria", tipo: "select", padrao: "0", aba: "Fiscal",
        opcoes: [{ valor: "0", rotulo: "0 - Nacional" }, { valor: "1", rotulo: "1 - Importação direta" }, { valor: "2", rotulo: "2 - Estrangeira adquirida no mercado interno" }] },
      { nome: "grupo_tributario_id", rotulo: "Grupo tributário", tipo: "relacao", relacao: { tabela: "grupos_tributarios", rotulo: "nome" }, largura: 2, aba: "Fiscal" },

      { nome: "custo", rotulo: "Custo (R$)", tipo: "moeda", padrao: 0, aba: "Preço e estoque" },
      { nome: "preco_venda", rotulo: "Preço de venda base (R$)", tipo: "moeda", padrao: 0, aba: "Preço e estoque" },
      { nome: "preco_minimo", rotulo: "Preço mínimo (R$)", tipo: "moeda", aba: "Preço e estoque" },
      { nome: "estoque_minimo", rotulo: "Estoque mínimo", tipo: "numero", padrao: 0, aba: "Preço e estoque" },
    ],
    colunas: [
      { nome: "codigo", rotulo: "Código", ordenavel: true },
      { nome: "nome", rotulo: "Nome", ordenavel: true },
      { nome: "categorias.nome", rotulo: "Categoria" },
      { nome: "unidades.sigla", rotulo: "Un." },
      { nome: "custo", rotulo: "Custo", tipo: "moeda", ordenavel: true },
      { nome: "preco_venda", rotulo: "Preço", tipo: "moeda", ordenavel: true },
      { nome: "ncm", rotulo: "NCM", oculta: true },
      { nome: "codigo_barras", rotulo: "EAN", oculta: true },
      { nome: "marcas.nome", rotulo: "Marca", oculta: true },
      { nome: "estoque_minimo", rotulo: "Estoque mín.", tipo: "numero", oculta: true },
      { nome: "visivel_app", rotulo: "No app", tipo: "booleano" },
    ],
    busca: ["nome", "codigo", "codigo_barras"],
    ordem: { coluna: "nome", asc: true },
    filhos: [
      {
        titulo: "Preços por tabela",
        tabela: "tabelas_preco_itens",
        fk: "produto_id",
        campos: [
          { nome: "tabela_preco_id", rotulo: "Tabela", tipo: "relacao", obrigatorio: true, relacao: { tabela: "tabelas_preco", rotulo: "nome" } },
          { nome: "preco", rotulo: "Preço (R$)", tipo: "moeda", obrigatorio: true },
          { nome: "preco_minimo", rotulo: "Preço mínimo (R$)", tipo: "moeda" },
        ],
      },
    ],
  },

  rotas: {
    slug: "rotas",
    tabela: "rotas",
    titulo: "Rotas",
    singular: "rota",
    feminino: true,
    modulo: "cadastros",
    trilha: "Cadastros",
    select: "*, vendedor:vendedor_id(razao_social), motorista:motorista_id(razao_social)",
    campos: [
      { nome: "nome", rotulo: "Nome da rota", tipo: "texto", obrigatorio: true, largura: 2 },
      { nome: "dias_semana", rotulo: "Dias de visita e entrega", tipo: "dias_semana", largura: 2 },
      { nome: "vendedor_id", rotulo: "Vendedor", tipo: "relacao", relacao: { tabela: "pessoas", rotulo: "razao_social", filtro: { eh_vendedor: true } }, largura: 2 },
      { nome: "motorista_id", rotulo: "Motorista", tipo: "relacao", relacao: { tabela: "pessoas", rotulo: "razao_social", filtro: { eh_motorista: true } }, largura: 2 },
      { nome: "observacao", rotulo: "Observações", tipo: "textarea", largura: 4 },
    ],
    colunas: [
      { nome: "nome", rotulo: "Rota", ordenavel: true },
      { nome: "dias_semana", rotulo: "Dias", tipo: "dias_semana" },
      { nome: "vendedor.razao_social", rotulo: "Vendedor" },
      { nome: "motorista.razao_social", rotulo: "Motorista" },
    ],
    busca: ["nome"],
    ordem: { coluna: "nome", asc: true },
    componentesExtras: ["clientes_rota"],
  },

  "tabelas-preco": {
    slug: "tabelas-preco",
    tabela: "tabelas_preco",
    titulo: "Tabelas de preço",
    singular: "tabela de preço",
    feminino: true,
    modulo: "cadastros",
    trilha: "Cadastros",
    campos: [
      { nome: "nome", rotulo: "Nome", tipo: "texto", obrigatorio: true, largura: 2 },
      { nome: "vigencia_inicio", rotulo: "Vigência início", tipo: "data" },
      { nome: "vigencia_fim", rotulo: "Vigência fim", tipo: "data" },
      { nome: "padrao", rotulo: "Tabela padrão para novos clientes", tipo: "booleano", largura: 2 },
    ],
    colunas: [
      { nome: "nome", rotulo: "Nome", ordenavel: true },
      { nome: "vigencia_inicio", rotulo: "Início", tipo: "data" },
      { nome: "vigencia_fim", rotulo: "Fim", tipo: "data" },
      { nome: "padrao", rotulo: "Padrão", tipo: "booleano" },
    ],
    busca: ["nome"],
    ordem: { coluna: "nome", asc: true },
    filhos: [
      {
        titulo: "Itens da tabela",
        tabela: "tabelas_preco_itens",
        fk: "tabela_preco_id",
        preencherProdutos: true,
        reajuste: true,
        campos: [
          { nome: "produto_id", rotulo: "Produto", tipo: "relacao", obrigatorio: true, relacao: { tabela: "produtos", rotulo: "nome" } },
          { nome: "preco", rotulo: "Preço (R$)", tipo: "moeda", obrigatorio: true },
          { nome: "preco_minimo", rotulo: "Preço mínimo (R$)", tipo: "moeda" },
        ],
      },
    ],
  },

  categorias: simples("categorias", "categorias", "Categorias", "categoria", "cadastros", "Cadastros"),
  marcas: simples("marcas", "marcas", "Marcas", "marca", "cadastros", "Cadastros"),
  "centros-custo": simples("centros-custo", "centros_custo", "Centros de custo", "centro de custo", "financeiro", "Financeiro", false),

  unidades: {
    slug: "unidades", tabela: "unidades", titulo: "Unidades", singular: "unidade", feminino: true, modulo: "cadastros", trilha: "Cadastros",
    campos: [
      { nome: "sigla", rotulo: "Sigla", tipo: "texto", obrigatorio: true },
      { nome: "descricao", rotulo: "Descrição", tipo: "texto", obrigatorio: true, largura: 3 },
    ],
    colunas: [{ nome: "sigla", rotulo: "Sigla", ordenavel: true }, { nome: "descricao", rotulo: "Descrição", ordenavel: true }],
    busca: ["sigla", "descricao"],
    ordem: { coluna: "sigla", asc: true },
  },

  "formas-pagamento": {
    slug: "formas-pagamento", tabela: "formas_pagamento", titulo: "Formas de pagamento", singular: "forma de pagamento", feminino: true,
    modulo: "cadastros", trilha: "Cadastros",
    campos: [
      { nome: "nome", rotulo: "Nome", tipo: "texto", obrigatorio: true, largura: 2 },
      { nome: "codigo_nfe", rotulo: "Código na NF-e", tipo: "select", obrigatorio: true, padrao: "99",
        opcoes: [
          { valor: "01", rotulo: "01 - Dinheiro" }, { valor: "02", rotulo: "02 - Cheque" }, { valor: "03", rotulo: "03 - Cartão de crédito" },
          { valor: "04", rotulo: "04 - Cartão de débito" }, { valor: "05", rotulo: "05 - Crédito loja" }, { valor: "15", rotulo: "15 - Boleto" },
          { valor: "17", rotulo: "17 - PIX" }, { valor: "18", rotulo: "18 - Transferência / carteira digital" }, { valor: "90", rotulo: "90 - Sem pagamento" },
          { valor: "99", rotulo: "99 - Outros" },
        ] },
      { nome: "gera_boleto", rotulo: "Gera boleto Sicredi", tipo: "booleano" },
    ],
    colunas: [
      { nome: "nome", rotulo: "Nome", ordenavel: true },
      { nome: "codigo_nfe", rotulo: "Cód. NF-e" },
      { nome: "gera_boleto", rotulo: "Boleto", tipo: "booleano" },
    ],
    busca: ["nome"],
    ordem: { coluna: "nome", asc: true },
  },

  "condicoes-pagamento": {
    slug: "condicoes-pagamento", tabela: "condicoes_pagamento", titulo: "Condições de pagamento", singular: "condição de pagamento", feminino: true,
    modulo: "cadastros", trilha: "Cadastros",
    campos: [
      { nome: "nome", rotulo: "Nome", tipo: "texto", obrigatorio: true, largura: 2 },
      { nome: "parcelas_dias", rotulo: "Dias de cada parcela", tipo: "lista_inteiros", obrigatorio: true, largura: 2, padrao: [0],
        ajuda: "Separe por barra. Ex.: 14/28 gera duas parcelas, com 14 e 28 dias. Use 0 para à vista." },
    ],
    colunas: [
      { nome: "nome", rotulo: "Nome", ordenavel: true },
      { nome: "parcelas_dias", rotulo: "Parcelas (dias)" },
    ],
    busca: ["nome"],
    ordem: { coluna: "nome", asc: true },
  },

  depositos: {
    slug: "depositos", tabela: "depositos", titulo: "Depósitos", singular: "depósito", modulo: "cadastros", trilha: "Cadastros",
    campos: [
      { nome: "nome", rotulo: "Nome", tipo: "texto", obrigatorio: true, largura: 2 },
      { nome: "tipo", rotulo: "Tipo", tipo: "select", obrigatorio: true, padrao: "camara_fria", opcoes: tipoDeposito },
      { nome: "padrao", rotulo: "Depósito padrão de venda", tipo: "booleano" },
    ],
    colunas: [
      { nome: "nome", rotulo: "Nome", ordenavel: true },
      { nome: "tipo", rotulo: "Tipo", tipo: "opcao", opcoes: tipoDeposito },
      { nome: "padrao", rotulo: "Padrão", tipo: "booleano" },
    ],
    busca: ["nome"],
    ordem: { coluna: "nome", asc: true },
  },

  veiculos: {
    slug: "veiculos", tabela: "veiculos", titulo: "Veículos", singular: "veículo", modulo: "cadastros", trilha: "Cadastros",
    campos: [
      { nome: "placa", rotulo: "Placa", tipo: "texto", obrigatorio: true },
      { nome: "descricao", rotulo: "Descrição", tipo: "texto", largura: 2 },
      { nome: "uf", rotulo: "UF", tipo: "uf" },
      { nome: "capacidade_kg", rotulo: "Capacidade (kg)", tipo: "numero" },
      { nome: "rntrc", rotulo: "RNTRC", tipo: "texto" },
    ],
    colunas: [
      { nome: "placa", rotulo: "Placa", ordenavel: true },
      { nome: "descricao", rotulo: "Descrição" },
      { nome: "capacidade_kg", rotulo: "Capacidade (kg)", tipo: "numero" },
    ],
    busca: ["placa", "descricao"],
    ordem: { coluna: "placa", asc: true },
  },

  "grupos-tributarios": {
    slug: "grupos-tributarios", tabela: "grupos_tributarios", titulo: "Grupos tributários", singular: "grupo tributário",
    modulo: "fiscal", trilha: "Fiscal",
    campos: [
      { nome: "nome", rotulo: "Nome", tipo: "texto", obrigatorio: true, largura: 4 },
      { nome: "cfop_dentro_uf", rotulo: "CFOP dentro de MS", tipo: "texto", obrigatorio: true },
      { nome: "cfop_fora_uf", rotulo: "CFOP fora de MS", tipo: "texto", obrigatorio: true },
      { nome: "csosn", rotulo: "CSOSN", tipo: "select", obrigatorio: true, padrao: "102",
        opcoes: [
          { valor: "101", rotulo: "101 - Tributada com permissão de crédito" },
          { valor: "102", rotulo: "102 - Tributada sem permissão de crédito" },
          { valor: "103", rotulo: "103 - Isenção do ICMS para faixa de receita" },
          { valor: "201", rotulo: "201 - Com crédito e cobrança do ICMS-ST" },
          { valor: "202", rotulo: "202 - Sem crédito e com cobrança do ICMS-ST" },
          { valor: "300", rotulo: "300 - Imune" },
          { valor: "400", rotulo: "400 - Não tributada" },
          { valor: "500", rotulo: "500 - ICMS cobrado anteriormente por ST" },
          { valor: "900", rotulo: "900 - Outros" },
        ] },
      { nome: "icms_st", rotulo: "Tem ICMS-ST", tipo: "booleano" },
      { nome: "mva_st", rotulo: "MVA ST (%)", tipo: "numero" },
      { nome: "aliquota_icms_st", rotulo: "Alíquota ICMS-ST (%)", tipo: "numero" },
      { nome: "pis_cst", rotulo: "CST PIS", tipo: "texto", padrao: "49" },
      { nome: "cofins_cst", rotulo: "CST COFINS", tipo: "texto", padrao: "49" },
      { nome: "ibs_cst", rotulo: "CST IBS/CBS", tipo: "texto", ajuda: "Reforma tributária. Confirmar com o contador." },
      { nome: "cclass_trib", rotulo: "cClassTrib", tipo: "texto" },
      { nome: "observacao", rotulo: "Observações", tipo: "textarea", largura: 4 },
    ],
    colunas: [
      { nome: "nome", rotulo: "Nome", ordenavel: true },
      { nome: "cfop_dentro_uf", rotulo: "CFOP MS" },
      { nome: "csosn", rotulo: "CSOSN" },
      { nome: "icms_st", rotulo: "ST", tipo: "booleano" },
    ],
    busca: ["nome"],
    ordem: { coluna: "nome", asc: true },
  },

  "contas-bancarias": {
    slug: "contas-bancarias", tabela: "contas_bancarias", titulo: "Contas bancárias", singular: "conta bancária", feminino: true,
    modulo: "financeiro", trilha: "Financeiro",
    campos: [
      { nome: "nome", rotulo: "Nome da conta", tipo: "texto", obrigatorio: true, largura: 2 },
      { nome: "banco_codigo", rotulo: "Código do banco", tipo: "texto", ajuda: "748 = Sicredi" },
      { nome: "emite_boleto", rotulo: "Emite boletos", tipo: "booleano" },
      { nome: "agencia", rotulo: "Agência / cooperativa", tipo: "texto" },
      { nome: "posto", rotulo: "Posto", tipo: "texto" },
      { nome: "conta", rotulo: "Conta", tipo: "texto" },
      { nome: "sicredi_codigo_beneficiario", rotulo: "Código do beneficiário Sicredi", tipo: "texto" },
      { nome: "saldo_inicial", rotulo: "Saldo inicial (R$)", tipo: "moeda", padrao: 0 },
      { nome: "data_saldo_inicial", rotulo: "Data do saldo inicial", tipo: "data" },
    ],
    colunas: [
      { nome: "nome", rotulo: "Conta", ordenavel: true },
      { nome: "banco_codigo", rotulo: "Banco" },
      { nome: "agencia", rotulo: "Agência" },
      { nome: "conta", rotulo: "Conta" },
      { nome: "emite_boleto", rotulo: "Boleto", tipo: "booleano" },
    ],
    busca: ["nome"],
    ordem: { coluna: "nome", asc: true },
  },

  "plano-contas": {
    slug: "plano-contas", tabela: "plano_contas", titulo: "Plano de contas", singular: "conta", feminino: true,
    modulo: "financeiro", trilha: "Financeiro",
    select: "*, pai:pai_id(nome)",
    campos: [
      { nome: "codigo", rotulo: "Código", tipo: "texto", obrigatorio: true, ajuda: "Ex.: 2.14" },
      { nome: "nome", rotulo: "Nome", tipo: "texto", obrigatorio: true, largura: 3 },
      { nome: "tipo", rotulo: "Tipo", tipo: "select", obrigatorio: true, padrao: "despesa",
        opcoes: [{ valor: "receita", rotulo: "Receita" }, { valor: "despesa", rotulo: "Despesa" }] },
      { nome: "pai_id", rotulo: "Conta superior", tipo: "relacao", relacao: { tabela: "plano_contas", rotulo: "nome" } },
      { nome: "grupo_dre", rotulo: "Grupo no DRE", tipo: "texto", largura: 2 },
    ],
    colunas: [
      { nome: "codigo", rotulo: "Código", ordenavel: true },
      { nome: "nome", rotulo: "Nome", ordenavel: true },
      { nome: "tipo", rotulo: "Tipo", tipo: "opcao", opcoes: [{ valor: "receita", rotulo: "Receita" }, { valor: "despesa", rotulo: "Despesa" }] },
      { nome: "grupo_dre", rotulo: "Grupo DRE" },
    ],
    busca: ["codigo", "nome"],
    ordem: { coluna: "codigo", asc: true },
  },

  empresa: {
    slug: "empresa", tabela: "empresas", titulo: "Dados da empresa", singular: "empresa", feminino: true,
    modulo: "configuracoes", trilha: "Configurações",
    abas: ["Cadastro", "Endereço", "NF-e"],
    campos: [
      { nome: "cnpj", rotulo: "CNPJ", tipo: "documento", obrigatorio: true, aba: "Cadastro" },
      { nome: "inscricao_estadual", rotulo: "Inscrição estadual", tipo: "texto", aba: "Cadastro" },
      { nome: "inscricao_municipal", rotulo: "Inscrição municipal", tipo: "texto", aba: "Cadastro" },
      { nome: "regime_tributario", rotulo: "Regime tributário", tipo: "select", aba: "Cadastro",
        opcoes: [{ valor: "simples_nacional", rotulo: "Simples Nacional" }, { valor: "simples_excesso", rotulo: "Simples - excesso de sublimite" }, { valor: "normal", rotulo: "Regime normal" }] },
      { nome: "razao_social", rotulo: "Razão social", tipo: "texto", obrigatorio: true, largura: 2, aba: "Cadastro" },
      { nome: "nome_fantasia", rotulo: "Nome fantasia", tipo: "texto", largura: 2, aba: "Cadastro" },
      { nome: "telefone", rotulo: "Telefone", tipo: "telefone", aba: "Cadastro" },
      { nome: "email", rotulo: "E-mail", tipo: "email", aba: "Cadastro" },
      { nome: "cep", rotulo: "CEP", tipo: "cep", aba: "Endereço" },
      { nome: "logradouro", rotulo: "Logradouro", tipo: "texto", largura: 2, aba: "Endereço" },
      { nome: "numero", rotulo: "Número", tipo: "texto", aba: "Endereço" },
      { nome: "complemento", rotulo: "Complemento", tipo: "texto", aba: "Endereço" },
      { nome: "bairro", rotulo: "Bairro", tipo: "texto", aba: "Endereço" },
      { nome: "cidade", rotulo: "Cidade", tipo: "texto", aba: "Endereço" },
      { nome: "uf", rotulo: "UF", tipo: "uf", aba: "Endereço" },
      { nome: "codigo_ibge", rotulo: "Cód. IBGE", tipo: "texto", aba: "Endereço" },
      { nome: "nfe_ambiente", rotulo: "Ambiente de emissão", tipo: "select", aba: "NF-e",
        opcoes: [{ valor: "homologacao", rotulo: "Homologação (testes)" }, { valor: "producao", rotulo: "Produção" }] },
      { nome: "nfe_serie", rotulo: "Série da NF-e", tipo: "inteiro", aba: "NF-e" },
      { nome: "nfe_proximo_numero", rotulo: "Próximo número", tipo: "inteiro", aba: "NF-e" },
      { nome: "nfe_natureza_operacao", rotulo: "Natureza da operação", tipo: "texto", largura: 2, aba: "NF-e" },
      { nome: "nfe_pis_cofins_cst", rotulo: "CST PIS/COFINS", tipo: "select", aba: "NF-e",
        opcoes: [
          { valor: "49", rotulo: "49 - Outras operações de saída" },
          { valor: "99", rotulo: "99 - Outras operações" },
          { valor: "07", rotulo: "07 - Isenta da contribuição" },
          { valor: "08", rotulo: "08 - Sem incidência da contribuição" },
        ] },
      { nome: "nfe_modalidade_frete", rotulo: "Frete padrão", tipo: "select", aba: "NF-e",
        opcoes: [
          { valor: "0", rotulo: "0 - Por conta do emitente (entrega própria)" },
          { valor: "1", rotulo: "1 - Por conta do destinatário" },
          { valor: "2", rotulo: "2 - Por conta de terceiros" },
          { valor: "3", rotulo: "3 - Transporte próprio do remetente" },
          { valor: "4", rotulo: "4 - Transporte próprio do destinatário" },
          { valor: "9", rotulo: "9 - Sem ocorrência de transporte" },
        ] },
      { nome: "nfe_info_complementares", rotulo: "Informações complementares da NF-e", tipo: "textarea", largura: 4, aba: "NF-e",
        ajuda: "Texto impresso em todas as notas. Valide com o contador." },
    ],
    colunas: [],
    busca: [],
    ordem: { coluna: "razao_social", asc: true },
  },
};

export function obterEntidade(slug: string): Entidade | undefined {
  return ENTIDADES[slug];
}

/** Artigo para mensagens: "o produto", "a rota" */
export const artigo = (e: Entidade) => (e.feminino ? "a" : "o");
