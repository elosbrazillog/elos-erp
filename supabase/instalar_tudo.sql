-- Instalação completa do banco do Elos ERP (todas as migrations em ordem).
-- Cole tudo no SQL Editor do Supabase e clique em Run.

-- >>> supabase/migrations/20261014000001_schema.sql
-- =====================================================================
-- ERP Elos — Schema da versão 1
-- Padrão de toda tabela: id, empresa_id, criado_em, criado_por,
-- alterado_em, alterado_por, ativo.
-- =====================================================================

create extension if not exists pgcrypto;
create extension if not exists unaccent with schema public;

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

-- >>> supabase/migrations/20261014000004_empresa_parametros_nfe.sql
-- Parâmetros fiscais padrão da NF-e no cadastro da empresa
alter table public.empresas
  add column if not exists nfe_natureza_operacao text not null default 'Venda de mercadoria',
  add column if not exists nfe_pis_cofins_cst text not null default '49',
  add column if not exists nfe_modalidade_frete smallint not null default 0
    check (nfe_modalidade_frete in (0, 1, 2, 3, 4, 9)),
  add column if not exists nfe_info_complementares text;

-- =====================================================================
-- Fase 2 · Vendas e estoque
-- Pedido confirmado reserva estoque por lote (vencimento mais próximo
-- primeiro) e passa pela trava de crédito. Situação do pedido e saldos
-- só mudam pelas funções abaixo, nunca direto pela tela.
-- =====================================================================

alter table public.pedidos add column if not exists motivo_trava text;

-- Sinal de que a alteração vem de uma função de regra (vale só na transação)
create or replace function public.fn_via_regra()
returns boolean
language sql
stable
as $$
  select coalesce(current_setting('elos.regra', true), '') = '1';
$$;

-- Valor em reais para mensagens: 1234.5 -> R$ 1.234,50
create or replace function public.fn_brl(v numeric)
returns text
language sql
immutable
as $$
  select 'R$ ' || translate(to_char(coalesce(v, 0), 'FM999,999,999,990.00'), ',.', '.,');
$$;

-- Quantidade sem zeros sobrando: 12.000 -> 12, 1.500 -> 1,5
create or replace function public.fn_qtd(v numeric)
returns text
language sql
immutable
as $$
  select replace(trim(trailing '.' from trim(trailing '0' from to_char(coalesce(v, 0), 'FM999999999990.000'))), '.', ',');
$$;

-- Nome do usuário (para listas de histórico), só da mesma empresa
create or replace function public.fn_nome_usuario(p_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select nome from public.usuarios where id = p_id and empresa_id = public.empresa_atual();
$$;

-- ---------------------------------------------------------------------
-- Reservas de estoque por lote
-- ---------------------------------------------------------------------
create table public.pedidos_reservas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  pedido_id uuid not null references public.pedidos(id) on delete cascade,
  pedido_item_id uuid not null references public.pedidos_itens(id) on delete cascade,
  estoque_saldo_id uuid not null references public.estoque_saldos(id),
  deposito_id uuid not null references public.depositos(id),
  produto_id uuid not null references public.produtos(id),
  lote_id uuid references public.lotes(id),
  quantidade numeric(14,3) not null check (quantidade > 0),
  criado_em timestamptz not null default now()
);
create index pedidos_reservas_pedido_idx on public.pedidos_reservas (pedido_id);
create index pedidos_reservas_saldo_idx on public.pedidos_reservas (estoque_saldo_id);

alter table public.pedidos_reservas enable row level security;
create policy "pedidos_reservas_ver" on public.pedidos_reservas for select to authenticated
  using (empresa_id = public.empresa_atual()
         and (public.tem_permissao('vendas', 'ver') or public.tem_permissao('estoque', 'ver')));

-- ---------------------------------------------------------------------
-- Inventário
-- ---------------------------------------------------------------------
create table public.inventarios (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default public.empresa_atual() references public.empresas(id) on delete cascade,
  numero bigint,
  deposito_id uuid not null references public.depositos(id),
  data date not null default current_date,
  status text not null default 'aberto' check (status in ('aberto', 'concluido', 'cancelado')),
  observacao text,
  concluido_em timestamptz,
  concluido_por uuid,
  criado_em timestamptz not null default now(),
  criado_por uuid,
  alterado_em timestamptz not null default now(),
  alterado_por uuid,
  ativo boolean not null default true,
  unique (empresa_id, numero)
);

create table public.inventarios_itens (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default public.empresa_atual() references public.empresas(id) on delete cascade,
  inventario_id uuid not null references public.inventarios(id) on delete cascade,
  produto_id uuid not null references public.produtos(id),
  lote_id uuid references public.lotes(id),
  -- lote encontrado na contagem que ainda não existe no sistema
  lote_numero text,
  validade date,
  quantidade_sistema numeric(14,3) not null default 0,
  quantidade_contada numeric(14,3) check (quantidade_contada >= 0),
  diferenca numeric(14,3),
  criado_em timestamptz not null default now(),
  criado_por uuid,
  alterado_em timestamptz not null default now(),
  alterado_por uuid,
  ativo boolean not null default true
);
create index inventarios_itens_inv_idx on public.inventarios_itens (inventario_id);
-- o mesmo lote não entra duas vezes na mesma contagem
create unique index inventarios_itens_un on public.inventarios_itens
  (inventario_id, produto_id, coalesce(lote_id::text, coalesce(upper(lote_numero), '') || '|' || coalesce((validade - date '2000-01-01')::text, '')));

do $$ declare t text; begin foreach t in array array['inventarios', 'inventarios_itens'] loop
  perform public.fn_cria_politicas(t, 'estoque');
  execute format('create trigger trg_%1$s_auditoria before insert or update on public.%1$I
                  for each row execute function public.fn_auditoria()', t);
end loop; end $$;

-- Itens do inventário só mudam enquanto ele está aberto
create or replace function public.fn_inventario_item_protege()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  select status into v_status from public.inventarios where id = coalesce(new.inventario_id, old.inventario_id);
  if v_status is not null and v_status <> 'aberto' and not public.fn_via_regra() then
    raise exception 'Este inventário já foi encerrado e não pode mais ser alterado.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if tg_op = 'INSERT' and not public.fn_via_regra() then
    new.quantidade_sistema := 0;  -- item incluído na contagem: não existia no sistema
    if new.lote_id is null and exists (select 1 from public.produtos where id = new.produto_id and controla_lote) and new.validade is null then
      raise exception 'Informe a validade do lote encontrado.';
    end if;
  end if;
  return new;
end;
$$;
create trigger trg_inventarios_itens_protege before insert or update or delete on public.inventarios_itens
  for each row execute function public.fn_inventario_item_protege();

create or replace function public.fn_inventario_protege()
returns trigger
language plpgsql
as $$
begin
  if public.fn_via_regra() then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    if old.status = 'concluido' then raise exception 'Inventário concluído não pode ser excluído.'; end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    raise exception 'Use a ação Abrir inventário.';
  end if;
  if new.status is distinct from old.status or new.deposito_id is distinct from old.deposito_id then
    raise exception 'Use as ações Concluir ou Cancelar.';
  end if;
  return new;
end;
$$;
create trigger trg_inventarios_protege before insert or update or delete on public.inventarios
  for each row execute function public.fn_inventario_protege();

-- ---------------------------------------------------------------------
-- Saldo nunca negativo
-- ---------------------------------------------------------------------
create or replace function public.fn_estoque_movimento_saldo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sinal numeric;
  v_saldo numeric;
begin
  v_sinal := case when new.tipo in ('entrada', 'ajuste_entrada', 'transferencia_entrada', 'devolucao') then 1 else -1 end;

  insert into public.estoque_saldos (empresa_id, deposito_id, produto_id, lote_id, quantidade)
  values (new.empresa_id, new.deposito_id, new.produto_id, new.lote_id, v_sinal * new.quantidade)
  on conflict (deposito_id, produto_id, coalesce(lote_id, '00000000-0000-0000-0000-000000000000'::uuid))
  do update set quantidade = public.estoque_saldos.quantidade + excluded.quantidade,
                alterado_em = now()
  returning quantidade into v_saldo;

  if v_saldo < 0 then
    raise exception 'Saldo insuficiente: o estoque deste lote ficaria negativo (%).', public.fn_qtd(v_saldo);
  end if;
  return new;
end;
$$;

-- Movimentos só entram pelas funções de estoque
drop policy if exists "estoque_movimentos_criar" on public.estoque_movimentos;

-- ---------------------------------------------------------------------
-- Pedido: valores padrão vindos do cliente
-- ---------------------------------------------------------------------
create or replace function public.fn_pedido_padroes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
begin
  if tg_op = 'UPDATE' and new.cliente_id is not distinct from old.cliente_id then
    return new;
  end if;
  select vendedor_id, rota_id, tabela_preco_id, condicao_pagamento_id, forma_pagamento_id
    into c from public.pessoas where id = new.cliente_id;
  if tg_op = 'INSERT' then
    new.vendedor_id := coalesce(new.vendedor_id, c.vendedor_id);
    new.rota_id := coalesce(new.rota_id, c.rota_id);
    new.tabela_preco_id := coalesce(new.tabela_preco_id, c.tabela_preco_id,
      (select id from public.tabelas_preco where empresa_id = new.empresa_id and padrao and ativo limit 1));
    new.condicao_pagamento_id := coalesce(new.condicao_pagamento_id, c.condicao_pagamento_id);
    new.forma_pagamento_id := coalesce(new.forma_pagamento_id, c.forma_pagamento_id);
    new.deposito_id := coalesce(new.deposito_id,
      (select id from public.depositos where empresa_id = new.empresa_id and ativo order by padrao desc, (tipo = 'camara_fria') desc, nome limit 1));
  end if;
  return new;
end;
$$;
create trigger trg_pedidos_padroes before insert or update of cliente_id on public.pedidos
  for each row execute function public.fn_pedido_padroes();

-- ---------------------------------------------------------------------
-- Pedido: proteção da situação e dos valores depois de confirmado
-- ---------------------------------------------------------------------
create or replace function public.fn_pedido_protege()
returns trigger
language plpgsql
as $$
begin
  if public.fn_via_regra() then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    if old.status <> 'rascunho' then
      raise exception 'Só pedidos em rascunho podem ser excluídos. Use Cancelar.';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    new.status := 'rascunho';
    new.motivo_trava := null;
    new.credito_liberado_por := null;
    new.credito_liberado_em := null;
    new.motivo_cancelamento := null;
    return new;
  end if;

  if new.status is distinct from old.status
     or new.tipo is distinct from old.tipo
     or new.motivo_trava is distinct from old.motivo_trava
     or new.credito_liberado_por is distinct from old.credito_liberado_por
     or new.credito_liberado_em is distinct from old.credito_liberado_em
     or new.motivo_cancelamento is distinct from old.motivo_cancelamento then
    raise exception 'A situação do pedido só muda pelas ações (confirmar, liberar crédito, reabrir, cancelar).';
  end if;

  if old.status <> 'rascunho'
     and (new.cliente_id, new.vendedor_id, new.tabela_preco_id, new.condicao_pagamento_id, new.forma_pagamento_id,
          new.deposito_id, new.valor_desconto, new.valor_frete, new.empresa_id)
         is distinct from
         (old.cliente_id, old.vendedor_id, old.tabela_preco_id, old.condicao_pagamento_id, old.forma_pagamento_id,
          old.deposito_id, old.valor_desconto, old.valor_frete, old.empresa_id) then
    raise exception 'Pedido já confirmado. Use Reabrir para alterar cliente, valores ou pagamento.';
  end if;

  if old.status in ('faturado', 'em_rota', 'entregue', 'devolvido', 'cancelado')
     and (new.data_entrega, new.observacao, new.observacao_nfe, new.pedido_cliente, new.rota_id)
         is distinct from
         (old.data_entrega, old.observacao, old.observacao_nfe, old.pedido_cliente, old.rota_id) then
    raise exception 'Pedido encerrado não pode ser alterado.';
  end if;
  return new;
end;
$$;
create trigger trg_pedidos_protege before insert or update or delete on public.pedidos
  for each row execute function public.fn_pedido_protege();

-- Itens só mudam com o pedido em rascunho
create or replace function public.fn_pedido_item_protege()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if public.fn_via_regra() then
    return coalesce(new, old);
  end if;
  select status into v_status from public.pedidos where id = coalesce(new.pedido_id, old.pedido_id);
  if v_status is not null and v_status <> 'rascunho' then
    raise exception 'Os itens só podem ser alterados com o pedido em rascunho. Use Reabrir.';
  end if;
  if tg_op = 'UPDATE' and new.pedido_id is distinct from old.pedido_id then
    raise exception 'Não é possível mover um item para outro pedido.';
  end if;
  return coalesce(new, old);
end;
$$;
create trigger trg_pedidos_itens_protege before insert or update or delete on public.pedidos_itens
  for each row execute function public.fn_pedido_item_protege();

-- Preço do item: tabela do pedido, senão preço de venda do produto
create or replace function public.fn_pedido_item_total()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.preco_unitario is null then
    select coalesce(ti.preco, pr.preco_venda)
      into new.preco_unitario
      from public.produtos pr
      left join public.pedidos pe on pe.id = new.pedido_id
      left join public.tabelas_preco_itens ti
             on ti.tabela_preco_id = pe.tabela_preco_id and ti.produto_id = pr.id and ti.ativo
     where pr.id = new.produto_id;
  end if;
  new.valor_total := round(new.quantidade * new.preco_unitario - coalesce(new.desconto, 0), 2);
  if new.valor_total < 0 then
    raise exception 'O desconto do item é maior que o valor do item.';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Regras internas (não expostas pela API)
-- ---------------------------------------------------------------------

-- Motivo para travar o crédito, ou null se o pedido pode seguir.
-- Limite zero = cliente sem limite definido: só bloqueio e atraso travam.
create or replace function public.fn_credito_motivo(p_pedido uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r record;
  v_atraso numeric;
  v_aberto numeric;
  v_pedidos numeric;
begin
  select pe.cliente_id, pe.valor_total, p.limite_credito, p.bloqueado, p.motivo_bloqueio
    into r
    from public.pedidos pe join public.pessoas p on p.id = pe.cliente_id
   where pe.id = p_pedido;

  if r.bloqueado then
    return 'Cliente bloqueado' || coalesce(': ' || nullif(r.motivo_bloqueio, ''), '');
  end if;

  select coalesce(sum(valor) filter (where data_vencimento < current_date), 0), coalesce(sum(valor), 0)
    into v_atraso, v_aberto
    from public.lancamentos
   where pessoa_id = r.cliente_id and tipo = 'receber' and ativo and data_quitacao is null;

  if v_atraso > 0 then
    return 'Títulos vencidos em aberto: ' || public.fn_brl(v_atraso);
  end if;

  if r.limite_credito > 0 then
    select coalesce(sum(valor_total), 0) into v_pedidos
      from public.pedidos
     where cliente_id = r.cliente_id and id <> p_pedido and tipo = 'pedido' and ativo
       and status in ('aguardando_credito', 'aprovado', 'em_separacao');
    if v_aberto + v_pedidos + r.valor_total > r.limite_credito then
      return format('Limite de crédito excedido: limite %s, títulos em aberto %s, outros pedidos %s, este pedido %s',
                    public.fn_brl(r.limite_credito), public.fn_brl(v_aberto), public.fn_brl(v_pedidos), public.fn_brl(r.valor_total));
    end if;
  end if;
  return null;
end;
$$;

-- Reserva os itens no depósito do pedido, vencimento mais próximo primeiro.
-- Lotes vencidos nunca são reservados.
create or replace function public.fn_pedido_reservar(p_pedido uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dep uuid;
  v_emp uuid;
  it record;
  s record;
  v_falta numeric;
  v_q numeric;
  v_faltas text[] := '{}';
begin
  select deposito_id, empresa_id into v_dep, v_emp from public.pedidos where id = p_pedido;
  if v_dep is null then
    raise exception 'Informe o depósito de saída do pedido.';
  end if;

  for it in
    select i.id, i.produto_id, i.quantidade, pr.codigo, pr.nome
      from public.pedidos_itens i join public.produtos pr on pr.id = i.produto_id
     where i.pedido_id = p_pedido and i.ativo
     order by i.ordem, i.criado_em
  loop
    v_falta := it.quantidade;
    for s in
      select es.id, es.lote_id, es.quantidade - es.quantidade_reservada as disponivel
        from public.estoque_saldos es
        left join public.lotes l on l.id = es.lote_id
       where es.deposito_id = v_dep
         and es.produto_id = it.produto_id
         and es.quantidade - es.quantidade_reservada > 0
         and (l.id is null or l.validade >= current_date)
       order by l.validade nulls last, l.criado_em, es.id
       for update of es
    loop
      exit when v_falta <= 0;
      v_q := least(v_falta, s.disponivel);
      update public.estoque_saldos
         set quantidade_reservada = quantidade_reservada + v_q, alterado_em = now()
       where id = s.id;
      insert into public.pedidos_reservas (empresa_id, pedido_id, pedido_item_id, estoque_saldo_id, deposito_id, produto_id, lote_id, quantidade)
      values (v_emp, p_pedido, it.id, s.id, v_dep, it.produto_id, s.lote_id, v_q);
      v_falta := v_falta - v_q;
    end loop;
    if v_falta > 0 then
      v_faltas := v_faltas || format('%s %s: faltam %s', it.codigo, it.nome, public.fn_qtd(v_falta));
    end if;
  end loop;

  if cardinality(v_faltas) > 0 then
    raise exception 'Estoque insuficiente. %', array_to_string(v_faltas, ' · ');
  end if;
end;
$$;

-- Devolve ao disponível tudo o que o pedido reservou
create or replace function public.fn_pedido_liberar_reservas(p_pedido uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.estoque_saldos es
     set quantidade_reservada = greatest(es.quantidade_reservada - r.q, 0), alterado_em = now()
    from (select estoque_saldo_id, sum(quantidade) as q
            from public.pedidos_reservas where pedido_id = p_pedido group by estoque_saldo_id) r
   where es.id = r.estoque_saldo_id;
  delete from public.pedidos_reservas where pedido_id = p_pedido;
end;
$$;

-- Carrega o pedido da empresa do usuário, travado para alteração
create or replace function public.fn_pedido_obter(p_pedido uuid)
returns public.pedidos
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.pedidos;
begin
  select * into p from public.pedidos
   where id = p_pedido and empresa_id = public.empresa_atual() and ativo
   for update;
  if not found then
    raise exception 'Pedido não encontrado.';
  end if;
  perform set_config('elos.regra', '1', true);
  return p;
end;
$$;

create or replace function public.fn_exigir(p_modulo text, p_acao text)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.tem_permissao(p_modulo, p_acao) then
    raise exception 'Seu perfil não tem permissão para esta ação.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Ações do pedido (chamadas pela tela)
-- ---------------------------------------------------------------------

-- Confirma o pedido: reserva o estoque e aprova, ou trava no crédito
create or replace function public.pedido_confirmar(p_pedido uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.pedidos;
  v_motivo text;
  v_status text;
begin
  perform public.fn_exigir('vendas', 'editar');
  p := public.fn_pedido_obter(p_pedido);
  if p.tipo <> 'pedido' then raise exception 'Orçamento não é confirmado. Converta em pedido primeiro.'; end if;
  if p.status <> 'rascunho' then raise exception 'Só pedidos em rascunho podem ser confirmados.'; end if;
  if not exists (select 1 from public.pedidos_itens where pedido_id = p.id and ativo) then
    raise exception 'Inclua ao menos um item no pedido.';
  end if;
  if exists (select 1 from public.pessoas where id = p.cliente_id and not ativo) then
    raise exception 'O cliente está inativo.';
  end if;

  perform public.fn_pedido_recalcula(p.id);
  perform public.fn_pedido_reservar(p.id);
  v_motivo := public.fn_credito_motivo(p.id);
  v_status := case when v_motivo is null then 'aprovado' else 'aguardando_credito' end;

  update public.pedidos
     set status = v_status, motivo_trava = v_motivo, credito_liberado_por = null, credito_liberado_em = null
   where id = p.id;
  perform set_config('elos.regra', '', true);
  return jsonb_build_object('status', v_status, 'motivo', v_motivo);
end;
$$;

-- Volta para rascunho e devolve a reserva, para alterar o pedido
create or replace function public.pedido_reabrir(p_pedido uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.pedidos;
begin
  perform public.fn_exigir('vendas', 'editar');
  p := public.fn_pedido_obter(p_pedido);
  if p.status not in ('aguardando_credito', 'aprovado') then
    raise exception 'Só pedidos aguardando crédito ou aprovados podem ser reabertos.';
  end if;
  perform public.fn_pedido_liberar_reservas(p.id);
  update public.pedidos
     set status = 'rascunho', motivo_trava = null, credito_liberado_por = null, credito_liberado_em = null
   where id = p.id;
  perform set_config('elos.regra', '', true);
end;
$$;

create or replace function public.pedido_cancelar(p_pedido uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.pedidos;
begin
  perform public.fn_exigir('vendas', 'editar');
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo do cancelamento.'; end if;
  p := public.fn_pedido_obter(p_pedido);
  if p.status not in ('rascunho', 'aguardando_credito', 'aprovado', 'em_separacao') then
    raise exception 'Este pedido não pode mais ser cancelado por aqui.';
  end if;
  perform public.fn_pedido_liberar_reservas(p.id);
  update public.pedidos set status = 'cancelado', motivo_cancelamento = trim(p_motivo) where id = p.id;
  perform set_config('elos.regra', '', true);
end;
$$;

create or replace function public.pedido_liberar_credito(p_pedido uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.pedidos;
begin
  perform public.fn_exigir('financeiro', 'editar');
  p := public.fn_pedido_obter(p_pedido);
  if p.status <> 'aguardando_credito' then raise exception 'Este pedido não está aguardando crédito.'; end if;
  update public.pedidos
     set status = 'aprovado', credito_liberado_por = auth.uid(), credito_liberado_em = now()
   where id = p.id;
  perform set_config('elos.regra', '', true);
end;
$$;

create or replace function public.pedido_recusar_credito(p_pedido uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.pedidos;
begin
  perform public.fn_exigir('financeiro', 'editar');
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo da recusa.'; end if;
  p := public.fn_pedido_obter(p_pedido);
  if p.status <> 'aguardando_credito' then raise exception 'Este pedido não está aguardando crédito.'; end if;
  perform public.fn_pedido_liberar_reservas(p.id);
  update public.pedidos set status = 'cancelado', motivo_cancelamento = 'Crédito recusado: ' || trim(p_motivo) where id = p.id;
  perform set_config('elos.regra', '', true);
end;
$$;

-- Orçamento vira pedido em rascunho, com o mesmo número
create or replace function public.orcamento_converter(p_pedido uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.pedidos;
begin
  perform public.fn_exigir('vendas', 'editar');
  p := public.fn_pedido_obter(p_pedido);
  if p.tipo <> 'orcamento' or p.status <> 'rascunho' then raise exception 'Só orçamentos em aberto podem ser convertidos.'; end if;
  if p.validade is not null and p.validade < current_date then
    raise exception 'Orçamento vencido em %. Altere a validade antes de converter.', to_char(p.validade, 'DD/MM/YYYY');
  end if;
  update public.pedidos set tipo = 'pedido', data_emissao = now() where id = p.id;
  perform set_config('elos.regra', '', true);
end;
$$;

-- ---------------------------------------------------------------------
-- Ações de estoque
-- ---------------------------------------------------------------------

-- Lote do produto pelo número; cria se não existir.
-- Sem número informado, o lote leva a validade: V20270131.
create or replace function public.fn_lote_obter(p_produto uuid, p_numero text, p_validade date, p_fabricacao date)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_controla boolean;
  v_numero text;
  v_lote public.lotes;
begin
  select controla_lote into v_controla from public.produtos where id = p_produto and empresa_id = public.empresa_atual();
  if not found then raise exception 'Produto não encontrado.'; end if;
  v_numero := nullif(upper(trim(coalesce(p_numero, ''))), '');
  if not v_controla and v_numero is null and p_validade is null then
    return null;
  end if;
  if p_validade is null and v_numero is null then
    raise exception 'Informe a validade do lote.';
  end if;
  v_numero := coalesce(v_numero, 'V' || to_char(p_validade, 'YYYYMMDD'));

  select * into v_lote from public.lotes where produto_id = p_produto and numero = v_numero;
  if found then
    if p_validade is not null and v_lote.validade <> p_validade then
      raise exception 'O lote % já está cadastrado com validade %.', v_numero, to_char(v_lote.validade, 'DD/MM/YYYY');
    end if;
    return v_lote.id;
  end if;
  if p_validade is null then
    raise exception 'Lote % novo: informe a validade.', v_numero;
  end if;
  insert into public.lotes (empresa_id, produto_id, numero, fabricacao, validade)
  values (public.empresa_atual(), p_produto, v_numero, p_fabricacao, p_validade)
  returning id into v_lote.id;
  return v_lote.id;
end;
$$;

-- Entrada de mercadoria em um depósito
create or replace function public.estoque_entrada(
  p_produto uuid, p_deposito uuid, p_quantidade numeric,
  p_lote text default null, p_validade date default null, p_fabricacao date default null,
  p_custo numeric default null, p_observacao text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lote uuid;
  v_id uuid;
begin
  perform public.fn_exigir('estoque', 'criar');
  if coalesce(p_quantidade, 0) <= 0 then raise exception 'Informe uma quantidade maior que zero.'; end if;
  if not exists (select 1 from public.depositos where id = p_deposito and empresa_id = public.empresa_atual()) then
    raise exception 'Depósito não encontrado.';
  end if;
  if p_validade is not null and p_validade < current_date then
    raise exception 'A validade informada já passou. Lance como perda ou no depósito de avarias.';
  end if;
  v_lote := public.fn_lote_obter(p_produto, p_lote, p_validade, p_fabricacao);
  insert into public.estoque_movimentos (empresa_id, tipo, deposito_id, produto_id, lote_id, quantidade, custo_unitario, origem, observacao)
  values (public.empresa_atual(), 'entrada', p_deposito, p_produto, v_lote, p_quantidade, p_custo, 'manual', nullif(trim(p_observacao), ''))
  returning id into v_id;
  return v_id;
end;
$$;

-- Ajuste, perda ou transferência a partir de um saldo (depósito + lote)
create or replace function public.estoque_movimentar(
  p_saldo uuid, p_tipo text, p_quantidade numeric,
  p_observacao text default null, p_deposito_destino uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.estoque_saldos;
  v_emp uuid := public.empresa_atual();
begin
  perform public.fn_exigir('estoque', 'criar');
  if p_tipo not in ('ajuste_entrada', 'ajuste_saida', 'perda', 'transferencia') then
    raise exception 'Tipo de movimentação inválido.';
  end if;
  if coalesce(p_quantidade, 0) <= 0 then raise exception 'Informe uma quantidade maior que zero.'; end if;
  if p_tipo in ('ajuste_entrada', 'ajuste_saida', 'perda') and coalesce(trim(p_observacao), '') = '' then
    raise exception 'Informe o motivo do ajuste ou da perda.';
  end if;

  select * into s from public.estoque_saldos where id = p_saldo and empresa_id = v_emp for update;
  if not found then raise exception 'Saldo não encontrado.'; end if;

  if p_tipo <> 'ajuste_entrada' and p_quantidade > s.quantidade - s.quantidade_reservada then
    raise exception 'Só há % disponível neste lote (% reservado para pedidos).',
      public.fn_qtd(s.quantidade - s.quantidade_reservada), public.fn_qtd(s.quantidade_reservada);
  end if;

  if p_tipo = 'transferencia' then
    if p_deposito_destino is null or p_deposito_destino = s.deposito_id then
      raise exception 'Escolha um depósito de destino diferente do de origem.';
    end if;
    if not exists (select 1 from public.depositos where id = p_deposito_destino and empresa_id = v_emp) then
      raise exception 'Depósito de destino não encontrado.';
    end if;
    insert into public.estoque_movimentos (empresa_id, tipo, deposito_id, produto_id, lote_id, quantidade, origem, observacao)
    values (v_emp, 'transferencia_saida', s.deposito_id, s.produto_id, s.lote_id, p_quantidade, 'transferencia', nullif(trim(p_observacao), '')),
           (v_emp, 'transferencia_entrada', p_deposito_destino, s.produto_id, s.lote_id, p_quantidade, 'transferencia', nullif(trim(p_observacao), ''));
  else
    insert into public.estoque_movimentos (empresa_id, tipo, deposito_id, produto_id, lote_id, quantidade, origem, observacao)
    values (v_emp, p_tipo, s.deposito_id, s.produto_id, s.lote_id, p_quantidade, 'manual', trim(p_observacao));
  end if;
end;
$$;

-- Abre o inventário de um depósito com o retrato dos saldos atuais
create or replace function public.inventario_abrir(p_deposito uuid, p_observacao text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp uuid := public.empresa_atual();
  v_id uuid;
begin
  perform public.fn_exigir('estoque', 'criar');
  if not exists (select 1 from public.depositos where id = p_deposito and empresa_id = v_emp) then
    raise exception 'Depósito não encontrado.';
  end if;
  if exists (select 1 from public.inventarios where deposito_id = p_deposito and status = 'aberto') then
    raise exception 'Já existe um inventário aberto para este depósito.';
  end if;
  perform set_config('elos.regra', '1', true);
  insert into public.inventarios (empresa_id, numero, deposito_id, observacao)
  values (v_emp, public.proximo_numero(v_emp, 'inventario'), p_deposito, nullif(trim(p_observacao), ''))
  returning id into v_id;

  insert into public.inventarios_itens (empresa_id, inventario_id, produto_id, lote_id, quantidade_sistema)
  select v_emp, v_id, s.produto_id, s.lote_id, s.quantidade
    from public.estoque_saldos s
   where s.deposito_id = p_deposito and s.quantidade <> 0;
  perform set_config('elos.regra', '', true);
  return v_id;
end;
$$;

-- Conclui: lança ajustes para cada diferença entre contado e saldo atual.
-- Itens sem contagem ficam como estão.
create or replace function public.inventario_concluir(p_inventario uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp uuid := public.empresa_atual();
  inv public.inventarios;
  it record;
  v_lote uuid;
  v_atual numeric;
  v_dif numeric;
  v_ajustes integer := 0;
begin
  perform public.fn_exigir('estoque', 'editar');
  select * into inv from public.inventarios where id = p_inventario and empresa_id = v_emp for update;
  if not found then raise exception 'Inventário não encontrado.'; end if;
  if inv.status <> 'aberto' then raise exception 'Este inventário já foi encerrado.'; end if;
  perform set_config('elos.regra', '1', true);

  for it in select * from public.inventarios_itens where inventario_id = inv.id and quantidade_contada is not null loop
    v_lote := coalesce(it.lote_id,
      case when it.lote_numero is not null or it.validade is not null
           then public.fn_lote_obter(it.produto_id, it.lote_numero, it.validade, null) end);
    select coalesce(sum(quantidade), 0) into v_atual
      from public.estoque_saldos
     where deposito_id = inv.deposito_id and produto_id = it.produto_id and lote_id is not distinct from v_lote;
    v_dif := it.quantidade_contada - v_atual;
    if v_dif <> 0 then
      insert into public.estoque_movimentos (empresa_id, tipo, deposito_id, produto_id, lote_id, quantidade, origem, origem_id, observacao)
      values (v_emp, case when v_dif > 0 then 'ajuste_entrada' else 'ajuste_saida' end, inv.deposito_id, it.produto_id, v_lote,
              abs(v_dif), 'inventario', inv.id, 'Inventário nº ' || inv.numero);
      v_ajustes := v_ajustes + 1;
    end if;
    update public.inventarios_itens set lote_id = v_lote, diferenca = v_dif where id = it.id;
  end loop;

  update public.inventarios set status = 'concluido', concluido_em = now(), concluido_por = auth.uid() where id = inv.id;
  perform set_config('elos.regra', '', true);
  return jsonb_build_object('ajustes', v_ajustes);
end;
$$;

create or replace function public.inventario_cancelar(p_inventario uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.fn_exigir('estoque', 'editar');
  perform set_config('elos.regra', '1', true);
  update public.inventarios set status = 'cancelado'
   where id = p_inventario and empresa_id = public.empresa_atual() and status = 'aberto';
  if not found then raise exception 'Só inventários abertos podem ser cancelados.'; end if;
  perform set_config('elos.regra', '', true);
end;
$$;

-- ---------------------------------------------------------------------
-- Views para as telas
-- ---------------------------------------------------------------------
create or replace view public.vw_pedidos
with (security_invoker = true)
as
select pe.*,
       c.codigo as cliente_codigo,
       c.razao_social as cliente_nome,
       c.nome_fantasia as cliente_fantasia,
       v.razao_social as vendedor_nome,
       r.nome as rota_nome,
       (select count(*) from public.pedidos_itens i where i.pedido_id = pe.id and i.ativo) as qtd_itens
  from public.pedidos pe
  join public.pessoas c on c.id = pe.cliente_id
  left join public.pessoas v on v.id = pe.vendedor_id
  left join public.rotas r on r.id = pe.rota_id;

drop view if exists public.vw_estoque;
create view public.vw_estoque
with (security_invoker = true)
as
select s.id,
       s.empresa_id,
       s.deposito_id,
       d.nome as deposito_nome,
       s.produto_id,
       pr.codigo as produto_codigo,
       pr.nome as produto_nome,
       pr.categoria_id,
       s.lote_id,
       lo.numero as lote_numero,
       lo.fabricacao,
       lo.validade,
       (lo.validade - current_date) as dias_para_vencer,
       s.quantidade,
       s.quantidade_reservada,
       -- lote vencido não fica disponível para venda
       case when lo.validade < current_date then 0 else s.quantidade - s.quantidade_reservada end as disponivel,
       pr.custo,
       round(s.quantidade * pr.custo, 2) as valor_custo
  from public.estoque_saldos s
  join public.depositos d on d.id = s.deposito_id
  join public.produtos pr on pr.id = s.produto_id
  left join public.lotes lo on lo.id = s.lote_id
 where s.quantidade <> 0 or s.quantidade_reservada <> 0;

-- Resumo por produto, inclusive os sem estoque (para ver o que falta).
-- Disponível desconta reservas e ignora lotes vencidos.
create or replace view public.vw_estoque_produtos
with (security_invoker = true)
as
select pr.id as produto_id,
       pr.empresa_id,
       pr.codigo as produto_codigo,
       pr.nome as produto_nome,
       pr.categoria_id,
       pr.estoque_minimo,
       coalesce(sum(s.quantidade), 0) as quantidade,
       coalesce(sum(s.quantidade_reservada), 0) as quantidade_reservada,
       coalesce(sum(s.quantidade - s.quantidade_reservada) filter (where lo.validade is null or lo.validade >= current_date), 0) as disponivel,
       coalesce(sum(s.quantidade) filter (where lo.validade < current_date), 0) as quantidade_vencida,
       min(lo.validade) filter (where s.quantidade > 0 and lo.validade >= current_date) as proxima_validade,
       count(distinct s.lote_id) filter (where s.quantidade > 0) as lotes
  from public.produtos pr
  left join public.estoque_saldos s on s.produto_id = pr.id
  left join public.lotes lo on lo.id = s.lote_id
 where pr.ativo
 group by pr.id;

-- Disponível para venda por depósito (o vendedor não enxerga lotes, então
-- esta view roda com os direitos do dono e filtra a empresa e o perfil)
create or replace view public.vw_estoque_disponivel
as
select s.deposito_id,
       s.produto_id,
       sum(s.quantidade - s.quantidade_reservada) filter (where lo.id is null or lo.validade >= current_date) as disponivel,
       coalesce(sum(s.quantidade) filter (where lo.validade < current_date), 0) as vencido
  from public.estoque_saldos s
  left join public.lotes lo on lo.id = s.lote_id
 where s.empresa_id = public.empresa_atual()
   and (public.tem_permissao('vendas', 'ver') or public.tem_permissao('estoque', 'ver'))
 group by s.deposito_id, s.produto_id;
revoke all on public.vw_estoque_disponivel from public, anon;
grant select on public.vw_estoque_disponivel to authenticated;

create or replace view public.vw_estoque_movimentos
with (security_invoker = true)
as
select m.id,
       m.empresa_id,
       m.data,
       m.tipo,
       m.origem,
       m.origem_id,
       m.deposito_id,
       d.nome as deposito_nome,
       m.produto_id,
       pr.codigo as produto_codigo,
       pr.nome as produto_nome,
       m.lote_id,
       lo.numero as lote_numero,
       lo.validade,
       m.quantidade,
       case when m.tipo in ('entrada', 'ajuste_entrada', 'transferencia_entrada', 'devolucao') then m.quantidade else -m.quantidade end as quantidade_sinal,
       m.custo_unitario,
       m.observacao,
       public.fn_nome_usuario(m.criado_por) as usuario_nome
  from public.estoque_movimentos m
  join public.depositos d on d.id = m.deposito_id
  join public.produtos pr on pr.id = m.produto_id
  left join public.lotes lo on lo.id = m.lote_id;

-- ---------------------------------------------------------------------
-- Funções internas fora da API; ações liberadas só para quem está logado
-- ---------------------------------------------------------------------
revoke execute on function public.fn_credito_motivo(uuid) from public, anon, authenticated;
revoke execute on function public.fn_pedido_reservar(uuid) from public, anon, authenticated;
revoke execute on function public.fn_pedido_liberar_reservas(uuid) from public, anon, authenticated;
revoke execute on function public.fn_pedido_obter(uuid) from public, anon, authenticated;
revoke execute on function public.fn_lote_obter(uuid, text, date, date) from public, anon, authenticated;
revoke execute on function public.fn_exigir(text, text) from public, anon, authenticated;
revoke execute on function public.fn_nome_usuario(uuid) from public, anon;
grant execute on function public.fn_nome_usuario(uuid) to authenticated;

do $$ declare f text; begin foreach f in array array[
  'pedido_confirmar(uuid)', 'pedido_reabrir(uuid)', 'pedido_cancelar(uuid, text)',
  'pedido_liberar_credito(uuid)', 'pedido_recusar_credito(uuid, text)', 'orcamento_converter(uuid)',
  'estoque_entrada(uuid, uuid, numeric, text, date, date, numeric, text)',
  'estoque_movimentar(uuid, text, numeric, text, uuid)',
  'inventario_abrir(uuid, text)', 'inventario_concluir(uuid)', 'inventario_cancelar(uuid)'
] loop
  execute format('revoke execute on function public.%s from public, anon', f);
  execute format('grant execute on function public.%s to authenticated', f);
end loop; end $$;

-- =====================================================================
-- Fase 4a · Expedição
-- Carga junta pedidos aprovados; a saída da carga baixa o estoque dos
-- lotes reservados; a entrega confirma, devolve ao mesmo lote ou, com o
-- cliente ausente, devolve ao estoque e libera o pedido para outra carga.
-- =====================================================================

-- Carga: situação só muda pelas ações
create or replace function public.fn_expedicao_protege()
returns trigger
language plpgsql
as $$
begin
  if public.fn_via_regra() then
    return coalesce(new, old);
  end if;
  if tg_op = 'INSERT' then
    new.status := 'montando';
    return new;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Use Cancelar carga.';
  end if;
  if new.status is distinct from old.status then
    raise exception 'A situação da carga só muda pelas ações (separar, saída, cancelar).';
  end if;
  if old.status in ('concluida', 'cancelada') then
    raise exception 'Carga encerrada não pode ser alterada.';
  end if;
  return new;
end;
$$;
create trigger trg_expedicoes_protege before insert or update or delete on public.expedicoes
  for each row execute function public.fn_expedicao_protege();

-- Pedidos da carga: só pelas ações
create or replace function public.fn_expedicao_pedido_protege()
returns trigger
language plpgsql
as $$
begin
  if public.fn_via_regra() then
    return coalesce(new, old);
  end if;
  raise exception 'Use as ações da carga para incluir, ordenar, retirar ou registrar entregas.';
end;
$$;
create trigger trg_expedicoes_pedidos_protege before insert or update or delete on public.expedicoes_pedidos
  for each row execute function public.fn_expedicao_pedido_protege();

create or replace function public.fn_expedicao_obter(p_expedicao uuid, p_status text[])
returns public.expedicoes
language plpgsql
security definer
set search_path = public
as $$
declare
  e public.expedicoes;
begin
  select * into e from public.expedicoes
   where id = p_expedicao and empresa_id = public.empresa_atual()
   for update;
  if not found then raise exception 'Carga não encontrada.'; end if;
  if not (e.status = any(p_status)) then
    raise exception 'Ação não permitida com a carga na situação atual (%).', e.status;
  end if;
  perform set_config('elos.regra', '1', true);
  return e;
end;
$$;

-- Inclui pedidos aprovados na carga, na ordem de visita dos clientes
create or replace function public.expedicao_incluir_pedidos(p_expedicao uuid, p_pedidos uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  e public.expedicoes;
  r record;
  v_ordem integer;
  v_n integer := 0;
begin
  perform public.fn_exigir('expedicao', 'editar');
  e := public.fn_expedicao_obter(p_expedicao, array['montando', 'separando']);
  select coalesce(max(ordem_entrega), 0) into v_ordem from public.expedicoes_pedidos where expedicao_id = e.id;

  for r in
    select pe.id, pe.numero, pe.status
      from public.pedidos pe join public.pessoas c on c.id = pe.cliente_id
     where pe.id = any(p_pedidos) and pe.empresa_id = e.empresa_id
     order by c.ordem_visita nulls last, c.razao_social
     for update of pe
  loop
    if r.status <> 'aprovado' then
      raise exception 'O pedido % não está aprovado (situação: %).', r.numero, r.status;
    end if;
    v_ordem := v_ordem + 1;
    insert into public.expedicoes_pedidos (empresa_id, expedicao_id, pedido_id, ordem_entrega)
    values (e.empresa_id, e.id, r.id, v_ordem);
    update public.pedidos set status = 'em_separacao' where id = r.id;
    v_n := v_n + 1;
  end loop;
  perform set_config('elos.regra', '', true);
  return v_n;
end;
$$;

-- Tira o pedido da carga; ele volta para aprovado com a reserva intacta
create or replace function public.expedicao_retirar_pedido(p_expedicao uuid, p_pedido uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  e public.expedicoes;
begin
  perform public.fn_exigir('expedicao', 'editar');
  e := public.fn_expedicao_obter(p_expedicao, array['montando', 'separando']);
  delete from public.expedicoes_pedidos where expedicao_id = e.id and pedido_id = p_pedido;
  if not found then raise exception 'Pedido não está nesta carga.'; end if;
  update public.pedidos set status = 'aprovado' where id = p_pedido and status = 'em_separacao';
  perform set_config('elos.regra', '', true);
end;
$$;

-- Define a ordem de entrega pela posição na lista
create or replace function public.expedicao_ordenar(p_expedicao uuid, p_pedidos uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  e public.expedicoes;
begin
  perform public.fn_exigir('expedicao', 'editar');
  e := public.fn_expedicao_obter(p_expedicao, array['montando', 'separando', 'em_rota']);
  update public.expedicoes_pedidos ep
     set ordem_entrega = x.pos
    from unnest(p_pedidos) with ordinality as x(pedido_id, pos)
   where ep.expedicao_id = e.id and ep.pedido_id = x.pedido_id;
  perform set_config('elos.regra', '', true);
end;
$$;

create or replace function public.expedicao_separar(p_expedicao uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  e public.expedicoes;
begin
  perform public.fn_exigir('expedicao', 'editar');
  e := public.fn_expedicao_obter(p_expedicao, array['montando']);
  if not exists (select 1 from public.expedicoes_pedidos where expedicao_id = e.id) then
    raise exception 'Inclua ao menos um pedido na carga.';
  end if;
  update public.expedicoes set status = 'separando', responsavel_separacao = auth.uid() where id = e.id;
  perform set_config('elos.regra', '', true);
end;
$$;

-- Saída para entrega: a reserva de cada pedido vira baixa no estoque
create or replace function public.expedicao_saida(p_expedicao uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  e public.expedicoes;
  p record;
  r record;
  v_pedidos integer := 0;
  v_itens numeric := 0;
begin
  perform public.fn_exigir('expedicao', 'editar');
  e := public.fn_expedicao_obter(p_expedicao, array['montando', 'separando']);
  if e.motorista_id is null then raise exception 'Informe o motorista da carga.'; end if;
  if not exists (select 1 from public.expedicoes_pedidos where expedicao_id = e.id) then
    raise exception 'A carga não tem pedidos.';
  end if;

  for p in
    select pe.id, pe.numero from public.expedicoes_pedidos ep join public.pedidos pe on pe.id = ep.pedido_id
     where ep.expedicao_id = e.id order by ep.ordem_entrega
     for update of pe
  loop
    if not exists (select 1 from public.pedidos_reservas where pedido_id = p.id) then
      raise exception 'O pedido % está sem estoque reservado. Retire-o da carga, reabra e confirme de novo.', p.numero;
    end if;
    for r in select * from public.pedidos_reservas where pedido_id = p.id loop
      update public.estoque_saldos
         set quantidade_reservada = greatest(quantidade_reservada - r.quantidade, 0), alterado_em = now()
       where id = r.estoque_saldo_id;
      insert into public.estoque_movimentos (empresa_id, tipo, deposito_id, produto_id, lote_id, quantidade, origem, origem_id, observacao)
      values (e.empresa_id, 'saida', r.deposito_id, r.produto_id, r.lote_id, r.quantidade, 'expedicao', p.id,
              format('Carga nº %s · pedido nº %s', e.numero, p.numero));
      v_itens := v_itens + r.quantidade;
    end loop;
    delete from public.pedidos_reservas where pedido_id = p.id;
    update public.pedidos set status = 'em_rota' where id = p.id;
    v_pedidos := v_pedidos + 1;
  end loop;

  update public.expedicoes set status = 'em_rota' where id = e.id;
  perform set_config('elos.regra', '', true);
  return jsonb_build_object('pedidos', v_pedidos, 'unidades', v_itens);
end;
$$;

-- Devolve ao estoque, nos mesmos lotes e depósitos, o que saiu com o pedido
create or replace function public.fn_expedicao_devolver(p_pedido uuid, p_obs text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.estoque_movimentos (empresa_id, tipo, deposito_id, produto_id, lote_id, quantidade, origem, origem_id, observacao)
  select m.empresa_id, 'devolucao', m.deposito_id, m.produto_id, m.lote_id,
         sum(case when m.tipo = 'saida' then m.quantidade else -m.quantidade end), 'expedicao', p_pedido, p_obs
    from public.estoque_movimentos m
   where m.origem = 'expedicao' and m.origem_id = p_pedido and m.tipo in ('saida', 'devolucao')
   group by m.empresa_id, m.deposito_id, m.produto_id, m.lote_id
  having sum(case when m.tipo = 'saida' then m.quantidade else -m.quantidade end) > 0;
end;
$$;

-- Resultado da entrega de um pedido: entregue, devolvido ou ausente
create or replace function public.expedicao_registrar_entrega(p_expedicao_pedido uuid, p_resultado text, p_motivo text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ep public.expedicoes_pedidos;
  e public.expedicoes;
  v_numero bigint;
  v_concluida boolean := false;
begin
  perform public.fn_exigir('expedicao', 'editar');
  if p_resultado not in ('entregue', 'devolvido_total', 'ausente') then
    raise exception 'Resultado de entrega inválido.';
  end if;
  if p_resultado = 'devolvido_total' and coalesce(trim(p_motivo), '') = '' then
    raise exception 'Informe o motivo da devolução.';
  end if;

  select * into ep from public.expedicoes_pedidos where id = p_expedicao_pedido and empresa_id = public.empresa_atual() for update;
  if not found then raise exception 'Entrega não encontrada.'; end if;
  e := public.fn_expedicao_obter(ep.expedicao_id, array['em_rota']);
  if ep.status_entrega <> 'pendente' then raise exception 'Esta entrega já foi registrada.'; end if;
  select numero into v_numero from public.pedidos where id = ep.pedido_id for update;

  if p_resultado = 'entregue' then
    update public.expedicoes_pedidos set status_entrega = 'entregue', entregue_em = now(), motivo_devolucao = nullif(trim(p_motivo), '') where id = ep.id;
    update public.pedidos set status = 'entregue' where id = ep.pedido_id;
  elsif p_resultado = 'devolvido_total' then
    perform public.fn_expedicao_devolver(ep.pedido_id, format('Devolução · carga nº %s · pedido nº %s · %s', e.numero, v_numero, trim(p_motivo)));
    update public.expedicoes_pedidos set status_entrega = 'devolvido_total', entregue_em = now(), motivo_devolucao = trim(p_motivo) where id = ep.id;
    update public.pedidos set status = 'devolvido' where id = ep.pedido_id;
  else
    -- cliente ausente: mercadoria volta, é reservada de novo e o pedido fica livre para outra carga
    perform public.fn_expedicao_devolver(ep.pedido_id, format('Cliente ausente · carga nº %s · pedido nº %s', e.numero, v_numero));
    update public.expedicoes_pedidos set status_entrega = 'ausente', entregue_em = now(), motivo_devolucao = coalesce(nullif(trim(p_motivo), ''), 'Cliente ausente') where id = ep.id;
    perform public.fn_pedido_reservar(ep.pedido_id);
    update public.pedidos set status = 'aprovado' where id = ep.pedido_id;
  end if;

  if not exists (select 1 from public.expedicoes_pedidos where expedicao_id = e.id and status_entrega = 'pendente') then
    update public.expedicoes set status = 'concluida' where id = e.id;
    v_concluida := true;
  end if;
  perform set_config('elos.regra', '', true);
  return jsonb_build_object('carga_concluida', v_concluida);
end;
$$;

-- Cancela a carga antes da saída; pedidos voltam para aprovado
create or replace function public.expedicao_cancelar(p_expedicao uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  e public.expedicoes;
begin
  perform public.fn_exigir('expedicao', 'editar');
  e := public.fn_expedicao_obter(p_expedicao, array['montando', 'separando']);
  update public.pedidos set status = 'aprovado'
   where id in (select pedido_id from public.expedicoes_pedidos where expedicao_id = e.id) and status = 'em_separacao';
  delete from public.expedicoes_pedidos where expedicao_id = e.id;
  update public.expedicoes set status = 'cancelada' where id = e.id;
  perform set_config('elos.regra', '', true);
end;
$$;

-- Cancelar pedido que está numa carga ainda não saída: tira da carga
create or replace function public.pedido_cancelar(p_pedido uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.pedidos;
begin
  perform public.fn_exigir('vendas', 'editar');
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo do cancelamento.'; end if;
  p := public.fn_pedido_obter(p_pedido);
  if p.status not in ('rascunho', 'aguardando_credito', 'aprovado', 'em_separacao') then
    raise exception 'Este pedido não pode mais ser cancelado por aqui.';
  end if;
  delete from public.expedicoes_pedidos ep using public.expedicoes e
   where ep.pedido_id = p.id and e.id = ep.expedicao_id and e.status in ('montando', 'separando');
  perform public.fn_pedido_liberar_reservas(p.id);
  update public.pedidos set status = 'cancelado', motivo_cancelamento = trim(p_motivo) where id = p.id;
  perform set_config('elos.regra', '', true);
end;
$$;

-- ---------------------------------------------------------------------
-- Views (expedição e motorista não têm acesso a vendas: estas views
-- rodam com os direitos do dono e filtram empresa e perfil)
-- ---------------------------------------------------------------------
create or replace view public.vw_expedicoes
as
select e.id, e.empresa_id, e.numero, e.data, e.status, e.observacao, e.rota_id, e.motorista_id, e.veiculo_id, e.criado_em,
       r.nome as rota_nome,
       m.razao_social as motorista_nome,
       v.placa as veiculo_placa,
       v.descricao as veiculo_descricao,
       v.capacidade_kg,
       count(ep.id) as qtd_pedidos,
       coalesce(sum(pe.peso_total_kg), 0) as peso_total_kg,
       coalesce(sum(pe.valor_total), 0) as valor_total,
       count(ep.id) filter (where ep.status_entrega = 'entregue') as entregues,
       count(ep.id) filter (where ep.status_entrega = 'pendente') as pendentes,
       count(ep.id) filter (where ep.status_entrega in ('devolvido_total', 'devolvido_parcial', 'ausente')) as nao_entregues
  from public.expedicoes e
  left join public.rotas r on r.id = e.rota_id
  left join public.pessoas m on m.id = e.motorista_id
  left join public.veiculos v on v.id = e.veiculo_id
  left join public.expedicoes_pedidos ep on ep.expedicao_id = e.id
  left join public.pedidos pe on pe.id = ep.pedido_id
 where e.empresa_id = public.empresa_atual() and public.tem_permissao('expedicao', 'ver')
 group by e.id, r.nome, m.razao_social, v.placa, v.descricao, v.capacidade_kg;

create or replace view public.vw_expedicao_pedidos
as
select ep.id, ep.expedicao_id, ep.pedido_id, ep.ordem_entrega, ep.status_entrega, ep.entregue_em, ep.motivo_devolucao,
       pe.numero as pedido_numero, pe.status as pedido_status, pe.valor_total, pe.peso_total_kg, pe.data_entrega,
       pe.observacao, pe.pedido_cliente,
       c.id as cliente_id, c.codigo as cliente_codigo, c.razao_social as cliente_nome, c.nome_fantasia as cliente_fantasia,
       c.telefone, c.whatsapp,
       en.logradouro, en.numero as endereco_numero, en.complemento, en.bairro, en.cidade, en.uf, en.cep, en.referencia,
       en.latitude, en.longitude,
       cp.nome as condicao_nome, fp.nome as forma_nome,
       (select count(*) from public.pedidos_itens i where i.pedido_id = pe.id and i.ativo) as qtd_itens
  from public.expedicoes_pedidos ep
  join public.pedidos pe on pe.id = ep.pedido_id
  join public.pessoas c on c.id = pe.cliente_id
  left join lateral (
    select * from public.pessoas_enderecos x where x.pessoa_id = c.id and x.ativo
     order by (x.tipo = 'entrega') desc, (x.tipo = 'principal') desc, x.criado_em limit 1
  ) en on true
  left join public.condicoes_pagamento cp on cp.id = pe.condicao_pagamento_id
  left join public.formas_pagamento fp on fp.id = pe.forma_pagamento_id
 where ep.empresa_id = public.empresa_atual() and public.tem_permissao('expedicao', 'ver');

create or replace view public.vw_expedicao_itens
as
select ep.expedicao_id, ep.pedido_id, i.id as pedido_item_id, pr.codigo as produto_codigo, pr.nome as produto_nome,
       u.sigla as unidade, i.quantidade, i.valor_total, i.ordem
  from public.expedicoes_pedidos ep
  join public.pedidos_itens i on i.pedido_id = ep.pedido_id and i.ativo
  join public.produtos pr on pr.id = i.produto_id
  left join public.unidades u on u.id = pr.unidade_id
 where ep.empresa_id = public.empresa_atual() and public.tem_permissao('expedicao', 'ver');

-- O que separar: antes da saída vem das reservas; depois, do que saiu
create or replace view public.vw_separacao
as
select x.expedicao_id, d.nome as deposito_nome, pr.codigo as produto_codigo, pr.nome as produto_nome, u.sigla as unidade,
       lo.numero as lote_numero, lo.validade, sum(x.quantidade) as quantidade
  from (
    select ep.expedicao_id, r.deposito_id, r.produto_id, r.lote_id, r.quantidade
      from public.expedicoes_pedidos ep join public.pedidos_reservas r on r.pedido_id = ep.pedido_id
    union all
    select ep.expedicao_id, m.deposito_id, m.produto_id, m.lote_id,
           case when m.tipo = 'saida' then m.quantidade else -m.quantidade end
      from public.expedicoes_pedidos ep
      join public.estoque_movimentos m on m.origem = 'expedicao' and m.origem_id = ep.pedido_id and m.tipo in ('saida', 'devolucao')
     where ep.status_entrega not in ('ausente')
  ) x
  join public.depositos d on d.id = x.deposito_id
  join public.produtos pr on pr.id = x.produto_id
  left join public.unidades u on u.id = pr.unidade_id
  left join public.lotes lo on lo.id = x.lote_id
  join public.expedicoes e on e.id = x.expedicao_id
 where e.empresa_id = public.empresa_atual() and public.tem_permissao('expedicao', 'ver')
 group by x.expedicao_id, d.nome, pr.codigo, pr.nome, u.sigla, lo.numero, lo.validade
having sum(x.quantidade) > 0;

revoke all on public.vw_expedicoes, public.vw_expedicao_pedidos, public.vw_expedicao_itens, public.vw_separacao from public, anon;
grant select on public.vw_expedicoes, public.vw_expedicao_pedidos, public.vw_expedicao_itens, public.vw_separacao to authenticated;

revoke execute on function public.fn_expedicao_obter(uuid, text[]) from public, anon, authenticated;
revoke execute on function public.fn_expedicao_devolver(uuid, text) from public, anon, authenticated;

do $$ declare f text; begin foreach f in array array[
  'expedicao_incluir_pedidos(uuid, uuid[])', 'expedicao_retirar_pedido(uuid, uuid)', 'expedicao_ordenar(uuid, uuid[])',
  'expedicao_separar(uuid)', 'expedicao_saida(uuid)', 'expedicao_registrar_entrega(uuid, text, text)',
  'expedicao_cancelar(uuid)', 'pedido_cancelar(uuid, text)'
] loop
  execute format('revoke execute on function public.%s from public, anon', f);
  execute format('grant execute on function public.%s to authenticated', f);
end loop; end $$;

-- =====================================================================
-- Fase 5a · Financeiro
-- Contas a receber nascem na saída da carga, pela condição de pagamento
-- do pedido; devolução ou cliente ausente cancelam os títulos em aberto.
-- Lançamentos manuais parcelados, baixa (com parcial, juros, multa e
-- desconto), estorno e cancelamento só pelas funções.
-- =====================================================================

alter table public.lancamentos
  add column if not exists titulo_pai_id uuid references public.lancamentos(id),
  add column if not exists motivo_cancelamento text,
  add column if not exists cancelado_em timestamptz,
  add column if not exists baixado_por uuid,
  add column if not exists baixado_em timestamptz;

create index if not exists lancamentos_origem_idx on public.lancamentos (origem, origem_id);
create index if not exists lancamentos_quitacao_idx on public.lancamentos (empresa_id, conta_bancaria_id, data_quitacao);

-- ---------------------------------------------------------------------
-- Proteção: quitação, cancelamento e criação só pelas funções
-- ---------------------------------------------------------------------
create or replace function public.fn_lancamento_protege()
returns trigger
language plpgsql
as $$
begin
  if public.fn_via_regra() then
    return coalesce(new, old);
  end if;
  if tg_op = 'INSERT' then
    raise exception 'Use Novo lançamento.';
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Lançamentos não são excluídos. Use Cancelar.';
  end if;
  if (new.data_quitacao, new.valor_pago, new.juros, new.multa, new.desconto, new.ativo, new.tipo, new.origem, new.origem_id, new.empresa_id, new.titulo_pai_id)
     is distinct from
     (old.data_quitacao, old.valor_pago, old.juros, old.multa, old.desconto, old.ativo, old.tipo, old.origem, old.origem_id, old.empresa_id, old.titulo_pai_id) then
    raise exception 'Baixa, estorno e cancelamento só pelas ações do financeiro.';
  end if;
  if not old.ativo then
    raise exception 'Lançamento cancelado não pode ser alterado.';
  end if;
  if old.data_quitacao is not null
     and (new.valor, new.pessoa_id, new.data_vencimento, new.conta_bancaria_id, new.forma_pagamento_id)
         is distinct from (old.valor, old.pessoa_id, old.data_vencimento, old.conta_bancaria_id, old.forma_pagamento_id) then
    raise exception 'Lançamento quitado: estorne a baixa antes de alterar.';
  end if;
  if old.origem = 'pedido' and (new.valor, new.pessoa_id) is distinct from (old.valor, old.pessoa_id) then
    raise exception 'Valor e cliente de título de pedido não mudam aqui. Para renegociar, cancele e lance de novo.';
  end if;
  return new;
end;
$$;
create trigger trg_lancamentos_protege before insert or update or delete on public.lancamentos
  for each row execute function public.fn_lancamento_protege();

-- ---------------------------------------------------------------------
-- Títulos do pedido
-- ---------------------------------------------------------------------
create or replace function public.fn_pedido_gerar_titulos(p_pedido uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  p record;
  v_dias integer[];
  v_n integer;
  v_parcela numeric;
  v_conta uuid;
  v_plano uuid;
  i integer;
begin
  if exists (select 1 from public.lancamentos where origem = 'pedido' and origem_id = p_pedido and ativo) then
    return 0;
  end if;
  select pe.*, cp.parcelas_dias, fp.gera_boleto
    into p
    from public.pedidos pe
    left join public.condicoes_pagamento cp on cp.id = pe.condicao_pagamento_id
    left join public.formas_pagamento fp on fp.id = pe.forma_pagamento_id
   where pe.id = p_pedido;
  if p.valor_total <= 0 then return 0; end if;

  v_dias := coalesce(nullif(p.parcelas_dias, '{}'), '{0}');
  v_n := cardinality(v_dias);
  v_parcela := round(p.valor_total / v_n, 2);
  select id into v_plano from public.plano_contas where empresa_id = p.empresa_id and codigo = '1.01' and ativo;
  if coalesce(p.gera_boleto, false) then
    select id into v_conta from public.contas_bancarias where empresa_id = p.empresa_id and emite_boleto and ativo order by criado_em limit 1;
  end if;

  perform set_config('elos.regra', '1', true);
  for i in 1..v_n loop
    insert into public.lancamentos (empresa_id, tipo, pessoa_id, plano_conta_id, conta_bancaria_id, forma_pagamento_id,
      descricao, documento, parcela, total_parcelas, valor, data_competencia, data_vencimento, origem, origem_id)
    values (p.empresa_id, 'receber', p.cliente_id, v_plano, v_conta, p.forma_pagamento_id,
      'Pedido nº ' || p.numero || case when v_n > 1 then format(' · parcela %s/%s', i, v_n) else '' end,
      p.numero::text, i, v_n,
      case when i < v_n then v_parcela else p.valor_total - v_parcela * (v_n - 1) end,
      current_date, current_date + v_dias[i], 'pedido', p.id);
  end loop;
  return v_n;
end;
$$;

create or replace function public.fn_pedido_cancelar_titulos(p_pedido uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('elos.regra', '1', true);
  update public.lancamentos
     set ativo = false, cancelado_em = now(), motivo_cancelamento = p_motivo
   where origem = 'pedido' and origem_id = p_pedido and ativo and data_quitacao is null;
end;
$$;

-- Liga o financeiro à situação do pedido
create or replace function public.fn_pedido_financeiro()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_regra text := current_setting('elos.regra', true);
begin
  if new.status = 'em_rota' and old.status is distinct from 'em_rota' then
    perform public.fn_pedido_gerar_titulos(new.id);
  elsif new.status = 'devolvido' and old.status = 'em_rota' then
    perform public.fn_pedido_cancelar_titulos(new.id, 'Pedido devolvido na entrega');
  elsif new.status = 'aprovado' and old.status = 'em_rota' then
    perform public.fn_pedido_cancelar_titulos(new.id, 'Cliente ausente: título refeito na próxima saída');
  end if;
  -- devolve o sinal de regra como estava (a função chamadora ainda pode precisar)
  perform set_config('elos.regra', coalesce(v_regra, ''), true);
  return null;
end;
$$;
create trigger trg_pedidos_financeiro after update of status on public.pedidos
  for each row execute function public.fn_pedido_financeiro();

-- ---------------------------------------------------------------------
-- Ações do financeiro
-- ---------------------------------------------------------------------

-- Novo lançamento, à vista ou parcelado
create or replace function public.lancamento_criar(
  p_tipo text, p_descricao text, p_valor_total numeric, p_primeiro_vencimento date,
  p_parcelas integer default 1, p_intervalo_dias integer default 30,
  p_pessoa uuid default null, p_documento text default null, p_plano_conta uuid default null,
  p_centro_custo uuid default null, p_forma uuid default null, p_conta uuid default null,
  p_competencia date default null, p_observacao text default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp uuid := public.empresa_atual();
  v_parcela numeric;
  i integer;
begin
  perform public.fn_exigir('financeiro', 'criar');
  if p_tipo not in ('receber', 'pagar') then raise exception 'Tipo inválido.'; end if;
  if coalesce(trim(p_descricao), '') = '' then raise exception 'Informe a descrição.'; end if;
  if coalesce(p_valor_total, 0) <= 0 then raise exception 'Informe um valor maior que zero.'; end if;
  if p_primeiro_vencimento is null then raise exception 'Informe o vencimento.'; end if;
  if coalesce(p_parcelas, 1) < 1 or p_parcelas > 120 then raise exception 'Número de parcelas inválido (1 a 120).'; end if;
  if p_pessoa is not null and not exists (select 1 from public.pessoas where id = p_pessoa and empresa_id = v_emp) then
    raise exception 'Pessoa não encontrada.';
  end if;

  v_parcela := round(p_valor_total / p_parcelas, 2);
  perform set_config('elos.regra', '1', true);
  for i in 1..p_parcelas loop
    insert into public.lancamentos (empresa_id, tipo, pessoa_id, plano_conta_id, centro_custo_id, conta_bancaria_id, forma_pagamento_id,
      descricao, documento, parcela, total_parcelas, valor, data_competencia, data_vencimento, origem, observacao)
    values (v_emp, p_tipo, p_pessoa, p_plano_conta, p_centro_custo, p_conta, p_forma,
      trim(p_descricao) || case when p_parcelas > 1 then format(' · parcela %s/%s', i, p_parcelas) else '' end,
      nullif(trim(p_documento), ''), i, p_parcelas,
      case when i < p_parcelas then v_parcela else p_valor_total - v_parcela * (p_parcelas - 1) end,
      coalesce(p_competencia, p_primeiro_vencimento),
      case when p_intervalo_dias = 30 then (p_primeiro_vencimento + make_interval(months => i - 1))::date
           else p_primeiro_vencimento + coalesce(p_intervalo_dias, 30) * (i - 1) end,
      'manual', nullif(trim(p_observacao), ''));
  end loop;
  perform set_config('elos.regra', '', true);
  return p_parcelas;
end;
$$;

-- Baixa: valor pago = principal + juros + multa - desconto.
-- Se o principal pago for menor que o título, o saldo vira um novo título.
create or replace function public.lancamento_baixar(
  p_lancamento uuid, p_data date, p_valor_pago numeric, p_conta uuid,
  p_juros numeric default 0, p_multa numeric default 0, p_desconto numeric default 0,
  p_forma uuid default null, p_observacao text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  l public.lancamentos;
  v_principal numeric;
  v_saldo numeric;
  v_novo uuid;
begin
  perform public.fn_exigir('financeiro', 'editar');
  select * into l from public.lancamentos where id = p_lancamento and empresa_id = public.empresa_atual() for update;
  if not found or not l.ativo then raise exception 'Lançamento não encontrado ou cancelado.'; end if;
  if l.data_quitacao is not null then raise exception 'Este lançamento já está quitado.'; end if;
  if p_data is null then raise exception 'Informe a data do pagamento.'; end if;
  if p_data > current_date then raise exception 'A data do pagamento não pode ser futura.'; end if;
  if coalesce(p_valor_pago, 0) <= 0 then raise exception 'Informe o valor pago.'; end if;
  if p_conta is null or not exists (select 1 from public.contas_bancarias where id = p_conta and empresa_id = l.empresa_id) then
    raise exception 'Informe a conta (banco ou caixa) do pagamento.';
  end if;
  if coalesce(p_juros, 0) < 0 or coalesce(p_multa, 0) < 0 or coalesce(p_desconto, 0) < 0 then
    raise exception 'Juros, multa e desconto não podem ser negativos.';
  end if;

  v_principal := round(p_valor_pago - coalesce(p_juros, 0) - coalesce(p_multa, 0) + coalesce(p_desconto, 0), 2);
  if v_principal > l.valor + 0.009 then
    raise exception 'O valor pago passa do valor do título em %. Lance a diferença como juros ou multa.', public.fn_brl(v_principal - l.valor);
  end if;
  if v_principal <= 0 then raise exception 'O valor pago não cobre nada do título.'; end if;
  v_saldo := round(l.valor - v_principal, 2);

  perform set_config('elos.regra', '1', true);
  if v_saldo > 0 then
    insert into public.lancamentos (empresa_id, tipo, pessoa_id, plano_conta_id, centro_custo_id, conta_bancaria_id, forma_pagamento_id,
      descricao, documento, parcela, total_parcelas, valor, data_competencia, data_vencimento, origem, origem_id, titulo_pai_id, observacao)
    values (l.empresa_id, l.tipo, l.pessoa_id, l.plano_conta_id, l.centro_custo_id, l.conta_bancaria_id, l.forma_pagamento_id,
      l.descricao || ' · saldo', l.documento, l.parcela, l.total_parcelas, v_saldo, l.data_competencia, l.data_vencimento, l.origem, l.origem_id, l.id,
      'Saldo da baixa parcial de ' || to_char(p_data, 'DD/MM/YYYY'))
    returning id into v_novo;
  end if;

  update public.lancamentos
     set valor = v_principal, data_quitacao = p_data, valor_pago = p_valor_pago,
         juros = coalesce(p_juros, 0), multa = coalesce(p_multa, 0), desconto = coalesce(p_desconto, 0),
         conta_bancaria_id = p_conta, forma_pagamento_id = coalesce(p_forma, l.forma_pagamento_id),
         observacao = coalesce(nullif(trim(p_observacao), ''), l.observacao),
         baixado_por = auth.uid(), baixado_em = now()
   where id = l.id;
  perform set_config('elos.regra', '', true);
  return jsonb_build_object('saldo', v_saldo, 'saldo_id', v_novo);
end;
$$;

-- Estorno: desfaz a baixa; um saldo em aberto gerado por ela volta para o título
create or replace function public.lancamento_estornar(p_lancamento uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  l public.lancamentos;
  f public.lancamentos;
begin
  perform public.fn_exigir('financeiro', 'editar');
  select * into l from public.lancamentos where id = p_lancamento and empresa_id = public.empresa_atual() for update;
  if not found or not l.ativo then raise exception 'Lançamento não encontrado ou cancelado.'; end if;
  if l.data_quitacao is null then raise exception 'Este lançamento não está quitado.'; end if;

  perform set_config('elos.regra', '1', true);
  select * into f from public.lancamentos where titulo_pai_id = l.id and ativo for update;
  if found then
    if f.data_quitacao is not null then
      raise exception 'O saldo desta baixa já foi pago. Estorne primeiro o saldo (%).', f.descricao;
    end if;
    update public.lancamentos set ativo = false, cancelado_em = now(), motivo_cancelamento = 'Juntado ao título no estorno' where id = f.id;
    update public.lancamentos set valor = valor + f.valor where id = l.id;
  end if;
  update public.lancamentos
     set data_quitacao = null, valor_pago = null, juros = 0, multa = 0, desconto = 0, baixado_por = null, baixado_em = null
   where id = l.id;
  perform set_config('elos.regra', '', true);
end;
$$;

create or replace function public.lancamento_cancelar(p_lancamento uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  l public.lancamentos;
begin
  perform public.fn_exigir('financeiro', 'editar');
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo do cancelamento.'; end if;
  select * into l from public.lancamentos where id = p_lancamento and empresa_id = public.empresa_atual() for update;
  if not found or not l.ativo then raise exception 'Lançamento não encontrado ou já cancelado.'; end if;
  if l.data_quitacao is not null then raise exception 'Estorne a baixa antes de cancelar.'; end if;
  perform set_config('elos.regra', '1', true);
  update public.lancamentos set ativo = false, cancelado_em = now(), motivo_cancelamento = trim(p_motivo) where id = l.id;
  perform set_config('elos.regra', '', true);
end;
$$;

-- ---------------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------------
drop view if exists public.vw_lancamentos;
create view public.vw_lancamentos
with (security_invoker = true)
as
select l.*,
       case
         when not l.ativo then 'cancelado'
         when l.data_quitacao is not null then 'quitado'
         when l.data_vencimento < current_date then 'atrasado'
         when l.data_vencimento = current_date then 'vence_hoje'
         else 'em_aberto'
       end as situacao,
       case when l.ativo and l.data_quitacao is null and l.data_vencimento < current_date
            then current_date - l.data_vencimento else 0 end as dias_atraso,
       p.razao_social as pessoa_nome,
       p.nome_fantasia as pessoa_fantasia,
       p.codigo as pessoa_codigo,
       pc.codigo as plano_conta_codigo,
       pc.nome as plano_conta_nome,
       cc.nome as centro_custo_nome,
       cb.nome as conta_nome,
       fp.nome as forma_nome
  from public.lancamentos l
  left join public.pessoas p on p.id = l.pessoa_id
  left join public.plano_contas pc on pc.id = l.plano_conta_id
  left join public.centros_custo cc on cc.id = l.centro_custo_id
  left join public.contas_bancarias cb on cb.id = l.conta_bancaria_id
  left join public.formas_pagamento fp on fp.id = l.forma_pagamento_id;

-- Saldo de cada conta: saldo inicial + recebido - pago desde a data do saldo inicial
create or replace view public.vw_contas_saldos
with (security_invoker = true)
as
select cb.id, cb.empresa_id, cb.nome, cb.banco_codigo, cb.saldo_inicial, cb.data_saldo_inicial, cb.ativo,
       coalesce(sum(l.valor_pago) filter (where l.tipo = 'receber'), 0) as entradas,
       coalesce(sum(l.valor_pago) filter (where l.tipo = 'pagar'), 0) as saidas,
       cb.saldo_inicial
         + coalesce(sum(l.valor_pago) filter (where l.tipo = 'receber'), 0)
         - coalesce(sum(l.valor_pago) filter (where l.tipo = 'pagar'), 0) as saldo_atual
  from public.contas_bancarias cb
  left join public.lancamentos l on l.conta_bancaria_id = cb.id and l.ativo and l.data_quitacao is not null
                                and l.data_quitacao >= cb.data_saldo_inicial
 group by cb.id;

-- Extrato: tudo que entrou e saiu de cada conta
create or replace view public.vw_extrato
with (security_invoker = true)
as
select l.id, l.empresa_id, l.conta_bancaria_id, cb.nome as conta_nome, l.data_quitacao as data, l.tipo,
       l.descricao, l.documento, p.razao_social as pessoa_nome, p.nome_fantasia as pessoa_fantasia,
       pc.nome as plano_conta_nome, fp.nome as forma_nome,
       l.valor, l.juros, l.multa, l.desconto, l.valor_pago,
       case when l.tipo = 'receber' then l.valor_pago else -l.valor_pago end as valor_sinal
  from public.lancamentos l
  join public.contas_bancarias cb on cb.id = l.conta_bancaria_id
  left join public.pessoas p on p.id = l.pessoa_id
  left join public.plano_contas pc on pc.id = l.plano_conta_id
  left join public.formas_pagamento fp on fp.id = l.forma_pagamento_id
 where l.ativo and l.data_quitacao is not null and l.data_quitacao >= cb.data_saldo_inicial;

-- ---------------------------------------------------------------------
-- Permissões
-- ---------------------------------------------------------------------
revoke execute on function public.fn_pedido_gerar_titulos(uuid) from public, anon, authenticated;
revoke execute on function public.fn_pedido_cancelar_titulos(uuid, text) from public, anon, authenticated;

do $$ declare f text; begin foreach f in array array[
  'lancamento_criar(text, text, numeric, date, integer, integer, uuid, text, uuid, uuid, uuid, uuid, date, text)',
  'lancamento_baixar(uuid, date, numeric, uuid, numeric, numeric, numeric, uuid, text)',
  'lancamento_estornar(uuid)', 'lancamento_cancelar(uuid, text)'
] loop
  execute format('revoke execute on function public.%s from public, anon', f);
  execute format('grant execute on function public.%s to authenticated', f);
end loop; end $$;

-- =====================================================================
-- Fase 7a · Relatórios da versão 1
-- Datas no fuso de Campo Grande. Venda = pedido confirmado (aprovado em
-- diante), sem cancelados e devolvidos; opção de contar só entregues.
-- =====================================================================

-- "Hoje" e datas sem horário passam a seguir o fuso da empresa
do $$ begin
  execute format('alter database %I set timezone = %L', current_database(), 'America/Campo_Grande');
end $$;
set timezone = 'America/Campo_Grande';

-- Pedidos que contam como venda no período (uso interno)
create or replace function public.fn_rel_vendas(p_de date, p_ate date, p_vendedor uuid, p_rota uuid, p_entregues boolean)
returns setof public.pedidos
language sql
stable
security definer
set search_path = public
as $$
  select pe.* from public.pedidos pe
   where pe.empresa_id = public.empresa_atual()
     and pe.tipo = 'pedido' and pe.ativo
     and (pe.data_emissao at time zone 'America/Campo_Grande')::date between p_de and p_ate
     and pe.status = any(case when p_entregues then array['entregue']
                              else array['aprovado', 'em_separacao', 'faturado', 'em_rota', 'entregue'] end)
     and (p_vendedor is null or pe.vendedor_id = p_vendedor)
     and (p_rota is null or pe.rota_id = p_rota);
$$;

-- 1. Vendas por período
create or replace function public.rel_vendas_periodo(
  p_de date, p_ate date, p_agrupar text default 'dia',
  p_vendedor uuid default null, p_rota uuid default null, p_entregues boolean default false)
returns table (periodo date, pedidos bigint, clientes bigint, valor numeric, peso numeric, ticket_medio numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.fn_exigir('relatorios', 'ver');
  return query
  select date_trunc(case p_agrupar when 'mes' then 'month' when 'semana' then 'week' else 'day' end,
                    (v.data_emissao at time zone 'America/Campo_Grande'))::date,
         count(*), count(distinct v.cliente_id), sum(v.valor_total), sum(v.peso_total_kg), round(avg(v.valor_total), 2)
    from public.fn_rel_vendas(p_de, p_ate, p_vendedor, p_rota, p_entregues) v
   group by 1 order by 1;
end;
$$;

-- 2. Curva ABC de produtos (A até 80% do faturamento, B até 95%, C o resto)
create or replace function public.rel_abc_produtos(
  p_de date, p_ate date, p_vendedor uuid default null, p_rota uuid default null, p_entregues boolean default false)
returns table (produto_codigo text, produto_nome text, unidade text, quantidade numeric, valor numeric, clientes bigint,
               participacao numeric, acumulado numeric, classe text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.fn_exigir('relatorios', 'ver');
  return query
  with base as (
    select pr.codigo, pr.nome, u.sigla, sum(i.quantidade) as qtd, sum(i.valor_total) as val, count(distinct v.cliente_id) as cli
      from public.fn_rel_vendas(p_de, p_ate, p_vendedor, p_rota, p_entregues) v
      join public.pedidos_itens i on i.pedido_id = v.id and i.ativo
      join public.produtos pr on pr.id = i.produto_id
      left join public.unidades u on u.id = pr.unidade_id
     group by pr.codigo, pr.nome, u.sigla
  ), tot as (select nullif(sum(val), 0) as t from base),
  acum as (
    select b.*, round(100 * b.val / tot.t, 2) as part,
           round(100 * sum(b.val) over (order by b.val desc, b.nome rows unbounded preceding) / tot.t, 2) as ac
      from base b, tot
  )
  select a.codigo, a.nome, a.sigla, a.qtd, a.val, a.cli, a.part, a.ac,
         case when a.ac - a.part < 80 then 'A' when a.ac - a.part < 95 then 'B' else 'C' end
    from acum a order by a.val desc, a.nome;
end;
$$;

-- 3. Curva ABC de clientes
create or replace function public.rel_abc_clientes(
  p_de date, p_ate date, p_vendedor uuid default null, p_rota uuid default null, p_entregues boolean default false)
returns table (cliente_codigo bigint, cliente_nome text, razao_social text, vendedor_nome text, rota_nome text,
               pedidos bigint, valor numeric, ticket_medio numeric, ultimo_pedido date,
               participacao numeric, acumulado numeric, classe text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.fn_exigir('relatorios', 'ver');
  return query
  with base as (
    select c.codigo, c.razao_social, c.nome_fantasia, vd.razao_social as vend, r.nome as rota,
           count(*) as ped, sum(v.valor_total) as val, max((v.data_emissao at time zone 'America/Campo_Grande')::date) as ult
      from public.fn_rel_vendas(p_de, p_ate, p_vendedor, p_rota, p_entregues) v
      join public.pessoas c on c.id = v.cliente_id
      left join public.pessoas vd on vd.id = c.vendedor_id
      left join public.rotas r on r.id = c.rota_id
     group by c.id, vd.razao_social, r.nome
  ), tot as (select nullif(sum(val), 0) as t from base),
  acum as (
    select b.*, round(100 * b.val / tot.t, 2) as part,
           round(100 * sum(b.val) over (order by b.val desc, b.razao_social rows unbounded preceding) / tot.t, 2) as ac
      from base b, tot
  )
  select a.codigo, coalesce(a.nome_fantasia, a.razao_social), a.razao_social, a.vend, a.rota, a.ped, a.val, round(a.val / a.ped, 2), a.ult, a.part, a.ac,
         case when a.ac - a.part < 80 then 'A' when a.ac - a.part < 95 then 'B' else 'C' end
    from acum a order by a.val desc, a.razao_social;
end;
$$;

-- 4. Ranking de vendedores, com meta mensal proporcional ao período e comissão prevista
create or replace function public.rel_ranking_vendedores(
  p_de date, p_ate date, p_rota uuid default null, p_entregues boolean default false)
returns table (vendedor_nome text, pedidos bigint, clientes bigint, valor numeric, ticket_medio numeric,
               meta numeric, atingido numeric, comissao_percentual numeric, comissao_prevista numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_meses numeric := greatest(round(((p_ate - p_de + 1)::numeric / 30.4), 2), 0.03);
begin
  perform public.fn_exigir('relatorios', 'ver');
  return query
  select coalesce(vd.razao_social, 'Sem vendedor'), count(*), count(distinct v.cliente_id), sum(v.valor_total), round(avg(v.valor_total), 2),
         round(vd.meta_mensal * v_meses, 2),
         case when vd.meta_mensal > 0 then round(100 * sum(v.valor_total) / (vd.meta_mensal * v_meses), 1) end,
         vd.comissao_percentual,
         round(sum(v.valor_total) * coalesce(vd.comissao_percentual, 0) / 100, 2)
    from public.fn_rel_vendas(p_de, p_ate, null, p_rota, p_entregues) v
    left join public.pessoas vd on vd.id = v.vendedor_id
   group by vd.id
   order by sum(v.valor_total) desc;
end;
$$;

-- 5. Vendas por rota, com cobertura da carteira (clientes que compraram / clientes da rota)
create or replace function public.rel_vendas_rota(
  p_de date, p_ate date, p_vendedor uuid default null, p_entregues boolean default false)
returns table (rota_nome text, clientes_rota bigint, clientes_compraram bigint, cobertura numeric,
               pedidos bigint, valor numeric, peso numeric, ticket_medio numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.fn_exigir('relatorios', 'ver');
  return query
  with v as (select * from public.fn_rel_vendas(p_de, p_ate, p_vendedor, null, p_entregues)),
  cart as (
    select coalesce(c.rota_id, '00000000-0000-0000-0000-000000000000'::uuid) as rota_id, count(*) as n from public.pessoas c
     where c.empresa_id = public.empresa_atual() and c.eh_cliente and c.ativo
       and (p_vendedor is null or c.vendedor_id = p_vendedor)
     group by 1
  ),
  vend as (
    select coalesce(v.rota_id, '00000000-0000-0000-0000-000000000000'::uuid) as rota_id, count(distinct v.cliente_id) as cli, count(*) as ped, sum(v.valor_total) as val, sum(v.peso_total_kg) as pes
      from v group by 1
  )
  select coalesce(r.nome, 'Sem rota'), coalesce(cart.n, 0), coalesce(vend.cli, 0),
         case when cart.n > 0 then round(100.0 * coalesce(vend.cli, 0) / cart.n, 1) end,
         coalesce(vend.ped, 0), coalesce(vend.val, 0), coalesce(vend.pes, 0),
         case when vend.ped > 0 then round(vend.val / vend.ped, 2) end
    from cart full join vend on vend.rota_id = cart.rota_id
    left join public.rotas r on r.id = coalesce(cart.rota_id, vend.rota_id)
   order by coalesce(vend.val, 0) desc, 1;
end;
$$;

-- 6. Pedidos pendentes de entrega
create or replace function public.rel_pedidos_pendentes(p_vendedor uuid default null, p_rota uuid default null)
returns table (numero bigint, situacao text, emissao date, entrega date, dias_aberto integer, cliente_codigo bigint,
               cliente_nome text, vendedor_nome text, rota_nome text, carga bigint, valor numeric, peso numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.fn_exigir('relatorios', 'ver');
  return query
  select pe.numero,
         case pe.status when 'aguardando_credito' then 'Aguardando crédito' when 'aprovado' then 'Aprovado'
                        when 'em_separacao' then 'Em separação' when 'faturado' then 'Faturado' when 'em_rota' then 'Em rota' end,
         (pe.data_emissao at time zone 'America/Campo_Grande')::date, pe.data_entrega,
         current_date - (pe.data_emissao at time zone 'America/Campo_Grande')::date,
         c.codigo, coalesce(c.nome_fantasia, c.razao_social), vd.razao_social, r.nome,
         (select e.numero from public.expedicoes_pedidos ep join public.expedicoes e on e.id = ep.expedicao_id
           where ep.pedido_id = pe.id and e.status in ('montando', 'separando', 'em_rota') limit 1),
         pe.valor_total, pe.peso_total_kg
    from public.pedidos pe
    join public.pessoas c on c.id = pe.cliente_id
    left join public.pessoas vd on vd.id = pe.vendedor_id
    left join public.rotas r on r.id = pe.rota_id
   where pe.empresa_id = public.empresa_atual() and pe.tipo = 'pedido' and pe.ativo
     and pe.status in ('aguardando_credito', 'aprovado', 'em_separacao', 'faturado', 'em_rota')
     and (p_vendedor is null or pe.vendedor_id = p_vendedor)
     and (p_rota is null or pe.rota_id = p_rota)
   order by pe.data_entrega nulls last, pe.numero;
end;
$$;

-- 7. Estoque atual por produto, valorizado pelo custo
create or replace function public.rel_estoque_atual()
returns table (produto_codigo text, produto_nome text, categoria text, unidade text, quantidade numeric, reservado numeric,
               disponivel numeric, vencido numeric, estoque_minimo numeric, custo numeric, valor_custo numeric,
               preco_venda numeric, valor_venda numeric, abaixo_minimo boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.fn_exigir('relatorios', 'ver');
  return query
  select pr.codigo, pr.nome, cat.nome, u.sigla,
         coalesce(sum(s.quantidade), 0), coalesce(sum(s.quantidade_reservada), 0),
         coalesce(sum(s.quantidade - s.quantidade_reservada) filter (where lo.validade is null or lo.validade >= current_date), 0),
         coalesce(sum(s.quantidade) filter (where lo.validade < current_date), 0),
         pr.estoque_minimo, pr.custo,
         round(coalesce(sum(s.quantidade), 0) * pr.custo, 2), pr.preco_venda,
         round(coalesce(sum(s.quantidade), 0) * pr.preco_venda, 2),
         pr.estoque_minimo > 0 and coalesce(sum(s.quantidade - s.quantidade_reservada) filter (where lo.validade is null or lo.validade >= current_date), 0) < pr.estoque_minimo
    from public.produtos pr
    left join public.categorias cat on cat.id = pr.categoria_id
    left join public.unidades u on u.id = pr.unidade_id
    left join public.estoque_saldos s on s.produto_id = pr.id
    left join public.lotes lo on lo.id = s.lote_id
   where pr.empresa_id = public.empresa_atual() and pr.ativo
   group by pr.id, cat.nome, u.sigla
   order by pr.nome;
end;
$$;

-- 8. Produtos perto do vencimento (inclui vencidos)
create or replace function public.rel_vencimentos(p_dias integer default 30)
returns table (produto_codigo text, produto_nome text, lote text, validade date, dias_para_vencer integer, deposito text,
               quantidade numeric, reservado numeric, valor_custo numeric, situacao text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.fn_exigir('relatorios', 'ver');
  return query
  select pr.codigo, pr.nome, lo.numero, lo.validade, lo.validade - current_date, d.nome, s.quantidade, s.quantidade_reservada,
         round(s.quantidade * pr.custo, 2),
         case when lo.validade < current_date then 'Vencido' when lo.validade - current_date <= 7 then 'Vence em até 7 dias' else 'Vence no prazo escolhido' end
    from public.estoque_saldos s
    join public.lotes lo on lo.id = s.lote_id
    join public.produtos pr on pr.id = s.produto_id
    join public.depositos d on d.id = s.deposito_id
   where s.empresa_id = public.empresa_atual() and s.quantidade > 0
     and lo.validade <= current_date + coalesce(p_dias, 30)
   order by lo.validade, pr.nome;
end;
$$;

-- 9. Contas a receber em atraso, por cliente e faixa de atraso
create or replace function public.rel_receber_atraso(p_vendedor uuid default null, p_rota uuid default null)
returns table (cliente_codigo bigint, cliente_nome text, telefone text, vendedor_nome text, rota_nome text, titulos bigint,
               ate_15 numeric, de_16_30 numeric, de_31_60 numeric, acima_60 numeric, total numeric, maior_atraso integer, vencimento_mais_antigo date)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.fn_exigir('relatorios', 'ver');
  perform public.fn_exigir('financeiro', 'ver');
  return query
  select c.codigo, coalesce(c.nome_fantasia, c.razao_social), coalesce(c.whatsapp, c.telefone), vd.razao_social, r.nome, count(*),
         coalesce(sum(l.valor) filter (where current_date - l.data_vencimento <= 15), 0),
         coalesce(sum(l.valor) filter (where current_date - l.data_vencimento between 16 and 30), 0),
         coalesce(sum(l.valor) filter (where current_date - l.data_vencimento between 31 and 60), 0),
         coalesce(sum(l.valor) filter (where current_date - l.data_vencimento > 60), 0),
         sum(l.valor), max(current_date - l.data_vencimento), min(l.data_vencimento)
    from public.lancamentos l
    join public.pessoas c on c.id = l.pessoa_id
    left join public.pessoas vd on vd.id = c.vendedor_id
    left join public.rotas r on r.id = c.rota_id
   where l.empresa_id = public.empresa_atual() and l.tipo = 'receber' and l.ativo
     and l.data_quitacao is null and l.data_vencimento < current_date
     and (p_vendedor is null or c.vendedor_id = p_vendedor)
     and (p_rota is null or c.rota_id = p_rota)
   group by c.id, vd.razao_social, r.nome
   order by sum(l.valor) desc;
end;
$$;

-- 10. Fluxo de caixa: realizado até hoje e previsto daqui em diante.
-- Títulos vencidos e não pagos entram como previstos para hoje.
create or replace function public.rel_fluxo_caixa(p_de date, p_ate date)
returns table (data date, recebido numeric, pago numeric, a_receber numeric, a_pagar numeric, saldo numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_emp uuid := public.empresa_atual();
  v_saldo_ini numeric;
begin
  perform public.fn_exigir('relatorios', 'ver');
  perform public.fn_exigir('financeiro', 'ver');
  -- saldo de todas as contas no dia anterior ao início
  select coalesce(sum(cb.saldo_inicial), 0)
         + coalesce((select sum(case when l.tipo = 'receber' then l.valor_pago else -l.valor_pago end)
                       from public.lancamentos l join public.contas_bancarias cb2 on cb2.id = l.conta_bancaria_id
                      where l.empresa_id = v_emp and l.ativo and l.data_quitacao is not null
                        and l.data_quitacao >= cb2.data_saldo_inicial and l.data_quitacao < p_de), 0)
    into v_saldo_ini
    from public.contas_bancarias cb where cb.empresa_id = v_emp and cb.ativo;

  return query
  with dias as (select generate_series(p_de, p_ate, interval '1 day')::date as d),
  real as (
    select l.data_quitacao as d,
           sum(l.valor_pago) filter (where l.tipo = 'receber') as rec,
           sum(l.valor_pago) filter (where l.tipo = 'pagar') as pag
      from public.lancamentos l
     where l.empresa_id = v_emp and l.ativo and l.data_quitacao between p_de and p_ate
     group by 1
  ),
  prev as (
    select greatest(l.data_vencimento, current_date) as d,
           sum(l.valor) filter (where l.tipo = 'receber') as rec,
           sum(l.valor) filter (where l.tipo = 'pagar') as pag
      from public.lancamentos l
     where l.empresa_id = v_emp and l.ativo and l.data_quitacao is null
       and greatest(l.data_vencimento, current_date) between p_de and p_ate
     group by 1
  )
  select dias.d, coalesce(real.rec, 0), coalesce(real.pag, 0), coalesce(prev.rec, 0), coalesce(prev.pag, 0),
         v_saldo_ini + sum(coalesce(real.rec, 0) - coalesce(real.pag, 0) + coalesce(prev.rec, 0) - coalesce(prev.pag, 0))
                       over (order by dias.d rows unbounded preceding)
    from dias
    left join real on real.d = dias.d
    left join prev on prev.d = dias.d
   order by dias.d;
end;
$$;

revoke execute on function public.fn_rel_vendas(date, date, uuid, uuid, boolean) from public, anon, authenticated;
do $$ declare f text; begin foreach f in array array[
  'rel_vendas_periodo(date, date, text, uuid, uuid, boolean)',
  'rel_abc_produtos(date, date, uuid, uuid, boolean)',
  'rel_abc_clientes(date, date, uuid, uuid, boolean)',
  'rel_ranking_vendedores(date, date, uuid, boolean)',
  'rel_vendas_rota(date, date, uuid, boolean)',
  'rel_pedidos_pendentes(uuid, uuid)',
  'rel_estoque_atual()',
  'rel_vencimentos(integer)',
  'rel_receber_atraso(uuid, uuid)',
  'rel_fluxo_caixa(date, date)'
] loop
  execute format('revoke execute on function public.%s from public, anon', f);
  execute format('grant execute on function public.%s to authenticated', f);
end loop; end $$;

-- =====================================================================
-- Fase 4b · Força de vendas e acompanhamento de entregas
-- Vendedor vê só a própria carteira; app de pedidos com envio idempotente
-- (funciona sem sinal e sincroniza depois); visitas sem pedido;
-- posição do motorista e coordenadas de cada entrega.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Carteira do vendedor
-- ---------------------------------------------------------------------
alter table public.perfis add column if not exists apenas_carteira boolean not null default false;
update public.perfis set apenas_carteira = true where nome = 'Vendedor' and not administrador;

-- Pessoa (vendedor) a que o usuário está restrito, ou null se vê tudo
create or replace function public.fn_carteira()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select case when p.apenas_carteira and not p.administrador
              then coalesce(u.pessoa_id, '00000000-0000-0000-0000-000000000000'::uuid) end
    from public.usuarios u join public.perfis p on p.id = u.perfil_id
   where u.id = auth.uid() and u.ativo;
$$;

drop policy if exists "pessoas_ver" on public.pessoas;
drop policy if exists "pessoas_editar" on public.pessoas;
create policy "pessoas_ver" on public.pessoas for select to authenticated
  using (empresa_id = public.empresa_atual() and public.tem_permissao('cadastros', 'ver')
         and (public.fn_carteira() is null or id = public.fn_carteira() or vendedor_id = public.fn_carteira()));
create policy "pessoas_editar" on public.pessoas for update to authenticated
  using (empresa_id = public.empresa_atual() and public.tem_permissao('cadastros', 'editar')
         and (public.fn_carteira() is null or vendedor_id = public.fn_carteira()))
  with check (empresa_id = public.empresa_atual() and public.tem_permissao('cadastros', 'editar'));

do $$ declare a text; cond text := '(public.fn_carteira() is null or vendedor_id = public.fn_carteira())'; begin
  foreach a in array array['ver', 'criar', 'editar', 'excluir'] loop
    execute format('drop policy if exists %I on public.pedidos', 'pedidos_' || a);
  end loop;
  execute 'create policy "pedidos_ver" on public.pedidos for select to authenticated using (empresa_id = public.empresa_atual() and public.tem_permissao(''vendas'', ''ver'') and ' || cond || ')';
  execute 'create policy "pedidos_criar" on public.pedidos for insert to authenticated with check (empresa_id = public.empresa_atual() and public.tem_permissao(''vendas'', ''criar'') and ' || cond || ')';
  execute 'create policy "pedidos_editar" on public.pedidos for update to authenticated using (empresa_id = public.empresa_atual() and public.tem_permissao(''vendas'', ''editar'') and ' || cond || ') with check (empresa_id = public.empresa_atual() and ' || cond || ')';
  execute 'create policy "pedidos_excluir" on public.pedidos for delete to authenticated using (empresa_id = public.empresa_atual() and public.tem_permissao(''vendas'', ''excluir'') and ' || cond || ')';
end $$;

do $$ declare a text; cond text := '(public.fn_carteira() is null or exists (select 1 from public.pedidos p where p.id = pedido_id and p.vendedor_id = public.fn_carteira()))'; begin
  foreach a in array array['ver', 'criar', 'editar', 'excluir'] loop
    execute format('drop policy if exists %I on public.pedidos_itens', 'pedidos_itens_' || a);
  end loop;
  execute 'create policy "pedidos_itens_ver" on public.pedidos_itens for select to authenticated using (empresa_id = public.empresa_atual() and public.tem_permissao(''vendas'', ''ver'') and ' || cond || ')';
  execute 'create policy "pedidos_itens_criar" on public.pedidos_itens for insert to authenticated with check (empresa_id = public.empresa_atual() and public.tem_permissao(''vendas'', ''criar'') and ' || cond || ')';
  execute 'create policy "pedidos_itens_editar" on public.pedidos_itens for update to authenticated using (empresa_id = public.empresa_atual() and public.tem_permissao(''vendas'', ''editar'') and ' || cond || ')';
  execute 'create policy "pedidos_itens_excluir" on public.pedidos_itens for delete to authenticated using (empresa_id = public.empresa_atual() and public.tem_permissao(''vendas'', ''excluir'') and ' || cond || ')';
  execute 'drop policy if exists "pedidos_reservas_ver" on public.pedidos_reservas';
  execute 'create policy "pedidos_reservas_ver" on public.pedidos_reservas for select to authenticated using (empresa_id = public.empresa_atual() and (public.tem_permissao(''vendas'', ''ver'') or public.tem_permissao(''estoque'', ''ver'')) and ' || cond || ')';
end $$;

-- Pedido de vendedor restrito sempre fica no nome dele
create or replace function public.fn_pedido_padroes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  v_cart uuid := public.fn_carteira();
begin
  if v_cart is not null then
    new.vendedor_id := v_cart;
  end if;
  if tg_op = 'UPDATE' and new.cliente_id is not distinct from old.cliente_id then
    return new;
  end if;
  select vendedor_id, rota_id, tabela_preco_id, condicao_pagamento_id, forma_pagamento_id
    into c from public.pessoas where id = new.cliente_id;
  if tg_op = 'INSERT' then
    new.vendedor_id := coalesce(new.vendedor_id, c.vendedor_id);
    new.rota_id := coalesce(new.rota_id, c.rota_id);
    new.tabela_preco_id := coalesce(new.tabela_preco_id, c.tabela_preco_id,
      (select id from public.tabelas_preco where empresa_id = new.empresa_id and padrao and ativo limit 1));
    new.condicao_pagamento_id := coalesce(new.condicao_pagamento_id, c.condicao_pagamento_id);
    new.forma_pagamento_id := coalesce(new.forma_pagamento_id, c.forma_pagamento_id);
    new.deposito_id := coalesce(new.deposito_id,
      (select id from public.depositos where empresa_id = new.empresa_id and ativo order by padrao desc, (tipo = 'camara_fria') desc, nome limit 1));
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Visitas do vendedor (com ou sem pedido)
-- ---------------------------------------------------------------------
create table public.visitas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  id_local text,
  cliente_id uuid not null references public.pessoas(id),
  vendedor_id uuid references public.pessoas(id),
  usuario_id uuid,
  data date not null default current_date,
  momento timestamptz not null default now(),
  resultado text not null check (resultado in ('pedido', 'sem_pedido')),
  motivo text,
  pedido_id uuid references public.pedidos(id) on delete set null,
  latitude numeric(10,7),
  longitude numeric(10,7),
  unique (empresa_id, id_local)
);
create index visitas_cliente_idx on public.visitas (cliente_id, data desc);
create index visitas_vendedor_idx on public.visitas (empresa_id, vendedor_id, data);
alter table public.visitas enable row level security;
create policy "visitas_ver" on public.visitas for select to authenticated
  using (empresa_id = public.empresa_atual() and public.tem_permissao('vendas', 'ver')
         and (public.fn_carteira() is null or vendedor_id = public.fn_carteira()));

-- ---------------------------------------------------------------------
-- Rastreamento da carga
-- ---------------------------------------------------------------------
alter table public.expedicoes
  add column if not exists saiu_em timestamptz,
  add column if not exists concluida_em timestamptz;

create or replace function public.fn_expedicao_marcos()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'em_rota' and old.status is distinct from 'em_rota' then new.saiu_em := now(); end if;
  if new.status = 'concluida' and old.status is distinct from 'concluida' then new.concluida_em := now(); end if;
  return new;
end;
$$;
create trigger trg_expedicoes_marcos before update of status on public.expedicoes
  for each row execute function public.fn_expedicao_marcos();

create table public.rastreamento (
  id bigint generated always as identity primary key,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  expedicao_id uuid not null references public.expedicoes(id) on delete cascade,
  usuario_id uuid,
  latitude numeric(10,7) not null,
  longitude numeric(10,7) not null,
  precisao numeric(8,1),
  registrado_em timestamptz not null default now()
);
create index rastreamento_exp_idx on public.rastreamento (expedicao_id, registrado_em desc);
alter table public.rastreamento enable row level security;
create policy "rastreamento_ver" on public.rastreamento for select to authenticated
  using (empresa_id = public.empresa_atual() and public.tem_permissao('expedicao', 'ver'));

-- Posição enviada pelo celular do motorista enquanto a carga está em rota
create or replace function public.app_posicao(p_expedicao uuid, p_lat numeric, p_lng numeric, p_precisao numeric default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.fn_exigir('expedicao', 'editar');
  if p_lat is null or p_lng is null or abs(p_lat) > 90 or abs(p_lng) > 180 then
    raise exception 'Posição inválida.';
  end if;
  insert into public.rastreamento (empresa_id, expedicao_id, usuario_id, latitude, longitude, precisao)
  select e.empresa_id, e.id, auth.uid(), p_lat, p_lng, p_precisao
    from public.expedicoes e
   where e.id = p_expedicao and e.empresa_id = public.empresa_atual() and e.status = 'em_rota';
end;
$$;

-- Entrega registrada com o ponto onde aconteceu; endereço sem coordenada aprende a do local
drop function if exists public.expedicao_registrar_entrega(uuid, text, text);
create or replace function public.expedicao_registrar_entrega(
  p_expedicao_pedido uuid, p_resultado text, p_motivo text default null,
  p_lat numeric default null, p_lng numeric default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ep public.expedicoes_pedidos;
  e public.expedicoes;
  v_numero bigint;
  v_cliente uuid;
  v_concluida boolean := false;
begin
  perform public.fn_exigir('expedicao', 'editar');
  if p_resultado not in ('entregue', 'devolvido_total', 'ausente') then
    raise exception 'Resultado de entrega inválido.';
  end if;
  if p_resultado = 'devolvido_total' and coalesce(trim(p_motivo), '') = '' then
    raise exception 'Informe o motivo da devolução.';
  end if;

  select * into ep from public.expedicoes_pedidos where id = p_expedicao_pedido and empresa_id = public.empresa_atual() for update;
  if not found then raise exception 'Entrega não encontrada.'; end if;
  e := public.fn_expedicao_obter(ep.expedicao_id, array['em_rota']);
  if ep.status_entrega <> 'pendente' then raise exception 'Esta entrega já foi registrada.'; end if;
  select numero, cliente_id into v_numero, v_cliente from public.pedidos where id = ep.pedido_id for update;

  if p_resultado = 'entregue' then
    update public.expedicoes_pedidos set status_entrega = 'entregue', entregue_em = now(), motivo_devolucao = nullif(trim(p_motivo), ''),
           latitude = p_lat, longitude = p_lng where id = ep.id;
    update public.pedidos set status = 'entregue' where id = ep.pedido_id;
    if p_lat is not null and p_lng is not null then
      update public.pessoas_enderecos x set latitude = p_lat, longitude = p_lng
       where x.id = (select y.id from public.pessoas_enderecos y where y.pessoa_id = v_cliente and y.ativo
                      order by (y.tipo = 'entrega') desc, (y.tipo = 'principal') desc, y.criado_em limit 1)
         and x.latitude is null;
    end if;
  elsif p_resultado = 'devolvido_total' then
    perform public.fn_expedicao_devolver(ep.pedido_id, format('Devolução · carga nº %s · pedido nº %s · %s', e.numero, v_numero, trim(p_motivo)));
    update public.expedicoes_pedidos set status_entrega = 'devolvido_total', entregue_em = now(), motivo_devolucao = trim(p_motivo),
           latitude = p_lat, longitude = p_lng where id = ep.id;
    update public.pedidos set status = 'devolvido' where id = ep.pedido_id;
  else
    perform public.fn_expedicao_devolver(ep.pedido_id, format('Cliente ausente · carga nº %s · pedido nº %s', e.numero, v_numero));
    update public.expedicoes_pedidos set status_entrega = 'ausente', entregue_em = now(), motivo_devolucao = coalesce(nullif(trim(p_motivo), ''), 'Cliente ausente'),
           latitude = p_lat, longitude = p_lng where id = ep.id;
    perform public.fn_pedido_reservar(ep.pedido_id);
    update public.pedidos set status = 'aprovado' where id = ep.pedido_id;
  end if;

  if not exists (select 1 from public.expedicoes_pedidos where expedicao_id = e.id and status_entrega = 'pendente') then
    update public.expedicoes set status = 'concluida' where id = e.id;
    v_concluida := true;
  end if;
  perform set_config('elos.regra', '', true);
  return jsonb_build_object('carga_concluida', v_concluida);
end;
$$;

-- Entregas com o ponto registrado (colunas novas no fim)
create or replace view public.vw_expedicao_pedidos
as
select ep.id, ep.expedicao_id, ep.pedido_id, ep.ordem_entrega, ep.status_entrega, ep.entregue_em, ep.motivo_devolucao,
       pe.numero as pedido_numero, pe.status as pedido_status, pe.valor_total, pe.peso_total_kg, pe.data_entrega,
       pe.observacao, pe.pedido_cliente,
       c.id as cliente_id, c.codigo as cliente_codigo, c.razao_social as cliente_nome, c.nome_fantasia as cliente_fantasia,
       c.telefone, c.whatsapp,
       en.logradouro, en.numero as endereco_numero, en.complemento, en.bairro, en.cidade, en.uf, en.cep, en.referencia,
       en.latitude, en.longitude,
       cp.nome as condicao_nome, fp.nome as forma_nome,
       (select count(*) from public.pedidos_itens i where i.pedido_id = pe.id and i.ativo) as qtd_itens,
       ep.latitude as entrega_latitude, ep.longitude as entrega_longitude
  from public.expedicoes_pedidos ep
  join public.pedidos pe on pe.id = ep.pedido_id
  join public.pessoas c on c.id = pe.cliente_id
  left join lateral (
    select * from public.pessoas_enderecos x where x.pessoa_id = c.id and x.ativo
     order by (x.tipo = 'entrega') desc, (x.tipo = 'principal') desc, x.criado_em limit 1
  ) en on true
  left join public.condicoes_pagamento cp on cp.id = pe.condicao_pagamento_id
  left join public.formas_pagamento fp on fp.id = pe.forma_pagamento_id
 where ep.empresa_id = public.empresa_atual() and public.tem_permissao('expedicao', 'ver');

-- Painel de acompanhamento: cargas em rota e as concluídas hoje
create or replace view public.vw_acompanhamento
as
select e.id, e.numero, e.data, e.status, e.saiu_em, e.concluida_em,
       r.nome as rota_nome, m.razao_social as motorista_nome, m.whatsapp as motorista_whatsapp, m.telefone as motorista_telefone,
       v.placa as veiculo_placa,
       (select count(*) from public.expedicoes_pedidos x where x.expedicao_id = e.id) as qtd_pedidos,
       (select count(*) from public.expedicoes_pedidos x where x.expedicao_id = e.id and x.status_entrega = 'entregue') as entregues,
       (select count(*) from public.expedicoes_pedidos x where x.expedicao_id = e.id and x.status_entrega = 'pendente') as pendentes,
       (select count(*) from public.expedicoes_pedidos x where x.expedicao_id = e.id and x.status_entrega in ('devolvido_total', 'devolvido_parcial', 'ausente')) as nao_entregues,
       (select max(x.entregue_em) from public.expedicoes_pedidos x where x.expedicao_id = e.id) as ultima_entrega_em,
       pos.latitude as ultima_latitude, pos.longitude as ultima_longitude, pos.registrado_em as ultima_posicao_em
  from public.expedicoes e
  left join public.rotas r on r.id = e.rota_id
  left join public.pessoas m on m.id = e.motorista_id
  left join public.veiculos v on v.id = e.veiculo_id
  left join lateral (
    select t.latitude, t.longitude, t.registrado_em from public.rastreamento t
     where t.expedicao_id = e.id order by t.registrado_em desc limit 1
  ) pos on true
 where e.empresa_id = public.empresa_atual() and public.tem_permissao('expedicao', 'ver')
   and (e.status = 'em_rota' or (e.status = 'concluida' and e.concluida_em >= date_trunc('day', now())));

revoke all on public.vw_acompanhamento from public, anon;
grant select on public.vw_acompanhamento to authenticated;

-- ---------------------------------------------------------------------
-- App do vendedor
-- ---------------------------------------------------------------------

-- Carteira para trabalhar sem sinal: dados do cliente, crédito, último pedido e visita de hoje
create or replace function public.app_carteira()
returns table (
  id uuid, codigo bigint, nome text, razao_social text, documento text, telefone text, whatsapp text,
  endereco text, bairro text, cidade text, latitude numeric, longitude numeric,
  rota_id uuid, rota_nome text, dias_semana smallint[], ordem_visita integer, tabela_preco_id uuid,
  condicao_nome text, forma_nome text, bloqueado boolean, motivo_bloqueio text,
  limite_credito numeric, em_aberto numeric, em_atraso numeric,
  ultimo_pedido_data date, ultimo_pedido_numero bigint, ultimo_pedido_valor numeric, ultimo_itens jsonb,
  visita_hoje text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_cart uuid := public.fn_carteira();
  v_emp uuid := public.empresa_atual();
begin
  perform public.fn_exigir('vendas', 'ver');
  return query
  select c.id, c.codigo, coalesce(c.nome_fantasia, c.razao_social), c.razao_social, c.documento, c.telefone, c.whatsapp,
         concat_ws(', ', en.logradouro, en.numero, en.complemento), en.bairro, en.cidade, en.latitude, en.longitude,
         c.rota_id, r.nome, r.dias_semana, c.ordem_visita, c.tabela_preco_id,
         cp.nome, fp.nome, c.bloqueado, c.motivo_bloqueio,
         c.limite_credito, coalesce(fin.aberto, 0), coalesce(fin.atraso, 0),
         (up.data_emissao at time zone 'America/Campo_Grande')::date, up.numero, up.valor_total,
         (select jsonb_agg(jsonb_build_object('produto_id', i.produto_id, 'quantidade', i.quantidade) order by i.ordem)
            from public.pedidos_itens i where i.pedido_id = up.id and i.ativo),
         (select case when bool_or(vi.resultado = 'pedido') then 'pedido' else 'sem_pedido' end
            from public.visitas vi where vi.cliente_id = c.id and vi.data = current_date having count(*) > 0)
    from public.pessoas c
    left join public.rotas r on r.id = c.rota_id
    left join public.condicoes_pagamento cp on cp.id = c.condicao_pagamento_id
    left join public.formas_pagamento fp on fp.id = c.forma_pagamento_id
    left join lateral (
      select * from public.pessoas_enderecos x where x.pessoa_id = c.id and x.ativo
       order by (x.tipo = 'entrega') desc, (x.tipo = 'principal') desc, x.criado_em limit 1
    ) en on true
    left join lateral (
      select sum(l.valor) as aberto, sum(l.valor) filter (where l.data_vencimento < current_date) as atraso
        from public.lancamentos l
       where l.pessoa_id = c.id and l.tipo = 'receber' and l.ativo and l.data_quitacao is null
    ) fin on true
    left join lateral (
      select p.id, p.numero, p.valor_total, p.data_emissao from public.pedidos p
       where p.cliente_id = c.id and p.tipo = 'pedido' and p.ativo and p.status not in ('rascunho', 'cancelado', 'devolvido')
       order by p.data_emissao desc limit 1
    ) up on true
   where c.empresa_id = v_emp and c.eh_cliente and c.ativo
     and (v_cart is null or c.vendedor_id = v_cart)
   order by r.nome nulls last, c.ordem_visita nulls last, 3;
end;
$$;

-- Catálogo do app: preço base e disponível no depósito padrão (sem vencidos)
create or replace function public.app_produtos()
returns table (id uuid, codigo text, nome text, unidade text, categoria text, foto_url text,
               preco_venda numeric, preco_minimo numeric, disponivel numeric, unidades_por_caixa integer)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_emp uuid := public.empresa_atual();
  v_dep uuid;
begin
  perform public.fn_exigir('vendas', 'ver');
  select d.id into v_dep from public.depositos d where d.empresa_id = v_emp and d.ativo order by d.padrao desc, (d.tipo = 'camara_fria') desc, d.nome limit 1;
  return query
  select pr.id, pr.codigo, pr.nome, u.sigla, cat.nome, pr.foto_url, pr.preco_venda, pr.preco_minimo,
         coalesce((select sum(s.quantidade - s.quantidade_reservada) from public.estoque_saldos s
                     left join public.lotes lo on lo.id = s.lote_id
                    where s.produto_id = pr.id and s.deposito_id = v_dep and (lo.id is null or lo.validade >= current_date)), 0),
         pr.unidades_por_caixa
    from public.produtos pr
    left join public.unidades u on u.id = pr.unidade_id
    left join public.categorias cat on cat.id = pr.categoria_id
   where pr.empresa_id = v_emp and pr.ativo and pr.visivel_app
   order by cat.nome nulls last, pr.nome;
end;
$$;

-- Recebe o pedido do celular. O id_local evita duplicar quando o envio é repetido.
-- Tenta confirmar na hora; se não der (ex.: falta estoque), fica em rascunho com o motivo para o escritório.
create or replace function public.app_enviar_pedido(
  p_id_local text, p_cliente uuid, p_itens jsonb,
  p_observacao text default null, p_data_entrega date default null,
  p_lat numeric default null, p_lng numeric default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp uuid := public.empresa_atual();
  v_cart uuid := public.fn_carteira();
  v_ped public.pedidos;
  v_id uuid;
  it jsonb;
  v_ordem integer := 0;
  v_motivo text;
  v_res jsonb;
begin
  perform public.fn_exigir('vendas', 'criar');
  if coalesce(trim(p_id_local), '') = '' then raise exception 'Identificador do pedido ausente.'; end if;

  select * into v_ped from public.pedidos where empresa_id = v_emp and id_local = p_id_local;
  if found then
    return jsonb_build_object('pedido_id', v_ped.id, 'numero', v_ped.numero, 'status', v_ped.status, 'motivo', v_ped.motivo_trava, 'ja_existia', true);
  end if;

  if not exists (select 1 from public.pessoas c where c.id = p_cliente and c.empresa_id = v_emp and c.eh_cliente
                   and (v_cart is null or c.vendedor_id = v_cart)) then
    raise exception 'Cliente fora da sua carteira.';
  end if;
  if jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
    raise exception 'O pedido não tem itens.';
  end if;

  insert into public.pedidos (empresa_id, cliente_id, origem, id_local, observacao, data_entrega)
  values (v_emp, p_cliente, 'app', p_id_local, nullif(trim(p_observacao), ''), p_data_entrega)
  returning id into v_id;

  for it in select * from jsonb_array_elements(p_itens) loop
    if coalesce((it->>'quantidade')::numeric, 0) <= 0 then continue; end if;
    if not exists (select 1 from public.produtos where id = (it->>'produto_id')::uuid and empresa_id = v_emp and ativo) then
      raise exception 'Produto não encontrado ou inativo.';
    end if;
    v_ordem := v_ordem + 1;
    insert into public.pedidos_itens (empresa_id, pedido_id, produto_id, quantidade, preco_unitario, ordem)
    values (v_emp, v_id, (it->>'produto_id')::uuid, (it->>'quantidade')::numeric, nullif(it->>'preco', '')::numeric, v_ordem);
  end loop;
  if v_ordem = 0 then raise exception 'O pedido não tem itens com quantidade.'; end if;

  begin
    v_res := public.pedido_confirmar(v_id);
  exception when others then
    v_motivo := 'Enviado pelo app e não confirmado: ' || sqlerrm;
    perform set_config('elos.regra', '1', true);
    update public.pedidos set motivo_trava = v_motivo where id = v_id;
    perform set_config('elos.regra', '', true);
  end;

  insert into public.visitas (empresa_id, id_local, cliente_id, vendedor_id, usuario_id, resultado, pedido_id, latitude, longitude)
  select v_emp, 'pedido:' || p_id_local, p_cliente, pe.vendedor_id, auth.uid(), 'pedido', v_id, p_lat, p_lng
    from public.pedidos pe where pe.id = v_id
  on conflict (empresa_id, id_local) do nothing;

  select * into v_ped from public.pedidos where id = v_id;
  return jsonb_build_object('pedido_id', v_ped.id, 'numero', v_ped.numero, 'status', v_ped.status,
                            'motivo', coalesce(v_ped.motivo_trava, v_res->>'motivo'), 'ja_existia', false);
end;
$$;

create or replace function public.app_registrar_visita(
  p_id_local text, p_cliente uuid, p_motivo text, p_lat numeric default null, p_lng numeric default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp uuid := public.empresa_atual();
  v_cart uuid := public.fn_carteira();
begin
  perform public.fn_exigir('vendas', 'ver');
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Informe por que o cliente não comprou.'; end if;
  if not exists (select 1 from public.pessoas c where c.id = p_cliente and c.empresa_id = v_emp
                   and (v_cart is null or c.vendedor_id = v_cart)) then
    raise exception 'Cliente fora da sua carteira.';
  end if;
  insert into public.visitas (empresa_id, id_local, cliente_id, vendedor_id, usuario_id, resultado, motivo, latitude, longitude)
  select v_emp, p_id_local, p_cliente, coalesce(v_cart, c.vendedor_id), auth.uid(), 'sem_pedido', trim(p_motivo), p_lat, p_lng
    from public.pessoas c where c.id = p_cliente
  on conflict (empresa_id, id_local) do nothing;
end;
$$;

-- Resumo do mês do vendedor (ou da empresa toda para quem não tem carteira)
create or replace function public.app_resumo()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_emp uuid := public.empresa_atual();
  v_cart uuid := public.fn_carteira();
  v_ini date := date_trunc('month', current_date)::date;
  v_vend public.pessoas;
  r jsonb;
begin
  perform public.fn_exigir('vendas', 'ver');
  select * into v_vend from public.pessoas where id = coalesce(v_cart, (select pessoa_id from public.usuarios where id = auth.uid()));
  select jsonb_build_object(
    'vendedor', v_vend.razao_social,
    'mes_inicio', v_ini,
    'vendido', coalesce(sum(p.valor_total), 0),
    'pedidos', count(p.id),
    'clientes_positivados', count(distinct p.cliente_id),
    'carteira', (select count(*) from public.pessoas c where c.empresa_id = v_emp and c.eh_cliente and c.ativo and (v_cart is null or c.vendedor_id = v_cart)),
    'meta', case when v_cart is not null then v_vend.meta_mensal end,
    'comissao_percentual', case when v_cart is not null then v_vend.comissao_percentual end,
    'comissao_prevista', case when v_cart is not null then round(coalesce(sum(p.valor_total), 0) * coalesce(v_vend.comissao_percentual, 0) / 100, 2) end,
    'visitas_sem_pedido', (select count(*) from public.visitas vi where vi.empresa_id = v_emp and vi.data >= v_ini and vi.resultado = 'sem_pedido'
                             and (v_cart is null or vi.vendedor_id = v_cart)),
    'dias_uteis_mes', (select count(*) from generate_series(v_ini, (v_ini + interval '1 month - 1 day')::date, interval '1 day') d where extract(dow from d) between 1 and 6),
    'dias_uteis_passados', (select count(*) from generate_series(v_ini, current_date, interval '1 day') d where extract(dow from d) between 1 and 6)
  ) into r
    from public.pedidos p
   where p.empresa_id = v_emp and p.tipo = 'pedido' and p.ativo
     and p.status in ('aprovado', 'em_separacao', 'faturado', 'em_rota', 'entregue')
     and (p.data_emissao at time zone 'America/Campo_Grande')::date >= v_ini
     and (v_cart is null or p.vendedor_id = v_cart);
  return r;
end;
$$;

revoke execute on function public.fn_carteira() from public, anon;
grant execute on function public.fn_carteira() to authenticated;
do $$ declare f text; begin foreach f in array array[
  'app_posicao(uuid, numeric, numeric, numeric)',
  'expedicao_registrar_entrega(uuid, text, text, numeric, numeric)',
  'app_carteira()', 'app_produtos()',
  'app_enviar_pedido(text, uuid, jsonb, text, date, numeric, numeric)',
  'app_registrar_visita(text, uuid, text, numeric, numeric)', 'app_resumo()'
] loop
  execute format('revoke execute on function public.%s from public, anon', f);
  execute format('grant execute on function public.%s to authenticated', f);
end loop; end $$;

-- =====================================================================
-- Metas de venda por mês: da empresa e de cada vendedor.
-- Sem meta lançada para o mês, vale a meta mensal do cadastro do vendedor;
-- sem meta da empresa, vale a soma das metas dos vendedores.
-- =====================================================================

create table public.metas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  mes date not null check (extract(day from mes) = 1),
  vendedor_id uuid references public.pessoas(id) on delete cascade,
  valor numeric(14,2) not null check (valor >= 0),
  alterado_em timestamptz not null default now(),
  alterado_por uuid,
  unique nulls not distinct (empresa_id, mes, vendedor_id)
);
alter table public.metas enable row level security;
create policy "metas_ver" on public.metas for select to authenticated
  using (empresa_id = public.empresa_atual() and public.tem_permissao('vendas', 'ver')
         and (public.fn_carteira() is null or vendedor_id = public.fn_carteira()));

-- Meta de um vendedor no mês (lançada ou a do cadastro)
create or replace function public.fn_meta_vendedor(p_vendedor uuid, p_mes date)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select m.valor from public.metas m where m.empresa_id = public.empresa_atual() and m.mes = p_mes and m.vendedor_id = p_vendedor),
    (select nullif(p.meta_mensal, 0) from public.pessoas p where p.id = p_vendedor));
$$;

-- Meta da empresa no mês (lançada ou a soma das metas dos vendedores ativos)
create or replace function public.fn_meta_empresa(p_mes date)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select m.valor from public.metas m where m.empresa_id = public.empresa_atual() and m.mes = p_mes and m.vendedor_id is null),
    (select nullif(sum(public.fn_meta_vendedor(p.id, p_mes)), 0) from public.pessoas p
      where p.empresa_id = public.empresa_atual() and p.eh_vendedor and p.ativo));
$$;

-- Define (ou apaga, com valor nulo) a meta do mês. Vendedor restrito à carteira não define meta.
create or replace function public.meta_definir(p_mes date, p_vendedor uuid, p_valor numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp uuid := public.empresa_atual();
  v_mes date := date_trunc('month', p_mes)::date;
begin
  perform public.fn_exigir('vendas', 'editar');
  if public.fn_carteira() is not null then
    raise exception 'Seu perfil não tem permissão para esta ação.';
  end if;
  if p_vendedor is not null and not exists (select 1 from public.pessoas where id = p_vendedor and empresa_id = v_emp and eh_vendedor) then
    raise exception 'Vendedor não encontrado.';
  end if;
  if p_valor is not null and p_valor < 0 then raise exception 'A meta não pode ser negativa.'; end if;
  if p_valor is null then
    delete from public.metas where empresa_id = v_emp and mes = v_mes and vendedor_id is not distinct from p_vendedor;
  else
    insert into public.metas (empresa_id, mes, vendedor_id, valor, alterado_por)
    values (v_emp, v_mes, p_vendedor, round(p_valor, 2), auth.uid())
    on conflict (empresa_id, mes, vendedor_id) do update set valor = excluded.valor, alterado_em = now(), alterado_por = excluded.alterado_por;
  end if;
end;
$$;

-- Acompanhamento do mês: uma linha por vendedor ativo (e quem vendeu sem ser vendedor ativo)
create or replace function public.metas_mes(p_mes date default current_date)
returns table (vendedor_id uuid, vendedor_nome text, meta numeric, meta_lancada boolean, meta_cadastro numeric,
               vendido numeric, pedidos bigint, clientes bigint, carteira bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_emp uuid := public.empresa_atual();
  v_cart uuid := public.fn_carteira();
  v_ini date := date_trunc('month', p_mes)::date;
  v_fim date := (date_trunc('month', p_mes) + interval '1 month')::date;
begin
  perform public.fn_exigir('vendas', 'ver');
  return query
  with vend as (
    select p.vendedor_id, sum(p.valor_total) as valor, count(*) as qtd, count(distinct p.cliente_id) as cli
      from public.pedidos p
     where p.empresa_id = v_emp and p.tipo = 'pedido' and p.ativo
       and p.status in ('aprovado', 'em_separacao', 'faturado', 'em_rota', 'entregue')
       and (p.data_emissao at time zone 'America/Campo_Grande')::date >= v_ini
       and (p.data_emissao at time zone 'America/Campo_Grande')::date < v_fim
     group by p.vendedor_id
  ), pessoas_v as (
    select p.id, p.razao_social, p.meta_mensal from public.pessoas p
     where p.empresa_id = v_emp and ((p.eh_vendedor and p.ativo) or p.id in (select x.vendedor_id from vend x))
  )
  select pv.id, pv.razao_social, public.fn_meta_vendedor(pv.id, v_ini),
         exists (select 1 from public.metas m where m.empresa_id = v_emp and m.mes = v_ini and m.vendedor_id = pv.id),
         pv.meta_mensal,
         coalesce(v.valor, 0), coalesce(v.qtd, 0), coalesce(v.cli, 0),
         (select count(*) from public.pessoas c where c.empresa_id = v_emp and c.eh_cliente and c.ativo and c.vendedor_id = pv.id)
    from pessoas_v pv
    left join vend v on v.vendedor_id = pv.id
   where v_cart is null or pv.id = v_cart
  union all
  select null::uuid, 'Sem vendedor', null::numeric, false, null::numeric, v.valor, v.qtd, v.cli, 0::bigint
    from vend v where v.vendedor_id is null and v_cart is null
   order by 6 desc, 2;
end;
$$;

-- Resumo do app: meta do mês do vendedor, ou da empresa (com a lista de vendedores) para quem vê tudo
create or replace function public.app_resumo()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_emp uuid := public.empresa_atual();
  v_cart uuid := public.fn_carteira();
  v_ini date := date_trunc('month', current_date)::date;
  v_vend public.pessoas;
  r jsonb;
begin
  perform public.fn_exigir('vendas', 'ver');
  select * into v_vend from public.pessoas where id = coalesce(v_cart, (select pessoa_id from public.usuarios where id = auth.uid()));
  select jsonb_build_object(
    'vendedor', v_vend.razao_social,
    'mes_inicio', v_ini,
    'vendido', coalesce(sum(p.valor_total), 0),
    'pedidos', count(p.id),
    'clientes_positivados', count(distinct p.cliente_id),
    'carteira', (select count(*) from public.pessoas c where c.empresa_id = v_emp and c.eh_cliente and c.ativo and (v_cart is null or c.vendedor_id = v_cart)),
    'meta_da_empresa', v_cart is null,
    'meta', case when v_cart is not null then public.fn_meta_vendedor(v_cart, v_ini) else public.fn_meta_empresa(v_ini) end,
    'comissao_percentual', case when v_cart is not null then v_vend.comissao_percentual end,
    'comissao_prevista', case when v_cart is not null then round(coalesce(sum(p.valor_total), 0) * coalesce(v_vend.comissao_percentual, 0) / 100, 2) end,
    'visitas_sem_pedido', (select count(*) from public.visitas vi where vi.empresa_id = v_emp and vi.data >= v_ini and vi.resultado = 'sem_pedido'
                             and (v_cart is null or vi.vendedor_id = v_cart)),
    'dias_uteis_mes', (select count(*) from generate_series(v_ini, (v_ini + interval '1 month - 1 day')::date, interval '1 day') d where extract(dow from d) between 1 and 6),
    'dias_uteis_passados', (select count(*) from generate_series(v_ini, current_date, interval '1 day') d where extract(dow from d) between 1 and 6),
    'vendedores', case when v_cart is null then
      (select coalesce(jsonb_agg(jsonb_build_object('nome', m.vendedor_nome, 'meta', m.meta, 'vendido', m.vendido, 'pedidos', m.pedidos)), '[]'::jsonb)
         from public.metas_mes(v_ini) m) end
  ) into r
    from public.pedidos p
   where p.empresa_id = v_emp and p.tipo = 'pedido' and p.ativo
     and p.status in ('aprovado', 'em_separacao', 'faturado', 'em_rota', 'entregue')
     and (p.data_emissao at time zone 'America/Campo_Grande')::date >= v_ini
     and (v_cart is null or p.vendedor_id = v_cart);
  return r;
end;
$$;

-- O ranking de vendedores passa a usar a meta do mês (lançada ou do cadastro), proporcional ao período
create or replace function public.rel_ranking_vendedores(
  p_de date, p_ate date, p_rota uuid default null, p_entregues boolean default false)
returns table (vendedor_nome text, pedidos bigint, clientes bigint, valor numeric, ticket_medio numeric,
               meta numeric, atingido numeric, comissao_percentual numeric, comissao_prevista numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_meses numeric := greatest(round(((p_ate - p_de + 1)::numeric / 30.4), 2), 0.03);
begin
  perform public.fn_exigir('relatorios', 'ver');
  return query
  with base as (
    select vd.id, coalesce(vd.razao_social, 'Sem vendedor') as nome, count(*) as ped, count(distinct v.cliente_id) as cli,
           sum(v.valor_total) as val, round(avg(v.valor_total), 2) as tm,
           round(public.fn_meta_vendedor(vd.id, date_trunc('month', p_de)::date) * v_meses, 2) as mt,
           vd.comissao_percentual as cp
      from public.fn_rel_vendas(p_de, p_ate, null, p_rota, p_entregues) v
      left join public.pessoas vd on vd.id = v.vendedor_id
     group by vd.id
  )
  select b.nome, b.ped, b.cli, b.val, b.tm, b.mt,
         case when b.mt > 0 then round(100 * b.val / b.mt, 1) end,
         b.cp, round(b.val * coalesce(b.cp, 0) / 100, 2)
    from base b
   order by b.val desc;
end;
$$;

revoke execute on function public.fn_meta_vendedor(uuid, date) from public, anon, authenticated;
revoke execute on function public.fn_meta_empresa(date) from public, anon, authenticated;
do $$ declare f text; begin foreach f in array array[
  'meta_definir(date, uuid, numeric)', 'metas_mes(date)', 'app_resumo()',
  'rel_ranking_vendedores(date, date, uuid, boolean)'
] loop
  execute format('revoke execute on function public.%s from public, anon', f);
  execute format('grant execute on function public.%s to authenticated', f);
end loop; end $$;

-- =====================================================================
-- Fase 4c · Alteração de pedido pelo vendedor, faturamento em lote e boletos
-- Pedido não faturado pode ser alterado (itens e pagamento) pelo vendedor,
-- inclusive pelo app sem sinal. Faturar trava o pedido, gera as contas a
-- receber e os boletos (pendentes até o registro no Sicredi).
-- =====================================================================

alter table public.pedidos
  add column if not exists faturado_em timestamptz,
  add column if not exists faturado_por uuid,
  add column if not exists alteracao_id_local text;

-- Faturamento só muda pelas ações; pedido faturado não muda mais
create or replace function public.fn_pedido_faturado_protege()
returns trigger
language plpgsql
as $$
begin
  if public.fn_via_regra() then
    return new;
  end if;
  if (new.faturado_em, new.faturado_por) is distinct from (old.faturado_em, old.faturado_por) then
    raise exception 'O faturamento só muda pelas ações de faturar e estornar.';
  end if;
  if old.faturado_em is not null
     and (new.cliente_id, new.condicao_pagamento_id, new.forma_pagamento_id, new.valor_desconto, new.valor_frete, new.tabela_preco_id)
         is distinct from
         (old.cliente_id, old.condicao_pagamento_id, old.forma_pagamento_id, old.valor_desconto, old.valor_frete, old.tabela_preco_id) then
    raise exception 'Pedido faturado não pode ser alterado.';
  end if;
  return new;
end;
$$;
create trigger trg_pedidos_faturado_protege before update on public.pedidos
  for each row execute function public.fn_pedido_faturado_protege();

-- Reabrir: não vale para faturado; pedido em carga ainda montando sai da carga
create or replace function public.pedido_reabrir(p_pedido uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.pedidos;
  v_carga record;
begin
  perform public.fn_exigir('vendas', 'editar');
  p := public.fn_pedido_obter(p_pedido);
  if p.faturado_em is not null then
    raise exception 'Pedido já faturado: não pode mais ser alterado.';
  end if;
  if p.status = 'em_separacao' then
    select e.id, e.numero, e.status into v_carga
      from public.expedicoes_pedidos ep join public.expedicoes e on e.id = ep.expedicao_id
     where ep.pedido_id = p.id and e.status in ('montando', 'separando')
     limit 1;
    if v_carga.status = 'separando' then
      raise exception 'O pedido já está sendo separado na carga nº %. Peça à expedição para tirá-lo da carga.', v_carga.numero;
    end if;
    delete from public.expedicoes_pedidos where pedido_id = p.id and expedicao_id = v_carga.id;
  elsif p.status not in ('aguardando_credito', 'aprovado') then
    raise exception 'Só pedidos aguardando crédito ou aprovados podem ser reabertos.';
  end if;
  perform public.fn_pedido_liberar_reservas(p.id);
  update public.pedidos
     set status = 'rascunho', motivo_trava = null, credito_liberado_por = null, credito_liberado_em = null
   where id = p.id;
  perform set_config('elos.regra', '', true);
end;
$$;

-- Cancelar: faturado precisa estornar o faturamento antes
create or replace function public.pedido_cancelar(p_pedido uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.pedidos;
begin
  perform public.fn_exigir('vendas', 'editar');
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo do cancelamento.'; end if;
  p := public.fn_pedido_obter(p_pedido);
  if p.faturado_em is not null then
    raise exception 'Pedido faturado: estorne o faturamento antes de cancelar.';
  end if;
  if p.status not in ('rascunho', 'aguardando_credito', 'aprovado', 'em_separacao') then
    raise exception 'Este pedido não pode mais ser cancelado por aqui.';
  end if;
  delete from public.expedicoes_pedidos ep using public.expedicoes e
   where ep.pedido_id = p.id and e.id = ep.expedicao_id and e.status in ('montando', 'separando');
  perform public.fn_pedido_liberar_reservas(p.id);
  update public.pedidos set status = 'cancelado', motivo_cancelamento = trim(p_motivo) where id = p.id;
  perform set_config('elos.regra', '', true);
end;
$$;

-- ---------------------------------------------------------------------
-- Boletos (um por título de pedido com forma que gera boleto)
-- ---------------------------------------------------------------------
-- A tabela boletos já existe (fase 1, sem uso até aqui): ganha o vínculo com o pedido,
-- a situação "cancelado" e passa a ser gravada só pelas funções.
alter table public.boletos
  add column if not exists pedido_id uuid references public.pedidos(id),
  add column if not exists txid text,
  add column if not exists registrado_em timestamptz,
  add column if not exists cancelado_em timestamptz;
alter table public.boletos alter column conta_bancaria_id drop not null;
alter table public.boletos drop constraint if exists boletos_status_check;
alter table public.boletos add constraint boletos_status_check
  check (status in ('pendente', 'registrado', 'pago', 'baixado', 'vencido', 'erro', 'cancelado'));
create unique index if not exists boletos_lancamento_ativo_un on public.boletos (lancamento_id) where status <> 'cancelado';
create index if not exists boletos_pedido_idx on public.boletos (pedido_id);
create index if not exists boletos_status_idx on public.boletos (empresa_id, status);
drop policy if exists "boletos_ver" on public.boletos;
drop policy if exists "boletos_criar" on public.boletos;
drop policy if exists "boletos_editar" on public.boletos;
drop policy if exists "boletos_excluir" on public.boletos;
create policy "boletos_ver" on public.boletos for select to authenticated
  using (empresa_id = public.empresa_atual()
         and (public.tem_permissao('financeiro', 'ver') or public.tem_permissao('fiscal', 'ver')
              or (public.tem_permissao('vendas', 'ver')
                  and (public.fn_carteira() is null
                       or exists (select 1 from public.pedidos p where p.id = pedido_id and p.vendedor_id = public.fn_carteira())))));

-- Cria os boletos que faltam para os títulos em aberto do pedido
create or replace function public.fn_pedido_gerar_boletos(p_pedido uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  insert into public.boletos (empresa_id, lancamento_id, pedido_id, conta_bancaria_id, valor, data_vencimento)
  select l.empresa_id, l.id, p_pedido, l.conta_bancaria_id, l.valor, l.data_vencimento
    from public.lancamentos l
    join public.formas_pagamento fp on fp.id = l.forma_pagamento_id and fp.gera_boleto
   where l.origem = 'pedido' and l.origem_id = p_pedido and l.ativo and l.data_quitacao is null
     and not exists (select 1 from public.boletos b where b.lancamento_id = l.id and b.status <> 'cancelado');
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Título cancelado leva o boleto junto
create or replace function public.fn_lancamento_boleto()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.ativo and not new.ativo then
    update public.boletos set status = 'cancelado', cancelado_em = now(),
           mensagem_erro = case when status = 'registrado' then 'Título cancelado: pedir baixa do boleto no banco.' else mensagem_erro end
     where lancamento_id = new.id and status not in ('cancelado', 'pago');
  end if;
  return null;
end;
$$;
create trigger trg_lancamentos_boleto after update of ativo on public.lancamentos
  for each row execute function public.fn_lancamento_boleto();

-- Pedido faturado que volta por cliente ausente mantém os títulos (a venda continua de pé)
create or replace function public.fn_pedido_financeiro()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_regra text := current_setting('elos.regra', true);
begin
  if new.status = 'em_rota' and old.status is distinct from 'em_rota' then
    perform public.fn_pedido_gerar_titulos(new.id);
    if new.faturado_em is not null then perform public.fn_pedido_gerar_boletos(new.id); end if;
  elsif new.status = 'devolvido' and old.status = 'em_rota' then
    perform public.fn_pedido_cancelar_titulos(new.id, 'Pedido devolvido na entrega');
  elsif new.status = 'aprovado' and old.status = 'em_rota' and new.faturado_em is null then
    perform public.fn_pedido_cancelar_titulos(new.id, 'Cliente ausente: título refeito na próxima saída');
  end if;
  perform set_config('elos.regra', coalesce(v_regra, ''), true);
  return null;
end;
$$;

-- ---------------------------------------------------------------------
-- Faturamento
-- ---------------------------------------------------------------------
create or replace function public.fn_pedido_faturar(p_pedido uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.pedidos;
  n integer;
begin
  p := public.fn_pedido_obter(p_pedido);
  if p.tipo <> 'pedido' then raise exception 'Orçamento não é faturado.'; end if;
  if p.faturado_em is not null then raise exception 'Pedido nº % já está faturado.', p.numero; end if;
  if p.status not in ('aprovado', 'em_separacao', 'em_rota', 'entregue') then
    raise exception 'Pedido nº % não pode ser faturado (situação: %).', p.numero, p.status;
  end if;
  update public.pedidos set faturado_em = now(), faturado_por = auth.uid() where id = p.id;
  perform public.fn_pedido_gerar_titulos(p.id);
  n := public.fn_pedido_gerar_boletos(p.id);
  perform set_config('elos.regra', '', true);
  return n;
end;
$$;

-- Fatura vários pedidos; o que não puder ser faturado volta com o motivo e não atrapalha os outros
create or replace function public.pedido_faturar_lote(p_pedidos uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_ok integer := 0;
  v_bol integer := 0;
  v_erros jsonb := '[]'::jsonb;
  v_num bigint;
begin
  perform public.fn_exigir('fiscal', 'editar');
  if coalesce(cardinality(p_pedidos), 0) = 0 then raise exception 'Selecione ao menos um pedido.'; end if;
  foreach v_id in array p_pedidos loop
    begin
      v_bol := v_bol + public.fn_pedido_faturar(v_id);
      v_ok := v_ok + 1;
    exception when others then
      select numero into v_num from public.pedidos where id = v_id;
      v_erros := v_erros || jsonb_build_object('pedido_id', v_id, 'numero', v_num, 'motivo', sqlerrm);
    end;
  end loop;
  perform set_config('elos.regra', '', true);
  return jsonb_build_object('faturados', v_ok, 'boletos', v_bol, 'erros', v_erros);
end;
$$;

-- Desfaz o faturamento: só sem título pago e sem boleto já registrado no banco
create or replace function public.pedido_estornar_faturamento(p_pedido uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.pedidos;
begin
  perform public.fn_exigir('fiscal', 'editar');
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo do estorno.'; end if;
  p := public.fn_pedido_obter(p_pedido);
  if p.faturado_em is null then raise exception 'Pedido não está faturado.'; end if;
  if exists (select 1 from public.lancamentos where origem = 'pedido' and origem_id = p.id and ativo and data_quitacao is not null) then
    raise exception 'O pedido tem título pago. Estorne a baixa no financeiro antes.';
  end if;
  if exists (select 1 from public.boletos where pedido_id = p.id and status = 'registrado') then
    raise exception 'O pedido tem boleto registrado no banco. Peça a baixa do boleto antes.';
  end if;
  if p.status not in ('em_rota', 'entregue') then
    perform public.fn_pedido_cancelar_titulos(p.id, 'Faturamento estornado: ' || trim(p_motivo));
  end if;
  perform set_config('elos.regra', '1', true);
  update public.boletos set status = 'cancelado', cancelado_em = now() where pedido_id = p.id and status in ('pendente', 'erro');
  update public.pedidos set faturado_em = null, faturado_por = null where id = p.id;
  perform set_config('elos.regra', '', true);
end;
$$;

-- Pedidos com o que importa para faturar e imprimir boletos
drop view if exists public.vw_pedidos;
create view public.vw_pedidos
with (security_invoker = true)
as
select pe.*,
       c.codigo as cliente_codigo,
       c.razao_social as cliente_nome,
       c.nome_fantasia as cliente_fantasia,
       v.razao_social as vendedor_nome,
       r.nome as rota_nome,
       (select count(*) from public.pedidos_itens i where i.pedido_id = pe.id and i.ativo) as qtd_itens,
       cp.nome as condicao_nome,
       fp.nome as forma_nome,
       coalesce(fp.gera_boleto, false) as gera_boleto
  from public.pedidos pe
  join public.pessoas c on c.id = pe.cliente_id
  left join public.pessoas v on v.id = pe.vendedor_id
  left join public.rotas r on r.id = pe.rota_id
  left join public.condicoes_pagamento cp on cp.id = pe.condicao_pagamento_id
  left join public.formas_pagamento fp on fp.id = pe.forma_pagamento_id;

-- Fila de faturamento: pedidos aprovados em diante ainda sem faturar, com a carga em que estão
create or replace view public.vw_faturamento
as
select pe.id, pe.numero, pe.status, pe.data_emissao, pe.data_entrega, pe.valor_total, pe.faturado_em,
       c.razao_social as cliente_nome, c.nome_fantasia as cliente_fantasia, c.documento as cliente_documento,
       v.razao_social as vendedor_nome, r.nome as rota_nome, pe.rota_id, pe.vendedor_id,
       cp.nome as condicao_nome, fp.nome as forma_nome, coalesce(fp.gera_boleto, false) as gera_boleto,
       ca.id as carga_id, ca.numero as carga_numero,
       (select count(*) from public.boletos b where b.pedido_id = pe.id and b.status <> 'cancelado') as boletos,
       (select count(*) from public.boletos b where b.pedido_id = pe.id and b.status = 'registrado') as boletos_registrados
  from public.pedidos pe
  join public.pessoas c on c.id = pe.cliente_id
  left join public.pessoas v on v.id = pe.vendedor_id
  left join public.rotas r on r.id = pe.rota_id
  left join public.condicoes_pagamento cp on cp.id = pe.condicao_pagamento_id
  left join public.formas_pagamento fp on fp.id = pe.forma_pagamento_id
  left join lateral (
    select e.id, e.numero from public.expedicoes_pedidos ep join public.expedicoes e on e.id = ep.expedicao_id
     where ep.pedido_id = pe.id and e.status <> 'cancelada' order by e.criado_em desc limit 1
  ) ca on true
 where pe.empresa_id = public.empresa_atual() and pe.tipo = 'pedido' and pe.ativo
   and pe.status in ('aprovado', 'em_separacao', 'em_rota', 'entregue')
   and (public.tem_permissao('fiscal', 'ver') or public.tem_permissao('financeiro', 'ver'));
revoke all on public.vw_faturamento from public, anon;
grant select on public.vw_faturamento to authenticated;

-- Boletos para impressão: título, pagador, beneficiário e conta
create or replace view public.vw_boletos
as
select b.id, b.status, b.nosso_numero, b.linha_digitavel, b.codigo_barras, b.pix_copia_cola, b.mensagem_erro as erro, b.registrado_em,
       b.pedido_id, pe.numero as pedido_numero, pe.vendedor_id,
       l.id as lancamento_id, l.valor, l.data_vencimento, l.data_competencia, l.documento, l.parcela, l.total_parcelas, l.data_quitacao,
       c.razao_social as pagador_nome, c.documento as pagador_documento,
       en.logradouro as pagador_logradouro, en.numero as pagador_numero, en.complemento as pagador_complemento,
       en.bairro as pagador_bairro, en.cidade as pagador_cidade, en.uf as pagador_uf, en.cep as pagador_cep,
       cb.nome as conta_nome, cb.banco_codigo, cb.agencia, cb.posto, cb.conta, cb.sicredi_codigo_beneficiario,
       em.razao_social as beneficiario_nome, em.cnpj as beneficiario_cnpj,
       concat_ws(', ', em.logradouro, em.numero, em.bairro) as beneficiario_endereco, em.cidade as beneficiario_cidade, em.uf as beneficiario_uf
  from public.boletos b
  join public.lancamentos l on l.id = b.lancamento_id
  join public.empresas em on em.id = b.empresa_id
  left join public.pedidos pe on pe.id = b.pedido_id
  left join public.pessoas c on c.id = l.pessoa_id
  left join lateral (
    select * from public.pessoas_enderecos x where x.pessoa_id = c.id and x.ativo
     order by (x.tipo = 'cobranca') desc, (x.tipo = 'principal') desc, x.criado_em limit 1
  ) en on true
  left join public.contas_bancarias cb on cb.id = b.conta_bancaria_id
 where b.empresa_id = public.empresa_atual()
   and (public.tem_permissao('financeiro', 'ver') or public.tem_permissao('fiscal', 'ver')
        or (public.tem_permissao('vendas', 'ver') and (public.fn_carteira() is null or pe.vendedor_id = public.fn_carteira())));
revoke all on public.vw_boletos from public, anon;
grant select on public.vw_boletos to authenticated;

-- ---------------------------------------------------------------------
-- App do vendedor: pagamento, consulta e alteração de pedido
-- ---------------------------------------------------------------------

-- Condições e formas de pagamento para escolher no celular
create or replace function public.app_pagamentos()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_emp uuid := public.empresa_atual();
begin
  perform public.fn_exigir('vendas', 'ver');
  return jsonb_build_object(
    'condicoes', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'nome', nome) order by nome), '[]'::jsonb)
                    from public.condicoes_pagamento where empresa_id = v_emp and ativo),
    'formas', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'gera_boleto', gera_boleto) order by nome), '[]'::jsonb)
                 from public.formas_pagamento where empresa_id = v_emp and ativo));
end;
$$;

-- Carteira passa a trazer a condição e a forma padrão de cada cliente
drop function if exists public.app_carteira();
create function public.app_carteira()
returns table (
  id uuid, codigo bigint, nome text, razao_social text, documento text, telefone text, whatsapp text,
  endereco text, bairro text, cidade text, latitude numeric, longitude numeric,
  rota_id uuid, rota_nome text, dias_semana smallint[], ordem_visita integer, tabela_preco_id uuid,
  condicao_nome text, forma_nome text, bloqueado boolean, motivo_bloqueio text,
  limite_credito numeric, em_aberto numeric, em_atraso numeric,
  ultimo_pedido_data date, ultimo_pedido_numero bigint, ultimo_pedido_valor numeric, ultimo_itens jsonb,
  visita_hoje text, condicao_pagamento_id uuid, forma_pagamento_id uuid)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_cart uuid := public.fn_carteira();
  v_emp uuid := public.empresa_atual();
begin
  perform public.fn_exigir('vendas', 'ver');
  return query
  select c.id, c.codigo, coalesce(c.nome_fantasia, c.razao_social), c.razao_social, c.documento, c.telefone, c.whatsapp,
         concat_ws(', ', en.logradouro, en.numero, en.complemento), en.bairro, en.cidade, en.latitude, en.longitude,
         c.rota_id, r.nome, r.dias_semana, c.ordem_visita, c.tabela_preco_id,
         cp.nome, fp.nome, c.bloqueado, c.motivo_bloqueio,
         c.limite_credito, coalesce(fin.aberto, 0), coalesce(fin.atraso, 0),
         (up.data_emissao at time zone 'America/Campo_Grande')::date, up.numero, up.valor_total,
         (select jsonb_agg(jsonb_build_object('produto_id', i.produto_id, 'quantidade', i.quantidade) order by i.ordem)
            from public.pedidos_itens i where i.pedido_id = up.id and i.ativo),
         (select case when bool_or(vi.resultado = 'pedido') then 'pedido' else 'sem_pedido' end
            from public.visitas vi where vi.cliente_id = c.id and vi.data = current_date having count(*) > 0),
         c.condicao_pagamento_id, c.forma_pagamento_id
    from public.pessoas c
    left join public.rotas r on r.id = c.rota_id
    left join public.condicoes_pagamento cp on cp.id = c.condicao_pagamento_id
    left join public.formas_pagamento fp on fp.id = c.forma_pagamento_id
    left join lateral (
      select * from public.pessoas_enderecos x where x.pessoa_id = c.id and x.ativo
       order by (x.tipo = 'entrega') desc, (x.tipo = 'principal') desc, x.criado_em limit 1
    ) en on true
    left join lateral (
      select sum(l.valor) as aberto, sum(l.valor) filter (where l.data_vencimento < current_date) as atraso
        from public.lancamentos l
       where l.pessoa_id = c.id and l.tipo = 'receber' and l.ativo and l.data_quitacao is null
    ) fin on true
    left join lateral (
      select p.id, p.numero, p.valor_total, p.data_emissao from public.pedidos p
       where p.cliente_id = c.id and p.tipo = 'pedido' and p.ativo and p.status not in ('rascunho', 'cancelado', 'devolvido')
       order by p.data_emissao desc limit 1
    ) up on true
   where c.empresa_id = v_emp and c.eh_cliente and c.ativo
     and (v_cart is null or c.vendedor_id = v_cart)
   order by r.nome nulls last, c.ordem_visita nulls last, 3;
end;
$$;

-- Grava itens e pagamento no pedido em rascunho e tenta confirmar
create or replace function public.fn_app_gravar_pedido(
  p_pedido uuid, p_itens jsonb, p_condicao uuid, p_forma uuid, p_observacao text, p_data_entrega date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp uuid := public.empresa_atual();
  it jsonb;
  v_ordem integer := 0;
  v_res jsonb;
  v_ped public.pedidos;
begin
  if jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
    raise exception 'O pedido não tem itens.';
  end if;
  if p_condicao is not null and not exists (select 1 from public.condicoes_pagamento where id = p_condicao and empresa_id = v_emp and ativo) then
    raise exception 'Condição de pagamento inválida.';
  end if;
  if p_forma is not null and not exists (select 1 from public.formas_pagamento where id = p_forma and empresa_id = v_emp and ativo) then
    raise exception 'Forma de pagamento inválida.';
  end if;

  perform set_config('elos.regra', '1', true);
  delete from public.pedidos_itens where pedido_id = p_pedido;
  for it in select * from jsonb_array_elements(p_itens) loop
    if coalesce((it->>'quantidade')::numeric, 0) <= 0 then continue; end if;
    if not exists (select 1 from public.produtos where id = (it->>'produto_id')::uuid and empresa_id = v_emp and ativo) then
      raise exception 'Produto não encontrado ou inativo.';
    end if;
    v_ordem := v_ordem + 1;
    insert into public.pedidos_itens (empresa_id, pedido_id, produto_id, quantidade, preco_unitario, ordem)
    values (v_emp, p_pedido, (it->>'produto_id')::uuid, (it->>'quantidade')::numeric, nullif(it->>'preco', '')::numeric, v_ordem);
  end loop;
  if v_ordem = 0 then raise exception 'O pedido não tem itens com quantidade.'; end if;
  update public.pedidos
     set condicao_pagamento_id = coalesce(p_condicao, condicao_pagamento_id),
         forma_pagamento_id = coalesce(p_forma, forma_pagamento_id),
         observacao = nullif(trim(p_observacao), ''),
         data_entrega = p_data_entrega,
         motivo_trava = null
   where id = p_pedido;
  perform public.fn_pedido_recalcula(p_pedido);
  perform set_config('elos.regra', '', true);

  begin
    v_res := public.pedido_confirmar(p_pedido);
  exception when others then
    perform set_config('elos.regra', '1', true);
    update public.pedidos set motivo_trava = 'Enviado pelo app e não confirmado: ' || sqlerrm where id = p_pedido;
    perform set_config('elos.regra', '', true);
  end;
  select * into v_ped from public.pedidos where id = p_pedido;
  return jsonb_build_object('pedido_id', v_ped.id, 'numero', v_ped.numero, 'status', v_ped.status,
                            'motivo', coalesce(v_ped.motivo_trava, v_res->>'motivo'));
end;
$$;

-- Novo pedido do celular, agora com a forma e a condição escolhidas
drop function if exists public.app_enviar_pedido(text, uuid, jsonb, text, date, numeric, numeric);
create function public.app_enviar_pedido(
  p_id_local text, p_cliente uuid, p_itens jsonb,
  p_observacao text default null, p_data_entrega date default null,
  p_lat numeric default null, p_lng numeric default null,
  p_condicao uuid default null, p_forma uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp uuid := public.empresa_atual();
  v_cart uuid := public.fn_carteira();
  v_ped public.pedidos;
  v_id uuid;
  v_res jsonb;
begin
  perform public.fn_exigir('vendas', 'criar');
  if coalesce(trim(p_id_local), '') = '' then raise exception 'Identificador do pedido ausente.'; end if;

  select * into v_ped from public.pedidos where empresa_id = v_emp and id_local = p_id_local;
  if found then
    return jsonb_build_object('pedido_id', v_ped.id, 'numero', v_ped.numero, 'status', v_ped.status, 'motivo', v_ped.motivo_trava, 'ja_existia', true);
  end if;
  if not exists (select 1 from public.pessoas c where c.id = p_cliente and c.empresa_id = v_emp and c.eh_cliente
                   and (v_cart is null or c.vendedor_id = v_cart)) then
    raise exception 'Cliente fora da sua carteira.';
  end if;

  insert into public.pedidos (empresa_id, cliente_id, origem, id_local, condicao_pagamento_id, forma_pagamento_id)
  values (v_emp, p_cliente, 'app', p_id_local, p_condicao, p_forma)
  returning id into v_id;
  v_res := public.fn_app_gravar_pedido(v_id, p_itens, p_condicao, p_forma, p_observacao, p_data_entrega);

  insert into public.visitas (empresa_id, id_local, cliente_id, vendedor_id, usuario_id, resultado, pedido_id, latitude, longitude)
  select v_emp, 'pedido:' || p_id_local, p_cliente, pe.vendedor_id, auth.uid(), 'pedido', v_id, p_lat, p_lng
    from public.pedidos pe where pe.id = v_id
  on conflict (empresa_id, id_local) do nothing;

  return v_res || jsonb_build_object('ja_existia', false);
end;
$$;

-- Alteração pelo vendedor enquanto o pedido não foi faturado (itens, pagamento, entrega, observação).
-- p_id_envio evita refazer a mesma alteração quando o celular reenviar.
create or replace function public.app_alterar_pedido(
  p_pedido uuid, p_id_envio text, p_itens jsonb,
  p_condicao uuid default null, p_forma uuid default null,
  p_observacao text default null, p_data_entrega date default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cart uuid := public.fn_carteira();
  p public.pedidos;
  v_saiu_carga boolean := false;
  v_res jsonb;
begin
  perform public.fn_exigir('vendas', 'editar');
  if coalesce(trim(p_id_envio), '') = '' then raise exception 'Identificador da alteração ausente.'; end if;
  select * into p from public.pedidos where id = p_pedido and empresa_id = public.empresa_atual() and ativo;
  if not found or (v_cart is not null and p.vendedor_id is distinct from v_cart) then
    raise exception 'Pedido não encontrado.';
  end if;
  if p.alteracao_id_local = p_id_envio then
    return jsonb_build_object('pedido_id', p.id, 'numero', p.numero, 'status', p.status, 'motivo', p.motivo_trava, 'ja_existia', true);
  end if;
  if p.faturado_em is not null then
    raise exception 'O pedido nº % já foi faturado e não pode mais ser alterado. Fale com o escritório.', p.numero;
  end if;
  if p.status not in ('rascunho', 'aguardando_credito', 'aprovado', 'em_separacao') then
    raise exception 'O pedido nº % não pode mais ser alterado (situação: %).', p.numero, p.status;
  end if;
  if p.status <> 'rascunho' then
    v_saiu_carga := p.status = 'em_separacao';
    perform public.pedido_reabrir(p.id);
  end if;
  v_res := public.fn_app_gravar_pedido(p.id, p_itens, p_condicao, p_forma, p_observacao, p_data_entrega);
  perform set_config('elos.regra', '1', true);
  update public.pedidos set alteracao_id_local = p_id_envio where id = p.id;
  perform set_config('elos.regra', '', true);
  return v_res || jsonb_build_object('ja_existia', false, 'saiu_da_carga', v_saiu_carga);
end;
$$;

-- Detalhe do pedido para o celular
create or replace function public.app_pedido(p_pedido uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_cart uuid := public.fn_carteira();
  r jsonb;
begin
  perform public.fn_exigir('vendas', 'ver');
  select jsonb_build_object(
    'id', p.id, 'numero', p.numero, 'status', p.status, 'data_emissao', p.data_emissao, 'data_entrega', p.data_entrega,
    'cliente_id', p.cliente_id, 'cliente_nome', coalesce(c.nome_fantasia, c.razao_social),
    'condicao_pagamento_id', p.condicao_pagamento_id, 'condicao_nome', cp.nome,
    'forma_pagamento_id', p.forma_pagamento_id, 'forma_nome', fp.nome,
    'observacao', p.observacao, 'motivo_trava', p.motivo_trava, 'valor_total', p.valor_total,
    'faturado_em', p.faturado_em, 'origem', p.origem,
    'pode_alterar', p.faturado_em is null and (p.status in ('rascunho', 'aguardando_credito', 'aprovado')
                      or (p.status = 'em_separacao' and exists (
                            select 1 from public.expedicoes_pedidos ep join public.expedicoes e on e.id = ep.expedicao_id
                             where ep.pedido_id = p.id and e.status = 'montando'))),
    'itens', (select coalesce(jsonb_agg(jsonb_build_object('produto_id', i.produto_id, 'codigo', pr.codigo, 'nome', pr.nome,
                       'quantidade', i.quantidade, 'preco', i.preco_unitario, 'total', i.valor_total) order by i.ordem), '[]'::jsonb)
                from public.pedidos_itens i join public.produtos pr on pr.id = i.produto_id
               where i.pedido_id = p.id and i.ativo),
    'titulos', (select coalesce(jsonb_agg(jsonb_build_object('parcela', l.parcela, 'total_parcelas', l.total_parcelas, 'valor', l.valor,
                       'vencimento', l.data_vencimento, 'quitado', l.data_quitacao is not null) order by l.parcela), '[]'::jsonb)
                  from public.lancamentos l where l.origem = 'pedido' and l.origem_id = p.id and l.ativo))
    into r
    from public.pedidos p
    join public.pessoas c on c.id = p.cliente_id
    left join public.condicoes_pagamento cp on cp.id = p.condicao_pagamento_id
    left join public.formas_pagamento fp on fp.id = p.forma_pagamento_id
   where p.id = p_pedido and p.empresa_id = public.empresa_atual() and p.ativo
     and (v_cart is null or p.vendedor_id = v_cart);
  if r is null then raise exception 'Pedido não encontrado.'; end if;
  return r;
end;
$$;

revoke execute on function public.fn_pedido_gerar_boletos(uuid) from public, anon, authenticated;
revoke execute on function public.fn_pedido_faturar(uuid) from public, anon, authenticated;
revoke execute on function public.fn_app_gravar_pedido(uuid, jsonb, uuid, uuid, text, date) from public, anon, authenticated;
do $$ declare f text; begin foreach f in array array[
  'pedido_reabrir(uuid)', 'pedido_cancelar(uuid, text)',
  'pedido_faturar_lote(uuid[])', 'pedido_estornar_faturamento(uuid, text)',
  'app_pagamentos()', 'app_carteira()',
  'app_enviar_pedido(text, uuid, jsonb, text, date, numeric, numeric, uuid, uuid)',
  'app_alterar_pedido(uuid, text, jsonb, uuid, uuid, text, date)', 'app_pedido(uuid)'
] loop
  execute format('revoke execute on function public.%s from public, anon', f);
  execute format('grant execute on function public.%s to authenticated', f);
end loop; end $$;

-- =====================================================================
-- Painel de metas do app: vendas de hoje, faturado, comissão sobre o
-- faturado e a série diária do mês para o gráfico.
-- =====================================================================

create or replace function public.app_resumo()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_emp uuid := public.empresa_atual();
  v_cart uuid := public.fn_carteira();
  v_hoje date := current_date;
  v_ini date := date_trunc('month', current_date)::date;
  v_fim date := (date_trunc('month', current_date) + interval '1 month - 1 day')::date;
  v_vend public.pessoas;
  v_pct numeric;
  r jsonb;
begin
  perform public.fn_exigir('vendas', 'ver');
  select * into v_vend from public.pessoas where id = coalesce(v_cart, (select pessoa_id from public.usuarios where id = auth.uid()));
  v_pct := case when v_cart is not null then coalesce(v_vend.comissao_percentual, 0) end;

  with ped as (
    select p.id, p.cliente_id, p.valor_total, (p.data_emissao at time zone 'America/Campo_Grande')::date as dia,
           (p.faturado_em at time zone 'America/Campo_Grande')::date as dia_fat
      from public.pedidos p
     where p.empresa_id = v_emp and p.tipo = 'pedido' and p.ativo
       and p.status in ('aprovado', 'em_separacao', 'faturado', 'em_rota', 'entregue')
       and (v_cart is null or p.vendedor_id = v_cart)
       and ((p.data_emissao at time zone 'America/Campo_Grande')::date >= v_ini
            or (p.faturado_em at time zone 'America/Campo_Grande')::date >= v_ini)
  )
  select jsonb_build_object(
    'vendedor', v_vend.razao_social,
    'mes_inicio', v_ini,
    'hoje', v_hoje,
    'vendido', coalesce(sum(valor_total) filter (where dia >= v_ini), 0),
    'pedidos', count(*) filter (where dia >= v_ini),
    'clientes_positivados', count(distinct cliente_id) filter (where dia >= v_ini),
    'vendido_hoje', coalesce(sum(valor_total) filter (where dia = v_hoje), 0),
    'pedidos_hoje', count(*) filter (where dia = v_hoje),
    'faturado', coalesce(sum(valor_total) filter (where dia_fat >= v_ini), 0),
    'faturado_hoje', coalesce(sum(valor_total) filter (where dia_fat = v_hoje), 0),
    'carteira', (select count(*) from public.pessoas c where c.empresa_id = v_emp and c.eh_cliente and c.ativo and (v_cart is null or c.vendedor_id = v_cart)),
    'meta_da_empresa', v_cart is null,
    'meta', case when v_cart is not null then public.fn_meta_vendedor(v_cart, v_ini) else public.fn_meta_empresa(v_ini) end,
    'comissao_percentual', v_pct,
    'comissao_prevista', case when v_cart is not null then round(coalesce(sum(valor_total) filter (where dia >= v_ini), 0) * v_pct / 100, 2) end,
    'comissao_mes', case when v_cart is not null then round(coalesce(sum(valor_total) filter (where dia_fat >= v_ini), 0) * v_pct / 100, 2) end,
    'comissao_hoje', case when v_cart is not null then round(coalesce(sum(valor_total) filter (where dia_fat = v_hoje), 0) * v_pct / 100, 2) end,
    'visitas_sem_pedido', (select count(*) from public.visitas vi where vi.empresa_id = v_emp and vi.data >= v_ini and vi.resultado = 'sem_pedido'
                             and (v_cart is null or vi.vendedor_id = v_cart)),
    'dias_uteis_mes', (select count(*) from generate_series(v_ini, v_fim, interval '1 day') d where extract(dow from d) between 1 and 6),
    'dias_uteis_passados', (select count(*) from generate_series(v_ini, v_hoje, interval '1 day') d where extract(dow from d) between 1 and 6),
    'diario', (select jsonb_agg(jsonb_build_object('dia', d::date, 'util', extract(dow from d) between 1 and 6,
                       'vendido', coalesce((select sum(x.valor_total) from ped x where x.dia = d::date), 0),
                       'pedidos', (select count(*) from ped x where x.dia = d::date)) order by d)
                 from generate_series(v_ini, v_fim, interval '1 day') d),
    'vendedores', case when v_cart is null then
      (select coalesce(jsonb_agg(jsonb_build_object('nome', m.vendedor_nome, 'meta', m.meta, 'vendido', m.vendido, 'pedidos', m.pedidos)), '[]'::jsonb)
         from public.metas_mes(v_ini) m) end
  ) into r
    from ped;
  return r;
end;
$$;

revoke execute on function public.app_resumo() from public, anon;
grant execute on function public.app_resumo() to authenticated;

-- =====================================================================
-- Fase 4d · Equipe (motoristas e vendedores), roteirização e etapas da entrega
-- Mais dados de motorista e vendedor; ponto de saída da empresa; etapas
-- da entrega para rastrear (na rota, a caminho, chegou, entregue, devolvido).
-- =====================================================================

-- Dados de equipe no cadastro de pessoas
alter table public.pessoas
  add column if not exists cnh_numero text,
  add column if not exists cnh_categoria text,
  add column if not exists cnh_validade date,
  add column if not exists veiculo_padrao_id uuid references public.veiculos(id) on delete set null,
  add column if not exists supervisor_id uuid references public.pessoas(id) on delete set null,
  add column if not exists regiao text,
  add column if not exists desconto_maximo numeric(5,2) check (desconto_maximo is null or desconto_maximo between 0 and 100),
  add column if not exists data_admissao date,
  add column if not exists chave_pix text,
  add column if not exists contato_emergencia text;

-- Ponto de saída das entregas (depósito)
alter table public.empresas
  add column if not exists latitude numeric(10,7),
  add column if not exists longitude numeric(10,7);

-- De onde veio a coordenada do endereço
alter table public.pessoas_enderecos
  add column if not exists coordenada_fonte text check (coordenada_fonte in ('manual', 'geocodificada', 'entrega'));
update public.pessoas_enderecos set coordenada_fonte = 'entrega' where latitude is not null and coordenada_fonte is null;

-- Etapa da entrega enquanto ela ainda não foi concluída
alter table public.expedicoes_pedidos
  add column if not exists etapa text not null default 'aguardando' check (etapa in ('aguardando', 'a_caminho', 'chegou')),
  add column if not exists a_caminho_em timestamptz,
  add column if not exists chegou_em timestamptz;

-- Motorista avisa: a caminho deste cliente / cheguei. Só uma entrega "a caminho" por vez.
create or replace function public.expedicao_etapa(p_expedicao_pedido uuid, p_etapa text, p_lat numeric default null, p_lng numeric default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ep public.expedicoes_pedidos;
  e public.expedicoes;
begin
  perform public.fn_exigir('expedicao', 'editar');
  if p_etapa not in ('aguardando', 'a_caminho', 'chegou') then raise exception 'Etapa inválida.'; end if;
  select * into ep from public.expedicoes_pedidos where id = p_expedicao_pedido and empresa_id = public.empresa_atual() for update;
  if not found then raise exception 'Entrega não encontrada.'; end if;
  e := public.fn_expedicao_obter(ep.expedicao_id, array['em_rota']);
  if ep.status_entrega <> 'pendente' then raise exception 'Esta entrega já foi registrada.'; end if;
  if p_etapa = 'a_caminho' then
    update public.expedicoes_pedidos set etapa = 'aguardando', a_caminho_em = null
     where expedicao_id = e.id and id <> ep.id and status_entrega = 'pendente' and etapa = 'a_caminho';
  end if;
  update public.expedicoes_pedidos
     set etapa = p_etapa,
         a_caminho_em = case when p_etapa = 'a_caminho' then now() when p_etapa = 'aguardando' then null else coalesce(a_caminho_em, now()) end,
         chegou_em = case when p_etapa = 'chegou' then now() else null end
   where id = ep.id;
  if p_lat is not null and p_lng is not null and abs(p_lat) <= 90 and abs(p_lng) <= 180 then
    insert into public.rastreamento (empresa_id, expedicao_id, usuario_id, latitude, longitude)
    values (e.empresa_id, e.id, auth.uid(), p_lat, p_lng);
  end if;
  perform set_config('elos.regra', '', true);
end;
$$;

-- Grava a coordenada achada pelo endereço (geocodificação) no endereço de entrega do pedido,
-- sem sobrescrever coordenada marcada à mão ou aprendida numa entrega
create or replace function public.endereco_coordenada_pedido(p_pedido uuid, p_lat numeric, p_lng numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cliente uuid;
begin
  if not (public.tem_permissao('expedicao', 'editar') or public.tem_permissao('cadastros', 'editar')) then
    raise exception 'Seu perfil não tem permissão para esta ação.';
  end if;
  if p_lat is null or p_lng is null or abs(p_lat) > 90 or abs(p_lng) > 180 then raise exception 'Coordenada inválida.'; end if;
  select cliente_id into v_cliente from public.pedidos where id = p_pedido and empresa_id = public.empresa_atual();
  if not found then raise exception 'Pedido não encontrado.'; end if;
  update public.pessoas_enderecos x set latitude = p_lat, longitude = p_lng, coordenada_fonte = 'geocodificada'
   where x.id = (select y.id from public.pessoas_enderecos y where y.pessoa_id = v_cliente and y.ativo
                  order by (y.tipo = 'entrega') desc, (y.tipo = 'principal') desc, y.criado_em limit 1)
     and (x.latitude is null or x.coordenada_fonte = 'geocodificada');
end;
$$;

-- Ponto de saída das entregas
create or replace function public.empresa_definir_saida(p_lat numeric, p_lng numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.tem_permissao('expedicao', 'editar') or public.tem_permissao('configuracoes', 'editar')) then
    raise exception 'Seu perfil não tem permissão para esta ação.';
  end if;
  if p_lat is null or p_lng is null or abs(p_lat) > 90 or abs(p_lng) > 180 then raise exception 'Coordenada inválida.'; end if;
  update public.empresas set latitude = p_lat, longitude = p_lng where id = public.empresa_atual();
end;
$$;

-- Entrega registrada: a coordenada do local vale mais que a geocodificada
create or replace function public.expedicao_registrar_entrega(
  p_expedicao_pedido uuid, p_resultado text, p_motivo text default null,
  p_lat numeric default null, p_lng numeric default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ep public.expedicoes_pedidos;
  e public.expedicoes;
  v_numero bigint;
  v_cliente uuid;
  v_concluida boolean := false;
begin
  perform public.fn_exigir('expedicao', 'editar');
  if p_resultado not in ('entregue', 'devolvido_total', 'ausente') then
    raise exception 'Resultado de entrega inválido.';
  end if;
  if p_resultado = 'devolvido_total' and coalesce(trim(p_motivo), '') = '' then
    raise exception 'Informe o motivo da devolução.';
  end if;

  select * into ep from public.expedicoes_pedidos where id = p_expedicao_pedido and empresa_id = public.empresa_atual() for update;
  if not found then raise exception 'Entrega não encontrada.'; end if;
  e := public.fn_expedicao_obter(ep.expedicao_id, array['em_rota']);
  if ep.status_entrega <> 'pendente' then raise exception 'Esta entrega já foi registrada.'; end if;
  select numero, cliente_id into v_numero, v_cliente from public.pedidos where id = ep.pedido_id for update;

  if p_resultado = 'entregue' then
    update public.expedicoes_pedidos set status_entrega = 'entregue', entregue_em = now(), motivo_devolucao = nullif(trim(p_motivo), ''),
           latitude = p_lat, longitude = p_lng, chegou_em = coalesce(chegou_em, now()) where id = ep.id;
    update public.pedidos set status = 'entregue' where id = ep.pedido_id;
    if p_lat is not null and p_lng is not null then
      update public.pessoas_enderecos x set latitude = p_lat, longitude = p_lng, coordenada_fonte = 'entrega'
       where x.id = (select y.id from public.pessoas_enderecos y where y.pessoa_id = v_cliente and y.ativo
                      order by (y.tipo = 'entrega') desc, (y.tipo = 'principal') desc, y.criado_em limit 1)
         and (x.latitude is null or x.coordenada_fonte = 'geocodificada');
    end if;
  elsif p_resultado = 'devolvido_total' then
    perform public.fn_expedicao_devolver(ep.pedido_id, format('Devolução · carga nº %s · pedido nº %s · %s', e.numero, v_numero, trim(p_motivo)));
    update public.expedicoes_pedidos set status_entrega = 'devolvido_total', entregue_em = now(), motivo_devolucao = trim(p_motivo),
           latitude = p_lat, longitude = p_lng where id = ep.id;
    update public.pedidos set status = 'devolvido' where id = ep.pedido_id;
  else
    perform public.fn_expedicao_devolver(ep.pedido_id, format('Cliente ausente · carga nº %s · pedido nº %s', e.numero, v_numero));
    update public.expedicoes_pedidos set status_entrega = 'ausente', entregue_em = now(), motivo_devolucao = coalesce(nullif(trim(p_motivo), ''), 'Cliente ausente'),
           latitude = p_lat, longitude = p_lng where id = ep.id;
    perform public.fn_pedido_reservar(ep.pedido_id);
    update public.pedidos set status = 'aprovado' where id = ep.pedido_id;
  end if;

  if not exists (select 1 from public.expedicoes_pedidos where expedicao_id = e.id and status_entrega = 'pendente') then
    update public.expedicoes set status = 'concluida' where id = e.id;
    v_concluida := true;
  end if;
  perform set_config('elos.regra', '', true);
  return jsonb_build_object('carga_concluida', v_concluida);
end;
$$;

-- Entregas com etapa e origem da coordenada (colunas novas no fim)
create or replace view public.vw_expedicao_pedidos
as
select ep.id, ep.expedicao_id, ep.pedido_id, ep.ordem_entrega, ep.status_entrega, ep.entregue_em, ep.motivo_devolucao,
       pe.numero as pedido_numero, pe.status as pedido_status, pe.valor_total, pe.peso_total_kg, pe.data_entrega,
       pe.observacao, pe.pedido_cliente,
       c.id as cliente_id, c.codigo as cliente_codigo, c.razao_social as cliente_nome, c.nome_fantasia as cliente_fantasia,
       c.telefone, c.whatsapp,
       en.logradouro, en.numero as endereco_numero, en.complemento, en.bairro, en.cidade, en.uf, en.cep, en.referencia,
       en.latitude, en.longitude,
       cp.nome as condicao_nome, fp.nome as forma_nome,
       (select count(*) from public.pedidos_itens i where i.pedido_id = pe.id and i.ativo) as qtd_itens,
       ep.latitude as entrega_latitude, ep.longitude as entrega_longitude,
       ep.etapa, ep.a_caminho_em, ep.chegou_em, en.coordenada_fonte
  from public.expedicoes_pedidos ep
  join public.pedidos pe on pe.id = ep.pedido_id
  join public.pessoas c on c.id = pe.cliente_id
  left join lateral (
    select * from public.pessoas_enderecos x where x.pessoa_id = c.id and x.ativo
     order by (x.tipo = 'entrega') desc, (x.tipo = 'principal') desc, x.criado_em limit 1
  ) en on true
  left join public.condicoes_pagamento cp on cp.id = pe.condicao_pagamento_id
  left join public.formas_pagamento fp on fp.id = pe.forma_pagamento_id
 where ep.empresa_id = public.empresa_atual() and public.tem_permissao('expedicao', 'ver');

-- Painel: quantas estão a caminho / no cliente agora (colunas novas no fim)
create or replace view public.vw_acompanhamento
as
select e.id, e.numero, e.data, e.status, e.saiu_em, e.concluida_em,
       r.nome as rota_nome, m.razao_social as motorista_nome, m.whatsapp as motorista_whatsapp, m.telefone as motorista_telefone,
       v.placa as veiculo_placa,
       (select count(*) from public.expedicoes_pedidos x where x.expedicao_id = e.id) as qtd_pedidos,
       (select count(*) from public.expedicoes_pedidos x where x.expedicao_id = e.id and x.status_entrega = 'entregue') as entregues,
       (select count(*) from public.expedicoes_pedidos x where x.expedicao_id = e.id and x.status_entrega = 'pendente') as pendentes,
       (select count(*) from public.expedicoes_pedidos x where x.expedicao_id = e.id and x.status_entrega in ('devolvido_total', 'devolvido_parcial', 'ausente')) as nao_entregues,
       (select max(x.entregue_em) from public.expedicoes_pedidos x where x.expedicao_id = e.id) as ultima_entrega_em,
       pos.latitude as ultima_latitude, pos.longitude as ultima_longitude, pos.registrado_em as ultima_posicao_em,
       (select count(*) from public.expedicoes_pedidos x where x.expedicao_id = e.id and x.status_entrega = 'pendente' and x.etapa = 'a_caminho') as a_caminho,
       (select count(*) from public.expedicoes_pedidos x where x.expedicao_id = e.id and x.status_entrega = 'pendente' and x.etapa = 'chegou') as no_cliente
  from public.expedicoes e
  left join public.rotas r on r.id = e.rota_id
  left join public.pessoas m on m.id = e.motorista_id
  left join public.veiculos v on v.id = e.veiculo_id
  left join lateral (
    select t.latitude, t.longitude, t.registrado_em from public.rastreamento t
     where t.expedicao_id = e.id order by t.registrado_em desc limit 1
  ) pos on true
 where e.empresa_id = public.empresa_atual() and public.tem_permissao('expedicao', 'ver')
   and (e.status = 'em_rota' or (e.status = 'concluida' and e.concluida_em >= date_trunc('day', now())));

do $$ declare f text; begin foreach f in array array[
  'expedicao_etapa(uuid, text, numeric, numeric)', 'endereco_coordenada_pedido(uuid, numeric, numeric)',
  'empresa_definir_saida(numeric, numeric)', 'expedicao_registrar_entrega(uuid, text, text, numeric, numeric)'
] loop
  execute format('revoke execute on function public.%s from public, anon', f);
  execute format('grant execute on function public.%s to authenticated', f);
end loop; end $$;

-- =====================================================================
-- Fase 4e · Recebimento na entrega e acerto do motorista
-- Forma de pagamento diz o que o motorista recebe (dinheiro, PIX, cartão);
-- na entrega ele registra o que recebeu, podendo dividir em dois tipos;
-- no fim da carga o escritório faz o acerto e pode baixar os títulos.
-- =====================================================================

alter table public.formas_pagamento
  add column if not exists recebe_na_entrega text check (recebe_na_entrega in ('dinheiro', 'pix', 'cartao'));
update public.formas_pagamento set recebe_na_entrega = case codigo_nfe
    when '01' then 'dinheiro' when '17' then 'pix' when '03' then 'cartao' when '04' then 'cartao' end
 where recebe_na_entrega is null and codigo_nfe in ('01', '17', '03', '04');

-- O que foi recebido em cada entrega (até três linhas: ex. parte em dinheiro, parte no PIX)
create table public.entregas_recebimentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  expedicao_id uuid not null references public.expedicoes(id) on delete cascade,
  expedicao_pedido_id uuid not null references public.expedicoes_pedidos(id) on delete cascade,
  pedido_id uuid not null references public.pedidos(id),
  tipo text not null check (tipo in ('dinheiro', 'pix', 'cartao')),
  valor numeric(14,2) not null check (valor > 0),
  criado_em timestamptz not null default now(),
  criado_por uuid
);
create index entregas_recebimentos_exp_idx on public.entregas_recebimentos (expedicao_id);
alter table public.entregas_recebimentos enable row level security;
create policy "entregas_recebimentos_ver" on public.entregas_recebimentos for select to authenticated
  using (empresa_id = public.empresa_atual() and (public.tem_permissao('expedicao', 'ver') or public.tem_permissao('financeiro', 'ver')));

-- Acerto da carga com o motorista
create table public.acertos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  expedicao_id uuid not null unique references public.expedicoes(id) on delete cascade,
  motorista_id uuid references public.pessoas(id),
  dinheiro_esperado numeric(14,2) not null default 0,
  pix_recebido numeric(14,2) not null default 0,
  cartao_recebido numeric(14,2) not null default 0,
  dinheiro_entregue numeric(14,2) not null default 0,
  despesas jsonb not null default '[]'::jsonb,
  total_despesas numeric(14,2) not null default 0,
  diferenca numeric(14,2) not null default 0,
  observacao text,
  conta_dinheiro_id uuid references public.contas_bancarias(id),
  conta_pix_id uuid references public.contas_bancarias(id),
  titulos_baixados integer not null default 0,
  criado_por uuid,
  criado_em timestamptz not null default now()
);
alter table public.acertos enable row level security;
create policy "acertos_ver" on public.acertos for select to authenticated
  using (empresa_id = public.empresa_atual() and (public.tem_permissao('expedicao', 'ver') or public.tem_permissao('financeiro', 'ver')));

-- Entrega registrada com o que foi recebido
drop function if exists public.expedicao_registrar_entrega(uuid, text, text, numeric, numeric);
create function public.expedicao_registrar_entrega(
  p_expedicao_pedido uuid, p_resultado text, p_motivo text default null,
  p_lat numeric default null, p_lng numeric default null, p_recebimentos jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ep public.expedicoes_pedidos;
  e public.expedicoes;
  v_numero bigint;
  v_cliente uuid;
  v_total numeric;
  v_recebe text;
  v_soma numeric := 0;
  v_rec jsonb;
  r jsonb;
  v_concluida boolean := false;
begin
  perform public.fn_exigir('expedicao', 'editar');
  if p_resultado not in ('entregue', 'devolvido_total', 'ausente') then
    raise exception 'Resultado de entrega inválido.';
  end if;
  if p_resultado = 'devolvido_total' and coalesce(trim(p_motivo), '') = '' then
    raise exception 'Informe o motivo da devolução.';
  end if;

  select * into ep from public.expedicoes_pedidos where id = p_expedicao_pedido and empresa_id = public.empresa_atual() for update;
  if not found then raise exception 'Entrega não encontrada.'; end if;
  e := public.fn_expedicao_obter(ep.expedicao_id, array['em_rota']);
  if ep.status_entrega <> 'pendente' then raise exception 'Esta entrega já foi registrada.'; end if;
  select pe.numero, pe.cliente_id, pe.valor_total, fp.recebe_na_entrega into v_numero, v_cliente, v_total, v_recebe
    from public.pedidos pe left join public.formas_pagamento fp on fp.id = pe.forma_pagamento_id
   where pe.id = ep.pedido_id for update of pe;

  if p_resultado = 'entregue' then
    -- recebimento: o informado pelo motorista, ou o valor todo na forma do pedido
    v_rec := case when p_recebimentos is not null and jsonb_typeof(p_recebimentos) = 'array' and jsonb_array_length(p_recebimentos) > 0
                  then p_recebimentos
                  when v_recebe is not null then jsonb_build_array(jsonb_build_object('tipo', v_recebe, 'valor', v_total))
                  else '[]'::jsonb end;
    if jsonb_array_length(v_rec) > 3 then raise exception 'Use no máximo três formas no mesmo recebimento.'; end if;
    for r in select * from jsonb_array_elements(v_rec) loop
      if coalesce(r->>'tipo', '') not in ('dinheiro', 'pix', 'cartao') then raise exception 'Forma de recebimento inválida.'; end if;
      if coalesce((r->>'valor')::numeric, 0) <= 0 then raise exception 'Informe o valor recebido em cada forma.'; end if;
      v_soma := v_soma + round((r->>'valor')::numeric, 2);
    end loop;
    if jsonb_array_length(v_rec) > 0 and abs(v_soma - v_total) > 0.01 then
      raise exception 'O recebido (%) não fecha com o valor do pedido (%).', public.fn_brl(v_soma), public.fn_brl(v_total);
    end if;
    insert into public.entregas_recebimentos (empresa_id, expedicao_id, expedicao_pedido_id, pedido_id, tipo, valor, criado_por)
    select e.empresa_id, e.id, ep.id, ep.pedido_id, x->>'tipo', round((x->>'valor')::numeric, 2), auth.uid()
      from jsonb_array_elements(v_rec) x;

    update public.expedicoes_pedidos set status_entrega = 'entregue', entregue_em = now(), motivo_devolucao = nullif(trim(p_motivo), ''),
           latitude = p_lat, longitude = p_lng, chegou_em = coalesce(chegou_em, now()) where id = ep.id;
    update public.pedidos set status = 'entregue' where id = ep.pedido_id;
    if p_lat is not null and p_lng is not null then
      update public.pessoas_enderecos x set latitude = p_lat, longitude = p_lng, coordenada_fonte = 'entrega'
       where x.id = (select y.id from public.pessoas_enderecos y where y.pessoa_id = v_cliente and y.ativo
                      order by (y.tipo = 'entrega') desc, (y.tipo = 'principal') desc, y.criado_em limit 1)
         and (x.latitude is null or x.coordenada_fonte = 'geocodificada');
    end if;
  elsif p_resultado = 'devolvido_total' then
    perform public.fn_expedicao_devolver(ep.pedido_id, format('Devolução · carga nº %s · pedido nº %s · %s', e.numero, v_numero, trim(p_motivo)));
    update public.expedicoes_pedidos set status_entrega = 'devolvido_total', entregue_em = now(), motivo_devolucao = trim(p_motivo),
           latitude = p_lat, longitude = p_lng where id = ep.id;
    update public.pedidos set status = 'devolvido' where id = ep.pedido_id;
  else
    perform public.fn_expedicao_devolver(ep.pedido_id, format('Cliente ausente · carga nº %s · pedido nº %s', e.numero, v_numero));
    update public.expedicoes_pedidos set status_entrega = 'ausente', entregue_em = now(), motivo_devolucao = coalesce(nullif(trim(p_motivo), ''), 'Cliente ausente'),
           latitude = p_lat, longitude = p_lng where id = ep.id;
    perform public.fn_pedido_reservar(ep.pedido_id);
    update public.pedidos set status = 'aprovado' where id = ep.pedido_id;
  end if;

  if not exists (select 1 from public.expedicoes_pedidos where expedicao_id = e.id and status_entrega = 'pendente') then
    update public.expedicoes set status = 'concluida' where id = e.id;
    v_concluida := true;
  end if;
  perform set_config('elos.regra', '', true);
  return jsonb_build_object('carga_concluida', v_concluida);
end;
$$;

-- Entregas com o que receber e o que foi recebido (colunas novas no fim)
create or replace view public.vw_expedicao_pedidos
as
select ep.id, ep.expedicao_id, ep.pedido_id, ep.ordem_entrega, ep.status_entrega, ep.entregue_em, ep.motivo_devolucao,
       pe.numero as pedido_numero, pe.status as pedido_status, pe.valor_total, pe.peso_total_kg, pe.data_entrega,
       pe.observacao, pe.pedido_cliente,
       c.id as cliente_id, c.codigo as cliente_codigo, c.razao_social as cliente_nome, c.nome_fantasia as cliente_fantasia,
       c.telefone, c.whatsapp,
       en.logradouro, en.numero as endereco_numero, en.complemento, en.bairro, en.cidade, en.uf, en.cep, en.referencia,
       en.latitude, en.longitude,
       cp.nome as condicao_nome, fp.nome as forma_nome,
       (select count(*) from public.pedidos_itens i where i.pedido_id = pe.id and i.ativo) as qtd_itens,
       ep.latitude as entrega_latitude, ep.longitude as entrega_longitude,
       ep.etapa, ep.a_caminho_em, ep.chegou_em, en.coordenada_fonte,
       fp.recebe_na_entrega,
       coalesce((select sum(x.valor) from public.entregas_recebimentos x where x.expedicao_pedido_id = ep.id and x.tipo = 'dinheiro'), 0) as recebido_dinheiro,
       coalesce((select sum(x.valor) from public.entregas_recebimentos x where x.expedicao_pedido_id = ep.id and x.tipo = 'pix'), 0) as recebido_pix,
       coalesce((select sum(x.valor) from public.entregas_recebimentos x where x.expedicao_pedido_id = ep.id and x.tipo = 'cartao'), 0) as recebido_cartao
  from public.expedicoes_pedidos ep
  join public.pedidos pe on pe.id = ep.pedido_id
  join public.pessoas c on c.id = pe.cliente_id
  left join lateral (
    select * from public.pessoas_enderecos x where x.pessoa_id = c.id and x.ativo
     order by (x.tipo = 'entrega') desc, (x.tipo = 'principal') desc, x.criado_em limit 1
  ) en on true
  left join public.condicoes_pagamento cp on cp.id = pe.condicao_pagamento_id
  left join public.formas_pagamento fp on fp.id = pe.forma_pagamento_id
 where ep.empresa_id = public.empresa_atual() and public.tem_permissao('expedicao', 'ver');

-- Resumo para o acerto: o que devia receber, o que recebeu e o que voltou
create or replace function public.acerto_resumo(p_expedicao uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  e public.expedicoes;
  r jsonb;
begin
  if not (public.tem_permissao('expedicao', 'ver') or public.tem_permissao('financeiro', 'ver')) then
    raise exception 'Seu perfil não tem permissão para esta ação.';
  end if;
  select * into e from public.expedicoes where id = p_expedicao and empresa_id = public.empresa_atual();
  if not found then raise exception 'Carga não encontrada.'; end if;
  with ped as (
    select ep.id, ep.ordem_entrega, ep.status_entrega, pe.numero, pe.valor_total, fp.nome as forma_nome, fp.recebe_na_entrega,
           coalesce(c.nome_fantasia, c.razao_social) as cliente,
           coalesce((select sum(x.valor) from public.entregas_recebimentos x where x.expedicao_pedido_id = ep.id and x.tipo = 'dinheiro'), 0) as din,
           coalesce((select sum(x.valor) from public.entregas_recebimentos x where x.expedicao_pedido_id = ep.id and x.tipo = 'pix'), 0) as pix,
           coalesce((select sum(x.valor) from public.entregas_recebimentos x where x.expedicao_pedido_id = ep.id and x.tipo = 'cartao'), 0) as cartao
      from public.expedicoes_pedidos ep
      join public.pedidos pe on pe.id = ep.pedido_id
      join public.pessoas c on c.id = pe.cliente_id
      left join public.formas_pagamento fp on fp.id = pe.forma_pagamento_id
     where ep.expedicao_id = e.id
  )
  select jsonb_build_object(
    'carga', jsonb_build_object('id', e.id, 'numero', e.numero, 'data', e.data, 'status', e.status,
                                'motorista', (select razao_social from public.pessoas where id = e.motorista_id)),
    'pendentes', count(*) filter (where status_entrega = 'pendente'),
    'entregues', count(*) filter (where status_entrega = 'entregue'),
    'nao_entregues', count(*) filter (where status_entrega not in ('pendente', 'entregue')),
    'previsto_dinheiro', coalesce(sum(valor_total) filter (where recebe_na_entrega = 'dinheiro'), 0),
    'previsto_pix', coalesce(sum(valor_total) filter (where recebe_na_entrega = 'pix'), 0),
    'previsto_cartao', coalesce(sum(valor_total) filter (where recebe_na_entrega = 'cartao'), 0),
    'a_prazo', coalesce(sum(valor_total) filter (where recebe_na_entrega is null), 0),
    'recebido_dinheiro', coalesce(sum(din), 0),
    'recebido_pix', coalesce(sum(pix), 0),
    'recebido_cartao', coalesce(sum(cartao), 0),
    'valor_devolvido', coalesce(sum(valor_total) filter (where status_entrega not in ('pendente', 'entregue')), 0),
    'pedidos', coalesce(jsonb_agg(jsonb_build_object('ordem', ordem_entrega, 'numero', numero, 'cliente', cliente, 'valor', valor_total,
                 'forma', forma_nome, 'recebe', recebe_na_entrega, 'status', status_entrega, 'dinheiro', din, 'pix', pix, 'cartao', cartao)
                 order by ordem_entrega), '[]'::jsonb),
    'acerto', (select to_jsonb(a) from public.acertos a where a.expedicao_id = e.id)
  ) into r
    from ped;
  return r;
end;
$$;

-- Registra o acerto; com p_baixar, quita os títulos dos pedidos pagos na entrega
create or replace function public.acerto_registrar(
  p_expedicao uuid, p_dinheiro_entregue numeric, p_despesas jsonb default '[]'::jsonb, p_observacao text default null,
  p_baixar boolean default false, p_conta_dinheiro uuid default null, p_conta_pix uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  e public.expedicoes;
  v_din numeric; v_pix numeric; v_cartao numeric;
  v_desp numeric := 0;
  d jsonb;
  rec record;
  l record;
  v_resta numeric;
  v_parte numeric;
  v_conta uuid;
  v_baixados integer := 0;
  v_forma uuid;
  v_acerto public.acertos;
begin
  perform public.fn_exigir('expedicao', 'editar');
  if p_baixar then perform public.fn_exigir('financeiro', 'editar'); end if;
  select * into e from public.expedicoes where id = p_expedicao and empresa_id = public.empresa_atual() for update;
  if not found then raise exception 'Carga não encontrada.'; end if;
  if e.status <> 'concluida' then raise exception 'O acerto é feito depois que todas as entregas forem registradas.'; end if;
  if exists (select 1 from public.acertos where expedicao_id = e.id) then raise exception 'Esta carga já tem acerto.'; end if;
  if coalesce(p_dinheiro_entregue, -1) < 0 then raise exception 'Informe quanto o motorista entregou em dinheiro.'; end if;
  if jsonb_typeof(coalesce(p_despesas, '[]'::jsonb)) <> 'array' then raise exception 'Despesas inválidas.'; end if;
  for d in select * from jsonb_array_elements(coalesce(p_despesas, '[]'::jsonb)) loop
    if coalesce(trim(d->>'descricao'), '') = '' or coalesce((d->>'valor')::numeric, 0) <= 0 then
      raise exception 'Cada despesa precisa de descrição e valor.';
    end if;
    v_desp := v_desp + round((d->>'valor')::numeric, 2);
  end loop;

  select coalesce(sum(valor) filter (where tipo = 'dinheiro'), 0), coalesce(sum(valor) filter (where tipo = 'pix'), 0),
         coalesce(sum(valor) filter (where tipo = 'cartao'), 0)
    into v_din, v_pix, v_cartao
    from public.entregas_recebimentos where expedicao_id = e.id;

  if p_baixar then
    if p_conta_dinheiro is null and v_din > 0 then raise exception 'Escolha a conta (caixa) que recebe o dinheiro.'; end if;
    if p_conta_pix is null and (v_pix + v_cartao) > 0 then raise exception 'Escolha a conta que recebe o PIX e o cartão.'; end if;
    -- cada recebimento quita os títulos em aberto do pedido, do mais antigo para o mais novo
    for rec in select x.pedido_id, x.tipo, x.valor from public.entregas_recebimentos x where x.expedicao_id = e.id order by x.pedido_id, x.tipo loop
      v_resta := rec.valor;
      v_conta := case when rec.tipo = 'dinheiro' then p_conta_dinheiro else p_conta_pix end;
      select id into v_forma from public.formas_pagamento
       where empresa_id = e.empresa_id and ativo and recebe_na_entrega = rec.tipo order by nome limit 1;
      for l in select id, valor from public.lancamentos
                where origem = 'pedido' and origem_id = rec.pedido_id and ativo and data_quitacao is null and tipo = 'receber'
                order by data_vencimento, parcela, criado_em loop
        exit when v_resta <= 0.009;
        v_parte := least(v_resta, l.valor);
        perform public.lancamento_baixar(l.id, current_date, v_parte, v_conta, 0, 0, 0, v_forma,
                                         format('Recebido na entrega · carga nº %s', e.numero));
        v_baixados := v_baixados + 1;
        v_resta := round(v_resta - v_parte, 2);
      end loop;
    end loop;
  end if;

  insert into public.acertos (empresa_id, expedicao_id, motorista_id, dinheiro_esperado, pix_recebido, cartao_recebido,
    dinheiro_entregue, despesas, total_despesas, diferenca, observacao, conta_dinheiro_id, conta_pix_id, titulos_baixados, criado_por)
  values (e.empresa_id, e.id, e.motorista_id, v_din, v_pix, v_cartao, round(p_dinheiro_entregue, 2), coalesce(p_despesas, '[]'::jsonb),
    v_desp, round(p_dinheiro_entregue + v_desp - v_din, 2), nullif(trim(p_observacao), ''),
    case when p_baixar then p_conta_dinheiro end, case when p_baixar then p_conta_pix end, v_baixados, auth.uid())
  returning * into v_acerto;
  perform set_config('elos.regra', '', true);
  return to_jsonb(v_acerto);
end;
$$;

-- Desfaz um acerto lançado errado (só se não baixou títulos)
create or replace function public.acerto_excluir(p_expedicao uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.acertos;
begin
  perform public.fn_exigir('expedicao', 'editar');
  select * into a from public.acertos where expedicao_id = p_expedicao and empresa_id = public.empresa_atual();
  if not found then raise exception 'Acerto não encontrado.'; end if;
  if a.titulos_baixados > 0 then raise exception 'Este acerto baixou títulos. Estorne as baixas no financeiro antes.'; end if;
  delete from public.acertos where id = a.id;
end;
$$;

do $$ declare f text; begin foreach f in array array[
  'expedicao_registrar_entrega(uuid, text, text, numeric, numeric, jsonb)',
  'acerto_resumo(uuid)', 'acerto_registrar(uuid, numeric, jsonb, text, boolean, uuid, uuid)', 'acerto_excluir(uuid)'
] loop
  execute format('revoke execute on function public.%s from public, anon', f);
  execute format('grant execute on function public.%s to authenticated', f);
end loop; end $$;

-- Entregas feitas antes do registro de recebimento: considera o valor todo
-- recebido na forma do pedido (dinheiro, PIX ou cartão), para o acerto fechar.
insert into public.entregas_recebimentos (empresa_id, expedicao_id, expedicao_pedido_id, pedido_id, tipo, valor)
select ep.empresa_id, ep.expedicao_id, ep.id, ep.pedido_id, fp.recebe_na_entrega, pe.valor_total
  from public.expedicoes_pedidos ep
  join public.pedidos pe on pe.id = ep.pedido_id
  join public.formas_pagamento fp on fp.id = pe.forma_pagamento_id
 where ep.status_entrega = 'entregue' and fp.recebe_na_entrega is not null and pe.valor_total > 0
   and not exists (select 1 from public.entregas_recebimentos x where x.expedicao_pedido_id = ep.id);

-- =====================================================================
-- Fase 4f · Despesas da expedição (frota)
-- Combustível exige km atual, litros e preço do litro; o sistema calcula
-- o valor, os km rodados desde o último abastecimento e o consumo.
-- =====================================================================

create table public.despesas_frota (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  data date not null default current_date,
  categoria text not null check (categoria in ('combustivel', 'manutencao', 'pneu', 'pedagio', 'alimentacao', 'estacionamento', 'lavagem', 'multa', 'outros')),
  veiculo_id uuid references public.veiculos(id),
  motorista_id uuid references public.pessoas(id),
  expedicao_id uuid references public.expedicoes(id) on delete set null,
  descricao text,
  valor numeric(14,2) not null check (valor > 0),
  pago_pelo_motorista boolean not null default false,
  -- combustível
  km_atual integer check (km_atual is null or km_atual >= 0),
  litros numeric(10,3) check (litros is null or litros > 0),
  preco_litro numeric(10,3) check (preco_litro is null or preco_litro > 0),
  combustivel text check (combustivel in ('diesel', 'diesel_s10', 'gasolina', 'etanol', 'gnv')),
  tanque_cheio boolean not null default true,
  posto text,
  ativo boolean not null default true,
  criado_por uuid,
  criado_em timestamptz not null default now(),
  constraint despesas_frota_combustivel_ck check (
    categoria <> 'combustivel' or (veiculo_id is not null and km_atual is not null and litros is not null and preco_litro is not null))
);
create index despesas_frota_veiculo_idx on public.despesas_frota (veiculo_id, km_atual) where ativo;
create index despesas_frota_data_idx on public.despesas_frota (empresa_id, data);
create index despesas_frota_carga_idx on public.despesas_frota (expedicao_id);
alter table public.despesas_frota enable row level security;
create policy "despesas_frota_ver" on public.despesas_frota for select to authenticated
  using (empresa_id = public.empresa_atual() and (public.tem_permissao('expedicao', 'ver') or public.tem_permissao('financeiro', 'ver')));

-- Lança a despesa. No combustível o valor é litros × preço do litro.
create or replace function public.despesa_frota_lancar(
  p_categoria text, p_valor numeric, p_data date default null, p_veiculo uuid default null, p_motorista uuid default null,
  p_expedicao uuid default null, p_descricao text default null, p_pago_pelo_motorista boolean default false,
  p_km_atual integer default null, p_litros numeric default null, p_preco_litro numeric default null,
  p_combustivel text default null, p_tanque_cheio boolean default true, p_posto text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp uuid := public.empresa_atual();
  v_ultimo integer;
  v_valor numeric;
  v_id uuid;
begin
  perform public.fn_exigir('expedicao', 'editar');
  if p_categoria not in ('combustivel', 'manutencao', 'pneu', 'pedagio', 'alimentacao', 'estacionamento', 'lavagem', 'multa', 'outros') then
    raise exception 'Categoria de despesa inválida.';
  end if;
  if coalesce(p_data, current_date) > current_date then raise exception 'A data da despesa não pode ser futura.'; end if;
  if p_veiculo is not null and not exists (select 1 from public.veiculos where id = p_veiculo and empresa_id = v_emp) then
    raise exception 'Veículo não encontrado.';
  end if;
  if p_motorista is not null and not exists (select 1 from public.pessoas where id = p_motorista and empresa_id = v_emp) then
    raise exception 'Motorista não encontrado.';
  end if;
  if p_expedicao is not null and not exists (select 1 from public.expedicoes where id = p_expedicao and empresa_id = v_emp) then
    raise exception 'Carga não encontrada.';
  end if;

  if p_categoria = 'combustivel' then
    if p_veiculo is null then raise exception 'No combustível, informe o veículo.'; end if;
    if p_km_atual is null or p_km_atual <= 0 then raise exception 'No combustível, informe o km atual do veículo.'; end if;
    if coalesce(p_litros, 0) <= 0 then raise exception 'No combustível, informe os litros abastecidos.'; end if;
    if coalesce(p_preco_litro, 0) <= 0 then raise exception 'No combustível, informe o valor pago no litro.'; end if;
    select max(km_atual) into v_ultimo from public.despesas_frota
     where veiculo_id = p_veiculo and ativo and categoria = 'combustivel' and data <= coalesce(p_data, current_date);
    if v_ultimo is not null and p_km_atual <= v_ultimo then
      raise exception 'O km atual (%) precisa ser maior que o do último abastecimento deste veículo (%).', p_km_atual, v_ultimo;
    end if;
    v_valor := round(p_litros * p_preco_litro, 2);
  else
    if coalesce(p_valor, 0) <= 0 then raise exception 'Informe o valor da despesa.'; end if;
    if p_categoria = 'outros' and coalesce(trim(p_descricao), '') = '' then raise exception 'Descreva a despesa.'; end if;
    v_valor := round(p_valor, 2);
  end if;

  insert into public.despesas_frota (empresa_id, data, categoria, veiculo_id, motorista_id, expedicao_id, descricao, valor, pago_pelo_motorista,
    km_atual, litros, preco_litro, combustivel, tanque_cheio, posto, criado_por)
  values (v_emp, coalesce(p_data, current_date), p_categoria, p_veiculo, p_motorista, p_expedicao, nullif(trim(p_descricao), ''), v_valor,
    coalesce(p_pago_pelo_motorista, false),
    case when p_categoria = 'combustivel' then p_km_atual end, case when p_categoria = 'combustivel' then p_litros end,
    case when p_categoria = 'combustivel' then p_preco_litro end, case when p_categoria = 'combustivel' then p_combustivel end,
    coalesce(p_tanque_cheio, true), nullif(trim(p_posto), ''), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.despesa_frota_excluir(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.fn_exigir('expedicao', 'editar');
  if exists (select 1 from public.despesas_frota d join public.acertos a on a.expedicao_id = d.expedicao_id
              where d.id = p_id and d.pago_pelo_motorista) then
    raise exception 'Esta despesa já entrou no acerto da carga. Desfaça o acerto antes.';
  end if;
  update public.despesas_frota set ativo = false where id = p_id and empresa_id = public.empresa_atual() and ativo;
  if not found then raise exception 'Despesa não encontrada.'; end if;
end;
$$;

-- Lista com km rodados e consumo desde o abastecimento anterior do mesmo veículo
create or replace view public.vw_despesas_frota
as
select d.id, d.data, d.categoria, d.descricao, d.valor, d.pago_pelo_motorista, d.km_atual, d.litros, d.preco_litro, d.combustivel,
       d.tanque_cheio, d.posto, d.criado_em, d.veiculo_id, d.motorista_id, d.expedicao_id,
       v.placa as veiculo_placa, v.descricao as veiculo_descricao, m.razao_social as motorista_nome, e.numero as carga_numero,
       ant.km_atual as km_anterior,
       case when d.categoria = 'combustivel' and ant.km_atual is not null then d.km_atual - ant.km_atual end as km_rodados,
       case when d.categoria = 'combustivel' and ant.km_atual is not null and d.tanque_cheio
            then round((d.km_atual - ant.km_atual) / d.litros, 2) end as km_por_litro,
       case when d.categoria = 'combustivel' and ant.km_atual is not null and d.km_atual > ant.km_atual
            then round(d.valor / (d.km_atual - ant.km_atual), 3) end as custo_km
  from public.despesas_frota d
  left join public.veiculos v on v.id = d.veiculo_id
  left join public.pessoas m on m.id = d.motorista_id
  left join public.expedicoes e on e.id = d.expedicao_id
  left join lateral (
    select x.km_atual from public.despesas_frota x
     where x.veiculo_id = d.veiculo_id and x.categoria = 'combustivel' and x.ativo and x.id <> d.id
       and x.km_atual < d.km_atual
     order by x.km_atual desc limit 1
  ) ant on d.categoria = 'combustivel'
 where d.empresa_id = public.empresa_atual() and d.ativo
   and (public.tem_permissao('expedicao', 'ver') or public.tem_permissao('financeiro', 'ver'));
revoke all on public.vw_despesas_frota from public, anon;
grant select on public.vw_despesas_frota to authenticated;

do $$ declare f text; begin foreach f in array array[
  'despesa_frota_lancar(text, numeric, date, uuid, uuid, uuid, text, boolean, integer, numeric, numeric, text, boolean, text)',
  'despesa_frota_excluir(uuid)'
] loop
  execute format('revoke execute on function public.%s from public, anon', f);
  execute format('grant execute on function public.%s to authenticated', f);
end loop; end $$;

-- =====================================================================
-- Fase 5b · Departamento financeiro: visão geral, DRE simples e fluxo de caixa
-- =====================================================================

-- Ordem e sinal dos grupos da DRE
create or replace function public.fn_dre_ordem(p_grupo text)
returns integer
language sql
immutable
as $$
  select case p_grupo
    when 'Receita bruta' then 10
    when 'Impostos sobre vendas' then 20
    when 'Custo das mercadorias' then 30
    when 'Despesas comerciais' then 40
    when 'Despesas com pessoal' then 50
    when 'Despesas administrativas' then 60
    when 'Resultado financeiro' then 70
    when 'Outras receitas' then 80
    when 'Outras despesas' then 90
    else 99 end;
$$;

-- DRE por conta: competência (data de competência) ou caixa (data do pagamento)
create or replace function public.fin_dre(p_de date, p_ate date, p_regime text default 'competencia')
returns table (grupo text, ordem integer, conta_id uuid, conta_codigo text, conta_nome text, tipo text, valor numeric, qtd bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_emp uuid := public.empresa_atual();
begin
  perform public.fn_exigir('financeiro', 'ver');
  if p_regime not in ('competencia', 'caixa') then raise exception 'Regime inválido.'; end if;
  return query
  with base as (
    select l.plano_conta_id, l.tipo,
           case when p_regime = 'caixa' then coalesce(l.valor_pago, l.valor) else l.valor end as v
      from public.lancamentos l
     where l.empresa_id = v_emp and l.ativo
       and case when p_regime = 'caixa' then l.data_quitacao between p_de and p_ate
                else l.data_competencia between p_de and p_ate end
  )
  select coalesce(pc.grupo_dre, case when pc.id is null then 'Sem classificação'
                                     when b.tipo = 'receber' then 'Outras receitas' else 'Outras despesas' end),
         public.fn_dre_ordem(coalesce(pc.grupo_dre, case when pc.id is null then 'Sem classificação'
                                     when b.tipo = 'receber' then 'Outras receitas' else 'Outras despesas' end)),
         pc.id, pc.codigo, coalesce(pc.nome, case when b.tipo = 'receber' then 'Receitas sem categoria' else 'Despesas sem categoria' end),
         b.tipo, round(sum(b.v), 2), count(*)
    from base b
    left join public.plano_contas pc on pc.id = b.plano_conta_id
   group by 1, 2, pc.id, pc.codigo, pc.nome, b.tipo
   order by 2, 4 nulls last;
end;
$$;

-- Números da visão geral no período
create or replace function public.fin_resumo(p_de date, p_ate date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_emp uuid := public.empresa_atual();
  r jsonb;
begin
  perform public.fn_exigir('financeiro', 'ver');
  select jsonb_build_object(
    'recebido', coalesce(sum(valor_pago) filter (where tipo = 'receber' and data_quitacao between p_de and p_ate), 0),
    'pago', coalesce(sum(valor_pago) filter (where tipo = 'pagar' and data_quitacao between p_de and p_ate), 0),
    'a_receber', coalesce(sum(valor) filter (where tipo = 'receber' and data_quitacao is null and data_vencimento between p_de and p_ate), 0),
    'a_pagar', coalesce(sum(valor) filter (where tipo = 'pagar' and data_quitacao is null and data_vencimento between p_de and p_ate), 0),
    'atraso_receber', coalesce(sum(valor) filter (where tipo = 'receber' and data_quitacao is null and data_vencimento < current_date), 0),
    'atraso_pagar', coalesce(sum(valor) filter (where tipo = 'pagar' and data_quitacao is null and data_vencimento < current_date), 0),
    'vence_7_receber', coalesce(sum(valor) filter (where tipo = 'receber' and data_quitacao is null and data_vencimento between current_date and current_date + 7), 0),
    'vence_7_pagar', coalesce(sum(valor) filter (where tipo = 'pagar' and data_quitacao is null and data_vencimento between current_date and current_date + 7), 0),
    'sem_classificacao', count(*) filter (where plano_conta_id is null or (tipo = 'pagar' and centro_custo_id is null)),
    'saldo_contas', (select coalesce(sum(s.saldo_atual), 0) from public.vw_contas_saldos s where s.empresa_id = v_emp and s.ativo)
  ) into r
    from public.lancamentos where empresa_id = v_emp and ativo;
  return r;
end;
$$;

-- Fluxo de caixa diário: realizado (pagos) e previsto (em aberto pelo vencimento), com saldo acumulado
create or replace function public.fin_fluxo_caixa(p_de date, p_ate date)
returns table (data date, recebido numeric, pago numeric, a_receber numeric, a_pagar numeric, saldo numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_emp uuid := public.empresa_atual();
  v_saldo_ini numeric;
begin
  perform public.fn_exigir('financeiro', 'ver');
  if p_ate < p_de or p_ate - p_de > 400 then raise exception 'Período inválido (máximo de 400 dias).'; end if;
  select coalesce(sum(cb.saldo_inicial), 0)
         + coalesce((select sum(case when l.tipo = 'receber' then l.valor_pago else -l.valor_pago end)
                       from public.lancamentos l join public.contas_bancarias cb2 on cb2.id = l.conta_bancaria_id
                      where l.empresa_id = v_emp and l.ativo and l.data_quitacao is not null
                        and l.data_quitacao >= cb2.data_saldo_inicial and l.data_quitacao < p_de), 0)
    into v_saldo_ini
    from public.contas_bancarias cb where cb.empresa_id = v_emp and cb.ativo;

  return query
  with dias as (select generate_series(p_de, p_ate, interval '1 day')::date as d),
  realizado as (
    select l.data_quitacao as d,
           sum(l.valor_pago) filter (where l.tipo = 'receber') as rec,
           sum(l.valor_pago) filter (where l.tipo = 'pagar') as pag
      from public.lancamentos l
     where l.empresa_id = v_emp and l.ativo and l.data_quitacao between p_de and p_ate
     group by 1
  ),
  previsto as (
    select greatest(l.data_vencimento, current_date) as d,
           sum(l.valor) filter (where l.tipo = 'receber') as rec,
           sum(l.valor) filter (where l.tipo = 'pagar') as pag
      from public.lancamentos l
     where l.empresa_id = v_emp and l.ativo and l.data_quitacao is null
       and greatest(l.data_vencimento, current_date) between p_de and p_ate
     group by 1
  )
  select dias.d, coalesce(realizado.rec, 0), coalesce(realizado.pag, 0), coalesce(previsto.rec, 0), coalesce(previsto.pag, 0),
         v_saldo_ini + sum(coalesce(realizado.rec, 0) - coalesce(realizado.pag, 0) + coalesce(previsto.rec, 0) - coalesce(previsto.pag, 0))
                       over (order by dias.d rows unbounded preceding)
    from dias
    left join realizado on realizado.d = dias.d
    left join previsto on previsto.d = dias.d
   order by dias.d;
end;
$$;

-- Classifica um título (e as demais parcelas do mesmo pedido/compra) em categoria e centro de custo
create or replace function public.fin_classificar(p_lancamento uuid, p_plano_conta uuid, p_centro_custo uuid,
  p_competencia date default null, p_todas_parcelas boolean default true)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  l public.lancamentos;
  n integer;
begin
  perform public.fn_exigir('financeiro', 'editar');
  select * into l from public.lancamentos where id = p_lancamento and empresa_id = public.empresa_atual();
  if not found then raise exception 'Lançamento não encontrado.'; end if;
  if p_plano_conta is not null and not exists (
       select 1 from public.plano_contas where id = p_plano_conta and empresa_id = l.empresa_id and ativo
          and tipo = case when l.tipo = 'receber' then 'receita' else 'despesa' end) then
    raise exception 'Escolha uma categoria de %.', case when l.tipo = 'receber' then 'receita' else 'despesa' end;
  end if;
  if p_centro_custo is not null and not exists (select 1 from public.centros_custo where id = p_centro_custo and empresa_id = l.empresa_id and ativo) then
    raise exception 'Centro de custo não encontrado.';
  end if;
  update public.lancamentos
     set plano_conta_id = p_plano_conta, centro_custo_id = p_centro_custo,
         data_competencia = coalesce(p_competencia, data_competencia)
   where empresa_id = l.empresa_id and ativo
     and (id = l.id or (p_todas_parcelas and l.origem <> 'manual' and l.origem_id is not null
                        and origem = l.origem and origem_id = l.origem_id)
                    or (p_todas_parcelas and l.origem = 'manual' and l.titulo_pai_id is not null and (id = l.titulo_pai_id or titulo_pai_id = l.titulo_pai_id)));
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function public.fn_dre_ordem(text) from public, anon;
do $$ declare f text; begin foreach f in array array[
  'fin_dre(date, date, text)', 'fin_resumo(date, date)', 'fin_fluxo_caixa(date, date)', 'fin_classificar(uuid, uuid, uuid, date, boolean)'
] loop
  execute format('revoke execute on function public.%s from public, anon', f);
  execute format('grant execute on function public.%s to authenticated', f);
end loop; end $$;

-- =====================================================================
-- Fase 5c · Comissão automática dos vendedores
-- Cada pedido faturado gera a comissão do vendedor (3% por padrão).
-- As comissões do mês viram um título a pagar por vendedor, com
-- vencimento no dia 5 do mês seguinte. Estorno ou devolução descontam.
-- =====================================================================

alter table public.empresas
  add column if not exists comissao_padrao numeric(6,3) not null default 3 check (comissao_padrao between 0 and 100),
  add column if not exists comissao_dia_pagamento integer not null default 5 check (comissao_dia_pagamento between 1 and 28);

update public.pessoas set comissao_percentual = 3 where eh_vendedor and coalesce(comissao_percentual, 0) = 0;

alter table public.lancamentos drop constraint if exists lancamentos_origem_check;
alter table public.lancamentos add constraint lancamentos_origem_check
  check (origem in ('manual', 'pedido', 'nota_entrada', 'ofx', 'comissao'));

create table public.comissoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  vendedor_id uuid not null references public.pessoas(id),
  pedido_id uuid references public.pedidos(id),
  competencia date not null check (extract(day from competencia) = 1),
  base numeric(14,2) not null,
  percentual numeric(6,3) not null,
  valor numeric(14,2) not null,
  status text not null default 'ativa' check (status in ('ativa', 'estornada')),
  descricao text,
  criado_em timestamptz not null default now()
);
create unique index comissoes_pedido_ativa_un on public.comissoes (pedido_id) where status = 'ativa' and valor > 0;
create index comissoes_vendedor_idx on public.comissoes (empresa_id, vendedor_id, competencia);
alter table public.comissoes enable row level security;
create policy "comissoes_ver" on public.comissoes for select to authenticated
  using (empresa_id = public.empresa_atual()
         and (public.tem_permissao('financeiro', 'ver')
              or (public.tem_permissao('vendas', 'ver') and (public.fn_carteira() is null or vendedor_id = public.fn_carteira()))));

-- Mantém o título a pagar do mês do vendedor igual à soma das comissões
create or replace function public.fn_comissao_titulo(p_vendedor uuid, p_competencia date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp uuid;
  v_total numeric;
  v_qtd integer;
  t public.lancamentos;
  v_dia integer;
  v_nome text;
  v_plano uuid;
  v_centro uuid;
  v_regra text := current_setting('elos.regra', true);
  v_existe boolean;
begin
  select empresa_id, razao_social into v_emp, v_nome from public.pessoas where id = p_vendedor;
  select coalesce(sum(valor), 0), count(*) filter (where pedido_id is not null and valor > 0) into v_total, v_qtd
    from public.comissoes where vendedor_id = p_vendedor and competencia = p_competencia and status = 'ativa';
  select * into t from public.lancamentos
   where empresa_id = v_emp and origem = 'comissao' and origem_id = p_vendedor and data_competencia = p_competencia and ativo
   order by criado_em limit 1;
  v_existe := found;

  perform set_config('elos.regra', '1', true);
  if v_existe then
    if t.data_quitacao is null then
      if v_total > 0 then
        update public.lancamentos set valor = round(v_total, 2),
               observacao = format('%s pedido(s) faturado(s) em %s', v_qtd, to_char(p_competencia, 'MM/YYYY'))
         where id = t.id;
      else
        update public.lancamentos set ativo = false, cancelado_em = now(), motivo_cancelamento = 'Sem comissão no mês' where id = t.id;
      end if;
    end if;
  elsif v_total > 0 then
    select comissao_dia_pagamento into v_dia from public.empresas where id = v_emp;
    select id into v_plano from public.plano_contas where empresa_id = v_emp and codigo = '2.03' and ativo;
    select id into v_centro from public.centros_custo where empresa_id = v_emp and ativo and nome ilike 'comercial%' order by nome limit 1;
    insert into public.lancamentos (empresa_id, tipo, pessoa_id, plano_conta_id, centro_custo_id, descricao, documento, parcela, total_parcelas,
      valor, data_competencia, data_vencimento, origem, origem_id, observacao)
    values (v_emp, 'pagar', p_vendedor, v_plano, v_centro,
      format('Comissão %s · %s', to_char(p_competencia, 'MM/YYYY'), v_nome), 'COM-' || to_char(p_competencia, 'YYYY-MM'), 1, 1,
      round(v_total, 2), p_competencia, (p_competencia + interval '1 month')::date + (v_dia - 1), 'comissao', p_vendedor,
      format('%s pedido(s) faturado(s) em %s', v_qtd, to_char(p_competencia, 'MM/YYYY')));
  end if;
  perform set_config('elos.regra', coalesce(v_regra, ''), true);
end;
$$;

-- Gera a comissão de um pedido faturado
create or replace function public.fn_comissao_gerar(p_pedido uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  p record;
  v_comp date := date_trunc('month', current_date)::date;
begin
  select pe.id, pe.empresa_id, pe.vendedor_id, pe.valor_total, pe.numero,
         coalesce(v.comissao_percentual, em.comissao_padrao) as pct
    into p
    from public.pedidos pe
    join public.empresas em on em.id = pe.empresa_id
    left join public.pessoas v on v.id = pe.vendedor_id
   where pe.id = p_pedido;
  if p.vendedor_id is null or coalesce(p.pct, 0) <= 0 or p.valor_total <= 0 then return; end if;
  if exists (select 1 from public.comissoes where pedido_id = p.id and status = 'ativa' and valor > 0) then return; end if;
  insert into public.comissoes (empresa_id, vendedor_id, pedido_id, competencia, base, percentual, valor, descricao)
  values (p.empresa_id, p.vendedor_id, p.id, v_comp, p.valor_total, p.pct, round(p.valor_total * p.pct / 100, 2), 'Pedido nº ' || p.numero);
  perform public.fn_comissao_titulo(p.vendedor_id, v_comp);
end;
$$;

-- Estorna a comissão de um pedido. Se o mês dela já foi pago, desconta no mês atual.
create or replace function public.fn_comissao_estornar(p_pedido uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.comissoes;
  v_comp date := date_trunc('month', current_date)::date;
  v_pago boolean;
begin
  for c in select * from public.comissoes where pedido_id = p_pedido and status = 'ativa' and valor > 0 loop
    select exists (select 1 from public.lancamentos where origem = 'comissao' and origem_id = c.vendedor_id
                    and data_competencia = c.competencia and ativo and data_quitacao is not null) into v_pago;
    if v_pago then
      insert into public.comissoes (empresa_id, vendedor_id, pedido_id, competencia, base, percentual, valor, descricao)
      values (c.empresa_id, c.vendedor_id, c.pedido_id, v_comp, -c.base, c.percentual, -c.valor, 'Desconto · ' || coalesce(c.descricao, '') || ' · ' || p_motivo);
      perform public.fn_comissao_titulo(c.vendedor_id, v_comp);
    else
      update public.comissoes set status = 'estornada', descricao = coalesce(descricao, '') || ' · ' || p_motivo where id = c.id;
      perform public.fn_comissao_titulo(c.vendedor_id, c.competencia);
    end if;
  end loop;
end;
$$;

-- Faturar passa a gerar a comissão
create or replace function public.fn_pedido_faturar(p_pedido uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.pedidos;
  n integer;
begin
  p := public.fn_pedido_obter(p_pedido);
  if p.tipo <> 'pedido' then raise exception 'Orçamento não é faturado.'; end if;
  if p.faturado_em is not null then raise exception 'Pedido nº % já está faturado.', p.numero; end if;
  if p.status not in ('aprovado', 'em_separacao', 'em_rota', 'entregue') then
    raise exception 'Pedido nº % não pode ser faturado (situação: %).', p.numero, p.status;
  end if;
  update public.pedidos set faturado_em = now(), faturado_por = auth.uid() where id = p.id;
  perform public.fn_pedido_gerar_titulos(p.id);
  n := public.fn_pedido_gerar_boletos(p.id);
  perform public.fn_comissao_gerar(p.id);
  perform set_config('elos.regra', '', true);
  return n;
end;
$$;

-- Estorno do faturamento estorna a comissão
create or replace function public.pedido_estornar_faturamento(p_pedido uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.pedidos;
begin
  perform public.fn_exigir('fiscal', 'editar');
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo do estorno.'; end if;
  p := public.fn_pedido_obter(p_pedido);
  if p.faturado_em is null then raise exception 'Pedido não está faturado.'; end if;
  if exists (select 1 from public.lancamentos where origem = 'pedido' and origem_id = p.id and ativo and data_quitacao is not null) then
    raise exception 'O pedido tem título pago. Estorne a baixa no financeiro antes.';
  end if;
  if exists (select 1 from public.boletos where pedido_id = p.id and status = 'registrado') then
    raise exception 'O pedido tem boleto registrado no banco. Peça a baixa do boleto antes.';
  end if;
  if p.status not in ('em_rota', 'entregue') then
    perform public.fn_pedido_cancelar_titulos(p.id, 'Faturamento estornado: ' || trim(p_motivo));
  end if;
  perform public.fn_comissao_estornar(p.id, 'faturamento estornado');
  perform set_config('elos.regra', '1', true);
  update public.boletos set status = 'cancelado', cancelado_em = now() where pedido_id = p.id and status in ('pendente', 'erro');
  update public.pedidos set faturado_em = null, faturado_por = null where id = p.id;
  perform set_config('elos.regra', '', true);
end;
$$;

-- Devolução de pedido faturado desconta a comissão
create or replace function public.fn_pedido_financeiro()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_regra text := current_setting('elos.regra', true);
begin
  if new.status = 'em_rota' and old.status is distinct from 'em_rota' then
    perform public.fn_pedido_gerar_titulos(new.id);
    if new.faturado_em is not null then perform public.fn_pedido_gerar_boletos(new.id); end if;
  elsif new.status = 'devolvido' and old.status = 'em_rota' then
    perform public.fn_pedido_cancelar_titulos(new.id, 'Pedido devolvido na entrega');
    if new.faturado_em is not null then perform public.fn_comissao_estornar(new.id, 'pedido devolvido'); end if;
  elsif new.status = 'aprovado' and old.status = 'em_rota' and new.faturado_em is null then
    perform public.fn_pedido_cancelar_titulos(new.id, 'Cliente ausente: título refeito na próxima saída');
  end if;
  perform set_config('elos.regra', coalesce(v_regra, ''), true);
  return null;
end;
$$;

-- Ganhos do vendedor para o app (para quem vê tudo: resumo por vendedor)
create or replace function public.app_comissoes()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_emp uuid := public.empresa_atual();
  v_cart uuid := public.fn_carteira();
  v_ini date := date_trunc('month', current_date)::date;
  v_pct numeric;
  v_dia integer;
  r jsonb;
begin
  perform public.fn_exigir('vendas', 'ver');
  select comissao_dia_pagamento, comissao_padrao into v_dia, v_pct from public.empresas where id = v_emp;
  if v_cart is not null then
    select coalesce(comissao_percentual, v_pct) into v_pct from public.pessoas where id = v_cart;
  end if;
  with meses as (
    select c.vendedor_id, c.competencia, sum(c.valor) as valor, sum(c.base) as base,
           count(*) filter (where c.valor > 0) as pedidos
      from public.comissoes c
     where c.empresa_id = v_emp and c.status = 'ativa' and c.competencia >= (v_ini - interval '5 months')
       and (v_cart is null or c.vendedor_id = v_cart)
     group by 1, 2
  ), titulos as (
    select l.origem_id as vendedor_id, l.data_competencia as competencia, l.data_vencimento, l.data_quitacao, l.valor_pago
      from public.lancamentos l
     where l.empresa_id = v_emp and l.origem = 'comissao' and l.ativo and (v_cart is null or l.origem_id = v_cart)
  )
  select jsonb_build_object(
    'percentual', v_pct,
    'dia_pagamento', v_dia,
    'mes_valor', coalesce((select sum(valor) from meses where competencia = v_ini), 0),
    'mes_base', coalesce((select sum(base) from meses where competencia = v_ini), 0),
    'mes_pedidos', coalesce((select sum(pedidos) from meses where competencia = v_ini), 0),
    'hoje_valor', coalesce((select sum(c.valor) from public.comissoes c where c.empresa_id = v_emp and c.status = 'ativa'
                             and (c.criado_em at time zone 'America/Campo_Grande')::date = current_date and (v_cart is null or c.vendedor_id = v_cart)), 0),
    'a_receber', coalesce((select sum(l.valor) from public.lancamentos l where l.empresa_id = v_emp and l.origem = 'comissao' and l.ativo
                             and l.data_quitacao is null and (v_cart is null or l.origem_id = v_cart)), 0),
    'proximo_pagamento', (v_ini + interval '1 month')::date + (v_dia - 1),
    'recebido_ano', coalesce((select sum(l.valor_pago) from public.lancamentos l where l.empresa_id = v_emp and l.origem = 'comissao' and l.ativo
                             and l.data_quitacao >= date_trunc('year', current_date) and (v_cart is null or l.origem_id = v_cart)), 0),
    'historico', coalesce((
      select jsonb_agg(jsonb_build_object('competencia', m.competencia, 'valor', m.valor, 'base', m.base, 'pedidos', m.pedidos,
               'vencimento', coalesce(t.data_vencimento, (m.competencia + interval '1 month')::date + (v_dia - 1)),
               'pago_em', t.data_quitacao) order by m.competencia desc)
        from (select competencia, sum(valor) as valor, sum(base) as base, sum(pedidos) as pedidos,
                     min(vendedor_id::text)::uuid as vendedor_id, count(distinct vendedor_id) as nv
                from meses group by competencia) m
        left join lateral (select max(t.data_vencimento) as data_vencimento,
                                  case when bool_and(t.data_quitacao is not null) then max(t.data_quitacao) end as data_quitacao
                             from titulos t where t.competencia = m.competencia) t on true), '[]'::jsonb),
    'por_vendedor', case when v_cart is null then coalesce((
      select jsonb_agg(jsonb_build_object('nome', p.razao_social, 'valor', m.valor, 'pedidos', m.pedidos) order by m.valor desc)
        from meses m join public.pessoas p on p.id = m.vendedor_id where m.competencia = v_ini), '[]'::jsonb) end
  ) into r;
  return r;
end;
$$;

revoke execute on function public.fn_comissao_titulo(uuid, date) from public, anon, authenticated;
revoke execute on function public.fn_comissao_gerar(uuid) from public, anon, authenticated;
revoke execute on function public.fn_comissao_estornar(uuid, text) from public, anon, authenticated;
revoke execute on function public.app_comissoes() from public, anon;
grant execute on function public.app_comissoes() to authenticated;

-- Pedidos já faturados antes desta mudança também geram a comissão
do $$ declare r record; begin
  for r in select id from public.pedidos where faturado_em is not null and ativo and status not in ('cancelado', 'devolvido') order by faturado_em loop
    perform public.fn_comissao_gerar(r.id);
  end loop;
end $$;
