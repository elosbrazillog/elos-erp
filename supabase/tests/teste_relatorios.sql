\set ON_ERROR_STOP 1
-- Relatórios: roda depois de teste_financeiro.sql
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);

select 'vendas_periodo' as r, * from rel_vendas_periodo(current_date - 30, current_date, 'dia');
select 'abc_produtos' as r, * from rel_abc_produtos(current_date - 30, current_date);
select 'abc_clientes' as r, cliente_nome, pedidos, valor, participacao, acumulado, classe from rel_abc_clientes(current_date - 30, current_date);
select 'ranking' as r, * from rel_ranking_vendedores(current_date - 30, current_date);
select 'rota' as r, * from rel_vendas_rota(current_date - 30, current_date);
select 'pendentes' as r, numero, situacao, cliente_nome, carga, valor from rel_pedidos_pendentes();
select 'estoque' as r, produto_codigo, quantidade, reservado, disponivel, vencido, valor_custo from rel_estoque_atual();
select 'vencimentos' as r, produto_codigo, lote, validade, dias_para_vencer, quantidade, situacao from rel_vencimentos(30);
select 'atraso' as r, cliente_nome, titulos, ate_15, total, maior_atraso from rel_receber_atraso();
select 'fluxo' as r, * from rel_fluxo_caixa(current_date - 2, current_date + 3);

do $$ declare v numeric; e numeric; begin
  -- soma do ABC de produtos = soma das vendas do período
  select sum(valor) into v from rel_vendas_periodo(current_date - 30, current_date, 'mes');
  select sum(valor) into e from rel_abc_produtos(current_date - 30, current_date);
  assert v = e, format('ABC produtos %s x vendas %s', e, v);
  select sum(valor) into e from rel_abc_clientes(current_date - 30, current_date);
  assert v = e, format('ABC clientes %s x vendas %s', e, v);
  select sum(valor) into e from rel_ranking_vendedores(current_date - 30, current_date);
  assert v = e, 'ranking bate';
  select sum(valor) into e from rel_vendas_rota(current_date - 30, current_date);
  assert v = e, 'rotas batem';
  -- a última linha do ABC chega a 100%
  assert (select max(acumulado) from rel_abc_produtos(current_date - 30, current_date)) = 100;
  -- só entregues <= confirmados
  assert coalesce((select sum(valor) from rel_vendas_periodo(current_date - 30, current_date, 'mes', p_entregues => true)), 0) <= v;
  -- devolvido e cancelado não contam
  assert v = (select sum(valor_total) from pedidos where tipo = 'pedido' and status in ('aprovado', 'em_separacao', 'faturado', 'em_rota', 'entregue')), 'só pedidos confirmados';
  -- fluxo: saldo de hoje = saldo das contas + títulos vencidos até hoje
  assert (select saldo from rel_fluxo_caixa(current_date, current_date))
       = (select sum(saldo_atual) from vw_contas_saldos)
         + coalesce((select sum(valor) from lancamentos where ativo and data_quitacao is null and tipo = 'receber' and data_vencimento <= current_date), 0)
         - coalesce((select sum(valor) from lancamentos where ativo and data_quitacao is null and tipo = 'pagar' and data_vencimento <= current_date), 0),
    'saldo projetado de hoje';
  -- estoque: soma bate com os saldos
  assert (select sum(quantidade) from rel_estoque_atual()) = (select sum(quantidade) from estoque_saldos);
end $$;
reset role;

-- vendedor (sem relatórios) é barrado
set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
select public.t_erro($$select * from rel_vendas_periodo(current_date - 30, current_date)$$, 'não tem permissão');
select public.t_erro($$select * from rel_estoque_atual()$$, 'não tem permissão');
reset role;
show timezone;
select 'RELATORIOS OK' as resultado;
