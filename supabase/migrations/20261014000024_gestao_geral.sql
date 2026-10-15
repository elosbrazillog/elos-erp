-- =====================================================================
-- Gestão geral: visão da empresa inteira para o administrador
-- Vendas (ERP + histórico do Atende), margem estimada, equipe, clientes
-- em risco, financeiro, operação de entregas e estoque, num só lugar.
-- =====================================================================

create or replace function public.fn_eh_administrador()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select p.administrador from public.usuarios u join public.perfis p on p.id = u.perfil_id and p.ativo
                    where u.id = auth.uid() and u.ativo), false);
$$;

create or replace function public.gestao_resumo(p_de date, p_ate date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp uuid := public.empresa_atual();
  v_hoje date := (now() at time zone 'America/Campo_Grande')::date;
  v_dias integer := p_ate - p_de + 1;
  v_ant_de date := p_de - (p_ate - p_de + 1);
  v_ant_ate date := p_de - 1;
  v_mes date := date_trunc('month', p_de)::date;
  r jsonb;
begin
  if not public.fn_eh_administrador() then raise exception 'Só o administrador vê a gestão geral.'; end if;
  if p_ate < p_de or v_dias > 400 then raise exception 'Período inválido (máximo de 400 dias).'; end if;

  -- Vendas faturadas do período atual e do anterior (mesmo tamanho), ERP + histórico
  drop table if exists _gv;
  create temp table _gv on commit drop as
  select 'erp'::text as origem, p.id::text as pedido, p.cliente_id, p.vendedor_id,
         (p.faturado_em at time zone 'America/Campo_Grande')::date as data, p.valor_total as total,
         coalesce((select sum(i.quantidade * pr.custo) from public.pedidos_itens i join public.produtos pr on pr.id = i.produto_id
                    where i.pedido_id = p.id and i.ativo), 0) as custo
    from public.pedidos p
   where p.empresa_id = v_emp and p.ativo and p.tipo = 'pedido' and p.faturado_em is not null
     and p.status not in ('cancelado', 'devolvido')
     and (p.faturado_em at time zone 'America/Campo_Grande')::date between v_ant_de and p_ate
  union all
  select 'atende', h.pedido_codigo, min(h.cliente_id::text)::uuid, min(h.vendedor_id::text)::uuid, min(h.data), sum(h.total),
         sum(h.quantidade * coalesce(pr.custo, 0))
    from public.vendas_historico h left join public.produtos pr on pr.id = h.produto_id
   where h.empresa_id = v_emp and h.faturado and h.data between v_ant_de and p_ate
   group by h.pedido_codigo;

  drop table if exists _gi;
  create temp table _gi on commit drop as
  select i.produto_id, pr.nome, pr.codigo, i.quantidade, i.valor_total as total, i.quantidade * pr.custo as custo, p.cliente_id
    from public.pedidos_itens i
    join public.pedidos p on p.id = i.pedido_id
    join public.produtos pr on pr.id = i.produto_id
   where p.empresa_id = v_emp and p.ativo and i.ativo and p.faturado_em is not null and p.status not in ('cancelado', 'devolvido')
     and (p.faturado_em at time zone 'America/Campo_Grande')::date between p_de and p_ate
  union all
  select h.produto_id, coalesce(pr.nome, h.produto_nome), coalesce(pr.codigo, h.produto_codigo), h.quantidade, h.total,
         h.quantidade * coalesce(pr.custo, 0), h.cliente_id
    from public.vendas_historico h left join public.produtos pr on pr.id = h.produto_id
   where h.empresa_id = v_emp and h.faturado and h.data between p_de and p_ate;

  select jsonb_build_object(
    'de', p_de, 'ate', p_ate, 'ant_de', v_ant_de, 'ant_ate', v_ant_ate, 'hoje', v_hoje,
    -- vendas
    'faturado', coalesce((select sum(total) from _gv where data >= p_de), 0),
    'faturado_ant', coalesce((select sum(total) from _gv where data < p_de), 0),
    'pedidos', (select count(*) from _gv where data >= p_de),
    'pedidos_ant', (select count(*) from _gv where data < p_de),
    'custo', coalesce((select sum(custo) from _gv where data >= p_de), 0),
    'custo_conhecido', coalesce((select sum(total) from _gv where data >= p_de and custo > 0), 0),
    'clientes', (select count(distinct cliente_id) from _gv where data >= p_de),
    'clientes_ant', (select count(distinct cliente_id) from _gv where data < p_de),
    'carteira', (select count(*) from public.pessoas where empresa_id = v_emp and eh_cliente and ativo),
    'meta', public.fn_meta_empresa(v_mes),
    'diario', (select jsonb_agg(jsonb_build_object('dia', d::date,
                 'atual', coalesce((select sum(total) from _gv where data = d::date), 0),
                 'anterior', coalesce((select sum(total) from _gv where data = (d::date - v_dias)), 0)) order by d)
                 from generate_series(p_de, p_ate, interval '1 day') d),
    'vendedores', coalesce((select jsonb_agg(x order by x.faturado desc) from (
        select v.razao_social as nome, public.fn_meta_vendedor(v.id, v_mes) as meta,
               coalesce(sum(g.total) filter (where g.data >= p_de), 0) as faturado,
               coalesce(sum(g.total) filter (where g.data < p_de), 0) as faturado_ant,
               count(g.pedido) filter (where g.data >= p_de) as pedidos,
               count(distinct g.cliente_id) filter (where g.data >= p_de) as clientes,
               (select count(*) from public.pessoas c where c.empresa_id = v_emp and c.eh_cliente and c.ativo and c.vendedor_id = v.id) as carteira,
               coalesce((select sum(c.valor) from public.comissoes c where c.vendedor_id = v.id and c.status = 'ativa'
                          and c.competencia between date_trunc('month', p_de)::date and p_ate), 0) as comissao,
               (select count(*) from public.visitas vi where vi.vendedor_id = v.id and vi.data between p_de and p_ate and vi.resultado = 'sem_pedido') as sem_pedido
          from public.pessoas v
          left join _gv g on g.vendedor_id = v.id
         where v.empresa_id = v_emp and v.eh_vendedor and v.ativo
         group by v.id, v.razao_social) x
        where x.faturado > 0 or x.faturado_ant > 0 or x.meta > 0), '[]'::jsonb),
    'top_clientes', coalesce((select jsonb_agg(x order by x.total desc) from (
        select g.cliente_id, coalesce(c.nome_fantasia, c.razao_social, 'Sem cadastro') as nome, sum(g.total) as total, count(*) as pedidos,
               coalesce((select sum(g2.total) from _gv g2 where g2.cliente_id = g.cliente_id and g2.data < p_de), 0) as total_ant
          from _gv g left join public.pessoas c on c.id = g.cliente_id
         where g.data >= p_de group by g.cliente_id, c.nome_fantasia, c.razao_social order by sum(g.total) desc limit 10) x), '[]'::jsonb),
    'top_produtos', coalesce((select jsonb_agg(x order by x.total desc) from (
        select min(codigo) as codigo, min(nome) as nome, sum(quantidade) as quantidade, sum(total) as total,
               case when sum(custo) > 0 then round((sum(total) - sum(custo)) / nullif(sum(total), 0) * 100, 1) end as margem
          from _gi group by coalesce(produto_id::text, codigo) order by sum(total) desc limit 10) x), '[]'::jsonb),
    -- clientes que compravam e pararam (sem compra há mais de 30 dias)
    'clientes_parados', coalesce((select jsonb_agg(x order by x.media desc) from (
        select u.cliente_id, coalesce(c.nome_fantasia, c.razao_social) as nome, u.ultima, u.media, ven.razao_social as vendedor
          from (select cliente_id, max(data) as ultima, round(sum(total) / greatest(1, count(distinct date_trunc('month', data))), 2) as media
                  from (select p.cliente_id, (p.faturado_em at time zone 'America/Campo_Grande')::date as data, p.valor_total as total
                          from public.pedidos p where p.empresa_id = v_emp and p.ativo and p.faturado_em is not null and p.status not in ('cancelado', 'devolvido')
                        union all
                        select h.cliente_id, h.data, h.total from public.vendas_historico h where h.empresa_id = v_emp and h.faturado) t
                 where cliente_id is not null and data >= v_hoje - 180
                 group by cliente_id) u
          join public.pessoas c on c.id = u.cliente_id and c.ativo
          left join public.pessoas ven on ven.id = c.vendedor_id
         where u.ultima < v_hoje - 30
         order by u.media desc limit 15) x), '[]'::jsonb),
    'clientes_parados_qtd', (select count(*) from (
        select cliente_id, max(data) ultima from (
          select p.cliente_id, (p.faturado_em at time zone 'America/Campo_Grande')::date as data from public.pedidos p
           where p.empresa_id = v_emp and p.ativo and p.faturado_em is not null and p.status not in ('cancelado', 'devolvido')
          union all select h.cliente_id, h.data from public.vendas_historico h where h.empresa_id = v_emp and h.faturado) t
         where cliente_id is not null and data >= v_hoje - 180 group by cliente_id) u where u.ultima < v_hoje - 30)
  ) into r;

  -- financeiro
  r := r || (select jsonb_build_object(
    'recebido', coalesce(sum(valor_pago) filter (where tipo = 'receber' and data_quitacao between p_de and p_ate), 0),
    'pago', coalesce(sum(valor_pago) filter (where tipo = 'pagar' and data_quitacao between p_de and p_ate), 0),
    'receber_aberto', coalesce(sum(valor) filter (where tipo = 'receber' and data_quitacao is null), 0),
    'receber_vencido', coalesce(sum(valor) filter (where tipo = 'receber' and data_quitacao is null and data_vencimento < v_hoje), 0),
    'receber_vencido_clientes', count(distinct pessoa_id) filter (where tipo = 'receber' and data_quitacao is null and data_vencimento < v_hoje),
    'pagar_aberto', coalesce(sum(valor) filter (where tipo = 'pagar' and data_quitacao is null), 0),
    'pagar_vencido', coalesce(sum(valor) filter (where tipo = 'pagar' and data_quitacao is null and data_vencimento < v_hoje), 0),
    'pagar_30', coalesce(sum(valor) filter (where tipo = 'pagar' and data_quitacao is null and data_vencimento between v_hoje and v_hoje + 30), 0),
    'receber_30', coalesce(sum(valor) filter (where tipo = 'receber' and data_quitacao is null and data_vencimento between v_hoje and v_hoje + 30), 0),
    'saldo_contas', (select coalesce(sum(s.saldo_atual), 0) from public.vw_contas_saldos s where s.empresa_id = v_emp and s.ativo),
    'despesas_grupos', coalesce((select jsonb_agg(x order by x.valor desc) from (
        select coalesce(pc.grupo_dre, 'Sem classificação') as grupo, sum(coalesce(l.valor_pago, l.valor)) as valor
          from public.lancamentos l left join public.plano_contas pc on pc.id = l.plano_conta_id
         where l.empresa_id = v_emp and l.ativo and l.tipo = 'pagar' and l.data_competencia between p_de and p_ate
         group by 1) x), '[]'::jsonb)
  ) from public.lancamentos where empresa_id = v_emp and ativo);

  -- operação
  r := r || jsonb_build_object(
    'pedidos_status', (select coalesce(jsonb_object_agg(status, jsonb_build_object('qtd', n, 'valor', v)), '{}'::jsonb) from (
        select status, count(*) n, sum(valor_total) v from public.pedidos
         where empresa_id = v_emp and ativo and tipo = 'pedido' and status in ('aguardando_credito', 'aprovado', 'em_separacao', 'em_rota') group by status) s),
    'a_faturar', (select jsonb_build_object('qtd', count(*), 'valor', coalesce(sum(valor_total), 0)) from public.pedidos
         where empresa_id = v_emp and ativo and tipo = 'pedido' and faturado_em is null and status in ('aprovado', 'em_separacao', 'em_rota', 'entregue')),
    'cargas_abertas', (select count(*) from public.expedicoes where empresa_id = v_emp and status in ('montando', 'separando', 'carregado', 'em_rota')),
    'entregas', (select jsonb_build_object(
        'entregues', count(*) filter (where ep.status_entrega = 'entregue'),
        'devolvidas', count(*) filter (where ep.status_entrega in ('devolvido_total', 'devolvido_parcial')),
        'ausentes', count(*) filter (where ep.status_entrega = 'ausente'))
        from public.expedicoes_pedidos ep join public.expedicoes e on e.id = ep.expedicao_id
       where e.empresa_id = v_emp and (ep.entregue_em at time zone 'America/Campo_Grande')::date between p_de and p_ate),
    'acertos_pendentes', (select count(*) from public.expedicoes e where e.empresa_id = v_emp and e.status = 'concluida'
                           and not exists (select 1 from public.acertos a where a.expedicao_id = e.id)),
    'boletos_a_enviar', (select count(*) from public.boletos where empresa_id = v_emp and status in ('pendente', 'erro')),
    'boletos_erro', (select count(*) from public.boletos where empresa_id = v_emp and status = 'erro'),
    'frota', (select jsonb_build_object('valor', coalesce(sum(valor), 0), 'litros', coalesce(sum(litros), 0))
                from public.despesas_frota where empresa_id = v_emp and data between p_de and p_ate)
  );

  -- estoque
  r := r || (select jsonb_build_object(
    'estoque_valor', coalesce(sum(e.quantidade * pr.custo), 0),
    'estoque_abaixo_minimo', count(*) filter (where e.estoque_minimo > 0 and e.disponivel < e.estoque_minimo),
    'estoque_vencido_itens', count(*) filter (where e.quantidade_vencida > 0),
    'estoque_vence_30', (select count(distinct s.produto_id) from public.estoque_saldos s join public.lotes lo on lo.id = s.lote_id
                          where s.empresa_id = v_emp and s.quantidade > 0 and lo.validade between v_hoje and v_hoje + 30))
    from public.vw_estoque_produtos e join public.produtos pr on pr.id = e.produto_id
   where e.empresa_id = v_emp);

  return r;
end;
$$;

revoke execute on function public.fn_eh_administrador() from public, anon;
grant execute on function public.fn_eh_administrador() to authenticated;
revoke execute on function public.gestao_resumo(date, date) from public, anon;
grant execute on function public.gestao_resumo(date, date) to authenticated;
