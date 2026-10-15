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
