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
