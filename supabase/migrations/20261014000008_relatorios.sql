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
