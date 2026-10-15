-- =====================================================================
-- Painel inicial: metas e comissões por vendedor, visão financeira e
-- séries pequenas para gráficos. Cada bloco só vem para quem pode ver.
-- =====================================================================

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
                 count(f.id) filter (where f.dia >= v_ini) as pedidos_mes,
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
          having m.valor is not null or count(f.id) filter (where f.dia >= v_ini) > 0
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

revoke execute on function public.painel_resumo() from public, anon;
grant execute on function public.painel_resumo() to authenticated;
