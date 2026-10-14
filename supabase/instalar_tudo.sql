-- Instalação completa do banco do Elos ERP (todas as migrations em ordem).
-- Cole tudo no SQL Editor do Supabase e clique em Run.

-- >>> supabase/migrations/20261014000001_schema.sql
-- =====================================================================
-- ERP Elos — Schema da versão 1
-- Padrão de toda tabela: id, empresa_id, criado_em, criado_por,
-- alterado_em, alterado_por, ativo.
-- =====================================================================

create extension if not exists pgcrypto;
create extension if not exists unaccent;

-- ---------------------------------------------------------------------
-- Funções utilitárias
-- ---------------------------------------------------------------------

-- Preenche alterado_em / alterado_por em todo UPDATE
create or replace function public.fn_auditoria()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.criado_em := coalesce(new.criado_em, now());
    new.criado_por := coalesce(new.criado_por, auth.uid());
  end if;
  new.alterado_em := now();
  new.alterado_por := auth.uid();
  return new;
end;
$$;

-- Busca sem acento e sem diferença de maiúsculas
create or replace function public.fn_normaliza(txt text)
returns text
language sql
immutable
as $$
  select lower(public.unaccent('public.unaccent', coalesce(txt, '')));
$$;

-- ---------------------------------------------------------------------
-- BASE
-- ---------------------------------------------------------------------

create table public.empresas (
  id uuid primary key default gen_random_uuid(),
  cnpj text not null unique,
  razao_social text not null,
  nome_fantasia text,
  inscricao_estadual text,
  inscricao_municipal text,
  regime_tributario text not null default 'simples_nacional'
    check (regime_tributario in ('simples_nacional', 'simples_excesso', 'normal')),
  telefone text,
  email text,
  cep text,
  logradouro text,
  numero text,
  complemento text,
  bairro text,
  cidade text,
  codigo_ibge text,
  uf char(2),
  nfe_serie integer not null default 1,
  nfe_proximo_numero integer not null default 1,
  nfe_ambiente text not null default 'homologacao'
    check (nfe_ambiente in ('homologacao', 'producao')),
  logo_url text,
  criado_em timestamptz not null default now(),
  criado_por uuid,
  alterado_em timestamptz not null default now(),
  alterado_por uuid,
  ativo boolean not null default true
);

create table public.perfis (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nome text not null,
  descricao text,
  -- {"cadastros": {"ver": true, "criar": true, "editar": true, "excluir": false}, ...}
  permissoes jsonb not null default '{}'::jsonb,
  administrador boolean not null default false,
  criado_em timestamptz not null default now(),
  criado_por uuid,
  alterado_em timestamptz not null default now(),
  alterado_por uuid,
  ativo boolean not null default true,
  unique (empresa_id, nome)
);

create table public.usuarios (
  id uuid primary key references auth.users(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  perfil_id uuid references public.perfis(id) on delete set null,
  nome text not null,
  email text not null,
  telefone text,
  pessoa_id uuid, -- vendedor / motorista vinculado (FK criada após pessoas)
  criado_em timestamptz not null default now(),
  criado_por uuid,
  alterado_em timestamptz not null default now(),
  alterado_por uuid,
  ativo boolean not null default true
);

-- Empresa do usuário logado
create or replace function public.empresa_atual()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select empresa_id from public.usuarios where id = auth.uid() and ativo;
$$;

-- Permissão do usuário logado em um módulo/ação
create or replace function public.tem_permissao(p_modulo text, p_acao text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.administrador
            or coalesce((p.permissoes -> p_modulo ->> p_acao)::boolean, false)
       from public.usuarios u
       join public.perfis p on p.id = u.perfil_id and p.ativo
      where u.id = auth.uid() and u.ativo),
    false);
$$;

-- Numeradores sequenciais por empresa (pedido, expedição, lote interno...)
create table public.numeradores (
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  chave text not null,
  ultimo bigint not null default 0,
  primary key (empresa_id, chave)
);

create or replace function public.proximo_numero(p_empresa uuid, p_chave text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v bigint;
begin
  insert into public.numeradores (empresa_id, chave, ultimo)
  values (p_empresa, p_chave, 1)
  on conflict (empresa_id, chave)
  do update set ultimo = public.numeradores.ultimo + 1
  returning ultimo into v;
  return v;
end;
$$;

-- ---------------------------------------------------------------------
-- TABELAS DE APOIO
-- ---------------------------------------------------------------------

create table public.categorias (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default public.empresa_atual() references public.empresas(id) on delete cascade,
  nome text not null,
  criado_em timestamptz not null default now(),
  criado_por uuid,
  alterado_em timestamptz not null default now(),
  alterado_por uuid,
  ativo boolean not null default true,
  unique (empresa_id, nome)
);

create table public.marcas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default public.empresa_atual() references public.empresas(id) on delete cascade,
  nome text not null,
  criado_em timestamptz not null default now(),
  criado_por uuid,
  alterado_em timestamptz not null default now(),
  alterado_por uuid,
  ativo boolean not null default true,
  unique (empresa_id, nome)
);

create table public.unidades (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default public.empresa_atual() references public.empresas(id) on delete cascade,
  sigla text not null,
  descricao text not null,
  criado_em timestamptz not null default now(),
  criado_por uuid,
  alterado_em timestamptz not null default now(),
  alterado_por uuid,
  ativo boolean not null default true,
  unique (empresa_id, sigla)
);

create table public.formas_pagamento (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default public.empresa_atual() references public.empresas(id) on delete cascade,
  nome text not null,
  -- código da forma de pagamento na NF-e (tPag): 01 dinheiro, 15 boleto, 17 PIX...
  codigo_nfe text not null default '99',
  gera_boleto boolean not null default false,
  criado_em timestamptz not null default now(),
  criado_por uuid,
  alterado_em timestamptz not null default now(),
  alterado_por uuid,
  ativo boolean not null default true,
  unique (empresa_id, nome)
);

create table public.condicoes_pagamento (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default public.empresa_atual() references public.empresas(id) on delete cascade,
  nome text not null,             -- ex.: "28 dias", "14/28"
  parcelas_dias integer[] not null default '{0}', -- dias de cada parcela a partir da emissão
  criado_em timestamptz not null default now(),
  criado_por uuid,
  alterado_em timestamptz not null default now(),
  alterado_por uuid,
  ativo boolean not null default true,
  unique (empresa_id, nome)
);

create table public.plano_contas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default public.empresa_atual() references public.empresas(id) on delete cascade,
  codigo text not null,           -- ex.: 1.01.001
  nome text not null,
  tipo text not null check (tipo in ('receita', 'despesa')),
  grupo_dre text,
  pai_id uuid references public.plano_contas(id) on delete set null,
  criado_em timestamptz not null default now(),
  criado_por uuid,
  alterado_em timestamptz not null default now(),
  alterado_por uuid,
  ativo boolean not null default true,
  unique (empresa_id, codigo)
);

create table public.centros_custo (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default public.empresa_atual() references public.empresas(id) on delete cascade,
  nome text not null,
  criado_em timestamptz not null default now(),
  criado_por uuid,
  alterado_em timestamptz not null default now(),
  alterado_por uuid,
  ativo boolean not null default true,
  unique (empresa_id, nome)
);

create table public.depositos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default public.empresa_atual() references public.empresas(id) on delete cascade,
  nome text not null,
  tipo text not null default 'camara_fria'
    check (tipo in ('camara_fria', 'expedicao', 'avaria', 'outro')),
  padrao boolean not null default false,
  criado_em timestamptz not null default now(),
  criado_por uuid,
  alterado_em timestamptz not null default now(),
  alterado_por uuid,
  ativo boolean not null default true,
  unique (empresa_id, nome)
);

create table public.contas_bancarias (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default public.empresa_atual() references public.empresas(id) on delete cascade,
  nome text not null,             -- ex.: "Sicredi principal", "Caixa"
  banco_codigo text,              -- 748 = Sicredi
  agencia text,
  posto text,                     -- Sicredi usa cooperativa/posto
  conta text,
  sicredi_codigo_beneficiario text,
  saldo_inicial numeric(14,2) not null default 0,
  data_saldo_inicial date not null default current_date,
  emite_boleto boolean not null default false,
  criado_em timestamptz not null default now(),
  criado_por uuid,
  alterado_em timestamptz not null default now(),
  alterado_por uuid,
  ativo boolean not null default true,
  unique (empresa_id, nome)
);

-- Regras fiscais por grupo de produto (Simples Nacional + reforma)
create table public.grupos_tributarios (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default public.empresa_atual() references public.empresas(id) on delete cascade,
  nome text not null,
  cfop_dentro_uf text not null default '5102',
  cfop_fora_uf text not null default '6102',
  csosn text not null default '102',
  icms_st boolean not null default false,
  mva_st numeric(7,4),
  aliquota_icms_st numeric(7,4),
  pis_cst text not null default '49',
  cofins_cst text not null default '49',
  ibs_cst text,
  cbs_cst text,
  cclass_trib text,
  observacao text,
  criado_em timestamptz not null default now(),
  criado_por uuid,
  alterado_em timestamptz not null default now(),
  alterado_por uuid,
  ativo boolean not null default true,
  unique (empresa_id, nome)
);

-- ---------------------------------------------------------------------
-- PESSOAS (cadastro único com papéis)
-- ---------------------------------------------------------------------

create table public.rotas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default public.empresa_atual() references public.empresas(id) on delete cascade,
  nome text not null,
  -- 0=domingo ... 6=sábado
  dias_semana smallint[] not null default '{}',
  vendedor_id uuid,
  motorista_id uuid,
  observacao text,
  criado_em timestamptz not null default now(),
  criado_por uuid,
  alterado_em timestamptz not null default now(),
  alterado_por uuid,
  ativo boolean not null default true,
  unique (empresa_id, nome)
);

create table public.tabelas_preco (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default public.empresa_atual() references public.empresas(id) on delete cascade,
  nome text not null,
  vigencia_inicio date,
  vigencia_fim date,
  padrao boolean not null default false,
  criado_em timestamptz not null default now(),
  criado_por uuid,
  alterado_em timestamptz not null default now(),
  alterado_por uuid,
  ativo boolean not null default true,
  unique (empresa_id, nome)
);

create table public.pessoas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default public.empresa_atual() references public.empresas(id) on delete cascade,
  codigo bigint,
  tipo_pessoa char(2) not null default 'PJ' check (tipo_pessoa in ('PF', 'PJ')),
  documento text,                 -- CPF ou CNPJ, só números
  razao_social text not null,
  nome_fantasia text,
  inscricao_estadual text,
  indicador_ie smallint not null default 9 check (indicador_ie in (1, 2, 9)),
  -- papéis
  eh_cliente boolean not null default false,
  eh_fornecedor boolean not null default false,
  eh_vendedor boolean not null default false,
  eh_motorista boolean not null default false,
  eh_transportadora boolean not null default false,
  -- comercial
  rota_id uuid references public.rotas(id) on delete set null,
  ordem_visita integer,
  vendedor_id uuid references public.pessoas(id) on delete set null,
  tabela_preco_id uuid references public.tabelas_preco(id) on delete set null,
  condicao_pagamento_id uuid references public.condicoes_pagamento(id) on delete set null,
  forma_pagamento_id uuid references public.formas_pagamento(id) on delete set null,
  limite_credito numeric(14,2) not null default 0,
  bloqueado boolean not null default false,
  motivo_bloqueio text,
  -- vendedor
  comissao_percentual numeric(6,3),
  meta_mensal numeric(14,2),
  -- contato principal
  telefone text,
  whatsapp text,
  email text,
  email_nfe text,
  observacao text,
  criado_em timestamptz not null default now(),
  criado_por uuid,
  alterado_em timestamptz not null default now(),
  alterado_por uuid,
  ativo boolean not null default true,
  unique (empresa_id, codigo)
);

create unique index pessoas_documento_un
  on public.pessoas (empresa_id, documento)
  where documento is not null and documento <> '';
create index pessoas_busca_idx on public.pessoas
  using gin (to_tsvector('simple', public.fn_normaliza(razao_social || ' ' || coalesce(nome_fantasia, '') || ' ' || coalesce(documento, ''))));
create index pessoas_rota_idx on public.pessoas (rota_id);

alter table public.rotas
  add constraint rotas_vendedor_fk foreign key (vendedor_id) references public.pessoas(id) on delete set null,
  add constraint rotas_motorista_fk foreign key (motorista_id) references public.pessoas(id) on delete set null;
alter table public.usuarios
  add constraint usuarios_pessoa_fk foreign key (pessoa_id) references public.pessoas(id) on delete set null;

create table public.pessoas_enderecos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default public.empresa_atual() references public.empresas(id) on delete cascade,
  pessoa_id uuid not null references public.pessoas(id) on delete cascade,
  tipo text not null default 'principal'
    check (tipo in ('principal', 'entrega', 'cobranca')),
  cep text,
  logradouro text,
  numero text,
  complemento text,
  bairro text,
  cidade text,
  codigo_ibge text,
  uf char(2),
  latitude numeric(10,7),
  longitude numeric(10,7),
  referencia text,
  criado_em timestamptz not null default now(),
  criado_por uuid,
  alterado_em timestamptz not null default now(),
  alterado_por uuid,
  ativo boolean not null default true
);
create index pessoas_enderecos_pessoa_idx on public.pessoas_enderecos (pessoa_id);

create table public.pessoas_contatos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default public.empresa_atual() references public.empresas(id) on delete cascade,
  pessoa_id uuid not null references public.pessoas(id) on delete cascade,
  nome text not null,
  funcao text,
  telefone text,
  whatsapp text,
  email text,
  criado_em timestamptz not null default now(),
  criado_por uuid,
  alterado_em timestamptz not null default now(),
  alterado_por uuid,
  ativo boolean not null default true
);
create index pessoas_contatos_pessoa_idx on public.pessoas_contatos (pessoa_id);

-- ---------------------------------------------------------------------
-- PRODUTOS
-- ---------------------------------------------------------------------

create table public.produtos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default public.empresa_atual() references public.empresas(id) on delete cascade,
  codigo text not null,
  nome text not null,
  descricao text,
  codigo_barras text,
  codigo_barras_caixa text,
  ncm text,
  cest text,
  origem smallint not null default 0,  -- origem da mercadoria (0 = nacional)
  unidade_id uuid references public.unidades(id) on delete set null,
  categoria_id uuid references public.categorias(id) on delete set null,
  marca_id uuid references public.marcas(id) on delete set null,
  fornecedor_id uuid references public.pessoas(id) on delete set null,
  grupo_tributario_id uuid references public.grupos_tributarios(id) on delete set null,
  peso_liquido_kg numeric(10,3),
  peso_bruto_kg numeric(10,3),
  unidades_por_caixa integer,
  custo numeric(14,4) not null default 0,
  preco_venda numeric(14,4) not null default 0,
  preco_minimo numeric(14,4),
  estoque_minimo numeric(14,3) not null default 0,
  validade_dias integer,
  controla_lote boolean not null default true,
  visivel_app boolean not null default true,
  foto_url text,
  criado_em timestamptz not null default now(),
  criado_por uuid,
  alterado_em timestamptz not null default now(),
  alterado_por uuid,
  ativo boolean not null default true,
  unique (empresa_id, codigo)
);
create index produtos_busca_idx on public.produtos
  using gin (to_tsvector('simple', public.fn_normaliza(nome || ' ' || codigo || ' ' || coalesce(codigo_barras, ''))));

create table public.tabelas_preco_itens (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default public.empresa_atual() references public.empresas(id) on delete cascade,
  tabela_preco_id uuid not null references public.tabelas_preco(id) on delete cascade,
  produto_id uuid not null references public.produtos(id) on delete cascade,
  preco numeric(14,4) not null,
  preco_minimo numeric(14,4),
  criado_em timestamptz not null default now(),
  criado_por uuid,
  alterado_em timestamptz not null default now(),
  alterado_por uuid,
  ativo boolean not null default true,
  unique (tabela_preco_id, produto_id)
);

-- ---------------------------------------------------------------------
-- ESTOQUE (lote e validade obrigatórios para congelados)
-- ---------------------------------------------------------------------

create table public.lotes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default public.empresa_atual() references public.empresas(id) on delete cascade,
  produto_id uuid not null references public.produtos(id) on delete cascade,
  numero text not null,
  fabricacao date,
  validade date not null,
  criado_em timestamptz not null default now(),
  criado_por uuid,
  alterado_em timestamptz not null default now(),
  alterado_por uuid,
  ativo boolean not null default true,
  unique (produto_id, numero)
);
create index lotes_validade_idx on public.lotes (produto_id, validade);

create table public.estoque_saldos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  deposito_id uuid not null references public.depositos(id) on delete cascade,
  produto_id uuid not null references public.produtos(id) on delete cascade,
  lote_id uuid references public.lotes(id) on delete cascade,
  quantidade numeric(14,3) not null default 0,
  quantidade_reservada numeric(14,3) not null default 0,
  alterado_em timestamptz not null default now()
);
create unique index estoque_saldos_un
  on public.estoque_saldos (deposito_id, produto_id, coalesce(lote_id, '00000000-0000-0000-0000-000000000000'::uuid));

create table public.estoque_movimentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default public.empresa_atual() references public.empresas(id) on delete cascade,
  data timestamptz not null default now(),
  tipo text not null check (tipo in ('entrada', 'saida', 'ajuste_entrada', 'ajuste_saida', 'perda', 'transferencia_saida', 'transferencia_entrada', 'devolucao')),
  deposito_id uuid not null references public.depositos(id),
  produto_id uuid not null references public.produtos(id),
  lote_id uuid references public.lotes(id),
  quantidade numeric(14,3) not null check (quantidade > 0),
  custo_unitario numeric(14,4),
  origem text not null default 'manual' check (origem in ('manual', 'pedido', 'nota_entrada', 'inventario', 'expedicao', 'transferencia')),
  origem_id uuid,
  observacao text,
  criado_em timestamptz not null default now(),
  criado_por uuid,
  alterado_em timestamptz not null default now(),
  alterado_por uuid,
  ativo boolean not null default true
);
create index estoque_mov_produto_idx on public.estoque_movimentos (produto_id, data desc);

-- Atualiza saldo a cada movimento
create or replace function public.fn_estoque_movimento_saldo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sinal numeric;
begin
  v_sinal := case when new.tipo in ('entrada', 'ajuste_entrada', 'transferencia_entrada', 'devolucao') then 1 else -1 end;

  insert into public.estoque_saldos (empresa_id, deposito_id, produto_id, lote_id, quantidade)
  values (new.empresa_id, new.deposito_id, new.produto_id, new.lote_id, v_sinal * new.quantidade)
  on conflict (deposito_id, produto_id, coalesce(lote_id, '00000000-0000-0000-0000-000000000000'::uuid))
  do update set quantidade = public.estoque_saldos.quantidade + excluded.quantidade,
                alterado_em = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- VENDAS
-- ---------------------------------------------------------------------

create table public.pedidos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default public.empresa_atual() references public.empresas(id) on delete cascade,
  numero bigint,
  tipo text not null default 'pedido' check (tipo in ('orcamento', 'pedido')),
  status text not null default 'rascunho'
    check (status in ('rascunho', 'aguardando_credito', 'aprovado', 'em_separacao', 'faturado', 'em_rota', 'entregue', 'devolvido', 'cancelado')),
  origem text not null default 'web' check (origem in ('web', 'app')),
  -- identificador gerado no celular para evitar pedido duplicado na sincronização
  id_local text,
  cliente_id uuid not null references public.pessoas(id),
  vendedor_id uuid references public.pessoas(id),
  rota_id uuid references public.rotas(id),
  tabela_preco_id uuid references public.tabelas_preco(id),
  condicao_pagamento_id uuid references public.condicoes_pagamento(id),
  forma_pagamento_id uuid references public.formas_pagamento(id),
  deposito_id uuid references public.depositos(id),
  data_emissao timestamptz not null default now(),
  data_entrega date,
  validade date,
  valor_produtos numeric(14,2) not null default 0,
  valor_desconto numeric(14,2) not null default 0,
  valor_frete numeric(14,2) not null default 0,
  valor_total numeric(14,2) not null default 0,
  peso_total_kg numeric(12,3) not null default 0,
  credito_liberado_por uuid,
  credito_liberado_em timestamptz,
  motivo_cancelamento text,
  pedido_cliente text,
  observacao text,
  observacao_nfe text,
  criado_em timestamptz not null default now(),
  criado_por uuid,
  alterado_em timestamptz not null default now(),
  alterado_por uuid,
  ativo boolean not null default true,
  unique (empresa_id, numero),
  unique (empresa_id, id_local)
);
create index pedidos_cliente_idx on public.pedidos (cliente_id, data_emissao desc);
create index pedidos_status_idx on public.pedidos (empresa_id, status);

create table public.pedidos_itens (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default public.empresa_atual() references public.empresas(id) on delete cascade,
  pedido_id uuid not null references public.pedidos(id) on delete cascade,
  produto_id uuid not null references public.produtos(id),
  lote_id uuid references public.lotes(id),
  quantidade numeric(14,3) not null check (quantidade > 0),
  preco_unitario numeric(14,4) not null,
  desconto numeric(14,2) not null default 0,
  valor_total numeric(14,2) not null default 0,
  ordem integer not null default 0,
  criado_em timestamptz not null default now(),
  criado_por uuid,
  alterado_em timestamptz not null default now(),
  alterado_por uuid,
  ativo boolean not null default true
);
create index pedidos_itens_pedido_idx on public.pedidos_itens (pedido_id);

-- Número sequencial do pedido
create or replace function public.fn_pedido_numero()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.numero is null then
    new.numero := public.proximo_numero(new.empresa_id, 'pedido');
  end if;
  return new;
end;
$$;

-- Total do item
create or replace function public.fn_pedido_item_total()
returns trigger
language plpgsql
as $$
begin
  new.valor_total := round(new.quantidade * new.preco_unitario - coalesce(new.desconto, 0), 2);
  return new;
end;
$$;

-- Recalcula totais do pedido a partir dos itens
create or replace function public.fn_pedido_recalcula(p_pedido uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.pedidos p
     set valor_produtos = coalesce(t.produtos, 0),
         peso_total_kg = coalesce(t.peso, 0),
         valor_total = coalesce(t.produtos, 0) - p.valor_desconto + p.valor_frete
    from (
      select sum(i.valor_total) as produtos,
             sum(i.quantidade * coalesce(pr.peso_bruto_kg, pr.peso_liquido_kg, 0)) as peso
        from public.pedidos_itens i
        join public.produtos pr on pr.id = i.produto_id
       where i.pedido_id = p_pedido and i.ativo
    ) t
   where p.id = p_pedido;
end;
$$;

create or replace function public.fn_pedido_itens_apos()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.fn_pedido_recalcula(coalesce(new.pedido_id, old.pedido_id));
  return null;
end;
$$;

create or replace function public.fn_pedido_totais_cabecalho()
returns trigger
language plpgsql
as $$
begin
  new.valor_total := new.valor_produtos - new.valor_desconto + new.valor_frete;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- EXPEDIÇÃO
-- ---------------------------------------------------------------------

create table public.veiculos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default public.empresa_atual() references public.empresas(id) on delete cascade,
  placa text not null,
  descricao text,
  uf char(2),
  rntrc text,
  capacidade_kg numeric(10,2),
  criado_em timestamptz not null default now(),
  criado_por uuid,
  alterado_em timestamptz not null default now(),
  alterado_por uuid,
  ativo boolean not null default true,
  unique (empresa_id, placa)
);

create table public.expedicoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default public.empresa_atual() references public.empresas(id) on delete cascade,
  numero bigint,
  data date not null default current_date,
  rota_id uuid references public.rotas(id),
  motorista_id uuid references public.pessoas(id),
  veiculo_id uuid references public.veiculos(id),
  status text not null default 'montando'
    check (status in ('montando', 'separando', 'carregado', 'em_rota', 'concluida', 'cancelada')),
  responsavel_separacao uuid,
  observacao text,
  criado_em timestamptz not null default now(),
  criado_por uuid,
  alterado_em timestamptz not null default now(),
  alterado_por uuid,
  ativo boolean not null default true,
  unique (empresa_id, numero)
);

create table public.expedicoes_pedidos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default public.empresa_atual() references public.empresas(id) on delete cascade,
  expedicao_id uuid not null references public.expedicoes(id) on delete cascade,
  pedido_id uuid not null references public.pedidos(id),
  ordem_entrega integer,
  status_entrega text not null default 'pendente'
    check (status_entrega in ('pendente', 'entregue', 'devolvido_total', 'devolvido_parcial', 'ausente')),
  entregue_em timestamptz,
  canhoto_url text,
  motivo_devolucao text,
  latitude numeric(10,7),
  longitude numeric(10,7),
  criado_em timestamptz not null default now(),
  criado_por uuid,
  alterado_em timestamptz not null default now(),
  alterado_por uuid,
  ativo boolean not null default true,
  unique (expedicao_id, pedido_id)
);

create or replace function public.fn_expedicao_numero()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.numero is null then
    new.numero := public.proximo_numero(new.empresa_id, 'expedicao');
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- FISCAL
-- ---------------------------------------------------------------------

create table public.notas_fiscais (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default public.empresa_atual() references public.empresas(id) on delete cascade,
  pedido_id uuid references public.pedidos(id),
  pessoa_id uuid references public.pessoas(id),
  modelo text not null default '55',
  serie integer not null,
  numero integer not null,
  chave text,
  status text not null default 'rascunho'
    check (status in ('rascunho', 'processando', 'autorizada', 'rejeitada', 'cancelada', 'denegada', 'inutilizada')),
  ambiente text not null default 'homologacao',
  natureza_operacao text not null default 'Venda de mercadoria',
  data_emissao timestamptz,
  protocolo text,
  motivo_status text,
  valor_produtos numeric(14,2) not null default 0,
  valor_desconto numeric(14,2) not null default 0,
  valor_frete numeric(14,2) not null default 0,
  valor_total numeric(14,2) not null default 0,
  xml_url text,
  pdf_url text,
  provedor_id text,
  criado_em timestamptz not null default now(),
  criado_por uuid,
  alterado_em timestamptz not null default now(),
  alterado_por uuid,
  ativo boolean not null default true,
  unique (empresa_id, modelo, serie, numero)
);

create table public.notas_fiscais_eventos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default public.empresa_atual() references public.empresas(id) on delete cascade,
  nota_fiscal_id uuid not null references public.notas_fiscais(id) on delete cascade,
  tipo text not null check (tipo in ('cancelamento', 'carta_correcao')),
  sequencia integer not null default 1,
  justificativa text not null,
  protocolo text,
  status text not null default 'processando',
  xml_url text,
  criado_em timestamptz not null default now(),
  criado_por uuid,
  alterado_em timestamptz not null default now(),
  alterado_por uuid,
  ativo boolean not null default true
);

-- ---------------------------------------------------------------------
-- FINANCEIRO
-- ---------------------------------------------------------------------

create table public.lancamentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default public.empresa_atual() references public.empresas(id) on delete cascade,
  tipo text not null check (tipo in ('receber', 'pagar')),
  pessoa_id uuid references public.pessoas(id),
  plano_conta_id uuid references public.plano_contas(id),
  centro_custo_id uuid references public.centros_custo(id),
  conta_bancaria_id uuid references public.contas_bancarias(id),
  forma_pagamento_id uuid references public.formas_pagamento(id),
  descricao text not null,
  documento text,
  parcela integer not null default 1,
  total_parcelas integer not null default 1,
  valor numeric(14,2) not null check (valor > 0),
  data_competencia date not null default current_date,
  data_vencimento date not null,
  data_quitacao date,
  valor_pago numeric(14,2),
  juros numeric(14,2) not null default 0,
  multa numeric(14,2) not null default 0,
  desconto numeric(14,2) not null default 0,
  origem text not null default 'manual' check (origem in ('manual', 'pedido', 'nota_entrada', 'ofx')),
  origem_id uuid,
  conciliado boolean not null default false,
  observacao text,
  criado_em timestamptz not null default now(),
  criado_por uuid,
  alterado_em timestamptz not null default now(),
  alterado_por uuid,
  ativo boolean not null default true
);
create index lancamentos_venc_idx on public.lancamentos (empresa_id, tipo, data_vencimento);
create index lancamentos_pessoa_idx on public.lancamentos (pessoa_id);

-- Situação calculada (não gravada) para listas e relatórios
create or replace view public.vw_lancamentos
with (security_invoker = true)
as
select l.*,
       case
         when l.data_quitacao is not null then 'quitado'
         when l.data_vencimento < current_date then 'atrasado'
         when l.data_vencimento = current_date then 'vence_hoje'
         else 'em_aberto'
       end as situacao,
       p.razao_social as pessoa_nome,
       pc.nome as plano_conta_nome
  from public.lancamentos l
  left join public.pessoas p on p.id = l.pessoa_id
  left join public.plano_contas pc on pc.id = l.plano_conta_id
 where l.ativo;

create table public.boletos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default public.empresa_atual() references public.empresas(id) on delete cascade,
  lancamento_id uuid not null references public.lancamentos(id) on delete cascade,
  conta_bancaria_id uuid not null references public.contas_bancarias(id),
  nosso_numero text,
  linha_digitavel text,
  codigo_barras text,
  pix_copia_cola text,
  status text not null default 'pendente'
    check (status in ('pendente', 'registrado', 'pago', 'baixado', 'vencido', 'erro')),
  valor numeric(14,2) not null,
  data_vencimento date not null,
  data_pagamento date,
  valor_pago numeric(14,2),
  pdf_url text,
  mensagem_erro text,
  criado_em timestamptz not null default now(),
  criado_por uuid,
  alterado_em timestamptz not null default now(),
  alterado_por uuid,
  ativo boolean not null default true
);

-- Situação de crédito do cliente: limite, aberto e atraso
create or replace view public.vw_credito_clientes
with (security_invoker = true)
as
select p.id as pessoa_id,
       p.empresa_id,
       p.limite_credito,
       p.bloqueado,
       coalesce(sum(l.valor) filter (where l.data_quitacao is null), 0) as em_aberto,
       coalesce(sum(l.valor) filter (where l.data_quitacao is null and l.data_vencimento < current_date), 0) as em_atraso
  from public.pessoas p
  left join public.lancamentos l on l.pessoa_id = p.id and l.tipo = 'receber' and l.ativo
 where p.eh_cliente
 group by p.id;

-- ---------------------------------------------------------------------
-- VIEWS de estoque
-- ---------------------------------------------------------------------

create or replace view public.vw_estoque
with (security_invoker = true)
as
select s.empresa_id,
       s.deposito_id,
       d.nome as deposito_nome,
       s.produto_id,
       pr.codigo as produto_codigo,
       pr.nome as produto_nome,
       s.lote_id,
       lo.numero as lote_numero,
       lo.validade,
       (lo.validade - current_date) as dias_para_vencer,
       s.quantidade,
       s.quantidade_reservada,
       s.quantidade - s.quantidade_reservada as disponivel
  from public.estoque_saldos s
  join public.depositos d on d.id = s.deposito_id
  join public.produtos pr on pr.id = s.produto_id
  left join public.lotes lo on lo.id = s.lote_id
 where s.quantidade <> 0 or s.quantidade_reservada <> 0;

-- ---------------------------------------------------------------------
-- TRIGGERS
-- ---------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'empresas', 'perfis', 'usuarios', 'categorias', 'marcas', 'unidades', 'formas_pagamento',
    'condicoes_pagamento', 'plano_contas', 'centros_custo', 'depositos', 'contas_bancarias',
    'grupos_tributarios', 'rotas', 'tabelas_preco', 'pessoas', 'pessoas_enderecos', 'pessoas_contatos',
    'produtos', 'tabelas_preco_itens', 'lotes', 'estoque_movimentos', 'pedidos', 'pedidos_itens',
    'veiculos', 'expedicoes', 'expedicoes_pedidos', 'notas_fiscais', 'notas_fiscais_eventos',
    'lancamentos', 'boletos'
  ] loop
    execute format('create trigger trg_%1$s_auditoria before insert or update on public.%1$I
                    for each row execute function public.fn_auditoria()', t);
  end loop;
end;
$$;

create or replace function public.fn_pessoa_codigo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.codigo is null then
    new.codigo := public.proximo_numero(new.empresa_id, 'pessoa');
  end if;
  new.documento := nullif(regexp_replace(coalesce(new.documento, ''), '\D', '', 'g'), '');
  return new;
end;
$$;

create trigger trg_pessoas_codigo before insert or update on public.pessoas
  for each row execute function public.fn_pessoa_codigo();
create trigger trg_pedidos_numero before insert on public.pedidos
  for each row execute function public.fn_pedido_numero();
create trigger trg_pedidos_totais before update of valor_desconto, valor_frete, valor_produtos on public.pedidos
  for each row execute function public.fn_pedido_totais_cabecalho();
create trigger trg_pedidos_itens_total before insert or update on public.pedidos_itens
  for each row execute function public.fn_pedido_item_total();
create trigger trg_pedidos_itens_recalcula after insert or update or delete on public.pedidos_itens
  for each row execute function public.fn_pedido_itens_apos();
create trigger trg_expedicoes_numero before insert on public.expedicoes
  for each row execute function public.fn_expedicao_numero();
create trigger trg_estoque_mov_saldo after insert on public.estoque_movimentos
  for each row execute function public.fn_estoque_movimento_saldo();

-- >>> supabase/migrations/20261014000002_seguranca.sql
-- =====================================================================
-- Segurança: RLS por empresa + permissão por módulo do perfil
-- =====================================================================

-- Cria as 4 políticas padrão de uma tabela ligada a um módulo
create or replace function public.fn_cria_politicas(p_tabela text, p_modulo text)
returns void
language plpgsql
as $$
begin
  execute format('alter table public.%I enable row level security', p_tabela);
  execute format($f$create policy "%1$s_ver" on public.%1$I for select to authenticated
                   using (empresa_id = public.empresa_atual() and public.tem_permissao(%2$L, 'ver'))$f$, p_tabela, p_modulo);
  execute format($f$create policy "%1$s_criar" on public.%1$I for insert to authenticated
                   with check (empresa_id = public.empresa_atual() and public.tem_permissao(%2$L, 'criar'))$f$, p_tabela, p_modulo);
  execute format($f$create policy "%1$s_editar" on public.%1$I for update to authenticated
                   using (empresa_id = public.empresa_atual() and public.tem_permissao(%2$L, 'editar'))
                   with check (empresa_id = public.empresa_atual() and public.tem_permissao(%2$L, 'editar'))$f$, p_tabela, p_modulo);
  execute format($f$create policy "%1$s_excluir" on public.%1$I for delete to authenticated
                   using (empresa_id = public.empresa_atual() and public.tem_permissao(%2$L, 'excluir'))$f$, p_tabela, p_modulo);
end;
$$;

do $$ declare t text; begin foreach t in array array[
  'categorias', 'marcas', 'unidades', 'formas_pagamento', 'condicoes_pagamento', 'depositos',
  'rotas', 'tabelas_preco', 'tabelas_preco_itens', 'pessoas', 'pessoas_enderecos',
  'pessoas_contatos', 'produtos', 'veiculos'
] loop perform public.fn_cria_politicas(t, 'cadastros'); end loop; end $$;

do $$ declare t text; begin foreach t in array array[
  'plano_contas', 'centros_custo', 'contas_bancarias', 'lancamentos', 'boletos'
] loop perform public.fn_cria_politicas(t, 'financeiro'); end loop; end $$;

do $$ declare t text; begin foreach t in array array['pedidos', 'pedidos_itens'] loop perform public.fn_cria_politicas(t, 'vendas'); end loop; end $$;
do $$ declare t text; begin foreach t in array array['expedicoes', 'expedicoes_pedidos'] loop perform public.fn_cria_politicas(t, 'expedicao'); end loop; end $$;
do $$ declare t text; begin foreach t in array array['notas_fiscais', 'notas_fiscais_eventos', 'grupos_tributarios'] loop perform public.fn_cria_politicas(t, 'fiscal'); end loop; end $$;
do $$ declare t text; begin foreach t in array array['lotes'] loop perform public.fn_cria_politicas(t, 'estoque'); end loop; end $$;

-- Movimentos de estoque: só incluir, nunca alterar ou apagar (correção = novo movimento)
alter table public.estoque_movimentos enable row level security;
create policy "estoque_movimentos_ver" on public.estoque_movimentos for select to authenticated
  using (empresa_id = public.empresa_atual() and public.tem_permissao('estoque', 'ver'));
create policy "estoque_movimentos_criar" on public.estoque_movimentos for insert to authenticated
  with check (empresa_id = public.empresa_atual() and public.tem_permissao('estoque', 'criar'));

-- Saldos: só leitura (gravados pelo gatilho dos movimentos)
alter table public.estoque_saldos enable row level security;
create policy "estoque_saldos_ver" on public.estoque_saldos for select to authenticated
  using (empresa_id = public.empresa_atual()
         and (public.tem_permissao('estoque', 'ver') or public.tem_permissao('vendas', 'ver')));

-- Numeradores: acesso só pelas funções
alter table public.numeradores enable row level security;

-- Empresa: todos da empresa leem, só configurações edita
alter table public.empresas enable row level security;
create policy "empresas_ver" on public.empresas for select to authenticated
  using (id = public.empresa_atual());
create policy "empresas_editar" on public.empresas for update to authenticated
  using (id = public.empresa_atual() and public.tem_permissao('configuracoes', 'editar'))
  with check (id = public.empresa_atual() and public.tem_permissao('configuracoes', 'editar'));

-- Perfis: todos da empresa leem (o menu depende disso), configurações administra
alter table public.perfis enable row level security;
create policy "perfis_ver" on public.perfis for select to authenticated
  using (empresa_id = public.empresa_atual());
create policy "perfis_criar" on public.perfis for insert to authenticated
  with check (empresa_id = public.empresa_atual() and public.tem_permissao('configuracoes', 'criar'));
create policy "perfis_editar" on public.perfis for update to authenticated
  using (empresa_id = public.empresa_atual() and public.tem_permissao('configuracoes', 'editar'))
  with check (empresa_id = public.empresa_atual() and public.tem_permissao('configuracoes', 'editar'));
create policy "perfis_excluir" on public.perfis for delete to authenticated
  using (empresa_id = public.empresa_atual() and public.tem_permissao('configuracoes', 'excluir') and not administrador);

-- Usuários: cada um lê o próprio registro; configurações lê e edita todos da empresa
alter table public.usuarios enable row level security;
create policy "usuarios_ver_proprio" on public.usuarios for select to authenticated
  using (id = auth.uid());
create policy "usuarios_ver" on public.usuarios for select to authenticated
  using (empresa_id = public.empresa_atual() and public.tem_permissao('configuracoes', 'ver'));
create policy "usuarios_editar" on public.usuarios for update to authenticated
  using (empresa_id = public.empresa_atual() and public.tem_permissao('configuracoes', 'editar'))
  with check (empresa_id = public.empresa_atual() and public.tem_permissao('configuracoes', 'editar'));

-- Usuário não pode trocar o próprio perfil nem se desativar
create or replace function public.fn_usuario_protege_proprio()
returns trigger
language plpgsql
as $$
begin
  if new.id = auth.uid() and (new.perfil_id is distinct from old.perfil_id or new.ativo is distinct from old.ativo) then
    raise exception 'Você não pode alterar o próprio perfil nem desativar o próprio acesso.';
  end if;
  return new;
end;
$$;
create trigger trg_usuarios_protege before update on public.usuarios
  for each row execute function public.fn_usuario_protege_proprio();

-- ---------------------------------------------------------------------
-- Novo login: liga o usuário do Supabase Auth à empresa e ao perfil
-- 1) convite feito pelo sistema traz empresa_id e perfil_id nos metadados
-- 2) o primeiríssimo usuário vira administrador da empresa cadastrada
-- 3) qualquer outro cadastro espontâneo fica sem acesso
-- ---------------------------------------------------------------------
create or replace function public.fn_novo_usuario()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_empresa uuid;
  v_perfil uuid;
  v_nome text;
begin
  v_nome := coalesce(new.raw_user_meta_data ->> 'nome', split_part(new.email, '@', 1));

  if new.raw_user_meta_data ? 'empresa_id' then
    v_empresa := (new.raw_user_meta_data ->> 'empresa_id')::uuid;
    v_perfil := nullif(new.raw_user_meta_data ->> 'perfil_id', '')::uuid;
    insert into public.usuarios (id, empresa_id, perfil_id, nome, email, criado_por)
    values (new.id, v_empresa, v_perfil, v_nome, new.email, new.id);
  elsif not exists (select 1 from public.usuarios) then
    select id into v_empresa from public.empresas order by criado_em limit 1;
    if v_empresa is not null then
      select id into v_perfil from public.perfis where empresa_id = v_empresa and administrador limit 1;
      insert into public.usuarios (id, empresa_id, perfil_id, nome, email, criado_por)
      values (new.id, v_empresa, v_perfil, v_nome, new.email, new.id);
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_auth_novo_usuario
  after insert on auth.users
  for each row execute function public.fn_novo_usuario();

-- Funções internas não ficam expostas pela API
revoke execute on function public.proximo_numero(uuid, text) from public, anon, authenticated;
revoke execute on function public.fn_cria_politicas(text, text) from public, anon, authenticated;
revoke execute on function public.fn_pedido_recalcula(uuid) from public, anon, authenticated;

-- >>> supabase/migrations/20261014000003_dados_iniciais.sql
-- =====================================================================
-- Dados iniciais da Elos
-- CNPJ e dados cadastrais ficam provisórios e são ajustados em
-- Configurações > Empresa pelo administrador.
-- =====================================================================

do $$
declare
  e uuid;
  todos jsonb := '{"ver": true, "criar": true, "editar": true, "excluir": true}';
  sem_excluir jsonb := '{"ver": true, "criar": true, "editar": true, "excluir": false}';
  ver jsonb := '{"ver": true, "criar": false, "editar": false, "excluir": false}';
begin
  insert into public.empresas (cnpj, razao_social, nome_fantasia, regime_tributario, cidade, uf, codigo_ibge)
  values ('00000000000000', 'Elos Distribuidora (ajustar razão social)', 'Elos', 'simples_nacional', 'Campo Grande', 'MS', '5002704')
  returning id into e;

  -- Perfis de acesso
  insert into public.perfis (empresa_id, nome, descricao, administrador, permissoes) values
  (e, 'Administrador', 'Acesso total ao sistema', true, '{}'),
  (e, 'Escritório', 'Cadastros, pedidos, expedição e notas',
     false, jsonb_build_object('cadastros', sem_excluir, 'vendas', sem_excluir, 'expedicao', sem_excluir,
                               'estoque', sem_excluir, 'fiscal', sem_excluir, 'financeiro', ver, 'relatorios', ver)),
  (e, 'Financeiro', 'Contas a pagar e receber, boletos e crédito',
     false, jsonb_build_object('cadastros', sem_excluir, 'vendas', ver, 'financeiro', todos, 'fiscal', ver, 'relatorios', ver)),
  (e, 'Vendedor', 'App de força de vendas: carteira, pedidos e metas',
     false, jsonb_build_object('cadastros', ver, 'vendas', '{"ver": true, "criar": true, "editar": true, "excluir": false}'::jsonb)),
  (e, 'Expedição', 'Separação, carga e estoque',
     false, jsonb_build_object('cadastros', ver, 'vendas', ver, 'expedicao', sem_excluir, 'estoque', sem_excluir)),
  (e, 'Motorista', 'Entregas no celular',
     false, jsonb_build_object('cadastros', ver, 'expedicao', '{"ver": true, "criar": false, "editar": true, "excluir": false}'::jsonb));

  -- Unidades
  insert into public.unidades (empresa_id, sigla, descricao) values
  (e, 'UN', 'Unidade'), (e, 'PCT', 'Pacote'), (e, 'CX', 'Caixa'), (e, 'KG', 'Quilograma'), (e, 'FD', 'Fardo');

  -- Formas de pagamento (código tPag da NF-e)
  insert into public.formas_pagamento (empresa_id, nome, codigo_nfe, gera_boleto) values
  (e, 'Boleto', '15', true),
  (e, 'PIX', '17', false),
  (e, 'Dinheiro', '01', false),
  (e, 'Cartão de débito', '04', false),
  (e, 'Cartão de crédito', '03', false),
  (e, 'Transferência bancária', '18', false);

  -- Condições de pagamento
  insert into public.condicoes_pagamento (empresa_id, nome, parcelas_dias) values
  (e, 'À vista', '{0}'),
  (e, '7 dias', '{7}'),
  (e, '14 dias', '{14}'),
  (e, '21 dias', '{21}'),
  (e, '28 dias', '{28}'),
  (e, '14/28 dias', '{14,28}'),
  (e, '28/35/42 dias', '{28,35,42}');

  -- Depósitos
  insert into public.depositos (empresa_id, nome, tipo, padrao) values
  (e, 'Câmara fria', 'camara_fria', true),
  (e, 'Expedição', 'expedicao', false),
  (e, 'Avarias e vencidos', 'avaria', false);

  -- Categorias de produto (linha de congelados da Elos)
  insert into public.categorias (empresa_id, nome) values
  (e, 'Salgados'), (e, 'Pão de queijo'), (e, 'Pães'), (e, 'Doces');

  insert into public.marcas (empresa_id, nome) values (e, 'Top Sabores');

  -- Tabela de preço padrão
  insert into public.tabelas_preco (empresa_id, nome, padrao) values (e, 'Tabela padrão', true);

  -- Grupo tributário inicial (Simples Nacional, sem ST) — validar com o contador
  insert into public.grupos_tributarios (empresa_id, nome, cfop_dentro_uf, cfop_fora_uf, csosn, observacao) values
  (e, 'Simples Nacional - tributado sem ST', '5102', '6102', '102', 'Grupo inicial. Validar CSOSN, CFOP e ICMS-ST com o contador antes de emitir em produção.');

  -- Centros de custo
  insert into public.centros_custo (empresa_id, nome) values
  (e, 'Comercial'), (e, 'Logística'), (e, 'Administrativo');

  -- Conta inicial
  insert into public.contas_bancarias (empresa_id, nome, banco_codigo, emite_boleto) values
  (e, 'Sicredi', '748', true),
  (e, 'Caixa da empresa', null, false);

  -- Plano de contas gerencial simples
  insert into public.plano_contas (empresa_id, codigo, nome, tipo, grupo_dre) values
  (e, '1', 'Receitas', 'receita', null),
  (e, '1.01', 'Venda de mercadorias', 'receita', 'Receita bruta'),
  (e, '1.02', 'Outras receitas', 'receita', 'Outras receitas'),
  (e, '1.03', 'Receitas financeiras', 'receita', 'Resultado financeiro'),
  (e, '2', 'Custos e despesas', 'despesa', null),
  (e, '2.01', 'Compra de mercadorias', 'despesa', 'Custo das mercadorias'),
  (e, '2.02', 'Fretes e entregas', 'despesa', 'Despesas comerciais'),
  (e, '2.03', 'Comissões de vendedores', 'despesa', 'Despesas comerciais'),
  (e, '2.04', 'Combustível e manutenção de veículos', 'despesa', 'Despesas comerciais'),
  (e, '2.05', 'Salários e encargos', 'despesa', 'Despesas com pessoal'),
  (e, '2.06', 'Aluguel e condomínio', 'despesa', 'Despesas administrativas'),
  (e, '2.07', 'Energia elétrica', 'despesa', 'Despesas administrativas'),
  (e, '2.08', 'Água, telefone e internet', 'despesa', 'Despesas administrativas'),
  (e, '2.09', 'Contabilidade e sistemas', 'despesa', 'Despesas administrativas'),
  (e, '2.10', 'Impostos (DAS do Simples)', 'despesa', 'Impostos sobre vendas'),
  (e, '2.11', 'Tarifas bancárias e juros', 'despesa', 'Resultado financeiro'),
  (e, '2.12', 'Marketing e tráfego pago', 'despesa', 'Despesas comerciais'),
  (e, '2.13', 'Perdas e avarias', 'despesa', 'Custo das mercadorias'),
  (e, '2.99', 'Outras despesas', 'despesa', 'Outras despesas');

  update public.plano_contas c set pai_id = p.id
    from public.plano_contas p
   where c.empresa_id = e and p.empresa_id = e
     and p.codigo = split_part(c.codigo, '.', 1) and c.codigo like '%.%';
end;
$$;
