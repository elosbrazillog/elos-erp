-- =====================================================================
-- Histórico de vendas do sistema anterior (Atende)
-- Guarda os itens vendidos antes do Elos ERP, ligados aos cadastros
-- (cliente pelo CPF/CNPJ, produto pelo código, vendedor pelo nome),
-- e soma esse histórico nas metas, painéis e na carteira do vendedor.
-- Não gera estoque, financeiro, boletos nem comissão.
-- =====================================================================

create table public.vendas_historico (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  origem text not null default 'atende',
  pedido_codigo text not null,
  linha integer not null,
  status text,
  faturado boolean not null default false,
  nfe text,
  data_nfe date,
  data date,                       -- data do faturamento
  quantidade numeric(14,3) not null default 0,
  preco numeric(14,4) not null default 0,
  total numeric(14,2) not null default 0,
  cliente_documento text,
  cliente_nome text,
  cidade text,
  uf text,
  vendedor_nome text,
  forma_pagamento text,
  produto_codigo text,
  produto_nome text,
  unidade text,
  ncm text,
  cliente_id uuid references public.pessoas(id) on delete set null,
  produto_id uuid references public.produtos(id) on delete set null,
  vendedor_id uuid references public.pessoas(id) on delete set null,
  importado_em timestamptz not null default now(),
  importado_por uuid,
  unique (empresa_id, origem, pedido_codigo, linha)
);
create index vendas_historico_data_idx on public.vendas_historico (empresa_id, data);
create index vendas_historico_cliente_idx on public.vendas_historico (cliente_id, data);
create index vendas_historico_vendedor_idx on public.vendas_historico (vendedor_id, data);
alter table public.vendas_historico enable row level security;
create policy "vendas_historico_ver" on public.vendas_historico for select to authenticated
  using (empresa_id = public.empresa_atual() and public.tem_permissao('vendas', 'ver')
         and (public.fn_carteira() is null or vendedor_id = public.fn_carteira()));

-- Um registro por pedido do histórico
create or replace view public.vw_historico_pedidos
with (security_invoker = true)
as
select h.empresa_id, h.origem, h.pedido_codigo,
       min(h.data) as data, bool_and(h.faturado) as faturado, min(h.status) as status,
       max(h.nfe) filter (where h.nfe <> '') as nfe,
       min(h.cliente_id::text)::uuid as cliente_id, min(h.cliente_nome) as cliente_nome, min(h.cliente_documento) as cliente_documento,
       min(h.cidade) as cidade,
       min(h.vendedor_id::text)::uuid as vendedor_id, min(h.vendedor_nome) as vendedor_nome,
       min(h.forma_pagamento) as forma_pagamento,
       round(sum(h.total), 2) as total, count(*) as itens, sum(h.quantidade) as quantidade
  from public.vendas_historico h
 group by h.empresa_id, h.origem, h.pedido_codigo;

-- Liga o histórico aos cadastros (roda depois da importação e pode rodar de novo)
create or replace function public.fn_historico_vincular(p_emp uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.vendas_historico h set cliente_id = p.id
    from public.pessoas p
   where h.empresa_id = p_emp and h.cliente_id is null and p.empresa_id = p_emp and p.ativo
     and regexp_replace(coalesce(p.documento, ''), '\D', '', 'g') = regexp_replace(coalesce(h.cliente_documento, ''), '\D', '', 'g')
     and coalesce(h.cliente_documento, '') <> '';
  update public.vendas_historico h set produto_id = p.id
    from public.produtos p
   where h.empresa_id = p_emp and h.produto_id is null and p.empresa_id = p_emp and p.codigo = h.produto_codigo;
  update public.vendas_historico h set produto_id = p.id
    from public.produtos p
   where h.empresa_id = p_emp and h.produto_id is null and p.empresa_id = p_emp
     and public.fn_normaliza(p.nome) = public.fn_normaliza(h.produto_nome);
  -- vendedor: nome igual ou mesmo primeiro nome (só quando há um vendedor com ele)
  update public.vendas_historico h set vendedor_id = v.id
    from (select distinct on (k) k, id from (
            select public.fn_normaliza(split_part(trim(razao_social), ' ', 1)) as k, id,
                   count(*) over (partition by public.fn_normaliza(split_part(trim(razao_social), ' ', 1))) as n
              from public.pessoas where empresa_id = p_emp and eh_vendedor and ativo) x where n = 1) v
   where h.empresa_id = p_emp and h.vendedor_id is null
     and public.fn_normaliza(split_part(trim(h.vendedor_nome), ' ', 1)) = v.k;
  update public.vendas_historico h set vendedor_id = p.id
    from public.pessoas p
   where h.empresa_id = p_emp and h.vendedor_id is null and p.empresa_id = p_emp and p.eh_vendedor
     and public.fn_normaliza(p.razao_social) = public.fn_normaliza(h.vendedor_nome);
  -- sem vendedor reconhecido: fica com o vendedor da carteira do cliente
  update public.vendas_historico h set vendedor_id = c.vendedor_id
    from public.pessoas c
   where h.empresa_id = p_emp and h.vendedor_id is null and c.id = h.cliente_id and c.vendedor_id is not null
     and coalesce(h.vendedor_nome, '') = '';
end;
$$;

-- Importa um lote de linhas da planilha (substitui os pedidos que já estavam importados)
create or replace function public.historico_importar(p_linhas jsonb, p_origem text default 'atende')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp uuid := public.empresa_atual();
  n integer;
begin
  perform public.fn_exigir('vendas', 'editar');
  if jsonb_typeof(p_linhas) <> 'array' or jsonb_array_length(p_linhas) = 0 then raise exception 'Nada para importar.'; end if;
  if jsonb_array_length(p_linhas) > 3000 then raise exception 'Envie no máximo 3000 linhas por vez.'; end if;

  drop table if exists _hist;
  create temp table _hist on commit drop as
  select x.*
    from jsonb_to_recordset(p_linhas) as x(pedido text, linha integer, status text, nfe text, data_nfe date, data date,
         quantidade numeric, preco numeric, total numeric, documento text, cliente text, cidade text, uf text,
         vendedor text, forma text, produto_codigo text, produto_nome text, unidade text, ncm text);
  if exists (select 1 from _hist where coalesce(trim(pedido), '') = '') then raise exception 'Há linhas sem código da venda.'; end if;

  delete from public.vendas_historico h
   where h.empresa_id = v_emp and h.origem = p_origem and h.pedido_codigo in (select distinct trim(pedido) from _hist);

  insert into public.vendas_historico (empresa_id, origem, pedido_codigo, linha, status, faturado, nfe, data_nfe, data,
    quantidade, preco, total, cliente_documento, cliente_nome, cidade, uf, vendedor_nome, forma_pagamento,
    produto_codigo, produto_nome, unidade, ncm, importado_por)
  select v_emp, p_origem, trim(pedido), coalesce(linha, row_number() over (partition by trim(pedido))::integer), nullif(trim(status), ''),
         coalesce(public.fn_normaliza(status) like '%faturado%' and public.fn_normaliza(status) not like '%nao faturado%'
                  and public.fn_normaliza(status) not like '%sem faturamento%', false),
         nullif(trim(nfe), ''), data_nfe, data,
         coalesce(quantidade, 0), coalesce(preco, 0), round(coalesce(total, quantidade * preco, 0), 2),
         nullif(regexp_replace(coalesce(documento, ''), '\D', '', 'g'), ''), nullif(trim(cliente), ''), nullif(trim(cidade), ''),
         upper(nullif(trim(uf), '')), nullif(trim(vendedor), ''), nullif(trim(forma), ''),
         nullif(trim(produto_codigo), ''), nullif(trim(produto_nome), ''), upper(nullif(trim(unidade), '')), nullif(trim(ncm), ''),
         auth.uid()
    from _hist;
  get diagnostics n = row_count;
  perform public.fn_historico_vincular(v_emp);
  return jsonb_build_object('linhas', n, 'pedidos', (select count(distinct pedido) from _hist));
end;
$$;

-- Resumo do histórico para a tela (cards, meses, clientes e produtos)
create or replace function public.historico_resumo(p_de date, p_ate date, p_vendedor uuid default null, p_busca text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_emp uuid := public.empresa_atual();
  v_cart uuid := public.fn_carteira();
  v_busca text := '%' || public.fn_normaliza(coalesce(trim(p_busca), '')) || '%';
  r jsonb;
begin
  perform public.fn_exigir('vendas', 'ver');
  with base as (
    select h.* from public.vendas_historico h
     where h.empresa_id = v_emp and h.faturado and h.data between p_de and p_ate
       and (v_cart is null or h.vendedor_id = v_cart)
       and (p_vendedor is null or h.vendedor_id = p_vendedor)
       and (p_busca is null or trim(p_busca) = ''
            or public.fn_normaliza(concat_ws(' ', h.cliente_nome, h.cliente_documento, h.produto_nome, h.produto_codigo, h.pedido_codigo, h.cidade)) like v_busca)
  )
  select jsonb_build_object(
    'total', coalesce((select sum(total) from base), 0),
    'pedidos', (select count(distinct pedido_codigo) from base),
    'clientes', (select count(distinct coalesce(cliente_documento, cliente_nome)) from base),
    'itens', coalesce((select sum(quantidade) from base), 0),
    'primeira', (select min(data) from base), 'ultima', (select max(data) from base),
    'meses', coalesce((select jsonb_agg(jsonb_build_object('mes', m, 'total', t, 'pedidos', p) order by m)
                         from (select date_trunc('month', data)::date m, sum(total) t, count(distinct pedido_codigo) p from base group by 1) x), '[]'::jsonb),
    'clientes_top', coalesce((select jsonb_agg(x order by x.total desc) from (
        select min(cliente_nome) as nome, cliente_documento as documento, min(cliente_id::text)::uuid as cliente_id, min(cidade) as cidade,
               round(sum(total), 2) as total, count(distinct pedido_codigo) as pedidos, max(data) as ultima
          from base group by cliente_documento order by sum(total) desc limit 200) x), '[]'::jsonb),
    'produtos_top', coalesce((select jsonb_agg(x order by x.total desc) from (
        select produto_codigo as codigo, min(produto_nome) as nome, min(unidade) as unidade, sum(quantidade) as quantidade,
               round(sum(total), 2) as total, count(distinct pedido_codigo) as pedidos, count(distinct cliente_documento) as clientes
          from base group by produto_codigo order by sum(total) desc limit 200) x), '[]'::jsonb),
    'vendedores', coalesce((select jsonb_agg(x order by x.total desc) from (
        select coalesce(min(p.razao_social), min(b.vendedor_nome), 'Sem vendedor') as nome, round(sum(b.total), 2) as total,
               count(distinct b.pedido_codigo) as pedidos
          from base b left join public.pessoas p on p.id = b.vendedor_id group by coalesce(b.vendedor_id::text, b.vendedor_nome)) x), '[]'::jsonb),
    'nao_faturados', (select count(distinct pedido_codigo) from public.vendas_historico
                       where empresa_id = v_emp and not faturado and (v_cart is null or vendedor_id = v_cart)),
    'sem_cliente', (select count(distinct cliente_documento) from base where cliente_id is null),
    'sem_produto', (select count(distinct produto_codigo) from base where produto_id is null)
  ) into r;
  return r;
end;
$$;

-- ---------------------------------------------------------------------
-- O histórico entra nas metas, nos painéis e na carteira
-- ---------------------------------------------------------------------
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
  with todos as (
    select p.vendedor_id, p.valor_total as valor, p.cliente_id::text as cli
      from public.pedidos p
     where p.empresa_id = v_emp and p.tipo = 'pedido' and p.ativo
       and p.status in ('aprovado', 'em_separacao', 'faturado', 'em_rota', 'entregue')
       and (p.data_emissao at time zone 'America/Campo_Grande')::date >= v_ini
       and (p.data_emissao at time zone 'America/Campo_Grande')::date < v_fim
    union all
    select h.vendedor_id, h.total, coalesce(h.cliente_id::text, h.cliente_documento)
      from public.vw_historico_pedidos h
     where h.empresa_id = v_emp and h.faturado and h.data >= v_ini and h.data < v_fim
  ), vend as (
    select t.vendedor_id, sum(t.valor) as valor, count(*) as qtd, count(distinct t.cli) as cli from todos t group by t.vendedor_id
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
    union all
    select null::uuid, h.cliente_id, h.total, h.data, h.data
      from public.vw_historico_pedidos h
     where h.empresa_id = v_emp and h.faturado and h.data >= v_ini
       and (v_cart is null or h.vendedor_id = v_cart)
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

create or replace function public.app_carteira()
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
         up.dia, up.numero, up.valor_total, up.itens,
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
      select * from (
        select (p.data_emissao at time zone 'America/Campo_Grande')::date as dia, p.data_emissao as momento, p.numero, p.valor_total,
               (select jsonb_agg(jsonb_build_object('produto_id', i.produto_id, 'quantidade', i.quantidade) order by i.ordem)
                  from public.pedidos_itens i where i.pedido_id = p.id and i.ativo) as itens
          from public.pedidos p
         where p.cliente_id = c.id and p.tipo = 'pedido' and p.ativo and p.status not in ('rascunho', 'cancelado', 'devolvido')
         order by p.data_emissao desc limit 1) e
      union all
      select * from (
        -- venda do sistema anterior (Atende)
        select h.data, h.data::timestamp at time zone 'America/Campo_Grande',
               case when h.pedido_codigo ~ '^\d{1,15}$' then h.pedido_codigo::bigint end, h.total,
               (select jsonb_agg(jsonb_build_object('produto_id', x.produto_id, 'quantidade', x.quantidade) order by x.linha)
                  from public.vendas_historico x
                 where x.empresa_id = h.empresa_id and x.origem = h.origem and x.pedido_codigo = h.pedido_codigo and x.produto_id is not null)
          from public.vw_historico_pedidos h
         where h.cliente_id = c.id and h.faturado and h.data is not null
         order by h.data desc limit 1) a
      order by momento desc limit 1
    ) up on true
   where c.empresa_id = v_emp and c.eh_cliente and c.ativo
     and (v_cart is null or c.vendedor_id = v_cart)
   order by r.nome nulls last, c.ordem_visita nulls last, 3;
end;
$$;

create or replace function public.painel_resumo()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp uuid := public.empresa_atual();
  v_hoje date := (now() at time zone 'America/Campo_Grande')::date;
  v_ini date := date_trunc('month', (now() at time zone 'America/Campo_Grande'))::date;
  v_fim date := (date_trunc('month', (now() at time zone 'America/Campo_Grande')) + interval '1 month - 1 day')::date;
  v_vendas boolean := public.tem_permissao('vendas', 'ver') and public.fn_carteira() is null;
  v_fin boolean := public.tem_permissao('financeiro', 'ver');
  v_est boolean := public.tem_permissao('estoque', 'ver');
  v_uteis integer;
  v_meta_emp numeric;
  r jsonb := '{}'::jsonb;
begin
  if v_emp is null then raise exception 'Sem empresa.'; end if;
  select count(*) into v_uteis from generate_series(v_ini, v_fim, interval '1 day') d where extract(dow from d) between 1 and 6;

  if v_vendas then
    create temp table if not exists _fat (id uuid, vendedor_id uuid, valor numeric, dia date) on commit drop;
    truncate _fat;
    insert into _fat
    select p.id, p.vendedor_id, p.valor_total, (p.faturado_em at time zone 'America/Campo_Grande')::date
      from public.pedidos p
     where p.empresa_id = v_emp and p.ativo and p.tipo = 'pedido' and p.faturado_em is not null
       and p.status not in ('cancelado', 'devolvido')
       and p.faturado_em >= ((v_ini - interval '5 months')::timestamp at time zone 'America/Campo_Grande');
    insert into _fat
    select null, h.vendedor_id, h.total, h.data
      from public.vw_historico_pedidos h
     where h.empresa_id = v_emp and h.faturado and h.data >= v_ini - interval '5 months';

    select coalesce(sum(valor), 0) into v_meta_emp from public.metas where empresa_id = v_emp and mes = v_ini;
    if v_meta_emp = 0 then v_meta_emp := null; end if;

    r := r || jsonb_build_object(
      'mes', v_ini, 'hoje', v_hoje, 'dias_uteis_mes', v_uteis,
      'dias_uteis_passados', (select count(*) from generate_series(v_ini, v_hoje, interval '1 day') d where extract(dow from d) between 1 and 6),
      'meta_empresa', v_meta_emp,
      'vendedores', coalesce((
        select jsonb_agg(x order by x.faturado_mes desc, x.nome) from (
          select v.razao_social as nome, m.valor as meta,
                 coalesce(sum(f.valor) filter (where f.dia = v_hoje), 0) as faturado_hoje,
                 coalesce(sum(f.valor) filter (where f.dia >= v_ini), 0) as faturado_mes,
                 count(*) filter (where f.dia >= v_ini) as pedidos_mes,
                 coalesce(v.comissao_percentual, em.comissao_padrao) as percentual,
                 coalesce((select sum(c.valor) from public.comissoes c join _fat f2 on f2.id = c.pedido_id
                            where c.vendedor_id = v.id and c.status = 'ativa' and f2.dia = v_hoje), 0) as comissao_hoje,
                 coalesce((select sum(c.valor) from public.comissoes c
                            where c.vendedor_id = v.id and c.status = 'ativa' and c.competencia = v_ini), 0) as comissao_mes
            from public.pessoas v
            join public.empresas em on em.id = v.empresa_id
            left join public.metas m on m.empresa_id = v_emp and m.mes = v_ini and m.vendedor_id = v.id
            left join _fat f on f.vendedor_id = v.id
           where v.empresa_id = v_emp and v.eh_vendedor and v.ativo
           group by v.id, v.razao_social, m.valor, em.comissao_padrao
          having m.valor is not null or count(f.dia) filter (where f.dia >= v_ini) > 0
        ) x), '[]'::jsonb),
      'faturado_mes', (select coalesce(sum(valor), 0) from _fat where dia >= v_ini),
      'faturado_hoje', (select coalesce(sum(valor), 0) from _fat where dia = v_hoje),
      'pedidos_faturados_mes', (select count(*) from _fat where dia >= v_ini),
      'aguardando', (select count(*) from public.pedidos where empresa_id = v_emp and ativo and status = 'aguardando_credito'),
      'a_faturar_qtd', (select count(*) from public.pedidos where empresa_id = v_emp and ativo and tipo = 'pedido' and faturado_em is null
                          and status in ('aprovado', 'em_separacao', 'em_rota', 'entregue')),
      'a_faturar_valor', (select coalesce(sum(valor_total), 0) from public.pedidos where empresa_id = v_emp and ativo and tipo = 'pedido' and faturado_em is null
                          and status in ('aprovado', 'em_separacao', 'em_rota', 'entregue')),
      'diario', (select jsonb_agg(jsonb_build_object('dia', d::date, 'valor',
                          coalesce((select sum(valor) from _fat where dia = d::date), 0)) order by d)
                   from generate_series(v_ini, v_fim, interval '1 day') d),
      'meses', (select jsonb_agg(jsonb_build_object('mes', m::date,
                          'valor', coalesce((select sum(valor) from _fat where dia >= m::date and dia < (m + interval '1 month')::date), 0),
                          'meta', (select nullif(sum(valor), 0) from public.metas where empresa_id = v_emp and mes = m::date)) order by m)
                  from generate_series(v_ini - interval '5 months', v_ini, interval '1 month') m)
    );
  end if;

  if v_fin then
    r := r || (
      select jsonb_build_object(
        'pagar_aberto', coalesce(sum(valor) filter (where tipo = 'pagar'), 0),
        'pagar_vencido', coalesce(sum(valor) filter (where tipo = 'pagar' and data_vencimento < v_hoje), 0),
        'pagar_vencido_qtd', count(*) filter (where tipo = 'pagar' and data_vencimento < v_hoje),
        'pagar_7', coalesce(sum(valor) filter (where tipo = 'pagar' and data_vencimento between v_hoje and v_hoje + 7), 0),
        'pagar_7_qtd', count(*) filter (where tipo = 'pagar' and data_vencimento between v_hoje and v_hoje + 7),
        'receber_aberto', coalesce(sum(valor) filter (where tipo = 'receber'), 0),
        'receber_vencido', coalesce(sum(valor) filter (where tipo = 'receber' and data_vencimento < v_hoje), 0),
        'receber_vencido_qtd', count(*) filter (where tipo = 'receber' and data_vencimento < v_hoje),
        'receber_7', coalesce(sum(valor) filter (where tipo = 'receber' and data_vencimento between v_hoje and v_hoje + 7), 0),
        'receber_7_qtd', count(*) filter (where tipo = 'receber' and data_vencimento between v_hoje and v_hoje + 7),
        'saldo_contas', (select coalesce(sum(s.saldo_atual), 0) from public.vw_contas_saldos s where s.empresa_id = v_emp and s.ativo),
        -- Próximas 4 semanas (vencidos entram na primeira)
        'semanas', (select jsonb_agg(jsonb_build_object('inicio', v_hoje + w * 7,
                       'receber', coalesce((select sum(l2.valor) from public.lancamentos l2 where l2.empresa_id = v_emp and l2.ativo and l2.data_quitacao is null
                                      and l2.tipo = 'receber' and greatest(l2.data_vencimento, v_hoje) between v_hoje + w * 7 and v_hoje + w * 7 + 6), 0),
                       'pagar', coalesce((select sum(l2.valor) from public.lancamentos l2 where l2.empresa_id = v_emp and l2.ativo and l2.data_quitacao is null
                                      and l2.tipo = 'pagar' and greatest(l2.data_vencimento, v_hoje) between v_hoje + w * 7 and v_hoje + w * 7 + 6), 0)) order by w)
                     from generate_series(0, 3) w)
      )
        from public.lancamentos
       where empresa_id = v_emp and ativo and data_quitacao is null
    );
  end if;

  if v_est then
    r := r || jsonb_build_object('estoque_baixo', coalesce((
      select jsonb_agg(x order by x.falta desc) from (
        select e.produto_nome as nome, e.disponivel, e.estoque_minimo as minimo, e.estoque_minimo - e.disponivel as falta
          from public.vw_estoque_produtos e
         where e.empresa_id = v_emp and e.estoque_minimo > 0 and e.disponivel < e.estoque_minimo
         order by e.estoque_minimo - e.disponivel desc limit 8) x), '[]'::jsonb),
      'estoque_baixo_qtd', (select count(*) from public.vw_estoque_produtos e
                             where e.empresa_id = v_emp and e.estoque_minimo > 0 and e.disponivel < e.estoque_minimo));
  end if;

  return r;
end;
$$;

revoke execute on function public.fn_historico_vincular(uuid) from public, anon, authenticated;
do $$ declare f text; begin foreach f in array array[
  'historico_importar(jsonb, text)', 'historico_resumo(date, date, uuid, text)'
] loop
  execute format('revoke execute on function public.%s from public, anon', f);
  execute format('grant execute on function public.%s to authenticated', f);
end loop; end $$;
