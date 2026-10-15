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
